/* MakanOnRent — admin sign-in page controller.
   Two states in one page: credentials, then (only when the server says
   so) the forced password change for admin-issued temporary passwords. */
(function (win, doc) {
  'use strict';

  var A = win.MOR_ADMIN, CFG = win.MOR_CONFIG;
  var $ = function (id) { return doc.getElementById(id); };

  var loginForm = $('adLoginForm');
  var changeForm = $('adChangeForm');

  /* Credentials are held only for the duration of the change-password
     step, which needs the current password to authorise the change. They
     are never persisted anywhere. */
  var pendingCurrentPassword = '';

  function showChangeStep(currentPassword) {
    pendingCurrentPassword = currentPassword || '';
    loginForm.hidden = true;
    changeForm.hidden = false;
    if (pendingCurrentPassword) {
      $('adCurrentPw').value = pendingCurrentPassword;
      $('adNewPw').focus();
    } else {
      $('adCurrentPw').focus();
    }
  }

  /* Arriving with ?change=1 means admin-core bounced an authenticated but
     not-yet-changed session back here. */
  if (new URLSearchParams(win.location.search).get('change')) showChangeStep('');

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('adLoginBtn');
    var username = $('adUsername').value.trim();
    var password = $('adPassword').value;

    if (!username || !password) {
      A.msg($('adLoginMsg'), 'Enter your username and password.', 'is-error');
      return;
    }

    btn.disabled = true;
    A.msg($('adLoginMsg'), 'Signing in…');

    try {
      var res = await A.post(CFG.routes.api.adminLogin, { username: username, password: password });
      if (res.mustChangePassword) {
        A.msg($('adLoginMsg'), '');
        showChangeStep(password);
        return;
      }
      win.location.href = CFG.routes.adminPage;
    } catch (err) {
      A.msg($('adLoginMsg'), err.message, 'is-error');
      btn.disabled = false;
    }
  });

  changeForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('adChangeBtn');
    var current = $('adCurrentPw').value;
    var next = $('adNewPw').value;
    var confirm = $('adNewPw2').value;

    if (next !== confirm) {
      A.msg($('adChangeMsg'), 'The two new passwords do not match.', 'is-error');
      return;
    }
    /* Mirrors validatePasswordStrength in functions/utils/password.js.
       The server re-checks; this only saves a round trip. */
    if (next.length < 10) {
      A.msg($('adChangeMsg'), 'Password must be at least 10 characters.', 'is-error');
      return;
    }

    btn.disabled = true;
    A.msg($('adChangeMsg'), 'Saving…');

    try {
      await A.post(CFG.routes.api.adminMe, {
        action: 'change-password', currentPassword: current, newPassword: next
      });
      pendingCurrentPassword = '';
      win.location.href = CFG.routes.adminPage;
    } catch (err) {
      A.msg($('adChangeMsg'), err.message, 'is-error');
      btn.disabled = false;
    }
  });
})(window, document);
