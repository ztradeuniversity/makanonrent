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
    /* FO Dashboard content (1A): assigned areas + who they report to.
       ME.areas/ME.reportsTo already come from /api/admin/me at boot — no
       second fetch, no second scope resolution. Only shown for the two
       roles this is actually about; CEO is global (ME.areas is null) and
       Assistant CEO's own area assignment isn't the "field work" framing
       this card is for. */
    if (ME && (ME.user.role === 'manager' || ME.user.role === 'field_officer')) {
      $('adMyAreasCard').hidden = false;
      $('adMyReportsTo').textContent = ME.reportsTo || 'CEO';
      var areas = ME.areas || [];
      $('adMyAreasList').innerHTML = areas.length
        ? areas.map(function (a) {
            return '<div class="ad-verify-row"><div class="ad-grow"><b>' + esc(a.name || a.nodeId) + '</b>' +
              '<small>' + esc(a.nodeId) + ' · ' + esc(a.level) + '</small></div></div>';
          }).join('')
        : '<div class="ad-empty">No areas assigned yet.</div>';
    }

    /* "My team & areas" overview (Assistant CEO / Manager only — CEO has
       its own global monitoring tab, and a Field Officer delegates to
       nobody). Every figure is read from data already fetched elsewhere
       in the console (users.list — now correctly hierarchy-scoped — and
       the review queue), never a stored or hardcoded count, so it cannot
       drift from what the Team/Verify tabs themselves show. */
    if (ME && (ME.user.role === 'assistant_ceo' || ME.user.role === 'manager')) {
      $('adOverviewCard').hidden = false;
      loadMyOverview();
    }

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

  async function loadMyOverview() {
    try {
      var usersRes = await A.get(API.adminUsers);
      var users = usersRes.users || [];
      var managers = users.filter(function (u) { return u.role === 'manager' && u.status === 'active'; }).length;
      var fos = users.filter(function (u) { return u.role === 'field_officer' && u.status === 'active'; }).length;

      var areas = (ME && ME.areas) || [];
      var cities = areas.filter(function (a) { return a.level === 'city'; }).length;
      var mains = areas.filter(function (a) { return a.level === 'main'; }).length;
      var subs = areas.filter(function (a) { return a.level === 'sub'; }).length;

      var reviewPending = 0;
      if (can('verification.review')) {
        try {
          var reviewRes = await A.get(API.adminVerifications + '?reviewQueue=1');
          reviewPending = (reviewRes.reports || []).length;
        } catch (e) { /* stat card degrades gracefully, not a hard error */ }
      }

      var parts = [];
      if (ME.user.role === 'assistant_ceo') parts.push(stat(managers, 'Area Managers'));
      parts.push(stat(fos, 'Field Officers'));
      parts.push(stat(cities, 'Cities'));
      parts.push(stat(mains, 'Main locations'));
      parts.push(stat(subs, 'Sub locations'));
      parts.push(stat(reviewPending, 'Reports awaiting review', true));
      $('adOverviewStats').innerHTML = parts.join('');
    } catch (e) {
      $('adOverviewStats').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
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

  /* ── VERIFY — this IS the Field Visit / Field Report submission flow.
     property_verifications (existing, migration 0004) already stores
     findings/GPS/media for every role including field_officer; this only
     adds the UI to actually reach those fields — comments, GPS capture
     and evidence upload were accepted by the API long before there was
     any way to send them. ───────────────────────────────────────────── */
  var verifySelection = {};
  var verifyExpanded = {};   // propertyId -> true when its findings/media panel is open

  async function loadVerify() {
    verifySelection = {};
    verifyExpanded = {};
    updateVerifyCount();
    try {
      var res = await A.get(API.adminVerifications);
      $('adVerifyList').__lastProps = res.properties;
      $('adVerifyList').innerHTML = res.properties.length
        ? res.properties.map(renderVerifyRow).join('')
        : '<div class="ad-empty">No properties in your assigned areas yet.</div>';
      bindTooltips($('adVerifyList'));
    } catch (e) {
      $('adVerifyList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }

    $('adMyReportsCard').hidden = !can('properties.verify');
    if (can('properties.verify')) await loadMyReports();

    $('adReviewCard').hidden = !can('verification.review');
    if (can('verification.review')) await loadReviewQueue();
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
    var expanded = !!verifyExpanded[p.id];
    var sel = verifySelection[p.id] || {};
    var proofCount = (sel.proof || []).length;
    var head = '<div class="ad-verify-row" data-prop="' + esc(p.id) + '">' +
      '<div class="ad-grow"><b>' + esc(p.businessCode) + '</b>' +
      '<small>' + esc(p.areaName) + ', ' + esc(p.cityName) + '</small></div>' +
      '<div class="ad-choice">' +
        '<label><input type="radio" name="v-' + esc(p.id) + '" value="available"' + (sel.status === 'available' ? ' checked' : '') + ' />Available</label>' +
        '<label class="is-no"><input type="radio" name="v-' + esc(p.id) + '" value="unavailable"' + (sel.status === 'unavailable' ? ' checked' : '') + ' />Unavailable</label>' +
      '</div>' +
      '<input class="ad-input" style="max-width:150px" type="tel" placeholder="Phone" data-phone="' + esc(p.id) + '" value="' + esc(sel.phoneNumber || '') + '" />' +
      '<button class="ad-btn is-sm" type="button" data-toggle-findings="' + esc(p.id) + '">Add findings' +
        (sel.comments || sel.gps || proofCount ? ' (' + [sel.comments ? '1 note' : null, sel.gps ? 'GPS' : null, proofCount ? proofCount + ' file(s)' : null].filter(Boolean).join(', ') + ')' : '') +
      '</button>' +
    '</div>';

    var panel = '';
    if (expanded) {
      panel = '<div class="ad-detail-grid" style="margin-bottom:14px;">' +
        '<div class="ad-field"><label class="ad-label-tip">Field Findings / Notes' +
          tipSpan('findings', 'Field Findings') +
          '</label><textarea class="ad-input" rows="3" data-findings="' + esc(p.id) +
          '" placeholder="What you observed — property/location condition, issues, anything the reviewer needs to know.">' + esc(sel.comments || '') + '</textarea></div>' +
        '<div class="ad-kv-row">' +
          '<button class="ad-btn is-sm" type="button" data-capture-gps="' + esc(p.id) + '">Capture GPS</button>' +
          '<span>' + (sel.gps ? esc(sel.gps.lat.toFixed(5)) + ', ' + esc(sel.gps.lng.toFixed(5)) : 'Not captured') + '</span>' +
        '</div>' +
        '<div class="ad-field"><label>Photo / video evidence</label>' +
          '<input type="file" accept="image/*,video/*" multiple data-evidence-input="' + esc(p.id) + '" />' +
          '<small data-evidence-status="' + esc(p.id) + '">' + (proofCount ? proofCount + ' file(s) attached.' : '') + '</small>' +
        '</div>' +
      '</div>';
    }
    return head + panel;
  }

  $('adVerifyList').addEventListener('change', function (e) {
    var row = e.target.closest('[data-prop]');
    if (row) {
      var id = row.getAttribute('data-prop');
      var picked = row.querySelector('input[type=radio]:checked');
      if (picked) {
        verifySelection[id] = verifySelection[id] || {};
        verifySelection[id].status = picked.value;
      }
      var phone = row.querySelector('[data-phone]');
      if (phone && verifySelection[id]) verifySelection[id].phoneNumber = phone.value.trim();
      updateVerifyCount();
      return;
    }

    var findingsEl = e.target.closest('[data-findings]');
    if (findingsEl) {
      var fid = findingsEl.getAttribute('data-findings');
      verifySelection[fid] = verifySelection[fid] || {};
      verifySelection[fid].comments = findingsEl.value;
      return;
    }

    var evidenceInput = e.target.closest('[data-evidence-input]');
    if (evidenceInput) { uploadEvidence(evidenceInput); return; }
  });

  $('adVerifyList').addEventListener('click', function (e) {
    var toggleBtn = e.target.closest('[data-toggle-findings]');
    if (toggleBtn) {
      var tid = toggleBtn.getAttribute('data-toggle-findings');
      verifyExpanded[tid] = !verifyExpanded[tid];
      $('adVerifyList').innerHTML = ($('adVerifyList').__lastProps || []).map(renderVerifyRow).join('');
      bindTooltips($('adVerifyList'));
      return;
    }
    var gpsBtn = e.target.closest('[data-capture-gps]');
    if (gpsBtn) { captureGps(gpsBtn.getAttribute('data-capture-gps')); return; }
  });

  function captureGps(propertyId) {
    if (!navigator.geolocation) {
      A.msg($('adVerifyMsg'), 'This browser does not support location capture.', 'is-error');
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      verifySelection[propertyId] = verifySelection[propertyId] || {};
      verifySelection[propertyId].gps = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      verifyExpanded[propertyId] = true;
      $('adVerifyList').innerHTML = ($('adVerifyList').__lastProps || []).map(renderVerifyRow).join('');
      bindTooltips($('adVerifyList'));
    }, function () {
      A.msg($('adVerifyMsg'), 'Could not get your location — check location permissions.', 'is-error');
    }, { enableHighAccuracy: true, timeout: 15000 });
  }

  /* Uploads straight to R2 through the existing presign endpoint (the
     SAME one the public Submit Property wizard uses) — no second
     uploader, no bytes through this server. sha256 is computed client-
     side for the Evidence Service's anti-reuse check. */
  async function uploadEvidence(inputEl) {
    var propertyId = inputEl.getAttribute('data-evidence-input');
    var statusEl = doc.querySelector('[data-evidence-status="' + propertyId + '"]');
    var files = Array.prototype.slice.call(inputEl.files || []);
    if (!files.length) return;

    verifySelection[propertyId] = verifySelection[propertyId] || {};
    verifySelection[propertyId].proof = verifySelection[propertyId].proof || [];

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (statusEl) statusEl.textContent = 'Uploading ' + file.name + '…';
      try {
        var kind = file.type.indexOf('video') === 0 ? 'property-video' : 'property-image';
        var presigned = await A.post(API.presign, {
          draftId: 'verify-' + propertyId, filename: file.name, contentType: file.type, kind: kind, sizeBytes: file.size
        });
        var buf = await file.arrayBuffer();
        var digest = await crypto.subtle.digest('SHA-256', buf);
        var sha256 = Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');

        var put = await fetch(presigned.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!put.ok) throw new Error('Upload failed (' + put.status + ').');

        verifySelection[propertyId].proof.push({
          kind: kind === 'property-video' ? 'video' : 'image',
          key: presigned.key, url: presigned.publicUrl, sha256: sha256, byteSize: file.size,
          capturedAt: new Date().toISOString()
        });
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Failed: ' + file.name + ' (' + err.message + ')';
        return;
      }
    }
    if (statusEl) statusEl.textContent = verifySelection[propertyId].proof.length + ' file(s) attached.';
    var countEl = doc.querySelector('[data-toggle-findings="' + propertyId + '"]');
    if (countEl) countEl.textContent = countEl.textContent;   // label recomputed on next full render
  }

  function updateVerifyCount() {
    var n = Object.keys(verifySelection).filter(function (k) { return verifySelection[k].status; }).length;
    $('adVerifyCount').textContent = n + ' selected';
    $('adPublishVerify').disabled = n === 0;
  }

  $('adPublishVerify').addEventListener('click', async function () {
    var items = Object.keys(verifySelection)
      .filter(function (k) { return verifySelection[k].status; })
      .map(function (k) {
        var s = verifySelection[k];
        return {
          propertyId: k, status: s.status, phoneNumber: s.phoneNumber || null,
          comments: s.comments || null,
          gps: s.gps || null,
          proof: s.proof || []
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

  /* ── MY FIELD REPORTS (any role that can submit — mainly Field Officer's
     own view of what happened to their submissions) ────────────────── */
  async function loadMyReports() {
    try {
      var res = await A.get(API.adminVerifications + '?mine=1');
      $('adMyReportsList').innerHTML = res.submissions.length
        ? res.submissions.map(function (s) {
            var reviewPill = !s.review
              ? '<span class="ad-pill is-warn">Pending review</span>'
              : s.review.decision === 'returned'
                ? '<span class="ad-pill is-danger">Returned: ' + esc(s.review.comment || '') + '</span>'
                : '<span class="ad-pill is-ok">Reviewed</span>';
            return '<div class="ad-verify-row">' +
              '<div class="ad-grow"><b>' + esc(s.businessCode) + '</b>' +
              '<small>' + esc(s.areaName) + ', ' + esc(s.cityName) + ' · ' + esc(s.status) + ' · ' + esc(A.fmtDateTime(s.verifiedAt)) + '</small></div>' +
              reviewPill +
            '</div>';
          }).join('')
        : '<div class="ad-empty">No field reports submitted yet.</div>';
    } catch (e) {
      $('adMyReportsList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  /* ── FIELD REPORT REVIEW (Manager / Assistant CEO / CEO) ───────────── */
  async function loadReviewQueue() {
    try {
      var res = await A.get(API.adminVerifications + '?reviewQueue=1');
      $('adReviewList').innerHTML = res.reports.length
        ? res.reports.map(function (r) {
            return '<div class="ad-verify-row" style="align-items:flex-start;" data-review="' + esc(r.id) + '">' +
              '<div class="ad-grow">' +
                '<b>' + esc(r.businessCode) + '</b> — ' + esc(r.status) +
                '<small style="display:block;">' + esc(r.areaName) + ', ' + esc(r.cityName) + ' · ' + esc(r.fieldOfficer.name) + ' · ' + esc(A.fmtDateTime(r.verifiedAt)) + '</small>' +
                (r.comments ? '<small style="display:block;white-space:pre-wrap;">' + esc(r.comments) + '</small>' : '') +
                (r.proof && r.proof.length ? '<small style="display:block;">' + r.proof.length + ' media file(s) attached.</small>' : '') +
              '</div>' +
              '<button class="ad-btn is-sm is-primary" type="button" data-review-decide="reviewed">Mark reviewed</button>' +
              '<button class="ad-btn is-sm is-danger" type="button" data-review-decide="returned">Return for correction</button>' +
            '</div>';
          }).join('')
        : '<div class="ad-empty">No field reports awaiting review.</div>';
    } catch (e) {
      $('adReviewList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }
  }

  $('adReviewList').addEventListener('click', async function (e) {
    var btn = e.target.closest('[data-review-decide]');
    if (!btn) return;
    var verificationId = btn.closest('[data-review]').getAttribute('data-review');
    var decision = btn.getAttribute('data-review-decide');
    var comment = null;
    if (decision === 'returned') {
      comment = win.prompt('Reason for returning this report for correction:');
      if (!comment) return;
    }
    try {
      await A.post(API.adminVerifications, { action: 'review', verificationId: verificationId, decision: decision, comment: comment });
      A.msg($('adReviewMsg'), decision === 'returned' ? 'Returned for correction.' : 'Marked reviewed.', 'is-ok');
      await loadReviewQueue();
    } catch (err) {
      A.msg($('adReviewMsg'), err.message, 'is-error');
    }
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
    assign: 'Defines which locations this team member is authorized to operate in.',
    reportsTo: 'Defines who this team member reports to operationally.',
    transfer: 'Moves active operational responsibility to another eligible team member while preserving history.',
    revoke: 'Removes the current active assignment without deleting historical records.',
    search: 'Find a team member by name, username, or email.',
    findings: 'Record what you observed during the field visit — property/location condition, issues, anything the reviewer needs to know.'
  };
  var teamFilters = { q: '', role: '', status: '' };
  var teamExpanded = {};   // userId -> 'view' | 'edit'
  var teamGroupExpanded = {};   // role -> collapsed(false, default)/expanded(true)
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
    /* identityManageable (CEO-only, migration 0014) gates account-lifecycle
       actions specifically — `manageable` alone would still be true for an
       Assistant CEO viewing its own managers (that flag drives area/task
       assignment eligibility, unchanged) and would render buttons the
       server now rejects. View stays available to anyone who can see the
       row at all. */
    var actions = '<button class="ad-btn is-sm" type="button" data-view>View</button> ';
    if (u.identityManageable) {
      actions +=
        '<button class="ad-btn is-sm" type="button" data-edit>Edit</button> ' +
        '<button class="ad-btn is-sm" type="button" data-toggle="' + (u.status === 'active' ? 'disabled' : 'active') + '">' +
          (u.status === 'active' ? 'Disable' : 'Enable') + '</button> ' +
        '<button class="ad-btn is-sm" type="button" data-open-reset>Reset password</button> ' +
        '<button class="ad-btn is-sm is-danger" type="button" data-delete>Delete</button>';
    } else {
      actions += '<span class="ad-pill">View only</span>';
    }

    var row = '<tr data-user="' + esc(u.id) + '">' +
      '<td><b>' + esc(u.fullName) + '</b></td>' +
      '<td>' + esc(u.username) + '</td>' +
      '<td>' + esc(u.email || '—') + '</td>' +
      '<td><span class="ad-pill ' + (u.status === 'active' ? 'is-ok' : 'is-danger') + '">' + esc(u.status) + '</span></td>' +
      '<td>' + esc(A.fmtDateTime(u.lastLoginAt)) + '</td>' +
      '<td>' + esc(A.fmtDate(u.createdAt)) + '</td>' +
      '<td>' + actions + '</td>' +
    '</tr>';

    var hasReportsTo = u.role === 'manager' || u.role === 'field_officer';
    var reportsToName = null;
    if (hasReportsTo) {
      if (!u.reportsToUserId) {
        reportsToName = 'CEO';
      } else {
        var parentUser = (teamCache || []).find(function (x) { return x.id === u.reportsToUserId; });
        reportsToName = parentUser ? parentUser.fullName + ' (' + A.roleLabel(parentUser.role) + ')' : 'Unknown';
      }
    }

    if (mode === 'view') {
      /* Hierarchical review tree (governance pass): who reports DOWNWARD
         to this account, with what they're each currently holding — the
         same reports_to_user_id link and admin_area_assignments data
         already loaded for this tab, just read one level down. Only
         Assistant CEO/Manager rows have anyone reporting to them, so a
         Field Officer's view never shows an (always empty) section. */
      var directReports = (u.role === 'assistant_ceo' || u.role === 'manager')
        ? (teamCache || []).filter(function (x) { return x.reportsToUserId === u.id && x.status !== 'archived'; })
        : [];
      var reportsBlock = '';
      if (directReports.length) {
        reportsBlock = '<div class="ad-kv-row" style="align-items:flex-start;flex-direction:column;">' +
          '<span>' + (u.role === 'assistant_ceo' ? 'Area Managers' : 'Field Officers') + ' reporting to ' + esc(u.fullName) + '</span>' +
          '<div style="padding-left:8px;margin-top:4px;">' +
          directReports.map(function (r) {
            var rAreas = assignByUserCache[r.id] || [];
            return '<div style="margin-bottom:4px;">▸ <b>' + esc(r.fullName) + '</b> (' + esc(A.roleLabel(r.role)) + ')' +
              '<small style="display:block;padding-left:14px;">' +
              (rAreas.length ? esc(assignSummary(rAreas)) : 'No areas assigned yet') +
              (r.status !== 'active' ? ' · ' + esc(r.status) : '') +
              '</small></div>';
          }).join('') +
          '</div></div>';
      }

      row += '<tr class="ad-detail-row"><td colspan="7"><div class="ad-detail-grid">' +
        '<div class="ad-kv-row"><span>Role</span><span>' + esc(A.roleLabel(u.role)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Username</span><span>' + esc(u.username) + '</span></div>' +
        '<div class="ad-kv-row"><span>Email</span><span>' + esc(u.email || '—') + '</span></div>' +
        '<div class="ad-kv-row"><span>Status</span><span>' + esc(u.status) + '</span></div>' +
        (hasReportsTo ? '<div class="ad-kv-row"><span>Reports to</span><span>' + esc(reportsToName) + '</span></div>' : '') +
        '<div class="ad-kv-row"><span>Created</span><span>' + esc(A.fmtDateTime(u.createdAt)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Last login</span><span>' + esc(A.fmtDateTime(u.lastLoginAt)) + '</span></div>' +
        '<div class="ad-kv-row"><span>Last verification</span><span>' + esc(A.fmtDateTime(u.lastVerificationAt)) + '</span></div>' +
        reportsBlock +
      '</div></td></tr>';
    } else if (mode === 'edit') {
      var reportsToField = '';
      if (hasReportsTo) {
        /* Manager may report to an active Assistant CEO or CEO (blank).
           Field Officer may report to CEO, an active Assistant CEO, or
           an active Manager — matches the three explicit options the
           brief asks for (2A), never inferred from location. */
        var candidates = (teamCache || []).filter(function (x) {
          if (x.status !== 'active' || x.id === u.id) return false;
          return u.role === 'manager' ? x.role === 'assistant_ceo' : (x.role === 'assistant_ceo' || x.role === 'manager');
        });
        var opts = '<option value="">CEO</option>' + candidates.map(function (x) {
          return '<option value="' + esc(x.id) + '"' + (x.id === u.reportsToUserId ? ' selected' : '') + '>' +
            esc(x.fullName) + ' (' + esc(A.roleLabel(x.role)) + ')</option>';
        }).join('');
        reportsToField = '<div class="ad-field"><label class="ad-label-tip">Reports to' + tipSpan('reportsTo', 'Reports to') +
          '</label><select class="ad-select" data-edit-reports-to>' + opts + '</select></div>';
      }
      row += '<tr class="ad-detail-row"><td colspan="7"><div class="ad-row">' +
        '<div class="ad-field"><label>Full name</label><input class="ad-input" type="text" data-edit-fullname value="' + esc(u.fullName) + '" /></div>' +
        '<div class="ad-field"><label>Email</label><input class="ad-input" type="email" data-edit-email value="' + esc(u.email || '') + '" /></div>' +
        reportsToField +
        '</div><div class="ad-actions">' +
        '<button class="ad-btn is-primary is-sm" type="button" data-save-edit>Save</button>' +
        '<button class="ad-btn is-sm" type="button" data-cancel-edit>Cancel</button>' +
        '</div></td></tr>';
    } else if (mode === 'reset') {
      row += '<tr class="ad-detail-row"><td colspan="7">' +
        '<p style="margin:0 0 10px;color:var(--muted);">Set a new password for this team member. ' +
        'The previous password will stop working immediately.</p>' +
        '<div class="ad-row">' +
        '<div class="ad-field"><label>New Password</label><input class="ad-input" type="password" minlength="10" autocomplete="new-password" data-reset-new /></div>' +
        '<div class="ad-field"><label>Confirm New Password</label><input class="ad-input" type="password" minlength="10" autocomplete="new-password" data-reset-confirm /></div>' +
        '</div><div class="ad-actions">' +
        '<button class="ad-btn is-primary is-sm" type="button" data-do-reset>Reset Password</button> ' +
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

    var searching = !!teamFilters.q.trim();
    var html = ROLE_GROUPS.map(function (role) {
      var members = rows.filter(function (u) { return u.role === role; });
      if (!members.length) return '';
      /* Collapsed by default (audited gap: previously every role section
         and every row rendered open at once). A search match auto-opens
         its section — collapsing on you while you're actively finding
         someone would defeat the point of searching — without permanently
         changing the stored collapsed/expanded preference. */
      var expanded = searching || !!teamGroupExpanded[role];
      return '<div class="ad-team-group">' +
        '<button type="button" class="ad-btn is-sm ad-assign-toggle" data-toggle-group="' + esc(role) + '" ' +
        'aria-expanded="' + expanded + '" aria-controls="teamGroup-' + esc(role) + '">' +
        '<span class="ad-chevron' + (expanded ? ' is-open' : '') + '" aria-hidden="true">&#9656;</span></button> ' +
        '<div class="ad-team-group-head" style="display:inline-flex;">' +
          esc(A.roleLabel(role).toUpperCase()) +
          '<span class="ad-pill">' + members.length + '</span>' +
          '<span class="ad-tip" data-tip="' + esc(ROLE_DESC[role]) + '">' +
            '<button type="button" class="ad-tip-btn" aria-label="What is ' + esc(A.roleLabel(role)) + '?">?</button>' +
            '<span class="ad-tip-bubble" role="tooltip"></span></span>' +
        '</div>' +
        '<div id="teamGroup-' + esc(role) + '"' + (expanded ? '' : ' hidden') + '>' +
          head + members.map(renderUserRow).join('') + tail +
        '</div>' +
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

    $('adRemovedCard').hidden = !(ME && ME.user.role === 'ceo');
    if (ME && ME.user.role === 'ceo') loadRemovedTeam();

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
      /* Real regression caught by testing before it ever shipped: this
         called the old single-select refreshAssignScope(), removed when
         the multi-select picker replaced it — every loadTeam() call threw
         here, caught by this function's own try/catch, and silently
         replaced the whole Team Manager list with an error message. Not
         re-rendering the picker at all here is correct: renderReview()
         already re-runs after every checkbox change and after
         beginEditAreas() preloads state; nothing needs a stale review
         redrawn on every unrelated loadTeam() call. */

      await loadAssignments();
    } catch (e) {
      $('adUserList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
    }

    if (!teamBound) {
      teamBound = true;
      $('adTeamSearch').addEventListener('input', function () { teamFilters.q = this.value; renderTeamList(); });
      $('adTeamRoleFilter').addEventListener('change', function () { teamFilters.role = this.value; renderTeamList(); });
      $('adTeamStatusFilter').addEventListener('change', function () { teamFilters.status = this.value; renderTeamList(); });
      $('adUserList').addEventListener('click', function (e) {
        var groupToggle = e.target.closest('[data-toggle-group]');
        if (!groupToggle) return;
        var role = groupToggle.getAttribute('data-toggle-group');
        teamGroupExpanded[role] = !teamGroupExpanded[role];
        renderTeamList();
      });
      $('adRemovedToggle').addEventListener('click', function () {
        var open = $('adRemovedList').hidden;
        $('adRemovedList').hidden = !open;
        this.setAttribute('aria-expanded', String(open));
        this.querySelector('.ad-chevron').classList.toggle('is-open', open);
      });
    }
  }

  /* ── REMOVED TEAM MEMBERS (CEO-only history view, governance pass) ──
     Collapsed by default, never merged into the active Team list above —
     an archived account must stay invisible everywhere operational
     (selectors, hierarchy, active list) while still being inspectable
     here: who they were, when they joined, when they left, and how much
     recorded field work is attributed to them. Nothing here reactivates
     them or edits history — read-only. */
  async function loadRemovedTeam() {
    try {
      var res = await A.get(API.adminUsers + '?archived=1');
      $('adRemovedCount').textContent = res.removed.length + ' former account(s)';
      $('adRemovedList').innerHTML = res.removed.length
        ? '<div class="ad-table-wrap"><table class="ad-table"><thead><tr>' +
            '<th>Name</th><th>Role</th><th>Joined</th><th>Removed</th><th>Historical reports</th>' +
          '</tr></thead><tbody>' +
          res.removed.map(function (u) {
            return '<tr>' +
              '<td><b>' + esc(u.fullName) + '</b><small style="display:block;">' + esc(u.username) + '</small></td>' +
              '<td>Former ' + esc(A.roleLabel(u.role)) + '</td>' +
              '<td>' + esc(A.fmtDate(u.joinedAt)) + '</td>' +
              '<td>' + esc(A.fmtDate(u.removedAt)) + '</td>' +
              '<td class="num">' + u.historicalReportCount + '</td>' +
            '</tr>';
          }).join('') + '</tbody></table></div>'
        : '<div class="ad-empty">No removed team members.</div>';
    } catch (e) {
      $('adRemovedList').innerHTML = '<div class="ad-empty">' + esc(e.message) + '</div>';
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
    /* ROOT CAUSE of "Save doesn't persist reports-to" (audited
       2026-08-24): Save/Cancel and the edit inputs live in the SECOND
       <tr class="ad-detail-row"> — a SIBLING of the <tr data-user="…">
       row, not a descendant of it. `.closest('[data-user]')` only walks
       ANCESTORS, so a click starting inside the detail row always
       resolved `row` to null and the whole handler returned before
       sending any request — silently, no error, exactly the observed
       symptom. This affected fullName/email saves identically, not just
       reports-to; reports-to just made it visible since Save previously
       "looked" like it worked (the row collapsed) while actually never
       calling the API. */
    var clickedRow = e.target.closest('tr');
    if (!clickedRow) return;
    var row = clickedRow.classList.contains('ad-detail-row') ? clickedRow.previousElementSibling : clickedRow;
    if (!row || !row.hasAttribute('data-user')) return;
    var userId = row.getAttribute('data-user');
    var toggle = e.target.closest('[data-toggle]');
    var openReset = e.target.closest('[data-open-reset]');
    var doReset = e.target.closest('[data-do-reset]');
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
      } else if (openReset) {
        teamExpanded[userId] = teamExpanded[userId] === 'reset' ? null : 'reset';
        renderTeamList();
      } else if (doReset) {
        var detailRowReset = row.nextElementSibling;
        var newPwEl = detailRowReset.querySelector('[data-reset-new]');
        var confirmPwEl = detailRowReset.querySelector('[data-reset-confirm]');
        if (newPwEl.value.length < 10) {
          A.msg($('adUserMsg'), 'Password must be at least 10 characters.', 'is-error');
          return;
        }
        if (newPwEl.value !== confirmPwEl.value) {
          A.msg($('adUserMsg'), 'Passwords do not match.', 'is-error');
          return;
        }
        var resettingUser = (teamCache || []).find(function (u) { return u.id === userId; });
        await A.post(API.adminUsers, { action: 'reset-password', userId: userId, newPassword: newPwEl.value });
        /* Explicit about WHO and WHAT changed — audited 2026-08-24: the
           backend/save path was proven working (a real reset_password
           audit entry is written only after the DB update commits, and
           production logs already show successful resets), so a vague
           "Password reset successfully." was read as "did nothing" when
           the actual gap was trust in the feedback, not the action. */
        A.msg($('adUserMsg'), 'Password reset for ' + (resettingUser ? resettingUser.fullName : 'this member') +
          '. They must sign in with the new password and will be asked to change it.', 'is-ok');
        teamExpanded[userId] = null;
        await loadTeam();
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
        var reportsToEl = detailRow.querySelector('[data-edit-reports-to]');
        await A.post(API.adminUsers, {
          action: 'update', userId: userId,
          fullName: fullNameEl.value.trim(), email: emailEl.value.trim()
        });
        if (reportsToEl) {
          await A.post(API.adminUsers, {
            action: 'set-reports-to', userId: userId, reportsToUserId: reportsToEl.value || null
          });
        }
        A.msg($('adUserMsg'), 'Team member updated.', 'is-ok');
        teamExpanded[userId] = null;
        await loadTeam();
      }
    } catch (err) {
      A.msg($('adUserMsg'), err.message, 'is-error');
    }
  });

  var assignExpanded = {};   // userId -> true when expanded
  var assignByUserCache = {};   // userId -> current active assignment rows (for Edit areas preload/diff)
  var editingUserId = null;   // set while the picker below is editing an EXISTING member's areas
  var editingOriginal = [];   // that member's assignment rows as of when Edit was opened

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
      assignByUserCache = byUser;

      $('adAssignmentList').innerHTML = order.map(function (userId) {
        var rows = byUser[userId];
        var expanded = !!assignExpanded[userId];
        var head = '<div class="ad-verify-row" data-assign-group="' + esc(userId) + '">' +
          '<button class="ad-btn is-sm ad-assign-toggle" type="button" data-toggle-user="' + esc(userId) + '" ' +
          'aria-expanded="' + expanded + '" aria-controls="assignRows-' + esc(userId) + '">' +
          '<span class="ad-chevron' + (expanded ? ' is-open' : '') + '" aria-hidden="true">&#9656;</span></button>' +
          '<div class="ad-grow"><b>' + esc(rows[0].userName || 'Unknown') + '</b>' +
          '<small>' + esc(rows[0].userRole || '') + ' · ' + esc(assignSummary(rows)) + '</small></div>' +
          '<button class="ad-btn is-sm" type="button" data-edit-areas="' + esc(userId) + '">Edit areas</button> ' +
          '<button class="ad-btn is-sm is-danger" type="button" data-remove-all="' + esc(userId) + '">Remove all</button>' +
        '</div>';

        var detail = '<div class="ad-detail-grid" id="assignRows-' + esc(userId) + '"' + (expanded ? '' : ' hidden') + '>' +
          rows.map(function (a) {
            return '<div class="ad-verify-row" data-assignment="' + esc(a.id) + '">' +
              '<div class="ad-grow"><b>' + esc(a.areaName || a.nodeId) + '</b>' +
              '<small>' + esc(a.nodeId) + ' · ' + esc(a.level) + '</small></div>' +
              '<button class="ad-btn is-sm" type="button" data-transfer="' + esc(userId) + '">Transfer</button>' + tipSpan('transfer', 'Transfer') + ' ' +
              '<button class="ad-btn is-sm is-danger" type="button" data-remove>Remove</button>' + tipSpan('revoke', 'Remove') +
            '</div>';
          }).join('') +
        '</div>';

        return head + detail;
      }).join('');
      bindTooltips($('adAssignmentList'));
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

  /* ── scope containment for the picker itself (governance pass, audited
     2026-08-24) ──────────────────────────────────────────────────────
     LOC/BANK hold the WHOLE Location Data Bank — correct for a CEO, wrong
     for anyone delegating downward: an Assistant CEO or Manager must only
     ever see, in this picker, the areas already granted to THEM (ME.areas,
     loaded once at boot by /api/admin/me — the same list the "My assigned
     areas" card on Today uses). The server already rejects an out-of-scope
     assign (assignments.js isWithinScope), so this is not the enforcement
     boundary — it is what stops the picker from OFFERING a choice that is
     guaranteed to fail, which is exactly what let an Assistant CEO scoped
     to one small area still see and attempt to grant "Lahore — whole
     city". CEO gets null (unrestricted), matching rbac.getScopeNodeIds'
     own convention. */
  function myScopeNodeIds() {
    if (!ME || ME.user.role === 'ceo') return null;
    return (ME.areas || []).map(function (a) { return a.nodeId; });
  }
  /* Full ownership: nodeId is either an exact scope entry or a descendant
     of one (caller owns an ancestor, so implicitly owns all of nodeId). */
  function withinMyScope(nodeId) {
    var scope = myScopeNodeIds();
    if (scope === null) return true;
    for (var i = 0; i < scope.length; i++) {
      var s = scope[i];
      if (nodeId === s || nodeId.indexOf(s + '/') === 0) return true;
    }
    return false;
  }
  /* Partial ownership: caller owns nodeId fully, OR owns some more
     specific slice underneath it (a main inside a city they don't fully
     hold, a sub inside a main they don't fully hold) — enough reason for
     nodeId to still appear in the tree so that slice is reachable. */
  function hasCoverageUnder(nodeId) {
    var scope = myScopeNodeIds();
    if (scope === null) return true;
    if (withinMyScope(nodeId)) return true;
    var prefix = nodeId + '/';
    for (var i = 0; i < scope.length; i++) {
      if (scope[i].indexOf(prefix) === 0) return true;
    }
    return false;
  }
  function scopedListCities() {
    var all = LOC.listCities() || [];
    return myScopeNodeIds() === null ? all : all.filter(function (c) { return hasCoverageUnder(c.id); });
  }
  function scopedGetMainAreas(cityId) {
    var all = LOC.getMainAreas(cityId) || [];
    if (myScopeNodeIds() === null || withinMyScope(cityId)) return all;
    return all.filter(function (m) { return hasCoverageUnder(m.id); });
  }
  function scopedGetSubAreas(mainId) {
    var all = LOC.getSubAreas(mainId) || [];
    if (myScopeNodeIds() === null || withinMyScope(mainId)) return all;
    return all.filter(function (s) { return withinMyScope(s.id); });
  }

  /* Multi-city / multi-main / multi-sub picker (replaces the old
     single-select City/Main <select> pair — audited gap: a CEO assigning
     one manager across several cities previously had to repeat the whole
     flow once per city). State is three plain maps keyed by node id;
     LOC.listCities()/getMainAreas()/getSubAreas() remain the single
     source of truth for what a city/main/sub actually is — nothing here
     duplicates location data, only which of it is checked. */
  var citySel = {};   // cityId -> true
  var mainSel = {};   // mainId -> true (only meaningful while its city is selected)
  var subSel = {};    // subId -> true (only meaningful while its main is selected)
  var citySearchQ = '';

  function cityName(id) {
    var c = (LOC.listCities() || []).find(function (x) { return x.id === id; });
    return c ? c.name : id;
  }

  /* Resolves the current checkbox state into the exact node set the API
     call will send — the SAME state the review panel renders, so what the
     CEO sees is what gets saved. A city with no main checked assigns the
     whole city; a main with no sub checked (or with every one of its own
     subs checked) assigns the whole main rather than each sub
     individually — one area-assignment row instead of dozens for the
     identical operational scope.

     A scoped (non-CEO) caller who checks a city they only PARTLY own (a
     specific main/sub, not the whole city) cannot fall through to "assign
     the whole city" — the server would reject it and the picker would
     look broken. In that case checking the city means "grant everything
     I hold here": every main scopedGetMainAreas already limited them to. */
  function computeSelection() {
    var out = [];
    Object.keys(citySel).filter(function (id) { return citySel[id]; }).forEach(function (cityId) {
      var mains = scopedGetMainAreas(cityId);
      var checkedMains = mains.filter(function (m) { return mainSel[m.id]; });
      if (!checkedMains.length) {
        if (withinMyScope(cityId)) {
          out.push({ id: cityId, name: cityName(cityId), level: 'city' });
        } else {
          mains.forEach(function (m) { out.push({ id: m.id, name: m.name, level: 'main' }); });
        }
        return;
      }
      checkedMains.forEach(function (m) {
        var subs = scopedGetSubAreas(m.id);
        var checkedSubs = subs.filter(function (s) { return subSel[s.id]; });
        if (!checkedSubs.length || (subs.length && checkedSubs.length === subs.length)) {
          out.push({ id: m.id, name: m.name, level: 'main' });
        } else {
          checkedSubs.forEach(function (s) { out.push({ id: s.id, name: s.name, level: 'sub' }); });
        }
      });
    });
    return out;
  }

  function renderReview() {
    var nodes = computeSelection();
    var cities = nodes.filter(function (n) { return n.level === 'city'; });
    var mains = nodes.filter(function (n) { return n.level === 'main'; });
    var subs = nodes.filter(function (n) { return n.level === 'sub'; });

    $('adAssignArea').disabled = !$('adAssignUser').value || !nodes.length;

    if (!nodes.length) {
      $('adAssignReview').innerHTML = '<div class="ad-empty">Nothing selected yet.</div>';
      return;
    }

    var tree = Object.keys(citySel).filter(function (id) { return citySel[id]; }).map(function (cityId) {
      var wholeCity = cities.some(function (c) { return c.id === cityId; });
      var mainsUnder = scopedGetMainAreas(cityId).filter(function (m) { return mainSel[m.id]; });
      var lines = mainsUnder.map(function (m) {
        var wholeMain = mains.some(function (x) { return x.id === m.id; });
        var subsUnder = scopedGetSubAreas(m.id);
        var checkedSubsUnder = subsUnder.filter(function (s) { return subSel[s.id]; });
        var subLine = wholeMain
          ? (subsUnder.length ? '<small style="padding-left:34px;display:block;">All sub-locations</small>' : '')
          : checkedSubsUnder.map(function (s) {
              return '<small style="padding-left:34px;display:block;">✓ ' + esc(s.name) + '</small>';
            }).join('');
        return '<div>✓ ' + esc(m.name) + '</div>' + subLine;
      }).join('');
      return '<div class="ad-kv-row" style="align-items:flex-start;flex-direction:column;">' +
        '<b>' + esc(cityName(cityId)) + (wholeCity ? ' — whole city' : '') + '</b>' +
        (lines ? '<div style="padding-left:18px;">' + lines + '</div>' : '') +
      '</div>';
    }).join('');

    $('adAssignReview').innerHTML = tree +
      '<div class="ad-kv-row"><span>Summary</span><span><b>' +
        cities.length + '</b> ' + (cities.length === 1 ? 'city' : 'cities') + ' · <b>' +
        mains.length + '</b> main location' + (mains.length === 1 ? '' : 's') + ' · <b>' +
        subs.length + '</b> sub location' + (subs.length === 1 ? '' : 's') +
      '</span></div>';
  }

  function renderCities() {
    var q = citySearchQ.trim().toLowerCase();
    var list = scopedListCities().filter(function (c) { return !q || c.name.toLowerCase().indexOf(q) > -1; });
    $('adAssignCities').innerHTML = list.length
      ? list.map(function (c) {
          return '<label class="ad-sub"><input type="checkbox" data-city="' + esc(c.id) + '"' +
            (citySel[c.id] ? ' checked' : '') + ' /><span>' + esc(c.name) + '</span></label>';
        }).join('')
      : '<div class="ad-empty">' + (myScopeNodeIds() !== null && !myScopeNodeIds().length
          ? 'You have no assigned areas to delegate from yet.' : 'No city matches that.') + '</div>';
  }

  function renderHierarchy() {
    var selectedCityIds = Object.keys(citySel).filter(function (id) { return citySel[id]; });
    $('adAssignHierarchy').innerHTML = selectedCityIds.map(function (cityId) {
      var mains = scopedGetMainAreas(cityId);
      var mainRows = mains.length ? mains.map(function (m) {
        var checked = !!mainSel[m.id];
        var subBlock = '';
        if (checked) {
          var subs = scopedGetSubAreas(m.id);
          subBlock = subs.length
            ? '<div class="ad-sub-tools"><button class="ad-btn is-sm" type="button" data-sub-all="' + esc(m.id) + '">Select all</button>' +
              '<button class="ad-btn is-sm" type="button" data-sub-none="' + esc(m.id) + '">Clear</button></div>' +
              '<div class="ad-sublist" style="margin:6px 0 10px 20px;">' + subs.map(function (s) {
                return '<label class="ad-sub"><input type="checkbox" data-sub="' + esc(s.id) + '" data-sub-main="' + esc(m.id) + '"' +
                  (subSel[s.id] ? ' checked' : '') + ' /><span>' + esc(s.name) + '</span></label>';
              }).join('') + '</div>'
            : '<div class="ad-empty" style="margin-left:20px;">No sub locations published — this main location is assigned whole.</div>';
        }
        return '<label class="ad-sub"><input type="checkbox" data-main="' + esc(m.id) + '" data-main-city="' + esc(cityId) + '"' +
          (checked ? ' checked' : '') + ' /><span>' + esc(m.name) + '</span></label>' + subBlock;
      }).join('') : '<div class="ad-empty">No main locations published — assigning ' + esc(cityName(cityId)) + ' covers the whole city.</div>';

      return '<div class="ad-field"><label>Main Locations — ' + esc(cityName(cityId)) + '</label>' + mainRows + '</div>';
    }).join('');
  }

  function refreshPicker() {
    renderHierarchy();
    renderReview();
  }

  /* Area Edit (new this pass): reuses the SAME picker/state/Save path as
     a fresh assignment — no second picker, no second reconciliation
     model. The only difference from "assign new" is that citySel/mainSel/
     subSel are PRELOADED from the member's current active rows, and Save
     additionally revokes whatever was in editingOriginal but is no
     longer in the resolved selection (see the Save handler). */
  function beginEditAreas(userId, rows) {
    citySel = {}; mainSel = {}; subSel = {};
    editingUserId = userId;
    editingOriginal = rows.slice();

    rows.forEach(function (a) {
      var parts = String(a.nodeId).split('/');
      citySel[parts[0]] = true;
      if (a.level === 'main' || a.level === 'sub') mainSel[parts.slice(0, 2).join('/')] = true;
      if (a.level === 'sub') subSel[a.nodeId] = true;
    });

    var userSelEl = $('adAssignUser');
    userSelEl.value = userId;
    userSelEl.disabled = true;   // editing an existing member's areas — not a place to also reassign to someone else

    var banner = $('adAssignEditBanner');
    banner.hidden = false;
    banner.textContent = 'Editing area assignments for ' + (rows[0] ? rows[0].userName : 'this member') +
      '. Changes are not saved until you click "Assign selected areas". ';
    var cancelBtn = doc.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.className = 'ad-btn is-sm'; cancelBtn.textContent = 'Cancel edit';
    cancelBtn.addEventListener('click', cancelEditAreas);
    banner.appendChild(cancelBtn);

    renderCities();
    refreshPicker();
    $('adAssignArea').textContent = 'Save area changes';
    banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelEditAreas() {
    editingUserId = null;
    editingOriginal = [];
    citySel = {}; mainSel = {}; subSel = {};
    $('adAssignUser').disabled = false;
    $('adAssignUser').value = '';
    $('adAssignEditBanner').hidden = true;
    $('adAssignEditBanner').textContent = '';
    $('adAssignArea').textContent = 'Assign selected areas';
    renderCities();
    refreshPicker();
  }

  async function initAreaPicker() {
    if (!LOC || !BANK) {
      $('adAssignReview').innerHTML = '<div class="ad-empty">The location engine did not load; area assignment is unavailable.</div>';
      return;
    }
    /* Local bank first so the picker is usable instantly, then the
       published server bank merged over it — same order every other page
       uses. Both are best-effort: the fixture alone still yields a
       working cascade. */
    try { BANK.hydrate(); } catch (e) {}
    try { await BANK.pullCitiesFromApi(); } catch (e) {}
    try { await BANK.pullFromApi(); } catch (e) {}

    renderCities();

    $('adAssignCitySearch').addEventListener('input', function () { citySearchQ = this.value; renderCities(); });
    $('adAssignCityAll').addEventListener('click', function () {
      scopedListCities().forEach(function (c) { citySel[c.id] = true; });
      renderCities(); refreshPicker();
    });
    $('adAssignCityNone').addEventListener('click', function () {
      citySel = {}; mainSel = {}; subSel = {};
      renderCities(); refreshPicker();
    });

    $('adAssignCities').addEventListener('change', function (e) {
      var cb = e.target.closest('[data-city]');
      if (!cb) return;
      var cityId = cb.getAttribute('data-city');
      if (cb.checked) {
        citySel[cityId] = true;
      } else {
        /* Deselecting a city cascades: every main/sub it owns is dropped
           from the intended state too, so nothing orphaned survives to be
           silently sent on Save. */
        delete citySel[cityId];
        scopedGetMainAreas(cityId).forEach(function (m) {
          delete mainSel[m.id];
          scopedGetSubAreas(m.id).forEach(function (s) { delete subSel[s.id]; });
        });
      }
      refreshPicker();
    });

    $('adAssignHierarchy').addEventListener('change', function (e) {
      var mainCb = e.target.closest('[data-main]');
      var subCb = e.target.closest('[data-sub]');
      if (mainCb) {
        var mainId = mainCb.getAttribute('data-main');
        if (mainCb.checked) {
          mainSel[mainId] = true;
        } else {
          delete mainSel[mainId];
          scopedGetSubAreas(mainId).forEach(function (s) { delete subSel[s.id]; });
        }
        refreshPicker();
      } else if (subCb) {
        var subId = subCb.getAttribute('data-sub');
        if (subCb.checked) subSel[subId] = true; else delete subSel[subId];
        refreshPicker();
      }
    });

    $('adAssignHierarchy').addEventListener('click', function (e) {
      var allBtn = e.target.closest('[data-sub-all]');
      var noneBtn = e.target.closest('[data-sub-none]');
      if (allBtn) {
        scopedGetSubAreas(allBtn.getAttribute('data-sub-all')).forEach(function (s) { subSel[s.id] = true; });
        refreshPicker();
      } else if (noneBtn) {
        scopedGetSubAreas(noneBtn.getAttribute('data-sub-none')).forEach(function (s) { delete subSel[s.id]; });
        refreshPicker();
      }
    });

    $('adAssignUser').addEventListener('change', renderReview);
  }

  $('adAssignArea').addEventListener('click', async function () {
    var userId = $('adAssignUser').value;
    var nodes = computeSelection();
    var isEdit = !!editingUserId;
    if (!userId || (!nodes.length && !isEdit)) {
      A.msg($('adAssignMsg'), 'Choose a team member and at least one location.', 'is-error');
      return;
    }

    /* Reconcile against the ORIGINAL active rows only in edit mode — a
       fresh assignment has no original to diff against, every selected
       node is new. Matched by nodeId: a node present in both is already
       correctly active and must NOT be re-POSTed to 'assign' (migration
       0014's uq_area_assignment_active_user_node would reject it as a
       duplicate-for-the-same-user, not the "someone else already has
       this area" case the existing 409 handling below expects). */
    var nodeIds = nodes.map(function (n) { return n.id; });
    var toAdd = isEdit ? nodes.filter(function (n) { return !editingOriginal.some(function (o) { return o.nodeId === n.id; }); }) : nodes;
    var toRemove = isEdit ? editingOriginal.filter(function (o) { return nodeIds.indexOf(o.nodeId) === -1; }) : [];

    this.disabled = true;
    A.msg($('adAssignMsg'), isEdit ? 'Saving area changes…' : 'Assigning…');

    /* One call per node, through the existing endpoint — the API assigns a
       single area per request and enforces "one active manager per area"
       in the database. Each is reported independently so a clash on one
       sub location never hides the ones that did succeed. The FULL
       current selection is (re)computed and sent every time (not just
       whatever last changed), so Save always reflects exactly what the
       review panel showed. */
    var done = 0, taken = [], failed = [];
    for (var i = 0; i < toAdd.length; i++) {
      try {
        await A.post(API.adminAssignments, { action: 'assign', userId: userId, nodeId: toAdd[i].id });
        done++;
      } catch (e) {
        if (e.status === 409) taken.push(toAdd[i].name);
        else failed.push(toAdd[i].name + ' (' + e.message + ')');
      }
    }

    /* Removals — revoke (not delete) whatever fell out of the new
       selection. 'revoke' already cascades to descendants server-side,
       harmless no-op for a sub-level row. History is preserved exactly
       as a manual Remove click would preserve it; this is the same
       action under the hood, just batched. */
    var removed = 0, removeFailed = [];
    for (var j = 0; j < toRemove.length; j++) {
      try {
        await A.post(API.adminAssignments, { action: 'revoke', assignmentId: toRemove[j].id });
        removed++;
      } catch (e) {
        removeFailed.push(toRemove[j].nodeId + ' (' + e.message + ')');
      }
    }

    var parts = [];
    if (done) parts.push(done + (done === 1 ? ' area added' : ' areas added'));
    if (removed) parts.push(removed + (removed === 1 ? ' area removed' : ' areas removed'));
    if (taken.length) parts.push('already has a manager: ' + taken.join(', '));
    if (failed.length) parts.push('failed to add: ' + failed.join('; '));
    if (removeFailed.length) parts.push('failed to remove: ' + removeFailed.join('; '));
    var anyFailure = failed.length || removeFailed.length || (!done && !removed && taken.length);
    A.msg($('adAssignMsg'), parts.join(' · ') || 'No changes to save.', anyFailure ? 'is-error' : 'is-ok');

    /* Selection state is left as-is on failure (per spec: "preserve the
       user's current selection state where safe") and only cleared once
       everything actually saved. */
    if (!anyFailure) {
      if (isEdit) cancelEditAreas();
      else { citySel = {}; mainSel = {}; subSel = {}; renderCities(); refreshPicker(); }
    }
    this.disabled = false;
    await loadAssignments();
    await loadTeam();   // Team location summaries reflect the same assignments
  });

  $('adAssignmentList').addEventListener('click', async function (e) {
    var toggle = e.target.closest('[data-toggle-user]');
    if (toggle) {
      var uid = toggle.getAttribute('data-toggle-user');
      assignExpanded[uid] = !assignExpanded[uid];
      await loadAssignments();
      return;
    }

    var removeBtn = e.target.closest('[data-remove]');
    var transferBtn = e.target.closest('[data-transfer]');
    var removeAllBtn = e.target.closest('[data-remove-all]');
    var editAreasBtn = e.target.closest('[data-edit-areas]');

    try {
      if (editAreasBtn) {
        var editUserId = editAreasBtn.getAttribute('data-edit-areas');
        beginEditAreas(editUserId, assignByUserCache[editUserId] || []);
        return;
      }
      if (removeBtn) {
        var assignRow = removeBtn.closest('[data-assignment]');
        var id = assignRow.getAttribute('data-assignment');
        var areaLabel = assignRow.querySelector('b') ? assignRow.querySelector('b').textContent : 'this location';
        var typed = win.prompt('Removing "' + areaLabel + '" stops operational access here (history is kept). Type REMOVE to confirm:');
        if (typed !== 'REMOVE') return;
        var res = await A.post(API.adminAssignments, { action: 'revoke', assignmentId: id });
        A.msg($('adAssignMsg'), (res.removedCount > 1 ? res.removedCount + ' locations removed (including sub-locations).' : 'Location removed.'), 'is-ok');
        await loadAssignments();
      } else if (removeAllBtn) {
        var groupUserId = removeAllBtn.getAttribute('data-remove-all');
        var groupHead = removeAllBtn.closest('[data-assign-group]');
        var summaryText = groupHead ? groupHead.querySelector('small').textContent : '';
        var typedAll = win.prompt('This removes ALL active area assignments for this member (' + summaryText + '). History is kept. Type REMOVE to confirm:');
        if (typedAll !== 'REMOVE') return;
        var resAll = await A.post(API.adminAssignments, { action: 'revoke-all', userId: groupUserId });
        A.msg($('adAssignMsg'), resAll.removedCount + ' location(s) removed.', 'is-ok');
        await loadAssignments();
      } else if (transferBtn) {
        var xferAssignRow = transferBtn.closest('[data-assignment]');
        var xferId = xferAssignRow.getAttribute('data-assignment');
        var fromUserId = transferBtn.getAttribute('data-transfer');
        var fromUser = (teamCache || []).find(function (u) { return u.id === fromUserId; });
        var eligibleXfer = (teamCache || []).filter(function (u) {
          return u.status === 'active' && u.id !== fromUserId && (fromUser ? u.role === fromUser.role : true);
        });
        if (!eligibleXfer.length) {
          A.msg($('adAssignMsg'), 'No eligible active recipient with the same role is available.', 'is-error');
          return;
        }
        var xferName = win.prompt('Transfer to which team member?\n' + eligibleXfer.map(function (u) { return u.fullName + ' (' + u.username + ')'; }).join('\n'));
        if (!xferName) return;
        var xferUser = eligibleXfer.find(function (u) { return u.fullName === xferName.trim() || u.username === xferName.trim(); });
        if (!xferUser) { A.msg($('adAssignMsg'), 'No exact match for "' + xferName + '" among eligible recipients.', 'is-error'); return; }
        if (!win.confirm('Transfer this assignment (and any sub-locations under it) to ' + xferUser.fullName + '?')) return;
        var xres = await A.post(API.adminAssignments, { action: 'transfer', assignmentId: xferId, toUserId: xferUser.id });
        A.msg($('adAssignMsg'), 'Transferred ' + xres.transferredCount + ' location(s) to ' + xferUser.fullName + '.' +
          (xres.conflicts && xres.conflicts.length ? ' (' + xres.conflicts.length + ' skipped — already assigned elsewhere)' : ''), 'is-ok');
        await loadAssignments();
      }
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
