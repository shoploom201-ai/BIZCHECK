/* 오프라인 실행용 서비스 워커 — 파일을 수정해 배포할 때마다 VERSION을 올리세요 */
const VERSION = 'geuntae-v8';
const ASSETS = [
  './app.html', './css/style.css', './manifest.webmanifest', './icon.svg',
  './js/sha256.js', './js/payroll.js', './js/xlsx-lite.js', './js/store.js', './js/app.js', './js/install.js', './js/ads.js', './icon-192.png', './icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 같은 사이트 파일만 처리 (광고 등 외부 요청은 건드리지 않음).
// 네트워크 우선: 온라인이면 항상 최신 파일, 오프라인이면 캐시로 실행
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(c => c || caches.match('./app.html')))
  );
});
