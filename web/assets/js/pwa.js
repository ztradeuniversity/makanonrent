/* MakanOnRent — PWA registration + install CTA.

   Two jobs, deliberately kept in one small file:

     1. Register /sw.js (scope '/'), and reload once when a new worker
        takes control so a deploy is never half-applied.
     2. Offer installation — without ever triggering the browser's own
        prompt unasked. beforeinstallprompt is captured and suppressed;
        the native dialog only opens from a real click on our CTA.

   Where beforeinstallprompt does not exist (iOS Safari, most notably)
   the CTA is only shown when the platform genuinely supports Add to Home
   Screen, and it explains the manual step instead of claiming a
   one-tap install that cannot happen. Everywhere else — a desktop
   browser with no install support, or an already-installed window —
   nothing is shown at all. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG || {};
  var SW_URL = (CFG.routes && CFG.routes.serviceWorker) || '/sw.js';
  var STORE_KEY = (CFG.storage && CFG.storage.installDismissed) || 'mor.install.dismissed';

  /* A dismissal is respected for a month: long enough not to nag, short
     enough that someone who now uses the site weekly is asked again. */
  var SNOOZE_DAYS = 30;
  /* Shown after the visitor has actually started reading, not on top of
     first paint. */
  var SHOW_AFTER_MS = 6000;

  /* ── registration ───────────────────────────────────────────── */
  if ('serviceWorker' in navigator) {
    win.addEventListener('load', function () {
      navigator.serviceWorker.register(SW_URL, { scope: '/' }).catch(function () {
        /* An unregistered worker costs offline support and nothing else —
           the site is fully functional without it. */
      });
    });

    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloading) return;
      reloading = true;
      win.location.reload();
    });
  }

  /* ── install state ──────────────────────────────────────────── */
  function isStandalone() {
    return (win.matchMedia && win.matchMedia('(display-mode: standalone)').matches) ||
           win.navigator.standalone === true;
  }

  function snoozed() {
    try {
      var v = Number(localStorage.getItem(STORE_KEY) || 0);
      return v && (Date.now() - v) < SNOOZE_DAYS * 864e5;
    } catch (e) { return false; }
  }

  function snooze() {
    try { localStorage.setItem(STORE_KEY, String(Date.now())); } catch (e) {}
  }

  /* iOS has no beforeinstallprompt and no programmatic install; Add to
     Home Screen is a real capability there, but a manual one, so it is
     described rather than offered as a button. */
  function isIOS() {
    var ua = win.navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
           (/Macintosh/.test(ua) && 'ontouchend' in doc);
  }

  var deferred = null;
  var bar = null;

  /* ── the CTA ────────────────────────────────────────────────── */
  var HOUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/><path d="M10 20v-5.5h4V20"/></svg>';
  var SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  function build(mode) {
    var el = doc.createElement('div');
    el.className = 'pwa-bar';
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'Install MakanOnRent');

    var action = mode === 'ios'
      ? '<span class="pwa-hint">Tap ' + SHARE + ' then <b>Add to Home Screen</b></span>'
      : '<button type="button" class="pwa-go">Install</button>';

    el.innerHTML =
      '<span class="pwa-mark" aria-hidden="true">' + HOUSE + '</span>' +
      '<span class="pwa-copy"><b>Install MakanOnRent</b>' +
        '<span>Verified rentals, one tap away.</span></span>' +
      action +
      '<button type="button" class="pwa-x" aria-label="Dismiss">' + CLOSE + '</button>';

    doc.body.appendChild(el);
    /* A timer rather than requestAnimationFrame: rAF does not run while the
       tab is not being composited, which would leave the bar in the DOM
       but never revealed. One frame's delay is all the transition needs. */
    setTimeout(function () { el.classList.add('is-in'); }, 16);

    el.addEventListener('click', function (e) {
      if (e.target.closest('.pwa-x')) { dismiss(); return; }
      var go = e.target.closest('.pwa-go');
      if (go && deferred) {
        go.disabled = true;
        deferred.prompt();
        deferred.userChoice.then(function (choice) {
          /* Declining the native dialog counts as a dismissal — asking
             again on the next page load would be exactly the nagging this
             is meant to avoid. */
          if (!choice || choice.outcome !== 'accepted') snooze();
          deferred = null;
          hide();
        }).catch(function () { deferred = null; hide(); });
      }
    });

    return el;
  }

  function hide() {
    if (!bar) return;
    var el = bar;
    bar = null;
    el.classList.remove('is-in');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }

  function dismiss() { snooze(); hide(); }

  function show(mode) {
    if (bar || isStandalone() || snoozed()) return;
    bar = build(mode);
  }

  win.addEventListener('beforeinstallprompt', function (e) {
    /* Suppress the browser's own banner; the CTA below is the only path
       to the dialog, and only from a click. */
    e.preventDefault();
    deferred = e;
    setTimeout(function () { show('prompt'); }, SHOW_AFTER_MS);
  });

  win.addEventListener('appinstalled', function () {
    /* Never offer again on this device. */
    snooze();
    hide();
    deferred = null;
  });

  if (isIOS() && !isStandalone()) {
    setTimeout(function () { show('ios'); }, SHOW_AFTER_MS);
  }
})(window, document);
