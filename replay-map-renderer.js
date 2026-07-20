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

// 💡 초기 마커 렌더링 세팅 (출발 깃발 삭제 완료)
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

    // 최고점 마커만 생성
    const highestEl = document.createElement('div');
    highestEl.innerHTML = `<div style="width:14px; height:14px; background:#D32F2F; border:2.5px solid white; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.5);"></div>`;
    highestEl.style.zIndex = '900';
    window.replayHighestMarker = new mapboxgl.Marker({element: highestEl, anchor: 'center'}).setLngLat(highestPoint).addTo(map);
};