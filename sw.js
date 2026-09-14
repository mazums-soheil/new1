/* MAZUMS GitHub Pages freshness helper.
   - Navigations receive a unique query token so an installed service worker can
     bypass stale edge/browser HTML.
   - Static assets are NOT intercepted: HTML/CSS/JS already use a build-version
     query, preserving native media range requests and avoiding playback bugs. */
const BUILD = '20260914-cinema-v3-loader';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('/sw.js')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode !== 'navigate') return;

  const freshURL = new URL(request.url);
  freshURL.searchParams.set('__fresh', `${BUILD}-${Date.now().toString(36)}`);
  event.respondWith(
    fetch(freshURL.href, {
      method: 'GET',
      credentials: 'same-origin',
      redirect: 'follow',
      cache: 'no-store',
      headers: { 'Accept': request.headers.get('Accept') || 'text/html' }
    }).catch(() => fetch(request, { cache: 'reload' }))
  );
});
