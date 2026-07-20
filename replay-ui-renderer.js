// 💡 가로모드 UI 깨짐 방지 및 깃발 튀어오르는 애니메이션 CSS 자동 주입
(function injectReplayCSS() {
    if(document.getElementById('replayDynamicCSS')) return;
    const style = document.createElement('style');
    style.id = 'replayDynamicCSS';
    style.innerHTML = `
        @keyframes flagPop {
            0% { transform: scale(0) translateY(40px); opacity: 0; }
            60% { transform: scale(1.3) translateY(-10px); opacity: 1; }
            100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        .flag-anim {
            animation: flagPop 0.7s cubic-bezier(0.175, 0.885, 0.32, 1.27) forwards;
            transform-origin: bottom center;
        }
        
        /* 📱 가로모드: 컨트롤 바 넓게 쓰고, 재생바 크기 줄여서 버튼 확보 */
        @media (orientation: landscape) {
            #replayControls { width: 95% !important; max-width: none !important; flex-direction: row !important; align-items: center !important; padding: 10px 20px !important; }
            .rc-buttons { flex: 1; justify-content: flex-start !important; overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
            .rc-buttons::-webkit-scrollbar { display: none; }
            #replaySeekBar { flex: 1; min-width: 120px; margin-left: 20px; margin-top: 0 !important; }
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