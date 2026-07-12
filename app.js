let map;
let myLogMarkers = [], m100Markers = [], challengeMarkers = [];
let tempMarker = null;
let isSatelliteMode = false;

async function fetchWeather(lat, lng, containerId) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto`;
        const res = await fetch(url);
        const data = await res.json();
        
        const temp = data.current.temperature_2m;
        const humidity = data.current.relative_humidity_2m;
        const wCode = data.current.weather_code;
        
        const maxTemp = data.daily.temperature_2m_max[0];
        const minTemp = data.daily.temperature_2m_min[0];
        const rainProb = data.daily.precipitation_probability_max[0] || 0;
        
        let wIcon = '☀️';
        if (wCode >= 1 && wCode <= 3) wIcon = '⛅';
        else if (wCode >= 45 && wCode <= 48) wIcon = '🌫️';
        else if (wCode >= 51 && wCode <= 67) wIcon = '🌧️';
        else if (wCode >= 71 && wCode <= 77) wIcon = '❄️';
        else if (wCode >= 80 && wCode <= 82) wIcon = '🌦️';
        else if (wCode >= 95 && wCode <= 99) wIcon = '⛈️';

        const html = `
            <div style="background:#e3f2fd; padding:12px; border-radius:8px; margin-top:12px; font-size:0.95em; color:#0d47a1; text-align:left; border: 1px solid #bbdefb; line-height:1.6;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; border-bottom: 1px solid rgba(13,71,161,0.2); padding-bottom:5px;">
                    <b>실시간 날씨 예보</b> <span style="font-size:1.4em;">${wIcon}</span>
                </div>
                🌡️ 현재 기온: <b style="color:#333;">${temp}°C</b><br>
                📈 최고/최저: <b style="color:#d32f2f;">${maxTemp}°C</b> / <b style="color:#1976d2;">${minTemp}°C</b><br>
                💧 현재 습도: <b style="color:#333;">${humidity}%</b><br>
                ☔ 오늘 최고 강수 확률: <b style="color:#e65100;">${rainProb}%</b>
            </div>
        `;
        const el = document.getElementById(containerId);
        if(el) el.innerHTML = html;
    } catch(e) {
        const el = document.getElementById(containerId);
        if(el) el.innerHTML = `<div style="font-size:0.85em; color:#d32f2f; margin-top:10px;">날씨 정보를 불러오지 못했습니다.</div>`;
    }
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; 
    const p1 = lat1 * Math.PI/180; const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180; const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const localOverrides = JSON.parse(localStorage.getItem('m100_overrides') || '{}');
const savedOverrides = { ...defaultOverrides, ...localOverrides };

m100Data.forEach(m => {
    if(savedOverrides[m.name]) {
        m.lat = savedOverrides[m.name].lat;
        m.lng = savedOverrides[m.name].lng;
    }
});

function bindMarkerEditMode(el, marker, m) {
    let pressTimer;
    const startEdit = (e) => {
        if(e) { e.preventDefault(); e.stopPropagation(); }
        if(marker.isDraggable && marker.isDraggable()) return; 
        if(marker.getPopup().isOpen()) marker.togglePopup(); 

        if(confirm(`[${m.name}] 핀 위치를 수정하시겠습니까?\n\n'확인'을 누른 후 핀을 꾹 눌러 원하는 위치로 드래그하고 놓으면 자동 저장됩니다.`)) {
            marker.setDraggable(true);
            el.classList.add('editing-mode');
            marker.once('dragend', () => {
                const newLngLat = marker.getLngLat();
                let overrides = JSON.parse(localStorage.getItem('m100_overrides') || '{}');
                overrides[m.name] = { lat: newLngLat.lat, lng: newLngLat.lng };
                localStorage.setItem('m100_overrides', JSON.stringify(overrides));
                m.lat = newLngLat.lat; m.lng = newLngLat.lng;
                marker.setDraggable(false); 
                el.classList.remove('editing-mode'); 
                alert(`✅ [${m.name}] 정상 위치가 저장되었습니다!`);
            });
        }
    };

    el.addEventListener('contextmenu', startEdit);
    el.addEventListener('touchstart', (e) => {
        if(e.touches.length > 1) return;
        pressTimer = setTimeout(() => { startEdit(e); }, 800); 
    }, {passive: false});
    el.addEventListener('touchend', () => clearTimeout(pressTimer));
    el.addEventListener('touchmove', () => clearTimeout(pressTimer));
}

let isRotating = false; let targetCenter = null; let rotateReqId = null;

function startRotate(lng, lat) {
    targetCenter = [lng, lat];
    if (!isRotating) { isRotating = true; rotateCamera(); }
}

function rotateCamera() {
    if (!isRotating || !targetCenter) return;
    const currentBearing = map.getBearing();
    map.jumpTo({ bearing: currentBearing + 0.15, center: targetCenter, padding: getMapPadding() });
    rotateReqId = requestAnimationFrame(rotateCamera);
}

function stopRotate() {
    isRotating = false;
    if (rotateReqId) { cancelAnimationFrame(rotateReqId); rotateReqId = null; }
}

function getMapPadding() {
    const sidebarEl = document.getElementById('sidebar');
    let padBottom = 30;
    if (!sidebarEl || sidebarEl.classList.contains('hidden')) padBottom = 30;
    else if (currentSidebarState === 0) padBottom = 150;
    else if (currentSidebarState === 1) padBottom = window.innerHeight * 0.55;
    else if (currentSidebarState === 2) padBottom = window.innerHeight * 0.8;
    
    // 💡 팝업이 위로 잘리지 않도록 지도 중심을 아래로 내리기 위한 top 여백(250px) 추가!
    const padTop = window.innerHeight < 700 ? 180 : 250; 
    return { top: padTop, bottom: padBottom };
}

function focusAndRotate(lng, lat, zoomLvl = 14, callback = null) {
    stopRotate();
    const padding = getMapPadding();
    map.flyTo({ center: [lng, lat], zoom: zoomLvl, pitch: 65, bearing: map.getBearing(), padding: padding, duration: 2500, essential: true });
    map.once('moveend', () => { 
        startRotate(lng, lat); 
        if (callback) callback();
    });
}

window.toggleMapStyle = function() {
    const btn = document.getElementById('styleToggleBtn');
    
    // 1. 상태 토글 및 스타일 결정
    isSatelliteMode = !isSatelliteMode;
    const nextStyle = isSatelliteMode ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/outdoors-v12';
    
    // 2. 스타일 변경
    map.setStyle(nextStyle);
    
    // 3. 스타일 로드 이벤트에 지형 재설정 로직을 '단 한 번(once)' 실행하도록 보장
    map.once('style.load', () => {
        // 지형 데이터 소스 추가
        map.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
        });
        
        // 지형 적용
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.1 });
        
        // 하늘 효과 레이어 재추가
        map.addLayer({
            'id': 'sky',
            'type': 'sky',
            'paint': {
                'sky-type': 'atmosphere',
                'sky-atmosphere-sun': [0.0, 0.0],
                'sky-atmosphere-sun-intensity': 15
            }
        });
    });

    // 4. UI 텍스트 변경
    btn.innerHTML = isSatelliteMode ? '🗺️ 3D 지형도' : '🛰️ 3D 위성도';
};
document.addEventListener('DOMContentLoaded', () => {
    mapboxgl.accessToken = 'pk.eyJ1Ijoic2FtZDIwMDAiLCJhIjoiY21yYmp1OG41MXV0bzMwczliZjk5enNjaSJ9.yb9rTbbR-mme-SZ89CTK1Q';
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [128.0, 36.0], 
        zoom: window.innerWidth <= 768 ? 5.3 : 5.8,
        pitch: 45, // 기본 입체 화면 대기
        bearing: 0, // 정북 방향 고정
        projection: 'mercator', 
        doubleClickZoom: false
    });

    mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js');
    map.addControl(new MapboxLanguage({ defaultLanguage: 'ko' }));

    map.on('style.load', () => {
        if (!map.getSource('mapbox-dem')) {
            map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 });
        }
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.1 }); 
        if (!map.getLayer('sky')) {
            map.addLayer({ 'id': 'sky', 'type': 'sky', 'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 } });
        }
    });

    // 1. 나침반 & GPS 
    const nav = new mapboxgl.NavigationControl({ showZoom: false, showCompass: true });
    map.addControl(nav, 'top-right');

    const geolocate = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true, 
        showUserHeading: true,
        fitBoundsOptions: { maxZoom: 15 } 
    });
    map.addControl(geolocate, 'top-right');

    // 2. 디자인 및 투명 방패
    const style = document.createElement('style');
    style.innerHTML = `
        .mapboxgl-ctrl-top-right { top: max(15px, env(safe-area-inset-top)) !important; right: 15px !important; display: flex !important; flex-direction: column !important; gap: 12px !important; }
        .mapboxgl-ctrl-top-right .mapboxgl-ctrl { margin: 0 !important; } 
        .mapboxgl-ctrl-group { border-radius: 12px !important; box-shadow: 0 4px 15px rgba(0,0,0,0.2) !important; overflow: visible !important; background: white !important; }
        .mapboxgl-ctrl-group > button { width: 48px !important; height: 48px !important; display: flex !important; justify-content: center !important; align-items: center !important; position: relative; }
        .mapboxgl-ctrl-icon { transform: scale(1.4); } 
        .compass-touch-shield { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 9999; cursor: pointer; }
        .compass-mode-indicator { position: absolute; right: 60px; top: 50%; transform: translateY(-50%); font-size: 13px; font-weight: 900; background: rgba(255,255,255,0.95); padding: 5px 10px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.3); pointer-events: none; white-space: nowrap; display: none; }
    `;
    document.head.appendChild(style);

    // 3. 🚀 회전 엔진 & 권한 진단기
    window.isAutoRotating = false; // 기본 정북 고정
    let isSensorGranted = false;

    function handleOrientation(e) {
        if (!window.isAutoRotating) return; 
        
        let heading = null;
        if (e.webkitCompassHeading) heading = e.webkitCompassHeading;
        else if (e.absolute && e.alpha !== null) heading = 360 - e.alpha;
        
        if (heading !== null && !map.isZooming() && !map.isDragging()) {
            map.setBearing(heading); 
        }
    }

    // 나침반 버튼 로직
    setTimeout(() => {
        const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
        if (compassBtn) {
            const shield = document.createElement('div');
            shield.className = 'compass-touch-shield';
            compassBtn.appendChild(shield);

            const indicator = document.createElement('div');
            indicator.className = 'compass-mode-indicator';
            compassBtn.parentElement.appendChild(indicator);

            const showIndicator = (text, color) => {
                indicator.innerHTML = text;
                indicator.style.color = color;
                indicator.style.display = 'block';
                setTimeout(() => { indicator.style.display = 'none'; }, 2000);
            };

            const toggleCompassMode = async (e) => {
                e.preventDefault(); e.stopPropagation();

                if (window.isAutoRotating) {
                    // 모드 1 -> 모드 2 (회전 끄기)
                    window.isAutoRotating = false;
                    map.easeTo({ bearing: 0, duration: 800 });
                    showIndicator('정북 고정 (모드 2)', '#D32F2F');
                } else {
                    // 모드 2 -> 모드 1 (회전 켜기 + 권한 진단)
                    if (!isSensorGranted) {
                        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                            try {
                                const permission = await DeviceOrientationEvent.requestPermission();
                                if (permission === 'granted') {
                                    isSensorGranted = true;
                                    window.addEventListener('deviceorientation', handleOrientation, true);
                                } else {
                                    alert("❌ 방향 센서 접근이 거부되었습니다.\n아이폰 [설정] - [Safari] - [동작 및 방향 접근]이 켜져 있는지 확인해주세요.");
                                    return; // 회전 모드 진입 취소
                                }
                            } catch (err) {
                                alert("❌ 센서 접근 실패!\n(원인: 현재 연결이 https 보안 연결이 아니거나, 기기에서 지원하지 않습니다.)");
                                return; // 회전 모드 진입 취소
                            }
                        } else {
                            // 안드로이드 등 구형 기기
                            isSensorGranted = true;
                            window.addEventListener('deviceorientation', handleOrientation, true);
                        }
                    }

                    // 권한 획득 성공 시 회전 시작
                    window.isAutoRotating = true;
                    showIndicator('지도 회전 (모드 1)', '#1976D2');
                }
            };

            shield.addEventListener('click', toggleCompassMode);
            shield.addEventListener('touchstart', toggleCompassMode, { passive: false });
        }
    }, 1000);
    
    // 조작 제어 공통
    let clickCount = 0; let clickTimer = null;
    map.on('click', (e) => {
        clickCount++;
        if (clickCount === 3) { resetMapToDefault(); clickCount = 0; clearTimeout(clickTimer); } 
        else { clearTimeout(clickTimer); clickTimer = setTimeout(() => { clickCount = 0; }, 500); }
    });

    let touchTapCount = 0; let touchTapTimer = null;
    document.getElementById('map').addEventListener('touchstart', (e) => {
        if (e.touches.length > 1) return;
        touchTapCount++;
        if (touchTapCount === 3) { resetMapToDefault(); e.preventDefault(); touchTapCount = 0; clearTimeout(touchTapTimer); } 
        else { clearTimeout(touchTapTimer); touchTapTimer = setTimeout(() => { touchTapCount = 0; }, 500); }
    }, {passive: false});

    window.addEventListener('resize', () => {
        const widgets = ['myLogWidget', 'challengeWidget', 'm100Widget', 'searchWidget'];
        widgets.forEach(id => { const el = document.getElementById(id); if(el) { el.style.top = ''; el.style.left = ''; el.style.right = '15px'; el.style.bottom = ''; } });
        document.getElementById('searchWidget').style.bottom = '225px';
        document.getElementById('m100Widget').style.bottom = '160px';
        document.getElementById('challengeWidget').style.bottom = '95px';
        document.getElementById('myLogWidget').style.bottom = '30px';
    });

    initFABs(); initDB(); initM100List();
});

function createMarkerEl(type, labelHtml, isDim) {
    const el = document.createElement('div');
    el.className = 'marker-base' + (isDim ? ' dim-marker' : '');
    
    let colorStops = '';
    if (type === 'mylog') colorStops = '<stop offset="0%" stop-color="#ff8a80"/><stop offset="50%" stop-color="#d32f2f"/><stop offset="100%" stop-color="#8e0000"/>'; 
    else if (type === 'm100') colorStops = '<stop offset="0%" stop-color="#90caf9"/><stop offset="50%" stop-color="#1976d2"/><stop offset="100%" stop-color="#0d47a1"/>'; 
    else if (type === 'challenge') colorStops = '<stop offset="0%" stop-color="#ffcc80"/><stop offset="50%" stop-color="#f57c00"/><stop offset="100%" stop-color="#e65100"/>'; 
    else colorStops = '<stop offset="0%" stop-color="#ce93d8"/><stop offset="50%" stop-color="#7b1fa2"/><stop offset="100%" stop-color="#4a148c"/>'; 

    const svgId = 'grad-' + Math.random().toString(36).substr(2, 9);
    
    el.innerHTML = `
        <div class="marker-pin-wrapper">
            <svg viewBox="0 0 40 64" width="30" height="48" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="${svgId}" cx="35%" cy="30%" r="65%">
                  ${colorStops}
                </radialGradient>
                <linearGradient id="needle-${svgId}" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#888"/>
                  <stop offset="50%" stop-color="#eee"/>
                  <stop offset="100%" stop-color="#555"/>
                </linearGradient>
                <linearGradient id="base-${svgId}" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#444"/>
                  <stop offset="50%" stop-color="#999"/>
                  <stop offset="100%" stop-color="#222"/>
                </linearGradient>
              </defs>
              <ellipse cx="20" cy="62" rx="10" ry="2.5" fill="rgba(0,0,0,0.5)"/>
              <ellipse cx="20" cy="62" rx="4" ry="1.2" fill="rgba(0,0,0,0.8)"/>
              <polygon points="17,28 23,28 20.5,64 19.5,64" fill="url(#needle-${svgId})"/>
              <path d="M 14 26 L 26 26 L 24 30 L 16 30 Z" fill="url(#base-${svgId})"/>
              <circle cx="20" cy="16" r="14" fill="url(#${svgId})"/>
              <circle cx="14" cy="10" r="3.5" fill="#ffffff" opacity="0.85"/>
            </svg>
        </div>
        ${labelHtml || ''}
    `;
    return el;
}

function clearMarkers(groupArray) {
    if(!groupArray) return;
    groupArray.forEach(m => m.remove());
    groupArray.length = 0;
}

function resetMapToDefault() {
    stopRotate();
    map.flyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: {bottom: 0}, duration: 1500 });
    currentSidebarState = -1; updateSidebarState();
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove();
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
}

const sidebar = document.getElementById('sidebar'), handleDrag = document.getElementById('dragHandle'), dragText = document.querySelector('.drag-text');
let currentSidebarState = -1; const states = ['collapsed', 'half', 'full']; let isHandleDragging = false; let startY = 0;

if (handleDrag) {
    handleDrag.addEventListener('pointerdown', e => { isHandleDragging = true; startY = e.clientY; handleDrag.setPointerCapture(e.pointerId); });
    handleDrag.addEventListener('pointermove', e => { if(isHandleDragging) e.preventDefault(); }); 
    handleDrag.addEventListener('pointerup', e => {
        if(!isHandleDragging) return; isHandleDragging = false; handleDrag.releasePointerCapture(e.pointerId);
        const diff = startY - e.clientY; 
        if (Math.abs(diff) > 40) { if (diff > 0) { if (currentSidebarState < 2) currentSidebarState++; } else { if (currentSidebarState > 0) currentSidebarState--; } }
        else { if (currentSidebarState === 0) currentSidebarState = 1; else if (currentSidebarState === 1) currentSidebarState = 2; else if (currentSidebarState === 2) currentSidebarState = 0; }
        updateSidebarState();
    });
    handleDrag.addEventListener('wheel', e => { e.preventDefault(); if (e.deltaY > 0) { if (currentSidebarState > 0) currentSidebarState--; } else if (e.deltaY < 0) { if (currentSidebarState < 2) currentSidebarState++; } updateSidebarState(); }, {passive: false});
}

function updateSidebarState() {
    sidebar.classList.remove('hidden', 'collapsed', 'half', 'full'); 
    if (currentSidebarState === -1) { sidebar.classList.add('hidden'); } 
    else {
        sidebar.classList.add(states[currentSidebarState]);
        if (dragText) {
            if (currentSidebarState === 0) dragText.innerText = '클릭하여 크게 보기 / 위로 끌어올리세요'; 
            else if (currentSidebarState === 1) dragText.innerText = '클릭하여 전체 보기 / 스와이프하여 닫기'; 
            else dragText.innerText = '클릭하여 최소화 / 쓸어내려서 좁게 보기';
        }
    }
    if(isRotating && targetCenter) { map.easeTo({ center: targetCenter, padding: getMapPadding(), duration: 500 }); }
}

function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); 
    document.getElementById(tabId).classList.add('active');
    
    if (tabId === 'tabSearch') {
        currentSidebarState = 1; 
    } else {
        if (currentSidebarState === -1) currentSidebarState = 0; 
    }
    updateSidebarState();
    
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove(); stopRotate();
    
    if(tabId === 'tabChallenge') { renderChallengeMapAndList(); } 
    else if (tabId === 'tabM100') { renderM100Map(); } 
    else if (tabId === 'tabMyLog') { renderAll(); map.flyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 }); } 
    else if (tabId === 'tabSearch') { map.flyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 }); }
}

function initFABs() {
    setupDraggableFab(document.getElementById('myLogFab'), document.getElementById('myLogWidget'), () => openTab('tabMyLog'));
    setupDraggableFab(document.getElementById('m100Fab'), document.getElementById('m100Widget'), () => openTab('tabM100'));
    setupDraggableFab(document.getElementById('challengeFab'), document.getElementById('challengeWidget'), () => openTab('tabChallenge'));
    setupDraggableFab(document.getElementById('searchFab'), document.getElementById('searchWidget'), () => openTab('tabSearch'));
}

function setupDraggableFab(fab, widget, onClickCallback) {
    if(!fab) return;
    let startX, startY, initLeft, initTop, isDragging = false, dragTimer = null;
    fab.addEventListener('pointerdown', (e) => { if(!e.isPrimary) return; startX = e.clientX; startY = e.clientY; const rect = widget.getBoundingClientRect(); initLeft = rect.left; initTop = rect.top; isDragging = false; fab.setPointerCapture(e.pointerId); dragTimer = setTimeout(() => { isDragging = true; fab.style.transform = 'scale(1.1)'; }, 300); });
    fab.addEventListener('pointermove', (e) => { if (isDragging) { e.preventDefault(); widget.style.right = 'auto'; widget.style.bottom = 'auto'; widget.style.left = (initLeft + (e.clientX - startX)) + 'px'; widget.style.top = (initTop + (e.clientY - startY)) + 'px'; } else if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) clearTimeout(dragTimer); });
    fab.addEventListener('pointerup', (e) => { clearTimeout(dragTimer); fab.style.transform = ''; fab.releasePointerCapture(e.pointerId); if (!isDragging && onClickCallback) onClickCallback(); });
}

let db, allRecords = [], groupedData = {}, editingId = null;
let isFirstLoad = true, totalAltitudeData = 0;

function initDB() {
    const req = indexedDB.open("PeakLogDB", 1);
    req.onupgradeneeded = e => { db = e.target.result; if (!db.objectStoreNames.contains('hike_records')) db.createObjectStore('hike_records', { keyPath: 'id', autoIncrement: true }); };
    req.onsuccess = e => { db = e.target.result; loadSavedRecords(); };
}

function loadSavedRecords() {
    db.transaction(['hike_records'], 'readonly').objectStore('hike_records').getAll().onsuccess = e => {
        allRecords = e.target.result.sort((a,b) => new Date(b.date) - new Date(a.date)); 
        calculateTotalAltOnly();
        document.getElementById('uiTotalAlt').innerText = totalAltitudeData.toLocaleString(); 
        if (isFirstLoad) { playSplashIntro(); } else { renderAll(); }
    };
}

function calculateTotalAltOnly() {
    totalAltitudeData = 0; const mountainMap = {};
    allRecords.forEach(record => {
        const key = `${parseFloat(record.lat).toFixed(4)},${parseFloat(record.lng).toFixed(4)}`; 
        if (!mountainMap[key]) mountainMap[key] = { count: 0, alt: 0 };
        mountainMap[key].count += 1; const altValue = parseInt(record.alt); 
        if (!isNaN(altValue) && altValue > 0) mountainMap[key].alt = altValue; 
    });
    for (let key in mountainMap) totalAltitudeData += mountainMap[key].alt * mountainMap[key].count;
}

let splashSkipTriggered = false;
function playSplashIntro() {
    const splash = document.getElementById('splash'), counterContainer = document.getElementById('splashCounterContainer'), counterObj = document.getElementById('splashCounter'), hintObj = document.getElementById('touchHint');
    if (!splash) return;
    splash.addEventListener('pointerdown', skipSplash);

    function skipSplash() { if (splashSkipTriggered) return; splashSkipTriggered = true; counterObj.innerText = totalAltitudeData.toLocaleString(); finishSplashAndStart(); }

    setTimeout(() => {
        if (splashSkipTriggered) return; 
        counterContainer.classList.add('show'); hintObj.style.opacity = '1'; hintObj.innerText = "터치 시 바로 시작할 수 있습니다";
        setTimeout(() => {
            if (splashSkipTriggered) return; let startTimestamp = null; const duration = 1500; 
            const step = (timestamp) => {
                if (splashSkipTriggered) return; if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                counterObj.innerText = Math.floor((progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)) * totalAltitudeData).toLocaleString();
                if (progress < 1) window.requestAnimationFrame(step); 
                else { hintObj.innerText = "화면을 터치하여 지도 보기 🗺️"; hintObj.style.animation = 'blinkHint 1s infinite'; }
            }; window.requestAnimationFrame(step);
        }, 300); 
    }, 600); 
}

function finishSplashAndStart() {
    const splash = document.getElementById('splash'); isFirstLoad = false;
    if(splash) { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; if (map) map.resize(); renderAll(); }, 500); } 
    else { if (map) map.resize(); renderAll(); }
}

function renderAll() {
    clearMarkers(myLogMarkers); groupedData = {}; const groups = {};
    allRecords.forEach(r => {
        const lat = parseFloat(r.lat), lng = parseFloat(r.lng);
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        const altNum = parseInt(r.alt) || 0;
        if(!groups[key]) groups[key] = { key, name: r.name, lat, lng, climbs: [], altNum: altNum };
        groups[key].climbs.push(r);
        if (altNum > groups[key].altNum) groups[key].altNum = altNum;
    });

    const sortedGroups = Object.values(groups).sort((a, b) => {
        const aOldest = new Date(Math.min(...a.climbs.map(c => new Date(c.date))));
        const bOldest = new Date(Math.min(...b.climbs.map(c => new Date(c.date))));
        return aOldest - bOldest;
    });
    
    sortedGroups.forEach((group, index) => {
        group.climbs.sort((a,b) => new Date(b.date) - new Date(a.date));
        const latestDate = group.climbs[0].date;
        const altText = group.altNum > 0 ? ` (${group.altNum}m)` : "";
        
        const labelHtml = `<div class="mountain-label label-mylog"><b>${group.name}${altText}</b><br><span style="font-size:0.85em;">${latestDate}</span></div>`;
        const el = createMarkerEl('mylog', labelHtml);

        const delay = index * 80;
        const pin = el.querySelector('.marker-pin-wrapper');
        if (pin) pin.style.animation = `dropIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms both`;
        const lbl = el.querySelector('.mountain-label');
        if (lbl) lbl.style.animation = `labelFadeIn 0.3s ease ${delay + 200}ms both`;
        
        let popupContent = `<div style="text-align:center;"><b>🏕️ ${group.name}</b><br><span style="color:#D32F2F; font-weight:bold;">고도: ${group.altNum > 0 ? group.altNum + 'm' : '정보 없음'}</span><hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">`;
        group.climbs.forEach(c => {
            popupContent += `<div style="font-size:0.9em; margin-bottom:5px; color:#555;">📅 ${c.date}</div>`;
            if (c.photos && c.photos.length > 0) {
                const carouselId = 'carousel_' + Math.random().toString(36).substr(2, 9);
                popupContent += `<div class="carousel" id="${carouselId}"><div class="carousel-inner" id="inner_${carouselId}">`;
                c.photos.forEach((url, idx) => { popupContent += `<div class="carousel-item"><img src="${url}" onclick="openCarousel(${c.id}, ${idx}, event)"></div>`; });
                popupContent += `</div>`;
                if (c.photos.length > 1) {
                    popupContent += `<button class="carousel-control prev" onclick="moveCarousel('${carouselId}', -1, event)">&#10094;</button><button class="carousel-control next" onclick="moveCarousel('${carouselId}', 1, event)">&#10095;</button><div class="carousel-dots" id="dots_${carouselId}">`;
                    c.photos.forEach((_, idx) => { popupContent += `<div class="carousel-dot ${idx===0 ? 'active' : ''}"></div>`; });
                    popupContent += `</div>`;
                }
                popupContent += `</div>`;
                window[`state_${carouselId}`] = { current: 0, total: c.photos.length };
            }
        });
        popupContent += `</div>`;
        
        const popup = new mapboxgl.Popup({ offset: [0, -48], anchor: 'bottom', autoPan: false }).setHTML(popupContent);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([group.lng, group.lat]).setPopup(popup).addTo(map);

        el.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            const label = el.querySelector('.mountain-label');
            if(label) label.style.display = 'none'; 
            focusAndRotate(group.lng, group.lat, 14.5, () => {
                if (!marker.getPopup().isOpen()) marker.togglePopup();
            });
        });

        popup.on('close', () => {
            const label = el.querySelector('.mountain-label');
            if(label) label.style.display = 'block';
        });

        myLogMarkers.push(marker);
        groupedData[group.key] = { marker, data: group };
    });
    renderRecordList();
}

