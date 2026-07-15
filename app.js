window.isFlying = false;
let flyTimeout = null;

function safeFlyTo(options) {
    window.isFlying = true;
    map.flyTo(options);
    clearTimeout(flyTimeout);
    flyTimeout = setTimeout(() => { window.isFlying = false; }, (options.duration || 1500) + 100);
}

function safeEaseTo(options) {
    window.isFlying = true;
    map.easeTo(options);
    clearTimeout(flyTimeout);
    flyTimeout = setTimeout(() => { window.isFlying = false; }, (options.duration || 500) + 100);
}

let map;
let myLogMarkers = [], m100Markers = [], challengeMarkers = [];
let tempMarker = null;

// 지도 스타일 관리 변수
let mapMode = 0; // 0: 3D 지형도, 1: 3D 위성도, 2: 2D 지형도
window.lastReplayRoute = null;
window.isReplaying = false;

window.updateMapModeButton = function() {
    const btn = document.getElementById('styleToggleBtn');
    if(!btn) return;
    if (mapMode === 0) {
        btn.innerHTML = '⛰️ 3D 지형도';
        btn.style.color = '#333'; btn.style.borderColor = '#333';
    } else if (mapMode === 1) {
        btn.innerHTML = '🛰️ 3D 위성도';
        btn.style.color = '#1565C0'; btn.style.borderColor = '#1565C0';
    } else if (mapMode === 2) {
        btn.innerHTML = '🗺️ 2D 지형도';
        btn.style.color = '#2E7D32'; btn.style.borderColor = '#2E7D32';
    }
};

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
    if (!window.isMapTouched && !window.isFlying) {
        map.setBearing(map.getBearing() + 0.15);
    }
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
    const padTop = window.innerHeight < 700 ? 180 : 250; 
    return { top: padTop, bottom: padBottom };
}

function focusAndRotate(lng, lat, zoomLvl = 14, callback = null) {
    stopRotate();
    const padding = getMapPadding();
    
    safeFlyTo({ center: [lng, lat], zoom: zoomLvl, pitch: 65, bearing: map.getBearing(), padding: padding, duration: 2500, essential: true });
    
    map.once('moveend', () => { 
        if (!window.isAutoRotating) {
            startRotate(lng, lat); 
        }
        if (callback) callback();
    });
}

