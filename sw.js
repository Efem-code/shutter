/* Shutter service worker — the app has to work at a venue with no signal. */
/* BUILD is rewritten by deploy.sh on every deploy. It has to change or the
   browser sees an identical service worker, keeps the old one, and the update
   never reaches the phone. */
const BUILD = '20261005-205625';
const PREFIX = 'shutter-';
const CACHE = PREFIX + BUILD;
const SHELL = [
  './', './index.html', './styles.css', './data.js', './wb.js', './app.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  /* cache: 'reload' skips the browser's HTTP cache. GitHub Pages sends
     max-age=600, so a plain addAll could store the *previous* app.js under the
     new build's name and the update would silently never show. Every file must
     come back 200: an error page from a half-published deploy would be cached
     for good, so a bad response fails the install and the browser retries. */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => {
      if (!r.ok) throw new Error(u + ' -> ' + r.status);
      return c.put(u, r);
    }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  /* Every app lives on the same origin (efem-code.github.io), so they share
     one CacheStorage. Only clear this app's old builds, never another app's. */
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== location.origin) return;

  /* Stale-while-revalidate: answer instantly from the cache so a tip never
     waits on the network, but always refetch in the background so a redeploy
     lands on the next launch. Pure cache-first would pin the app to whatever
     version was installed first until the cache name changed, which is a
     genuinely confusing failure — the phone keeps running old code after an
     update that looked like it worked. */
  e.respondWith(
    caches.match(req, { cacheName: CACHE }).then(hit => {
      const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || caches.match('./index.html', { cacheName: CACHE }));
      return hit || fresh;
    })
  );
});
