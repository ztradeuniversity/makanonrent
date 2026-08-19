/* MakanOnRent — notification consent + subscription (browser side).

   Three jobs:

     1. Record, locally and within hard caps, what this visitor seems
        interested in — the searches they ran and the properties they
        opened. This is the same criteria shape the search page already
        builds, so the server matches it with the existing Notify Me
        matcher rather than a second one.

     2. Ask for notification permission ONLY after the visitor presses a
        button in our own prompt. The native permission dialog is never
        triggered on load: a dialog nobody asked for is how a site loses
        the permission for good.

     3. Keep the subscription and the two consent flags in step with the
        server.

   Privacy posture: visitorId is a random UUID this browser generates for
   itself and nothing else — it is not derived from the device, the
   screen, the fonts, the IP or anything about the person. Interests are
   capped at 10 searches and 20 property ids, stay in localStorage, and
   are only ever sent alongside a subscription the visitor asked for.
   Turning notifications off revokes server-side and clears them here. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG || {};
  var API = (CFG.routes && CFG.routes.api) || {};
  var S = CFG.storage || {};

  var K_VISITOR = S.visitorId || 'mor:visitorId';
  var K_INTEREST = S.pushInterests || 'mor:pushInterests';
  var K_PREFS = S.pushPrefs || 'mor:pushPrefs';
  var K_ASKED = S.pushAsked || 'mor:pushAsked';

  var MAX_SEARCHES = 10;
  var MAX_VIEWED = 20;
  var SNOOZE_DAYS = 45;
  /* Shown only once the visitor has done something that implies interest
     (a search, or opening a property), never on a cold first paint. */
  var SHOW_DELAY_MS = 2500;

  /* ── storage helpers ───────────────────────────────────────────── */
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function visitorId() {
    var id = null;
    try { id = localStorage.getItem(K_VISITOR); } catch (e) {}
    if (id) return id;
    id = (win.crypto && win.crypto.randomUUID)
      ? win.crypto.randomUUID()
      : 'v-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    try { localStorage.setItem(K_VISITOR, id); } catch (e) {}
    return id;
  }

  function prefs() {
    return read(K_PREFS, { propertyInterest: false, siteUpdates: false });
  }

  /* ── interest capture (bounded) ────────────────────────────────── */
  var CRITERIA_KEYS = ['city', 'area', 'subarea', 'category', 'type',
                       'beds', 'budgetMin', 'budgetMax', 'areaSize', 'areaUnit', 'needs'];

  function tidyCriteria(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var out = {}, kept = 0;
    CRITERIA_KEYS.forEach(function (k) {
      var v = raw[k];
      if (v === null || v === undefined || v === '') return;
      out[k] = v; kept++;
    });
    return kept ? out : null;
  }

  function interests() {
    var i = read(K_INTEREST, {});
    return {
      searches: Array.isArray(i.searches) ? i.searches : [],
      viewed: Array.isArray(i.viewed) ? i.viewed : []
    };
  }

  /* Newest first, de-duplicated, hard-capped. The cap is the whole point:
     this is a rolling window of recent intent, not a browsing history. */
  function rememberSearch(criteria) {
    var c = tidyCriteria(criteria);
    if (!c) return;
    var i = interests();
    var key = JSON.stringify(c);
    i.searches = [c].concat(i.searches.filter(function (s) {
      return JSON.stringify(s) !== key;
    })).slice(0, MAX_SEARCHES);
    write(K_INTEREST, i);
    syncIfSubscribed();
  }

  function rememberViewed(listingId) {
    if (!listingId || typeof listingId !== 'string') return;
    var i = interests();
    i.viewed = [listingId].concat(i.viewed.filter(function (v) { return v !== listingId; }))
      .slice(0, MAX_VIEWED);
    write(K_INTEREST, i);
    syncIfSubscribed();
  }

  function forget() {
    try { localStorage.removeItem(K_INTEREST); } catch (e) {}
  }

  /* ── subscription ──────────────────────────────────────────────── */
  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in win && 'Notification' in win;
  }

  function urlBase64ToUint8Array(base64) {
    var padding = '='.repeat((4 - base64.length % 4) % 4);
    var b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function vapidKey() {
    if (!API.pushKey) return Promise.resolve(null);
    return win.fetch(API.pushKey)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.key) || null; })
      .catch(function () { return null; });
  }

  function post(payload) {
    if (!API.pushSubscribe) return Promise.reject(new Error('Push is unavailable.'));
    return win.fetch(API.pushSubscribe, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (d) {
        if (!r.ok) throw new Error((d && d.error) || 'Could not save your preferences.');
        return d;
      });
    });
  }

  function currentSubscription() {
    if (!supported()) return Promise.resolve(null);
    return navigator.serviceWorker.ready
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .catch(function () { return null; });
  }

  /* Pushes the latest interest profile up, but only for a browser that is
     already subscribed — this never causes a subscription to appear. */
  var syncTimer = null;
  function syncIfSubscribed() {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      var p = prefs();
      if (!p.propertyInterest && !p.siteUpdates) return;
      currentSubscription().then(function (sub) {
        if (!sub) return;
        var raw = sub.toJSON();
        post({
          visitorId: visitorId(),
          subscription: { endpoint: raw.endpoint, keys: raw.keys },
          propertyInterest: p.propertyInterest,
          siteUpdates: p.siteUpdates,
          interests: interests()
        }).catch(function () {});
      });
    }, 1200);
  }

  /* The one place the native permission dialog is opened, and only ever
     from a click inside our own prompt. */
  function enable(opts) {
    opts = opts || {};
    if (!supported()) return Promise.reject(new Error('This browser does not support notifications.'));

    return Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') {
        /* Denied is a decision, and it is remembered: re-asking a browser
           that said no is both futile and hostile. */
        markAsked();
        return { granted: false, permission: permission };
      }
      return vapidKey().then(function (key) {
        if (!key) throw new Error('Notifications are not configured yet.');
        return navigator.serviceWorker.ready.then(function (reg) {
          return reg.pushManager.getSubscription().then(function (existing) {
            return existing || reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(key)
            });
          });
        });
      }).then(function (sub) {
        var raw = sub.toJSON();
        var next = {
          propertyInterest: opts.propertyInterest !== false,
          siteUpdates: opts.siteUpdates !== false
        };
        return post({
          visitorId: visitorId(),
          subscription: { endpoint: raw.endpoint, keys: raw.keys },
          propertyInterest: next.propertyInterest,
          siteUpdates: next.siteUpdates,
          interests: interests()
        }).then(function () {
          write(K_PREFS, next);
          markAsked();
          return { granted: true, permission: 'granted', prefs: next };
        });
      });
    });
  }

  /* Change one stream without touching the other, or the permission. */
  function setPreferences(next) {
    var merged = Object.assign(prefs(), next || {});
    return currentSubscription().then(function (sub) {
      if (!sub) { write(K_PREFS, merged); return merged; }
      var raw = sub.toJSON();
      return post({
        visitorId: visitorId(),
        subscription: { endpoint: raw.endpoint, keys: raw.keys },
        propertyInterest: merged.propertyInterest === true,
        siteUpdates: merged.siteUpdates === true,
        interests: interests()
      }).then(function () { write(K_PREFS, merged); return merged; });
    });
  }

  /* Full opt-out: the server row is revoked, the browser subscription is
     dropped, and the local interest profile is deleted. */
  function disable() {
    return currentSubscription().then(function (sub) {
      var done = Promise.resolve();
      if (sub) {
        var raw = sub.toJSON();
        done = post({
          visitorId: visitorId(),
          subscription: { endpoint: raw.endpoint, keys: raw.keys },
          revoke: true
        }).catch(function () {}).then(function () {
          return sub.unsubscribe().catch(function () {});
        });
      }
      return done.then(function () {
        write(K_PREFS, { propertyInterest: false, siteUpdates: false });
        forget();
        return { propertyInterest: false, siteUpdates: false };
      });
    });
  }

  /* ── the prompt ────────────────────────────────────────────────── */
  function asked() {
    var t = read(K_ASKED, 0);
    return t && (Date.now() - t) < SNOOZE_DAYS * 864e5;
  }
  function markAsked() { write(K_ASKED, Date.now()); }

  var BELL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var bar = null;

  function hide() {
    if (!bar) return;
    var el = bar;
    bar = null;
    el.classList.remove('is-in');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }

  function showPrompt() {
    if (bar || !supported() || asked()) return;
    if (Notification.permission !== 'default') return;
    if (!API.pushKey) return;

    /* Only offered where it can actually work: no key configured means no
       prompt, rather than a button that fails when pressed. */
    vapidKey().then(function (key) {
      if (!key || bar) return;

      var el = doc.createElement('div');
      el.className = 'push-bar';
      el.setAttribute('role', 'complementary');
      el.setAttribute('aria-label', 'Notification preferences');
      el.innerHTML =
        '<span class="push-mark" aria-hidden="true">' + BELL + '</span>' +
        '<span class="push-copy"><b>Get updates for properties you may be interested in.</b>' +
          '<label class="push-opt"><input type="checkbox" data-opt="property" checked> Property matches</label>' +
          '<label class="push-opt"><input type="checkbox" data-opt="updates" checked> MakanOnRent updates</label>' +
        '</span>' +
        '<button type="button" class="push-go">Allow Notifications</button>' +
        '<button type="button" class="push-x" aria-label="Not now">' + CLOSE + '</button>';

      doc.body.appendChild(el);
      bar = el;
      setTimeout(function () { el.classList.add('is-in'); }, 16);

      el.addEventListener('click', function (e) {
        if (e.target.closest('.push-x')) { markAsked(); hide(); return; }
        var go = e.target.closest('.push-go');
        if (!go) return;

        var wantProperty = el.querySelector('[data-opt="property"]').checked;
        var wantUpdates = el.querySelector('[data-opt="updates"]').checked;
        if (!wantProperty && !wantUpdates) { markAsked(); hide(); return; }

        go.disabled = true;
        go.textContent = 'Enabling…';
        enable({ propertyInterest: wantProperty, siteUpdates: wantUpdates })
          .then(function () { hide(); })
          .catch(function () { hide(); });
      });
    });
  }

  /* Interest-led, not load-led: the prompt only appears once the visitor
     has actually searched or opened a property in this browser. */
  function maybePrompt() {
    var i = interests();
    if (!i.searches.length && !i.viewed.length) return;
    setTimeout(showPrompt, SHOW_DELAY_MS);
  }

  win.MOR_PUSH = {
    supported: supported,
    visitorId: visitorId,
    prefs: prefs,
    interests: interests,
    rememberSearch: rememberSearch,
    rememberViewed: rememberViewed,
    enable: enable,
    disable: disable,
    setPreferences: setPreferences,
    showPrompt: showPrompt,
    maybePrompt: maybePrompt,
    forget: forget,
    MAX_SEARCHES: MAX_SEARCHES,
    MAX_VIEWED: MAX_VIEWED
  };

  win.addEventListener('load', function () { maybePrompt(); });
})(window, document);