function restoreMapLayers() {
    if (window.isTracking && trackRoute && trackRoute.length > 0) {
        if(!map.getSource('trackLine')) map.addSource('trackLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trackRoute } } });
        if(!map.getLayer('trackLineLayer')) map.addLayer({ id: 'trackLineLayer', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#E65100', 'line-width': 5 } });
    }
    if (window.isReplaying && window.lastReplayRoute) {
         if(!map.getSource('replayLine')) map.addSource('replayLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: window.lastReplayRoute } } });
         if(!map.getLayer('replayLineLayer')) map.addLayer({ id: 'replayLineLayer', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#00B0FF', 'line-width': 6, 'line-opacity': 0.8 } });
    }
}

window.toggleMapStyle = function() {
    const prevMode = mapMode;
    mapMode = (mapMode + 1) % 3;
    window.updateMapModeButton();
    
    if (mapMode === 0) {
        if (prevMode === 2) {
            if (!map.getSource('mapbox-dem')) map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 12 });
            map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.1 });
            if (!map.getLayer('sky')) map.addLayer({ 'id': 'sky', 'type': 'sky', 'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 } });
            map.easeTo({ pitch: 45, duration: 1000 });
        } else {
            map.setStyle('mapbox://styles/mapbox/outdoors-v12');
        }
    } else if (mapMode === 1) {
        map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
    } else {
        if (prevMode === 1) {
            map.setStyle('mapbox://styles/mapbox/outdoors-v12');
            map.once('style.load', () => {
                map.easeTo({ pitch: 0, duration: 1000 });
            });
        } else {
            map.setTerrain(null);
            if (map.getLayer('sky')) map.removeLayer('sky');
            map.easeTo({ pitch: 0, duration: 1000 });
        }
    }
};

let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (err) { console.error("WakeLock Fail:", err); }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window.isTracking && !window.isPaused) {
        requestWakeLock();
    }
});

window.isMapTouched = false; 

document.addEventListener('DOMContentLoaded', () => {
    mapboxgl.accessToken = 'pk.eyJ1Ijoic2FtZDIwMDAiLCJhIjoiY21yYmp1OG41MXV0bzMwczliZjk5enNjaSJ9.yb9rTbbR-mme-SZ89CTK1Q';
    
    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: [128.0, 36.0], 
        zoom: window.innerWidth <= 768 ? 5.3 : 5.8,
        pitch: 45,
        bearing: 0, 
        projection: 'mercator', 
        doubleClickZoom: false
    });

    mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js');
    map.addControl(new MapboxLanguage({ defaultLanguage: 'ko' }));

    map.on('style.load', () => {
        if (mapMode === 0 || mapMode === 1) {
            if (!map.getSource('mapbox-dem')) {
                map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 12 });
            }
            map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.1 });
            if (!map.getLayer('sky')) {
                map.addLayer({ 'id': 'sky', 'type': 'sky', 'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 } });
            }
        } else {
            map.setTerrain(null);
            if (map.getLayer('sky')) map.removeLayer('sky');
        }
        restoreMapLayers();
    });

    // 💡 9번 요청: 나침반과 GPS 버튼을 사용자 이미자와 동일하게 '크고 둥글게' 재적용
    const nav = new mapboxgl.NavigationControl({ showZoom: false, showCompass: true });
    map.addControl(nav, 'top-right');

    const geolocate = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true, 
        showUserHeading: true,
        fitBoundsOptions: { maxZoom: 14.5, duration: 1500 } 
    });
    map.addControl(geolocate, 'top-right');

    const style = document.createElement('style');
    style.innerHTML = `
        /* 우상단 버튼 크기 및 위치 (이미지처럼 크고 둥글게 복구) */
        .mapboxgl-ctrl-top-right { top: max(15px, env(safe-area-inset-top)) !important; right: 15px !important; display: flex !important; flex-direction: column !important; gap: 15px !important; }
        .mapboxgl-ctrl-top-right .mapboxgl-ctrl { margin: 0 !important; } 
        .mapboxgl-ctrl-group { border-radius: 50% !important; box-shadow: 0 4px 15px rgba(0,0,0,0.2) !important; background: white !important; overflow: hidden !important; }
        .mapboxgl-ctrl-group > button { width: 50px !important; height: 50px !important; display: flex !important; justify-content: center !important; align-items: center !important; }
        .mapboxgl-ctrl-icon { transform: scale(1.5); } 
        
        /* 나침반 터치 실드 및 붉은색 화살표 */
        .compass-touch-shield { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 9999; cursor: pointer; }
        .mapboxgl-ctrl-compass .mapboxgl-ctrl-icon { background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 3 l3 7 -3 -1.5 -3 1.5 z' fill='%23D32F2F'/%3E%3Cpath d='M10 17 l3 -7 -3 1.5 -3 -1.5 z' fill='%23999999'/%3E%3C/svg%3E") !important; }
        
        /* 사진 팝업 닫기 버튼 설정 */
        #photoOverlay span[onclick*="close"], #photoOverlay .close, .close-photo {
            position: absolute !important; top: auto !important; bottom: max(40px, calc(env(safe-area-inset-bottom) + 30px)) !important; 
            left: 50% !important; transform: translateX(-50%) !important; font-size: 32px !important; width: 65px !important; height: 65px !important; 
            background: rgba(0,0,0,0.85) !important; color: #fff !important; border-radius: 50% !important; z-index: 999999 !important;
            display: flex !important; justify-content: center !important; align-items: center !important; box-shadow: 0 4px 15px rgba(0,0,0,0.6) !important; line-height: 1 !important; cursor: pointer !important; text-shadow: none !important;
        }
        #expandedPhoto { will-change: transform; transform-origin: center center; }
    `;
    document.head.appendChild(style);

    window.isAutoRotating = false; 
    let isSensorGranted = false;
    let currentHeading = 0; let targetHeading = null;

    let tapCount = 0; let tapTimer = null;
    document.getElementById('map').addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) return;
        window.isMapTouched = true;
        tapCount++;
        if (tapCount === 2) {
            if (window.isTracking) {
                e.preventDefault();
                if (document.body.classList.contains('ui-hidden')) {
                    document.body.classList.remove('ui-hidden');
                    document.getElementById('trackingHUD').style.display = 'none';
                    currentSidebarState = 1; updateSidebarState(); 
                } else {
                    document.body.classList.add('ui-hidden');
                    document.getElementById('trackingHUD').style.display = 'block';
                    currentSidebarState = -1; updateSidebarState(); 
                }
                tapCount = 0; clearTimeout(tapTimer);
            } else {
                clearTimeout(tapTimer);
                tapTimer = setTimeout(() => { tapCount = 0; }, 300);
            }
        } else if (tapCount === 3) {
            e.preventDefault();
            if(window.isReplaying) window.exitReplay();
            else resetMapToDefault();
            tapCount = 0; clearTimeout(tapTimer);
        } else {
            clearTimeout(tapTimer); 
            tapTimer = setTimeout(() => { tapCount = 0; }, 400);
        }
    }, {passive: false});
    
    document.getElementById('map').addEventListener('touchend', () => { setTimeout(() => { window.isMapTouched = false; }, 1000); }, {passive: true});

    let clickCount = 0; let clickTimer = null;
    map.on('click', function(e) {
        clickCount++;
        if (clickCount === 2) {
            if (window.isTracking) {
                if (document.body.classList.contains('ui-hidden')) {
                    document.body.classList.remove('ui-hidden');
                    document.getElementById('trackingHUD').style.display = 'none';
                    currentSidebarState = 1; updateSidebarState();
                } else {
                    document.body.classList.add('ui-hidden');
                    document.getElementById('trackingHUD').style.display = 'block';
                    currentSidebarState = -1; updateSidebarState();
                }
                clickCount = 0; clearTimeout(clickTimer);
            } else {
                clearTimeout(clickTimer);
                clickTimer = setTimeout(() => { clickCount = 0; }, 300);
            }
        } else if (clickCount === 3) {
            if(window.isReplaying) window.exitReplay();
            else resetMapToDefault();
            clickCount = 0; clearTimeout(clickTimer);
        } else {
            clearTimeout(clickTimer); clickTimer = setTimeout(() => { clickCount = 0; }, 400);
        }
    });

    function smoothRotateLoop() {
        if (window.isAutoRotating && !window.isMapTouched && !window.isFlying && targetHeading !== null) {
            let diff = targetHeading - currentHeading;
            while (diff < -180) diff += 360;
            while (diff > 180) diff -= 360;

            if (Math.abs(diff) > 0.2) {
                currentHeading += diff * 0.08; 
                map.jumpTo({ bearing: currentHeading });
            }
        }
        requestAnimationFrame(smoothRotateLoop);
    }
    smoothRotateLoop(); 

    function handleOrientation(e) {
        if (!window.isAutoRotating) return; 
        if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
            targetHeading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
            targetHeading = 360 - e.alpha;
        }
    }

    setTimeout(() => {
        const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
        if (compassBtn) {
            const shield = document.createElement('div');
            shield.className = 'compass-touch-shield';
            compassBtn.appendChild(shield);

            const toggleCompassMode = async (e) => {
                e.stopPropagation(); e.preventDefault();

                if (window.isAutoRotating) {
                    window.isAutoRotating = false;
                    compassBtn.classList.remove('is-rotating'); 
                    safeEaseTo({ bearing: 0, duration: 800 });
                } else {
                    if (!isSensorGranted) {
                        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                            try {
                                const permission = await DeviceOrientationEvent.requestPermission();
                                if (permission === 'granted') {
                                    isSensorGranted = true;
                                    window.addEventListener('deviceorientation', handleOrientation, true);
                                } else { alert("❌ 센서 권한이 거부되었습니다."); return; }
                            } catch (err) { alert("❌ 센서 차단됨: " + err.message); return; }
                        } else { isSensorGranted = true; window.addEventListener('deviceorientation', handleOrientation, true); }
                    }
                    window.isAutoRotating = true;
                    compassBtn.classList.add('is-rotating'); 
                }
            };
            shield.addEventListener('click', toggleCompassMode);
        }

        const gpsBtn = document.querySelector('.mapboxgl-ctrl-geolocate');
        if (gpsBtn) {
            gpsBtn.addEventListener('click', () => {
                stopRotate(); 
                window.isAutoRotating = false; 
                const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
                if(compassBtn) compassBtn.classList.remove('is-rotating');
                
                window.isFlying = true;
                clearTimeout(flyTimeout);
                flyTimeout = setTimeout(() => { window.isFlying = false; }, 1600); 
            });
        }
    }, 1000);

    initFABs(); initDB(); initM100List();
    window.updateMapModeButton(); 
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
    window.isAutoRotating = false;
    const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
    if (compassBtn) compassBtn.classList.remove('is-rotating');
    
    const gpsBtn = document.querySelector('.mapboxgl-ctrl-geolocate');
    if (gpsBtn && (gpsBtn.classList.contains('mapboxgl-ctrl-geolocate-active') || gpsBtn.classList.contains('mapboxgl-ctrl-geolocate-background'))) {
        gpsBtn.click(); 
    }

    safeFlyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: {bottom: 0}, duration: 1500 });
    
    currentSidebarState = -1; updateSidebarState();
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove();
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    if(map.getSource('replayLine')) map.removeLayer('replayLineLayer').removeSource('replayLine');
    if(map.getSource('replayPoint')) map.removeLayer('replayPointLayer').removeSource('replayPoint');
    if(map.getSource('myLogRoute')) map.removeLayer('myLogRouteLayer').removeSource('myLogRoute');
    if(window.replayMarkers) { window.replayMarkers.forEach(m => m.remove()); window.replayMarkers = []; }
}

