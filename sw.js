/* Service worker van de geïnstalleerde web-app: werkt offline en werkt zichzelf bij.
   VERSION wordt bij het publiceren gezet (publish.ps1); een nieuwe versie haalt alle bestanden opnieuw op. */
const VERSION = '2026.11.01-1909';
const CACHE = 'schietkaart-' + VERSION;
const FILES = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/imgproc.js', './js/target.js', './js/detect.js', './js/report.js', './js/store.js', './js/zip.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('schietkaart-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'version' && e.source) e.source.postMessage({ version: VERSION });
});
