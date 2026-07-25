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
    city: '', cityName: '', area: '', areaName: '', budget: '',
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
  var citySel = $('fCity');
  var areaInput = $('fArea');
  var cityIdBySlug = {};

  (function initLocations() {
    var frag = doc.createDocumentFragment();
    LOC.listCities().forEach(function (c) {
      var o = doc.createElement('option');
      o.value = c.slug; o.textContent = c.name;
      frag.appendChild(o);
      cityIdBySlug[c.slug] = c.id;
    });
    citySel.appendChild(frag);

    citySel.addEventListener('change', function () {
      state.city = citySel.value;
      state.cityName = citySel.value ? citySel.options[citySel.selectedIndex].text : '';
      state.area = ''; state.areaName = '';
      locSearch.clear();
    });
  })();

  var locSearch = win.MOR_LOC_SEARCH.mount(areaInput, {
    getScope: function () { return state.city ? cityIdBySlug[state.city] : null; },
    onSelect: function (node) {
      if (!node) { state.area = ''; state.areaName = ''; return; }
      state.city = node.citySlug || state.city;
      state.cityName = node.cityName || state.cityName;
      state.area = node.areaSlug || '';
      state.areaName = node.areaName || (node.type === 'city' ? '' : node.name);
      citySel.value = state.city;
    }
  });

  /* ── Budget ─────────────────────────────────────────────── */
  bindNumeric($('fBudget'), function (raw) { state.budget = raw; });

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

    add(P.budgetMax, state.budget);
    add(P.category,  state.category);
    add(P.type,      state.type);
    add(P.beds,      state.beds);
    add(P.areaSize,  state.size);
    if (state.size) add(P.areaUnit, state.unit);
    add(P.sizePref,  state.preference);

    return path + (q.length ? '?' + q.join('&') : '');
  }

  function submit() {
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
