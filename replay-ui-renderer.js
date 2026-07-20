// 💡 세로/가로 모드 UI 깨짐 방지 및 나가기 버튼 확보 CSS 자동 주입
(function injectReplayCSS() {
    if(document.getElementById('replayDynamicCSS')) return;
    const style = document.createElement('style');
    style.id = 'replayDynamicCSS';
    style.innerHTML = `
        /* 📱 세로모드(모바일): 버튼이 많아도 잘리지 않고 스와이프로 볼 수 있도록 스크롤 추가 */
        .rc-buttons { 
            display: flex !important;
            flex-wrap: nowrap !important;
            overflow-x: auto !important; 
            -webkit-overflow-scrolling: touch; /* 부드러운 스크롤 */
            scrollbar-width: none; 
            gap: 8px !important;
            padding-bottom: 2px;
        }
        .rc-buttons::-webkit-scrollbar { display: none; }
        #replayControls button { 
            flex-shrink: 0 !important; 
            width: 52px !important; /* 모바일에 맞게 약간 축소 */
        }
        #replayControls .exit-btn {
            width: auto !important;
            min-width: 65px !important;
            background: rgba(255,82,82,0.85) !important; /* 나가기 버튼 강조 */
            color: white !important;
            margin-left: auto !important;
        }
        
        /* 📱 가로모드: 컨트롤 바 넓게 쓰고, 재생바 크기 줄여서 버튼 확보 */
        @media (orientation: landscape) {
            #replayControls { width: 95% !important; max-width: none !important; flex-direction: row !important; align-items: center !important; padding: 10px 20px !important; }
            .rc-buttons { flex: 1; justify-content: flex-start !important; }
            #replaySeekBar { flex: 1; min-width: 120px; margin-left: 20px !important; margin-top: 0 !important; }
        }
    `;
    document.head.appendChild(style);
})();

// 상단 HUD 및 진행바 렌더링
window.renderReplayHUD = function(stats, progress) {
    document.getElementById('rhDist').innerText = stats.dist;
    document.getElementById('rhTime').innerText = stats.time;
    document.getElementById('rhAlt').innerText = stats.alt;
    const seekBar = document.getElementById('replaySeekBar');
    if(seekBar) seekBar.value = progress * 1000;
};

// 사진 팝업 렌더링
window.renderReplayPhotos = function(currentPt) {
    const s = window.replayState;
    if (!s.record.photoData || !s.playing) return false;

    for (let pIdx = 0; pIdx < s.record.photoData.length; pIdx++) {
        const photo = s.record.photoData[pIdx];
        if (!photo.shown && getDistance(currentPt[1], currentPt[0], photo.coords[1], photo.coords[0]) < 25) {
            photo.shown = true;
            s.wasPlayingBeforePhoto = s.playing;
            s.playing = false; 
            
            window.currentPhotoPopupId = (window.currentPhotoPopupId || 0) + 1;
            const myPopupId = window.currentPhotoPopupId;

            document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
            
            setTimeout(() => {
                const imgPopup = document.createElement('img');
                imgPopup.id = 'tempPhotoPopup'; 
                imgPopup.src = photo.url;
                imgPopup.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%) scale(0.5); opacity:0; z-index:10005; border-radius:15px; box-shadow:0 10px 30px rgba(0,0,0,0.8); max-width:85%; max-height:65%; transition:all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1); object-fit:contain; background:#000;';
                document.body.appendChild(imgPopup);

                requestAnimationFrame(() => {
                    imgPopup.style.transform = 'translate(-50%, -50%) scale(1)';
                    imgPopup.style.opacity = '1';
                });

                setTimeout(() => {
                    if (document.getElementById('tempPhotoPopup')) {
                        imgPopup.style.transform = 'translate(-50%, -50%) scale(0.5)';
                        imgPopup.style.opacity = '0';
                        setTimeout(() => {
                            imgPopup.remove();
                            if(s.active && !s.isRenderingVideo && window.currentPhotoPopupId === myPopupId && s.wasPlayingBeforePhoto) {
                                s.playing = true;
                                document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">⏸️</span><span class="txt">일시정지</span>';
                                s.lastFrameTime = performance.now();
                                window.replayLoop(performance.now());
                            }
                        }, 500);
                    }
                }, 3000); 
            }, 500); 
            return true; 
        }
    }
    return false;
};

// 피날레 종료 화면 렌더링
window.renderReplayFinal = function() {
    const record = window.replayState.record;
    document.getElementById('rfName').innerText = record.name;
    document.getElementById('rfDate').innerText = record.date; 
    document.getElementById('rfDist').innerText = record.distance + 'km';
    document.getElementById('rfTime').innerText = record.time;
    document.getElementById('rfAlt').innerText = window.replayState.maxHudAlt + 'm'; 

    document.getElementById('replayTopHUD').style.display = 'none';
    document.getElementById('replayFinal').style.display = 'block';
};