function renderRecordList() {
    const recordListEl = document.getElementById('recordList');
    recordListEl.innerHTML = '';
    
    allRecords.forEach(data => {
        const div = document.createElement('div');
        div.className = 'record-card';
        
        div.onclick = () => { 
            openTab('tabMyLog'); 
            currentSidebarState = 0; updateSidebarState();
            focusAndRotate(parseFloat(data.lng), parseFloat(data.lat), 14.5, () => {
                const key = `${parseFloat(data.lat).toFixed(4)},${parseFloat(data.lng).toFixed(4)}`;
                if(groupedData[key]) { 
                    const marker = groupedData[key].marker;
                    if(!marker.getPopup().isOpen()) {
                        // 💡 팝업을 열기 전에 기존의 빨간색 산 이름 라벨을 숨김
                        const label = marker.getElement().querySelector('.mountain-label');
                        if (label) label.style.display = 'none';

                        marker.togglePopup(); 
                    }
                }
            });
        };


        div.innerHTML = `<div class="action-btns"><button class="edit-btn" onclick="editRecord(${data.id}, event)">수정</button><button class="delete-btn" onclick="deleteRecord(${data.id}, event)">삭제</button></div><h4>⛰️ ${data.name} <span style="font-size:0.8em; color:#2E7D32;">${data.alt !== "정보 없음" ? '('+data.alt+'m)' : ''}</span></h4><p>📅 ${data.date}</p>`;
        recordListEl.appendChild(div);
    });
    
    if(allRecords.length === 0) { 
        recordListEl.innerHTML = `<div style="text-align:center; padding:20px; color:#777;">등산 기록이 없습니다.</div>`; 
    }
}

