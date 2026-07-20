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

window.getStableBearing = function(route, currentIdx) {
    if (!route || route.length === 0) return null;
    const p1 = route[currentIdx];
    for (let i = currentIdx + 1; i < route.length; i++) {
        const p2 = route[i];
        if (getDistance(p1[1], p1[0], p2[1], p2[0]) > 10) return turf.bearing(turf.point(p1), turf.point(p2));
    }
    return null;
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
    s.initialBearing = window.getStableBearing(routeArray, 0) || 0;

    document.body.classList.add('replay-mode'); 
    document.getElementById('replayTopHUD').style.display = 'flex';
    document.getElementById('replayControls').style.display = 'flex';
    document.getElementById('replayFinal').style.display = 'none';
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    currentSidebarState = -1; updateSidebarState();

    const bounds = routeArray.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(routeArray[0], routeArray[0]));
    const cw = map.getContainer().offsetWidth || window.innerWidth; 
    const ch = map.getContainer().offsetHeight || window.innerHeight;
    
    const cam50 = map.cameraForBounds(bounds, { padding: { top: ch*0.2, bottom: ch*0.2, left: cw*0.15, right: cw*0.15 } });
    s.zoom50 = (cam50 && !isNaN(cam50.zoom)) ? cam50.zoom : 13.5;
    s.trackZoom = Math.min(s.zoom50 + 2.5, 17); 

    window.calculateReplayCamera = function(progress) {
        if (progress >= 1) progress = 1;
        const exactIdx = progress * (s.totalPoints - 1);
        const currentIdx = Math.floor(exactIdx);
        
        let targetBearing = window.getStableBearing(s.route, currentIdx);
        if (targetBearing !== null) s.lastValidBearing = targetBearing;
        else if (s.lastValidBearing === undefined) s.lastValidBearing = s.initialBearing;

        if (s.smoothedBearing === undefined || isNaN(s.smoothedBearing)) s.smoothedBearing = s.lastValidBearing;

        let diff = s.lastValidBearing - s.smoothedBearing;
        while (diff < -180) diff += 360; while (diff > 180) diff -= 360;
        s.smoothedBearing += diff * 0.04; 

        return { 
            zoom: s.trackZoom,
            pitch: 62, 
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
        
        map.jumpTo({ center: bounds.getCenter(), zoom: s.zoom50, pitch: 0, bearing: 0 }); 
        setTimeout(() => {
            map.flyTo({ center: routeArray[0], zoom: s.trackZoom, pitch: 62, bearing: s.initialBearing, duration: 2500, essential: true });
        }, 300);

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
    
    // 💡 나가기 시 도착 마커 제거 로직도 불필요하여 지움
    openTab('tabMyLog'); currentSidebarState = 2; updateSidebarState();
};

window.finishReplay = function() {
    const s = window.replayState; s.playing = false; s.isEndRotation = true;
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    
    let currentEndBearing = map.getBearing();
    const endPoint = s.route[s.route.length - 1];

    // 💡 도착 깃발 생성 및 지도에 띄우는 코드 완전 삭제 완료

    setTimeout(() => {
        window.renderReplayFinal();
        
        let startZoom = s.trackZoom; let targetZoom = s.zoom50; 
        
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