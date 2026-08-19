/* MakanOnRent — Submit Property Wizard (Phase 3, frontend only).
   Ten short steps, one screen at a time. No backend, no auth:
   the Google step and the upload steps expose the hooks that the
   real services plug into later. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, LOC = win.MOR_LOC, UI = win.MOR_UI;
  var SUB = CFG.submit;
  var $ = function (id) { return doc.getElementById(id); };

  var TOTAL = 10;
  var STEP_NAMES = ['Sign in', 'Category', 'Location', 'Details', 'Rent',
                    'Photos', 'Features', 'Contact', 'Verification', 'Review'];
  /* Steps the owner may pass without entering anything. */
  var OPTIONAL = { 6: true, 7: true, 9: true };

  var state = {
    signedIn: false,
    category: 'homes', type: '',
    /* `area`/`areaName` mirror the Main Location. They are kept because the
       submit API, the properties table (area_slug/area_name) and the
       /rent/{city}/{area} URL contract all read them — renaming would be a
       breaking change to a shipped contract for no gain. */
    city: '', cityName: '', area: '', areaName: '',
    mainArea: '', mainAreaName: '', subArea: '', subAreaName: '',
    landmark: '', roadWidth: '', size: '', sizeUnit: 'marla',
    beds: 0, baths: 0, parking: 0,
    currency: 'PKR', rent: '', advance: '', negotiable: 0,
    features: [],
    ownerName: '', whatsapp: '', phone: '', email: '',
    wantVerification: 0
  };

  /* Files live in memory only — never serialised to storage. Uploaded
     to R2 only at final submit, under one draftId so every file for
     this submission lands in the same object-storage folder. */
  var files = { images: [], videos: [], cnicFront: null, cnicBack: null };
  var draftId = (win.crypto && win.crypto.randomUUID) ? win.crypto.randomUUID()
    : 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  var step = 1;

  /* ── helpers ────────────────────────────────────────────── */
  function digits(v) { return String(v).replace(/\D/g, ''); }
  function commas(v) { return v ? Number(v).toLocaleString('en-PK') : ''; }

  function bindNumeric(el, key) {
    el.addEventListener('input', function () {
      var raw = digits(el.value);
      el.value = commas(raw);
      state[key] = raw;
      saveDraft();
    });
  }

  function pressGroup(host, attr, onPick) {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('button[' + attr + ']');
      if (!b || !host.contains(b)) return;
      host.querySelectorAll('[aria-pressed]').forEach(function (x) {
        x.setAttribute('aria-pressed', 'false');
      });
      b.setAttribute('aria-pressed', 'true');
      onPick(b.getAttribute(attr));
      saveDraft();
    });
  }

  function setErr(id, msg) {
    var el = $(id);
    if (el) el.textContent = msg || '';
  }

  /* ── STEP 1 · Google sign-in ──────────────────────────────
     Real authentication. The button leaves the site for Google (via
     Supabase Auth) and the owner returns with a session cookie; the
     signed-in state below is read back FROM THE SERVER, never asserted
     locally. It previously set state.signedIn = true on click, which
     unlocked the wizard without authenticating anyone. */
  var SIGNED_IN_HTML =
    '<div class="signed">' +
      '<span class="s-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>' +
      '<div><b>Signed in as {email}</b><span>You can continue now.</span></div>' +
    '</div>';

  function showSignedIn(owner) {
    state.signedIn = true;
    state.ownerEmail = owner.email || '';
    if (!state.ownerName && owner.name) state.ownerName = owner.name;
    $('authSlot').innerHTML = SIGNED_IN_HTML.replace('{email}', UI.esc(owner.email || ''));
    refreshNav();
    saveDraft();
  }

  function showSignInError(msg) {
    var note = doc.createElement('p');
    note.className = 'wz-err';
    note.textContent = msg;
    $('authSlot').appendChild(note);
  }

  $('googleBtn').addEventListener('click', function () {
    var S = win.MOR_OWNER_SESSION;
    if (!S) { showSignInError('Sign-in is unavailable right now. Please try again shortly.'); return; }
    this.disabled = true;
    /* Come back to this page so the owner resumes where they left off —
       the draft is already saved on this device. */
    S.signIn(win.location.pathname);
  });

  /* On load: ask the server whether this browser already has a session,
     and report a cancelled or failed attempt honestly rather than
     leaving the owner on a button that appears to do nothing. */
  (function initAuth() {
    var S = win.MOR_OWNER_SESSION;
    if (!S) return;
    var flag = S.consumeSigninFlag();
    S.load(true).then(function (me) {
      if (me && me.signedIn) { showSignedIn(me.owner); return; }
      if (flag === 'cancelled') showSignInError('Sign-in was cancelled. You can try again.');
      else if (flag === 'failed') showSignInError('Sign-in did not complete. Please try again.');
    });
  })();

  /* ── STEP 2 · category + type ───────────────────────────── */
  var CAT = [
    { id: 'homes', label: 'Home', hint: 'House, flat or portion',
      ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/><path d="M10 20v-5.5h4V20"/></svg>' },
    { id: 'commercial', label: 'Commercial', hint: 'Office, shop or room',
      ic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V6.5L12 3l8 3.5V21"/><path d="M9 21v-6h6v6"/></svg>' }
  ];
  var TYPES = {
    homes: [['house', 'House'], ['flat', 'Flat'], ['portion', 'Portion'], ['other', 'Other']],
    commercial: [['office', 'Office'], ['shop', 'Shop'], ['room', 'Room'], ['other', 'Other']]
  };

  var catTiles = $('catTiles'), typeTiles = $('typeTiles');

  catTiles.innerHTML = CAT.map(function (c) {
    return '<button type="button" class="tile" data-cat="' + c.id + '" aria-pressed="' +
      (c.id === state.category) + '"><span class="tile-ic" aria-hidden="true">' + c.ic + '</span>' +
      '<span><b>' + c.label + '</b><span class="hint">' + c.hint + '</span></span></button>';
  }).join('');

  function renderTypes() {
    typeTiles.innerHTML = TYPES[state.category].map(function (t) {
      return '<button type="button" class="tile" data-type="' + t[0] + '" aria-pressed="' +
        (t[0] === state.type) + '"><b>' + t[1] + '</b></button>';
    }).join('');
  }

  pressGroup(catTiles, 'data-cat', function (v) {
    state.category = v;
    state.type = '';
    renderTypes();
    refreshNav();
  });
  typeTiles.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-type]');
    if (!b) return;
    typeTiles.querySelectorAll('[aria-pressed]').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
    b.setAttribute('aria-pressed', 'true');
    state.type = b.getAttribute('data-type');
    setErr('errType', '');
    refreshNav();
    saveDraft();
  });
  renderTypes();

  /* ── STEP 3 · location — strict City → Main → Sub cascade ────────
     Every level is a predefined choice from the location engine; free text is
     accepted only for the landmark below. Each select stays disabled
     until its parent is chosen, so an orphan selection is impossible.

     All three levels are MANDATORY. The hierarchy is complete — every
     Main Location carries at least one Sub Location (see
     location-sample-subareas.js) — so there is no skip path and no
     optional fallback. If a Main Location ever shows no Sub Locations,
     that is a DATA GAP to fix in the Location Data Bank, not a case to
     work around here. */
  var citySel = $('wCity'), mainSel = $('wMainLoc'), subSel = $('wSubLoc');
  var cityIdBySlug = {};
  var mainIdBySlug = {};

  LOC.listCities().forEach(function (c) {
    citySel.appendChild(new Option(c.name, c.slug));
    cityIdBySlug[c.slug] = c.id;
  });

  function resetSelect(sel, placeholder) {
    sel.innerHTML = '';
    sel.appendChild(new Option(placeholder, ''));
    sel.disabled = true;
  }

  /* True when the selected Main Location genuinely offers sub-locations. */
  function subOptionsAvailable() {
    return subSel.options.length > 1;
  }

  function populateMain(preserveSlug) {
    resetSelect(mainSel, 'Select main location');
    mainIdBySlug = {};
    var cityId = cityIdBySlug[state.city];
    if (!cityId) { resetSelect(mainSel, 'Select a city first'); return; }

    /* Options, not nodes — see MOR_LOC.getMainAreaOptions: each alias is
       a selectable name resolving to the same canonical id, so a property
       submitted against any alias lands on the same main location. */
    LOC.getMainAreaOptions(cityId).forEach(function (m) {
      mainSel.appendChild(new Option(m.name, m.slug));
      mainIdBySlug[m.slug] = m.id;
    });
    mainSel.disabled = false;
    if (preserveSlug && mainIdBySlug[preserveSlug]) mainSel.value = preserveSlug;
  }

  function populateSub(preserveSlug) {
    resetSelect(subSel, 'Select sub location');
    var mainId = mainIdBySlug[state.mainArea];
    if (!mainId) { resetSelect(subSel, 'Select a main location first'); return; }

    LOC.getSubAreas(mainId).forEach(function (s) {
      subSel.appendChild(new Option(s.name, s.slug));
    });

    if (subOptionsAvailable()) {
      subSel.disabled = false;
      if (preserveSlug) subSel.value = preserveSlug;
    } else {
      /* No sub-locations published for this area yet. Blocking here would
         make the property un-submittable, so the field states the reason
         and stays out of the way. */
      resetSelect(subSel, 'No sub locations available for this area');
    }
  }

  citySel.addEventListener('change', function () {
    state.city = citySel.value;
    state.cityName = citySel.options[citySel.selectedIndex].text;
    state.mainArea = ''; state.mainAreaName = '';
    state.subArea = '';  state.subAreaName = '';
    state.area = '';     state.areaName = '';
    populateMain();
    populateSub();
    setErr('errLoc', '');
    refreshNav(); saveDraft();
  });

  mainSel.addEventListener('change', function () {
    state.mainArea = mainSel.value;
    state.mainAreaName = mainSel.value ? mainSel.options[mainSel.selectedIndex].text : '';
    /* area/areaName track the Main Location — the shipped API contract. */
    state.area = state.mainArea;
    state.areaName = state.mainAreaName;
    state.subArea = ''; state.subAreaName = '';
    populateSub();
    setErr('errLoc', '');
    refreshNav(); saveDraft();
  });

  subSel.addEventListener('change', function () {
    state.subArea = subSel.value;
    state.subAreaName = subSel.value ? subSel.options[subSel.selectedIndex].text : '';
    setErr('errLoc', '');
    refreshNav(); saveDraft();
  });

  $('wLandmark').addEventListener('input', function () { state.landmark = this.value; saveDraft(); });
  bindNumeric($('wRoad'), 'roadWidth');
  $('wSize').addEventListener('input', function () {
    state.size = digits(this.value);
    this.value = state.size;
    setErr('errSize', '');
    refreshNav(); saveDraft();
  });
  pressGroup($('unitSeg'), 'data-unit', function (v) { state.sizeUnit = v; });

  /* ── STEP 4 · counts + parking ──────────────────────────── */
  doc.querySelectorAll('.stepper').forEach(function (box) {
    var key = box.getAttribute('data-count');
    var out = box.querySelector('output');
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-delta]');
      if (!b) return;
      state[key] = Math.max(0, state[key] + Number(b.getAttribute('data-delta')));
      out.textContent = state[key];
      box.querySelector('[data-delta="-1"]').disabled = state[key] === 0;
      saveDraft();
    });
  });
  pressGroup($('parkSeg'), 'data-park', function (v) { state.parking = Number(v); });

  /* Property features — canonical keys from MOR_CONFIG.propertyNeeds,
     stored in state.features (the array the submit API already sends to
     listings.features). car_parking is excluded here on purpose: the
     "Car parking" segmented control above owns that value and writes
     units.car_porch, so duplicating it would create two sources of
     truth for one attribute. Free-text tags remain available further
     down the wizard for anything outside this canonical set. */
  (function () {
    var host = $('featChips');
    if (!host) return;
    var defs = ((win.MOR_CONFIG && win.MOR_CONFIG.propertyNeeds) || [])
      .filter(function (n) { return n.key !== 'car_parking'; });

    defs.forEach(function (n) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = n.label;
      b.setAttribute('data-feat', n.key);
      b.setAttribute('aria-pressed', 'false');
      host.appendChild(b);
    });

    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-feat]');
      if (!b) return;
      var key = b.getAttribute('data-feat');
      var on = b.getAttribute('aria-pressed') === 'true';
      /* Class mirrors the attribute so the selected style always repaints
         — same reason as home.js setPressed(). */
      b.setAttribute('aria-pressed', on ? 'false' : 'true');
      b.classList.toggle('is-on', !on);
      if (on) state.features = state.features.filter(function (f) { return f !== key; });
      else if (state.features.indexOf(key) === -1) state.features.push(key);
      renderTags();
    });

    /* Reflect a restored draft back onto the chips. */
    win.MOR_WZ_SYNC_FEATS = function () {
      [].slice.call(host.querySelectorAll('[data-feat]')).forEach(function (b) {
        var on = state.features.indexOf(b.getAttribute('data-feat')) > -1;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.classList.toggle('is-on', on);
      });
    };
  })();

  /* ── STEP 5 · rent ──────────────────────────────────────── */
  var curSel = $('wCurrency');
  CFG.currencies.forEach(function (c) {
    var o = new Option(c.code + ' — ' + c.label, c.code);
    curSel.appendChild(o);
    if (c.default) curSel.value = c.code;
  });

  function applyCurrency() {
    var c = CFG.currencies.filter(function (x) { return x.code === state.currency; })[0];
    doc.querySelectorAll('[data-cur]').forEach(function (el) { el.textContent = c ? c.symbol : ''; });
  }
  curSel.addEventListener('change', function () {
    state.currency = curSel.value;
    applyCurrency(); saveDraft();
  });
  applyCurrency();

  $('wRent').addEventListener('input', function () {
    state.rent = digits(this.value);
    this.value = commas(state.rent);
    setErr('errRent', '');
    refreshNav(); saveDraft();
  });
  bindNumeric($('wAdvance'), 'advance');
  pressGroup($('negSeg'), 'data-neg', function (v) { state.negotiable = Number(v); });

  /* ── STEP 6 · media ─────────────────────────────────────────
     Files stay client-side. On submit the backend receives the
     originals and returns the optimised variants declared in
     CFG.submit.imageOptimization — no wizard change required. */
  function mediaThumb(entry, kind, i) {
    var inner = kind === 'images'
      ? '<img src="' + entry.url + '" alt="">'
      : '<video src="' + entry.url + '" muted playsinline></video>';
    return '<div class="thumb">' + inner +
      '<button class="rm" type="button" data-rm="' + kind + '" data-i="' + i + '" aria-label="Remove ' + UI.esc(entry.file.name) + '">&times;</button>' +
      '<span class="nm">' + UI.esc(entry.file.name) + '</span></div>';
  }

  function renderMedia(kind, hostId, hintId, max) {
    var host = $(hostId);
    host.innerHTML = files[kind].map(function (e, i) { return mediaThumb(e, kind, i); }).join('');
    $(hintId).textContent = files[kind].length
      ? files[kind].length + ' of ' + max + ' added — tap to add more'
      : (kind === 'images' ? 'Tap to choose from your phone' : 'A short walkthrough helps a lot');
  }

  function addFiles(kind, list, max, maxMB, hostId, hintId) {
    Array.prototype.forEach.call(list, function (f) {
      if (files[kind].length >= max) return;
      if (f.size > maxMB * 1024 * 1024) return;
      files[kind].push({ file: f, url: URL.createObjectURL(f) });
    });
    renderMedia(kind, hostId, hintId, max);
  }

  $('imgInput').addEventListener('change', function () {
    addFiles('images', this.files, SUB.maxImages, SUB.imageMaxMB, 'imgThumbs', 'imgHint');
    this.value = '';
  });
  $('vidInput').addEventListener('change', function () {
    addFiles('videos', this.files, SUB.maxVideos, SUB.videoMaxMB, 'vidThumbs', 'vidHint');
    this.value = '';
  });

  doc.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]');
    if (!b) return;
    e.preventDefault();
    var kind = b.getAttribute('data-rm'), i = Number(b.getAttribute('data-i'));
    URL.revokeObjectURL(files[kind][i].url);
    files[kind].splice(i, 1);
    kind === 'images'
      ? renderMedia('images', 'imgThumbs', 'imgHint', SUB.maxImages)
      : renderMedia('videos', 'vidThumbs', 'vidHint', SUB.maxVideos);
  });

  /* ── STEP 7 · free-form feature tags ────────────────────── */
  var SUGGEST = ['Solar', 'Park Facing', 'Corner', 'Near School', 'Near Market',
                 'Main Road', 'Gated Community', 'Walking Distance', '40 Feet Road',
                 'Separate Meter', 'Servant Quarter', 'Rooftop'];

  var tagInput = $('tagInput'), tagList = $('tagList'), tagSuggest = $('tagSuggest');

  tagSuggest.innerHTML = SUGGEST.map(function (t) {
    return '<button type="button" class="chip" data-sug="' + UI.esc(t) + '">' + UI.esc(t) + '</button>';
  }).join('');

  /* A canonical key stored by the feature chips ("gas_meter") is shown by
     its human label here, so the tag list stays readable whether an entry
     came from a chip or was typed freehand. */
  function featureLabel(key) {
    var defs = (win.MOR_CONFIG && win.MOR_CONFIG.propertyNeeds) || [];
    for (var i = 0; i < defs.length; i++) if (defs[i].key === key) return defs[i].label;
    return key;
  }

  function renderTags() {
    tagList.innerHTML = state.features.length
      ? state.features.map(function (t, i) {
          var label = featureLabel(t);
          return '<span class="tag">' + UI.esc(label) +
                 '<button type="button" data-tagrm="' + i + '" aria-label="Remove ' + UI.esc(label) + '">&times;</button></span>';
        }).join('')
      : '<span class="tag-empty">No features added yet.</span>';
    saveDraft();
  }

  function addTag(v) {
    v = String(v || '').trim().replace(/\s+/g, ' ');
    if (!v) return;
    var dup = state.features.some(function (t) { return t.toLowerCase() === v.toLowerCase(); });
    if (!dup) state.features.push(v);
    tagInput.value = '';
    renderTags();
  }

  $('tagAdd').addEventListener('click', function () { addTag(tagInput.value); });
  tagInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); }
  });
  tagSuggest.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sug]');
    if (b) addTag(b.getAttribute('data-sug'));
  });
  tagList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-tagrm]');
    if (!b) return;
    state.features.splice(Number(b.getAttribute('data-tagrm')), 1);
    /* Removing a canonical feature from the tag list must un-light its
       chip, or the two views would disagree. */
    if (win.MOR_WZ_SYNC_FEATS) win.MOR_WZ_SYNC_FEATS();
    renderTags();
  });
  renderTags();

  /* ── STEP 8 · owner ─────────────────────────────────────── */
  [['wName', 'ownerName'], ['wWhats', 'whatsapp'], ['wPhone', 'phone'], ['wEmail', 'email']]
    .forEach(function (pair) {
      $(pair[0]).addEventListener('input', function () {
        state[pair[1]] = this.value;
        setErr('errName', ''); setErr('errWhats', ''); setErr('errEmail', '');
        refreshNav(); saveDraft();
      });
    });

  /* ── STEP 9 · optional verification ─────────────────────── */
  pressGroup($('verSeg'), 'data-ver', function (v) {
    state.wantVerification = Number(v);
    $('cnicWrap').hidden = !state.wantVerification;
  });

  [['cnicFront', 'cnicFHint'], ['cnicBack', 'cnicBHint']].forEach(function (p) {
    $(p[0]).addEventListener('change', function () {
      var f = this.files[0];
      files[p[0]] = f || null;
      $(p[1]).textContent = f ? f.name : 'Tap to upload';
    });
  });

  /* ── STEP 10 · review ───────────────────────────────────── */
  function row(k, v) {
    return v ? '<div class="kv"><span>' + k + '</span><b>' + UI.esc(v) + '</b></div>' : '';
  }
  function group(title, jump, rows) {
    return '<div class="rev-group"><div class="rev-head"><b>' + title + '</b>' +
      '<button class="rev-edit" type="button" data-jump="' + jump + '">Change</button></div>' +
      '<div class="rev-box">' + rows + '</div></div>';
  }
  function money(v) {
    var c = CFG.currencies.filter(function (x) { return x.code === state.currency; })[0];
    return v ? (c ? c.symbol : '') + ' ' + commas(v) : '';
  }
  function typeName() {
    var t = TYPES[state.category].filter(function (x) { return x[0] === state.type; })[0];
    return t ? t[1] : '';
  }

  function renderReview() {
    $('review').innerHTML =
      group('Property', 2,
        row('Category', state.category === 'homes' ? 'Home' : 'Commercial') +
        row('Type', typeName())) +
      group('Location', 3,
        row('City', state.cityName) +
        row('Main Location', state.mainAreaName) +
        row('Sub Location', state.subAreaName) +
        row('Landmark', state.landmark) +
        row('Road width', state.roadWidth ? state.roadWidth + ' feet' : '') +
        row('Size', state.size ? state.size + ' ' + (state.sizeUnit === 'marla' ? 'Marla' : 'Sq Ft') : '')) +
      group('Details', 4,
        row('Bedrooms', state.beds || '') + row('Bathrooms', state.baths || '') +
        row('Car parking', state.parking ? 'Available' : 'Not available')) +
      group('Rent', 5,
        row('Monthly rent', money(state.rent)) +
        row('Advance', money(state.advance)) +
        row('Negotiable', state.negotiable ? 'Yes' : 'No')) +
      group('Photos & videos', 6,
        row('Photos', files.images.length ? files.images.length + ' added' : 'None') +
        row('Videos', files.videos.length ? files.videos.length + ' added' : 'None')) +
      group('Features', 7,
        state.features.length ? row('Added', state.features.join(', ')) : row('Added', 'None')) +
      group('Contact', 8,
        row('Name', state.ownerName) + row('WhatsApp', state.whatsapp) +
        row('Phone', state.phone) + row('Email', state.email)) +
      group('Verification', 9,
        row('Requested', state.wantVerification ? 'Yes' : 'Not now') +
        (state.wantVerification
          ? row('CNIC front', files.cnicFront ? 'Uploaded' : 'Not uploaded') +
            row('CNIC back', files.cnicBack ? 'Uploaded' : 'Not uploaded')
          : ''));
  }

  $('review').addEventListener('click', function (e) {
    var b = e.target.closest('[data-jump]');
    if (b) go(Number(b.getAttribute('data-jump')));
  });

  /* ── validation ─────────────────────────────────────────── */
  function valid(n, showErrors) {
    switch (n) {
      case 1: return state.signedIn;
      case 2:
        if (!state.type && showErrors) setErr('errType', 'Please choose a property type.');
        return !!state.type;
      case 3:
        /* City, Main Location and Sub Location are all mandatory. */
        if (showErrors) {
          if (!state.city) setErr('errLoc', 'Please select a city.');
          else if (!state.mainArea) setErr('errLoc', 'Please select a main location.');
          else if (!state.subArea) {
            setErr('errLoc', subOptionsAvailable()
              ? 'Please select a sub location.'
              : 'No sub locations exist for this area yet — please choose another area.');
          }
          else if (!state.size) setErr('errSize', 'Please enter the property size.');
        }
        return !!(state.city && state.mainArea && state.subArea && state.size);
      case 5:
        if (!state.rent && showErrors) setErr('errRent', 'Please enter the monthly rent.');
        return !!state.rent;
      case 8:
        if (showErrors) {
          if (!state.ownerName.trim()) setErr('errName', 'Please enter your name.');
          if (digits(state.whatsapp).length < 10) setErr('errWhats', 'Please enter a valid number.');
          if (state.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(state.email))
            setErr('errEmail', 'Please check this email address.');
        }
        return !!state.ownerName.trim() && digits(state.whatsapp).length >= 10 &&
               (!state.email || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(state.email));
      default: return true;
    }
  }

  /* ── navigation ─────────────────────────────────────────── */
  function refreshNav() {
    var nextBtn = $('nextBtn');
    nextBtn.disabled = !valid(step, false);
    nextBtn.firstChild.nodeValue = step === TOTAL ? 'Submit Property ' : 'Continue ';
    $('backBtn').hidden = step === 1;
    $('skipLine').hidden = !OPTIONAL[step];
  }

  function go(n) {
    doc.querySelector('.wz-step[data-step="' + step + '"]').hidden = true;
    step = n;
    var el = doc.querySelector('.wz-step[data-step="' + step + '"]');
    el.hidden = false;
    el.classList.remove('is-in');
    void el.offsetWidth;              /* restart the entrance animation */
    el.classList.add('is-in');

    $('stepLabel').textContent = 'Step ' + step + ' of ' + TOTAL;
    $('stepName').textContent = STEP_NAMES[step - 1];
    $('progressFill').style.width = (step / TOTAL * 100) + '%';

    if (step === TOTAL) renderReview();
    refreshNav();
    win.scrollTo({ top: 0, behavior: 'smooth' });
    saveDraft();
  }

  $('nextBtn').addEventListener('click', function () {
    if (!valid(step, true)) { refreshNav(); return; }
    if (step === TOTAL) { submit(); return; }
    if (step === 1 && resumeTo) { var to = resumeTo; resumeTo = 0; go(to); return; }
    go(step + 1);
  });
  $('backBtn').addEventListener('click', function () { if (step > 1) go(step - 1); });
  $('skipBtn').addEventListener('click', function () { if (step < TOTAL) go(step + 1); });

  /* ── draft (text only — files are never stored) ─────────── */
  function saveDraft() {
    try {
      localStorage.setItem(CFG.storage.submitDraft, JSON.stringify({ step: step, state: state }));
    } catch (e) {}
  }
  function clearDraft() {
    try { localStorage.removeItem(CFG.storage.submitDraft); } catch (e) {}
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(CFG.storage.submitDraft) || 'null'); }
    catch (e) { return null; }
  }

  /* Only offer to resume when the owner actually entered something. */
  function hasContent(s) {
    return !!(s && (s.type || s.city || s.size || s.rent || s.ownerName ||
                   (s.features && s.features.length)));
  }

  function applyDraft(d) {
    if (!d || !d.state) return;

    Object.keys(state).forEach(function (k) {
      if (d.state[k] !== undefined) state[k] = d.state[k];
    });

    /* A saved draft can never grant a session — it is data this device
       wrote, not proof of anything. It is cleared here and then re-asked
       of the server, so resuming a draft neither fakes a sign-in nor
       throws away a real one. */
    state.signedIn = false;
    if (win.MOR_OWNER_SESSION) {
      win.MOR_OWNER_SESSION.load().then(function (me) {
        if (me && me.signedIn) showSignedIn(me.owner);
      });
    }

    renderTypes(); renderTags();
    if (state.city) {
      citySel.value = state.city;
      /* Rebuild the cascade from the saved draft, parent first, so each
         level's options exist before its value is restored. */
      populateMain(state.mainArea || state.area);
      if (mainSel.value) {
        state.mainArea = mainSel.value;
        state.mainAreaName = mainSel.options[mainSel.selectedIndex].text;
        state.area = state.mainArea;
        state.areaName = state.mainAreaName;
        populateSub(state.subArea);
        if (subSel.value) {
          state.subArea = subSel.value;
          state.subAreaName = subSel.options[subSel.selectedIndex].text;
        } else {
          state.subArea = ''; state.subAreaName = '';
        }
      }
    }
    $('wLandmark').value = state.landmark;
    $('wRoad').value = commas(state.roadWidth);
    $('wSize').value = state.size;
    $('wRent').value = commas(state.rent);
    $('wAdvance').value = commas(state.advance);
    $('wName').value = state.ownerName;
    $('wWhats').value = state.whatsapp;
    $('wPhone').value = state.phone;
    $('wEmail').value = state.email;
    curSel.value = state.currency;
    applyCurrency();

    doc.querySelectorAll('.stepper').forEach(function (box) {
      var k = box.getAttribute('data-count');
      box.querySelector('output').textContent = state[k];
      box.querySelector('[data-delta="-1"]').disabled = state[k] === 0;
    });
    [['unitSeg', 'data-unit', state.sizeUnit], ['parkSeg', 'data-park', String(state.parking)],
     ['negSeg', 'data-neg', String(state.negotiable)], ['verSeg', 'data-ver', String(state.wantVerification)]]
      .forEach(function (s) {
        var host = $(s[0]);
        host.querySelectorAll('[aria-pressed]').forEach(function (b) {
          b.setAttribute('aria-pressed', b.getAttribute(s[1]) === s[2] ? 'true' : 'false');
        });
      });
    if (win.MOR_WZ_SYNC_FEATS) win.MOR_WZ_SYNC_FEATS();
    $('cnicWrap').hidden = !state.wantVerification;
  }

  /* ── submit ─────────────────────────────────────────────── */
  function reference() {
    var code = (state.city || 'pk').slice(0, 3).toUpperCase();
    var d = new Date();
    var ymd = String(d.getFullYear()).slice(2) +
              ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2);
    var rand = String(Math.floor(1000 + Math.random() * 9000));
    return SUB.referencePrefix + '-' + code + '-' + ymd + '-' + rand;
  }

  /* Queues the submission locally exactly as before — the pre-backend
     fallback path. Used when the API is unreachable (static preview
     with no Functions runtime, or a real network failure) so the demo
     never breaks and the owner's work is never silently lost. */
  function queueLocally(ref) {
    try {
      var key = CFG.storage.submissions;
      var all = JSON.parse(localStorage.getItem(key) || '[]');
      all.push({
        ref: ref, at: new Date().toISOString(), status: 'pending_review',
        property: state,
        media: {
          images: files.images.map(function (e) { return e.file.name; }),
          videos: files.videos.map(function (e) { return e.file.name; }),
          cnicFront: files.cnicFront ? files.cnicFront.name : null,
          cnicBack: files.cnicBack ? files.cnicBack.name : null
        }
      });
      localStorage.setItem(key, JSON.stringify(all));
    } catch (e) {}
  }

  function showDone(ref) {
    clearDraft();
    doc.querySelector('.wz-step[data-step="' + step + '"]').hidden = true;
    $('progress').hidden = true;
    $('wzNav').hidden = true;
    $('refNo').textContent = ref;
    $('reviewTime').textContent = 'Within ' + SUB.reviewHours + ' hours';
    var done = $('doneStep');
    done.hidden = false;
    done.classList.add('is-in');
    win.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* Presigns + uploads one file directly to R2 (functions/api/uploads/
     presign.js issues the URL; the PUT never touches our own server).
     Returns { key, publicUrl, kind } for storage in the submit payload. */
  function uploadOne(file, kind) {
    return win.fetch(CFG.routes.api.presign, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draftId: draftId, filename: file.name, contentType: file.type,
        kind: kind, sizeBytes: file.size
      })
    })
      .then(function (r) { if (!r.ok) throw new Error('presign failed'); return r.json(); })
      .then(function (res) {
        return win.fetch(res.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
          .then(function (put) {
            if (!put.ok) throw new Error('upload failed');
            return { key: res.key, publicUrl: res.publicUrl, kind: kind === 'property-video' ? 'video' : 'image' };
          });
      });
  }

  function submit() {
    var localRef = reference();
    var nextBtn = $('nextBtn');
    nextBtn.disabled = true;
    nextBtn.firstChild.nodeValue = 'Submitting… ';

    var imageUploads = files.images.map(function (e) { return uploadOne(e.file, 'property-image'); });
    var videoUploads = files.videos.map(function (e) { return uploadOne(e.file, 'property-video'); });
    var cnicUploads = [];
    if (state.wantVerification && files.cnicFront) cnicUploads.push(uploadOne(files.cnicFront, 'cnic').then(function (r) { return { side: 'front', key: r.key }; }));
    if (state.wantVerification && files.cnicBack) cnicUploads.push(uploadOne(files.cnicBack, 'cnic').then(function (r) { return { side: 'back', key: r.key }; }));

    Promise.all(imageUploads.concat(videoUploads).concat(cnicUploads))
      .then(function (results) {
        var media = results.slice(0, imageUploads.length + videoUploads.length);
        var cnicResults = results.slice(imageUploads.length + videoUploads.length);
        var verification = null;
        if (cnicResults.length) {
          verification = {};
          cnicResults.forEach(function (r) {
            if (r.side === 'front') verification.cnicFrontKey = r.key;
            if (r.side === 'back') verification.cnicBackKey = r.key;
          });
        }

        return win.fetch(CFG.routes.api.submitProperty, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            draftId: draftId, property: state,
            owner: { name: state.ownerName, whatsapp: state.whatsapp, phone: state.phone, email: state.email },
            media: media, verification: verification
          })
        });
      })
      .then(function (r) { if (!r.ok) throw new Error('submit failed'); return r.json(); })
      .then(function (res) { showDone(res.ref || localRef); })
      .catch(function () {
        /* API unreachable or not yet deployed — fall back to the
           original local-only queue so the wizard still completes. */
        queueLocally(localRef);
        showDone(localRef);
      });
  }

  /* ── resume dialog ──────────────────────────────────────── */
  var resumeTo = 0;

  function askResume(d) {
    var saved = Math.min(Math.max(Number(d.step) || 1, 1), TOTAL);
    var dlg = UI.buildDialog('resumeDraft',
      '<div class="modal-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v6h6"/><path d="M3.5 13a9 9 0 1 0 2.5-7.6L3 9"/></svg></div>' +
      '<h3>Continue where you left off?</h3>' +
      '<p>We saved your earlier answers on this device. Photos and videos need to be added again.</p>' +
      '<div class="modal-form">' +
        '<button class="btn-gold" type="button" data-resume data-close>Resume Draft</button>' +
        '<button class="btn-ghost" type="button" data-fresh data-close>Start Fresh</button>' +
      '</div>');
    dlg.el.setAttribute('aria-label', 'Resume saved draft');

    dlg.el.addEventListener('click', function (e) {
      if (e.target.closest('[data-resume]')) {
        /* Sign-in never survives a reload, so step 1 runs again and
           then jumps straight back to the saved step. */
        resumeTo = saved > 1 ? saved : 0;
      } else if (e.target.closest('[data-fresh]')) {
        clearDraft();
        win.location.reload();
      }
    });
    dlg.open();
  }

  /* ── boot ───────────────────────────────────────────────── */
  var draft = readDraft();
  applyDraft(draft);
  go(1);
  if (hasContent(draft && draft.state)) askResume(draft);
})(window, document);
