// 전역 BGM 및 뮤트 상태
let inAppBgmAudio = null;
window.isBgmMuted = false;

window.playInAppBgm = function() {
    if (!inAppBgmAudio) { inAppBgmAudio = new Audio('./bgm.mp3'); inAppBgmAudio.loop = true; }
    inAppBgmAudio.muted = window.isBgmMuted; inAppBgmAudio.currentTime = 0;
    const playPromise = inAppBgmAudio.play();
    if (playPromise !== undefined) playPromise.catch(e => console.log("BGM 자동 재생 대기:", e));
};
window.stopInAppBgm = function() { if (inAppBgmAudio) { inAppBgmAudio.pause(); inAppBgmAudio.currentTime = 0; } };
window.pauseInAppBgm = function() { if (inAppBgmAudio) inAppBgmAudio.pause(); };

window.toggleInAppBgm = function() {
    window.isBgmMuted = !window.isBgmMuted;
    if (inAppBgmAudio) inAppBgmAudio.muted = window.isBgmMuted;
    const btn = document.getElementById('btnBgmToggle');
    if (btn) btn.innerHTML = window.isBgmMuted ? '<span class="icon">🔇</span><span class="txt">소리 끔</span>' : '<span class="icon">🔊</span><span class="txt">소리 켬</span>';
};

window.forceRemovePhotoPopup = function() {
    window.currentPhotoPopupId = (window.currentPhotoPopupId || 0) + 1;
    if(window.replayState) window.replayState.wasPlayingBeforePhoto = false;
    const existingPopup = document.getElementById('tempPhotoPopup');
    if (existingPopup) existingPopup.remove();
};

