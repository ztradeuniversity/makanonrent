/* MakanOnRent — service worker.

   Lives at the site ROOT on purpose: a worker's default scope is the
   directory it is served from, so /sw.js is what gives scope '/'.

   The governing constraint here is not offline support, it is never
   serving stale production code and never storing anything private:

     · Navigations are NETWORK-FIRST. A deploy is picked up on the next
       page load; the cached copy is only a fallback for a dead network.
     · Static assets (CSS/JS/icons) are STALE-WHILE-REVALIDATE. Fast on
       repeat views, and the fresh copy replaces the cached one in the
       same visit — filenames are not content-hashed, so a cache-first
       strategy here would pin old JS until the cache version changed.
     · Everything else — /api/*, the admin console, cross-origin requests
       (including presigned R2 media), and any non-GET — is passed
       straight to the network and never written to a cache.

   Bumping CACHE_VERSION retires every previous cache on activate. */

var CACHE_VERSION = 'mor-v1';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var ASSET_CACHE = CACHE_VERSION + '-assets';

var OFFLINE_URL = '/offline.html';

/* The public shell only. Admin and dashboard pages are deliberately
   absent — they are authenticated surfaces and must never sit in a cache
   on a shared device. */
var PRECACHE = [
  '/',
  '/index.html',
  '/rent.html',
  '/property.html',
  '/submit.html',
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/assets/css/home.css',
  '/assets/css/listing.css',
  '/assets/css/wizard.css',
  '/assets/css/location-search.css',
  '/assets/img/icon-192.png',
  '/assets/img/icon-512.png',
  '/assets/img/favicon-32.png'
];

/* Authenticated surfaces: never cached, never served from a cache. */
var PRIVATE_PATHS = [
  '/api/',
  '/admin.html',
  '/admin-login.html',
  '/location-manager.html',
  '/dashboard.html'
];

function isPrivate(pathname) {
  for (var i = 0; i < PRIVATE_PATHS.length; i++) {
    if (pathname.indexOf(PRIVATE_PATHS[i]) === 0) return true;
  }
  return false;
}

function isAsset(pathname) {
  return /^\/assets\//.test(pathname) || pathname === '/manifest.webmanifest';
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      /* addAll is atomic — one 404 would throw away the whole install, and
         a page added later would silently break the worker. Add
         individually so a missing file costs only that file. */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(CACHE_VERSION) !== 0) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* Lets a page ask the waiting worker to take over immediately. */
self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ── push ────────────────────────────────────────────────────────────
   Kept entirely separate from the caching logic above: a push event never
   touches a cache, and the fetch handler never sees a notification. The
   payload is the JSON built server-side (functions/utils/push-match.js and
   the broadcast endpoint), already matched and already authorised — this
   only renders it. */
var NOTIFICATION_ICON = '/assets/img/icon-192.png';
var NOTIFICATION_BADGE = '/assets/img/icon-maskable-192.png';

self.addEventListener('push', function (event) {
  var data = null;
  try { data = event.data ? event.data.json() : null; } catch (e) { data = null; }

  /* A push with no readable payload still has to show something: the spec
     requires a visible notification for every push, and staying silent
     costs the site its permission in some browsers. */
  var title = (data && data.title) || 'MakanOnRent';
  var body = (data && data.body) || 'Open MakanOnRent for the latest verified rentals.';
  var url = (data && data.url) || '/';

  event.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    /* Collapses repeats of the same subject rather than stacking them. */
    tag: (data && data.kind === 'property' && data.listingId)
      ? 'property-' + data.listingId
      : ((data && data.kind) || 'mor'),
    data: { url: url },
    requireInteraction: false
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';

  /* Focus an existing MakanOnRent tab and steer it to the target rather
     than opening a duplicate window; only open a new one if none exists. */
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.location.origin) !== 0) continue;
        if ('navigate' in c) return c.navigate(target).then(function (x) { return x && x.focus(); });
        return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});

/* The browser can rotate a subscription on its own. Telling the server at
   that moment is what stops it sending to a dead endpoint for ever. */
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil((async function () {
    try {
      var old = event.oldSubscription || null;
      var fresh = event.newSubscription ||
        (old && await self.registration.pushManager.subscribe(old.options));
      if (!fresh) return;

      var raw = fresh.toJSON();
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: 'rotated',
          subscription: { endpoint: raw.endpoint, keys: raw.keys },
          /* The browser rotated the address, not the person's mind. The
             server moves the existing consent and interests across from
             the old endpoint and revokes it, so a rotation neither
             silently silences the visitor nor re-enables anything they
             had turned off. */
          previousEndpoint: old ? old.endpoint : null
        })
      });
    } catch (e) { /* nothing useful to do in a worker with no UI */ }
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  /* Only same-origin GETs are ever eligible. This one condition excludes
     presigned R2 media, form posts and every third-party request. */
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (isPrivate(url.pathname)) return;

  /* Navigations: network first, cache as a fallback, offline page last. */
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(OFFLINE_URL);
        });
      })
    );
    return;
  }

  if (!isAsset(url.pathname)) return;

  /* Assets: serve the cached copy at once, refresh it in the background. */
  event.respondWith(
    caches.open(ASSET_CACHE).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || network;
      });
    })
  );
});
