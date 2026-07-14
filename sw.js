const CACHE_NAME = 'peaklog-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.js'
];

// 설치 시 캐시 파일 저장
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

// 활성화 시 예전 캐시 삭제 (여기서 오류가 해결됩니다!)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
});

// 네트워크 요청 처리
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    }).catch(() => {
      // 네트워크 연결이 끊겼을 때 등 예외 상황 방어
      return caches.match('./index.html');
    })
  );
});