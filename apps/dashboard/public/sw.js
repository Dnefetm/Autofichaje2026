// Service worker — soporte offline básico para la vista del operario.
const CACHE = 'gestor-full-v1';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    event.respondWith(
        fetch(event.request)
            .then((res) => {
                const clone = res.clone();
                caches.open(CACHE).then((c) => c.put(event.request, clone)).catch(() => {});
                return res;
            })
            .catch(() => caches.match(event.request).then((m) => m || caches.match('/envios/preparacion')))
    );
});
