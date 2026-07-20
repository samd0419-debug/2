
window.isFlying = false;
let flyTimeout = null;
window.geolocateControl = null;

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

function lerp(start, end, amt) {
    return (1 - amt) * start + amt * end;
}

let map;
let myLogMarkers = [], m100Markers = [], challengeMarkers = [];
let tempMarker = null;

let mapMode = 0; 
window.isRotationPausedByUser = false; 

// 전역 방위각 제어 변수들
window.isAutoRotating = false; 
window.isSensorGranted = false;
let currentHeading = 0; let targetHeading = null;

window.handleOrientation = function(e) {
    if (!window.isAutoRotating) return; 
    if (e.webkitCompassHeading !== undefined && e.webkitCompassHeading !== null) {
        targetHeading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
        targetHeading = 360 - e.alpha;
    }
}

// 💡 2D 전환 시 한글을 강제 적용하는 로직 대폭 강화
function applyMapStyleFeatures() {
    const layers = map.getStyle().layers;
    if (layers) {
        layers.forEach((layer) => {
            if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
                try {
                    // 어떤 모드든 한글(name_ko)을 무조건 1순위로 강제 지정
                    map.setLayoutProperty(layer.id, 'text-field', [
                        'coalesce',
                        ['get', 'name_ko'], 
                        ['get', 'name_en'],
                        ['get', 'name']     
                    ]);
                } catch (e) {}
            }
        });
    }

    if (mapMode === 0 || mapMode === 1) {
        if (!map.getSource('mapbox-dem')) {
            map.addSource('mapbox-dem', { 'type': 'raster-dem', 'url': 'mapbox://mapbox.mapbox-terrain-dem-v1', 'tileSize': 512, 'maxzoom': 14 });
        }
        map.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.8 }); 
        if (!map.getLayer('sky')) {
            map.addLayer({ 'id': 'sky', 'type': 'sky', 'paint': { 'sky-type': 'atmosphere', 'sky-atmosphere-sun': [0.0, 0.0], 'sky-atmosphere-sun-intensity': 15 } });
        }
    } else {
        map.setTerrain(null);
        if (map.getLayer('sky')) map.removeLayer('sky');
    }
    restoreMapLayers();
}

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

