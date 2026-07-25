/* MakanOnRent — Property Details page (Phase 2).
   Gallery · summary · specifications · expandable information
   sections. Sections are declared once and render whatever the
   backend later supplies under the matching key. */
(function (win, doc) {
  'use strict';

  var CFG = win.MOR_CONFIG, DATA = win.MOR_DATA, UI = win.MOR_UI;
  var root = doc.getElementById('detailRoot');

  /* Section catalog — the contract for future inspection data.
     key must match the property record's details[key]. */
  var SECTIONS = [
    ['property-condition', 'Property Condition'],
    ['kitchen',            'Kitchen Condition'],
    ['bathrooms',          'Bathrooms'],
    ['electric-meter',     'Electric Meter'],
    ['gas-meter',          'Gas Meter'],
    ['building-age',       'Building Age'],
    ['documents',          'Documents'],
    ['nearby-market',      'Nearby Market'],
    ['nearby-schools',     'Nearby Schools'],
    ['nearby-mosque',      'Nearby Mosque'],
    ['parking',            'Parking'],
    ['rooftop',            'Rooftop'],
    ['park-facing',        'Park Facing'],
    ['corner',             'Corner'],
    ['additional',         'Additional Features'],
    ['environment',        'Environment'],
    ['inspection-notes',   'Inspection Notes']
  ];

  var IC = {
    bed:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-9M3 13h18v5M21 18v-4a3 3 0 0 0-3-3h-7v2"/><circle cx="7" cy="10" r="2"/></svg>',
    bath: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M6 12V6a2 2 0 0 1 3.6-1.2"/></svg>',
    car:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16h14M6.5 16v2M17.5 16v2"/><path d="M4 16v-3.5L6 8h12l2 4.5V16"/></svg>',
    size: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M8 3v5H3M21 16h-5v5"/></svg>',
    type: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.8V20h14V9.8"/></svg>',
    ref:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>'
  };

  function tile(icon, label, value) {
    return '<div class="spec-tile"><span class="st-ic" aria-hidden="true">' + icon + '</span>' +
           '<div><b>' + value + '</b><span>' + label + '</span></div></div>';
  }

  function notFound() {
    root.setAttribute('aria-busy', 'false');
    root.innerHTML =
      '<div class="empty">' +
        '<div class="empty-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2M8.5 11h5"/></svg></div>' +
        '<h2>Property not available</h2>' +
        '<p>This listing may have been rented or withdrawn. Browse the properties that are live right now.</p>' +
        '<a class="btn-ghost" href="' + CFG.routes.listingPage + '">Back to Results</a>' +
      '</div>';
  }

  function render(r) {
    var L = UI.links(r);
    var fav = UI.Favourites.has(r.id);
    var imgs = r.images.length ? r.images : [null];

    var thumbs = imgs.map(function (src, i) {
      return '<button type="button" data-thumb="' + i + '" aria-current="' + (i === 0) + '" ' +
             'aria-label="Image ' + (i + 1) + '">' + UI.mediaFill(src, '') + '</button>';
    }).join('');

    var gallery =
      '<div class="gallery">' +
        '<div class="gal-main" id="galMain">' +
          '<div class="gal-frame" id="galFrame">' + UI.mediaFill(imgs[0], r.title) + '</div>' +
          (imgs.length > 1 ?
            '<button class="gal-nav gal-prev" type="button" data-gal="-1" aria-label="Previous image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>' +
            '<button class="gal-nav gal-next" type="button" data-gal="1" aria-label="Next image"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>' : '') +
          '<span class="gal-count" id="galCount">' + (imgs[0] ? '1 / ' + imgs.length : 'Photos being added') + '</span>' +
        '</div>' +
        '<div class="gal-thumbs">' + thumbs + '</div>' +
      '</div>';

    var summary =
      '<aside class="summary">' +
        '<div class="price-row">' +
          '<span class="rent">PKR ' + UI.fmtPKR(r.rent) + ' <small>/ month</small></span>' +
        '</div>' +
        '<p class="advance">Advance required <b>PKR ' + UI.fmtPKR(r.advance) + '</b></p>' +
        UI.badgeHTML(r.verified) +
        '<h1>' + r.title + '</h1>' +
        '<p class="pcard-loc">' + r.area + ', ' + r.city + '</p>' +
        '<p class="pcard-upd">Updated ' + UI.fmtRelative(r.updatedAt) + ' · Ref ' + r.id + '</p>' +
        '<div class="sum-actions">' +
          '<a class="btn-details" href="' + L.wa + '" target="_blank" rel="noopener">WhatsApp</a>' +
          '<a class="act" href="' + L.tel + '" aria-label="Call">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg></a>' +
          '<a class="act" href="' + L.mail + '" aria-label="Email">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.5 8.5 6 8.5-6"/></svg></a>' +
          '<button class="act fav-btn" type="button" data-fav="' + r.id + '" aria-pressed="' + fav + '" aria-label="Save to favourites">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 8.6c0 5-8.5 10.4-8.5 10.4S3.5 13.6 3.5 8.6A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8.5 2.6z"/></svg>' +
          '</button>' +
        '</div>' +
      '</aside>';

    var specs =
      '<h2 class="detail-title">Specifications</h2>' +
      '<div class="spec-grid">' +
        (r.beds ? tile(IC.bed, 'Bedrooms', r.beds) : '') +
        tile(IC.bath, 'Bathrooms', r.baths) +
        tile(IC.car, 'Car Porch', r.carPorch ? 'Available' : 'Not available') +
        tile(IC.size, 'Property Size', UI.fmtSize(r)) +
        tile(IC.type, 'Property Type', UI.typeLabel(r.type)) +
        tile(IC.ref, 'Reference', r.id) +
      '</div>';

    var details = r.details || {};
    var sections = SECTIONS.map(function (s) {
      var rows = details[s[0]];
      var has = !!(rows && rows.length);
      var body = has
        ? rows.map(function (kv) { return '<div class="kv"><span>' + kv[0] + '</span><b>' + kv[1] + '</b></div>'; }).join('')
        : '<p class="sec-empty">Not recorded yet — added after the next verification visit.</p>';

      return '<div class="section' + (has ? ' has-data' : '') + '">' +
        '<button class="sec-head" type="button" aria-expanded="false">' +
          '<b>' + s[1] + '</b>' +
          '<span class="sec-pill">' + (has ? 'Recorded' : 'Pending') + '</span>' +
          '<svg class="sec-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="sec-panel"><div class="sec-inner"><div class="sec-body">' + body + '</div></div></div>' +
      '</div>';
    }).join('');

    root.setAttribute('aria-busy', 'false');
    root.innerHTML =
      '<div class="detail-grid">' +
        '<div>' + gallery + specs +
          '<h2 class="detail-title">Property Information</h2>' +
          '<div class="sections">' + sections + '</div>' +
        '</div>' + summary +
      '</div>';

    bindGallery(imgs, r.title);
  }

  /* ── gallery ────────────────────────────────────────────── */
  var current = 0;

  function bindGallery(imgs, title) {
    var frame = doc.getElementById('galFrame');
    var count = doc.getElementById('galCount');
    var thumbs = root.querySelectorAll('[data-thumb]');

    function show(i) {
      current = (i + imgs.length) % imgs.length;
      var src = imgs[current];
      frame.innerHTML = UI.mediaFill(src, title);
      if (count && src) count.textContent = (current + 1) + ' / ' + imgs.length;
      thumbs.forEach(function (t, ti) { t.setAttribute('aria-current', ti === current ? 'true' : 'false'); });
    }

    root.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-gal]');
      if (nav) { show(current + Number(nav.getAttribute('data-gal'))); return; }
      var th = e.target.closest('[data-thumb]');
      if (th) show(Number(th.getAttribute('data-thumb')));
    });

    doc.addEventListener('keydown', function (e) {
      if (imgs.length < 2) return;
      if (e.key === 'ArrowLeft')  show(current - 1);
      if (e.key === 'ArrowRight') show(current + 1);
    });
  }

  /* ── delegated: accordion + favourite ───────────────────── */
  root.addEventListener('click', function (e) {
    var head = e.target.closest('.sec-head');
    if (head) {
      var sec = head.parentNode;
      var open = sec.classList.toggle('is-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      return;
    }
    var f = e.target.closest('[data-fav]');
    if (f) {
      var on = UI.Favourites.toggle(f.getAttribute('data-fav'));
      f.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });

  /* ── boot ───────────────────────────────────────────────── */
  var id = new URLSearchParams(win.location.search).get('id');
  var rec = id ? DATA.byId(id) : null;

  /* Return to the exact result set the visitor came from. */
  try {
    var back = sessionStorage.getItem(CFG.storage.lastResultsUrl);
    if (back) doc.getElementById('backLink').setAttribute('href', back);
  } catch (e) {}

  doc.getElementById('yr').textContent = new Date().getFullYear();
  if (rec) render(rec); else notFound();
})(window, document);
