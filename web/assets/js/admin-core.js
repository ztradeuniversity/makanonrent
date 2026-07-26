/* MakanOnRent — admin console shared runtime.
   Exposes MOR_ADMIN: the API client, the session guard and small render
   helpers used by admin-login.js and admin-console.js.

   There is NO token in this file and none in localStorage. The session is
   an HttpOnly cookie the browser attaches automatically, which is exactly
   why JavaScript cannot read it — an XSS on this page cannot exfiltrate a
   session it has no access to. `credentials: 'same-origin'` is what makes
   the cookie travel; do not replace it with a bearer token. */
(function (root) {
  'use strict';

  var CFG = root.MOR_CONFIG;
  var API = CFG.routes.api;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Every response shape in functions/api/admin/* is either a JSON body or
     a JSON { error }. This normalises both into a thrown Error carrying the
     status, so callers use one try/catch instead of checking r.ok. */
  async function request(url, options) {
    var res = await fetch(url, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    }, options || {}));

    var data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }

    if (!res.ok) {
      var err = new Error((data && data.error) || ('Request failed (' + res.status + ')'));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function get(url) { return request(url, { method: 'GET' }); }
  function post(url, body) {
    return request(url, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  /* Boots an authenticated page. Redirects to the login page on 401 rather
     than rendering an empty console, and to the login page's change-password
     step when the account still holds an admin-issued temporary password. */
  async function requireSession(opts) {
    try {
      var me = await get(API.adminMe);
      if (me.user.mustChangePassword && !(opts && opts.allowPasswordChange)) {
        root.location.href = CFG.routes.adminLoginPage + '?change=1';
        return null;
      }
      return me;
    } catch (e) {
      if (e.status === 401) {
        root.location.href = CFG.routes.adminLoginPage;
        return null;
      }
      throw e;
    }
  }

  function msg(el, text, cls) {
    if (!el) return;
    el.textContent = text || '';
    el.className = 'ad-msg' + (cls ? ' ' + cls : '');
  }

  var ROLE_LABEL = { ceo: 'CEO', assistant_ceo: 'Assistant CEO', manager: 'Manager' };

  function roleLabel(role) { return ROLE_LABEL[role] || role; }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function todayISO() { return new Date().toISOString().slice(0, 10); }

  /* Rs formatting reuses the product's PKR-first convention (minor units
     are stored, whole rupees are shown). */
  function fmtRent(minor) {
    if (minor == null) return '—';
    return 'Rs ' + Number(minor).toLocaleString('en-PK');
  }

  root.MOR_ADMIN = {
    esc: esc,
    get: get,
    post: post,
    requireSession: requireSession,
    msg: msg,
    roleLabel: roleLabel,
    fmtDateTime: fmtDateTime,
    fmtDate: fmtDate,
    fmtRent: fmtRent,
    todayISO: todayISO,
    API: API
  };
})(window);