function initM100List() {
    const list = document.getElementById('m100List');
    m100Data.forEach(m => {
        const li = document.createElement('li'); li.className = 'm100-item';
        li.innerHTML = `<div class="m100-item-content"><div class="m100-name">${m.name}</div><div class="m100-desc">${m.region} | ${m.alt}m</div></div>`;
        li.onclick = () => {
            currentSidebarState = 0; updateSidebarState(); 
            focusAndRotate(m.lng, m.lat, 13.5, () => {
                m100Markers.forEach(marker => {
                    const lngLat = marker.getLngLat();
                    if (Math.abs(lngLat.lat - m.lat) < 0.0001 && Math.abs(lngLat.lng - m.lng) < 0.0001) {
                        if(!marker.getPopup().isOpen()) marker.togglePopup();
                    }
                });
            });
        };
        list.appendChild(li);
    });
}

function renderM100Map() {
    clearMarkers(m100Markers);
    m100Data.forEach(m => {
        const el = createMarkerEl('m100');
        const weatherId = 'weather-m100-' + Math.random().toString(36).substr(2, 9);
        
        const popup = new mapboxgl.Popup({ offset: [0, -48], anchor: 'bottom', autoPan: false }).setHTML(`
            <div style="text-align:center;">
                <b style="font-size:1.3em; color:#1565C0;">🇰🇷 ${m.name}</b><br>
                <span style="font-weight:bold;">${m.alt}m</span> | ${m.region}<br>
                <div id="${weatherId}" style="min-height:50px; margin-top:8px;"><span style="font-size:0.8em; color:#777;">⏳ 날씨 정보 불러오는 중...</span></div>
                <hr style="margin:10px 0; border:0; border-top:1px solid #ddd;">
                <span style="color:#555; font-size:0.95em;">${m.desc}</span>
            </div>
        `);
        
        popup.on('open', () => fetchWeather(m.lat, m.lng, weatherId));

        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([m.lng, m.lat]).setPopup(popup).addTo(map);
        bindMarkerEditMode(el, marker, m);

        el.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            focusAndRotate(m.lng, m.lat, 13.5, () => {
                if (!marker.getPopup().isOpen()) marker.togglePopup();
            });
        });
        m100Markers.push(marker);
    });
    map.flyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 });
}