window.toggleMapStyle = function() {
    const prevMode = mapMode;
    mapMode = (mapMode + 1) % 3;
    window.updateMapModeButton();

    // 💡 현재 줌 레벨을 변수에 저장
    const currentZoom = map.getZoom();

    if (mapMode === 0) { // 3D 지형도
        if (prevMode === 2) {
            applyMapStyleFeatures();
            // 💡 zoom: currentZoom 추가
            map.easeTo({ pitch: 40, zoom: currentZoom, duration: 1000 });
        } else {
            map.setStyle('mapbox://styles/mapbox/outdoors-v12');
            map.once('style.load', () => { applyMapStyleFeatures(); map.easeTo({ pitch: 40, zoom: currentZoom, duration: 1000 }); });
        }
    } else if (mapMode === 1) { // 3D 위성도
        map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
        map.once('style.load', () => { applyMapStyleFeatures(); map.easeTo({ pitch: 40, zoom: currentZoom, duration: 1000 }); });
    } else if (mapMode === 2) { // 2D 지형도
        if (prevMode === 0) {
            applyMapStyleFeatures();
            // 💡 zoom: currentZoom 추가
            map.easeTo({ pitch: 0, zoom: currentZoom, duration: 1000 });
        } else {
            map.setStyle('mapbox://styles/mapbox/outdoors-v12');
            map.once('style.load', () => { applyMapStyleFeatures(); map.easeTo({ pitch: 0, zoom: currentZoom, duration: 1000 }); });
        }
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
    if (!window.isMapTouched && !window.isFlying && !window.isRotationPausedByUser) {
        map.setBearing(map.getBearing() + 0.15);
    }
    rotateReqId = requestAnimationFrame(rotateCamera);
}

function stopRotate() {
    isRotating = false;
    if (rotateReqId) { cancelAnimationFrame(rotateReqId); rotateReqId = null; }
}

function getMapPadding() {
    // 💡 화면이 가로 모드인지 확인
    const isLandscape = window.innerWidth > window.innerHeight;
    
    if (isLandscape) {
        // 우측 UI 3:1 분할 영역(최소 260px) 유지
        const rightPad = Math.max(window.innerWidth * 0.28, 260);
        
        // 💡 [핵심] 가로 모드일 때: 화면 전체 높이의 20% 만큼 지도를 아래로 내림
        const topPad = window.innerHeight * 0.20; 
        
        return { top: topPad, bottom: 0, right: rightPad, left: 0 };
    }
    
    // 💡 [핵심] 세로 모드일 때: 화면 전체 높이의 10% 만큼 지도를 아래로 내림
    const topPad = window.innerHeight * 0.20;
    
    return { top: topPad, bottom: 0, right: 0, left: 0 };
}
function focusAndRotate(lng, lat, zoomLvl = 14, callback = null) {
    stopRotate();
    const padding = getMapPadding();
    window.isRotationPausedByUser = false; 
    
    safeFlyTo({ center: [lng, lat], zoom: zoomLvl, pitch: 40, bearing: map.getBearing(), padding: padding, duration: 2500, essential: true });
    
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
        if(!map.getLayer('trackLineGlow')) map.addLayer({ id: 'trackLineGlow', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.5, 'line-blur': 6 } });
        if(!map.getLayer('trackLineLayer')) map.addLayer({ id: 'trackLineLayer', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
    }
    
    if (window.replayState && window.replayState.active && window.replayState.route) {
         if(!map.getSource('replayLine')) map.addSource('replayLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: window.replayState.route.slice(0, Math.floor(window.replayState.idx)+1) } } });
         if(!map.getLayer('replayLineGlow')) map.addLayer({ id: 'replayLineGlow', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.6, 'line-blur': 6 } });
         if(!map.getLayer('replayLineLayer')) map.addLayer({ id: 'replayLineLayer', type: 'line', source: 'replayLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
         
         const currentPt = window.replayState.route[0];
         if(!map.getSource('replayPoint')) map.addSource('replayPoint', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Point', coordinates: currentPt } } });
         if(!map.getLayer('replayPointLayer')) map.addLayer({
            id: 'replayPointLayer', type: 'circle', source: 'replayPoint',
            paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-width': 3, 'circle-stroke-color': '#E65100' }
        });
    }
}

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

window.togglePowerSave = function() {
    const overlay = document.getElementById('powerSaveOverlay');
    if (!overlay) return;
    const isHidden = window.getComputedStyle(overlay).display === 'none';
    if (isHidden) {
        overlay.style.display = 'flex';
    } else {
        overlay.style.display = 'none';
    }
};

window.activateCompass = async function() {
    if (window.geolocateControl) {
        window.geolocateControl.trigger();
    }
    // 💡 중복된 권한 요청 로직을 삭제하고 UI만 제어합니다.
    setTimeout(() => {
        const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
        if (!window.isAutoRotating) {
            window.isAutoRotating = true;
            if (compassBtn) compassBtn.classList.add('is-rotating');
        }
    }, 1200);
}

window.isMapTouched = false; 

// 💡 30% 더 밑으로 이동하고 북한까지 노출되는 시야각 (전역 상수)
const DEFAULT_MAP_CENTER = [127.8, 34.5]; 
const DEFAULT_MAP_ZOOM = window.innerWidth <= 768 ? 5.5 : 6.1;

document.addEventListener('DOMContentLoaded', () => {
    mapboxgl.accessToken = 'pk.eyJ1Ijoic2FtZDIwMDAiLCJhIjoiY21ybXlpZGhuMnhocjJ4cXp3dXE4NGRmMiJ9.cBYcIuZLJvBXuecq21zAKg';
    
    mapboxgl.setRTLTextPlugin('https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-rtl-text/v0.2.3/mapbox-gl-rtl-text.js');

    map = new mapboxgl.Map({
        container: 'map',
        style: 'mapbox://styles/mapbox/outdoors-v12',
        center: DEFAULT_MAP_CENTER, 
        zoom: DEFAULT_MAP_ZOOM - 1.5,
        pitch: 0, 
        bearing: 0, 
        projection: 'mercator', 
        doubleClickZoom: false, 
        preserveDrawingBuffer: true
    });
    
    const language = new MapboxLanguage({ defaultLanguage: 'ko' });
    map.addControl(language);

    map.on('style.load', () => {
        applyMapStyleFeatures();
    });

    const nav = new mapboxgl.NavigationControl({ showZoom: false, showCompass: true });
    map.addControl(nav, 'top-right');

    window.geolocateControl = new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true, 
        showUserHeading: true,
        fitBoundsOptions: { maxZoom: 16, duration: 1500 } 
    });
    map.addControl(window.geolocateControl, 'top-right');

    const style = document.createElement('style');
    style.innerHTML = `
        .mapboxgl-ctrl-top-right { top: max(15px, env(safe-area-inset-top)) !important; right: 15px !important; display: flex !important; flex-direction: column !important; gap: 15px !important; }
        .mapboxgl-ctrl-top-right .mapboxgl-ctrl { margin: 0 !important; } 
        .mapboxgl-ctrl-group { border-radius: 50% !important; box-shadow: 0 4px 15px rgba(0,0,0,0.2) !important; background: white !important; overflow: hidden !important; }
        .mapboxgl-ctrl-group > button { width: 50px !important; height: 50px !important; display: flex !important; justify-content: center !important; align-items: center !important; }
        .mapboxgl-ctrl-icon { transform: scale(1.5); } 
        
        .compass-touch-shield { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 9999; cursor: pointer; }
        .mapboxgl-ctrl-compass .mapboxgl-ctrl-icon { background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 3 l3 7 -3 -1.5 -3 1.5 z' fill='%23D32F2F'/%3E%3Cpath d='M10 17 l3 -7 -3 1.5 -3 -1.5 z' fill='%23999999'/%3E%3C/svg%3E") !important; }
    `;
    document.head.appendChild(style);

    const btnPsHUD = document.getElementById('btnPowerSaveHUD');
    if (btnPsHUD) {
        btnPsHUD.addEventListener('click', (e) => {
            e.preventDefault();
            window.togglePowerSave();
        });
    }

    const psOverlay = document.getElementById('powerSaveOverlay');
    let psPressTimer = null;
    
    function startPsPress(e) {
        if(e.type === 'touchstart' && e.touches && e.touches.length > 1) return;
        e.preventDefault(); 
        if (psOverlay) psOverlay.classList.add('pressing');
        if (navigator.vibrate) { try { navigator.vibrate(30); } catch(e){} }

        psPressTimer = setTimeout(() => {
            if (psOverlay) psOverlay.classList.remove('pressing');
            window.togglePowerSave();
            if (navigator.vibrate) { try { navigator.vibrate([100, 50, 100]); } catch(e){} }
        }, 1000); 
    }
    
    function cancelPsPress() {
        clearTimeout(psPressTimer);
        if (psOverlay) psOverlay.classList.remove('pressing');
    }

    if (psOverlay) {
        psOverlay.addEventListener('mousedown', startPsPress);
        psOverlay.addEventListener('touchstart', startPsPress, {passive: false});
        psOverlay.addEventListener('mouseup', cancelPsPress);
        psOverlay.addEventListener('mouseleave', cancelPsPress);
        psOverlay.addEventListener('touchend', cancelPsPress);
        psOverlay.addEventListener('touchcancel', cancelPsPress);
    }

    let tapCount = 0; let tapTimer = null;
    document.getElementById('map').addEventListener('touchstart', function(e) {
        if (e.touches.length > 1) return;
        window.isMapTouched = true;
        tapCount++;
        if (tapCount === 2) {
            clearTimeout(tapTimer);
            tapTimer = setTimeout(() => { tapCount = 0; }, 300);
        } else if (tapCount === 3) {
            e.preventDefault();
            if(window.replayState && window.replayState.active) {
                window.exitReplay();
            } else if (window.isTracking) {
                document.getElementById('trackingHUD').style.display = 'none';
                resetMapToDefault(true); 
            } else {
                resetMapToDefault(false);
            }
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
        if (clickCount === 1) {
            clickTimer = setTimeout(() => { 
                if(clickCount === 1) {
                    if (isRotating) window.isRotationPausedByUser = !window.isRotationPausedByUser;
                }
                clickCount = 0; 
            }, 300);
        } else if (clickCount === 2) {
            clearTimeout(clickTimer);
            clickCount = 0; 
        } else if (clickCount === 3) {
            clearTimeout(clickTimer);
            if(window.replayState && window.replayState.active) {
                window.exitReplay();
            } else if (window.isTracking) {
                document.getElementById('trackingHUD').style.display = 'none';
                resetMapToDefault(true);
            } else resetMapToDefault(false);
            clickCount = 0;
        }
    });

    map.on('dragstart', () => { if(isRotating) window.isRotationPausedByUser = true; });
    map.on('zoomstart', () => { if(isRotating) window.isRotationPausedByUser = true; });

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
                    // 💡 [핵심] 나침반을 클릭한 직후 동기적으로 권한을 요청합니다.
                    if (!window.isSensorGranted && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                        try {
                            const permission = await DeviceOrientationEvent.requestPermission();
                            if (permission === 'granted') {
                                window.isSensorGranted = true;
                                window.addEventListener('deviceorientation', window.handleOrientation, true);
                            }
                        } catch(err) {}
                    } else if (!window.isSensorGranted) {
                        window.isSensorGranted = true;
                        window.addEventListener('deviceorientation', window.handleOrientation, true);
                    }
                    window.activateCompass();
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
        
        const seekBar = document.getElementById('replaySeekBar');
        if (seekBar) {
            seekBar.addEventListener('input', (e) => {
                if(!window.replayState.active) return;
                const ratio = e.target.value / 1000;
                window.replayState.elapsedTime = window.replayState.duration * ratio;
                updateReplayVisuals(ratio);
                
                if (window.replayState.isEndRotation) {
                    window.replayState.isEndRotation = false;
                    cancelAnimationFrame(window.replayState.endRotationReqId);
                    document.getElementById('replayFinal').style.display = 'none';
                    document.getElementById('replayTopHUD').style.display = 'flex'; 
                    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
                    window.replayState.playing = false;
                }
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
        <div class="marker-pin-wrapper drop-in-anim">
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
    
    setTimeout(() => {
        const pin = el.querySelector('.marker-pin-wrapper');
        if(pin) pin.classList.remove('drop-in-anim');
    }, 1500); 

    return el;
}

function clearMarkers(groupArray) {
    if(!groupArray) return;
    groupArray.forEach(m => m.remove());
    groupArray.length = 0;
}

// 💡 새로운 우리나라 전도 뷰로 통합 세팅 (북한까지 노출)
function resetMapToDefault(keepTracking = false) {
    stopRotate();
    window.isAutoRotating = false;
    const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
    if (compassBtn) compassBtn.classList.remove('is-rotating');
    
    currentSidebarState = -1; 
    updateSidebarState();
    
    const defaultPadding = getMapPadding();
    const targetZoom = DEFAULT_MAP_ZOOM;
    const startZoom = targetZoom - 1.5; 

    // 💡 변경된 부분: 지도가 안정화(idle)될 때까지 기다렸다가 애니메이션을 실행하는 로직
    const runCinematicAnimation = () => {
        // 1. 초기 줌아웃 상태로 고정
        map.jumpTo({ center: DEFAULT_MAP_CENTER, zoom: startZoom, pitch: 0, bearing: 0, padding: defaultPadding });
        
        // 2. 아주 짧은 지연 후 40도 눕히며 줌인
        setTimeout(() => {
            safeEaseTo({ 
                center: DEFAULT_MAP_CENTER, 
                zoom: targetZoom, 
                pitch: 40, 
                bearing: 0, 
                padding: defaultPadding, 
                duration: 2500 
            });
        }, 100);
    };

    if (mapMode !== 0) {
        mapMode = 0; window.updateMapModeButton();
        map.setStyle('mapbox://styles/mapbox/outdoors-v12');
        // 💡 지도가 로드되고 나서 '안정화'된 시점을 포착
        map.once('idle', () => { 
            applyMapStyleFeatures(); 
            runCinematicAnimation();
        });
    } else {
        runCinematicAnimation();
    }
    
    document.body.classList.remove('ui-hidden');
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove();
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    
    if(map.getSource('myLogRoute')) {
        map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    }
    if(window.replayState && window.replayState.active) window.exitReplay();
    
    if (!keepTracking && window.isTracking) {
        cleanupTrackingState();
    }
}

const sidebar = document.getElementById('sidebar'), handleDrag = document.getElementById('dragHandle'), dragText = document.querySelector('.drag-text');
let currentSidebarState = -1; const states = ['collapsed', 'half', 'full']; let isHandleDragging = false; let startY = 0;

window.closeSidebar = function() {
    currentSidebarState = -1;
    updateSidebarState();
}

if (handleDrag) {
    handleDrag.addEventListener('pointerdown', e => { isHandleDragging = true; startY = e.clientY; handleDrag.setPointerCapture(e.pointerId); });
    handleDrag.addEventListener('pointermove', e => { if(isHandleDragging) e.preventDefault(); }); 
    handleDrag.addEventListener('pointerup', e => {
        if(!isHandleDragging) return; isHandleDragging = false; handleDrag.releasePointerCapture(e.pointerId);
        const diff = startY - e.clientY; 
        const minState = 0; 
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
        const minState = 0;
        if (e.deltaY > 0) { if (currentSidebarState > minState) currentSidebarState--; } 
        else if (e.deltaY < 0) { if (currentSidebarState < 2) currentSidebarState++; } 
        updateSidebarState(); 
    }, {passive: false});
}

function updateSidebarState() {
    sidebar.classList.remove('hidden', 'collapsed', 'half', 'full'); 
    
    if (currentSidebarState === -1) { 
        sidebar.classList.add('hidden'); 
        
        // 💡 [추가된 핵심 코드] 바텀창이 완전히 닫힐 때 나침반 시선 모드 해제 및 정북 방향 복귀
        window.isAutoRotating = false;
        const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
        if (compassBtn) compassBtn.classList.remove('is-rotating');
        
        // 지도가 회전되어 있다면 0도(정북)로 부드럽게 원상복구
        if (map && map.getBearing() !== 0) {
            map.easeTo({ bearing: 0, duration: 800 });
        }
    } 
    else {
        sidebar.classList.add(states[currentSidebarState]);
        if (dragText) {
            if (currentSidebarState === 0) dragText.innerText = '클릭하여 크게 보기 / 위로 끌어올리세요'; 
            else if (currentSidebarState === 1) dragText.innerText = '클릭하여 전체 보기 / 스와이프하여 닫기'; 
            else dragText.innerText = '클릭하여 최소화 / 쓸어내려서 좁게 보기';
        }
    }
    // if(isRotating && targetCenter) { safeEaseTo({ center: targetCenter, padding: getMapPadding(), duration: 500 }); }
}

function openTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active')); 
    document.getElementById(tabId).classList.add('active');
    
    if (tabId === 'tabSearch') { currentSidebarState = 1; } 
    else { if (currentSidebarState === -1) currentSidebarState = 0; }
    updateSidebarState();
    
    clearMarkers(myLogMarkers); clearMarkers(m100Markers); clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove(); stopRotate();
    if(map.getSource('myLogRoute')) map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    if(window.replayState && window.replayState.active) window.exitReplay();
    
    if(tabId === 'tabChallenge') { 
        renderChallengeMapAndList(); 
    } else if (tabId === 'tabM100') { 
        renderM100Map(); 
    } else if (tabId === 'tabMyLog') { 
        renderAll(); safeFlyTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, pitch: 40, bearing: 0, padding: getMapPadding(), duration: 1500 }); 
    } else if (tabId === 'tabSearch') { 
        safeFlyTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, pitch: 40, bearing: 0, padding: getMapPadding(), duration: 1500 }); 
    }
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
        let rawRecords = e.target.result;
        
        let tempRecord = rawRecords.find(r => r.id === 999999999);
        allRecords = rawRecords.filter(r => r.id !== 999999999).sort((a,b) => new Date(b.date) - new Date(a.date)); 

        calculateTotalAltOnly();
        document.getElementById('uiTotalAlt').innerText = totalAltitudeData.toLocaleString(); 
        
        if (isFirstLoad) { 
            playSplashIntro(); 
        }
        setTimeout(window.renderTrackHistory, 500);

        if (tempRecord && !window.isTracking) {
            setTimeout(() => {
                if (confirm("이전에 비정상 종료된 진행 중인 트래킹 기록이 발견되었습니다.\n지금 바로 복구해서 이어서 트래킹 하시겠습니까?")) {
                    restoreTempTrack(tempRecord);
                } else {
                    db.transaction(['hike_records'], 'readwrite').objectStore('hike_records').delete(999999999);
                }
            }, 2500); 
        }
    };
}

function restoreTempTrack(data) {
    trackRoute = data.route || [];
    trackDistance = parseFloat(data.distance) || 0;
    elapsedSeconds = parseInt(data.elapsedSeconds) || 0;
    trackPhotos = data.photoData || [];

    window.isTracking = true;
    window.isPaused = true; 
    
    document.body.classList.add('ui-hidden');
    
    document.getElementById('trackingHUD').style.display = 'block';
    
    document.getElementById('hudStartControl').style.display = 'none';
    document.getElementById('hudActiveControls').style.display = 'flex';
    
    currentSidebarState = -1; updateSidebarState();
    
    const btnPause = document.getElementById('btnTrackPauseHUD');
    if(btnPause) {
        btnPause.innerText = "▶️ 계속";
        btnPause.style.background = "rgba(76,175,80,0.9)";
        btnPause.style.color = "white";
    }

    const h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(elapsedSeconds % 60).padStart(2, '0');
    const timeStr = `${h}:${m}:${s}`;
    
    document.getElementById('hudTime').innerText = timeStr;
    document.getElementById('hudDist').innerText = trackDistance.toFixed(2);

    if(!map.getSource('trackLine')) {
        map.addSource('trackLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: trackRoute } } });
        map.addLayer({ id: 'trackLineGlow', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.5, 'line-blur': 6 } });
        map.addLayer({ id: 'trackLineLayer', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
    } else {
        map.getSource('trackLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: trackRoute } });
    }

    if (trackRoute.length > 0) {
        const lastPt = trackRoute[trackRoute.length-1];
        map.easeTo({ center: [lastPt[0], lastPt[1]], zoom: 15.5, pitch: 0 });
    }
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
        counterContainer.classList.add('show'); 
        hintObj.style.opacity = '1'; 
        
        setTimeout(() => {
            if (splashSkipTriggered) return; let startTimestamp = null; const duration = 1500; 
            const step = (timestamp) => {
                if (splashSkipTriggered) return; if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                counterObj.innerText = Math.floor((progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress)) * totalAltitudeData).toLocaleString();
                if (progress < 1) window.requestAnimationFrame(step); 
            }; window.requestAnimationFrame(step);
        }, 300); 
    }, 600); 
}

function finishSplashAndStart() {
    const splash = document.getElementById('splash'); 
    isFirstLoad = false;
    
    if(splash) { 
        // 💡 1. 스플래시가 화면을 가리고 있을 때 미리 지도를 줌아웃 위치로 세팅 및 정지
        if (map) {
            map.stop(); 
            map.jumpTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM - 1.5, pitch: 0, bearing: 0 }); 
            map.resize(); 
        }
        
        // 💡 2. 위치 세팅이 끝난 후 스플래시 페이드아웃 시작
        splash.style.opacity = '0'; 
        splash.style.pointerEvents = 'none'; 

        setTimeout(() => {
            resetMapToDefault(false); 
        }, 50);

        setTimeout(() => { splash.style.display = 'none'; }, 1500); 
    } 
    else { 
        resetMapToDefault(false);
    }
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
        
        const labelHtml = `<div class="mountain-label label-mylog show-anim"><b>${group.name}${altText}</b><br><span style="font-size:0.85em;">${latestDate}</span></div>`;
        const el = createMarkerEl('mylog', labelHtml);
        
        const delay = index * 120 + 300; 
        const pin = el.querySelector('.marker-pin-wrapper');
        if (pin) pin.style.animation = `dropIn 1s cubic-bezier(0.28, 0.84, 0.42, 1) ${delay}ms both`;
        
        const lbl = el.querySelector('.mountain-label');
        if (lbl) lbl.style.animation = `labelFadeIn 0.5s ease ${delay + 600}ms both`; 
        
        let popupContent = `<div style="text-align:center;"><b>🏕️ ${group.name}</b><br><span style="color:#D32F2F; font-weight:bold;">고도: ${group.altNum > 0 ? group.altNum + 'm' : '정보 없음'}</span><hr style="margin:5px 0; border:0; border-top:1px solid #ddd;">`;
        
        group.climbs.forEach(c => {
            popupContent += `<div style="font-size:0.9em; margin-bottom:5px; color:#555;">📅 ${c.date}</div>`;
            if (c.photos && c.photos.length > 0) {
                const cId = `carousel_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                popupContent += `<div class="carousel" id="${cId}"><div class="carousel-inner" id="inner_${cId}">`;
                c.photos.forEach((url) => { popupContent += `<div class="carousel-item"><img src="${url}"></div>`; });
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
                if(map.getSource('myLogRoute')) {
                    map.getSource('myLogRoute').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: firstRoute } });
                } else {
                    map.addSource('myLogRoute', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: firstRoute } } });
                    map.addLayer({ id: 'myLogRouteGlow', type: 'line', source: 'myLogRoute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.5, 'line-blur': 6 } });
                    map.addLayer({ id: 'myLogRouteLayer', type: 'line', source: 'myLogRoute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
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

       // app.js 내부 교체 코드
let replayBtnHtml = (data.route && data.route.length > 0) ? `<button class="replay-btn" onclick="event.stopPropagation(); window.replayRoute(allRecords.find(r=>r.id===${data.id}).route, allRecords.find(r=>r.id===${data.id}));">▶️ 재생</button>` : '';

        div.innerHTML = `
            <div class="record-info">
                <h4>⛰️ ${data.name} <span style="font-size:0.8em; color:#2E7D32;">${data.alt !== "정보 없음" ? '('+data.alt+'m)' : ''}</span></h4>
                <p>📅 ${data.date}</p>
            </div>
            <div class="action-btns">
                ${replayBtnHtml}
                <button class="edit-btn" onclick="editRecord(${data.id}, event)">수정</button>
                <button class="delete-btn" onclick="deleteRecord(${data.id}, event)">삭제</button>
            </div>
        `;
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
    safeFlyTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, pitch: 40, bearing: 0, padding: getMapPadding(), duration: 1500 });
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
    safeFlyTo({ center: DEFAULT_MAP_CENTER, zoom: DEFAULT_MAP_ZOOM, pitch: 40, bearing: 0, padding: getMapPadding(), duration: 1500 });
}

let inlineSearchTimer;

// 🛡️ 보안/군사 시설 차단 및 등산/자연 위주 허용 필터 함수
function filterSafePlaces(places) {
    // 🚨 1. 절대 검색되면 안 되는 차단 키워드 (정규식)
    const bannedKeywords = /군부대|군사|미사일|기지|보안|정수장|국방|훈련장|교도소|사단|여단|해군|공군|육군|방공/;

    return places.filter(place => {
        const fullName = place.display_name || "";

        // [차단 조건 A] 주소나 이름에 금지어가 하나라도 들어가면 즉시 탈락
        if (bannedKeywords.test(fullName)) return false;

        // [차단 조건 B] OSM 자체 데이터 태그가 '군사(military)'인 경우 원천 차단
        if (place.class === 'military' || place.type === 'military') return false;

        // ✅ [허용 조건] 우리가 원하는 장소인지 확인 (둘 중 하나만 만족해도 통과)
        // 1. 카테고리가 자연(natural), 레저(leisure), 관광(tourism) 인지 확인
        const isAllowedCategory = ['natural', 'leisure', 'tourism'].includes(place.class);
        
        // 2. 주소나 이름에 우리가 원하는 키워드가 있는지 확인
        const hasAllowedKeyword = /산|봉|령|재|등산|공원|휴양림|캠핑|야영|관광/.test(fullName);

        // 허용 카테고리이거나, 우리가 원하는 키워드가 들어간 안전한 곳만 반환!
        return isAllowedCategory || hasAllowedKeyword;
    });
}
window.handleInlineSearch = function(e) {
    clearTimeout(inlineSearchTimer);
    inlineSearchTimer = setTimeout(() => {
        const query = e.target.value.trim(); const resultsUl = document.getElementById('inlineSearchResults');
        if(!query) { resultsUl.style.display = 'none'; return; }
        resultsUl.style.display = 'block'; resultsUl.innerHTML = '<li>검색 중... ⏳</li>';
        
        fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&accept-language=ko&limit=10`) // 💡 더 많이 가져와서 걸러내기 위해 limit을 10으로 늘림
        .then(res => res.json()).then(rawData => {
            
            // 💡 [핵심] 여기서 데이터를 화면에 그리기 전에 필터를 거칩니다!
            const safeData = filterSafePlaces(rawData);

            resultsUl.innerHTML = '';
            // 💡 rawData가 아니라 필터링된 safeData를 기준으로 검사
            if(!safeData || safeData.length === 0) { resultsUl.innerHTML = '<li style="color:#d32f2f;">안전한 검색 결과가 없습니다.</li>'; return; }
            
            // 💡 safeData를 잘라서(최대 5개) 화면에 뿌려줍니다.
            safeData.slice(0, 5).forEach(place => {
                const li = document.createElement('li'); 
                const shortAddress = place.display_name.split(',').slice(1).join(',').trim();
                const strong = document.createElement('strong');
                strong.textContent = place.name;
                const span = document.createElement('span');
                span.style.color = '#777'; span.style.fontSize = '0.85em';
                span.textContent = " " + shortAddress;
                li.appendChild(strong); li.appendChild(span);
                
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
    
    fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&countrycodes=kr&accept-language=ko&limit=20`) // 💡 필터링 대비 limit 넉넉하게 20으로
    .then(res => res.json()).then(rawData => {
        
        // 💡 [핵심] 여기서도 데이터를 화면에 그리기 전에 필터를 거칩니다!
        const safeData = filterSafePlaces(rawData);

        resultsUl.innerHTML = '';
        if (!safeData || safeData.length === 0) { resultsUl.innerHTML = '<li style="color:#d32f2f;">군사·보안 관련 시설은 검색할 수 없습니다. 산 이름을 검색해 주세요.)</li>'; return; }
        
        // 💡 필터링된 safeData를 사용합니다. (최대 10개 노출)
        safeData.slice(0, 10).forEach(place => {
            const li = document.createElement('li'); 
            const shortAddress = place.display_name.split(',').slice(1).join(',').trim();
            const strong = document.createElement('strong');
            strong.textContent = place.name;
            const span = document.createElement('span');
            span.style.color = '#777'; span.style.fontSize = '0.85em';
            span.textContent = " " + shortAddress;
            li.appendChild(strong); li.appendChild(span);
            
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
                const maxSize = 1200; 
                let width = img.width, height = img.height;
                if (width > height && width > maxSize) { height *= maxSize / width; width = maxSize; } 
                else if (height > maxSize) { width *= maxSize / height; height = maxSize; }
                
                canvas.width = width; canvas.height = height; 
                canvas.getContext('2d').drawImage(img, 0, 0, width, height); 
                resolve(canvas.toDataURL('image/jpeg', 0.6)); 
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
    if(event) event.stopPropagation(); 
    if (!confirm("정말로 이 등산 기록을 삭제하시겠습니까?")) return;
    
    db.transaction(['hike_records'], 'readwrite').objectStore('hike_records').delete(id).onsuccess = () => { 
        // 1. 메모리(allRecords) 상에서 방금 삭제한 데이터를 즉시 제외
        allRecords = allRecords.filter(r => r.id !== id);
        
        // 2. 총 누적 고도 다시 계산 및 텍스트 즉시 반영
        calculateTotalAltOnly();
        document.getElementById('uiTotalAlt').innerText = totalAltitudeData.toLocaleString(); 
        
        // 3. '내 기록' 리스트와 지도 위 마커 즉시 다시 그리기
        renderAll();
        
        // 4. '트래킹 역사' 리스트도 즉시 갱신
        if (typeof window.renderTrackHistory === 'function') {
            window.renderTrackHistory();
        }
    };
}
window.exportData = function() {
    if(allRecords.length === 0) return alert('백업할 기록이 없습니다.'); 
    const dataStr = JSON.stringify(allRecords); 
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const linkElement = document.createElement('a'); 
    linkElement.href = url; 
    linkElement.download = `hike_records_backup_${new Date().toISOString().split('T')[0]}.json`; 
    document.body.appendChild(linkElement);
    linkElement.click(); 
    document.body.removeChild(linkElement);
    URL.revokeObjectURL(url);
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

function saveTempTrack() {
    if (!window.isTracking || trackRoute.length === 0) return;
    const store = db.transaction(['hike_records'], 'readwrite').objectStore('hike_records');
    
    let maxAltPoint = trackRoute[0];
    trackRoute.forEach(pt => { if(pt[2] && pt[2] > maxAltPoint[2]) maxAltPoint = pt; });
    
    const tempData = {
        id: 999999999, 
        isTemp: true,
        name: "비정상 종료된 기록",
        date: new Date().toISOString().split('T')[0],
        alt: Math.round(maxAltPoint[2] || 0),
        lat: maxAltPoint[1],
        lng: maxAltPoint[0],
        route: trackRoute,
        distance: trackDistance,
        elapsedSeconds: elapsedSeconds,
        photos: [], 
        photoData: []
    };
    store.put(tempData);
}

let trackingWatchId = null;
window.isTracking = false;
window.isPaused = false;
let trackStartTime = 0;
let trackTimerInterval = null;
let elapsedSeconds = 0;
let autoSaveInterval = null; 

// 💡 4. 트래킹 진입 시 FAB 숨김 및 GPS 권한 기반 자동 3단 탭 로직 
// 💡 함수에 async를 추가합니다.
window.prepareTracking = async function() {
    clearMarkers(myLogMarkers); 
    clearMarkers(m100Markers); 
    clearMarkers(challengeMarkers);
    if(tempMarker) tempMarker.remove();
    if(window.replayState && window.replayState.active) window.exitReplay();

    document.body.classList.add('ui-hidden');
    currentSidebarState = -1; 
    updateSidebarState();

    document.getElementById('trackingHUD').style.display = 'block';

    // 💡 1. 권한 먼저 체크
    const requestSensorPermission = async () => {
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    window.isSensorGranted = true;
                    window.addEventListener('deviceorientation', window.handleOrientation, true);
                }
            } catch(e) {}
        } else {
            window.isSensorGranted = true;
            window.addEventListener('deviceorientation', window.handleOrientation, true);
        }
    };

    // 💡 2. 지도 스타일 및 GPS/나침반 실행
    const setupTracking = async () => {
        applyMapStyleFeatures();
        // 언어 한글 강제 적용을 위해 딜레이
        setTimeout(applyMapStyleFeatures, 500);
        
        map.jumpTo({ pitch: 0, bearing: 0 });

        // GPS 버튼 탭
        if (window.geolocateControl) window.geolocateControl.trigger();

        // 💡 3. 나침반 모드 자동 활성화 (내 시선 방향 모드)
        setTimeout(() => {
            const compassBtn = document.querySelector('.mapboxgl-ctrl-compass');
            if (!window.isAutoRotating) {
                window.isAutoRotating = true;
                if(compassBtn) compassBtn.classList.add('is-rotating');
            }
        }, 1000);
    };

    await requestSensorPermission(); // 허용/거부 기다림

    if (mapMode !== 2) {
        mapMode = 2; window.updateMapModeButton();
        map.setStyle('mapbox://styles/mapbox/outdoors-v12');
        map.once('style.load', setupTracking);
    } else {
        setupTracking();
    }
}
window.startHikingTrack = async function() {
    if (!navigator.geolocation) return alert("GPS를 지원하지 않는 기기입니다.");
    
    window.isTracking = true; 
    window.isPaused = false;
    
    // 💡 시작 누를 시 확실히 플로팅 요소들 숨김 유지
    document.body.classList.add('ui-hidden');
    
    if (elapsedSeconds === 0) {
        trackRoute = []; trackDistance = 0; trackPhotos = [];
    }
    
    const btnPause = document.getElementById('btnTrackPauseHUD');
    if(btnPause) {
        btnPause.innerText = "⏸️ 휴식";
        btnPause.style.background = "rgba(251,192,45,0.9)";
        btnPause.style.color = "#333";
    }
    
    document.getElementById('hudStartControl').style.display = 'none';
    document.getElementById('hudActiveControls').style.display = 'flex';

    requestWakeLock();

    if (trackTimerInterval) clearInterval(trackTimerInterval);
    trackStartTime = Date.now() - (elapsedSeconds * 1000);
    trackTimerInterval = setInterval(() => {
        if(window.isPaused) {
            trackStartTime += 1000;
            return;
        }
        elapsedSeconds = Math.floor((Date.now() - trackStartTime) / 1000);
        
        const h = String(Math.floor(elapsedSeconds / 3600)).padStart(2, '0');
        const m = String(Math.floor((elapsedSeconds % 3600) / 60)).padStart(2, '0');
        const s = String(elapsedSeconds % 60).padStart(2, '0');
        
        const timeStr = `${h}:${m}:${s}`;
        document.getElementById('hudTime').innerText = timeStr;
    }, 1000);

    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(() => {
        if (window.isTracking && !window.isPaused) saveTempTrack();
    }, 60000);

    if(!map.getSource('trackLine')) {
        map.addSource('trackLine', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
        map.addLayer({ id: 'trackLineGlow', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFFF00', 'line-width': 12, 'line-opacity': 0.5, 'line-blur': 6 } });
        map.addLayer({ id: 'trackLineLayer', type: 'line', source: 'trackLine', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#FFF59D', 'line-width': 4 } });
    }

    if (!trackingWatchId) {
        trackingWatchId = navigator.geolocation.watchPosition(pos => {
            if (window.isPaused) return;
            
            const lng = pos.coords.longitude;
            const lat = pos.coords.latitude;
            
            let alt = pos.coords.altitude;
            if(!alt || alt === 0) {
                alt = map.queryTerrainElevation([lng, lat]) || 0;
            }
            alt = Math.round(alt);

            const speed = ((pos.coords.speed || 0) * 3.6).toFixed(1);
            
            document.getElementById('hudAlt').innerText = alt;
            document.getElementById('hudSpeed').innerText = speed;

            if (trackRoute.length > 0) {
                const lastCoord = trackRoute[trackRoute.length - 1];
                const dist = getDistance(lastCoord[1], lastCoord[0], lat, lng) / 1000; 
                if (dist > 0.005) { 
                    trackDistance += dist;
                    document.getElementById('hudDist').innerText = trackDistance.toFixed(2);
                    
                    trackRoute.push([lng, lat, alt]); 
                    map.getSource('trackLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: trackRoute } });
                }
            } else {
                trackRoute.push([lng, lat, alt]);
            }
            
            // 유저가 화면을 터치하지 않았을 때만 내 위치를 부드럽게 추적
            if(!window.isMapTouched) {
                map.easeTo({
                    center: [lng, lat],
                    duration: 1000,           // GPS 갱신 주기에 맞춰 1초 동안 부드럽게
                    padding: getMapPadding(), // 위에서 만든 최적의 시야각 적용
                    easing: (t) => t          // 덜컹거림 방지 (선형 이동)
                });
            }
            
        }, err => console.log(err), { enableHighAccuracy: true, maximumAge: 3000 });
    }
}

window.togglePauseTrack = function() {
    window.isPaused = !window.isPaused;
    const btn = document.getElementById('btnTrackPauseHUD');
    if (window.isPaused) {
        btn.innerText = "▶️ 계속";
        btn.style.background = "rgba(76,175,80,0.9)";
        btn.style.color = "white";
        saveTempTrack(); 
    } else {
        btn.innerText = "⏸️ 휴식";
        btn.style.background = "rgba(251,192,45,0.9)";
        btn.style.color = "#333";
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
        el.innerHTML = '📷'; el.style.fontSize = '24px'; el.style.cursor = 'pointer'; el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))';
        new mapboxgl.Marker(el).setLngLat(currentLoc).addTo(map);
        alert("사진이 현재 위치에 기록되었습니다!");
    }
}

function cleanupTrackingState() {
    if (trackingWatchId) navigator.geolocation.clearWatch(trackingWatchId);
    trackingWatchId = null;
    
    if (trackTimerInterval) clearInterval(trackTimerInterval);
    trackTimerInterval = null;
    
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    db.transaction(['hike_records'], 'readwrite').objectStore('hike_records').delete(999999999);
    
    if(wakeLock) { wakeLock.release(); wakeLock = null; }

    // 💡 1. 내부 기록 및 상태 변수 완벽 초기화
    window.isTracking = false;
    window.isPaused = false;
    elapsedSeconds = 0;
    trackDistance = 0;
    trackRoute = [];
    trackPhotos = [];
    
    // 💡 2. 텍스트 수치들 0으로 초기화
    document.getElementById('hudTime').innerText = "00:00:00";
    document.getElementById('hudDist').innerText = "0.0";
    document.getElementById('hudAlt').innerText = "0";
    document.getElementById('hudSpeed').innerText = "0.0";

    // 💡 3. [핵심] 여기서 UI 버튼 상태를 아예 '시작 전' 상태로 못 박아버립니다.
    document.getElementById('hudStartControl').style.display = 'block'; // 시작 버튼 보이게
    document.getElementById('hudActiveControls').style.display = 'none'; // 중지/종료 버튼 숨기게

    // 💡 4. 혹시 휴식 상태에서 꺼졌을 경우를 대비해 버튼 텍스트 원상복구
    const btnPause = document.getElementById('btnTrackPauseHUD');
    if(btnPause) {
        btnPause.innerText = "⏸️ 휴식";
        btnPause.style.background = "rgba(251,192,45,0.9)";
        btnPause.style.color = "#333";
    }

    // 💡 5. 화면에서 숨기기 및 선 지우기
    document.getElementById('trackingHUD').style.display = 'none';
    if(map.getSource('trackLine')) {
        map.getSource('trackLine').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] } });
    }
}

// 💡 [X] 나가기 버튼
window.exitTrackingMode = function() {
    if (window.isTracking) {
        if (confirm("등산 기록중인데 정말 나가시겠습니까?\n(기록은 저장되지 않습니다.)")) {
            cleanupTrackingState();
            // 기본 화면으로 이동하지 않고 현재 지도 위치를 유지하며 우측 버튼만 살림
            document.body.classList.remove('ui-hidden'); 
            currentSidebarState = -1; updateSidebarState();
        }
    } else {
        cleanupTrackingState();
        document.body.classList.remove('ui-hidden'); 
        currentSidebarState = -1; updateSidebarState();
    }
};

// 💡 [🛑 종료] 버튼
window.stopHikingTrack = function() {
    // 💡 문구 수정: 취소 시 기록이 계속 유지됨을 안내합니다.
    if (!confirm("등산을 종료하고 기록을 저장하시겠습니까?\n(취소를 누르면 계속해서 등산을 기록합니다.)")) {
        // [취소] 누를 경우: 아무것도 지우지 않고 바로 함수를 빠져나가 트래킹을 계속 이어나갑니다!
        return;
    }
    
    // [확인] 누를 경우: 백업 후 저장
    const mName = prompt("이 산의 이름을 적어주세요!", "이름 없는 산") || "이름 없는 산";
    
    // 상태 초기화 전 데이터 임시 백업
    const finalTime = document.getElementById('hudTime').innerText;
    const finalDistance = trackDistance.toFixed(2);
    const finalRoute = [...trackRoute];
    const finalPhotoData = [...trackPhotos];
    const photosOnly = trackPhotos.map(p => p.url);
    const today = new Date().toISOString().split('T')[0];
    
    let maxAltPoint = trackRoute.length > 0 ? trackRoute[0] : [128.0, 36.0, 0];
    trackRoute.forEach(pt => { if(pt[2] && pt[2] > maxAltPoint[2]) maxAltPoint = pt; });
    const realMaxAlt = Math.round(maxAltPoint[2] || 0);
    
    // 💡 데이터 백업이 끝났으므로 안심하고 상태를 완벽히 싹 비웁니다.
    cleanupTrackingState();

   // 저장 진행
    const store = db.transaction(['hike_records'], 'readwrite').objectStore('hike_records');
    store.add({ 
        name: mName, date: today, alt: realMaxAlt, 
        lat: maxAltPoint[1], 
        lng: maxAltPoint[0], 
        photos: photosOnly, 
        photoData: finalPhotoData, 
        route: finalRoute, 
        time: finalTime,
        distance: finalDistance
// ... 앞부분 생략 ...
    }).onsuccess = () => {
        alert("내 기록에 자동 저장되었습니다!");
        
        // 1. 트래킹 중 숨겨졌던 기본 버튼들을 먼저 살립니다.
        document.body.classList.remove('ui-hidden');
        
        // 2. 바텀창을 '내기록' 탭으로 맞추고 화면 위로 띄웁니다.
        openTab('tabMyLog'); 
        currentSidebarState = 1; 
        updateSidebarState(); 
        
        // 💡 3. [핵심] 창이 열리는 애니메이션이 시작된 직후(0.1초 뒤)에 리스트를 갱신합니다.
        // 이렇게 하면 탭 화면이 활성화된 상태에서 리스트가 쏙! 하고 정상적으로 그려집니다.
        setTimeout(() => {
            if (typeof loadSavedRecords === 'function') {
                loadSavedRecords(); 
            }
        }, 1000); 
    };
}
window.renderTrackHistory = function() {
    const listEl = document.getElementById('trackHistoryList');
    if(!listEl) return;
    listEl.innerHTML = '';
    const tracks = allRecords.filter(r => r.route && r.route.length > 0);
    
    if(tracks.length === 0) { listEl.innerHTML = "<p style='text-align:center; color:#999; padding: 20px;'>트래킹 기록이 없습니다.</p>"; return; }
    
    tracks.forEach(t => {
        const div = document.createElement('div');
        div.className = 'track-card';
        div.innerHTML = `
            <div class="track-info">
                <h4>⛰️ ${t.name} <small style="color:#666;">(${t.distance}km / ${t.time})</small></h4>
                <p>📅 ${t.date}</p>
            </div>
            <div class="action-btns">
                <button class="replay-btn" style="background:#FF8F00;" onclick="window.replayRoute(allRecords.find(r=>r.id===${t.id}).route, allRecords.find(r=>r.id===${t.id})); event.stopPropagation();">▶️ 재생</button>
                <button class="delete-btn" onclick="deleteRecord(${t.id}, event)">삭제</button>
            </div>
        `;
        div.onclick = () => window.replayRoute(t.route, t);
        listEl.appendChild(div);
    });
}


// 💡 화면 크기 변화 감지 및 가로/세로 모드 대응 (현재 위치 유지)
window.addEventListener('resize', () => {
    if (typeof map !== 'undefined' && map) {
        setTimeout(() => {
            map.resize(); // 도화지는 화면에 꽉 차게 폄
            
            const isLandscape = window.innerWidth > window.innerHeight;
            const currentZoom = map.getZoom(); // 현재 줌 레벨 저장
            const currentCenter = map.getCenter(); // 💡 [핵심] 현재 보고 있는 위치 저장
            
            let cameraOptions = { 
                center: currentCenter, // 💡 회전해도 현재 위치를 강제로 유지함
                padding: getMapPadding(), 
                duration: 500 
            };

            // 💡 전국 지도를 보고 있을 때(줌 아웃 상태, zoom 8 미만)만 한국 중앙으로 재정렬
            if (!window.isTracking && currentZoom < 8) {
                cameraOptions.center = [127.8, 35.2]; 
                cameraOptions.zoom = isLandscape ? 7.3 : 5.6; 
            }

            map.easeTo(cameraOptions);
        }, 200); 
    }
});