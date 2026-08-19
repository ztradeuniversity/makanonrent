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
              t.pendingCount + ' remaining</small></div>' +
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

  async function loadLifecycle() {
    if (!lifecycleListingId) return;
    A.msg($('adLcMsg'), '');
    try {
      var res = await A.get(API.adminLifecycle + '?listingId=' + encodeURIComponent(lifecycleListingId));
      $('adLcTitle').textContent = res.businessCode + ' — ' + res.stateLabel;

      /* Buttons come from the server's list of transitions THIS role may
         make, so the console can never offer a move the API would refuse. */
      $('adLcActions').innerHTML = res.availableTransitions.length
        ? res.availableTransitions.map(function (t) {
            var danger = ['rejected', 'archived', 'deleted'].indexOf(t.state) > -1;
            return '<button class="ad-btn is-sm' + (danger ? ' is-danger' : ' is-primary') +
              '" type="button" data-to="' + esc(t.state) + '">' + esc(t.label) + '</button>';
          }).join('')
        : '<span class="ad-pill">No moves available to your role from this state.</span>';

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

    /* Mirrors REASON_REQUIRED in functions/utils/lifecycle.js. */
    var reason = null;
    if (['rejected', 'archived', 'deleted', 'unavailable'].indexOf(toState) > -1) {
      reason = win.prompt('Reason for moving this property to "' + toState + '" (recorded permanently):');
      if (!reason) return;
    }

    btn.disabled = true;
    try {
      var res = await A.post(API.adminLifecycle, {
        listingId: lifecycleListingId, toState: toState, reason: reason
      });
      A.msg($('adLcMsg'), 'Moved to ' + res.stateLabel + '.' + (res.warning ? ' ' + res.warning : ''), 'is-ok');
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
  async function loadTeam() {
    /* The CEO may create Assistant CEOs; an Assistant CEO may not. The
       select is built from capabilities rather than hardcoded. */
    var roleOpts = [];
    if (can('users.create.assistant_ceo')) roleOpts.push('<option value="assistant_ceo">Assistant CEO</option>');
    if (can('users.create.manager')) roleOpts.push('<option value="manager">Manager</option>');
    $('adNewRole').innerHTML = roleOpts.join('');
    $('adCreateUserCard').hidden = !roleOpts.length;

    try {
      var res = await A.get(API.adminUsers);
      teamCache = res.users;

      $('adTeamCount').textContent = res.users.length + ' account(s)';
      $('adUserList').innerHTML = res.users.length
        ? '<table class="ad-table"><thead><tr>' +
            '<th>Name</th><th>Username</th><th>Role</th><th>Status</th><th>Last login</th><th></th>' +
          '</tr></thead><tbody>' +
          res.users.map(function (u) {
            return '<tr data-user="' + esc(u.id) + '">' +
              '<td><b>' + esc(u.fullName) + '</b></td>' +
              '<td>' + esc(u.username) + '</td>' +
              '<td>' + esc(A.roleLabel(u.role)) + '</td>' +
              '<td><span class="ad-pill ' + (u.status === 'active' ? 'is-ok' : 'is-danger') + '">' + esc(u.status) + '</span></td>' +
              '<td>' + esc(A.fmtDateTime(u.lastLoginAt)) + '</td>' +
              '<td>' + (u.manageable
                ? '<button class="ad-btn is-sm" type="button" data-toggle="' + (u.status === 'active' ? 'disabled' : 'active') + '">' +
                    (u.status === 'active' ? 'Disable' : 'Enable') + '</button> ' +
                  '<button class="ad-btn is-sm" type="button" data-reset>Reset password</button>'
                : '') + '</td>' +
            '</tr>';
          }).join('') + '</tbody></table>'
        : '<div class="ad-empty">No accounts yet.</div>';

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
  }

  $('adCreateUser').addEventListener('click', async function () {
    var role = $('adNewRole').value;
    var fullName = $('adNewFullName').value.trim();
    var username = $('adNewUsername').value.trim();

    if (!role || !fullName || !username) {
      A.msg($('adUserMsg'), 'Role, full name and username are all required.', 'is-error');
      return;
    }

    this.disabled = true;
    try {
      var res = await A.post(API.adminUsers, {
        action: 'create', role: role, fullName: fullName, username: username
      });
      /* The temporary password is shown once and never again — it is not
         stored in readable form anywhere. */
      A.msg($('adUserMsg'),
        'Account created. Temporary password (shown once): ' + res.temporaryPassword, 'is-ok');
      $('adNewFullName').value = '';
      $('adNewUsername').value = '';
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
      }
    } catch (err) {
      A.msg($('adUserMsg'), err.message, 'is-error');
    }
  });

  async function loadAssignments() {
    try {
      var res = await A.get(API.adminAssignments);
      $('adAssignmentList').innerHTML = res.assignments.length
        ? res.assignments.map(function (a) {
            return '<div class="ad-verify-row" data-assignment="' + esc(a.id) + '">' +
              '<div class="ad-grow"><b>' + esc(a.areaName || a.nodeId) + '</b>' +
              '<small>' + esc(a.nodeId) + ' · ' + esc(a.level) + ' · ' + esc(a.userName) + '</small></div>' +
              '<button class="ad-btn is-sm is-danger" type="button" data-revoke>Revoke</button>' +
            '</div>';
          }).join('')
        : '<div class="ad-empty">No areas assigned yet.</div>';
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

  $('adCreateTask').addEventListener('click', async function () {
    var payload = {
      action: 'create',
      assignedTo: $('adTaskUser').value,
      taskType: $('adTaskType').value,
      targetCount: Number($('adTaskTarget').value),
      dueDate: $('adTaskDue').value || A.todayISO()
    };
    if (!payload.assignedTo) {
      A.msg($('adTaskMsg'), 'Choose a team member.', 'is-error');
      return;
    }
    try {
      await A.post(API.adminTasks, payload);
      A.msg($('adTaskMsg'), 'Task assigned.', 'is-ok');
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

    /* Poll the unread badge. 60s rather than a socket: at 120 admin users
       this is negligible load, and a websocket would be real infrastructure
       for a number that can be a minute stale without anyone caring. */
    win.setInterval(refreshBell, 60000);
  })();
})(window, document);
