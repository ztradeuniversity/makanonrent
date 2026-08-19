/* MakanOnRent — owner session (browser side).

   A thin read of /api/owner/me plus the two navigation actions. There is
   deliberately no token here and no client-side auth library: the session
   lives in an HttpOnly cookie the browser cannot read, so the only thing
   this file can do is ASK the server who the visitor is.

   That is also why there is no cached "signedIn" flag in localStorage.
   The wizard used to keep exactly such a flag and treat it as proof of
   sign-in, which is how the Google button ended up authenticating
   nobody. The server is the only authority. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG || {};
  var API = (CFG.routes && CFG.routes.api) || {};

  var cached = null;

  /* One in-flight request shared by every caller on the page. */
  var pending = null;

  function load(force) {
    if (!force && cached) return Promise.resolve(cached);
    if (pending) return pending;
    if (!API.ownerMe || !win.fetch) return Promise.resolve({ signedIn: false });

    pending = win.fetch(API.ownerMe, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { signedIn: false }; })
      .catch(function () { return { signedIn: false }; })
      .then(function (data) {
        cached = data && data.signedIn ? data : { signedIn: false };
        pending = null;
        return cached;
      });
    return pending;
  }

  /* Sends the browser to Google. `next` is where to come back to. */
  function signIn(next) {
    if (!API.ownerLogin) return;
    var target = next || (win.location.pathname + win.location.search);
    win.location.href = API.ownerLogin + '?next=' + encodeURIComponent(target);
  }

  function signOut(next) {
    if (!API.ownerLogout || !win.fetch) return Promise.resolve();
    return win.fetch(API.ownerLogout, { method: 'POST', credentials: 'same-origin' })
      .catch(function () {})
      .then(function () {
        cached = null;
        win.location.href = next || CFG.routes.listingPage || 'index.html';
      });
  }

  /* Reads the ?signin= flag the callback appends, so a page can explain a
     cancelled or failed attempt, then removes it from the URL so a
     refresh does not repeat the message. */
  function consumeSigninFlag() {
    var params = new URLSearchParams(win.location.search);
    var flag = params.get('signin');
    if (!flag) return null;
    params.delete('signin');
    var qs = params.toString();
    try {
      win.history.replaceState({}, '',
        win.location.pathname + (qs ? '?' + qs : '') + win.location.hash);
    } catch (e) {}
    return flag;
  }

  win.MOR_OWNER_SESSION = {
    load: load,
    signIn: signIn,
    signOut: signOut,
    consumeSigninFlag: consumeSigninFlag,
    current: function () { return cached; }
  };
})(window, document);
