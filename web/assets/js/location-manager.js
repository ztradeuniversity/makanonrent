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
  /* Per-group collapse state, index-aligned with `groups`. */
  var collapsed = [];

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

  /* Tree expand state — collapsed by default (per-node-id, so state
     survives a re-render/search/sort). Never set true by add/edit/delete
     handlers — only the toggle click handlers below flip these. */
  var expandedCity = {};
  var expandedMain = {};
  var locationsOpen = false;

  $('lmLocationsToggle').addEventListener('click', function () {
    locationsOpen = !locationsOpen;
    this.textContent = (locationsOpen ? '▼' : '▶') + ' Locations';
    $('lmCityMgmtList').hidden = !locationsOpen;
    if (locationsOpen) renderCityMgmt();
  });

  function renderCityMgmt() {
    if (!locationsOpen) return;
    var list = citiesFiltered();
    $('lmCityMgmtList').innerHTML = list.length
      ? list.map(function (c) {
          var mainsList = LOC.getMainAreas(c.id, { includeInactive: true });
          var disabled = !c.active;
          var open = !!expandedCity[c.id];
          var html = '<div class="lm-tree-city' + (disabled ? ' is-disabled' : '') + '">' +
            '<div class="lm-bank-row">' +
              '<button class="lm-ico lm-toggle" type="button" data-toggle-tree="city" data-id="' + esc(c.id) + '" aria-label="Expand or collapse">' +
                (open ? IC.up : IC.down) + '</button>' +
              '<input class="lm-name" data-rename-city="' + esc(c.id) + '" value="' + esc(c.name) + '" aria-label="Rename city" />' +
              '<span>' + mainsList.length + ' main area' + (mainsList.length === 1 ? '' : 's') + (disabled ? ' · Disabled' : '') + '</span>' +
              '<button class="lm-mini' + (disabled ? ' is-ok' : ' is-no') + '" type="button" data-toggle-city="' + esc(c.id) + '" data-next="' + (disabled ? 'enable' : 'disable') + '">' +
                (disabled ? 'Enable' : 'Disable') +
              '</button>' +
              '<button class="lm-ico is-danger" type="button" data-del-city="' + esc(c.id) + '" aria-label="Delete city">' + IC.del + '</button>' +
            '</div>';

          if (open) {
            html += '<div class="lm-tree-children">' + (mainsList.length
              ? mainsList.map(function (m) {
                  var subsList = LOC.getSubAreas(m.id, { includeInactive: true });
                  var mOpen = !!expandedMain[m.id];
                  var mHtml = '<div class="lm-tree-main">' +
                    '<div class="lm-bank-row lm-bank-row-sm">' +
                      '<button class="lm-ico lm-toggle" type="button" data-toggle-tree="main" data-id="' + esc(m.id) + '" aria-label="Expand or collapse">' +
                        (mOpen ? IC.up : IC.down) + '</button>' +
                      '<span class="lm-grow">' + esc(m.name) + '</span>' +
                      '<span>' + subsList.length + ' sub area' + (subsList.length === 1 ? '' : 's') + '</span>' +
                      '<button class="lm-ico is-danger" type="button" data-del-node="' + esc(m.id) + '" data-label="' + esc(m.name) + '" aria-label="Delete main location">' + IC.del + '</button>' +
                    '</div>';
                  if (mOpen) {
                    mHtml += '<div class="lm-tree-children">' + (subsList.length
                      ? subsList.map(function (s) {
                          return '<div class="lm-bank-row lm-bank-row-sm">' +
                            '<span class="lm-grow" style="margin-left:30px">' + esc(s.name) + '</span>' +
                            '<button class="lm-ico is-danger" type="button" data-del-node="' + esc(s.id) + '" data-label="' + esc(s.name) + '" aria-label="Delete sub location">' + IC.del + '</button>' +
                          '</div>';
                        }).join('')
                      : '<div class="lm-empty" style="margin-left:30px">No sub locations.</div>') + '</div>';
                  }
                  return mHtml + '</div>';
                }).join('')
              : '<div class="lm-empty">No main locations yet.</div>') + '</div>';
          }
          return html + '</div>';
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
    var tt = e.target.closest('[data-toggle-tree]');
    if (tt) {
      var kind = tt.getAttribute('data-toggle-tree'), tid2 = tt.getAttribute('data-id');
      var store = kind === 'city' ? expandedCity : expandedMain;
      store[tid2] = !store[tid2];
      renderCityMgmt();
      return;
    }

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

    var delNode = e.target.closest('[data-del-node]');
    if (delNode) {
      var nid = delNode.getAttribute('data-del-node');
      var label = delNode.getAttribute('data-label');
      if (!win.confirm('Delete "' + label + '" and everything under it? This cannot be undone.')) return;
      LOC.removeLocation(nid, { cascade: true });
      BANK.syncNodeDelete(nid);
      cityMsg('Deleted.', 'is-ok');
      renderCityMgmt();
      refreshSummary();
      renderBank();
      return;
    }

    var b = e.target.closest('[data-del-city]');
    if (!b) return;
    var id = b.getAttribute('data-del-city');
    var mainCount = LOC.getMainAreas(id, { includeInactive: true }).length;

    /* Single confirmation covers the cascade — a city with dependencies
       is no longer silently refused; the admin is told exactly what
       will be removed and confirms once. */
    var warn = mainCount > 0
      ? 'Delete this city AND its ' + mainCount + ' main area(s) with all their sub areas? This cannot be undone.'
      : 'Delete this city? This cannot be undone.';
    if (!win.confirm(warn)) return;

    var ok = LOC.removeLocation(id, { cascade: true });
    if (!ok) { cityMsg('Could not delete that city.', 'is-error'); return; }
    BANK.syncCityDelete(id, true);
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

      return '<div class="lm-group' + (collapsed[gi] ? ' is-collapsed' : '') + '">' +
        '<div class="lm-main">' +
          '<button class="lm-ico lm-toggle" type="button" data-act="toggle" data-g="' + gi + '" aria-label="Expand or collapse">' +
            (collapsed[gi] ? IC.down : IC.up) + '</button>' +
          '<span class="lm-tag">Main Area</span>' +
          '<input class="lm-name" data-g="' + gi + '" data-main="1" value="' + esc(g.main) + '" aria-label="Main area name" />' +
          '<span class="lm-count">' + g.subs.length + ' sub</span>' +
          '<button class="lm-ico is-danger" type="button" data-act="main-del" data-g="' + gi + '" aria-label="Delete main area">' + IC.del + '</button>' +
        '</div>' +
        /* Alias names for this same main area — shown so the admin can
           see they were understood as one location, not several. */
        ((g.aliases || []).length
          ? '<div class="lm-crumb" style="margin-left:34px">Also known as: ' +
              g.aliases.map(esc).join(' · ') + '</div>'
          : '') +
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

    if (act === 'toggle') collapsed[gi] = !collapsed[gi];
    else if (act === 'main-del') { groups.splice(gi, 1); collapsed.splice(gi, 1); }
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
          /* Alternate names for the same main location — carried through
             to publish so they reach locations.aliases rather than being
             dropped between preview and publish. */
          aliases: (g.aliases || []).map(function (a) { return String(a || '').trim(); }).filter(Boolean),
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

  $('lmPublish').addEventListener('click', async function () {
    var clean = cleanGroups();
    var btn = this;
    btn.disabled = true;
    msg('Publishing…');
    var res = await BANK.publish(citySel.value, clean);
    btn.disabled = false;
    if (!res.ok) { msg(res.error, 'is-error'); renderBank(); return; }

    var subs = clean.reduce(function (n, g) { return n + g.subs.length; }, 0);
    msg('Published — ' + clean.length + ' main area' + (clean.length === 1 ? '' : 's') +
        ' and ' + subs + ' sub area' + (subs === 1 ? '' : 's') + ' are now searchable across the site.', 'is-ok');

    groups = [];
    $('lmPaste').value = '';
    renderPreview();
    refreshSummary();
    renderBank();
  });

  /* ── published bank list ──────────────────────────────────
     Reads the SERVER, not localStorage. This panel is the admin's proof
     that a publish actually reached the database, so showing the local
     optimistic copy here would defeat its only purpose — a publish that
     never synced must appear absent here, not published. */
  /* Server truth, cached only for the lifetime of a render so the edit
     handlers can find the entry they act on. Never written to storage. */
  var serverBank = { version: 1, entries: [] };
  /* Per-main-location expand state, keyed by cityId + KEY_SEP + main. */
  var KEY_SEP = '::';
  var bankOpen = {};

  function bankMsg(text, cls) {
    var el = $('lmBankMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'lm-msg' + (cls ? ' ' + cls : '');
  }

  function entryKey(e) { return e.cityId + KEY_SEP + e.main; }
  function findEntry(key) {
    for (var i = 0; i < serverBank.entries.length; i++) {
      if (entryKey(serverBank.entries[i]) === key) return serverBank.entries[i];
    }
    return null;
  }

  /* Re-reads the database, then paints. Use this after any mutation. */
  async function renderBank() {
    if (!$('lmBankCount')) return;
    $('lmBankCount').textContent = 'Loading published data…';

    try {
      serverBank = await BANK.readServer();
    } catch (e) {
      $('lmBankCount').textContent = 'Could not read published data from the server — ' + e.message;
      $('lmBank').innerHTML = '';
      return;
    }
    paintBank();
  }

  /* Paints the already-fetched server data. Expanding/collapsing a row is
     a pure view change, so it repaints from this cache rather than
     re-querying the database on every click. */
  function paintBank() {
    if (!$('lmBankCount')) return;
    var entries = serverBank.entries;
    var rows = entries.filter(function (e) {
      return !citySel.value || e.cityId === citySel.value;
    });

    var totalSubs = entries.reduce(function (n, e) { return n + (e.subs || []).length; }, 0);
    var cities = {};
    entries.forEach(function (e) { cities[e.cityId] = 1; });
    var cityCount = Object.keys(cities).length;

    $('lmBankCount').textContent = entries.length
      ? 'In the database: ' + cityCount + ' cit' + (cityCount === 1 ? 'y' : 'ies') + ' · ' +
        entries.length + ' main location' + (entries.length === 1 ? '' : 's') + ' · ' +
        totalSubs + ' sub location' + (totalSubs === 1 ? '' : 's') +
        (citySel.value ? ' — showing ' + rows.length + ' in the selected city' : '')
      : 'Empty — nothing is published in the database yet.';

    if (!rows.length) {
      $('lmBank').innerHTML = '<div class="lm-empty">Nothing published' +
        (citySel.value ? ' in this city' : '') + ' yet.</div>';
      return;
    }

    /* City → Main Location → (Also Known As, Sub Locations). Grouped by
       city so the hierarchy the admin published is the hierarchy shown. */
    var byCity = {};
    var cityOrder = [];
    rows.forEach(function (e) {
      if (!byCity[e.cityId]) { byCity[e.cityId] = { name: e.cityName || e.cityId, list: [] }; cityOrder.push(e.cityId); }
      byCity[e.cityId].list.push(e);
    });

    $('lmBank').innerHTML = cityOrder.map(function (cid) {
      var city = byCity[cid];
      return '<div class="lm-tree-city">' +
        '<div class="lm-bank-row">' +
          '<div class="lm-grow"><b>' + esc(city.name) + '</b>' +
          '<span class="lm-crumb">' + city.list.length + ' main location' + (city.list.length === 1 ? '' : 's') + '</span></div>' +
          '<button class="lm-mini" type="button" data-bank-addmain="' + esc(cid) + '">+ Main Location</button>' +
        '</div>' +
        '<div class="lm-tree-children">' + city.list.map(function (e) {
          var key = entryKey(e);
          var subs = e.subs || [];
          var subNodes = e.subNodes || [];
          var aliases = e.aliases || [];
          var open = !!bankOpen[key];
          return '<div class="lm-tree-main">' +
            '<div class="lm-bank-row lm-bank-row-sm">' +
              '<button class="lm-ico lm-toggle" type="button" data-bank-toggle="' + esc(key) + '" aria-label="Expand or collapse">' +
                (open ? IC.up : IC.down) + '</button>' +
              '<span class="lm-grow"><b>' + esc(e.main) + '</b></span>' +
              '<span>' + aliases.length + ' alias' + (aliases.length === 1 ? '' : 'es') +
                ' · ' + subs.length + ' sub' + (subs.length === 1 ? '' : 's') + '</span>' +
              '<button class="lm-mini" type="button" data-bank-renamemain="' + esc(key) + '">Rename</button>' +
              '<button class="lm-ico is-danger" type="button" data-bank-del="' + esc(key) + '" aria-label="Delete main location">' + IC.del + '</button>' +
            '</div>' +
            (open
              ? '<div class="lm-tree-children">' +
                  '<div class="lm-bank-row lm-bank-row-sm">' +
                    '<span class="lm-grow"><b>Also Known As</b> (' + aliases.length + ')</span>' +
                    '<button class="lm-mini" type="button" data-bank-addalias="' + esc(key) + '">+ Alias</button>' +
                  '</div>' +
                  (aliases.length
                    ? aliases.map(function (a, ai) {
                        return '<div class="lm-bank-row lm-bank-row-sm">' +
                          '<span class="lm-grow" style="margin-left:30px">' + esc(a) + '</span>' +
                          '<button class="lm-mini" type="button" data-bank-editalias="' + esc(key) + '" data-idx="' + ai + '">Edit</button>' +
                          '<button class="lm-ico is-danger" type="button" data-bank-delalias="' + esc(key) + '" data-idx="' + ai + '" aria-label="Remove alias">' + IC.del + '</button>' +
                        '</div>';
                      }).join('')
                    : '<div class="lm-empty" style="margin-left:30px">No alias names.</div>') +
                  '<div class="lm-bank-row lm-bank-row-sm">' +
                    '<span class="lm-grow"><b>Sub Locations</b> (' + subs.length + ')</span>' +
                    '<button class="lm-mini" type="button" data-bank-addsub="' + esc(key) + '">+ Sub Location</button>' +
                  '</div>' +
                  (subNodes.length
                    ? subNodes.map(function (s) {
                        return '<div class="lm-bank-row lm-bank-row-sm">' +
                          '<span class="lm-grow" style="margin-left:30px">' + esc(s.name) + '</span>' +
                          '<button class="lm-mini" type="button" data-bank-renamesub="' + esc(s.nodeId) + '" data-name="' + esc(s.name) + '">Edit</button>' +
                          '<button class="lm-ico is-danger" type="button" data-bank-delsub="' + esc(s.nodeId) + '" data-name="' + esc(s.name) + '" aria-label="Delete sub location">' + IC.del + '</button>' +
                        '</div>';
                      }).join('')
                    : '<div class="lm-empty" style="margin-left:30px">No sub locations.</div>') +
                '</div>'
              : '') +
          '</div>';
        }).join('') + '</div>' +
      '</div>';
    }).join('');
  }

  /* Every mutation below goes to the SERVER and then re-reads the server.
     A failure is surfaced verbatim and the panel is left showing the real
     state — success is never assumed. */
  async function bankMutate(runner, okText) {
    try {
      await runner();
      bankMsg(okText, 'is-ok');
    } catch (e) {
      bankMsg(e.message, 'is-error');
    }
    await renderBank();
  }

  $('lmBank').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-bank-toggle]');
    if (t) {
      var k = t.getAttribute('data-bank-toggle');
      bankOpen[k] = !bankOpen[k];
      paintBank();
      return;
    }

    /* ── Main Location: delete ─────────────────────────────────────
       Addressed by e.nodeId — the id the SERVER stores. Deriving it from
       the display name breaks on any row written under an older slug
       rule (that is what produced "No such location." on the Urdu row,
       whose stored id is 'lahore/' from the pre-fallback slugify). */
    var del = ev.target.closest('[data-bank-del]');
    if (del) {
      var e1 = findEntry(del.getAttribute('data-bank-del'));
      if (!e1 || !e1.nodeId) return;
      if (!win.confirm('Delete "' + e1.main + '" from the database?\n\nThis also removes its ' +
        (e1.subs || []).length + ' sub location(s) and its ' + (e1.aliases || []).length +
        ' alias name(s).')) return;
      bankMutate(async function () {
        try {
          await BANK.deleteNode(e1.nodeId, false);
        } catch (err) {
          /* 409 = the server found dependents and is refusing until the
             admin is told exactly what they are. */
          if (err.status !== 409 || !err.data || !err.data.dependents) throw err;
          var d = err.data.dependents;
          var warn = 'Deleting "' + e1.main + '" will affect:\n' +
            '· ' + (d.subLocations == null ? 'unknown' : d.subLocations) + ' sub location(s) — deleted\n' +
            '· ' + (d.properties == null ? 'unknown' : d.properties) + ' property/properties — kept, area link cleared\n' +
            '· ' + (d.areaAssignments == null ? 'unknown' : d.areaAssignments) + ' admin area assignment(s) — DELETED\n' +
            '· ' + (d.tasks == null ? 'unknown' : d.tasks) + ' task(s) — kept, area cleared\n\nProceed?';
          if (!win.confirm(warn)) throw new Error('Deletion cancelled.');
          await BANK.deleteNode(e1.nodeId, true);
        }
      }, 'Deleted from the database.');
      return;
    }

    /* ── Main Location: rename (display name only) ──────────────── */
    var renMain = ev.target.closest('[data-bank-renamemain]');
    if (renMain) {
      var e4 = findEntry(renMain.getAttribute('data-bank-renamemain'));
      if (!e4 || !e4.nodeId) return;
      var newMain = win.prompt(
        'Rename this main location.\n\nThe displayed and searched name changes; its internal id ' +
        '(' + e4.nodeId + ') stays the same so its sub locations, property links and ' +
        'area assignments keep working.', e4.main);
      if (newMain === null) return;
      newMain = newMain.trim();
      if (!newMain || newMain === e4.main) return;
      bankMutate(function () { return BANK.renameNode(e4.nodeId, newMain); }, 'Main location renamed.');
      return;
    }

    /* ── Main Location: add under a city ───────────────────────── */
    var addMain = ev.target.closest('[data-bank-addmain]');
    if (addMain) {
      var cityId = addMain.getAttribute('data-bank-addmain');
      var mainName = win.prompt('New main location name (canonical):', '');
      if (mainName === null) return;
      mainName = mainName.trim();
      if (!mainName) return;
      var aliasBlob = win.prompt(
        'Also Known As for "' + mainName + '" — one per line.\n' +
        'These become alternate NAMES of this same location, not separate locations.\n' +
        'Leave blank for none.', '');
      if (aliasBlob === null) return;
      bankMutate(function () {
        return BANK.addNode(cityId, mainName, toLines(aliasBlob));
      }, 'Main location added.');
      return;
    }

    /* ── Alias: add / edit / remove ─────────────────────────────
       All three write the whole aliases array back onto the canonical
       row, so an alias can never become a second parent. */
    var addAlias = ev.target.closest('[data-bank-addalias]');
    if (addAlias) {
      var e5 = findEntry(addAlias.getAttribute('data-bank-addalias'));
      if (!e5 || !e5.nodeId) return;
      var newAlias = win.prompt('New "Also Known As" name for "' + e5.main + '":', '');
      if (newAlias === null) return;
      newAlias = newAlias.trim();
      if (!newAlias) return;
      bankMutate(function () {
        return BANK.setAliases(e5.nodeId, (e5.aliases || []).concat([newAlias]));
      }, 'Alias added — it resolves to the same main location.');
      return;
    }

    var editAlias = ev.target.closest('[data-bank-editalias]');
    if (editAlias) {
      var e6 = findEntry(editAlias.getAttribute('data-bank-editalias'));
      if (!e6 || !e6.nodeId) return;
      var ai = Number(editAlias.getAttribute('data-idx'));
      var cur = (e6.aliases || [])[ai];
      var nextAlias = win.prompt('Edit alias of "' + e6.main + '":', cur || '');
      if (nextAlias === null) return;
      nextAlias = nextAlias.trim();
      if (!nextAlias) return;
      var updated = (e6.aliases || []).slice();
      updated[ai] = nextAlias;
      bankMutate(function () { return BANK.setAliases(e6.nodeId, updated); }, 'Alias updated.');
      return;
    }

    var delAlias = ev.target.closest('[data-bank-delalias]');
    if (delAlias) {
      var e7 = findEntry(delAlias.getAttribute('data-bank-delalias'));
      if (!e7 || !e7.nodeId) return;
      var di = Number(delAlias.getAttribute('data-idx'));
      var gone = (e7.aliases || [])[di];
      if (!win.confirm('Remove the alias "' + gone + '"?\n\nOnly this alternate name is removed — "' +
        e7.main + '" and its sub locations are untouched.')) return;
      var remaining = (e7.aliases || []).filter(function (_, i) { return i !== di; });
      bankMutate(function () { return BANK.setAliases(e7.nodeId, remaining); }, 'Alias removed.');
      return;
    }

    /* ── Sub Location: add / rename / delete ───────────────────── */
    var addSub = ev.target.closest('[data-bank-addsub]');
    if (addSub) {
      var e8 = findEntry(addSub.getAttribute('data-bank-addsub'));
      if (!e8 || !e8.nodeId) return;
      var subName = win.prompt('New sub location under "' + e8.main + '":', '');
      if (subName === null) return;
      subName = subName.trim();
      if (!subName) return;
      bankMutate(function () { return BANK.addNode(e8.nodeId, subName, []); }, 'Sub location added.');
      return;
    }

    var renSub = ev.target.closest('[data-bank-renamesub]');
    if (renSub) {
      var subNodeId = renSub.getAttribute('data-bank-renamesub');
      var curSub = renSub.getAttribute('data-name');
      var nextSub = win.prompt('Rename sub location:', curSub);
      if (nextSub === null) return;
      nextSub = nextSub.trim();
      if (!nextSub || nextSub === curSub) return;
      bankMutate(function () { return BANK.renameNode(subNodeId, nextSub); }, 'Sub location renamed.');
      return;
    }

    var delSub = ev.target.closest('[data-bank-delsub]');
    if (delSub) {
      var delSubId = delSub.getAttribute('data-bank-delsub');
      var delSubName = delSub.getAttribute('data-name');
      if (!win.confirm('Delete sub location "' + delSubName + '" from the database?')) return;
      bankMutate(function () { return BANK.deleteNode(delSubId, true); }, 'Sub location deleted.');
      return;
    }
  });

  function toLines(v) {
    return String(v == null ? '' : v).split(/\r?\n/)
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* CSP (`script-src 'self'`) blocks inline handlers, so the Published
     Data disclosure is bound here instead of in the markup. */
  (function () {
    var head = $('lmBankToggle'), body = $('lmBankBody');
    if (!head || !body) return;
    function toggle() {
      body.hidden = !body.hidden;
      head.setAttribute('aria-expanded', String(!body.hidden));
      head.textContent = (body.hidden ? '▶' : '▼') + ' Published Data';
      if (!body.hidden) renderBank();
    }
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    $('lmBankRefresh').addEventListener('click', function () {
      bankMsg('');
      renderBank();
    });
  })();

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

  /* ── CEO-only reset (server re-checks the role; this only hides it) ── */
  if (ME.user && ME.user.role === 'ceo') $('lmResetCard').hidden = false;

  $('lmResetBtn').addEventListener('click', async function () {
    var el = $('lmResetMsg');
    var token = $('lmResetConfirm').value.trim();
    if (token !== 'RESET ALL LOCATIONS') {
      el.textContent = 'Type the confirmation phrase exactly to proceed.';
      el.className = 'lm-msg is-error';
      return;
    }
    this.disabled = true;
    try {
      var res = await win.MOR_ADMIN.post(CFG.routes.api.adminResetLocations, { confirm: token });
      var d = res.deleted || {};
      el.textContent = 'Reset complete — removed ' + (d.city || 0) + ' cities, ' +
        (d.locality || 0) + ' main and ' + (d.subarea || 0) + ' sub locations.';
      el.className = 'lm-msg is-ok';
      $('lmResetConfirm').value = '';
      populateCitySelect(); renderCityMgmt(); renderBank(); refreshSummary();
    } catch (e) {
      el.textContent = e.message;
      el.className = 'lm-msg is-error';
    }
    this.disabled = false;
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