window.replayRoute = function(routeArray, record) {
    if(!routeArray || routeArray.length < 2) return alert("GPS 동선 데이터가 부족합니다.");
    if (window.replayState.active) window.exitReplay();
    
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    window.stopInAppBgm();

    const s = window.replayState;
    s.active = true; s.playing = false; s.isEndRotation = false;
    s.elapsedTime = 0; s.maxHudAlt = 0; s.route = routeArray; s.record = record;
    s.totalPoints = routeArray.length; s.totalSeconds = window.timeStrToSeconds(record.time || "00:00:00");
    
    let maxAlt = -1; let highestIdx = 0;
    routeArray.forEach((pt, idx) => { if(pt[2] && pt[2] > maxAlt) { maxAlt = pt[2]; highestIdx = idx; } });
    s.highestPoint = routeArray[highestIdx];
    s.initialBearing = turf.bearing(turf.point(routeArray[0]), turf.point(routeArray[highestIdx])) || 0;

    document.body.classList.add('replay-mode'); 
    document.getElementById('replayTopHUD').style.display = 'flex';
    document.getElementById('replayControls').style.display = 'flex';
    document.getElementById('replayFinal').style.display = 'none';
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    currentSidebarState = -1; updateSidebarState();

    // 💡 [영상 분석 적용] 전체 동선 크기를 파악하여 완벽한 줌 레벨 계산
    const bounds = routeArray.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(routeArray[0], routeArray[0]));
    const cw = map.getContainer().offsetWidth; const ch = map.getContainer().offsetHeight;
    
    // 전체가 화면에 꽉 차게 보이는 줌 레벨 (피날레용)
    const camAll = map.cameraForBounds(bounds, { padding: { top: ch*0.2, bottom: ch*0.2, left: cw*0.15, right: cw*0.15 } });
    s.finaleZoom = (camAll && !isNaN(camAll.zoom)) ? camAll.zoom : 13.5;
    
    // 트래킹할 때 피사체에 바짝 붙는 줌 레벨 (시작~트래킹용)
    s.trackZoom = s.finaleZoom + 2.0; 
    if (s.trackZoom > 16) s.trackZoom = 16; // 너무 과도하게 확대되는 것 방지

    // 💡 [영상 분석 적용] 피사체에 바짝 붙어서 앞을 바라보는 역동적인 카메라
    window.calculateReplayCamera = function(progress) {
        if (progress >= 1) progress = 1;
        
        const exactIdx = progress * (s.totalPoints - 1);
        const currentIdx = Math.floor(exactIdx);
        
        // 시선을 약간 앞쪽으로 두어 부드럽게 길을 따라감
        let lookAheadIdx = Math.floor(currentIdx + Math.max(5, s.totalPoints * 0.02));
        if (lookAheadIdx >= s.totalPoints) lookAheadIdx = s.totalPoints - 1;

        let targetBearing = s.lastValidBearing !== undefined ? s.lastValidBearing : (s.initialBearing || 0);
        const p1 = s.route[currentIdx]; const p2 = s.route[lookAheadIdx];

        // 진행 방향 계산
        if (p1 && p2 && (p1[0] !== p2[0] || p1[1] !== p2[1])) {
            const b = turf.bearing(turf.point(p1), turf.point(p2));
            if (!isNaN(b)) targetBearing = b;
            s.lastValidBearing = targetBearing;
        }

        if (s.smoothedBearing === undefined || isNaN(s.smoothedBearing)) s.smoothedBearing = targetBearing;

        // 카메라가 확 튀지 않고 부드럽게 고개를 돌리도록 댐핑 처리
        let diff = targetBearing - s.smoothedBearing;
        while (diff < -180) diff += 360; 
        while (diff > 180) diff -= 360;
        s.smoothedBearing += diff * 0.08; 

        return { 
            zoom: s.trackZoom, // 💡 항상 바짝 붙어서 쫓아감
            pitch: 62,         // 💡 시네마틱하게 눕힌 시선
            bearing: s.smoothedBearing 
        };
    };

    const initReplay = () => {
        if(!map.getSource('replayLine')) {
            map.addSource('replayLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
            map.addLayer({ id: 'replayLineGlow', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.6, 'line-blur': 6 } });
            map.addLayer({ id: 'replayLineLayer', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
            map.addSource('replayPoint', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: routeArray[0] } } });
            map.addLayer({ id: 'replayPointLayer', type: 'circle', source: 'replayPoint', paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#E65100' } });
        }
        
        s.smoothedBearing = s.initialBearing;
        s.lastValidBearing = s.initialBearing;

        window.renderReplayMarkers(record, routeArray, s.highestPoint);
        
        // 💡 첫 화면 세팅: 가까이서 출발 대기
        map.jumpTo({ center: routeArray[0], zoom: s.trackZoom, pitch: 62, bearing: s.initialBearing }); 
        window.updateReplayVisuals(0); 
    };

    if (mapMode !== 1) { 
        mapMode = 1; window.updateMapModeButton();
        map.once('style.load', initReplay); map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else { initReplay(); }
};

window.updateReplayVisuals = function(progress) {
    const s = window.replayState;
    if (progress >= 1) progress = 1;
    const { currentPt, drawnRoute } = window.calculateReplayFrame(progress);
    const cameraOpts = window.calculateReplayCamera(progress);
    const stats = window.calculateReplayStats(progress, currentPt);

    window.renderReplayMap(drawnRoute, currentPt);
    window.renderReplayHUD(stats, progress);

    if (!s.isRenderingVideo) {
        const isPhotoPaused = window.renderReplayPhotos(currentPt);
        if (!isPhotoPaused && s.playing) { window.renderReplayCamera(cameraOpts, currentPt); }
    } else {
        window.renderReplayCamera(cameraOpts, currentPt);
    }
};

window.replayLoop = function(time) {
    const s = window.replayState;
    if(!s.active) return;
    if(s.playing && !s.isEndRotation) {
        let dt = time - s.lastFrameTime; s.lastFrameTime = time;
        if (dt > 0 && dt < 1000) s.elapsedTime += dt;
        let progress = s.elapsedTime / s.duration;
        window.updateReplayVisuals(progress);
        if (progress >= 1) { window.finishReplay(); return; }
    } else { s.lastFrameTime = time; }
    s.reqId = requestAnimationFrame(window.replayLoop);
};

window.toggleReplayPlay = function() {
    const s = window.replayState; s.playing = !s.playing;
    window.forceRemovePhotoPopup(); 
    document.getElementById('btnReplayPlay').innerHTML = s.playing ? '<span class="icon">⏸️</span><span class="txt">일시정지</span>' : '<span class="icon">▶️</span><span class="txt">재생</span>';
    
    if(s.playing) {
        window.playInAppBgm();
        if(s.isEndRotation) {
            s.isEndRotation = false; cancelAnimationFrame(s.endRotationReqId);
            document.getElementById('replayFinal').style.display = 'none';
            document.getElementById('replayTopHUD').style.display = 'flex'; 
            s.elapsedTime = 0;
            if(inAppBgmAudio) inAppBgmAudio.currentTime = 0;
            if(s.record.photoData) s.record.photoData.forEach(p => p.shown = false);
            if(window.replayEndMarker) { window.replayEndMarker.remove(); window.replayEndMarker = null; }
        }
        s.lastFrameTime = performance.now();
        cancelAnimationFrame(s.reqId); s.reqId = requestAnimationFrame(window.replayLoop);
    } else { window.pauseInAppBgm(); }
};

window.jumpReplay = function(seconds) {
    const s = window.replayState; window.forceRemovePhotoPopup(); 
    s.elapsedTime += (seconds * 1000); if(s.elapsedTime < 0) s.elapsedTime = 0;
    if(s.elapsedTime >= s.duration) {
        s.elapsedTime = s.duration; window.updateReplayVisuals(1); window.finishReplay();
    } else {
        if (s.isEndRotation) {
            s.isEndRotation = false; cancelAnimationFrame(s.endRotationReqId);
            document.getElementById('replayFinal').style.display = 'none';
            document.getElementById('replayTopHUD').style.display = 'flex';
            document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
            if(window.replayEndMarker) { window.replayEndMarker.remove(); window.replayEndMarker = null; }
            s.playing = false; window.pauseInAppBgm(); 
        }
        if (inAppBgmAudio && inAppBgmAudio.duration) inAppBgmAudio.currentTime = (s.elapsedTime / 1000) % inAppBgmAudio.duration;
        window.updateReplayVisuals(s.elapsedTime / s.duration);
    }
};

window.stopReplay = function() {
    const s = window.replayState; s.playing = false;
    window.forceRemovePhotoPopup(); window.stopInAppBgm(); 
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    if (s.isEndRotation) {
        s.isEndRotation = false; cancelAnimationFrame(s.endRotationReqId);
        document.getElementById('replayFinal').style.display = 'none';
        document.getElementById('replayTopHUD').style.display = 'flex';
        if(window.replayEndMarker) { window.replayEndMarker.remove(); window.replayEndMarker = null; }
    }
    s.elapsedTime = 0; s.maxHudAlt = 0;
    if(s.record.photoData) s.record.photoData.forEach(p => p.shown = false);
    window.updateReplayVisuals(0);
    map.jumpTo({ center: s.route[0], zoom: s.trackZoom, pitch: 62, bearing: s.initialBearing });
};

window.exitReplay = function() {
    const s = window.replayState; s.active = false; s.isEndRotation = false;
    cancelAnimationFrame(s.reqId); cancelAnimationFrame(s.endRotationReqId);
    window.forceRemovePhotoPopup(); window.stopInAppBgm(); 

    document.body.classList.remove('replay-mode'); 
    document.getElementById('replayTopHUD').style.display = 'none';
    document.getElementById('replayControls').style.display = 'none';
    document.getElementById('replayFinal').style.display = 'none';
    if(map.getSource('replayLine')) { map.removeLayer('replayLineLayer'); map.removeLayer('replayLineGlow'); map.removeSource('replayLine'); }
    if(map.getSource('replayPoint')) map.removeLayer('replayPointLayer').removeSource('replayPoint');
    if(window.replayMarkers) { window.replayMarkers.forEach(m => m.remove()); window.replayMarkers = []; }
    if(window.replayHighestMarker) { window.replayHighestMarker.remove(); window.replayHighestMarker = null; }
    if(window.replayStartMarker) { window.replayStartMarker.remove(); window.replayStartMarker = null; }
    if(window.replayEndMarker) { window.replayEndMarker.remove(); window.replayEndMarker = null; }
    openTab('tabMyLog'); currentSidebarState = 2; updateSidebarState();
};

window.finishReplay = function() {
    const s = window.replayState; s.playing = false; s.isEndRotation = true;
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    
    let currentEndBearing = map.getBearing();
    const endPoint = s.route[s.route.length - 1];

    const endEl = document.createElement('div'); endEl.className = 'flag-anim'; 
    endEl.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center;">
        <div style="font-size:15px; font-weight:900; background:white; color:#D32F2F; padding:4px 10px; border-radius:8px; border:2px solid #D32F2F;">🏆 도착</div>
        <div style="width:3px; height:35px; background:#D32F2F; box-shadow: 2px 0 4px rgba(0,0,0,0.3);"></div>
        <div style="width:12px; height:12px; background:#D32F2F; border:2px solid white; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.5); transform: translateY(-2px);"></div>
    </div>`;
    endEl.style.zIndex = '1000';
    window.replayEndMarker = new mapboxgl.Marker({element: endEl, anchor: 'bottom'}).setLngLat(endPoint).addTo(map);
    if(!window.replayMarkers) window.replayMarkers = [];
    window.replayMarkers.push(window.replayEndMarker);

    setTimeout(() => {
        window.renderReplayFinal();
        
        // 💡 [영상 분석 적용] 피날레: 바짝 붙어있던 줌(trackZoom)에서 전체가 보이는 줌(finaleZoom)으로 확 빠져나오기
        let startZoom = s.trackZoom; let targetZoom = s.finaleZoom; 
        
        const bounds = s.route.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(s.route[0], s.route[0]));
        const routeCenter = bounds.getCenter().toArray(); 
        
        let transitionStartTime = null; let transitionDuration = 10000; 

        function rotateEnd(timestamp) {
            if(!s.active || !s.isEndRotation) return;
            if (!transitionStartTime) transitionStartTime = timestamp;

            currentEndBearing += 0.2; 
            let elapsed = timestamp - transitionStartTime;
            let progress = Math.min(elapsed / transitionDuration, 1);
            let easeOut = 1 - Math.pow(1 - progress, 3); 

            // 💡 위로 붕 떠오르면서 스카이뷰(Pitch 30)로 고개 숙임
            let currentZoom = startZoom + (targetZoom - startZoom) * easeOut;
            let currentPitch = 62 + (30 - 62) * easeOut; 

            let currentCenter = [
                endPoint[0] + (routeCenter[0] - endPoint[0]) * easeOut,
                endPoint[1] + (routeCenter[1] - endPoint[1]) * easeOut
            ];

            map.jumpTo({ center: currentCenter, bearing: currentEndBearing, pitch: currentPitch, zoom: currentZoom });
            s.endRotationReqId = requestAnimationFrame(rotateEnd);
        }
        s.endRotationReqId = requestAnimationFrame(rotateEnd);
    }, 300); 
};