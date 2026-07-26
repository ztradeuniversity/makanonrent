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
    city: '', cityName: '', area: '', areaName: '', budgetMin: '', budgetMax: '',
    category: 'homes', type: '', size: '', unit: 'marla',
    beds: '', preference: ''
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

  function makeChip(label, pressed) {
    var b = doc.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    return b;
  }

  /* Single-select toggle group: pressing an active chip clears it. */
  function bindToggleGroup(container, onPick) {
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.chip, .seg button');
      if (!btn || !container.contains(btn)) return;
      var was = btn.getAttribute('aria-pressed') === 'true';
      var sibs = container.querySelectorAll('[aria-pressed]');
      for (var i = 0; i < sibs.length; i++) sibs[i].setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', was ? 'false' : 'true');
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
    LOC.getMainAreas(cityId).forEach(function (m) {
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
    state.area = mainSel.value;
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
    state.budgetMin = /^\d+$/.test(budgetMin.value.trim()) ? budgetMin.value.trim() : '';
    state.budgetMax = /^\d+$/.test(budgetMax.value.trim()) ? budgetMax.value.trim() : '';
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
