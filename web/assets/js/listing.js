/* MakanOnRent — Property Listing page (Phase 2).
   Reads criteria from the URL, renders results, owns view mode,
   pagination, loading / empty / low-result states. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, LOC = win.MOR_LOC, DATA = win.MOR_DATA, UI = win.MOR_UI;
  var P = CFG.routes.params, S = CFG.search;
  var $ = function (id) { return doc.getElementById(id); };

  var cardsEl = $('cards'), pagerEl = $('pager'), bannerEl = $('bannerSlot');
  var results = [], page = 1, view = 'grid';
  /* True when `results` holds ranked partial matches rather than exact
     ones — read by the headline and the notice above the grid. */
  var isClosest = false;

  /* ── criteria from URL ──────────────────────────────────── */
  var q = new URLSearchParams(win.location.search);
  var criteria = {
    city:      q.get('city') || '',
    area:      q.get('area') || '',
    subarea:   q.get('subarea') || '',
    needs:     q.get('needs') || '',
    budgetMin: q.get(P.budgetMin) || '',
    budgetMax: q.get(P.budgetMax) || '',
    category:  q.get(P.category) || '',
    type:      q.get(P.type) || '',
    beds:      q.get(P.beds) || '',
    areaSize:  q.get(P.areaSize) || '',
    areaUnit:  q.get(P.areaUnit) || '',
    sizePref:  q.get(P.sizePref) || '',
    sort:      q.get('sort') || 'recent'
  };
  win.MOR_CRITERIA = criteria;   /* consumed by the notify modal */

  /* ── filter bar: single Smart Location Engine (docs/13, Phase 6) ── */
  var citySel = $('fCity'), mainSel = $('fMainLoc'), subSel = $('fSubLoc'),
      budgetMinSel = $('fBudgetMin'), budgetMaxSel = $('fBudgetMax'),
      typeSel = $('fType'), sortSel = $('fSort');
  var BUDGET_STEPS = [10000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000, 300000, 500000];
  BUDGET_STEPS.forEach(function (v) {
    budgetMinSel.appendChild(new Option('PKR ' + v.toLocaleString('en-PK'), v));
    budgetMaxSel.appendChild(new Option('PKR ' + v.toLocaleString('en-PK'), v));
  });
  var cityIdBySlug = {}, mainIdBySlug = {};
  var locCityName = '', locAreaName = '';

  function resetSel(sel, placeholder) {
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder, ''));
    sel.disabled = true;
  }

  function populateMain(preserve) {
    resetSel(mainSel, 'Select main location');
    mainIdBySlug = {};
    var cityId = cityIdBySlug[citySel.value];
    if (!cityId) { resetSel(mainSel, 'Select a city first'); return; }
    /* Options, not nodes — see MOR_LOC.getMainAreaOptions: each alias is
       a selectable name resolving to the same canonical id. */
    LOC.getMainAreaOptions(cityId).forEach(function (m) {
      mainSel.appendChild(new Option(m.name, m.slug));
      mainIdBySlug[m.slug] = m.id;
    });
    mainSel.disabled = false;
    if (preserve && mainIdBySlug[preserve]) mainSel.value = preserve;
  }

  function populateSub(preserve) {
    resetSel(subSel, 'Select sub location');
    var mainId = mainIdBySlug[mainSel.value];
    if (!mainId) { resetSel(subSel, 'Select a main location first'); return; }
    LOC.getSubAreas(mainId).forEach(function (s) { subSel.appendChild(new Option(s.name, s.slug)); });
    if (subSel.options.length > 1) { subSel.disabled = false; if (preserve) subSel.value = preserve; }
    else resetSel(subSel, 'No sub locations available');
  }

  LOC.listCities().forEach(function (c) {
    citySel.appendChild(new Option(c.name, c.slug));
    cityIdBySlug[c.slug] = c.id;
  });

  citySel.value = criteria.city;
  locCityName = citySel.value ? citySel.options[citySel.selectedIndex].text : '';
  populateMain(criteria.area);
  locAreaName = mainSel.value ? mainSel.options[mainSel.selectedIndex].text : '';
  populateSub(criteria.subarea);

  mainSel.addEventListener('change', function () {
    /* Same rule as the homepage: an alias option resolves to its
       canonical node, so re-filtering here by "AIT" matches the same
       properties as "Allama Iqbal Town". */
    var canonical = mainSel.value ? LOC.getById(mainIdBySlug[mainSel.value]) : null;
    criteria.area = canonical ? canonical.slug : mainSel.value;
    locAreaName = mainSel.value ? mainSel.options[mainSel.selectedIndex].text : '';
    criteria.subarea = '';
    populateSub();
  });
  subSel.addEventListener('change', function () { criteria.subarea = subSel.value; });

  typeSel.value = criteria.type;
  sortSel.value = criteria.sort;
  budgetMinSel.value = criteria.budgetMin;
  budgetMaxSel.value = criteria.budgetMax;

  citySel.addEventListener('change', function () {
    criteria.area = ''; locAreaName = ''; criteria.subarea = '';
    locCityName = citySel.value ? citySel.options[citySel.selectedIndex].text : '';
    populateMain();
    populateSub();
  });

  $('filterForm').addEventListener('submit', function (e) {
    e.preventDefault();
    criteria.city      = citySel.value;
    criteria.type      = typeSel.value;
    criteria.budgetMin = budgetMinSel.value;
    criteria.budgetMax = budgetMaxSel.value;
    syncUrl();
    load();
  });

  sortSel.addEventListener('change', function () {
    criteria.sort = sortSel.value;
    syncUrl();
    load();
  });

  function syncUrl() {
    var p = new URLSearchParams();
    function add(k, v) { if (v) p.set(k, v); }
    add('city', criteria.city);
    add('area', criteria.area);
    add('subarea', criteria.subarea);
    add('needs', criteria.needs);
    add(P.budgetMin, criteria.budgetMin);
    add(P.budgetMax, criteria.budgetMax);
    add(P.category, criteria.category);
    add(P.type, criteria.type);
    add(P.beds, criteria.beds);
    add(P.areaSize, criteria.areaSize);
    add(P.areaUnit, criteria.areaUnit);
    add(P.sizePref, criteria.sizePref);
    if (criteria.sort !== 'recent') p.set('sort', criteria.sort);
    var qs = p.toString();
    win.history.replaceState(null, '', qs ? '?' + qs : win.location.pathname);
    rememberResults();
  }

  /* Lets a details page return to this exact result set. */
  function rememberResults() {
    try {
      sessionStorage.setItem(CFG.storage.lastResultsUrl,
        CFG.routes.listingPage + win.location.search);
    } catch (e) {}
  }
  rememberResults();

  /* ── view mode ──────────────────────────────────────────── */
  try { view = localStorage.getItem(CFG.storage.viewMode) || 'grid'; } catch (e) {}

  var toggle = doc.querySelector('.view-toggle');
  function applyView() {
    cardsEl.className = 'cards is-' + view;
    toggle.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
  }
  toggle.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-view]');
    if (!b) return;
    view = b.getAttribute('data-view');
    try { localStorage.setItem(CFG.storage.viewMode, view); } catch (err) {}
    applyView();
  });
  applyView();

  /* ── card component ─────────────────────────────────────── */
  var SPEC_IC = {
    bed:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-9M3 13h18v5M21 18v-4a3 3 0 0 0-3-3h-7v2"/><circle cx="7" cy="10" r="2"/></svg>',
    bath:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M6 12V6a2 2 0 0 1 3.6-1.2"/><path d="M9 6h2"/></svg>',
    car:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16h14M6.5 16v2M17.5 16v2"/><path d="M4 16v-3.5L6 8h12l2 4.5V16"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/></svg>',
    size:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M8 3v5H3M21 16h-5v5"/></svg>'
  };

  function spec(icon, text, off) {
    return '<span class="spec' + (off ? ' is-off' : '') + '">' + icon + text + '</span>';
  }

  function cardHTML(r) {
    var L = UI.links(r);
    var fav = UI.Favourites.has(r.id);
    var media =
      '<div class="pcard-media">' +
        UI.mediaFill(UI.cover(r), r.title) +
        '<span class="type-tag">' + UI.typeLabel(r.type) + '</span>' +
        '<button type="button" class="fav" data-fav="' + r.id + '" aria-pressed="' + fav + '" ' +
          'aria-label="Save to favourites">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 8.6c0 5-8.5 10.4-8.5 10.4S3.5 13.6 3.5 8.6A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8.5 2.6z"/></svg>' +
        '</button>' +
      '</div>';

    var body =
      '<div class="pcard-body">' +
        '<div class="price-row">' +
          '<span class="rent">PKR ' + UI.fmtPKR(r.rent) + ' <small>/ month</small></span>' +
          '<span class="advance">Advance <b>PKR ' + UI.fmtPKR(r.advance) + '</b></span>' +
        '</div>' +
        UI.badgeHTML(r.verified) +
        /* Only present on closest-match results, where the score is the
           reason this card ranks where it does. */
        (r.needsTotal
          ? '<span class="match-pill">Matches ' + r.needsMatched + ' of ' + r.needsTotal +
            ' requirements</span>'
          : '') +
        '<h2 class="pcard-title">' + r.title + '</h2>' +
        '<p class="pcard-loc">' + r.area + ', ' + r.city + '</p>' +
        '<p class="pcard-upd">Updated ' + UI.fmtRelative(r.updatedAt) + '</p>' +
        '<div class="specs">' +
          (r.beds ? spec(SPEC_IC.bed, r.beds + ' Bed') : '') +
          spec(SPEC_IC.bath, r.baths + ' Bath') +
          spec(SPEC_IC.car, r.carPorch ? 'Car Porch' : 'No Car Porch', !r.carPorch) +
          spec(SPEC_IC.size, UI.fmtSize(r)) +
        '</div>' +
      '</div>';

    var actions =
      '<div class="pcard-actions">' +
        '<a class="act is-wa" href="' + L.wa + '" target="_blank" rel="noopener" aria-label="WhatsApp">' +
          '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a9.9 9.9 0 0 0-8.5 15l-1.3 4.7 4.8-1.3A9.9 9.9 0 1 0 12 2zm0 1.8a8.1 8.1 0 1 1-4.1 15.1l-.3-.2-2.8.8.8-2.7-.2-.3A8.1 8.1 0 0 1 12 3.8zm-3 3.6c-.2 0-.5.1-.7.4-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.7 2.8 4.3 3.8 2.1.8 2.6.7 3 .6.5-.1 1.5-.6 1.7-1.3.2-.6.2-1.2.1-1.3l-.6-.3-1.5-.7c-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.6 6.6 0 0 1-3.3-2.9c-.1-.2 0-.4.1-.5l.5-.5.3-.5v-.5l-.7-1.6c-.2-.4-.4-.4-.5-.4z"/></svg>' +
        '</a>' +
        '<a class="act" href="' + L.tel + '" aria-label="Call">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>' +
        '</a>' +
        '<a class="act" href="' + L.mail + '" aria-label="Email">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg>' +
        '</a>' +
        '<a class="btn-details" href="' + L.details + '">Details' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>' +
        '</a>' +
      '</div>';

    return '<article class="pcard">' + media +
           (view === 'list' ? '<div class="pcard-wrap">' + body + actions + '</div>' : body + actions) +
           '</article>';
  }

  /* Favourites are delegated so re-renders never rebind. */
  cardsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fav]');
    if (!b) return;
    e.preventDefault();
    var on = UI.Favourites.toggle(b.getAttribute('data-fav'));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });

  /* ── states ─────────────────────────────────────────────── */
  function renderSkeletons() {
    var one = '<div class="skel"><div class="skel-media"></div>' +
      '<div class="skel-line w40"></div><div class="skel-line w70"></div><div class="skel-line w55"></div></div>';
    cardsEl.setAttribute('aria-busy', 'true');
    cardsEl.innerHTML = new Array(6).join(one) + one;
    pagerEl.innerHTML = '';
    bannerEl.innerHTML = '';
  }

  /* Reassuring rather than dead-end: a search with no result reads as
     work in progress, not as a failure. The Notify Me button and its
     data-notify-open hook are untouched. */
  function renderEmpty() {
    cardsEl.innerHTML =
      '<div class="empty" style="grid-column:1/-1">' +
        '<div class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.9"/></svg></div>' +
        '<h2>Under Process</h2>' +
        '<p>Want to be notified when a matching property is listed?<br>Click Notify Me and enter your email.</p>' +
        '<button class="btn-gold" type="button" data-notify-open>Notify Me</button>' +
      '</div>';
    pagerEl.innerHTML = '';
  }

  function renderBanner(n) {
    if (n === 0 || n > S.lowResultThreshold) { bannerEl.innerHTML = ''; return; }
    bannerEl.innerHTML =
      '<div class="notify-banner">' +
        '<span class="nb-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></span>' +
        '<div class="nb-text"><b>Only ' + n + ' match' + (n === 1 ? '' : 'es') + ' right now</b>' +
        '<span>Receive instant alerts whenever new matching properties are added.</span></div>' +
        '<button class="btn-gold" type="button" data-notify-open>Notify Me</button>' +
      '</div>';
  }

  /* ── pagination ─────────────────────────────────────────── */
  function renderPager(total) {
    var pages = Math.ceil(total / S.pageSize);
    if (pages <= 1) { pagerEl.innerHTML = ''; return; }

    var html = '<button type="button" data-page="' + (page - 1) + '"' + (page === 1 ? ' disabled' : '') + '>Prev</button>';
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - page) <= 1) {
        html += '<button type="button" data-page="' + i + '"' +
                (i === page ? ' aria-current="page"' : '') + '>' + i + '</button>';
      } else if (Math.abs(i - page) === 2) {
        html += '<button type="button" disabled>…</button>';
      }
    }
    html += '<button type="button" data-page="' + (page + 1) + '"' + (page === pages ? ' disabled' : '') + '>Next</button>';
    pagerEl.innerHTML = html;
  }

  pagerEl.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-page]');
    if (!b || b.disabled) return;
    page = Number(b.getAttribute('data-page'));
    paint();
    win.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── render ─────────────────────────────────────────────── */
  function paint() {
    var start = (page - 1) * S.pageSize;
    var slice = results.slice(start, start + S.pageSize);
    cardsEl.setAttribute('aria-busy', 'false');
    cardsEl.innerHTML = slice.map(cardHTML).join('');
    /* stagger the entrance without a per-card timer */
    cardsEl.querySelectorAll('.pcard').forEach(function (el, i) {
      el.style.animationDelay = Math.min(i * 45, 320) + 'ms';
    });
    renderPager(results.length);
  }

  function headline() {
    var where = criteria.area
      ? locAreaName + (locCityName ? ', ' + locCityName : '')
      : (locCityName || 'Pakistan');
    $('resTitle').textContent = 'Properties for Rent in ' + where;
    if (isClosest) {
      $('resCount').textContent = results.length + ' closest ' +
        (results.length === 1 ? 'match' : 'matches');
      return;
    }
    $('resCount').textContent = results.length
      ? results.length + ' verified & listed ' + (results.length === 1 ? 'property' : 'properties')
      : 'No properties found';
  }

  /* Sits directly above the grid so the distinction between "these match
     what you asked for" and "these are the nearest we have" is never
     ambiguous. Cleared on any search that produced exact matches. */
  function renderClosestNotice() {
    var host = $('closestNotice');
    if (!host) return;
    if (!isClosest) { host.innerHTML = ''; host.hidden = true; return; }
    var total = DATA.needList(criteria.needs).length;
    host.hidden = false;
    host.innerHTML =
      '<div class="closest-note">' +
        '<b>No property currently matches all your requirements.</b>' +
        '<span>Showing the closest matches, ranked by how many of your ' +
          total + ' requirement' + (total === 1 ? '' : 's') + ' each one meets.</span>' +
      '</div>';
  }

  function load() {
    page = 1;
    renderSkeletons();
    /* Local data resolves instantly; the delay exercises the loading
       state and disappears when a real API supplies latency. */
    setTimeout(function () {
      results = DATA.query(criteria);
      isClosest = false;

      /* Nothing satisfies every selected requirement: rather than an
         empty page, fall back to the ranked partial matches. Only
         reachable when requirements were actually selected, so ordinary
         no-result searches still show the normal empty state. */
      if (!results.length && DATA.needList(criteria.needs).length) {
        var near = DATA.closest(criteria);
        if (near.length) { results = near; isClosest = true; }
      }

      headline();
      renderClosestNotice();
      renderBanner(isClosest ? 0 : results.length);
      if (!results.length) { cardsEl.setAttribute('aria-busy', 'false'); renderEmpty(); return; }
      paint();
    }, S.simulatedLatencyMs);
  }

  $('yr').textContent = new Date().getFullYear();
  load();
})(window, document);
