/* MakanOnRent — Location Data Bank Manager (page controller).
   Drives location-manager.html: manage cities (master data) → choose
   city → paste → parse → editable preview → publish. All
   parsing/persistence lives in location-bank.js; this file is UI
   only. Cities are the ONLY thing seeded by SQL (migrations/
   0003_city_seed.sql) — Main Locations and Sub Locations always come
   from this page. */
(async function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, LOC = win.MOR_LOC, BANK = win.MOR_BANK, UI = win.MOR_UI;
  var $ = function (id) { return doc.getElementById(id); };

  /* Session gate. The write APIs this page drives (publish/cities) now
     require the 'locations.manage' capability server-side (see
     functions/utils/rbac.js) — this is the client-side courtesy that
     keeps an unauthenticated visitor from seeing the tool at all, per
     Doc 18 Article 9.1 ("UI hiding is never the control"; the real gate
     is the API). requireSession() already redirects to admin-login.html
     on a 401. Nothing below this block runs until it resolves. */
  var ME = await win.MOR_ADMIN.requireSession();
  if (!ME) return;
  if ((ME.capabilities || []).indexOf('locations.manage') === -1) {
    win.location.href = CFG.routes.adminPage;
    return;
  }

  /* Working set: [{ main, subs: [] }] — the editable preview model. */
  var groups = [];

  var IC = {
    up:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    del:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>'
  };

  function esc(v) { return UI.esc(v); }

  /* ── City Management (master data: Add / Rename / Delete / Search / Sort) ── */
  var citySel = $('lmCity');
  var citySortDir = 'asc';

  function citiesFiltered() {
    var q = $('lmCitySearch').value.trim().toLowerCase();
    /* includeInactive: a disabled city must stay visible here so the
       admin can re-enable it — only Step 1's picker (populateCitySelect)
       hides disabled cities from the rest of the product. */
    var list = LOC.listCities({ includeInactive: true });
    if (q) list = list.filter(function (c) { return c.name.toLowerCase().indexOf(q) > -1; });
    list = list.slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    if (citySortDir === 'desc') list.reverse();
    return list;
  }

  function renderCityMgmt() {
    var list = citiesFiltered();
    $('lmCityMgmtList').innerHTML = list.length
      ? list.map(function (c) {
          var mains = LOC.getMainAreas(c.id, { includeInactive: true }).length;
          var disabled = !c.active;
          return '<div class="lm-bank-row' + (disabled ? ' is-disabled' : '') + '">' +
            '<input class="lm-name" data-rename-city="' + esc(c.id) + '" value="' + esc(c.name) + '" aria-label="Rename city" />' +
            '<span>' + mains + ' main area' + (mains === 1 ? '' : 's') + (disabled ? ' · Disabled' : '') + '</span>' +
            '<button class="lm-mini' + (disabled ? ' is-ok' : ' is-no') + '" type="button" data-toggle-city="' + esc(c.id) + '" data-next="' + (disabled ? 'enable' : 'disable') + '">' +
              (disabled ? 'Enable' : 'Disable') +
            '</button>' +
            '<button class="lm-ico is-danger" type="button" data-del-city="' + esc(c.id) + '" aria-label="Delete city">' + IC.del + '</button>' +
          '</div>';
        }).join('')
      : '<div class="lm-empty">No cities match.</div>';
  }

  function cityMsg(text, cls) {
    var el = $('lmCityMsg');
    el.textContent = text || '';
    el.className = 'lm-msg' + (cls ? ' ' + cls : '');
  }

  /* Rebuilds Step 1's select from the current city master list.
     Always alphabetical — the Sort A–Z/Z–A buttons affect the
     management list only, so the picker stays predictable. */
  function populateCitySelect() {
    var keep = citySel.value;
    citySel.innerHTML = '';
    citySel.appendChild(new Option('Select city', ''));
    LOC.listCities()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (c) { citySel.appendChild(new Option(c.name, c.id)); });
    if (keep && LOC.getById(keep)) citySel.value = keep;
  }

  $('lmCityAdd').addEventListener('click', function () {
    var name = $('lmCityNew').value.trim();
    if (!name) { cityMsg('Enter a city name first.', 'is-error'); return; }
    LOC.addLocation({ name: name, type: 'city', parentId: null });
    BANK.syncCityAdd(name);
    $('lmCityNew').value = '';
    cityMsg('“' + name + '” added — available in Step 1 immediately.', 'is-ok');
    populateCitySelect();
    renderCityMgmt();
  });

  $('lmCitySearch').addEventListener('input', renderCityMgmt);
  $('lmCitySortAZ').addEventListener('click', function () { citySortDir = 'asc'; renderCityMgmt(); });
  $('lmCitySortZA').addEventListener('click', function () { citySortDir = 'desc'; renderCityMgmt(); });

  $('lmCityMgmtList').addEventListener('change', function (e) {
    var el = e.target.closest('[data-rename-city]');
    if (!el) return;
    var id = el.getAttribute('data-rename-city');
    var name = el.value.trim();
    if (!name) { renderCityMgmt(); return; }
    LOC.updateLocation(id, { name: name });
    BANK.syncCityRename(id, name);
    cityMsg('Renamed.', 'is-ok');
    populateCitySelect();
    renderCityMgmt();
  });

  $('lmCityMgmtList').addEventListener('click', function (e) {
    var toggle = e.target.closest('[data-toggle-city]');
    if (toggle) {
      var tid = toggle.getAttribute('data-toggle-city');
      var next = toggle.getAttribute('data-next');
      if (next === 'disable') { LOC.disableLocation(tid); BANK.syncCityDisable(tid); cityMsg('City disabled — hidden from Step 1 and the rest of the site, but its data is kept.', 'is-ok'); }
      else { LOC.enableLocation(tid); BANK.syncCityEnable(tid); cityMsg('City enabled — available in Step 1 again.', 'is-ok'); }
      populateCitySelect();
      renderCityMgmt();
      return;
    }

    var b = e.target.closest('[data-del-city]');
    if (!b) return;
    var id = b.getAttribute('data-del-city');

    /* Delete only if no dependencies — a city with any Main/Sub
       Locations under it is refused, not cascaded. Disable is the
       correct action for a city that still has data underneath it. */
    var ok = LOC.removeLocation(id);
    if (!ok) {
      var mainCount = LOC.getMainAreas(id, { includeInactive: true }).length;
      cityMsg('Can’t delete — this city has ' + mainCount + ' main area(s) with their sub areas. Disable it instead, or delete its Main/Sub Locations first.', 'is-error');
      return;
    }
    BANK.syncCityDelete(id);
    cityMsg('City deleted.', 'is-ok');
    if (citySel.value === id) citySel.value = '';
    populateCitySelect();
    renderCityMgmt();
    refreshSummary();
    renderBank();
  });

  /* ── STEP 1 · city ──────────────────────────────────────── */
  populateCitySelect();
  citySel.addEventListener('change', function () { refreshSummary(); renderBank(); renderPending(); });

  /* ── STEP 2 · parse ─────────────────────────────────────── */
  $('lmParse').addEventListener('click', function () {
    groups = BANK.parse($('lmPaste').value);
    renderPreview();
    refreshSummary();
    msg(groups.length ? '' : 'Nothing recognised in that text — check the format above.', groups.length ? '' : 'is-error');
  });

  $('lmClear').addEventListener('click', function () {
    $('lmPaste').value = '';
    groups = [];
    renderPreview();
    refreshSummary();
    msg('');
  });

  /* ── STEP 3 · editable preview ──────────────────────────── */
  function renderPreview() {
    var host = $('lmPreview');
    if (!groups.length) {
      host.innerHTML = '<div class="lm-empty">Nothing parsed yet — paste your areas above and press <b>Parse &amp; Preview</b>.</div>';
      return;
    }

    host.innerHTML = groups.map(function (g, gi) {
      var subs = g.subs.map(function (s, si) {
        return '<div class="lm-sub">' +
          '<span class="lm-branch" aria-hidden="true">' + (si === g.subs.length - 1 ? '└──' : '├──') + '</span>' +
          '<input class="lm-name" data-g="' + gi + '" data-s="' + si + '" value="' + esc(s) + '" aria-label="Sub area name" />' +
          '<button class="lm-ico" type="button" data-act="sub-up" data-g="' + gi + '" data-s="' + si + '"' + (si === 0 ? ' disabled' : '') + ' aria-label="Move up">' + IC.up + '</button>' +
          '<button class="lm-ico" type="button" data-act="sub-down" data-g="' + gi + '" data-s="' + si + '"' + (si === g.subs.length - 1 ? ' disabled' : '') + ' aria-label="Move down">' + IC.down + '</button>' +
          '<button class="lm-ico is-danger" type="button" data-act="sub-del" data-g="' + gi + '" data-s="' + si + '" aria-label="Delete sub area">' + IC.del + '</button>' +
        '</div>';
      }).join('');

      return '<div class="lm-group">' +
        '<div class="lm-main">' +
          '<span class="lm-tag">Main Area</span>' +
          '<input class="lm-name" data-g="' + gi + '" data-main="1" value="' + esc(g.main) + '" aria-label="Main area name" />' +
          '<span class="lm-count">' + g.subs.length + ' sub</span>' +
          '<button class="lm-ico is-danger" type="button" data-act="main-del" data-g="' + gi + '" aria-label="Delete main area">' + IC.del + '</button>' +
        '</div>' +
        '<div class="lm-subs">' + subs +
          '<button class="lm-addsub" type="button" data-act="sub-add" data-g="' + gi + '">' + IC.plus + 'Add sub area</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* Delegated — the preview re-renders constantly, so nothing binds
     to an individual row. */
  $('lmPreview').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var gi = Number(b.getAttribute('data-g'));
    var si = Number(b.getAttribute('data-s'));
    var act = b.getAttribute('data-act');

    if (act === 'main-del') groups.splice(gi, 1);
    else if (act === 'sub-del') groups[gi].subs.splice(si, 1);
    else if (act === 'sub-add') groups[gi].subs.push('New sub area');
    else if (act === 'sub-up') swap(groups[gi].subs, si, si - 1);
    else if (act === 'sub-down') swap(groups[gi].subs, si, si + 1);

    renderPreview();
    refreshSummary();
  });

  /* Live rename — kept in the model as the admin types. */
  $('lmPreview').addEventListener('input', function (e) {
    var el = e.target.closest('.lm-name');
    if (!el) return;
    var gi = Number(el.getAttribute('data-g'));
    if (el.hasAttribute('data-main')) groups[gi].main = el.value;
    else groups[gi].subs[Number(el.getAttribute('data-s'))] = el.value;
  });

  function swap(arr, a, b) {
    if (b < 0 || b >= arr.length) return;
    var t = arr[a]; arr[a] = arr[b]; arr[b] = t;
  }

  /* ── STEP 4 · publish ───────────────────────────────────── */
  function cleanGroups() {
    return groups
      .map(function (g) {
        return {
          main: String(g.main || '').trim(),
          subs: g.subs.map(function (s) { return String(s || '').trim(); }).filter(Boolean)
        };
      })
      .filter(function (g) { return g.main; });
  }

  function refreshSummary() {
    var clean = cleanGroups();
    var subs = clean.reduce(function (n, g) { return n + g.subs.length; }, 0);
    var ready = !!citySel.value && clean.length > 0;

    $('lmSummary').textContent = clean.length
      ? clean.length + ' main area' + (clean.length === 1 ? '' : 's') + ' · ' + subs + ' sub area' + (subs === 1 ? '' : 's')
      : 'Nothing to publish';
    $('lmSummarySub').textContent = !clean.length ? 'Parse some areas first.'
      : (!citySel.value ? 'Choose a city in step 1.'
        : 'Will publish under ' + citySel.options[citySel.selectedIndex].text + '.');
    $('lmPublish').disabled = !ready;
  }

  function msg(text, cls) {
    var el = $('lmMsg');
    el.textContent = text || '';
    el.className = 'lm-msg' + (cls ? ' ' + cls : '');
  }

  $('lmPublish').addEventListener('click', function () {
    var clean = cleanGroups();
    var res = BANK.publish(citySel.value, clean);
    if (!res.ok) { msg(res.error, 'is-error'); return; }

    var subs = clean.reduce(function (n, g) { return n + g.subs.length; }, 0);
    msg('Published — ' + clean.length + ' main area' + (clean.length === 1 ? '' : 's') +
        ' and ' + subs + ' sub area' + (subs === 1 ? '' : 's') + ' are now searchable across the site.', 'is-ok');

    groups = [];
    $('lmPaste').value = '';
    renderPreview();
    refreshSummary();
    renderBank();
  });

  /* ── published bank list ────────────────────────────────── */
  function renderBank() {
    var bank = BANK.read();
    var rows = bank.entries.filter(function (e) {
      return !citySel.value || e.cityId === citySel.value;
    });

    $('lmBankCount').textContent = bank.entries.length
      ? bank.entries.length + ' main area' + (bank.entries.length === 1 ? '' : 's') + ' published' +
        (citySel.value ? ' · showing ' + rows.length + ' in this city' : '')
      : 'Empty — nothing published yet.';

    $('lmBank').innerHTML = rows.length
      ? rows.map(function (e) {
          return '<div class="lm-bank-row">' +
            '<div class="lm-grow"><b>' + esc(e.main) + '</b><br>' +
            '<span>' + esc(e.cityName || '') + ' · ' + (e.subs || []).length + ' sub areas</span></div>' +
            '<button class="lm-mini is-no" type="button" data-unpub="' + esc(e.main) + '" data-city="' + esc(e.cityId) + '">Unpublish</button>' +
          '</div>';
        }).join('')
      : '';
  }

  $('lmBank').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unpub]');
    if (!b) return;
    BANK.unpublish(b.getAttribute('data-city'), b.getAttribute('data-unpub'));
    renderBank();
    msg('Unpublished. The area and its sub areas no longer appear in search.', 'is-ok');
  });

  /* ── pending user suggestions (sub areas only) ──────────── */
  function renderPending() {
    var pending = LOC.getPendingSuggestions();
    $('lmPendingCard').hidden = !pending.length;
    if (!pending.length) return;

    $('lmPending').innerHTML = pending.map(function (p) {
      return '<div class="lm-pending-row">' +
        '<div class="lm-grow"><b>' + esc(p.name) + '</b>' +
        '<div class="lm-crumb">' + esc(p.breadcrumb.slice(1).join(' › ')) + '</div></div>' +
        '<button class="lm-mini is-ok" type="button" data-approve="' + esc(p.id) + '">Approve</button>' +
        '<button class="lm-mini is-no" type="button" data-reject="' + esc(p.id) + '">Reject</button>' +
      '</div>';
    }).join('');
  }

  $('lmPending').addEventListener('click', function (e) {
    var ok = e.target.closest('[data-approve]');
    var no = e.target.closest('[data-reject]');
    if (ok) { LOC.approveLocation(ok.getAttribute('data-approve')); msg('Suggestion approved — it is now live in search.', 'is-ok'); }
    else if (no) { LOC.rejectLocation(no.getAttribute('data-reject')); msg('Suggestion rejected.', 'is-ok'); }
    else return;
    renderPending();
  });

  /* ── boot ───────────────────────────────────────────────── */
  $('yr').textContent = new Date().getFullYear();
  renderPreview();
  refreshSummary();
  renderBank();
  renderPending();

  /* location-bank.js already kicked off pullCitiesFromApi() at its own
     boot (fire-and-forget); it resolves after this script's synchronous
     boot has already rendered Step 1 and the Manage Cities list off the
     small local fixture, so re-render once it lands to pick up the full
     district/tehsil city bank. */
  BANK.pullCitiesFromApi().then(function () {
    populateCitySelect();
    renderCityMgmt();
  });
})(window, document);