const sidebar = document.getElementById('sidebar'), handleDrag = document.getElementById('dragHandle'), dragText = document.querySelector('.drag-text');
let currentSidebarState = -1; const states = ['collapsed', 'half', 'full']; let isHandleDragging = false; let startY = 0;

if (handleDrag) {
    handleDrag.addEventListener('pointerdown', e => { isHandleDragging = true; startY = e.clientY; handleDrag.setPointerCapture(e.pointerId); });
    handleDrag.addEventListener('pointermove', e => { if(isHandleDragging) e.preventDefault(); }); 
    handleDrag.addEventListener('pointerup', e => {
        if(!isHandleDragging) return; isHandleDragging = false; handleDrag.releasePointerCapture(e.pointerId);
        const diff = startY - e.clientY; 
        const isTrackTab = document.getElementById('tabTracking').classList.contains('active');
        const minState = isTrackTab ? 1 : 0; 
        if (Math.abs(diff) > 40) { 
            if (diff > 0) { if (currentSidebarState < 2) currentSidebarState++; } 
            else { if (currentSidebarState > minState) currentSidebarState--; } 
        } else { 
            if (currentSidebarState === 0) currentSidebarState = 1; 
            else if (currentSidebarState === 1) currentSidebarState = 2; 
            else if (currentSidebarState === 2) currentSidebarState = minState; 
        }
        updateSidebarState();
    });
    handleDrag.addEventListener('wheel', e => { 
        e.preventDefault(); 
        const isTrackTab = document.getElementById('tabTracking').classList.contains('active');
        const minState = isTrackTab ? 1 : 0;
        if (e.deltaY > 0) { if (currentSidebarState > minState) currentSidebarState--; } 
        else if (e.deltaY < 0) { if (currentSidebarState < 2) currentSidebarState++; } 
        updateSidebarState(); 
    }, {passive: false});
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
    if(isRotating && targetCenter) { safeEaseTo({ center: targetCenter, padding: getMapPadding(), duration: 500 }); }
}