function renderChallengeMapAndList() {
    const list = document.getElementById('challengeList'); list.innerHTML = '';
    clearMarkers(challengeMarkers); let climbedCount = 0;

    m100Data.forEach(m => {
        let matchedRecords = allRecords.filter(r => {
            if (r.name.indexOf(m.name) === -1 && m.name.indexOf(r.name) === -1) return false;
            return getDistance(r.lat, r.lng, m.lat, m.lng) < 5000; 
        });
        
        let isClimbed = matchedRecords.length > 0;
        let type = isClimbed ? 'challenge' : 'm100';
        
        const el = createMarkerEl(type, null, !isClimbed);
        const weatherId = 'weather-ch-' + Math.random().toString(36).substr(2, 9);
        
        let popupHtml = '';
        if(isClimbed) {
            matchedRecords.sort((a,b) => new Date(b.date) - new Date(a.date));
            let latest = matchedRecords[0];
            popupHtml = `<div style="text-align:center; min-width:180px;">
                <b style="font-size:1.3em; color:#E65100;">🏆 ${m.name} (완등)</b><br>
                <span style="color:#1565C0; font-size:0.95em; font-weight:bold;">${m.alt}m</span> | <span style="color:#555; font-size:0.9em;">${m.region}</span>
                <div id="${weatherId}" style="min-height:50px; margin-top:8px;"><span style="font-size:0.8em; color:#777;">⏳ 날씨 정보 불러오는 중...</span></div>
                <hr style="margin:10px 0; border:0; border-top:1px solid #ddd;">
                <span style="color:#E65100; font-weight:bold;">최근 등반: ${latest.date}</span>
                <div style="color:#666; font-size:0.85em; margin-top:5px;">${m.desc}</div>
            </div>`;
            climbedCount++;
            
            const li = document.createElement('li'); li.className = 'm100-item';
            li.innerHTML = `<div class="m100-item-content"><div class="m100-name">${m.name} <span style="font-size:0.7em; color:#FF8F00;">🏆</span></div><div class="m100-desc">${m.region} | ${m.alt}m <br>📅 ${latest.date}</div></div>`;
            li.onclick = () => { 
                currentSidebarState = 0; updateSidebarState(); 
                focusAndRotate(m.lng, m.lat, 14, () => {
                    challengeMarkers.forEach(marker => {
                        const lngLat = marker.getLngLat();
                        if (Math.abs(lngLat.lat - m.lat) < 0.0001 && Math.abs(lngLat.lng - m.lng) < 0.0001) {
                            if(!marker.getPopup().isOpen()) marker.togglePopup();
                        }
                    });
                });
            };
            list.appendChild(li);
        } else {
            popupHtml = `<div style="text-align:center; min-width:180px;">
                <b style="font-size:1.3em; color:#1565C0;">🇰🇷 ${m.name}</b><br>
                <span style="font-weight:bold;">${m.alt}m</span> | <span style="color:#555; font-size:0.9em;">${m.region}</span>
                <div id="${weatherId}" style="min-height:50px; margin-top:8px;"><span style="font-size:0.8em; color:#777;">⏳ 날씨 정보 불러오는 중...</span></div>
                <hr style="margin:10px 0; border:0; border-top:1px solid #ddd;">
                <div style="color:#666; font-size:0.9em; margin-bottom:5px;">${m.desc}</div>
                <span style="color:#d32f2f; font-size:0.85em;">아직 등반하지 않은 명산입니다.</span>
            </div>`;
        }
        
        const popup = new mapboxgl.Popup({ offset: [0, -48], anchor: 'bottom', autoPan: false }).setHTML(popupHtml);
        popup.on('open', () => fetchWeather(m.lat, m.lng, weatherId));

        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([m.lng, m.lat]).setPopup(popup).addTo(map);
        bindMarkerEditMode(el, marker, m); 
        
        if (isClimbed) { el.style.zIndex = 1000; }
        
        el.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            focusAndRotate(m.lng, m.lat, 14, () => {
                if (!marker.getPopup().isOpen()) marker.togglePopup();
            }); 
        });
        
        challengeMarkers.push(marker);
    });
    
    document.getElementById('challengeCount').innerText = climbedCount;
    if(climbedCount === 0) { list.innerHTML = `<div style="padding: 40px 20px; text-align:center; color:#777;">아직 완등한 명산이 없습니다.</div>`; }
    map.flyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 });
}

