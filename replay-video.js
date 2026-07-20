window.replayState.isRenderingVideo = false;

window.handleVideoShare = async function() {
    const file = window.lastRenderedVideoFile; const url = window.lastRenderedVideoUrl;
    if (!file || !url) return;
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ title: '나의 등산기 리플레이', files: [file] }); } 
        catch (e) { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
    } else { const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); document.body.removeChild(a); }
};

function createExportLoadingOverlay() {
    let overlay = document.getElementById('exportLoadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div'); overlay.id = 'exportLoadingOverlay';
        overlay.style.cssText = `position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 20000; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-family: 'Malgun Gothic', sans-serif; backdrop-filter: blur(8px);`;
        overlay.innerHTML = `
            <div style="font-size: 3.5rem; animation: bounceIcon 1.2s infinite alternate; margin-bottom: 15px;">⛰️🎬</div>
            <div style="font-size: 1.3rem; font-weight: bold; margin-bottom: 8px; color: #FFCA28;">트래킹 영상을 굽고 있습니다...</div>
            <div id="exportStatusText" style="font-size: 0.95rem; color: #B0BEC5; margin-bottom: 20px;">준비 중...</div>
            <div style="width: 260px; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; overflow: hidden;"><div id="exportProgressBar" style="width: 0%; height: 100%; background: #4CAF50; transition: width 0.2s;"></div></div>
            <style>@keyframes bounceIcon { from { transform: translateY(0); } to { transform: translateY(-12px); } }</style>
        `;
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function removeExportLoadingOverlay() { const overlay = document.getElementById('exportLoadingOverlay'); if (overlay) overlay.style.display = 'none'; }
function updateExportProgress(percent, remainingSec) {
    const bar = document.getElementById('exportProgressBar'); const text = document.getElementById('exportStatusText');
    if (bar) bar.style.width = `${percent}%`; if (text) text.innerText = `진행률: ${percent}% (남은 시간: 약 ${remainingSec}초)`;
}
function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.arcTo(x + width, y, x + width, y + height, radius); ctx.arcTo(x + width, y + height, x, y + height, radius); ctx.arcTo(x, y + height, x, y, radius); ctx.arcTo(x, y, x + width, y, radius); ctx.closePath();
}