function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); 
    document.getElementById(tabId).classList.add('active');
    
    if (tabId === 'tabSearch' || tabId === 'tabTracking') { currentSidebarState = 1; } 
    else { if (currentSidebarState === -1) currentSidebarState = 0; }
    updateSidebarState();
    
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove(); stopRotate();
    if(map.getSource('myLogRoute')) map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    
    if(tabId === 'tabChallenge') { renderChallengeMapAndList(); } 
    else if (tabId === 'tabM100') { renderM100Map(); } 
    else if (tabId === 'tabMyLog') { renderAll(); safeFlyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 }); } 
    else if (tabId === 'tabSearch') { safeFlyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 }); }
}

function initFABs() {
    setupDraggableFab(document.getElementById('myLogFab'), document.getElementById('myLogWidget'), () => openTab('tabMyLog'));
    setupDraggableFab(document.getElementById('m100Fab'), document.getElementById('m100Widget'), () => openTab('tabM100'));
    setupDraggableFab(document.getElementById('challengeFab'), document.getElementById('challengeWidget'), () => openTab('tabChallenge'));
    setupDraggableFab(document.getElementById('searchFab'), document.getElementById('searchWidget'), () => openTab('tabSearch'));
    setupDraggableFab(document.getElementById('trackFab'), document.getElementById('trackWidget'), () => window.prepareTracking());
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
        setTimeout(window.renderTrackHistory, 500);
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

window.showFullPhoto = function(url) {
    document.getElementById('expandedPhoto').src = url;
    document.getElementById('photoOverlay').style.display = 'flex';
}
window.closePhotoOverlay = function() { document.getElementById('photoOverlay').style.display = 'none'; }

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
        
        let carouselCounter = 0;
        group.climbs.forEach(c => {
            popupContent += `<div style="font-size:0.9em; margin-bottom:5px; color:#555;">📅 ${c.date}</div>`;
            
            if (c.photos && c.photos.length > 0) {
                const cId = `carousel_${group.key.replace('.','_').replace(',','_')}_${carouselCounter++}`;
                popupContent += `<div class="carousel" id="${cId}"><div class="carousel-inner" id="inner_${cId}">`;
                c.photos.forEach(url => { 
                    popupContent += `<div class="carousel-item"><img src="${url}" onclick="window.showFullPhoto('${url}')"></div>`; 
                });
                popupContent += `</div>`;
                if (c.photos.length > 1) {
                    popupContent += `<div class="carousel-dots" id="dots_${cId}">`;
                    c.photos.forEach((_, idx) => { popupContent += `<div class="carousel-dot ${idx===0 ? 'active' : ''}"></div>`; });
                    popupContent += `</div>`;
                }
                popupContent += `</div>`;
            }
        });
        popupContent += `</div>`;
        
        const popup = new mapboxgl.Popup({ offset: [0, -48], anchor: 'bottom', autoPan: false }).setHTML(popupContent);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([group.lng, group.lat]).setPopup(popup).addTo(map);

        popup.on('open', () => {
            setTimeout(() => {
                const popNode = popup.getElement();
                const carousels = popNode.querySelectorAll('.carousel-inner');
                carousels.forEach(inner => {
                    const dotsId = inner.id.replace('inner_', 'dots_');
                    const dotsContainer = document.getElementById(dotsId);
                    if(dotsContainer) {
                        inner.addEventListener('scroll', () => {
                            const idx = Math.round(inner.scrollLeft / inner.clientWidth);
                            Array.from(dotsContainer.children).forEach((dot, i) => {
                                dot.className = i === idx ? 'carousel-dot active' : 'carousel-dot';
                            });
                        });
                    }
                });
            }, 50);
            
            const hasRoute = group.climbs.some(c => c.route && c.route.length > 0);
            if (hasRoute) {
                const firstRoute = group.climbs.find(c => c.route && c.route.length > 0).route;
                if(map.getSource('myLogRoute')) map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: firstRoute } });
                else {
                    map.addSource('myLogRoute', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: firstRoute } } });
                    map.addLayer({ id: 'myLogRouteLayer', type: 'line', source: 'myLogRoute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4CAF50', 'line-width': 5, 'line-opacity': 0.8 } });
                }
            }
        });

        popup.on('close', () => {
            const label = el.querySelector('.mountain-label');
            if(label) label.style.display = 'block';
            if(map.getSource('myLogRoute')) map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
        });

        el.addEventListener('click', (e) => { 
            e.stopPropagation(); 
            const label = el.querySelector('.mountain-label');
            if(label) label.style.display = 'none'; 
            focusAndRotate(group.lng, group.lat, 14.5, () => {
                if (!marker.getPopup().isOpen()) marker.togglePopup();
            });
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
    safeFlyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 });
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
    safeFlyTo({ center: [128.0, 36.0], zoom: window.innerWidth <= 768 ? 5.3 : 5.8, pitch: 45, bearing: 0, padding: getMapPadding(), duration: 1500 });
}

