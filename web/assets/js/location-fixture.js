/* ══════════════════════════════════════════════════════════════
   MakanOnRent — Location Fixture (seed data for MOR_LOC)
   ------------------------------------------------------------------
   TEMPORARY data source. Builds the Pakistan → Province → City →
   Area hierarchy from the SAME city/area list already used across
   the product (assets/js/pk-locations.js) — no list is duplicated,
   this file only gives that existing data depth (societies, phases,
   blocks, roads, landmarks) and hangs it under provinces.

   DATA PROVENANCE — every place name below is hand-authored, common
   public knowledge of Pakistani cities and their well-known areas
   (the kind found on Wikipedia, government tehsil/city notifications,
   or a street sign), entered directly into this file. Nothing here
   was scraped, imported, or copied from Zameen, Graana, OLX, or any
   other private property portal. The intended lawful sources for the
   REAL dataset that eventually replaces this file are: OpenStreetMap
   (Nominatim/Overpass), public administrative boundary datasets
   (provincial/district/tehsil notifications, PBS census geography),
   admin-created locations (Admin ERP, once built), and user-submitted
   locations after approval (see submitLocation() in the engine). Swap
   this file for one that calls MOR_LOC.seed()/addLocation() from that
   real data — every consumer (search, dropdowns, breadcrumbs, filters)
   keeps working unchanged, because they only ever talk to MOR_LOC.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var LOC = root.MOR_LOC;
  var RAW = root.MOR_LOCATIONS; // pk-locations.js — the single city/area source

  var PROVINCE_OF = {
    lahore: 'punjab', faisalabad: 'punjab', multan: 'punjab', gujranwala: 'punjab',
    sialkot: 'punjab', sheikhupura: 'punjab', sargodha: 'punjab', sahiwal: 'punjab',
    bahawalpur: 'punjab', 'rahim-yar-khan': 'punjab', gujrat: 'punjab', rawalpindi: 'punjab',
    karachi: 'sindh', hyderabad: 'sindh', sukkur: 'sindh',
    islamabad: 'ict',
    peshawar: 'kpk', abbottabad: 'kpk',
    quetta: 'balochistan',
    'mirpur-ajk': 'ajk'
  };

  var PROVINCES = [
    { slug: 'punjab', name: 'Punjab' },
    { slug: 'sindh', name: 'Sindh' },
    { slug: 'kpk', name: 'Khyber Pakhtunkhwa' },
    { slug: 'balochistan', name: 'Balochistan' },
    { slug: 'ict', name: 'Islamabad Capital Territory' },
    { slug: 'ajk', name: 'Azad Jammu & Kashmir' }
  ];

  var country = LOC.addLocation({ id: 'pk', name: 'Pakistan', type: 'country', slug: 'pk' }, { silent: true });

  var provinceNode = {};
  PROVINCES.forEach(function (p) {
    provinceNode[p.slug] = LOC.addLocation(
      { parentId: country.id, name: p.name, type: 'province', slug: p.slug }, { silent: true });
  });

  /* ── aliases: alternate names/abbreviations people actually type,
     resolved through search() without creating a second location for
     the same real place. Keyed by area display name (kept short —
     not every area needs one). ── */
  var AREA_ALIASES = {
    'Johar Town': ['Johar', 'JT'],
    'DHA Defence': ['DHA'],
    'Bahria Town': ['Bahria'],
    'Model Town': ['MT'],
    'Gulshan-e-Iqbal': ['Gulshan'],
    'Gulistan-e-Johar': ['Gulistan Johar']
  };

  /* ── cities + areas: reuse pk-locations.js verbatim, add depth ── */
  var cityNode = {};
  RAW.cities.forEach(function (c) {
    var province = provinceNode[PROVINCE_OF[c.slug]] || provinceNode.punjab;
    var city = LOC.addLocation(
      { parentId: province.id, name: c.name, type: 'city', slug: c.slug }, { silent: true });
    cityNode[c.slug] = city;

    c.areas.forEach(function (areaName) {
      var area = LOC.addLocation(
        { parentId: city.id, name: areaName, type: 'locality', aliases: AREA_ALIASES[areaName] }, { silent: true });
      LOC.registerCitySlugArea(c.slug, area.slug, area.id);
    });
  });

  /* ── deeper hierarchy for the areas the brief calls out by name ──
     (society → phase/block → road, exactly as the autocomplete
     examples describe: Johar Town, DHA, and a full breadcrumb
     Punjab > Lahore > Johar Town > Phase 2 > Block G > Road 12). */
  function child(parent, name, type) {
    return LOC.addLocation({ parentId: parent.id, name: name, type: type }, { silent: true });
  }

  var lahore = cityNode.lahore;
  if (lahore) {
    var johar = LOC.findByExactName('Johar Town', { cityId: lahore.id });
    if (johar) {
      var jp1 = child(johar, 'Phase 1', 'phase');
      var jp2 = child(johar, 'Phase 2', 'phase');
      var jBlockG = child(johar, 'Block G', 'block');
      child(jBlockG, 'Road 12', 'road');
      child(jp1, 'Block A', 'block');
      child(jp2, 'Block H', 'block');
      child(johar, 'Emporium Mall', 'landmark');
    }

    var dha = LOC.findByExactName('DHA Defence', { cityId: lahore.id });
    if (dha) {
      ['Phase 1', 'Phase 3', 'Phase 5', 'Phase 6', 'Phase 8'].forEach(function (p) { child(dha, p, 'phase'); });
    }

    /* Gulberg's numbered blocks are themselves searched by their
       short form ("Gulberg 3") as often as the full name — the
       alias example the brief calls out by name. */
    var gulberg = LOC.findByExactName('Gulberg', { cityId: lahore.id });
    if (gulberg) {
      LOC.addLocation({ parentId: gulberg.id, name: 'Gulberg III', type: 'phase', aliases: ['Gulberg 3'] }, { silent: true });
      LOC.addLocation({ parentId: gulberg.id, name: 'Gulberg II', type: 'phase', aliases: ['Gulberg 2'] }, { silent: true });
    }
  }

  /* ── Jhang: named in the brief but not yet in pk-locations.js —
     added here, at the fixture layer, so the base city/area list
     stays the single unduplicated source and this stays additive. */
  var punjab = provinceNode.punjab;
  var jhang = LOC.addLocation({ parentId: punjab.id, name: 'Jhang', type: 'city' }, { silent: true });
  cityNode.jhang = jhang;
  var jhangSat = child(jhang, 'Satellite Town', 'locality');
  var jhangCivil = child(jhang, 'Civil Lines', 'locality');
  LOC.registerCitySlugArea('jhang', jhangSat.slug, jhangSat.id);
  LOC.registerCitySlugArea('jhang', jhangCivil.slug, jhangCivil.id);
  child(jhang, 'Gojra Road', 'road');

  /* ── Cantt reads naturally as "<City> Cantt", not "Cantt <City>" —
     the only display-order exception (see location-engine.js). */

  /* ── popular locations: shown when a search field is empty ──── */
  if (lahore) {
    var popular = ['DHA Defence', 'Bahria Town', 'Johar Town', 'Model Town']
      .map(function (n) { var a = LOC.findByExactName(n, { cityId: lahore.id }); return a && a.id; })
      .filter(Boolean);
    LOC.setPopular(popular);
  }

  /* ── replay any admin edits recorded in a previous session ──── */
  LOC.replayOverrides();
})(window);