let inlineSearchTimer;
window.handleInlineSearch = function(e) {
    clearTimeout(inlineSearchTimer);
    // API 과부하 막기 (500ms -> 800ms)
    inlineSearchTimer = setTimeout(() => {
        const query = e.target.value.trim(); const resultsUl = document.getElementById('inlineSearchResults');
        if(!query) { resultsUl.style.display = 'none'; return; }
        resultsUl.style.display = 'block'; resultsUl.innerHTML = '<li>검색 중... ⏳</li>';
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&accept-language=ko&limit=5`)
        .then(res => res.json()).then(data => {
            resultsUl.innerHTML = '';
            if(!data || data.length === 0) { resultsUl.innerHTML = '<li style="color:#d32f2f;">결과 없음</li>'; return; }
            data.forEach(place => {
                // XSS 보안 처리 (innerHTML 대신 요소 생성)
                const li = document.createElement('li'); 
                const shortAddress = place.display_name.split(',').slice(1).join(',').trim();
                
                const strong = document.createElement('strong');
                strong.textContent = place.name;
                const span = document.createElement('span');
                span.style.color = '#777'; span.style.fontSize = '0.85em';
                span.textContent = " " + shortAddress;
                
                li.appendChild(strong);
                li.appendChild(span);
                
                li.onclick = () => {
                    document.getElementById('mountainInput').value = place.name;
                    document.getElementById('lat').value = place.lat; document.getElementById('lng').value = place.lon;
                    resultsUl.style.display = 'none';
                    
                    const lon = parseFloat(place.lon); const lat = parseFloat(place.lat);
                    if (tempMarker) tempMarker.remove();
                    const el = createMarkerEl('search');
                    tempMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).addTo(map);
                    focusAndRotate(lon, lat, 14.5);
                }; resultsUl.appendChild(li);
            });
        });
    }, 800);
}

let tabSearchTimer;
window.handleTabSearch = function(e) { 
    clearTimeout(tabSearchTimer); 
    tabSearchTimer = setTimeout(() => { if (e.key === 'Enter' || e.keyCode === 13) { e.preventDefault(); doTabSearch(); } }, 800); 
}

window.doTabSearch = function() {
    const query = document.getElementById('tabSearchInput').value.trim(); const resultsUl = document.getElementById('tabSearchResultsList');
    if(!query) return alert("산 이름을 적어주세요.");
    resultsUl.style.display = 'block'; resultsUl.innerHTML = '<li>조회 중... ⏳</li>';
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&accept-language=ko&limit=10`)
    .then(res => res.json()).then(data => {
        resultsUl.innerHTML = '';
        if (!data || data.length === 0) { resultsUl.innerHTML = '<li style="color:#d32f2f;">결과가 없습니다.</li>'; return; }
        data.forEach(place => {
            // XSS 보안 처리
            const li = document.createElement('li'); 
            const shortAddress = place.display_name.split(',').slice(1).join(',').trim();
            const strong = document.createElement('strong');
            strong.textContent = place.name;
            const span = document.createElement('span');
            span.style.color = '#777'; span.style.fontSize = '0.85em';
            span.textContent = " " + shortAddress;
            li.appendChild(strong);
            li.appendChild(span);
            
            li.onclick = () => {
                if (tempMarker) tempMarker.remove();
                const lon = parseFloat(place.lon); const lat = parseFloat(place.lat);
                let mMatch = m100Data.find(m => place.name.includes(m.name));
                let infoHtml = mMatch ? `<br><span style="color:#1565C0;">${mMatch.alt}m | ${mMatch.region}</span><hr style="margin:5px 0;">${mMatch.desc}` : `<br><span style="color:#777; font-size:0.85em;">${shortAddress}</span>`;
                
                const weatherId = 'weather-sch-' + Math.random().toString(36).substr(2, 9);

                const el = createMarkerEl('search');
                // 팝업 안의 정보는 우리가 통제하는 데이터이므로 innerHTML 유지
                const popup = new mapboxgl.Popup({ offset: [0, -48], anchor: 'bottom', autoPan: false }).setHTML(`
                    <div style="text-align:center;">
                        <b style="font-size:1.2em;">⛰️ ${place.name}</b>
                        ${infoHtml}
                        <div id="${weatherId}" style="min-height:50px; margin-top:8px;"><span style="font-size:0.8em; color:#777;">⏳ 날씨 정보 불러오는 중...</span></div>
                        <br><button onclick="window.prepareSave('${place.name}', ${lat}, ${lon})" style="background:#4CAF50; color:white; border:none; padding:8px 12px; border-radius:5px; font-weight:bold; cursor:pointer;">내 기록에 추가하기</button>
                    </div>
                `);
                
                popup.on('open', () => fetchWeather(lat, lon, weatherId));

                tempMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lon, lat]).setPopup(popup).addTo(map);
                
                resultsUl.style.display = 'none'; 
                currentSidebarState = 0; updateSidebarState(); 
                focusAndRotate(lon, lat, 14.5, () => { tempMarker.togglePopup(); });
            }; resultsUl.appendChild(li);
        });
    });
}

