// =====================================================================
//  Service worker: quick opening from the home screen, clean updates
// =====================================================================
//  The browser runs this small helper alongside the app. It keeps a
//  copy of the app's own files (pages, styles, code, icons) so the app
//  opens even on a weak signal.
//
//  It never keeps records. Those come from Supabase every time, and
//  nothing from private/ is ever stored here.
//
//  Each time a file is needed, it asks the website for the latest
//  version first, and only uses its saved copy if the network doesn't
//  answer within 4 seconds. So a new version of the app shows up the
//  next time it's opened, all files together.
// =====================================================================

const CACHE = 'pup-health-app';
const WAIT_MS = 4000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only the app's own files. Supabase (records, logins), the Supabase
  // helper library, and private/ go straight to the network as usual.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/private/')) return;
  event.respondWith(latestOrSaved(request));
});

async function latestOrSaved(request) {
  const cache = await caches.open(CACHE);
  // "no-cache": check with the website every time (cheap when nothing
  // changed), instead of trusting the browser's own copy.
  const fromNetwork = fetch(request, { cache: 'no-cache' }).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  fromNetwork.catch(() => {});   // a late failure after using the saved copy is fine
  const slow = new Promise((resolve) => setTimeout(resolve, WAIT_MS, 'slow'));
  try {
    const first = await Promise.race([fromNetwork, slow]);
    if (first !== 'slow') return first;
    // Slow network: use the saved copy if there is one, else keep waiting.
    return (await cache.match(request, { ignoreSearch: true })) || (await fromNetwork);
  } catch {
    // No network at all.
    return (await cache.match(request, { ignoreSearch: true })) || Response.error();
  }
}
