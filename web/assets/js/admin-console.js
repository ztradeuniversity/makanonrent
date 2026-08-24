/* MakanOnRent — admin console controller.
   One page, three roles. Which tabs exist is decided by the capability
   list the server issues in /api/admin/me — the SAME list rbac.js uses to
   authorise the endpoints, so the console cannot drift out of step with
   what the API actually allows.

   To be explicit: hiding a tab is a courtesy, not a control. Every action
   below is re-authorised server-side (Doc 18 Article 9.1). */
(function (win, doc) {
  'use strict';

  var A = win.MOR_ADMIN, CFG = win.MOR_CONFIG, API = CFG.routes.api;
  var $ = function (id) { return doc.getElementById(id); };
  var esc = A.esc;

  var ME = null;         // { user, capabilities[], areas }
  var CAPS = {};
  var teamCache = [];

  function can(cap) { return !!CAPS[cap]; }

  /* ── tabs ───────────────────────────────────────────────────────── */
  var TABS = [
    { id: 'today',      label: 'Today',      show: function () { return true; } },
    { id: 'verify',     label: 'Verify',     show: function () { return can('properties.verify'); } },
    { id: 'approvals',  label: 'Approvals',  show: function () { return can('properties.approve'); } },
    { id: 'properties', label: 'Properties', show: function () { return true; } },
    { id: 'team',       label: 'Team',       show: function () { return can('users.list'); } },
    { id: 'monitor',    label: 'Monitoring', show: function () { return can('monitor.read'); } },
    { id: 'reports',    label: 'Reports',    show: function () { return can('monitor.read'); } },
    { id: 'settings',   label: 'Settings',   show: function () { return can('settings.read'); } },
    { id: 'audit',      label: 'Audit',      show: function () { return can('audit.read'); } }
    /* 'lifecycle' is deliberately absent: it is reached by drilling into a
       property, not by browsing, so it has a panel but no tab. */
  ];

  var LOADERS = {
    today: loadToday, verify: loadVerify, approvals: loadApprovals,
    properties: loadProperties, team: loadTeam, monitor: loadMonitor,
    reports: loadReports, settings: loadSettings, audit: loadAudit
  };

  function renderTabs() {
    var visible = TABS.filter(function (t) { return t.show(); });
    $('adTabs').innerHTML = visible.map(function (t, i) {
      return '<button class="ad-tab' + (i === 0 ? ' is-on' : '') + '" type="button" role="tab" data-tab="' + t.id + '">' +
        esc(t.label) + '</button>';
    }).join('');
    if (visible.length) selectTab(visible[0].id);
  }

  function selectTab(id) {
    Array.prototype.forEach.call(doc.querySelectorAll('.ad-tab'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-tab') === id);
    });
    Array.prototype.forEach.call(doc.querySelectorAll('.ad-panel'), function (p) {
      p.classList.toggle('is-on', p.id === 'panel-' + id);
    });
    if (LOADERS[id]) LOADERS[id]();
  }

  $('adTabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (b) selectTab(b.getAttribute('data-tab'));
  });

  /* ── TODAY ──────────────────────────────────────────────────────── */
  async function loadToday() {
    try {
      loadPerformance();
      var res = await A.get(API.adminTasks + '?date=' + A.todayISO());
      $('adTaskDate').textContent = A.fmtDate(res.date);

      var s = res.summary;
      $('adTodayStats').innerHTML =
        stat(s.total, 'Tasks today') +
        stat(s.completed, 'Completed') +
        stat(s.pending, 'Pending') +
        stat(s.completionPct + '%', 'Completion', true);

      $('adTaskList').innerHTML = res.tasks.length
        ? res.tasks.map(function (t) {
            return '<div class="ad-verify-row">' +
              '<div class="ad-grow"><b>' + esc(t.title) + '</b>' +
              '<small>' + t.completedCount + ' of ' + t.targetCount + ' done · ' +
              t.pendingCount + ' remaining</small>' +
              (t.notes ? '<small style="display:block;margin-top:4px;white-space:pre-wrap;">' + esc(t.notes) + '</small>' : '') +
              '</div>' +
              '<span class="ad-pill ' + (t.completionPct >= 100 ? 'is-ok' : 'is-warn') + '">' +
              t.completionPct + '%</span>' +
            '</div>';
          }).join('')
        : '<div class="ad-empty">No tasks assigned for today.</div>';
    } catch (e) {
      $('adTaskList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  function stat(value, label, accent) {
    return '<div class="ad-stat' + (accent ? ' is-accent' : '') + '"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* ── PERFORMANCE (rendered inside Today) ────────────────────────── */
  async function loadPerformance() {
    try {
      var res = await A.get(API.adminPerformance);
      if (!res.performance) { $('adPerfCard').hidden = true; return; }
      var p = res.performance;
      $('adPerfCard').hidden = false;
      $('adPerfStats').innerHTML =
        stat(p.tasksToday, 'Tasks today') +
        stat(p.tasksWeek, 'This week') +
        stat(p.tasksMonth, 'This month') +
        stat(p.verificationPct == null ? '—' : p.verificationPct + '%', 'Verification', true) +
        stat(p.approvalPct == null ? '—' : p.approvalPct + '%', 'Approved') +
        stat(p.rejectedPct == null ? '—' : p.rejectedPct + '%', 'Rejected') +
        stat(p.inactiveDays == null ? '—' : p.inactiveDays, 'Inactive days');
    } catch (e) {
      $('adPerfCard').hidden = true;
    }
  }

  /* ── NOTIFICATIONS ──────────────────────────────────────────────── */
  async function refreshBell() {
    try {
      var res = await A.get(API.adminNotifications + '?count=1');
      $('adBellCount').textContent = res.unread;
    } catch (e) { /* the badge is not worth an error banner */ }
  }

  async function loadNotifications() {
    try {
      var res = await A.get(API.adminNotifications + '?limit=50');
      $('adBellCount').textContent = res.unread;
      $('adNotifyList').innerHTML = res.notifications.length
        ? res.notifications.map(function (n) {
            var cls = n.severity === 'critical' ? 'is-danger' : n.severity === 'warning' ? 'is-warn' : '';
            return '<div class="ad-verify-row' + (n.readAt ? ' is-blocked' : '') + '">' +
              '<div class="ad-grow"><b>' + esc(n.title) + '</b>' +
              '<small>' + esc(n.body || '') + ' · ' + esc(A.fmtDateTime(n.createdAt)) + '</small></div>' +
              '<span class="ad-pill ' + cls + '">' + esc(n.severity) + '</span>' +
            '</div>';
          }).join('')
        : '<div class="ad-empty">Nothing to catch up on.</div>';
    } catch (e) {
      $('adNotifyList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  $('adBell').addEventListener('click', function () {
    var panel = $('adNotifyPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) loadNotifications();
  });

  $('adMarkAllRead').addEventListener('click', async function () {
    try {
      await A.post(API.adminNotifications, { action: 'mark-read' });
      await loadNotifications();
    } catch (e) { /* surfaced by the list itself */ }
  });

  /* ── VERIFY ─────────────────────────────────────────────────────── */
  var verifySelection = {};

  async function loadVerify() {
    verifySelection = {};
    updateVerifyCount();
    try {
      var res = await A.get(API.adminVerifications);
      $('adVerifyList').innerHTML = res.properties.length
        ? res.properties.map(renderVerifyRow).join('')
        : '<div class="ad-empty">No properties in your assigned areas yet.</div>';
    } catch (e) {
      $('adVerifyList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  function renderVerifyRow(p) {
    /* A self-added property is shown but not actionable, with the reason
       stated — the separation-of-duty rule is explained, not silently
       hidden, so the manager knows to hand it to a colleague. */
    if (p.selfAdded) {
      return '<div class="ad-verify-row is-blocked">' +
        '<div class="ad-grow"><b>' + esc(p.businessCode) + '</b>' +
        '<small>' + esc(p.areaName) + ', ' + esc(p.cityName) + '</small></div>' +
        '<span class="ad-pill is-warn">You added this — another person must verify it</span>' +
      '</div>';
    }
    return '<div class="ad-verify-row" data-prop="' + esc(p.id) + '">' +
      '<div class="ad-grow"><b>' + esc(p.businessCode) + '</b>' +
      '<small>' + esc(p.areaName) + ', ' + esc(p.cityName) + '</small></div>' +
      '<div class="ad-choice">' +
        '<label><input type="radio" name="v-' + esc(p.id) + '" value="available" />Available</label>' +
        '<label class="is-no"><input type="radio" name="v-' + esc(p.id) + '" value="unavailable" />Unavailable</label>' +
      '</div>' +
      '<input class="ad-input" style="max-width:150px" type="tel" placeholder="Phone" data-phone="' + esc(p.id) + '" />' +
    '</div>';
  }

  $('adVerifyList').addEventListener('change', function (e) {
    var row = e.target.closest('[data-prop]');
    if (!row) return;
    var id = row.getAttribute('data-prop');
    var picked = row.querySelector('input[type=radio]:checked');
    if (picked) {
      verifySelection[id] = verifySelection[id] || {};
      verifySelection[id].status = picked.value;
    }
    var phone = row.querySelector('[data-phone]');
    if (phone && verifySelection[id]) verifySelection[id].phoneNumber = phone.value.trim();
    updateVerifyCount();
  });

  function updateVerifyCount() {
    var n = Object.keys(verifySelection).filter(function (k) { return verifySelection[k].status; }).length;
    $('adVerifyCount').textContent = n + ' selected';
    $('adPublishVerify').disabled = n === 0;
  }

  $('adPublishVerify').addEventListener('click', async function () {
    var items = Object.keys(verifySelection)
      .filter(function (k) { return verifySelection[k].status; })
      .map(function (k) {
        return {
          propertyId: k,
          status: verifySelection[k].status,
          phoneNumber: verifySelection[k].phoneNumber || null
        };
      });
    if (!items.length) return;

    this.disabled = true;
    A.msg($('adVerifyMsg'), 'Publishing…');
    try {
      var res = await A.post(API.adminVerifications, { verifications: items });
      var note = res.applied.length + ' verification(s) published.';
      if (res.rejected.length) note += ' ' + res.rejected.length + ' could not be applied: ' + res.rejected[0].reason;
      A.msg($('adVerifyMsg'), note, res.rejected.length ? 'is-error' : 'is-ok');
      await loadVerify();
    } catch (e) {
      A.msg($('adVerifyMsg'), e.message, 'is-error');
    }
    this.disabled = false;
  });

  /* ── APPROVALS ──────────────────────────────────────────────────── */
  var CHAIN_LABEL = {
    manager_only: 'Manager approval only',
    manager_aceo: 'Manager + Assistant CEO',
    manager_ceo: 'Manager + CEO',
    manager_aceo_ceo: 'Manager + Assistant CEO + CEO'
  };

  async function loadApprovals() {
    try {
      var res = await A.get(API.adminApprovals + '?queue=1');
      $('adChainNote').textContent = 'Approval chain: ' + (CHAIN_LABEL[res.chain] || res.chain) +
        (res.autoPublish ? ' · Auto Publish is ON — a manager approval publishes immediately.' : '');
      $('adApprovalCount').textContent = res.listings.length + ' awaiting';

      $('adApprovalList').innerHTML = res.listings.length
        ? res.listings.map(function (l) {
            var blocked = l.selfAdded;
            return '<div class="ad-verify-row' + (blocked ? ' is-blocked' : '') + '" data-listing="' + esc(l.listingId) + '">' +
              '<div class="ad-grow"><b>' + esc(l.property.businessCode) + '</b>' +
              '<small>' + esc(l.property.areaName) + ', ' + esc(l.property.cityName) + ' · ' + A.fmtRent(l.rentAmountMinor) + '</small></div>' +
              (blocked
                ? '<span class="ad-pill is-warn">You added this — another person must approve it</span>'
                : '<button class="ad-btn is-sm is-primary" type="button" data-decide="approve">Approve</button>' +
                  '<button class="ad-btn is-sm" type="button" data-decide="return">Return</button>' +
                  '<button class="ad-btn is-sm is-danger" type="button" data-decide="reject">Reject</button>') +
            '</div>';
          }).join('')
        : '<div class="ad-empty">Nothing is awaiting your review.</div>';
    } catch (e) {
      $('adApprovalList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  $('adApprovalList').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-decide]');
    if (!btn) return;
    var row = btn.closest('[data-listing]');
    var listingId = row.getAttribute('data-listing');
    var decision = btn.getAttribute('data-decide');

    var comment = null;
    if (decision !== 'approve') {
      comment = win.prompt('Add a comment explaining this ' + decision + ':');
      if (!comment) return;    // required by the API; don't send a doomed request
    }

    btn.disabled = true;
    try {
      var res = await A.post(API.adminApprovals, {
        listingId: listingId, decision: decision, comment: comment
      });
      A.msg($('adApprovalMsg'),
        res.published ? 'Approved and published.' : 'Recorded: ' + decision + '.', 'is-ok');
      await loadApprovals();
    } catch (err) {
      A.msg($('adApprovalMsg'), err.message, 'is-error');
      btn.disabled = false;
    }
  });

  /* ── PROPERTIES ─────────────────────────────────────────────────── */
  async function loadProperties() {
    var archived = $('adShowArchived').checked ? '?archived=1' : '';
    try {
      var res = await A.get(API.adminProperties + archived);
      $('adPropertyList').innerHTML = res.properties.length
        ? '<table class="ad-table"><thead><tr>' +
            '<th>Code</th><th>Area</th><th>Rent</th><th>Status</th><th>Availability</th><th></th>' +
          '</tr></thead><tbody>' +
          res.properties.map(function (p) {
            return '<tr data-listing="' + esc(p.listingId) + '">' +
              '<td><b>' + esc(p.businessCode) + '</b></td>' +
              '<td>' + esc(p.areaName) + ', ' + esc(p.cityName) + '</td>' +
              '<td class="num">' + A.fmtRent(p.rentAmountMinor) + '</td>' +
              '<td><span class="ad-pill ' + (p.lifecycleState === 'published' ? 'is-ok'
                  : (p.lifecycleState === 'rejected' || p.lifecycleState === 'deleted') ? 'is-danger'
                  : 'is-warn') + '">' +
                esc(p.lifecycleLabel || p.status) + '</span></td>' +
              '<td>' + (p.availabilityState
                ? '<span class="ad-pill ' + (p.availabilityState === 'available' ? 'is-ok' : 'is-danger') + '">' + esc(p.availabilityState) + '</span>'
                : '<span class="ad-pill">not verified</span>') + '</td>' +
              '<td><button class="ad-btn is-sm" type="button" data-lifecycle>Lifecycle</button> ' +
                (can('properties.archive')
                ? (p.archivedAt
                    ? '<button class="ad-btn is-sm" type="button" data-restore>Restore</button>'
                    : '<button class="ad-btn is-sm is-danger" type="button" data-archive>Remove</button>')
                : '') + '</td>' +
            '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ad-empty">No properties visible to you.</div>';
    } catch (e) {
      $('adPropertyList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  $('adShowArchived').addEventListener('change', loadProperties);

  $('adPropertyList').addEventListener('click', async function (e) {
    var row = e.target.closest('[data-listing]');
    if (!row) return;
    var listingId = row.getAttribute('data-listing');

    if (e.target.closest('[data-lifecycle]')) { openLifecycle(listingId); return; }

    var archiveBtn = e.target.closest('[data-archive]');
    var restoreBtn = e.target.closest('[data-restore]');
    if (!archiveBtn && !restoreBtn) return;
    var action = archiveBtn ? 'archive' : 'restore';

    /* A removal reason is mandatory server-side, so it is collected here
       rather than letting the request fail. */
    var reason = null;
    if (action === 'archive') {
      reason = win.prompt('Why is this property being removed? (recorded permanently)');
      if (!reason) return;
    }

    try {
      await A.post(API.adminProperties, { listingId: listingId, action: action, reason: reason });
      A.msg($('adPropertyMsg'), action === 'archive'
        ? 'Property removed and archived. The row and its history are retained.'
        : 'Property restored — it returns to review before republishing.', 'is-ok');
      await loadProperties();
    } catch (err) {
      A.msg($('adPropertyMsg'), err.message, 'is-error');
    }
  });

  /* ── LIFECYCLE drill-in ─────────────────────────────────────────── */
  var lifecycleListingId = null;

  async function openLifecycle(listingId) {
    lifecycleListingId = listingId;
    selectTab('lifecycle');
    await loadLifecycle();
  }

  $('adLcBack').addEventListener('click', function () { selectTab('properties'); });

  function kv(pairs) {
    return pairs.filter(function (p) { return p[1] !== null && p[1] !== undefined && p[1] !== ''; })
      .map(function (p) { return '<div class="ad-kv-row"><span>' + esc(p[0]) + '</span><span>' + p[1] + '</span></div>'; })
      .join('');
  }

  var MEDIA_STATUS_LABEL = { draft: 'Draft', pending_review: 'Pending Review', rejected: 'Rejected', published: 'Published' };

  function renderReviewMedia(media) {
    $('adLcMediaEmpty').hidden = !!(media && media.length);
    $('adLcMedia').innerHTML = (media || []).map(function (m) {
      var inner = !m.url
        ? '<div class="ad-media-badge is-rejected">Link unavailable</div>'
        : m.kind === 'video'
          ? '<video src="' + esc(m.url) + '" muted playsinline controls></video>'
          : '<img src="' + esc(m.url) + '" alt="" loading="lazy">';
      return '<div class="ad-media-tile">' + inner +
        '<span class="ad-media-badge is-' + esc(m.visibility) + '">' + esc(MEDIA_STATUS_LABEL[m.visibility] || m.visibility) + '</span>' +
        '<span class="ad-media-kind">' + esc(m.kind) + '</span>' +
      '</div>';
    }).join('');
  }

  async function loadLifecycle() {
    if (!lifecycleListingId) return;
    A.msg($('adLcMsg'), '');
    try {
      var res = await A.get(API.adminLifecycle + '?listingId=' + encodeURIComponent(lifecycleListingId));
      $('adLcTitle').textContent = res.businessCode + ' — ' + res.stateLabel;

      var p = res.property || {};
      $('adLcProperty').innerHTML = kv([
        ['Type', p.typeLabel], ['Rent', p.rent != null ? 'PKR ' + p.rent.toLocaleString('en-PK') + '/mo' : null],
        ['Advance', p.advance != null ? 'PKR ' + p.advance.toLocaleString('en-PK') : null],
        ['Bedrooms', p.beds], ['Bathrooms', p.baths],
        ['Car porch', p.carPorch ? 'Yes' : 'No'],
        ['Size', p.size != null ? p.size + ' ' + (p.sizeUnit === 'marla' ? 'Marla' : 'Sq Ft') : null],
        ['Front road width', p.roadWidthFt != null ? p.roadWidthFt + ' ft' : null],
        ['Features', (p.features || []).length ? esc((p.features || []).join(', ')) : null],
        ['Submitted', p.submittedAt ? A.fmtDateTime(p.submittedAt) : null]
      ]);

      var loc = res.location || {};
      $('adLcLocation').innerHTML = kv([
        ['City', loc.city], ['Main location', loc.mainLocation],
        ['Sub location', loc.subLocation ? esc(loc.subLocation).replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : null],
        ['Landmark', loc.landmark]
      ]);

      var o = res.owner;
      $('adLcOwner').innerHTML = o
        ? kv([
            ['Name', o.name], ['Email', o.email ? esc(o.email) + (o.emailVerified ? ' ✓' : ' (unverified)') : null],
            ['Phone / WhatsApp', o.phone],
            ['Google account', o.hasGoogleAccount ? 'Linked' : 'Not linked'],
            ['Prior submissions', res.priorSubmissions]
          ])
        : '';

      var mgr = res.assignedManager;
      $('adLcWorkflow').innerHTML = kv([
        ['Assigned manager', mgr ? esc(mgr.name) + ' (' + esc(A.roleLabel(mgr.role)) + ')' : 'Unassigned — visible to CEO directly'],
        ['Current state', res.stateLabel]
      ]);

      renderReviewMedia(res.media);

      /* Buttons come from the server's list of transitions THIS role may
         make, so the console can never offer a move the API would refuse.
         'deleted' is singled out: TRANSITIONS has no edge leaving it (see
         functions/utils/lifecycle.js), so it is the one truly
         irreversible action here — everything else (archive, reject) can
         be moved back to Pending Review. It is labelled and confirmed
         accordingly rather than folded into the same "danger" style as
         a recoverable move. */
      var actionsHtml = res.availableTransitions.length
        ? res.availableTransitions.map(function (t) {
            var isDelete = t.state === 'deleted';
            var danger = ['rejected', 'archived', 'deleted'].indexOf(t.state) > -1;
            var label = isDelete ? 'Permanently Delete' : t.label;
            return '<button class="ad-btn is-sm' + (danger ? ' is-danger' : ' is-primary') +
              '" type="button" data-to="' + esc(t.state) + '">' + esc(label) + '</button>';
          }).join('')
        : '<span class="ad-pill">No moves available to your role from this state.</span>';

      /* 'deleted' is terminal — no button above ever offers it again once
         reached. If the media purge that runs on that transition left
         anything behind (an R2 delete that failed), this is the one way
         back to it: same action, same server-side handler, but routed as
         a purge-only retry rather than a state change (see
         functions/api/admin/lifecycle.js — "alreadyDeleted"). Offered
         only to the CEO, matching who could reach 'deleted' at all. */
      if (res.state === 'deleted' && (res.media || []).length && ME.user.role === 'ceo') {
        actionsHtml += '<button class="ad-btn is-sm is-danger" type="button" data-to="deleted" data-retry-purge>' +
          'Retry Media Removal (' + res.media.length + ' remaining)</button>';
      }
      $('adLcActions').innerHTML = actionsHtml;

      $('adLcHistory').innerHTML = res.history.length
        ? res.history.map(function (h) {
            return '<div class="ad-hist-row">' +
              '<div class="ad-hist-meta">' + esc(A.fmtDateTime(h.at)) + ' · ' +
                esc(h.actorName || 'System') +
                (h.actorRole ? ' (' + esc(A.roleLabel(h.actorRole)) + ')' : '') +
                (h.actorKind === 'system' ? ' · automatic' : '') + '</div>' +
              '<div class="ad-hist-body"><b>' + esc(h.fromLabel || '—') + ' → ' + esc(h.toLabel) + '</b>' +
                (h.reason ? ' — ' + esc(h.reason) : '') + '</div>' +
            '</div>';
          }).join('')
        : '<div class="ad-empty">No status changes recorded yet.</div>';
    } catch (e) {
      A.msg($('adLcMsg'), e.message, 'is-error');
    }
  }

  $('adLcActions').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-to]');
    if (!btn) return;
    var toState = btn.getAttribute('data-to');
    var isRetryPurge = btn.hasAttribute('data-retry-purge');

    if (isRetryPurge) {
      /* Not a state change — the property is already permanently
         deleted. This only re-attempts removing whatever media the last
         attempt could not clear from storage, so it gets its own,
         accurate confirmation rather than the "this cannot be undone"
         wording below (which would be describing something that already
         happened). */
      if (!win.confirm('Retry removing the remaining media from storage for this deleted property?')) return;
    } else if (toState === 'deleted') {
      /* Honest about what this actually does: the property/listing row is
         NOT erased (Doc 18 Article 2.4 forbids that for a business
         record) — it becomes permanently inaccessible everywhere in the
         product and its media is removed from storage. Said plainly here
         rather than left to the "Permanently Delete" label alone. */
      var sure = win.confirm(
        'Permanently delete this property?\n\n' +
        'It will disappear from every list and can never be restored. ' +
        'Its photos and videos will be removed from storage. ' +
        'The record itself is kept for compliance, exactly as an archived property is — ' +
        'only visible through Status History, never again in normal use.'
      );
      if (!sure) return;
    }

    /* Mirrors REASON_REQUIRED in functions/utils/lifecycle.js. Not asked
       for a purge retry — that call makes no lifecycle transition, so the
       server does not require (or record) a reason for it. */
    var reason = null;
    if (!isRetryPurge && ['rejected', 'archived', 'deleted', 'unavailable'].indexOf(toState) > -1) {
      reason = win.prompt('Reason for moving this property to "' + toState + '" (recorded permanently):');
      if (!reason) return;
    }

    btn.disabled = true;
    try {
      var res = await A.post(API.adminLifecycle, {
        listingId: lifecycleListingId, toState: toState, reason: reason
      });
      var msg = isRetryPurge ? '' : 'Moved to ' + res.stateLabel + '.' + (res.warning ? ' ' + res.warning : '');
      if (res.mediaPurge) {
        msg += (msg ? ' ' : '') + 'Media: ' + res.mediaPurge.deleted + ' of ' + res.mediaPurge.requested + ' removed from storage.' +
          (res.mediaPurge.failed.length ? ' ' + res.mediaPurge.failed.length + ' could not be removed — use Retry Media Removal.' : '');
      }
      A.msg($('adLcMsg'), msg, res.mediaPurge && res.mediaPurge.failed.length ? 'is-error' : 'is-ok');
      await loadLifecycle();
    } catch (err) {
      A.msg($('adLcMsg'), err.message, 'is-error');
      btn.disabled = false;
    }
  });

  /* ── REPORTS ────────────────────────────────────────────────────── */
  async function loadReports() {
    var report = $('adReportPick').value;
    try {
      var res = await A.get(API.adminReports + '?report=' + report);
      $('adReportBody').innerHTML = renderReport(report, res);
    } catch (e) {
      $('adReportBody').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  $('adReportPick').addEventListener('change', loadReports);

  function table(headers, rows) {
    if (!rows.length) return '<div class="ad-empty">No data for this report yet.</div>';
    return '<table class="ad-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function renderReport(report, res) {
    if (report === 'managers') {
      var section = function (title, list) {
        return '<div class="ad-card-head" style="margin-top:14px"><b>' + title + '</b></div>' +
          table(['Name', 'Role', 'Score', 'Verification %', 'Approved %', 'Rejected %', 'Inactive days'],
            list.map(function (m) {
              return '<tr><td><b>' + esc(m.name) + '</b></td><td>' + esc(A.roleLabel(m.role)) + '</td>' +
                '<td class="num">' + esc(m.performanceScore) + '</td>' +
                '<td class="num">' + (m.verificationPct == null ? '—' : m.verificationPct + '%') + '</td>' +
                '<td class="num">' + (m.approvalPct == null ? '—' : m.approvalPct + '%') + '</td>' +
                '<td class="num">' + (m.rejectedPct == null ? '—' : m.rejectedPct + '%') + '</td>' +
                '<td class="num">' + (m.inactiveDays == null ? '—' : m.inactiveDays) + '</td></tr>';
            }));
      };
      return section('Best performing', res.best) + section('Needs attention', res.worst);
    }

    if (report === 'areas') {
      return table(['Area', 'City', 'Properties', 'Published', 'Unavailable', 'Pending', 'Rejected', 'Verifications'],
        res.areas.map(function (a) {
          return '<tr><td><b>' + esc(a.areaName || a.areaNodeId) + '</b></td>' +
            '<td>' + esc(a.cityName || '—') + '</td>' +
            '<td class="num">' + a.totalProperties + '</td><td class="num">' + a.published + '</td>' +
            '<td class="num">' + a.unavailable + '</td><td class="num">' + a.pending + '</td>' +
            '<td class="num">' + a.rejected + '</td><td class="num">' + a.verifications + '</td></tr>';
        }));
    }

    if (report === 'growth') {
      return table(['Day', 'Added', 'By staff', 'By public'],
        res.series.map(function (g) {
          return '<tr><td>' + esc(A.fmtDate(g.day)) + '</td><td class="num">' + g.added + '</td>' +
            '<td class="num">' + g.byStaff + '</td><td class="num">' + g.byPublic + '</td></tr>';
        }));
    }

    if (report === 'trends') {
      return table(['Day', 'Verifications', 'Available', 'Unavailable'],
        res.series.map(function (t) {
          return '<tr><td>' + esc(A.fmtDate(t.day)) + '</td><td class="num">' + t.total + '</td>' +
            '<td class="num">' + t.available + '</td><td class="num">' + t.unavailable + '</td></tr>';
        }));
    }

    return table(['State', 'Listings', 'Average age (days)', 'Oldest (days)'],
      res.workload.map(function (w) {
        return '<tr><td><span class="ad-pill is-warn">' + esc(w.state) + '</span></td>' +
          '<td class="num">' + w.listings + '</td><td class="num">' + esc(w.avgAgeDays) + '</td>' +
          '<td class="num">' + esc(w.oldestAgeDays) + '</td></tr>';
      }));
  }

  /* ── TEAM ───────────────────────────────────────────────────────── */
  var ROLE_GROUPS = ['manager', 'assistant_ceo', 'field_officer'];
  var ROLE_DESC = {
    manager: 'Supervises Field Officers and reviews their property/location work within assigned areas.',
    assistant_ceo: 'Oversees assigned Area Managers and reviews operational performance.',
    field_officer: 'Collects and records property/location information within assigned scope.'
  };
  var ACTION_DESC = {
    view: 'Shows this member’s account details.',
    edit: 'Change this member’s full name or registered email.',
    reset: 'Invalidates the current password and creates a new credential.',
    disable: 'Stops login/access while preserving the member’s history.',
    enable: 'Restores this member’s ability to log in.',
    'delete': 'Ends active operational participation and requires assignment resolution (transfer or unassign) before their access is removed. History is kept for audit — this is not a hard delete.',
    assign: 'Defines which locations this team member is authorized to operate in.'
  };
  var teamFilters = { q: '', role: '', status: '' };
  var teamExpanded = {};   // userId -> 'view' | 'edit'
  var teamBound = false;

  /* Moves each element's `data-tip` attribute into its sibling bubble once,
     then makes the "?" button toggle it too — :hover/:focus-within already
     shows it for mouse and keyboard, this adds a plain tap for touch. */
  function bindTooltips(root) {
    (root || doc).querySelectorAll('.ad-tip[data-tip]').forEach(function (tip) {
      var bubble = tip.querySelector('.ad-tip-bubble');
      if (bubble && !bubble.textContent) bubble.textContent = tip.getAttribute('data-tip');
      if (tip.dataset.tipBound) return;
      tip.dataset.tipBound = '1';
      var btn = tip.querySelector('.ad-tip-btn');
      if (btn) btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = tip.classList.toggle('is-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }
  doc.addEventListener('click', function (e) {
    if (!e.target.closest('.ad-tip')) {
      doc.querySelectorAll('.ad-tip.is-open').forEach(function (t) { t.classList.remove('is-open'); });
    }
  });

  function tipSpan(key, label) {
    return '<span class="ad-tip" data-tip="' + esc(ACTION_DESC[key] || '') + '">' +
      '<button type="button" class="ad-tip-btn" aria-label="What does ' + esc(label) + ' do?">?</button>' +
      '<span class="ad-tip-bubble" role="tooltip"></span></span>';
  }

  function filteredTeam() {
    var q = teamFilters.q.trim().toLowerCase();
    return teamCache.filter(function (u) {
      if (teamFilters.role && u.role !== teamFilters.role) return false;
      if (teamFilters.status && u.status !== teamFilters.status) return false;
      if (!q) return true;
      return (u.fullName || '').toLowerCase().indexOf(q) > -1 ||
        (u.username || '').toLowerCase().indexOf(q) > -1 ||
        (u.email || '').toLowerCase().indexOf(q) > -1;
    });
  }

  function renderUserRow(u) {
    var mode = teamExpanded[u.id];
    var actions = u.manageable
      ? '<button class="ad-btn is-sm" type="button" data-view>View</button> ' +
        '<button class="ad-btn is-sm" type="button" data-edit>Edit</button> ' +
        '<button class="ad-btn is-sm" type="button" data-toggle="' + (u.status === 'active' ? 'disabled' : 'active') + '">' +
          (u.status === 'active' ? 'Disable' : 'Enable') + '</button> ' +
        '<button class="ad-btn is-sm" type="button" data-reset>Reset password</button> ' +
        '<button class="ad-btn is-sm is-danger" type="button" data-delete>Delete</button>'
      : '<span class="ad-pill">View only</span>';

    var row = '<tr data-user="' + esc(u.id) + '">' +
      '<td><b>' + esc(u.fullName) + '</b></td>' +
      '<td>' + esc(u.username) + '</td>' +
      '<td>' + esc(u.email || '—') + '</td>' +
      '<td><span class="ad-pill ' + (u.status === 'active' ? 'is-ok' : 'is-danger') + '">' + esc(u.status) + '</span></td>' +
      '<td>' + esc(A.fmtDateTime(u.lastLoginAt)) + '</td>' +
      '<td>' + esc(A.fmtDate(u.createdAt)) + '</td>' +
      '<td>' + actions + '</td>' +
    '</tr>';

    if (mode === 'view') {
      row += '<tr class="ad-detail-row"><td colspan="7"><div class="ad-detail-grid">' +
        '<div class="ad-kv-row"><span>Role</span><span>' + esc(A.roleLabel(u.role)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Username</span><span>' + esc(u.username) + '</span></div>' +
        '<div class="ad-kv-row"><span>Email</span><span>' + esc(u.email || '—') + '</span></div>' +
        '<div class="ad-kv-row"><span>Status</span><span>' + esc(u.status) + '</span></div>' +
        '<div class="ad-kv-row"><span>Created</span><span>' + esc(A.fmtDateTime(u.createdAt)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Last login</span><span>' + esc(A.fmtDateTime(u.lastLoginAt)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Last verification</span><span>' + esc(A.fmtDateTime(u.lastVerificationAt)) + '</span></div>' +
      '</div></td></tr>';
    } else if (mode === 'edit') {
      row += '<tr class="ad-detail-row"><td colspan="7"><div class="ad-row">' +
        '<div class="ad-field"><label>Full name</label><input class="ad-input" type="text" data-edit-fullname value="' + esc(u.fullName) + '" /></div>' +
        '<div class="ad-field"><label>Email</label><input class="ad-input" type="email" data-edit-email value="' + esc(u.email || '') + '" /></div>' +
        '</div><div class="ad-actions">' +
        '<button class="ad-btn is-primary is-sm" type="button" data-save-edit>Save</button>' +
        '<button class="ad-btn is-sm" type="button" data-cancel-edit>Cancel</button>' +
        '</div></td></tr>';
    }
    return row;
  }

  function renderTeamList() {
    var rows = filteredTeam();
    $('adTeamCount').textContent = teamCache.length + ' account(s)' +
      (rows.length !== teamCache.length ? ' · ' + rows.length + ' shown' : '');

    if (!teamCache.length) {
      $('adUserList').innerHTML = '<div class="ad-empty">No accounts yet.</div>';
      return;
    }
    if (!rows.length) {
      $('adUserList').innerHTML = '<div class="ad-empty">No accounts match this search/filter.</div>';
      return;
    }

    var head = '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
      '<th>Name</th><th>Username</th><th>Email</th><th>Status</th><th>Last login</th><th>Created</th><th></th>' +
    '</tr></thead><tbody>';
    var tail = '</tbody></table></div>';

    var html = ROLE_GROUPS.map(function (role) {
      var members = rows.filter(function (u) { return u.role === role; });
      if (!members.length) return '';
      return '<div class="ad-team-group">' +
        '<div class="ad-team-group-head">' +
          esc(A.roleLabel(role).toUpperCase()) +
          '<span class="ad-pill">' + members.length + '</span>' +
          '<span class="ad-tip" data-tip="' + esc(ROLE_DESC[role]) + '">' +
            '<button type="button" class="ad-tip-btn" aria-label="What is ' + esc(A.roleLabel(role)) + '?">?</button>' +
            '<span class="ad-tip-bubble" role="tooltip"></span></span>' +
        '</div>' +
        head + members.map(renderUserRow).join('') + tail +
      '</div>';
    }).join('');

    $('adUserList').innerHTML = html || '<div class="ad-empty">No accounts match this search/filter.</div>';
    bindTooltips($('adUserList'));
  }

  async function loadTeam() {
    /* The role select is built from capabilities rather than hardcoded —
       who may create whom is decided once, in rbac.js, and read here. */
    var roleOpts = [];
    if (can('users.create.assistant_ceo')) roleOpts.push('<option value="assistant_ceo">Assistant CEO</option>');
    if (can('users.create.manager')) roleOpts.push('<option value="manager">Area Manager</option>');
    if (can('users.create.field_officer')) roleOpts.push('<option value="field_officer">Field Officer</option>');
    $('adNewRole').innerHTML = roleOpts.join('');
    $('adCreateUserCard').hidden = !roleOpts.length;
    bindTooltips($('adCreateUserCard'));
    /* Area Manager now sees this panel (to manage their Field Officers)
       but does not hold tasks.assign — hide what they cannot do rather
       than let them hit a 403. */
    $('adTaskCard').hidden = !can('tasks.assign');

    try {
      var res = await A.get(API.adminUsers);
      teamCache = res.users;
      renderTeamList();

      var assignable = res.users.filter(function (u) { return u.manageable && u.status === 'active'; });
      var opts = assignable.map(function (u) {
        return '<option value="' + esc(u.id) + '">' + esc(u.fullName) + ' (' + esc(A.roleLabel(u.role)) + ')</option>';
      }).join('');
      $('adAssignUser').innerHTML = opts || '<option value="">No eligible accounts</option>';
      $('adTaskUser').innerHTML = opts || '<option value="">No eligible accounts</option>';

      /* Built once — the cascade's listeners must not be bound again every
         time the panel is reopened, or one click would fire N assigns. */
      if (!areaPickerReady) {
        areaPickerReady = true;
        await initAreaPicker();
      }
      refreshAssignScope();

      await loadAssignments();
    } catch (e) {
      $('adUserList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }

    if (!teamBound) {
      teamBound = true;
      $('adTeamSearch').addEventListener('input', function () { teamFilters.q = this.value; renderTeamList(); });
      $('adTeamRoleFilter').addEventListener('change', function () { teamFilters.role = this.value; renderTeamList(); });
      $('adTeamStatusFilter').addEventListener('change', function () { teamFilters.status = this.value; renderTeamList(); });
    }
  }

  $('adCreateUser').addEventListener('click', async function () {
    var role = $('adNewRole').value;
    var fullName = $('adNewFullName').value.trim();
    var username = $('adNewUsername').value.trim();
    var password = $('adNewPassword').value;
    var email = $('adNewEmail').value.trim();

    if (!role || !fullName || !username || !password || !email) {
      A.msg($('adUserMsg'), 'Designation, full name, username, password and email are all required.', 'is-error');
      return;
    }
    if (password.length < 10) {
      A.msg($('adUserMsg'), 'Password must be at least 10 characters.', 'is-error');
      return;
    }

    this.disabled = true;
    try {
      await A.post(API.adminUsers, {
        action: 'create', role: role, fullName: fullName, username: username, email: email, password: password
      });
      A.msg($('adUserMsg'), 'Team member created with the password and email you set.', 'is-ok');
      $('adNewFullName').value = '';
      $('adNewUsername').value = '';
      $('adNewPassword').value = '';
      $('adNewEmail').value = '';
      await loadTeam();
    } catch (e) {
      A.msg($('adUserMsg'), e.message, 'is-error');
    }
    this.disabled = false;
  });

  $('adUserList').addEventListener('click', async function (e) {
    var row = e.target.closest('[data-user]');
    if (!row) return;
    var userId = row.getAttribute('data-user');
    var toggle = e.target.closest('[data-toggle]');
    var reset = e.target.closest('[data-reset]');
    var view = e.target.closest('[data-view]');
    var edit = e.target.closest('[data-edit]');
    var del = e.target.closest('[data-delete]');
    var saveEdit = e.target.closest('[data-save-edit]');
    var cancelEdit = e.target.closest('[data-cancel-edit]');

    try {
      if (toggle) {
        await A.post(API.adminUsers, {
          action: 'set-status', userId: userId, status: toggle.getAttribute('data-toggle')
        });
        A.msg($('adUserMsg'), 'Account updated. Any active sessions were revoked.', 'is-ok');
        await loadTeam();
      } else if (reset) {
        if (!win.confirm('Reset this password? Their sessions end immediately.')) return;
        var res = await A.post(API.adminUsers, { action: 'reset-password', userId: userId });
        A.msg($('adUserMsg'), 'New temporary password (shown once): ' + res.temporaryPassword, 'is-ok');
      } else if (del) {
        if (!win.confirm('Delete this team member? This stops their access immediately. Their audit history is kept, not erased — this matches the console-wide "no hard deletes" policy.')) return;

        var delPayload = { action: 'set-status', userId: userId, status: 'archived' };
        try {
          await A.post(API.adminUsers, delPayload);
        } catch (blockErr) {
          if (blockErr.status !== 409 || !blockErr.data || !blockErr.data.needsResolution) throw blockErr;

          var assigns = blockErr.data.assignments || [];
          var areaList = assigns.map(function (a) { return a.areaName || a.nodeId; }).join(', ');
          var removedRow = (teamCache || []).find(function (u) { return u.id === userId; });
          var eligible = (teamCache || []).filter(function (u) {
            return u.role === (removedRow && removedRow.role) && u.status === 'active' && u.id !== userId;
          });

          var choice = win.prompt(
            'This member still has ' + assigns.length + ' active area assignment(s): ' + areaList + '.\n\n' +
            'Type TRANSFER to move them to another ' + (removedRow ? removedRow.role : 'team member') +
            (eligible.length ? ' (eligible: ' + eligible.map(function (u) { return u.fullName; }).join(', ') + ')' : ' — no eligible recipient is currently active') +
            ',\nor type UNASSIGN to return them to CEO-controlled pending (no owner) and continue the delete.',
            eligible.length ? 'TRANSFER' : 'UNASSIGN'
          );
          if (!choice) return;
          choice = choice.trim().toLowerCase();

          if (choice === 'transfer') {
            if (!eligible.length) { A.msg($('adUserMsg'), 'No eligible active recipient with the same role — use UNASSIGN instead.', 'is-error'); return; }
            var toName = win.prompt('Transfer to which team member?\n' + eligible.map(function (u) { return u.fullName + ' (' + u.username + ')'; }).join('\n'));
            if (!toName) return;
            var toUser = eligible.find(function (u) { return u.fullName === toName.trim() || u.username === toName.trim(); });
            if (!toUser) { A.msg($('adUserMsg'), 'No exact match for "' + toName + '" among eligible recipients.', 'is-error'); return; }
            if (!win.confirm('Transfer ' + assigns.length + ' area assignment(s) from this member to ' + toUser.fullName + '?')) return;
            delPayload.resolution = 'transfer';
            delPayload.transferToUserId = toUser.id;
          } else if (choice === 'unassign') {
            if (!win.confirm('Return ' + assigns.length + ' area(s) to unassigned/pending and continue the delete?')) return;
            delPayload.resolution = 'unassign';
          } else {
            return;
          }

          await A.post(API.adminUsers, delPayload);
        }

        A.msg($('adUserMsg'), 'Team member deleted. Access is revoked; their history is retained for audit.', 'is-ok');
        delete teamExpanded[userId];
        await loadTeam();
        await loadAssignments();
      } else if (view) {
        teamExpanded[userId] = teamExpanded[userId] === 'view' ? null : 'view';
        renderTeamList();
      } else if (edit) {
        teamExpanded[userId] = teamExpanded[userId] === 'edit' ? null : 'edit';
        renderTeamList();
      } else if (cancelEdit) {
        teamExpanded[userId] = null;
        renderTeamList();
      } else if (saveEdit) {
        var detailRow = row.nextElementSibling;
        var fullNameEl = detailRow.querySelector('[data-edit-fullname]');
        var emailEl = detailRow.querySelector('[data-edit-email]');
        await A.post(API.adminUsers, {
          action: 'update', userId: userId,
          fullName: fullNameEl.value.trim(), email: emailEl.value.trim()
        });
        A.msg($('adUserMsg'), 'Team member updated.', 'is-ok');
        teamExpanded[userId] = null;
        await loadTeam();
      }
    } catch (err) {
      A.msg($('adUserMsg'), err.message, 'is-error');
    }
  });

  var assignExpanded = {};   // userId -> true when expanded

  function assignSummary(rows) {
    var cities = rows.filter(function (a) { return a.level === 'city'; }).length;
    var mains = rows.filter(function (a) { return a.level === 'main'; }).length;
    var subs = rows.filter(function (a) { return a.level === 'sub'; }).length;
    if (cities || mains) {
      var parts = [];
      if (cities) parts.push(cities + ' cit' + (cities === 1 ? 'y' : 'ies'));
      if (mains) parts.push(mains + ' main location' + (mains === 1 ? '' : 's'));
      if (subs) parts.push(subs + ' sub location' + (subs === 1 ? '' : 's'));
      return parts.join(' · ');
    }
    return rows.length + ' location' + (rows.length === 1 ? '' : 's') + ' assigned';
  }

  async function loadAssignments() {
    try {
      var res = await A.get(API.adminAssignments);
      if (!res.assignments.length) {
        $('adAssignmentList').innerHTML = '<div class="ad-empty">No areas assigned yet.</div>';
        return;
      }

      /* Grouped by user, collapsed by default — the flat per-assignment
         list this replaced became unreadable past a handful of rows
         (29+ sub-locations for one manager was the reported case). No
         new data: same /api/admin/assignments response, just grouped
         client-side. */
      var byUser = {};
      var order = [];
      res.assignments.forEach(function (a) {
        if (!byUser[a.userId]) { byUser[a.userId] = []; order.push(a.userId); }
        byUser[a.userId].push(a);
      });

      $('adAssignmentList').innerHTML = order.map(function (userId) {
        var rows = byUser[userId];
        var expanded = !!assignExpanded[userId];
        var head = '<div class="ad-verify-row" data-assign-group="' + esc(userId) + '">' +
          '<button class="ad-btn is-sm ad-assign-toggle" type="button" data-toggle-user="' + esc(userId) + '" ' +
          'aria-expanded="' + expanded + '" aria-controls="assignRows-' + esc(userId) + '">' +
          '<span class="ad-chevron' + (expanded ? ' is-open' : '') + '" aria-hidden="true">&#9656;</span></button>' +
          '<div class="ad-grow"><b>' + esc(rows[0].userName || 'Unknown') + '</b>' +
          '<small>' + esc(rows[0].userRole || '') + ' · ' + esc(assignSummary(rows)) + '</small></div>' +
        '</div>';

        var detail = '<div class="ad-detail-grid" id="assignRows-' + esc(userId) + '"' + (expanded ? '' : ' hidden') + '>' +
          rows.map(function (a) {
            return '<div class="ad-verify-row" data-assignment="' + esc(a.id) + '">' +
              '<div class="ad-grow"><b>' + esc(a.areaName || a.nodeId) + '</b>' +
              '<small>' + esc(a.nodeId) + ' · ' + esc(a.level) + '</small></div>' +
              '<button class="ad-btn is-sm is-danger" type="button" data-revoke>Revoke</button>' +
            '</div>';
          }).join('') +
        '</div>';

        return head + detail;
      }).join('');
    } catch (e) {
      $('adAssignmentList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  /* ── area picker: City → Main → Sub, from the Location Data Bank ──
     LOC/BANK are the same engine location-manager.html drives, loaded on
     this page for exactly this purpose. Nothing here holds its own list
     of places, and no node id can be typed by hand — every value below
     comes from a node that exists in the bank, which is what makes the
     resulting assignment resolvable by rbac.getScopeNodeIds. */
  var LOC = win.MOR_LOC, BANK = win.MOR_BANK;
  var areaPickerReady = false;

  function assignEls() {
    return {
      city: $('adAssignCity'), main: $('adAssignMain'),
      subWrap: $('adAssignSubWrap'), subs: $('adAssignSubs'),
      search: $('adAssignSubSearch'), scope: $('adAssignScope'),
      btn: $('adAssignArea')
    };
  }

  function fillSelect(sel, items, placeholder) {
    sel.innerHTML = '<option value="">' + placeholder + '</option>' +
      items.map(function (n) {
        return '<option value="' + esc(n.id) + '">' + esc(n.name) + '</option>';
      }).join('');
  }

  /* What pressing Assign will actually do, stated before it happens.
     Sub selections win; with none, the Main Location is assigned; with no
     Main, the whole city. All three are depths the assignments API
     already accepts — levelFromNodeId derives the tier from the path. */
  function selectedNodes() {
    var el = assignEls();
    var checked = Array.prototype.filter.call(
      el.subs.querySelectorAll('input[type=checkbox]'), function (c) { return c.checked; });
    if (checked.length) {
      return checked.map(function (c) {
        return { id: c.value, name: c.getAttribute('data-name'), level: 'sub' };
      });
    }
    if (el.main.value) {
      return [{ id: el.main.value, name: el.main.selectedOptions[0].textContent, level: 'main' }];
    }
    if (el.city.value) {
      return [{ id: el.city.value, name: el.city.selectedOptions[0].textContent, level: 'city' }];
    }
    return [];
  }

  function refreshAssignScope() {
    var el = assignEls();
    var nodes = selectedNodes();
    var who = $('adAssignUser').value;
    el.btn.disabled = !who || !nodes.length;

    if (!nodes.length) { el.scope.textContent = ''; return; }
    if (nodes[0].level === 'sub') {
      el.scope.textContent = nodes.length === 1
        ? 'Will assign 1 sub location: ' + nodes[0].name
        : 'Will assign ' + nodes.length + ' sub locations.';
    } else if (nodes[0].level === 'main') {
      el.scope.textContent = 'Will assign the whole main location “' + nodes[0].name +
        '” (covers every sub location inside it).';
    } else {
      el.scope.textContent = 'Will assign the whole city “' + nodes[0].name + '”.';
    }
  }

  function renderSubs() {
    var el = assignEls();
    var mainId = el.main.value;
    if (!mainId) { el.subWrap.hidden = true; el.subs.innerHTML = ''; refreshAssignScope(); return; }

    var q = (el.search.value || '').trim().toLowerCase();
    var list = LOC.getSubAreas(mainId).filter(function (s) {
      return !q || s.name.toLowerCase().indexOf(q) > -1;
    });

    el.subWrap.hidden = false;
    el.subs.innerHTML = list.length
      ? list.map(function (s) {
          return '<label class="ad-sub"><input type="checkbox" value="' + esc(s.id) +
            '" data-name="' + esc(s.name) + '" /><span>' + esc(s.name) + '</span></label>';
        }).join('')
      : '<div class="ad-empty">' + (q ? 'No sub location matches that.'
          : 'This main location has no sub locations yet — assigning it covers the whole area.') + '</div>';
    refreshAssignScope();
  }

  async function initAreaPicker() {
    var el = assignEls();
    if (!LOC || !BANK) {
      el.scope.textContent = 'The location engine did not load; area assignment is unavailable.';
      return;
    }
    /* Local bank first so the picker is usable instantly, then the
       published server bank merged over it — same order every other page
       uses. Both are best-effort: the fixture alone still yields a
       working cascade. */
    try { BANK.hydrate(); } catch (e) {}
    try { await BANK.pullCitiesFromApi(); } catch (e) {}
    try { await BANK.pullFromApi(); } catch (e) {}

    fillSelect(el.city, LOC.listCities(), 'Select city');

    el.city.addEventListener('change', function () {
      var mains = this.value ? LOC.getMainAreas(this.value) : [];
      el.main.disabled = !mains.length;
      fillSelect(el.main, mains,
        this.value ? (mains.length ? 'Whole city' : 'No main locations published') : 'Select a city first');
      renderSubs();
    });
    el.main.addEventListener('change', renderSubs);
    el.search.addEventListener('input', renderSubs);
    el.subs.addEventListener('change', refreshAssignScope);
    $('adAssignUser').addEventListener('change', refreshAssignScope);

    $('adAssignSubAll').addEventListener('click', function () {
      el.subs.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = true; });
      refreshAssignScope();
    });
    $('adAssignSubNone').addEventListener('click', function () {
      el.subs.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
      refreshAssignScope();
    });
  }

  $('adAssignArea').addEventListener('click', async function () {
    var userId = $('adAssignUser').value;
    var nodes = selectedNodes();
    if (!userId || !nodes.length) {
      A.msg($('adAssignMsg'), 'Choose a team member and a location.', 'is-error');
      return;
    }

    this.disabled = true;
    A.msg($('adAssignMsg'), 'Assigning…');

    /* One call per node, through the existing endpoint — the API assigns a
       single area per request and enforces "one active manager per area"
       in the database. Each is reported independently so a clash on one
       sub location never hides the ones that did succeed. */
    var done = 0, taken = [], failed = [];
    for (var i = 0; i < nodes.length; i++) {
      try {
        await A.post(API.adminAssignments, { action: 'assign', userId: userId, nodeId: nodes[i].id });
        done++;
      } catch (e) {
        if (e.status === 409) taken.push(nodes[i].name);
        else failed.push(nodes[i].name + ' (' + e.message + ')');
      }
    }

    var parts = [];
    if (done) parts.push(done + (done === 1 ? ' area assigned' : ' areas assigned'));
    if (taken.length) parts.push('already has a manager: ' + taken.join(', '));
    if (failed.length) parts.push('failed: ' + failed.join('; '));
    A.msg($('adAssignMsg'), parts.join(' · ') || 'Nothing to assign.',
      failed.length || (!done && taken.length) ? 'is-error' : 'is-ok');

    if (done) {
      assignEls().subs.querySelectorAll('input[type=checkbox]').forEach(function (c) { c.checked = false; });
      refreshAssignScope();
    }
    this.disabled = false;
    await loadAssignments();
  });

  $('adAssignmentList').addEventListener('click', async function (e) {
    var toggle = e.target.closest('[data-toggle-user]');
    if (toggle) {
      var uid = toggle.getAttribute('data-toggle-user');
      assignExpanded[uid] = !assignExpanded[uid];
      await loadAssignments();
      return;
    }

    var btn = e.target.closest('[data-revoke]');
    if (!btn) return;
    var id = btn.closest('[data-assignment]').getAttribute('data-assignment');
    try {
      await A.post(API.adminAssignments, { action: 'revoke', assignmentId: id });
      A.msg($('adAssignMsg'), 'Assignment revoked.', 'is-ok');
      await loadAssignments();
    } catch (err) {
      A.msg($('adAssignMsg'), err.message, 'is-error');
    }
  });

  function refreshTaskNotesVisibility() {
    $('adTaskNotesWrap').hidden = $('adTaskType').value !== 'custom';
  }
  $('adTaskType').addEventListener('change', refreshTaskNotesVisibility);
  refreshTaskNotesVisibility();

  $('adCreateTask').addEventListener('click', async function () {
    var payload = {
      action: 'create',
      assignedTo: $('adTaskUser').value,
      taskType: $('adTaskType').value,
      targetCount: Number($('adTaskTarget').value),
      dueDate: $('adTaskDue').value || A.todayISO()
    };
    var notes = $('adTaskNotes').value.trim();
    if (payload.taskType === 'custom' && notes) payload.notes = notes;

    if (!payload.assignedTo) {
      A.msg($('adTaskMsg'), 'Choose a team member.', 'is-error');
      return;
    }
    if (payload.taskType === 'custom' && !notes) {
      A.msg($('adTaskMsg'), 'Describe the custom task in the instructions field.', 'is-error');
      return;
    }
    try {
      await A.post(API.adminTasks, payload);
      A.msg($('adTaskMsg'), 'Task assigned.', 'is-ok');
      $('adTaskNotes').value = '';
    } catch (e) {
      A.msg($('adTaskMsg'), e.message, 'is-error');
    }
  });

  /* ── MONITORING ─────────────────────────────────────────────────── */
  async function loadMonitor() {
    try {
      var res = await A.get(API.adminMonitor);
      $('adMonitorTable').innerHTML = res.managers.length
        ? '<table class="ad-table"><thead><tr>' +
            '<th>Name</th><th>Role</th><th class="num">Areas</th><th class="num">Pending</th>' +
            '<th class="num">Done</th><th class="num">Verified %</th><th class="num">Available</th>' +
            '<th class="num">Unavailable</th><th class="num">Added</th><th class="num">Avg resp (h)</th>' +
            '<th>Last login</th><th>Last verification</th>' +
          '</tr></thead><tbody>' +
          res.managers.map(function (m) {
            return '<tr>' +
              '<td><b>' + esc(m.name) + '</b></td>' +
              '<td>' + esc(A.roleLabel(m.role)) + '</td>' +
              '<td class="num">' + m.assignedAreas + '</td>' +
              '<td class="num">' + m.pendingTasks + '</td>' +
              '<td class="num">' + m.completedTasks + '</td>' +
              '<td class="num">' + (m.verificationPct == null ? '—' : m.verificationPct + '%') + '</td>' +
              '<td class="num">' + m.availableProperties + '</td>' +
              '<td class="num">' + m.unavailableProperties + '</td>' +
              '<td class="num">' + m.newPropertiesAdded + '</td>' +
              '<td class="num">' + (m.averageResponseHours == null ? '—' : m.averageResponseHours) + '</td>' +
              '<td>' + esc(A.fmtDateTime(m.lastLoginAt)) + '</td>' +
              '<td>' + esc(A.fmtDateTime(m.lastVerificationAt)) + '</td>' +
            '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ad-empty">No team members to monitor yet.</div>';
    } catch (e) {
      $('adMonitorTable').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  /* ── SETTINGS ───────────────────────────────────────────────────── */
  async function loadSettings() {
    try {
      var res = await A.get(API.adminSettings);
      $('adApprovalChain').value = res.approvalChain;
      $('adAutoPublish').value = String(res.autoPublish);
      /* Read-only for an Assistant CEO: they can see the governing rule
         without being able to change it. */
      var writable = can('settings.write');
      $('adApprovalChain').disabled = !writable;
      $('adAutoPublish').disabled = !writable;
      $('adSaveSettings').hidden = !writable;
    } catch (e) {
      A.msg($('adSettingsMsg'), e.message, 'is-error');
    }
  }

  $('adSaveSettings').addEventListener('click', async function () {
    try {
      await A.post(API.adminSettings, {
        approvalChain: $('adApprovalChain').value,
        autoPublish: $('adAutoPublish').value === 'true'
      });
      A.msg($('adSettingsMsg'), 'Workflow saved. The change is recorded in the audit log.', 'is-ok');
    } catch (e) {
      A.msg($('adSettingsMsg'), e.message, 'is-error');
    }
  });

  /* ── AUDIT ──────────────────────────────────────────────────────── */
  async function loadAudit() {
    try {
      var res = await A.get(API.adminMonitor + '?audit=1&limit=150');
      $('adAuditList').innerHTML = res.events.length
        ? '<table class="ad-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>' +
          res.events.map(function (ev) {
            return '<tr>' +
              '<td>' + esc(A.fmtDateTime(ev.at)) + '</td>' +
              '<td>' + esc(ev.actorRole ? A.roleLabel(ev.actorRole) : '—') + '</td>' +
              '<td><b>' + esc(ev.action) + '</b></td>' +
              '<td>' + esc(ev.entityType || '—') + '</td>' +
              '<td>' + esc(ev.ip || '—') + '</td>' +
            '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ad-empty">No audit events yet.</div>';
    } catch (e) {
      $('adAuditList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  /* ── sign out ───────────────────────────────────────────────────── */
  $('adLogout').addEventListener('click', async function () {
    try { await A.post(API.adminLogout, {}); } catch (e) { /* clear the cookie regardless */ }
    win.location.href = CFG.routes.adminLoginPage;
  });

  /* ── boot ───────────────────────────────────────────────────────── */
  (async function boot() {
    try {
      ME = await A.requireSession();
    } catch (e) {
      /* Anything other than "not signed in" (which requireSession handles
         by redirecting) lands here — API unreachable, 500, bad deploy.
         Say so plainly instead of leaving the page stuck on "Loading…". */
      $('adSubtitle').textContent = 'Could not reach the admin API: ' + e.message;
      $('adTabs').innerHTML = '<div class="ad-empty">The console could not start. ' +
        'Check that the Pages Functions deployment is live, then reload.</div>';
      return;
    }
    if (!ME) return;   // requireSession already redirected

    ME.capabilities.forEach(function (c) { CAPS[c] = true; });

    $('adUserName').textContent = ME.user.fullName;
    $('adRoleBadge').textContent = A.roleLabel(ME.user.role);
    $('adRoleBadge').className = 'ad-role' + (ME.user.role === 'ceo' ? ' is-ceo' : '');
    $('adTitle').textContent = A.roleLabel(ME.user.role) + ' Console';
    $('adSubtitle').textContent = ME.areas === null
      ? 'Global authority across every city and area.'
      : (ME.areas.length
          ? 'Assigned areas: ' + ME.areas.map(function (a) { return a.name || a.nodeId; }).join(', ')
          : 'No areas assigned yet — ask your Assistant CEO or the CEO to assign one.');

    $('adTaskDue').value = A.todayISO();
    renderTabs();
    refreshBell();
    bindTooltips(doc);

    /* Poll the unread badge. 60s rather than a socket: at 120 admin users
       this is negligible load, and a websocket would be real infrastructure
       for a number that can be a minute stale without anyone caring. */
    win.setInterval(refreshBell, 60000);
  })();
})(window, document);
