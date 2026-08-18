/* MakanOnRent — shared UI kit for listing + details pages.
   Format helpers · Favourites · Verification badge · Notify modal.
   Loaded after config.js on every Phase-2 page. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG;

  /* ── formatting ─────────────────────────────────────────── */
  var TYPE_LABEL = {
    house: 'House', flat: 'Flat', portion: 'Portion',
    office: 'Office', shop: 'Shop', room: 'Room', other: 'Other'
  };

  /* Pakistani rent convention: Lakh / Crore, not thousands. */
  function fmtPKR(n) {
    n = Number(n) || 0;
    if (n >= 10000000) return trim(n / 10000000) + ' Crore';
    if (n >= 100000)   return trim(n / 100000) + ' Lakh';
    return n.toLocaleString('en-PK');
  }
  function trim(v) { return String(Number(v.toFixed(2))); }

  function fmtRelative(iso) {
    var then = new Date(iso).getTime();
    if (!then) return '';
    var mins = Math.max(1, Math.round((Date.now() - then) / 60000));
    if (mins < 60)   return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hrs = Math.round(mins / 60);
    if (hrs < 24)    return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.round(hrs / 24);
    if (days < 30)   return days + (days === 1 ? ' day ago' : ' days ago');
    var mo = Math.round(days / 30);
    return mo + (mo === 1 ? ' month ago' : ' months ago');
  }

  function fmtSize(rec) {
    return rec.size + ' ' + (rec.sizeUnit === 'marla' ? 'Marla' : 'Sq Ft');
  }

  function typeLabel(t) { return TYPE_LABEL[t] || 'Property'; }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ── media component ────────────────────────────────────────
     One markup contract for every photo surface (card, gallery,
     thumbnail). The branded gradient + glyph is always present in
     the DOM; a real image simply covers it. If the URL is absent
     — or fails to load — the fallback is what remains visible, so
     a broken link can never render a broken-image icon. */
  var MEDIA_GLYPH = '<svg class="ph-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/><path d="M10 20v-5.5h4V20"/></svg>';

  function mediaFill(src, alt) {
    return MEDIA_GLYPH + (src
      ? '<img src="' + esc(src) + '" alt="' + esc(alt) + '" loading="lazy" data-media-fallback>'
      : '');
  }

  /* CSP forbids inline onerror; 'error' doesn't bubble, so listen on
     the capture phase at the document root instead — same effect
     (broken image removed, gradient/glyph remains) for any image
     mediaFill() produces, wherever it ends up in the DOM. */
  doc.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.hasAttribute('data-media-fallback')) t.remove();
  }, true);

  /* First usable image for a record, or null. */
  function cover(rec) {
    return (rec.images && rec.images.length) ? rec.images[0] : null;
  }

  /* ── favourites (local until accounts exist — docs/03 has no
        public-user auth in Phase 2; the API swap is a one-liner) ── */
  var Favourites = (function () {
    var key = CFG.storage.favourites;

    function all() {
      try { return JSON.parse(localStorage.getItem(key) || '[]'); }
      catch (e) { return []; }
    }
    function has(id) { return all().indexOf(id) > -1; }
    function toggle(id) {
      var list = all(), i = list.indexOf(id);
      if (i > -1) list.splice(i, 1); else list.push(id);
      try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
      return i === -1;
    }
    return { all: all, has: has, toggle: toggle };
  })();

  /* ── generic dialog (badge explainer + notify) ───────────── */
  function buildDialog(id, html) {
    var el = doc.createElement('div');
    el.className = 'modal';
    el.id = id;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.hidden = true;
    el.innerHTML = '<div class="modal-card" role="document">' +
      '<button class="modal-close" type="button" data-close aria-label="Close">&times;</button>' + html + '</div>';
    doc.body.appendChild(el);

    var lastFocus = null;
    function open() {
      lastFocus = doc.activeElement;
      el.hidden = false;
      requestAnimationFrame(function () { el.classList.add('is-open'); });
      var f = el.querySelector('input, button:not([data-close])') || el.querySelector('[data-close]');
      if (f) f.focus();
    }
    function close() {
      el.classList.remove('is-open');
      setTimeout(function () {
        el.hidden = true;
        if (lastFocus) lastFocus.focus();
      }, 250);
    }
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) close(); });
    doc.addEventListener('keydown', function (e) {
      if (el.hidden) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var items = el.querySelectorAll('button, input');
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    return { el: el, open: open, close: close };
  }

  var ICON = {
    verified: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5.5v6c0 5 3.4 8.6 8 10.5 4.6-1.9 8-5.5 8-10.5v-6z"/><path d="m9 12 2 2 4-4"/></svg>',
    unverified: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5h.01"/></svg>'
  };

  var BADGE_COPY = {
    verified: {
      title: 'Verified by Manager',
      body: 'This property has been physically verified by the MakanOnRent verification team.'
    },
    unverified: {
      title: 'Not Verified',
      body: 'This property was submitted by the owner or another user and has not yet been physically verified.'
    }
  };

  /* One dialog instance serves every badge on the page. */
  var BadgeInfo = (function () {
    var d = null;
    function show(kind) {
      var c = BADGE_COPY[kind];
      if (!d) {
        d = buildDialog('badgeInfo', '<div class="modal-ic" data-ic></div>' +
          '<h3 data-title></h3><p data-body></p>' +
          '<button class="btn-ghost" type="button" data-close>Got it</button>');
      }
      var card = d.el;
      card.querySelector('[data-ic]').innerHTML = ICON[kind];
      card.querySelector('[data-ic]').className = 'modal-ic ' + (kind === 'verified' ? 'is-verified' : 'is-unverified');
      card.querySelector('[data-title]').textContent = c.title;
      card.querySelector('[data-body]').textContent = c.body;
      card.setAttribute('aria-label', c.title);
      d.open();
    }
    /* Delegated: works for cards rendered at any time. */
    doc.addEventListener('click', function (e) {
      var b = e.target.closest('[data-badge]');
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      show(b.getAttribute('data-badge'));
    });
    return { show: show };
  })();

  function badgeHTML(verified) {
    var kind = verified ? 'verified' : 'unverified';
    return '<button type="button" class="vbadge is-' + kind + '" data-badge="' + kind + '" ' +
      'aria-label="' + BADGE_COPY[kind].title + ' — what does this mean?">' +
      ICON[kind] + '<span>' + BADGE_COPY[kind].title + '</span></button>';
  }

  /* ── notify modal (low-result alerts) ───────────────────── */
  var Notify = (function () {
    var d = null, msg, input;

    function build() {
      d = buildDialog('notifyModal',
        '<div class="modal-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></div>' +
        '<h3>Get Instant Alerts</h3>' +
        '<p>We’ll email you the moment a new verified property matches your search.</p>' +
        '<form class="modal-form" novalidate>' +
          '<div class="control">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>' +
            '<input type="email" placeholder="Email address" autocomplete="email" required aria-label="Email address" />' +
          '</div>' +
          '<p class="form-msg" role="status" aria-live="polite"></p>' +
          '<button class="btn-gold" type="submit">Notify Me</button>' +
        '</form>');
      d.el.setAttribute('aria-label', 'Get instant alerts');
      msg = d.el.querySelector('.form-msg');
      input = d.el.querySelector('input');

      d.el.querySelector('form').addEventListener('submit', function (e) {
        e.preventDefault();
        var val = input.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(val)) {
          msg.textContent = 'Please enter a valid email address.';
          msg.className = 'form-msg is-error';
          input.focus();
          return;
        }
        /* The local copy is kept as a per-device record, but the request
           itself now goes to the server — a queue in localStorage can
           never result in an email being sent. MOR_CRITERIA is the live
           search the results page is showing, so the saved alert is
           exactly the search that returned nothing. */
        var criteria = win.MOR_CRITERIA || {};
        try {
          var key = CFG.storage.alertQueue;
          var q = JSON.parse(localStorage.getItem(key) || '[]');
          q.push({ email: val, criteria: criteria, at: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(q));
        } catch (err) {}

        msg.textContent = 'Saving…';
        msg.className = 'form-msg';

        var btn = d.el.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;

        win.fetch(CFG.routes.api.notifyProperty, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entityType: 'search', email: val, criteria: criteria })
        }).then(function (r) {
          return r.json().catch(function () { return null; }).then(function (data) {
            if (!r.ok) throw new Error((data && data.error) || 'Could not save that request.');
            return data;
          });
        }).then(function () {
          msg.textContent = 'Done — we’ll email you when a match is listed.';
          msg.className = 'form-msg is-ok';
          setTimeout(function () {
            d.close(); input.value = ''; msg.textContent = '';
            if (btn) btn.disabled = false;
          }, 1400);
        }).catch(function (err) {
          msg.textContent = err.message;
          msg.className = 'form-msg is-error';
          if (btn) btn.disabled = false;
        });
      });
    }

    function open() { if (!d) build(); d.open(); }
    doc.addEventListener('click', function (e) {
      if (e.target.closest('[data-notify-open]')) { e.preventDefault(); open(); }
    });
    return { open: open };
  })();

  /* ── contact links ──────────────────────────────────────── */
  /* A record from the public listing endpoint carries no phone/email —
     owner contact details are private and are not served to the browser
     — so the contact links are null for it rather than 'tel:undefined'.
     Fixture records still have both, so their links are unchanged. */
  function links(rec) {
    var label = rec.title + ' (' + (rec.reference || rec.id) + ')';
    var ref = encodeURIComponent(label);
    return {
      wa:    rec.phone ? 'https://wa.me/' + String(rec.phone).replace(/\D/g, '') + '?text=' +
             encodeURIComponent('Assalam o Alaikum, I am interested in: ' + label) : null,
      tel:   rec.phone ? 'tel:' + rec.phone : null,
      mail:  rec.email ? 'mailto:' + rec.email + '?subject=' + ref : null,
      details: CFG.routes.detailsPage + '?id=' + encodeURIComponent(rec.id)
    };
  }

  win.MOR_UI = {
    fmtPKR: fmtPKR, fmtRelative: fmtRelative, fmtSize: fmtSize, typeLabel: typeLabel,
    esc: esc, mediaFill: mediaFill, cover: cover, mediaGlyph: MEDIA_GLYPH,
    Favourites: Favourites, badgeHTML: badgeHTML, BadgeInfo: BadgeInfo,
    Notify: Notify, links: links, buildDialog: buildDialog, icon: ICON
  };
})(window, document);
