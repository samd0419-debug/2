window.replayMarkers = [];
window.replayHighestMarker = null;
window.replayStartMarker = null;
window.replayEndMarker = null; 

// 지도 라인 및 포인트 렌더링
window.renderReplayMap = function(drawnRoute, currentPt) {
    if(map.getSource('replayLine')) map.getSource('replayLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: drawnRoute } });
    if(map.getSource('replayPoint')) map.getSource('replayPoint').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: currentPt } });
};

// 시네마틱 카메라 렌더링
window.renderReplayCamera = function(cameraOpts, currentPt) {
    map.jumpTo({ center: currentPt, zoom: cameraOpts.zoom, pitch: cameraOpts.pitch, bearing: cameraOpts.bearing });
};

// 💡 초기 마커 렌더링 세팅 (시작 깃발 애니메이션 적용)
window.renderReplayMarkers = function(record, routeArray, highestPoint) {
    window.replayMarkers = [];
    if(record.photoData && record.photoData.length > 0) {
        record.photoData.forEach((pd) => {
            const el = document.createElement('div');
            el.innerHTML = '📷'; el.style.fontSize = '20px'; el.style.cursor = 'pointer'; el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
            const marker = new mapboxgl.Marker({ element: el }).setLngLat(pd.coords).addTo(map);
            window.replayMarkers.push(marker); pd.shown = false;
        });
    }
    
    // 출발 마커 (flag-anim 클래스 추가)
    const startEl = document.createElement('div');
    startEl.className = 'flag-anim';
    startEl.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center;">
        <div style="font-size:15px; font-weight:900; background:rgba(255,255,255,0.95); color:#2E7D32; padding:5px 12px; border-radius:8px; box-shadow:0 3px 6px rgba(0,0,0,0.5); white-space:nowrap; line-height:1; border: 2px solid #4CAF50;">🏁 출발</div>
        <div style="width:3px; height:35px; background:#4CAF50; box-shadow: 2px 0 4px rgba(0,0,0,0.3);"></div>
        <div style="width:12px; height:12px; background:#4CAF50; border:2px solid white; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.5); transform: translateY(-2px);"></div>
    </div>`;
    startEl.style.zIndex = '1000';
    window.replayStartMarker = new mapboxgl.Marker({element: startEl, anchor: 'bottom'}).setLngLat(routeArray[0]).addTo(map);

    // 최고점 마커
    const highestEl = document.createElement('div');
    highestEl.className = 'flag-anim';
    highestEl.innerHTML = `<div style="width:14px; height:14px; background:#D32F2F; border:2.5px solid white; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.5);"></div>`;
    highestEl.style.zIndex = '900';
    window.replayHighestMarker = new mapboxgl.Marker({element: highestEl, anchor: 'center'}).setLngLat(highestPoint).addTo(map);
};