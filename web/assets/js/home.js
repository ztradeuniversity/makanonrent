/* ══════════════════════════════════════════════════════════════
   MakanOnRent — Homepage behaviour (Phase 1)
   Components: LocationPicker · AdvancedSearch · QuickCards ·
               SearchSubmit · NotifyModal (reusable)
   No backend calls. Search routes to the /rent/{city}/{area}
   listing URL contract (docs/13 §4.1).
   ══════════════════════════════════════════════════════════════ */
(function (win, doc) {
  'use strict';

  var CFG   = win.MOR_CONFIG;
  var LOC   = win.MOR_LOC;
  var slug  = LOC.slugify;
  var $     = function (id) { return doc.getElementById(id); };

  /* Search criteria — single source of truth for the whole page. */
  var state = {
    city: '', cityName: '', area: '', areaName: '',
    /* area/subarea always hold CANONICAL slugs, never an alias slug. */
    subarea: '', subareaName: '',
    budgetMin: '', budgetMax: '',
    category: 'homes', type: '', size: '', unit: 'marla',
    beds: '', preference: '',
    /* Canonical requirement keys (MOR_CONFIG.propertyNeeds), multi-select. */
    needs: []
  };

  var TYPES = {
    homes:      ['House', 'Flat', 'Portion', 'Other'],
    commercial: ['Office', 'Shop', 'Room', 'Other']
  };

  /* ── helpers ────────────────────────────────────────────── */
  function digits(v) { return String(v).replace(/\D/g, ''); }

  function withCommas(v) {
    return v ? Number(v).toLocaleString('en-PK') : '';
  }

  /* Comma-format a numeric input while preserving caret sanity. */
  function bindNumeric(el, onChange) {
    el.addEventListener('input', function () {
      var raw = digits(el.value);
      el.value = withCommas(raw);
      onChange(raw);
    });
  }

  /* `aria-pressed` stays as the accessible state, but the SELECTED STYLING
     hangs off an `is-on` class. Chrome does not reliably invalidate an
     attribute-selector match for elements built by script inside the
     collapsed advanced panel, so a chip could report aria-pressed="true"
     while still painting as unselected; a class change always
     invalidates. setPressed keeps the two in lockstep. */
  function setPressed(el, on) {
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.classList.toggle('is-on', !!on);
  }

  function makeChip(label, pressed) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    setPressed(b, pressed);
    return b;
  }

  /* Single-select toggle group: pressing an active chip clears it. */
  function bindToggleGroup(container, onPick) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip, .seg button');
      if (!btn || !container.contains(btn)) return;
      var was = btn.getAttribute('aria-pressed') === 'true';
      var sibs = container.querySelectorAll('[aria-pressed]');
      for (var i = 0; i < sibs.length; i++) setPressed(sibs[i], false);
      setPressed(btn, !was);
      onPick(was ? '' : btn);
    });
  }

  /* ── LocationPicker: single Smart Location Engine (docs/13, Phase 6) ──
     City select still exists for quick browsing; the Location field
     is a full-hierarchy autocomplete. Either one can drive the other —
     there is only one source of truth (MOR_LOC) behind both. */
  /* City → Main Location → Sub Location cascade — same pattern and same
     engine (MOR_LOC) as Submit Property and Location Manager, so anything
     published in Location Manager appears here immediately. */
  var citySel = $('fCity');
  var mainSel = $('fMainLoc');
  var subSel = $('fSubLoc');
  var cityIdBySlug = {};
  var mainIdBySlug = {};

  function resetSel(sel, placeholder) {
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder, ''));
    sel.disabled = true;
  }

  function populateMain() {
    resetSel(mainSel, 'Select main location');
    mainIdBySlug = {};
    var cityId = cityIdBySlug[state.city];
    if (!cityId) { resetSel(mainSel, 'Select a city first'); return; }
    /* Options, not nodes: every alias is its own selectable name mapping
       back to the same canonical id, so picking any of them yields the
       same sub locations. */
    LOC.getMainAreaOptions(cityId).forEach(function (m) {
      mainSel.appendChild(new Option(m.name, m.slug));
      mainIdBySlug[m.slug] = m.id;
    });
    mainSel.disabled = false;
  }

  function populateSub() {
    resetSel(subSel, 'Select sub location');
    var mainId = mainIdBySlug[state.area];
    if (!mainId) { resetSel(subSel, 'Select a main location first'); return; }
    LOC.getSubAreas(mainId).forEach(function (s) {
      subSel.appendChild(new Option(s.name, s.slug));
    });
    if (subSel.options.length > 1) subSel.disabled = false;
    else resetSel(subSel, 'No sub locations available');
  }

  function refreshLocations() {
    var keepCity = state.city;
    citySel.innerHTML = '';
    citySel.appendChild(new Option('Select city', ''));
    cityIdBySlug = {};
    LOC.listCities().forEach(function (c) {
      citySel.appendChild(new Option(c.name, c.slug));
      cityIdBySlug[c.slug] = c.id;
    });
    if (keepCity && cityIdBySlug[keepCity]) citySel.value = keepCity;
    populateMain();
    populateSub();
  }

  refreshLocations();

  citySel.addEventListener('change', function () {
    state.city = citySel.value;
    state.cityName = citySel.value ? citySel.options[citySel.selectedIndex].text : '';
    state.area = ''; state.areaName = '';
    state.subarea = ''; state.subareaName = '';
    populateMain();
    populateSub();
  });

  mainSel.addEventListener('change', function () {
    /* The picker lists aliases as their own options, so the selected
       option's slug may be an alias ("ait") while every property is
       tagged with the CANONICAL area slug. Resolving the option back to
       its canonical node here is what makes "AIT", "Iqbal Town" and
       "علامہ اقبال ٹاؤن" return the same results as the canonical name —
       the alias is a way to find the place, never a different place.
       mainIdBySlug already maps every option (canonical or alias) to the
       one canonical node id. */
    var canonical = mainSel.value ? LOC.getById(mainIdBySlug[mainSel.value]) : null;
    state.area = canonical ? canonical.slug : mainSel.value;
    state.areaName = mainSel.value ? mainSel.options[mainSel.selectedIndex].text : '';
    state.subarea = ''; state.subareaName = '';
    populateSub();
  });

  subSel.addEventListener('change', function () {
    state.subarea = subSel.value;
    state.subareaName = subSel.value ? subSel.options[subSel.selectedIndex].text : '';
  });

  /* location-bank.js pulls the published bank asynchronously at boot;
     re-render once it lands so newly published areas appear without a
     manual refresh. */
  if (win.MOR_BANK && win.MOR_BANK.pullFromApi) {
    win.MOR_BANK.pullFromApi().then(refreshLocations).catch(function () {});
  }

  /* ── Budget: PKR range steps, shared shape across the site ── */
  var budgetMin = $('fBudgetMin'), budgetMax = $('fBudgetMax');
  function readBudgetRange() {
    budgetMin.value = budgetMin.value.replace(/\D/g, '');
    budgetMax.value = budgetMax.value.replace(/\D/g, '');
    state.budgetMin = budgetMin.value;
    state.budgetMax = budgetMax.value;
  }
  budgetMin.addEventListener('input', readBudgetRange);
  budgetMax.addEventListener('input', readBudgetRange);

  /* ── AdvancedSearch ─────────────────────────────────────── */
  var advPanel = $('advPanel');
  var advToggle = $('advToggle');

  advToggle.addEventListener('click', function () {
    var open = advPanel.classList.toggle('is-open');
    advToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  var typeChips = $('typeChips');

  function renderTypes() {
    typeChips.innerHTML = '';
    TYPES[state.category].forEach(function (t) {
      typeChips.appendChild(makeChip(t, slug(t) === state.type));
    });
  }

  /* Category segmented control */
  (function () {
    var seg = advToggle.parentNode.querySelector('.seg');
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-cat]');
      if (!btn) return;
      var sibs = seg.querySelectorAll('button');
      for (var i = 0; i < sibs.length; i++) sibs[i].setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      state.category = btn.getAttribute('data-cat');
      state.type = '';
      renderTypes();
    });
  })();

  bindToggleGroup(typeChips, function (btn) {
    state.type = btn ? slug(btn.textContent) : '';
  });

  renderTypes();

  /* Bedrooms — reuses the existing chip + toggle-group helpers and the
     existing state.beds field, so it rides the query contract that was
     already in place (P.beds → MOR_DATA.query's `beds` predicate). The
     value is the leading digit, so "5+" sends 5 and the predicate's
     "at least" comparison covers everything above it. */
  var bedChips = $('bedChips');

  function renderBeds() {
    bedChips.innerHTML = '';
    ['1', '2', '3', '4', '5+'].forEach(function (b) {
      bedChips.appendChild(makeChip(b, digits(b) === state.beds));
    });
  }

  bindToggleGroup(bedChips, function (btn) {
    state.beds = btn ? digits(btn.textContent) : '';
  });

  renderBeds();

  /* My Needs — multi-select, unlike every other chip group on this page,
     so it toggles each chip independently instead of reusing
     bindToggleGroup (which enforces a single choice). Values are the
     canonical keys from MOR_CONFIG.propertyNeeds. */
  var needChips = $('needChips');

  /* Inline 24px stroke icons in the same visual language as the rest of
     the page (same viewBox, stroke width and cap style as the field
     icons), so recognition improves without pulling in an icon library
     or making the chips any taller. */
  var NEED_IC = {
    car_parking:       '<path d="M5 17h14M6.5 17v2M17.5 17v2"/><path d="M6 17l1.4-5.2A2 2 0 0 1 9.3 10h5.4a2 2 0 0 1 1.9 1.8L18 17"/><circle cx="8.5" cy="14" r=".6"/><circle cx="15.5" cy="14" r=".6"/>',
    separate_entrance: '<path d="M6 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M4 21h16"/><circle cx="13" cy="12" r=".8"/>',
    ground_floor:      '<path d="M3 20h5v-4h5v-4h5V8"/><path d="M3 20V9"/>',
    roof:              '<path d="M3 11 12 4l9 7"/><path d="M6 11v9h12v-9"/>',
    gas_meter:         '<path d="M12 3c2.5 3 4.5 5 4.5 8a4.5 4.5 0 0 1-9 0c0-1.4.6-2.6 1.6-3.9"/>',
    solar:             '<path d="M4 15h16l-1.6-8H5.6z"/><path d="M9.6 7 8.6 15M14.4 7l1 8M4.8 11h14.4"/><path d="M12 19v2"/>'
  };

  (CFG.propertyNeeds || []).forEach(function (n) {
    var chip = makeChip(n.label, false);
    chip.setAttribute('data-need', n.key);
    if (NEED_IC[n.key]) {
      chip.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + NEED_IC[n.key] + '</svg>' +
        '<span>' + n.label + '</span>';
    }
    needChips.appendChild(chip);
  });

  needChips.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-need]');
    if (!chip) return;
    var key = chip.getAttribute('data-need');
    var on = chip.getAttribute('aria-pressed') === 'true';
    setPressed(chip, !on);
    if (on) state.needs = state.needs.filter(function (k) { return k !== key; });
    else if (state.needs.indexOf(key) === -1) state.needs.push(key);
  });

  /* Area size + unit */
  bindNumeric($('fSize'), function (raw) { state.size = raw; });

  (function () {
    var seg = $('fSize').closest('.area-row').querySelector('.seg');
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-unit]');
      if (!btn) return;
      var sibs = seg.querySelectorAll('button');
      for (var i = 0; i < sibs.length; i++) sibs[i].setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
      state.unit = btn.getAttribute('data-unit');
    });
  })();

  /* ── QuickCards ─────────────────────────────────────────── */
  var QUICK = {
    quickHome:    { cat: 'homes', items: [
      { l: 'House',     type: 'house' },
      { l: 'Flat',      type: 'flat' },
      { l: 'Portion',   type: 'portion' },
      { l: '2 Bedroom', beds: '2' },
      { l: '3 Bedroom', beds: '3' },
      { l: '2 Marla',   size: '2', unit: 'marla' },
      { l: '3 Marla',   size: '3', unit: 'marla' },
      { l: '5 Marla',   size: '5', unit: 'marla' }
    ]},
    quickCommercial: { cat: 'commercial', items: [
      { l: 'Shop',   type: 'shop' },
      { l: 'Office', type: 'office' },
      { l: 'Room',   type: 'room' },
      { l: 'Small',  pref: 'small' },
      { l: 'Medium', pref: 'medium' },
      { l: 'Large',  pref: 'large' },
      { l: 'Other',  type: 'other' }
    ]}
  };

  Object.keys(QUICK).forEach(function (id) {
    var host = $(id);
    var cfg = QUICK[id];

    cfg.items.forEach(function (item) {
      var chip = makeChip(item.l, false);
      chip.addEventListener('click', function () {
        state.category = cfg.cat;
        if (item.type) state.type = item.type;
        if (item.beds) state.beds = item.beds;
        if (item.size) state.size = item.size;
        if (item.unit) state.unit = item.unit;
        if (item.pref) state.preference = item.pref;
        submit();
      });
      host.appendChild(chip);
    });
  });

  /* ── SearchSubmit → listing URL contract ────────────────── */
  function buildUrl() {
    var R = CFG.routes, P = R.params;
    var path, q = [];
    function add(k, v) { if (v) q.push(k + '=' + encodeURIComponent(v)); }

    if (R.useStaticRoutes) {
      path = R.listingPage;
      add('city', state.city);
      add('area', state.area);
    } else {
      path = R.listingBase + '/' + (state.city || R.allCitiesSlug);
      if (state.area) path += '/' + state.area;
    }

    /* The Sub Location was collected and stored but never sent, so
       choosing one had no effect on the results. listing.js already reads
       this exact parameter name, and it stays a query parameter in both
       routing modes so the results page parses it identically. */
    add('subarea', state.subarea);
    /* Comma-separated so several requirements travel in one readable
       parameter; listing.js and MOR_DATA both accept this form. */
    add('needs', state.needs.join(','));

    add(P.budgetMin, state.budgetMin);
    add(P.budgetMax, state.budgetMax);
    add(P.category,  state.category);
    add(P.type,      state.type);
    add(P.beds,      state.beds);
    add(P.areaSize,  state.size);
    if (state.size) add(P.areaUnit, state.unit);
    add(P.sizePref,  state.preference);

    return path + (q.length ? '?' + q.join('&') : '');
  }

  function submit() {
    readBudgetRange();
    var url = buildUrl();
    /* Results page reads the criteria to render the low-result
       notify banner without re-parsing the query string. */
    try { sessionStorage.setItem(CFG.storage.lastSearch, JSON.stringify(state)); } catch (e) {}
    win.location.assign(url);
  }

  $('searchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    submit();
  });

  $('yr').textContent = new Date().getFullYear();

  /* The shared notify modal reads the live search criteria and binds
     its own [data-notify-open] handler — see assets/js/shared.js. */
  win.MOR_CRITERIA = state;
  win.MOR = { state: state, notify: win.MOR_UI.Notify, buildUrl: buildUrl };
})(window, document);