window.prepareSave = function(name, lat, lng) {
    document.getElementById('mountainInput').value = name; 
    document.getElementById('lat').value = lat; document.getElementById('lng').value = lng;
    openTab('tabMyLog'); currentSidebarState = 2; updateSidebarState();
}

let carouselPhotosArr = []; let currentCarouselIndex = 0;
window.openCarousel = function(recordId, startIndex, event) {
    if(event) event.stopPropagation(); 
    const record = allRecords.find(r => r.id === recordId);
    if(!record || !record.photos) return;
    carouselPhotosArr = record.photos; 
    currentCarouselIndex = startIndex; 
    updateCarouselPhoto(); 
    document.getElementById('photoOverlay').style.display = 'flex';
}
window.updateCarouselPhoto = function() {
    document.getElementById('expandedPhoto').src = carouselPhotosArr[currentCarouselIndex]; 
    const indicator = document.getElementById('photoIndicator'); 
    if(indicator) indicator.innerText = (currentCarouselIndex + 1) + " / " + carouselPhotosArr.length; 
    const btnLeft = document.getElementById('photoNavLeft'); const btnRight = document.getElementById('photoNavRight'); 
    if(btnLeft) btnLeft.style.display = currentCarouselIndex > 0 ? 'block' : 'none'; 
    if(btnRight) btnRight.style.display = currentCarouselIndex < carouselPhotosArr.length - 1 ? 'block' : 'none';
}
window.nextPhoto = function(e) { if(e) e.stopPropagation(); if (currentCarouselIndex < carouselPhotosArr.length - 1) { currentCarouselIndex++; updateCarouselPhoto(); } }
window.prevPhoto = function(e) { if(e) e.stopPropagation(); if (currentCarouselIndex > 0) { currentCarouselIndex--; updateCarouselPhoto(); } }
window.closePhotoOverlay = function(e) { if(e) e.stopPropagation(); document.getElementById('photoOverlay').style.display = 'none'; }

