/**
 * SteamGuard service worker.
 *
 * Responsibilities:
 * - Offline shell: precache the app so TOTP codes keep working without network.
 * - Never cache Steam or proxy traffic. Those requests are authenticated, time
 *   sensitive and rate limited, so they must always hit the network.
 */

const VERSION = 'steamguard-v1';
const SHELL_CACHE = `${VERSION}-shell`;

// The build inlines everything into index.html, so the shell is a single file
// plus the static PWA assets that live next to it.
const SHELL_ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually so one 404 cannot abort the whole install.
      await Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/**
 * Only same-origin GET requests are eligible for caching. Anything aimed at
 * Steam, a CORS proxy or the API is passed straight through.
 */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.pathname.endsWith('/sw.js')) return false;
  return true;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isCacheable(url)) return;

  // Navigations: try the network so deploys take effect, fall back to the
  // cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put('./index.html', fresh.clone());
          return fresh;
        } catch {
          const cached = (await caches.match('./index.html')) || (await caches.match('./'));
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // Static assets: cache first, revalidate in the background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => undefined);

      return cached || (await network) || Response.error();
    })()
  );
});