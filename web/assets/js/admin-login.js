/* MakanOnRent — admin/team sign-in page controller.
   Three states in one page: credentials (+ optional OTP step for accounts
   that carry a registered email), then the forced password change for
   admin-issued temporary passwords. */
(function (win, doc) {
  'use strict';

  var A = win.MOR_ADMIN, CFG = win.MOR_CONFIG;
  var $ = function (id) { return doc.getElementById(id); };

  var loginForm = $('adLoginForm');
  var otpForm = $('adOtpForm');
  var changeForm = $('adChangeForm');

  /* Credentials are held only for the duration of the change-password
     step, which needs the current password to authorise the change. They
     are never persisted anywhere. */
  var pendingCurrentPassword = '';

  function showLoginStep() {
    otpForm.hidden = true;
    loginForm.hidden = false;
    $('adPassword').focus();
  }

  function showOtpStep(maskedEmail) {
    loginForm.hidden = true;
    otpForm.hidden = false;
    $('adOtpNote').textContent = maskedEmail
      ? 'Enter the one-time code sent to ' + maskedEmail + '.'
      : 'Enter the one-time code sent to your email.';
    $('adOtpCode').value = '';
    $('adOtpCode').focus();
  }

  function showChangeStep(currentPassword) {
    pendingCurrentPassword = currentPassword || '';
    loginForm.hidden = true;
    otpForm.hidden = true;
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

  function finishLogin(res) {
    if (res.mustChangePassword) {
      A.msg($('adLoginMsg'), '');
      showChangeStep('');
      return;
    }
    win.location.href = CFG.routes.adminPage;
  }

  loginForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('adLoginBtn');
    var username = $('adUsername').value.trim();
    var password = $('adPassword').value;
    var email = $('adEmail').value.trim();

    if (!username || !password) {
      A.msg($('adLoginMsg'), 'Enter your username and password.', 'is-error');
      return;
    }

    btn.disabled = true;
    A.msg($('adLoginMsg'), 'Signing in…');

    try {
      var res = await A.post(CFG.routes.api.adminLogin, {
        step: 'credentials', username: username, password: password, email: email
      });
      if (res.otpRequired) {
        A.msg($('adLoginMsg'), '');
        win.MOR_PENDING_OTP_ID = res.otpId;
        showOtpStep(res.maskedEmail);
        return;
      }
      finishLogin(res);
    } catch (err) {
      A.msg($('adLoginMsg'), err.message, 'is-error');
    }
    btn.disabled = false;
  });

  otpForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    var btn = $('adOtpBtn');
    var code = $('adOtpCode').value.trim();

    if (!code) {
      A.msg($('adOtpMsg'), 'Enter the code from your email.', 'is-error');
      return;
    }

    btn.disabled = true;
    A.msg($('adOtpMsg'), 'Verifying…');

    try {
      var res = await A.post(CFG.routes.api.adminLogin, {
        step: 'otp', otpId: win.MOR_PENDING_OTP_ID, code: code
      });
      finishLogin(res);
    } catch (err) {
      A.msg($('adOtpMsg'), err.message, 'is-error');
      btn.disabled = false;
    }
  });

  $('adOtpBack').addEventListener('click', function () {
    win.MOR_PENDING_OTP_ID = null;
    A.msg($('adOtpMsg'), '');
    showLoginStep();
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
