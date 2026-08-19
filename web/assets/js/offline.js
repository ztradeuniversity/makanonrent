/* Retry button for offline.html. A separate file because the site's CSP
   sets script-src 'self' with no 'unsafe-inline' — an onclick attribute
   here would be silently dead. */
(function (win, doc) {
  'use strict';
  var btn = doc.getElementById('retry');
  if (btn) btn.addEventListener('click', function () { win.location.reload(); });
  /* Coming back online is the moment to retry, without the user asking. */
  win.addEventListener('online', function () { win.location.reload(); });
})(window, document);
