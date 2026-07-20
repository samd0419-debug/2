// 상태 변수 통합
window.replayState = {
    active: false,
    playing: false,
    isEndRotation: false,
    route: [],
    record: null,
    highestPoint: null,
    initialBearing: 0,
    peakProgress: 0,
    totalPoints: 0,
    totalSeconds: 0,
    elapsedTime: 0, 
    duration: 20000,
    lastFrameTime: 0,
    reqId: null,
    endRotationReqId: null,
    maxHudAlt: 0 
};

// 유틸 함수
window.timeStrToSeconds = function(timeStr) {
    const parts = timeStr.split(':');
    return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
};

window.secondsToTimeStr = function(secs) {
    const h = String(Math.floor(secs / 3600)).padStart(2, '0');
    const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    const s = String(Math.floor(secs % 60)).padStart(2, '0');
    return `${h}:${m}:${s}`;
};

// 프레임 데이터 계산 (위치, 경로)
window.calculateReplayFrame = function(progress) {
    const s = window.replayState;
    const exactIdx = progress * (s.totalPoints - 1);
    const i1 = Math.floor(exactIdx);
    const i2 = Math.ceil(exactIdx);
    const frac = exactIdx - i1;
    
    const p1 = s.route[i1];
    const p2 = s.route[i2] || p1;
    
    const currentPt = [
        lerp(p1[0], p2[0], frac),
        lerp(p1[1], p2[1], frac),
        lerp(p1[2] || 0, p2[2] || 0, frac)
    ];

    const drawnRoute = s.route.slice(0, i1 + 1);
    drawnRoute.push(currentPt);

    return { currentPt, drawnRoute };
};

// 카메라 앵글 계산 (시네마틱 뷰 공식)
window.calculateReplayCamera = function(progress) {
    const s = window.replayState;
    let targetZoom = 14.5, targetPitch = 60, targetBearing = s.initialBearing;

    if (progress < 0.2) {
        // 초반 대기
    } else if (progress < 0.8) {
        let t = (progress - 0.2) / 0.6;
        targetZoom = 14.5 + (2 * t); 
        targetPitch = 60; 
        targetBearing = s.initialBearing + (t * 360); 
    } else {
        let t = (progress - 0.8) / 0.2;
        targetZoom = 16.5 - (2 * t); 
        targetPitch = 60 - (15 * t); 
        targetBearing = s.initialBearing + 360 + (t * 90); 
    }
    return { zoom: targetZoom, pitch: targetPitch, bearing: targetBearing };
};

// 통계 데이터 계산 (거리, 시간, 고도)
window.calculateReplayStats = function(progress, currentPt) {
    const s = window.replayState;
    const currentDist = (s.record.distance * progress).toFixed(2);
    const currentTimeStr = secondsToTimeStr(s.totalSeconds * progress);
    
    let altVal = currentPt[2];
    if (!altVal || altVal === 0) altVal = map.queryTerrainElevation(currentPt) || 0;
    let currentAlt = Math.round(altVal);
    
    if (currentAlt > s.maxHudAlt) s.maxHudAlt = currentAlt;

    return { dist: currentDist, time: currentTimeStr, alt: currentAlt };
};