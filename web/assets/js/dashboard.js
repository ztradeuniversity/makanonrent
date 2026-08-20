/* MakanOnRent — Owner Dashboard (frontend only).
   Sections: My Properties · Pending Review · Live · Rejected ·
   Archived · Add Property. Every card reserves an availability
   strip so the future daily confirmation service can drive it
   without a redesign. No backend, no email, no scheduling. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, UI = win.MOR_UI, LOC = win.MOR_LOC;
  var $ = function (id) { return doc.getElementById(id); };

  /* ── data source ─────────────────────────────────────────────
     GET /api/properties/mine, and nothing else. The fixture module
     this page used to read (owner-data.js) is deliberately gone: a
     dashboard that falls back to invented properties when the API is
     unreachable tells the owner their submission is fine when nobody
     knows whether it is. An error is shown instead.

     The API shape is mapped to the shape the renderers below already
     expect, so nothing about the cards changed. */
  var DATA = (function () {
    var rows = [];

    function map(p) {
      return {
        /* The business reference is what the owner was given on the
           success screen, so it is what they see and search by. */
        id: p.reference || p.listingId,
        listingId: p.listingId,
        title: p.title,
        city: p.city,
        area: p.mainLocation,
        subArea: p.subLocation,
        rent: p.rent,
        type: p.type,
        status: p.status,
        submittedAt: p.submittedAt,
        updatedAt: p.updatedAt,
        published: p.published,
        lifecycleLabel: p.lifecycleLabel,
        /* Rejection / return explanation, straight from the lifecycle
           history the reviewer wrote. */
        reason: p.reason || null,
        review: { stage: p.approvalLabel || p.lifecycleLabel, reason: p.reason || null },
        /* Photos come from the signed media route, never from a stored
           permanent link; the card renders its placeholder until an
           owner-side gallery exists. */
        images: [],
        /* No owner-facing availability or analytics service exists yet.
           Stating that plainly beats showing invented numbers. */
        availability: { state: p.published ? 'not_applicable' : 'not_applicable' },
        stats: { views: null, whatsapp: null, calls: null }
      };
    }

    return {
      list: function () { return rows.slice(); },
      byId: function (id) {
        return rows.filter(function (r) { return r.id === id || r.listingId === id; })[0] || null;
      },
      load: function () {
        return win.fetch(CFG.routes.api.myProperties, { credentials: 'same-origin' })
          .then(function (res) {
            if (res.status === 401) { var e = new Error('signed-out'); e.signedOut = true; throw e; }
            if (!res.ok) throw new Error('Could not load your properties.');
            return res.json();
          })
          .then(function (data) {
            rows = ((data && data.properties) || []).map(map);
            return rows;
          });
      }
    };
  })();

  var host = $('ocards');
  var view = 'all';
  var query = '';

  var STATUS = {
    live:           { label: 'Live',           cls: 'is-live' },
    pending_review: { label: 'Pending Review', cls: 'is-pending' },
    rejected:       { label: 'Rejected',       cls: 'is-rejected' },
    archived:       { label: 'Archived',       cls: 'is-archived' }
  };

  var IC = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg>',
    dot:   '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>',
    cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    edit:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    arch:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1.4"/><path d="M5 8v11a1.6 1.6 0 0 0 1.6 1.6h10.8A1.6 1.6 0 0 0 19 19V8"/><path d="M10 12h4"/></svg>',
    eye:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    undo:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v6h6"/><path d="M3.5 13a9 9 0 1 0 2.5-7.6L3 9"/></svg>',
    fix:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4z"/></svg>',
    warn:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
    mail:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>',
    camera:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.6-2h6.8L17 8h3a1.6 1.6 0 0 1 1.6 1.6v8.8A1.6 1.6 0 0 1 20 20H4a1.6 1.6 0 0 1-1.6-1.6V9.6A1.6 1.6 0 0 1 4 8z"/><circle cx="12" cy="13.5" r="3.2"/></svg>'
  };

  /* ── availability strip — reserved on EVERY card ─────────────
     The daily confirmation email will simply flip `confirmedAt`;
     every state below already renders. */
  var AVAIL_COPY = {
    confirmed: ['Available', 'Confirmed {when}'],
    due:       ['Please confirm availability', 'Last confirmed {when}'],
    stale:     ['Availability not confirmed', 'Tenants see this listing as unconfirmed'],
    not_applicable: ['Availability tracking', 'Starts once your property is live']
  };

  function availHTML(rec) {
    var a = rec.availability || { state: 'not_applicable' };
    var copy = AVAIL_COPY[a.state] || AVAIL_COPY.not_applicable;
    var when = a.confirmedAt ? UI.fmtRelative(a.confirmedAt) : 'not yet';
    var sub = copy[1].replace('{when}', when);
    var canConfirm = a.state === 'due' || a.state === 'stale';

    return '<div class="avail is-' + (a.state === 'not_applicable' ? 'na' : a.state) + '">' +
      '<span class="a-dot" aria-hidden="true"></span>' +
      '<span class="a-txt">' + copy[0] + '<span>' + sub + '</span></span>' +
      (canConfirm
        ? '<button class="btn-confirm" type="button" data-act="confirm" data-id="' + rec.id + '">Yes, still available</button>'
        : '') +
    '</div>';
  }

  /* ── review timeline (pending + rejected) ───────────────── */
  function timelineHTML(rec) {
    var rejected = rec.status === 'rejected';
    var stage = (rec.review && rec.review.stage) || 'submitted';

    var nodes = [
      { key: 'submitted', label: 'Submitted', when: UI.fmtRelative(rec.submittedAt) },
      { key: 'under_review', label: 'Under Review', when: rejected ? '' : 'within ' + CFG.owner.reviewHours + 'h' },
      rejected
        ? { key: 'rejected', label: 'Rejected', when: rec.review.reviewedAt ? UI.fmtRelative(rec.review.reviewedAt) : '' }
        : { key: 'approved', label: 'Approved', when: '' }
    ];

    var order = ['submitted', 'under_review', rejected ? 'rejected' : 'approved'];
    var at = order.indexOf(stage) > -1 ? order.indexOf(stage) : 0;

    var html = nodes.map(function (n, i) {
      var cls, icon;
      if (rejected && i === 2) { cls = 'is-fail'; icon = IC.cross; }
      else if (i < at) { cls = 'is-done'; icon = IC.check; }
      else if (i === at) { cls = 'is-current'; icon = IC.dot; }
      else { cls = 'is-idle'; icon = IC.dot; }
      return '<div class="tl-node ' + cls + '">' +
        '<span class="tl-dot" aria-hidden="true">' + icon + '</span>' +
        '<b>' + n.label + '</b>' + (n.when ? '<span>' + n.when + '</span>' : '') +
      '</div>';
    }).join('');

    return '<div class="timeline"><div class="tl-title">Review progress</div><div class="tl">' + html + '</div></div>';
  }

  /* ── live analytics placeholders (no invented numbers) ──── */
  function statsHTML(rec) {
    var s = rec.stats || {};
    function tile(val, label) {
      var pending = val === null || val === undefined;
      return '<div class="stat"><b' + (pending ? ' class="pending-val"' : '') + '>' +
             (pending ? '—' : val) + '</b><span>' + label + '</span></div>';
    }
    return '<div class="stats">' +
      tile(s.views, 'Views') + tile(s.whatsapp, 'WhatsApp') + tile(s.calls, 'Calls') +
      '<p class="stats-note">Activity tracking starts soon — your numbers will appear here.</p>' +
    '</div>';
  }

  /* ── rejection block + review evidence + email hook ─────── */
  function rejectHTML(rec) {
    var r = rec.review || {};
    return '<div class="reject">' +
        '<div class="reject-head">' + IC.warn + '<b>Why it was rejected</b></div>' +
        '<p>' + UI.esc(r.reason || '') + '</p>' +
        (r.reviewedAt ? '<p class="r-date">Reviewed ' + UI.fmtRelative(r.reviewedAt) + '</p>' : '') +
      '</div>' +
      evidenceHTML(rec);
  }

  /* Review Evidence — container only. When the reviewer API lands it
     supplies review.evidence = { photos: [url], comments: [text] };
     both branches below already render. */
  function evidenceHTML(rec) {
    var ev = (rec.review && rec.review.evidence) || null;
    var body;

    if (ev && ((ev.photos && ev.photos.length) || (ev.comments && ev.comments.length))) {
      body =
        (ev.photos && ev.photos.length
          ? '<div class="evidence-photos">' + ev.photos.map(function (src) {
              return '<div class="thumb">' + UI.mediaFill(src, 'Review photo') + '</div>';
            }).join('') + '</div>'
          : '') +
        (ev.comments && ev.comments.length
          ? ev.comments.map(function (c) {
              return '<p class="evidence-note">' + UI.esc(c) + '</p>';
            }).join('')
          : '');
    } else {
      body = '<p>Photos and notes from our review team will appear here.</p>';
    }

    return '<div class="evidence">' +
        '<div class="evidence-head">' + IC.camera + '<b>Review evidence</b></div>' +
        '<div class="evidence-slot">' + body + '</div>' +
      '</div>' +
      notifyHTML(rec);
  }

  /* Preferences are stored only — nothing is sent from the client. */
  function notifyHTML(rec) {
    var kind = rec.status === 'live' ? 'availability' : 'review';
    var label = kind === 'availability'
      ? 'Daily Availability Reminder'
      : 'Email me when my review status changes';

    return '<div class="notify-pref">' + IC.mail +
        '<label><input type="checkbox" data-act="notify" data-id="' + rec.id + '" ' +
          'data-kind="' + kind + '"' + (notifyPref(rec.id, kind) ? ' checked' : '') + '>' +
          label + '</label>' +
      '</div>';
  }

  /* ── actions ────────────────────────────────────────────── */
  function actionsHTML(rec) {
    var b = [];
    if (rec.status === 'archived') {
      b.push(btn('restore', rec.id, IC.undo, 'Restore', 'is-primary'));
    } else {
      if (rec.status === 'rejected') b.push(btn('fix', rec.id, IC.fix, 'Fix & Resubmit', 'is-primary'));
      b.push(btn('edit', rec.id, IC.edit, 'Edit', ''));
      if (rec.status === 'live' && rec.listingId) {
        b.push('<a class="oact" href="' + CFG.routes.detailsPage + '?id=' + encodeURIComponent(rec.listingId) + '">' +
               IC.eye + 'View Listing</a>');
      }
      b.push(btn('archive', rec.id, IC.arch, 'Archive', 'is-warn'));
    }
    return '<div class="ocard-actions">' + b.join('') + '</div>';
  }

  function btn(act, id, icon, label, extra) {
    return '<button class="oact ' + extra + '" type="button" data-act="' + act + '" data-id="' + id + '">' +
           icon + label + '</button>';
  }

  /* ── card ───────────────────────────────────────────────── */
  function cardHTML(rec) {
    var st = STATUS[rec.status] || STATUS.pending_review;

    return '<article class="ocard">' +
      '<div class="ocard-top">' +
        '<div class="ocard-media">' + UI.mediaFill(UI.cover(rec), rec.title) + '</div>' +
        '<div class="ocard-info">' +
          '<div class="ocard-head">' +
            '<h2>' + UI.esc(rec.title) + '</h2>' +
            '<span class="spill ' + st.cls + '"><i aria-hidden="true"></i>' + st.label + '</span>' +
          '</div>' +
          '<p class="ocard-loc">' + UI.esc(rec.area) + ', ' + UI.esc(rec.city) + '</p>' +
          '<p class="ocard-rent">PKR ' + UI.fmtPKR(rec.rent) + ' <small>/ month</small></p>' +
          '<div class="ocard-meta">' +
            '<span>Ref <b>' + UI.esc(rec.id) + '</b></span>' +
            '<span>Updated <b>' + UI.fmtRelative(rec.updatedAt) + '</b></span>' +
            (rec.status === 'live'
              ? '<span>Last availability confirmation <b>' +
                (rec.availability && rec.availability.confirmedAt
                  ? UI.fmtRelative(rec.availability.confirmedAt)
                  : 'not yet') + '</b></span>'
              : '') +
          '</div>' +
        '</div>' +
      '</div>' +
      (rec.status === 'pending_review' || rec.status === 'rejected' ? timelineHTML(rec) : '') +
      (rec.status === 'rejected' ? rejectHTML(rec) : '') +
      (rec.status === 'live' ? statsHTML(rec) : '') +
      availHTML(rec) +
      (rec.status === 'live' ? notifyHTML(rec) : '') +
      actionsHTML(rec) +
    '</article>';
  }

  /* ── notification preferences (stored only) ─────────────── */
  function prefs() {
    try { return JSON.parse(localStorage.getItem(CFG.storage.notifyPrefs) || '{}'); }
    catch (e) { return {}; }
  }
  /* Two independent preferences per property: 'review' and
     'availability'. Older boolean entries are read as 'review'. */
  function notifyPref(id, kind) {
    var v = prefs()[id];
    if (typeof v === 'boolean') return kind === 'review' ? v : false;
    return !!(v && v[kind]);
  }
  function setNotifyPref(id, kind, on) {
    var p = prefs();
    if (typeof p[id] === 'boolean') p[id] = { review: p[id] };
    if (!p[id]) p[id] = {};
    p[id][kind] = on;
    try { localStorage.setItem(CFG.storage.notifyPrefs, JSON.stringify(p)); } catch (e) {}
  }

  /* ── location-aware search text (Phase 6: single location engine) ──
     A property's `area` is stored as plain display text; when it
     resolves to a real node we search its whole breadcrumb too, so
     "Punjab" or "Lahore" finds a property whose area is a locality
     under them. Falls back to the plain fields if it doesn't resolve. */
  var haystackCache = {};
  function locationHaystack(rec) {
    if (haystackCache[rec.id] !== undefined) return haystackCache[rec.id];
    var extra = '';
    if (LOC) {
      var node = LOC.findByExactName(rec.area);
      if (node) extra = ' ' + node.breadcrumb.join(' ');
    }
    return (haystackCache[rec.id] = extra);
  }

  /* ── render ─────────────────────────────────────────────── */
  var EMPTY = {
    all:            ['No properties yet', 'Add your first property and our team will review it within ' + CFG.owner.reviewHours + ' hours.'],
    pending_review: ['Nothing waiting for review', 'Properties you submit will appear here while our team checks them.'],
    live:           ['No live properties yet', 'Once a property is approved it appears here with its activity.'],
    rejected:       ['No rejected properties', 'Anything that needs changes will appear here with the reason.'],
    archived:       ['Nothing archived', 'Archived properties are hidden from tenants but never deleted.']
  };

  function render() {
    var all = DATA.list();

    var counts = { all: 0, pending_review: 0, live: 0, rejected: 0, archived: 0 };
    all.forEach(function (r) {
      if (counts[r.status] !== undefined) counts[r.status]++;
      if (r.status !== 'archived') counts.all++;
    });
    Object.keys(counts).forEach(function (k) {
      var el = doc.querySelector('[data-count="' + k + '"]');
      if (el) el.textContent = counts[k];
    });

    var rows = view === 'all'
      ? all.filter(function (r) { return r.status !== 'archived'; })
      : all.filter(function (r) { return r.status === view; });

    /* Search applies to My Properties only. */
    var searching = view === 'all' && query.length > 0;
    $('searchWrap').hidden = view !== 'all';
    if (searching) {
      rows = rows.filter(function (r) {
        return (r.id + ' ' + r.title + ' ' + r.area + locationHaystack(r)).toLowerCase().indexOf(query) > -1;
      });
    }

    rows.sort(function (a, b) { return new Date(b.updatedAt) - new Date(a.updatedAt); });

    if (!rows.length) {
      var e = searching
        ? ['No matches', 'Nothing matched “' + query + '”. Try a reference, title or area.']
        : (EMPTY[view] || EMPTY.all);
      host.innerHTML =
        '<div class="empty">' +
          '<div class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/></svg></div>' +
          '<h2>' + UI.esc(e[0]) + '</h2><p>' + UI.esc(e[1]) + '</p>' +
          (searching
            ? '<button class="btn-ghost" type="button" data-act="clear-search">Clear search</button>'
            : '<a class="btn-gold" href="' + CFG.routes.submitPage + '">Add Property</a>') +
        '</div>';
      return;
    }

    host.innerHTML = rows.map(cardHTML).join('');
    host.querySelectorAll('.ocard').forEach(function (el, i) {
      el.style.animationDelay = Math.min(i * 50, 300) + 'ms';
    });
  }

  /* ── interactions ───────────────────────────────────────── */
  /* ── search (My Properties) ─────────────────────────────── */
  var searchEl = $('dashSearch'), clearEl = $('searchClear');

  function applySearch(v) {
    query = String(v || '').trim().toLowerCase();
    searchEl.value = v || '';
    clearEl.hidden = !query;
    render();
  }
  searchEl.addEventListener('input', function () { applySearch(this.value); });
  clearEl.addEventListener('click', function () { applySearch(''); searchEl.focus(); });

  $('dashNav').addEventListener('click', function (e) {
    var t = e.target.closest('button[data-view]');
    if (!t) return;
    doc.querySelectorAll('.dash-tab[role="tab"]').forEach(function (x) {
      x.setAttribute('aria-selected', 'false');
    });
    t.setAttribute('aria-selected', 'true');
    view = t.getAttribute('data-view');
    render();
  });

  host.addEventListener('change', function (e) {
    var c = e.target.closest('[data-act="notify"]');
    if (c) setNotifyPref(c.getAttribute('data-id'), c.getAttribute('data-kind'), c.checked);
  });

  host.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'INPUT') return;
    var act = b.getAttribute('data-act');
    var id = b.getAttribute('data-id');

    if (act === 'clear-search') { applySearch(''); return; }

    /* Availability confirmation, archive and restore are OWNER WRITES,
       and no owner-facing write API exists yet — archiving is a CEO
       capability on the admin side (properties.archive). These used to
       mutate the local fixture, which made the button look like it had
       done something to a property nobody else could see change. Saying
       so is the honest state until that endpoint exists. */
    if (act === 'confirm' || act === 'archive' || act === 'restore') {
      notice('This is handled by the MakanOnRent team for now — contact us and we will update the listing.');
      return;
    }
    /* Edit / Fix sent the owner to submit.html?ref=…&mode=edit — but the
       wizard has never read either parameter, so it opened a BLANK form.
       Anything the owner then filled in was submitted as a SECOND
       property, not a correction of this one. There is no owner-side
       update endpoint to call instead, so until one exists this says so
       rather than quietly duplicating their listing. */
    if (act === 'edit' || act === 'fix') {
      notice('Editing a submitted property is not available yet — contact the MakanOnRent team with reference ' +
             id + ' and we will update it for you.');
      return;
    }
  });

  /* One dialog instance, reused — never appended twice. */
  var confirmDlg = null, pendingOk = null;

  function confirmDialog(title, body, okLabel, onOk) {
    if (!confirmDlg) {
      confirmDlg = UI.buildDialog('ownerConfirm',
        '<div class="modal-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="4" rx="1.4"/><path d="M5 8v11a1.6 1.6 0 0 0 1.6 1.6h10.8A1.6 1.6 0 0 0 19 19V8"/></svg></div>' +
        '<h3 data-title></h3><p data-body></p>' +
        '<div class="modal-form">' +
          '<button class="btn-gold" type="button" data-ok data-close></button>' +
          '<button class="btn-ghost" type="button" data-close>Cancel</button>' +
        '</div>');
      confirmDlg.el.addEventListener('click', function (e) {
        if (e.target.closest('[data-ok]') && pendingOk) { pendingOk(); pendingOk = null; }
      });
    }
    confirmDlg.el.querySelector('[data-title]').textContent = title;
    confirmDlg.el.querySelector('[data-body]').textContent = body;
    confirmDlg.el.querySelector('[data-ok]').textContent = okLabel;
    confirmDlg.el.setAttribute('aria-label', title);
    pendingOk = onOk;
    confirmDlg.open();
  }

  /* Transient message for actions that have no owner API yet. */
  var noticeTimer = null;
  function notice(text) {
    var el = $('dashNotice');
    if (!el) { el = doc.createElement('p'); el.id = 'dashNotice'; el.className = 'dash-notice';
      host.parentNode.insertBefore(el, host); }
    el.textContent = text;
    el.hidden = false;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () { el.hidden = true; }, 5000);
  }

  /* Full-panel state for "not signed in" / "could not load". Replaces the
     cards rather than sitting beside them, because in both cases there is
     nothing truthful to show. */
  function panel(title, body, action) {
    doc.getElementById('dashNav').hidden = !!action;
    $('searchWrap').hidden = true;
    host.innerHTML =
      '<div class="empty">' +
        '<div class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/></svg></div>' +
        '<h2>' + UI.esc(title) + '</h2><p>' + UI.esc(body) + '</p>' +
        (action ? '<button class="btn-gold" type="button" id="dashAuthBtn">' + UI.esc(action) + '</button>' : '') +
      '</div>';
  }

  /* ── boot ────────────────────────────────────────────────────
     My Properties is owner data, so nothing renders until the SERVER
     confirms who the visitor is. There is no local flag to trust and no
     fixture to fall back to. */
  $('yr').textContent = new Date().getFullYear();

  (function boot() {
    var S = win.MOR_OWNER_SESSION;
    if (S) S.consumeSigninFlag();

    if (!S || !win.fetch) {
      panel('Sign in to see your properties',
            'Your properties are linked to your Google account.', 'Continue with Google');
      return;
    }

    panel('Loading your properties…', 'One moment.');

    S.load(true).then(function (me) {
      if (!me || !me.signedIn) {
        panel('Sign in to see your properties',
              'Your properties are linked to the Google account you submitted them with.',
              'Continue with Google');
        var btn = $('dashAuthBtn');
        if (btn) btn.addEventListener('click', function () { S.signIn('/dashboard.html'); });
        return;
      }

      return DATA.load().then(function () {
        doc.getElementById('dashNav').hidden = false;
        render();
      }).catch(function (err) {
        if (err && err.signedOut) {
          panel('Your session has expired', 'Sign in again to see your properties.',
                'Continue with Google');
          var b = $('dashAuthBtn');
          if (b) b.addEventListener('click', function () { S.signIn('/dashboard.html'); });
          return;
        }
        panel('We could not load your properties',
              (err && err.message) || 'Please try again in a moment.');
      });
    });
  })();
})(window, document);