let touchStartX = 0; let touchEndX = 0; const photoOverlayEl = document.getElementById('photoOverlay');
photoOverlayEl.addEventListener('touchstart', e => { touchStartX = e.changedTouches[0].screenX; }, {passive: true});
photoOverlayEl.addEventListener('touchend', e => { touchEndX = e.changedTouches[0].screenX; if (touchEndX < touchStartX - 40) window.nextPhoto(); if (touchEndX > touchStartX + 40) window.prevPhoto(); }, {passive: true});
photoOverlayEl.addEventListener('click', e => { if(e.target === photoOverlayEl) window.closePhotoOverlay(); });

// 성능 개선: 사이즈와 화질 대폭 축소 (백업 복원 시 JSON 파일 호환성을 위해 Blob 대신 압축률 조정)
function resizeImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); 
                const maxSize = 400; // 해상도 400px로 제한
                let width = img.width, height = img.height;
                if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; } else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                canvas.width = width; canvas.height = height; canvas.getContext('2d').drawImage(img, 0, 0, width, height); 
                resolve(canvas.toDataURL('image/jpeg', 0.4)); // 화질 40%로 낮춰 메모리 대폭 확보
            }; img.src = e.target.result;
        }; reader.readAsDataURL(file);
    });
}

window.editRecord = function(id, event) {
    if(event) event.stopPropagation(); const record = allRecords.find(r => r.id === id); if(!record) return;
    editingId = id; document.getElementById('mountainInput').value = record.name; document.getElementById('hikeDate').value = record.date; document.getElementById('hikeAlt').value = record.alt !== "정보 없음" ? record.alt : ""; document.getElementById('lat').value = record.lat; document.getElementById('lng').value = record.lng;
    const saveBtn = document.getElementById('mainSaveBtn'); saveBtn.innerText = "🔄 기록 수정 완료"; saveBtn.classList.add('edit-mode');
    
    if (tempMarker) tempMarker.remove(); const el = createMarkerEl('search'); tempMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([record.lng, record.lat]).addTo(map); 
    
    focusAndRotate(record.lng, record.lat, 14.5);
    openTab('tabMyLog'); if(window.innerWidth <= 768) { currentSidebarState = 2; updateSidebarState(); } document.getElementById('sidebarContent').scrollTop = 0; 
}