let inlineSearchTimer;
window.handleInlineSearch = function(e) {
    clearTimeout(inlineSearchTimer);
    inlineSearchTimer = setTimeout(() => {
        const query = e.target.value.trim(); const resultsUl = document.getElementById('inlineSearchResults');
        if(!query) { resultsUl.style.display = 'none'; return; }
        resultsUl.style.display = 'block'; resultsUl.innerHTML = '<li>검색 중... ⏳</li>';
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&accept-language=ko&limit=5`)
        .then(res => res.json()).then(data => {
            resultsUl.innerHTML = '';
            if(!data || data.length === 0) { resultsUl.innerHTML = '<li style="color:#d32f2f;">결과 없음</li>'; return; }
            data.forEach(place => {
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

function resizeImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = (e) => {
            const img = new Image(); img.onload = () => {
                const canvas = document.createElement('canvas'); 
                const maxSize = 250; 
                let width = img.width, height = img.height;
                if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; } 
                else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                
                canvas.width = width; canvas.height = height; 
                canvas.getContext('2d').drawImage(img, 0, 0, width, height); 
                resolve(canvas.toDataURL('image/jpeg', 0.35)); 
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

// --------------------------------------------------------
// --- 실시간 등산 트래킹 로직 ---
// --------------------------------------------------------
let trackingWatchId = null;
window.isTracking = false;
window.isPaused = false;
let trackStartTime = 0;
let trackTimerInterval = null;
let elapsedSeconds = 0;

let trackRoute = []; 
let trackDistance = 0; 
let trackPhotos = []; 

window.prepareTracking = function() {
    openTab('tabTracking');
    
    const toggleBtn = document.getElementById('styleToggleBtn');
    if (mapMode === 0) {
        toggleBtn.click(); 
        setTimeout(() => {
            if(mapMode === 1) toggleBtn.click(); 
        }, 400); 
    } else if (mapMode === 1) {
        toggleBtn.click(); 
    } else {
        map.easeTo({ pitch: 0, bearing: 0, duration: 1000 }); 
    }
    
    currentSidebarState = 1; 
    updateSidebarState();

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(pos => {
            stopRotate();
            setTimeout(() => { 
                safeFlyTo({
                    center: [pos.coords.longitude, pos.coords.latitude],
                    zoom: 15.5,
                    pitch: 0, 
                    bearing: 0,
                    padding: getMapPadding(),
                    duration: 1500
                });
            }, 500);
        }, err => console.log("GPS Error", err), { enableHighAccuracy: true });
    }
}

window.startHikingTrack = async function() {
    if (!navigator.geolocation) return alert("GPS를 지원하지 않는 기기입니다.");
    
    window.isTracking = true; 
    window.isPaused = false;
    
    if (elapsedSeconds === 0) {
        trackRoute = []; trackDistance = 0; trackPhotos = [];
    }
    
    document.getElementById('btnTrackStart').style.display = 'none';
    document.getElementById('activeTrackControls').style.display = 'flex';
    document.getElementById('btnTrackPause').innerText = "⏸️ 휴식";
    document.getElementById('btnTrackPause').style.background = "#FBC02D";
    document.getElementById('btnTrackPause').style.color = "#333";
    
    document.body.classList.add('ui-hidden');
    document.getElementById('trackingHUD').style.display = 'block';
    currentSidebarState = -1;
    updateSidebarState();

    requestWakeLock();

    if (!trackTimerInterval) {
        trackStartTime = Date.now();
        trackTimerInterval = setInterval(updateTrackUI, 1000);
    }

    if(!map.getSource('trackLine')) {
        map.addSource('trackLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
        map.addLayer({ id: 'trackLineLayer', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#E65100', 'line-width': 5 } });
    }

    if (!trackingWatchId) {
        trackingWatchId = navigator.geolocation.watchPosition(pos => {
            if (window.isPaused) return;
            
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;
            const alt = Math.round(pos.coords.altitude || 0);
            const speed = ((pos.coords.speed || 0) * 3.6).toFixed(1);
            
            document.getElementById('trackAlt').innerText = alt;
            document.getElementById('hudAlt').innerText = alt;
            document.getElementById('trackSpeed').innerText = speed;
            document.getElementById('hudSpeed').innerText = speed;

            if (trackRoute.length > 0) {
                const lastCoord = trackRoute[trackRoute.length - 1];
                const dist = getDistance(lastCoord[1], lastCoord[0], lat, lng) / 1000; 
                if (dist > 0.005) { 
                    trackDistance += dist;
                    document.getElementById('trackDist').innerText = trackDistance.toFixed(2);
                    document.getElementById('hudDist').innerText = trackDistance.toFixed(2);
                    
                    trackRoute.push([lng, lat, alt]); 
                    map.getSource('trackLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: trackRoute } });
                }
            } else {
                trackRoute.push([lng, lat, alt]);
            }
            
            if(!window.isMapTouched) safeEaseTo({ center: [lng, lat], pitch: 0, duration: 1000 });
            
        }, err => console.log(err), { enableHighAccuracy: true, maximumAge: 3000 });
    }
}

window.togglePauseTrack = function() {
    window.isPaused = !window.isPaused;
    const btn = document.getElementById('btnTrackPause');
    if (window.isPaused) {
        btn.innerText = "▶️ 다시 출발";
        btn.style.background = "#4CAF50";
        btn.style.color = "white";
        
        document.body.classList.remove('ui-hidden');
        document.getElementById('trackingHUD').style.display = 'none';
        currentSidebarState = 1; 
        updateSidebarState();
    } else {
        btn.innerText = "⏸️ 휴식";
        btn.style.background = "#FBC02D";
        btn.style.color = "#333";
        
        document.body.classList.add('ui-hidden');
        document.getElementById('trackingHUD').style.display = 'block';
        currentSidebarState = -1;
        updateSidebarState();
    }
}

window.captureTrackPhoto = async function(e) {
    const file = e.target.files[0];
    if(!file) return;
    
    const resizedUrl = await resizeImage(file);
    if (trackRoute.length > 0) {
        const currentLoc = trackRoute[trackRoute.length - 1];
        trackPhotos.push({ coords: currentLoc, url: resizedUrl });
        
        const el = document.createElement('div');
        el.innerHTML = '📸'; el.style.fontSize = '24px'; el.style.cursor = 'pointer'; el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
        new mapboxgl.Marker(el).setLngLat(currentLoc).addTo(map);
        alert("사진이 현재 위치에 기록되었습니다!");
    }
}

window.stopHikingTrack = function() {
    if (!confirm("등산을 종료하고 기록을 저장하시겠습니까?")) return;
    
    if (trackingWatchId) navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
    
    if (trackTimerInterval) clearInterval(trackTimerInterval);
    trackTimerInterval = null;
    
    if(wakeLock) { wakeLock.release(); wakeLock = null; }

    document.getElementById('btnTrackStart').style.display = 'block';
    document.getElementById('activeTrackControls').style.display = 'none';
    
    window.isTracking = false;
    window.isPaused = false;
    
    document.body.classList.remove('ui-hidden');
    document.getElementById('trackingHUD').style.display = 'none';
    
    currentSidebarState = 2;
    updateSidebarState();

    const mName = prompt("이 산의 이름을 적어주세요!", "이름 없는 산") || "이름 없는 산";
    const finalTime = document.getElementById('trackTime').innerText;
    const today = new Date().toISOString().split('T')[0];
    const maxAlt = document.getElementById('trackAlt').innerText;
    
    const photosOnly = trackPhotos.map(p => p.url);
    let maxAltPoint = trackRoute.length > 0 ? trackRoute[0] : [128.0, 36.0, 0];
    trackRoute.forEach(pt => { if(pt[2] && pt[2] > maxAltPoint[2]) maxAltPoint = pt; });

    const store = db.transaction(['hike_records'], 'readwrite').objectStore('hike_records');
    store.add({ 
        name: mName, date: today, alt: maxAlt, 
        lat: maxAltPoint[1], 
        lng: maxAltPoint[0], 
        photos: photosOnly, 
        photoData: trackPhotos, 
        route: trackRoute, 
        time: finalTime,
        distance: trackDistance.toFixed(2)
    }).onsuccess = () => {
        alert("내 기록에 자동 저장되었습니다!");
        loadSavedRecords(); 
        
        elapsedSeconds = 0;
        document.getElementById('trackTime').innerText = "00:00:00";
        document.getElementById('hudTime').innerText = "00:00:00";
    };
}

function updateTrackUI() {
    if(window.isPaused) return; 
    elapsedSeconds++;
    const h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(elapsedSeconds % 60).padStart(2, '0');
    
    const timeStr = `${h}:${m}:${s}`;
    document.getElementById('trackTime').innerText = timeStr;
    document.getElementById('hudTime').innerText = timeStr;
}

window.renderTrackHistory = function() {
    const listEl = document.getElementById('trackHistoryList');
    if(!listEl) return;
    listEl.innerHTML = '';
    const tracks = allRecords.filter(r => r.route && r.route.length > 0);
    
    if(tracks.length === 0) { listEl.innerHTML = "<p style='text-align:center; color:#999; padding: 20px;'>트래킹 기록이 없습니다.</p>"; return; }
    
    tracks.forEach(t => {
        const div = document.createElement('div');
        div.className = 'record-card';
        div.innerHTML = `
            <div class="action-btns" style="z-index: 10;">
                <button class="delete-btn" onclick="deleteRecord(${t.id}, event)">삭제</button>
            </div>
            <h4>⛰️ ${t.name} <small>(${t.distance}km / ${t.time})</small></h4><p>📅 ${t.date}</p>
        `;
        div.onclick = () => window.replayRoute(t.route, t);
        listEl.appendChild(div);
    });
}

window.exitReplay = function() {
    window.isReplaying = false;
    const banner = document.getElementById('replayBanner');
    if (banner) banner.style.display = 'none';
    if(map.getSource('replayLine')) map.removeLayer('replayLineLayer').removeSource('replayLine');
    if(map.getSource('replayPoint')) map.removeLayer('replayPointLayer').removeSource('replayPoint');
    if(window.replayMarkers) { window.replayMarkers.forEach(m => m.remove()); window.replayMarkers = []; }
    resetMapToDefault();
}

window.replayRoute = function(routeArray, record) {
    if(!routeArray || routeArray.length < 2) return alert("동선 데이터가 부족합니다.");
    window.lastReplayRoute = routeArray;
    window.isReplaying = true;
    
    let banner = document.getElementById('replayBanner');
    if(!banner) {
        banner = document.createElement('div'); banner.id = 'replayBanner'; document.body.appendChild(banner);
    }
    banner.style.display = 'flex';
    banner.innerHTML = `
        <div style="flex:1; text-align:left;">
            <b style="color:#FFD54F; font-size:1.1em;">🏃‍♂️ ${record.name}</b><br>
            <span style="font-size:0.9em;">거리: ${record.distance}km | 시간: ${record.time} | 최고: ${record.alt}m</span>
        </div>
        <button onclick="window.exitReplay()" style="background:#D32F2F;color:white;border:none;border-radius:8px;padding:8px 12px;font-weight:bold;margin-left:10px;">종료</button>
    `;

    const toggleBtn = document.getElementById('styleToggleBtn');
    if(mapMode === 0) { toggleBtn.click(); } 
    else if(mapMode === 2) { toggleBtn.click(); setTimeout(() => { if(mapMode===0) toggleBtn.click(); }, 400); }
    
    if(map.getSource('replayLine')) map.removeLayer('replayLineLayer').removeSource('replayLine');
    if(map.getSource('replayPoint')) map.removeLayer('replayPointLayer').removeSource('replayPoint');

    map.addSource('replayLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
    map.addLayer({ id: 'replayLineLayer', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#E65100', 'line-width': 6, 'line-opacity': 0.8 } });

    map.addSource('replayPoint', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: routeArray[0] } } });
    map.addLayer({
        id: 'replayPointLayer', type: 'circle', source: 'replayPoint',
        paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#E65100' }
    });

    window.replayMarkers = [];
    if(record.photoData && record.photoData.length > 0) {
        record.photoData.forEach(pd => {
            const el = document.createElement('div');
            el.innerHTML = '📸'; el.style.fontSize = '24px'; el.style.cursor = 'pointer'; el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
            const marker = new mapboxgl.Marker({ element: el }).setLngLat(pd.coords).addTo(map);
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                window.showFullPhoto(pd.url);
            });
            window.replayMarkers.push(marker);
        });
    }

    currentSidebarState = -1; updateSidebarState();
    
    let currentIdx = 0;
    let isPaused = false;
    
    safeFlyTo({ center: routeArray[0], zoom: 15.5, pitch: 60, bearing: 0, duration: 2000 });
    
    setTimeout(() => {
        let lastTime = performance.now();
        let currentBearing = map.getBearing();

        function animateFrame(time) {
            if (!window.isReplaying) return;
            if (isPaused) {
                requestAnimationFrame(animateFrame);
                return;
            }

            const dt = time - lastTime;
            if (dt > 40) { 
                lastTime = time;
                currentIdx += Math.max(1, Math.floor(routeArray.length / 300)); 

                if (currentIdx >= routeArray.length) {
                    const bounds = routeArray.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(routeArray[0], routeArray[0]));
                    map.fitBounds(bounds, { padding: {top: 100, bottom: 50, left: 50, right: 50}, pitch: 0, bearing: 0, duration: 2500 });
                    
                    map.getSource('replayLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: routeArray } });
                    map.getSource('replayPoint').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: routeArray[routeArray.length-1] } });
                    return;
                }

                const targetCoord = routeArray[currentIdx];
                map.getSource('replayLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: routeArray.slice(0, currentIdx+1) } });
                map.getSource('replayPoint').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: targetCoord } });

                const lookAheadIdx = Math.min(currentIdx + 15, routeArray.length - 1);
                const targetBearing = turf.bearing(turf.point(targetCoord), turf.point(routeArray[lookAheadIdx]));
                
                let bearingDiff = targetBearing - currentBearing;
                if (bearingDiff > 180) bearingDiff -= 360;
                if (bearingDiff < -180) bearingDiff += 360;
                currentBearing += bearingDiff * 0.08; 

                map.easeTo({
                    center: targetCoord,
                    pitch: 65,
                    bearing: currentBearing,
                    zoom: 15.8,
                    duration: 50,
                    easing: t => t
                });

                if (record.photoData && record.photoData.length > 0) {
                    for (let pIdx = 0; pIdx < record.photoData.length; pIdx++) {
                        const photo = record.photoData[pIdx];
                        if (!photo.shown && getDistance(targetCoord[1], targetCoord[0], photo.coords[1], photo.coords[0]) < 20) {
                            photo.shown = true;
                            isPaused = true;
                            
                            map.easeTo({ center: photo.coords, zoom: 17, pitch: 40, duration: 1000 });
                            
                            setTimeout(() => {
                                const imgPopup = document.createElement('img');
                                imgPopup.src = photo.url;
                                imgPopup.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) scale(0.5); opacity:0; z-index:10005; border-radius:15px; box-shadow:0 10px 30px rgba(0,0,0,0.8); max-width:85%; max-height:65%; transition:all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); object-fit:contain; background:#000;';
                                document.body.appendChild(imgPopup);

                                requestAnimationFrame(() => {
                                    imgPopup.style.transform = 'translate(-50%, -50%) scale(1)';
                                    imgPopup.style.opacity = '1';
                                });

                                setTimeout(() => {
                                    imgPopup.style.transform = 'translate(-50%, -50%) scale(0.5)';
                                    imgPopup.style.opacity = '0';
                                    setTimeout(() => {
                                        imgPopup.remove();
                                        isPaused = false;
                                    }, 500);
                                }, 2500); 
                            }, 1000);
                            break;
                        }
                    }
                }
            }
            requestAnimationFrame(animateFrame);
        }
        
        if(record.photoData) record.photoData.forEach(p => p.shown = false);
        requestAnimationFrame(animateFrame);
    }, 2000);
}