window.startVideoExport = async function() {
    const s = window.replayState;
    if (!s.route || s.route.length < 2) return alert("경로 데이터가 없습니다.");

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    let audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    s.isRenderingVideo = true; s.playing = false;
    document.getElementById('btnReplayPlay').innerHTML = '<span class="icon">▶️</span><span class="txt">재생</span>';
    const exportBtn = document.getElementById('btnExportVideo'); exportBtn.onclick = null; 

    createExportLoadingOverlay();
    let startTime = performance.now(); let chunkCount = 0; let isSuccess = false; 

    const getDist = (p1, p2) => {
        const R = 6371e3; const lat1 = p1[1] * Math.PI/180, lat2 = p2[1] * Math.PI/180;
        const dp = (p2[1]-p1[1]) * Math.PI/180, dl = (p2[0]-p1[0]) * Math.PI/180;
        const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dl/2) * Math.sin(dl/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    };

    try {
        if (typeof VideoEncoder === 'undefined') throw new Error("비디오 인코딩 미지원 환경");

        const fps = 30; const routeSec = 20; const finaleSec = 10; const pauseSecPerPhoto = 3; 
        const routeFrames = fps * routeSec; const finaleFrames = fps * finaleSec; const pauseFramesPerPhoto = fps * pauseSecPerPhoto;

        const preloadedPhotos = []; let triggeredPhotoCount = 0; const triggeredUrls = new Set();

        if (s.record.photoData && s.record.photoData.length > 0) {
            for (let photo of s.record.photoData) {
                try {
                    const img = new Image(); img.crossOrigin = "Anonymous";
                    await new Promise((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); img.src = photo.url; });
                    if (img.width > 0) preloadedPhotos.push({ url: photo.url, coords: photo.coords, img: img, shown: false });
                } catch(e) {}
            }
        }

        for(let i = 0; i <= routeFrames; i++){
            const pt = window.calculateReplayFrame(i/routeFrames).currentPt;
            for(let p of preloadedPhotos){
                if(!triggeredUrls.has(p.url) && getDist(pt, p.coords) < 25){ triggeredUrls.add(p.url); triggeredPhotoCount++; }
            }
        }

        const totalFrames = routeFrames + finaleFrames + (triggeredPhotoCount * pauseFramesPerPhoto);
        const totalSec = totalFrames / fps;
        
        let sampleRate = 44100;
        const targetLength = Math.ceil(totalSec * sampleRate);
        let finalAudioChannels = [new Float32Array(targetLength), new Float32Array(targetLength)];
        let isBgmLoaded = false;

        try {
            const response = await fetch('./bgm.mp3');
            if (response.ok) {
                const arrayBuffer = await response.arrayBuffer(); const decoded = await audioCtx.decodeAudioData(arrayBuffer);
                sampleRate = decoded.sampleRate;
                const srcChannels = [decoded.getChannelData(0), decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0)];
                const srcLength = decoded.length; const fadeOutStartFrames = Math.floor(Math.max(0, totalSec - 3) * sampleRate);
                
                finalAudioChannels = [new Float32Array(Math.ceil(totalSec * sampleRate)), new Float32Array(Math.ceil(totalSec * sampleRate))];
                for (let i = 0; i < finalAudioChannels[0].length; i++) {
                    let vol = 1.0; if (i >= fadeOutStartFrames) vol = Math.max(0, 1.0 - ((i - fadeOutStartFrames) / (finalAudioChannels[0].length - fadeOutStartFrames)));
                    finalAudioChannels[0][i] = srcChannels[0][i % srcLength] * vol; finalAudioChannels[1][i] = srcChannels[1][i % srcLength] * vol;
                }
                isBgmLoaded = true;
            }
        } catch(e) { console.warn("BGM 로드 실패. 빈 무음 트랙 생성"); }

        const canvas = map.getCanvas(); const originalWidth = canvas.width; const originalHeight = canvas.height; const MAX_SIZE = 1280;
        let exportWidth = originalWidth; let exportHeight = originalHeight;
        if (Math.max(originalWidth, originalHeight) > MAX_SIZE) {
            const ratio = MAX_SIZE / Math.max(originalWidth, originalHeight);
            exportWidth = Math.floor((originalWidth * ratio) / 16) * 16; exportHeight = Math.floor((originalHeight * ratio) / 16) * 16;
        } else {
            exportWidth = Math.floor(originalWidth / 16) * 16; exportHeight = Math.floor(originalHeight / 16) * 16;
        }

        const bufferCanvas = document.createElement('canvas'); bufferCanvas.width = exportWidth; bufferCanvas.height = exportHeight;
        const bufferCtx = bufferCanvas.getContext('2d', { alpha: false, willReadFrequently: true });

        let muxerConfig = { target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: exportWidth, height: exportHeight }, audio: { codec: 'aac', numberOfChannels: 2, sampleRate: sampleRate }, fastStart: 'in-memory' };
        let muxer = new Mp4Muxer.Muxer(muxerConfig);

        let videoEncoder = new VideoEncoder({
            output: (chunk, meta) => {
                chunkCount++; let safeMeta = meta || {}; safeMeta.decoderConfig = safeMeta.decoderConfig || {};
                if (!safeMeta.decoderConfig.colorSpace) safeMeta.decoderConfig.colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
                muxer.addVideoChunk(chunk, safeMeta);
            }, error: (e) => { throw e; }
        });

        const config = { codec: 'avc1.4d002a', width: exportWidth, height: exportHeight, bitrate: 4_000_000, framerate: fps, avc: { format: 'avc' } };
        const support = await VideoEncoder.isConfigSupported(config); if (!support.supported) config.codec = 'avc1.42E01F'; 
        videoEncoder.configure(config);

        let audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => console.error(e) });
        audioEncoder.configure({ codec: 'mp4a.40.2', sampleRate: sampleRate, numberOfChannels: 2, bitrate: 128_000 });

        const framesPerChunk = sampleRate;
        for (let offset = 0; offset < finalAudioChannels[0].length; offset += framesPerChunk) {
            const chunkFrames = Math.min(framesPerChunk, finalAudioChannels[0].length - offset);
            const planarData = new Float32Array(chunkFrames * 2);
            planarData.set(finalAudioChannels[0].subarray(offset, offset + chunkFrames), 0);
            planarData.set(finalAudioChannels[1].subarray(offset, offset + chunkFrames), chunkFrames);
            const audioData = new AudioData({ format: 'f32-planar', sampleRate: sampleRate, numberOfFrames: chunkFrames, numberOfChannels: 2, timestamp: Math.round((offset / sampleRate) * 1_000_000), data: planarData });
            audioEncoder.encode(audioData); audioData.close();
        }
        await audioEncoder.flush(); 

        const frameDuration = Math.round(1_000_000 / fps);
        let mapProgressFrame = 0; let totalEncodedFrames = 0;
        let activePhoto = null; let photoOverlayFrames = 0;

        // 💡 [NaN 방어벽] 비디오용 줌/좌표 안전 세팅
        const videoZoom80 = (s.zoom80 && !isNaN(s.zoom80)) ? s.zoom80 : 14.5;
        const videoZoom50 = (s.zoom50 && !isNaN(s.zoom50)) ? s.zoom50 : 13.5;
        let finaleInitialized = false; let currentEndBearing = 0;
        let endPoint = s.route[s.route.length - 1]; 
        const boundsValid = s.route.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(s.route[0], s.route[0]));
        const routeCenter = boundsValid.getCenter().toArray(); // 💡 피날레 중앙 회전용 중심점

        // 비디오 전용 스무스 카메라 함수 (튕김 방지 + 줌아웃)
        window.calculateReplayCamera = function(progress) {
            if (progress >= 1) progress = 1;
            const startZoom = videoZoom80 + 2.5; 
            let currentZoom = startZoom - ((startZoom - videoZoom80) * progress);
            if (isNaN(currentZoom)) currentZoom = videoZoom80;

            const exactIdx = progress * (s.totalPoints - 1);
            const currentIdx = Math.floor(exactIdx);
            let lookAheadIdx = Math.floor(currentIdx + (s.totalPoints * 0.05));
            if (lookAheadIdx >= s.totalPoints) lookAheadIdx = s.totalPoints - 1;

            let targetBearing = s.lastValidBearing !== undefined ? s.lastValidBearing : (s.initialBearing || 0);
            const p1 = s.route[currentIdx]; const p2 = s.route[lookAheadIdx];

            if (p1 && p2 && (p1[0] !== p2[0] || p1[1] !== p2[1])) {
                const b = turf.bearing(turf.point(p1), turf.point(p2));
                if (!isNaN(b)) targetBearing = b;
                s.lastValidBearing = targetBearing;
            }

            if (s.smoothedBearing === undefined || isNaN(s.smoothedBearing)) s.smoothedBearing = targetBearing;
            let diff = targetBearing - s.smoothedBearing;
            while (diff < -180) diff += 360; while (diff > 180) diff -= 360;
            s.smoothedBearing += diff * 0.03; 

            return { zoom: currentZoom, pitch: 60, bearing: s.smoothedBearing };
        };

        function drawTopHUD(ctx, dist, time, alt) {
            ctx.save(); ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'; drawRoundRect(ctx, 20, 20, 180, 110, 10); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 22px "Malgun Gothic", sans-serif';
            ctx.fillText(`🕒 ${time}`, 35, 50); ctx.fillText(`📏 ${dist} km`, 35, 85); ctx.fillText(`⛰️ ${alt} m`, 35, 120); ctx.restore();
        }

        function drawFinalHUD(ctx, record, maxAlt) {
            ctx.save();
            const w = Math.min(380, exportWidth * 0.9); const h = 190;
            const x = (exportWidth - w) / 2; const y = 80; 
            ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'; ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 2;
            drawRoundRect(ctx, x, y, w, h, 15); ctx.fill(); ctx.stroke();
            ctx.textAlign = 'center'; ctx.fillStyle = '#FFCA28'; ctx.font = 'bold 30px "Malgun Gothic", sans-serif';
            ctx.fillText(record.name, exportWidth / 2, y + 45);
            ctx.fillStyle = '#ffffff'; ctx.font = '18px "Malgun Gothic", sans-serif';
            ctx.fillText(record.date, exportWidth / 2, y + 80);
            ctx.beginPath(); ctx.moveTo(x + 20, y + 105); ctx.lineTo(x + w - 20, y + 105);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke();
            ctx.font = 'bold 20px "Malgun Gothic", sans-serif';
            ctx.fillText(`거리: ${record.distance}km   시간: ${record.time}`, exportWidth / 2, y + 140);
            ctx.fillText(`최고고도: ${maxAlt}m`, exportWidth / 2, y + 175); ctx.restore();
        }

        while (totalEncodedFrames < totalFrames) {
            let progress = 0;

            if (mapProgressFrame <= routeFrames) {
                progress = mapProgressFrame / routeFrames;
                const currentPt = window.calculateReplayFrame(progress).currentPt;

                if (!activePhoto && preloadedPhotos.length > 0) {
                    for (let p of preloadedPhotos) {
                        if (!p.shown && getDist(currentPt, p.coords) < 25) {
                            p.shown = true; activePhoto = p.img; photoOverlayFrames = pauseFramesPerPhoto; break; 
                        }
                    }
                }

                window.updateReplayVisuals(progress);
                map.triggerRepaint(); await new Promise(resolve => setTimeout(resolve, 35));
                
                bufferCtx.fillStyle = '#2E7D32'; bufferCtx.fillRect(0, 0, exportWidth, exportHeight);
                bufferCtx.drawImage(canvas, 0, 0, exportWidth, exportHeight);
                
                const stats = window.calculateReplayStats(progress, currentPt);
                drawTopHUD(bufferCtx, stats.dist, stats.time, stats.alt); 

                if (activePhoto && photoOverlayFrames > 0) {
                    let alpha = 1.0;
                    if (photoOverlayFrames > pauseFramesPerPhoto - 15) alpha = (pauseFramesPerPhoto - photoOverlayFrames) / 15;
                    else if (photoOverlayFrames < 15) alpha = photoOverlayFrames / 15;
                    bufferCtx.globalAlpha = alpha; bufferCtx.fillStyle = 'rgba(0, 0, 0, 0.65)'; bufferCtx.fillRect(0, 0, exportWidth, exportHeight);
                    let imgW = activePhoto.width; let imgH = activePhoto.height;
                    const maxW = exportWidth * 0.8; const maxH = exportHeight * 0.8;
                    const scale = Math.min(maxW/imgW, maxH/imgH); imgW *= scale; imgH *= scale;
                    const x = (exportWidth - imgW) / 2; const y = (exportHeight - imgH) / 2;
                    bufferCtx.fillStyle = '#ffffff'; bufferCtx.shadowColor = 'rgba(0,0,0,0.8)'; bufferCtx.shadowBlur = 15;
                    bufferCtx.fillRect(x - 6, y - 6, imgW + 12, imgH + 12); bufferCtx.shadowBlur = 0; 
                    bufferCtx.drawImage(activePhoto, x, y, imgW, imgH); bufferCtx.globalAlpha = 1.0;
                    
                    photoOverlayFrames--; if (photoOverlayFrames <= 0) { activePhoto = null; mapProgressFrame++; }
                } else { mapProgressFrame++; }

            } else {
                if (!finaleInitialized) {
                    finaleInitialized = true; currentEndBearing = map.getBearing() || 0; 
                    const endEl = document.createElement('div'); endEl.className = 'flag-anim';
                    endEl.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center;"><div style="font-size:15px; font-weight:900; background:white; color:#D32F2F; padding:4px 10px; border-radius:8px; border:2px solid #D32F2F;">🏆 도착</div></div>`;
                    window.tempExportEndMarker = new mapboxgl.Marker({element: endEl, anchor: 'bottom'}).setLngLat(endPoint).addTo(map);
                }

                let finaleProgress = (mapProgressFrame - routeFrames) / finaleFrames;
                let easeOut = 1 - Math.pow(1 - finaleProgress, 3);
                currentEndBearing += 0.15;

                // 💡 [핵심] 스카이뷰 피날레: 도착점에서 전체 경로 중앙으로 시점 이동하며 50% 줌아웃
                let currentZoom = videoZoom80 + (videoZoom50 - videoZoom80) * easeOut;
                let currentPitch = 60 + (30 - 60) * easeOut;
                let currentCenter = [
                    endPoint[0] + (routeCenter[0] - endPoint[0]) * easeOut,
                    endPoint[1] + (routeCenter[1] - endPoint[1]) * easeOut
                ];

                map.jumpTo({ center: currentCenter, bearing: currentEndBearing, pitch: currentPitch, zoom: currentZoom });
                map.triggerRepaint(); await new Promise(resolve => setTimeout(resolve, 35));
                
                bufferCtx.drawImage(canvas, 0, 0, exportWidth, exportHeight);
                drawFinalHUD(bufferCtx, s.record, s.maxHudAlt);

                mapProgressFrame++;
            }

            const percent = Math.round((totalEncodedFrames / totalFrames) * 100);
            if (totalEncodedFrames > 0 && totalEncodedFrames % 10 === 0) {
                let elapsed = (performance.now() - startTime) / 1000;
                let estTotal = elapsed / (totalEncodedFrames / totalFrames);
                let remaining = Math.max(0, Math.round(estTotal - elapsed));
                updateExportProgress(percent, remaining);
            }

            const timestamp = Math.round((totalEncodedFrames * 1_000_000) / fps);
            const frame = new VideoFrame(bufferCanvas, { timestamp: timestamp, duration: frameDuration, alpha: 'discard' });
            const isKeyFrame = (totalEncodedFrames % (fps * 2) === 0); 
            videoEncoder.encode(frame, { keyFrame: isKeyFrame }); frame.close();
            totalEncodedFrames++;
        }

        if (window.tempExportEndMarker) { window.tempExportEndMarker.remove(); window.tempExportEndMarker = null; }

        await videoEncoder.flush();
        if (chunkCount === 0) throw new Error("인코딩된 프레임이 없습니다.");
        muxer.finalize();
        const buffer = muxer.target.buffer; const blob = new Blob([buffer], { type: 'video/mp4' });
        
        window.lastRenderedVideoFile = new File([blob], `나의등산기_${s.record.name}_리플레이.mp4`, { type: 'video/mp4' });
        window.lastRenderedVideoUrl = URL.createObjectURL(blob);
        isSuccess = true;

    } catch (error) {
        console.error("영상 렌더링 실패:", error); alert("영상 제작 중 오류가 발생했습니다:\n" + error.message);
    } finally {
        removeExportLoadingOverlay(); s.isRenderingVideo = false; window.stopReplay(); 
        if (isSuccess) {
            exportBtn.innerHTML = '<span class="icon">🎁</span><span class="txt" style="color:#FFCA28;">결과공유</span>';
            exportBtn.style.pointerEvents = 'auto'; exportBtn.onclick = window.handleVideoShare;
            alert("🎉 BGM이 포함된 영상 제작 성공!\n하단의 [🎁결과공유] 버튼을 눌러보세요.");
        } else {
            exportBtn.innerHTML = '<span class="icon">🎬</span><span class="txt">저장</span>';
            exportBtn.style.pointerEvents = 'auto'; exportBtn.onclick = window.startVideoExport;
        }
    }
};