window.saveRecord = async function() {
    const name = document.getElementById('mountainInput').value || "이름 없는 산", date = document.getElementById('hikeDate').value, alt = document.getElementById('hikeAlt').value || "정보 없음", lat = document.getElementById('lat').value, lng = document.getElementById('lng').value, photoInput = document.getElementById('hikePhoto');
    if (!lat || !lng) return alert("검색을 통해 산 위치를 선택해주세요!"); if (!date) return alert("등산하신 날짜를 골라주세요.");

    const saveBtn = document.getElementById('mainSaveBtn'); saveBtn.innerText = "처리 중... ⏳"; saveBtn.disabled = true;
    let photoUrls = []; if (photoInput.files && photoInput.files.length > 0) { for(let i = 0; i < photoInput.files.length; i++) { photoUrls.push(await resizeImage(photoInput.files[i])); } }

    const store = db.transaction(['hike_records'], 'readwrite').objectStore('hike_records');
    if (editingId) {
        store.get(editingId).onsuccess = function(e) {
            const record = e.target.result; record.name = name; record.date = date; record.alt = alt; record.lat = parseFloat(lat); record.lng = parseFloat(lng);
            if (photoUrls.length > 0) record.photos = photoUrls; store.put(record).onsuccess = resetAndReload;
        };
    } else { store.add({ name, date, alt, lat: parseFloat(lat), lng: parseFloat(lng), photos: photoUrls }).onsuccess = resetAndReload; }

    function resetAndReload() {
        editingId = null; saveBtn.classList.remove('edit-mode');
        document.getElementById('mountainInput').value = ''; document.getElementById('hikeDate').value = ''; document.getElementById('hikeAlt').value = ''; document.getElementById('hikePhoto').value = ''; document.getElementById('lat').value = ''; document.getElementById('lng').value = '';
        if (tempMarker) { tempMarker.remove(); tempMarker = null; }
        saveBtn.innerText = "지도에 내 기록 남기기"; saveBtn.disabled = false; loadSavedRecords(); currentSidebarState = 0; updateSidebarState();
        
        focusAndRotate(parseFloat(lng), parseFloat(lat), 14.5);
    }
}

window.deleteRecord = function(id, event) {
    if(event) event.stopPropagation(); if (!confirm("정말로 이 등산 기록을 삭제하시겠습니까?")) return;
    db.transaction(['hike_records'], 'readwrite').objectStore('hike_records').delete(id).onsuccess = () => { loadSavedRecords(); };
}

window.exportData = function() {
    if(allRecords.length === 0) return alert('백업할 기록이 없습니다.'); const dataStr = JSON.stringify(allRecords); const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr); const linkElement = document.createElement('a'); linkElement.setAttribute('href', dataUri); linkElement.setAttribute('download', `hike_records_backup_${new Date().toISOString().split('T')[0]}.json`); linkElement.click();
}

window.importData = function(event) {
    const file = event.target.files[0]; if(!file) return; const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            if(Array.isArray(importedData)) {
                if(!confirm('기존 데이터베이스를 초기화하고 불러온 데이터로 덮어씁니다. 계속하시겠습니까?')) { event.target.value = ''; return; }
                const store = db.transaction(['hike_records'], 'readwrite').objectStore('hike_records');
                store.clear().onsuccess = () => {
                    let count = 0; if(importedData.length === 0) { loadSavedRecords(); return; }
                    importedData.forEach(item => { delete item.id; store.add(item).onsuccess = () => { count++; if(count === importedData.length) { alert('데이터 복구가 완료되었습니다!'); loadSavedRecords(); } } });
                }
            } else { alert('잘못된 백업 파일 형식입니다.'); }
        } catch(err) { alert('파일을 읽는 중 오류가 발생했습니다. 올바른 JSON 파일인지 확인해주세요.'); }
    }; reader.readAsText(file); event.target.value = ''; 
}