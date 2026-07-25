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
    city: '', cityName: '', area: '', areaName: '',
    landmark: '', roadWidth: '', size: '', sizeUnit: 'marla',
    beds: 0, baths: 0, parking: 0,
    currency: 'PKR', rent: '', advance: '', negotiable: 0,
    features: [],
    ownerName: '', whatsapp: '', phone: '', email: '',
    wantVerification: 0
  };

  /* Files live in memory only — never serialised to storage. */
  var files = { images: [], videos: [], cnicFront: null, cnicBack: null };
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

  /* ── STEP 1 · Google (frontend hook only) ───────────────── */
  $('googleBtn').addEventListener('click', function () {
    /* Real OAuth replaces this block; the wizard only needs to know
       that a session exists before it lets the owner continue. */
    state.signedIn = true;
    $('authSlot').innerHTML =
      '<div class="signed">' +
        '<span class="s-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5L20 7"/></svg></span>' +
        '<div><b>Signed in</b><span>You can continue now.</span></div>' +
      '</div>';
    refreshNav();
    saveDraft();
  });

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

  /* ── STEP 3 · location — single Smart Location Engine (Phase 6) ── */
  var citySel = $('wCity'), areaInput = $('wArea');
  var cityIdBySlug = {};

  LOC.listCities().forEach(function (c) {
    citySel.appendChild(new Option(c.name, c.slug));
    cityIdBySlug[c.slug] = c.id;
  });

  var locSearch = win.MOR_LOC_SEARCH.mount(areaInput, {
    getScope: function () { return state.city ? cityIdBySlug[state.city] : null; },
    onSelect: function (node) {
      if (!node) { state.area = ''; state.areaName = ''; setErr('errLoc', ''); refreshNav(); saveDraft(); return; }
      state.city = node.citySlug || state.city;
      state.cityName = node.cityName || state.cityName;
      state.area = node.areaSlug || '';
      state.areaName = node.areaName || (node.type === 'city' ? '' : node.name);
      citySel.value = state.city;
      setErr('errLoc', '');
      refreshNav(); saveDraft();
    }
  });

  citySel.addEventListener('change', function () {
    state.city = citySel.value;
    state.cityName = citySel.options[citySel.selectedIndex].text;
    state.area = ''; state.areaName = '';
    locSearch.clear();
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

  function renderTags() {
    tagList.innerHTML = state.features.length
      ? state.features.map(function (t, i) {
          return '<span class="tag">' + UI.esc(t) +
                 '<button type="button" data-tagrm="' + i + '" aria-label="Remove ' + UI.esc(t) + '">&times;</button></span>';
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
        row('City', state.cityName) + row('Area', state.areaName) +
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
        if (showErrors) {
          if (!state.city || !state.area) setErr('errLoc', 'Please select city and area.');
          else if (!state.size) setErr('errSize', 'Please enter the property size.');
        }
        return !!(state.city && state.area && state.size);
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

    /* Sessions never survive a reload — the owner signs in again. */
    state.signedIn = false;

    renderTypes(); renderTags();
    if (state.city) {
      citySel.value = state.city;
      locSearch.setValue(state.area ? LOC.findBySlug(state.city, state.area) : null);
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

  function submit() {
    var ref = reference();

    /* Queued locally until the submission API exists. Media is
       referenced by name only — binaries are not persisted. */
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
