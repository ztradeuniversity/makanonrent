/* ══════════════════════════════════════════════════════════════
   MakanOnRent — Pakistan Smart Location Engine
   ------------------------------------------------------------------
   The ONE location system for the whole product. Every page that
   needs a place — Homepage search, Listing filters, Submit Wizard,
   Owner Dashboard, the future Admin ERP, future maps, future SEO
   URLs, future AI search — reads and writes through this module.
   Nothing else may hold its own list of cities/areas.

   This file is data-agnostic: it holds the graph, the indices and
   the operations. The actual Pakistani places are seeded by
   assets/js/location-fixture.js via MOR_LOC.seed()/addLocation().
   Swapping the fixture for a real API later means changing ONE file
   and touching nothing that consumes MOR_LOC.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var CFG = root.MOR_CONFIG;
  var OPT = (CFG && CFG.location) || { searchLimit: 8, recentLimit: 5, bucketChars: 2 };

  /* Root-to-leaf order. New tiers append here — nothing above reads
     this list positionally except for tie-break ranking in search(). */
  var TYPES = [
    'country', 'province', 'division', 'district', 'tehsil',
    'city', 'locality', 'society', 'phase', 'block', 'road', 'street', 'landmark'
  ];
  var TYPE_RANK = {};
  TYPES.forEach(function (t, i) { TYPE_RANK[t] = i; });

  /* ── string utilities (kept local — no dependency on any page) ── */
  function slugify(v) {
    return String(v).toLowerCase().trim()
      .replace(/[()]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  function normalize(v) {
    return String(v || '').toLowerCase().trim().replace(/\s+/g, ' ');
  }
  function tokens(v) {
    return normalize(v).split(' ').filter(Boolean);
  }

  /* ── graph storage ──────────────────────────────────────────── */
  var byId = new Map();
  var byParent = new Map();          // parentId -> [childId, ...]
  var tokenIndex = new Map();        // firstNChars(token) -> Set(id)
  var byCitySlugArea = new Map();    // 'citySlug|areaSlug' -> id  (legacy-compatible lookup)
  var byNameLower = new Map();       // normalized own-name -> [id,...] (first-match convenience)
  var popularIds = [];
  var fuzzyMatcher = null;           // opt-in hook, see setFuzzyMatcher()

  function bucketKey(tok) {
    return tok.slice(0, OPT.bucketChars) || tok;
  }

  /* A node is publicly visible when it's active AND has cleared
     moderation. User-suggested locations sit as status:'pending'
     until an admin calls approveLocation() — same node, same id,
     so nothing selects it early and nothing needs rewiring once
     it's approved. */
  function isPublic(node, opts) {
    if (!node || !node.active) return false;
    if (opts && opts.includePending) return node.status !== 'rejected';
    return node.status === 'approved';
  }

  /* ── breadcrumb + denormalized readout ──────────────────────── */
  function getBreadcrumb(id, opts) {
    var includeInactive = opts && opts.includeInactive;
    var chain = [];
    var node = byId.get(id);
    while (node) {
      if (node.active || includeInactive) chain.push(node);
      node = node.parentId ? byId.get(node.parentId) : null;
    }
    return chain; // [self, parent, grandparent, ... root]
  }

  /* Location Object Model readout: province/district/tehsil/city/
     society/phase/block/road/street/landmark pulled from ancestors
     by type — computed on demand, never duplicated in storage. */
  function getDenormalized(id) {
    var out = {};
    getBreadcrumb(id, { includeInactive: true }).forEach(function (n) {
      if (out[n.type] === undefined) out[n.type] = n.name;
    });
    return out;
  }

  function ancestorOfType(id, type) {
    var chain = getBreadcrumb(id, { includeInactive: true });
    for (var i = 0; i < chain.length; i++) if (chain[i].type === type) return chain[i];
    return null;
  }

  /* ── indexing ───────────────────────────────────────────────── */
  function searchableTokens(node) {
    var set = {};
    tokens(node.name).forEach(function (t) { set[t] = 1; });
    (node.aliases || []).forEach(function (a) { tokens(a).forEach(function (t) { set[t] = 1; }); });
    getBreadcrumb(node.id, { includeInactive: true }).forEach(function (anc) {
      if (anc.id === node.id) return;
      tokens(anc.name).forEach(function (t) { set[t] = 1; });
    });
    return Object.keys(set);
  }

  function indexNode(node) {
    searchableTokens(node).forEach(function (t) {
      var key = bucketKey(t);
      if (!tokenIndex.has(key)) tokenIndex.set(key, new Set());
      tokenIndex.get(key).add(node.id);
    });
    var nameKey = normalize(node.name);
    if (!byNameLower.has(nameKey)) byNameLower.set(nameKey, []);
    if (byNameLower.get(nameKey).indexOf(node.id) === -1) byNameLower.get(nameKey).push(node.id);
  }

  function deindexNode(node) {
    searchableTokens(node).forEach(function (t) {
      var s = tokenIndex.get(bucketKey(t));
      if (s) s.delete(node.id);
    });
    var nameKey = normalize(node.name);
    var bucket = byNameLower.get(nameKey);
    if (bucket) {
      var i = bucket.indexOf(node.id);
      if (i > -1) bucket.splice(i, 1);
    }
  }

  /* ── CRUD (the surface the future Admin ERP calls) ───────────── */
  function addLocation(input, opts) {
    var parent = input.parentId ? byId.get(input.parentId) : null;
    var slug = input.slug || slugify(input.name);
    var id = input.id || (parent ? parent.id + '/' + slug : slug);
    if (byId.has(id)) return byId.get(id); // idempotent re-seed

    var node = {
      id: id, name: input.name, parentId: input.parentId || null,
      type: input.type, slug: slug,
      lat: (input.lat != null) ? input.lat : null,
      lng: (input.lng != null) ? input.lng : null,
      active: input.active !== false,
      status: input.status || 'approved',    // 'approved' | 'pending' | 'rejected' | 'disabled'
      note: input.note || '',
      suggestedBy: input.suggestedBy || null,    // future user reference — null until auth exists
      submittedAt: input.submittedAt || null,    // ISO date; set only for user submissions
      flags: input.flags || [],                  // [{ type, reason, confidence, source, flaggedAt }]
      possibleDuplicateOf: input.possibleDuplicateOf || null,
      aliases: input.aliases || [],
      mergedInto: null
    };
    byId.set(id, node);
    if (parent) {
      if (!byParent.has(parent.id)) byParent.set(parent.id, []);
      byParent.get(parent.id).push(id);
    }
    indexNode(node);
    if (!(opts && opts.silent)) record('add', input);
    return node;
  }

  /* Disable/enable are the fourth moderation state ('disabled') as
     well as the active flag, so a disabled place is excluded from
     every public read by the exact same status check a rejected
     suggestion is — one gate, not two overlapping ones. */
  function disableLocation(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    n.active = false;
    n.status = 'disabled';
    if (!(opts && opts.silent)) record('disable', { id: id });
    return n;
  }
  function enableLocation(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    n.active = true;
    n.status = 'approved';
    if (!(opts && opts.silent)) record('enable', { id: id });
    return n;
  }

  function renameLocation(id, newName, opts) {
    var n = byId.get(id);
    if (!n) return null;
    deindexNode(n);
    n.name = newName;
    indexNode(n);
    /* Every descendant's breadcrumb tokens changed too. */
    (getDescendants(id) || []).forEach(function (child) {
      deindexNode(child); indexNode(child);
    });
    if (!(opts && opts.silent)) record('rename', { id: id, name: newName });
    return n;
  }

  function mergeLocations(fromId, intoId, opts) {
    var from = byId.get(fromId), into = byId.get(intoId);
    if (!from || !into || fromId === intoId) return null;
    (byParent.get(fromId) || []).forEach(function (childId) {
      var child = byId.get(childId);
      if (!child) return;
      deindexNode(child);
      child.parentId = intoId;
      indexNode(child);
      if (!byParent.has(intoId)) byParent.set(intoId, []);
      byParent.get(intoId).push(childId);
    });
    byParent.set(fromId, []);
    from.active = false;
    from.mergedInto = intoId;
    if (!(opts && opts.silent)) record('merge', { from: fromId, into: intoId });
    return into;
  }

  /* General-purpose edit — name, aliases, coordinates and/or parent
     in one call. Re-parenting reuses the same reindex path merge
     already established. Distinct from renameLocation(), which stays
     as the narrow one-field convenience it always was. */
  function updateLocation(id, patch, opts) {
    var n = byId.get(id);
    if (!n) return null;
    var reindex = false;

    if (patch.name !== undefined && patch.name !== n.name) { n.name = patch.name; reindex = true; }
    if (patch.aliases !== undefined) { n.aliases = patch.aliases; reindex = true; }
    if (patch.lat !== undefined) n.lat = patch.lat;
    if (patch.lng !== undefined) n.lng = patch.lng;

    if (patch.parentId !== undefined && patch.parentId !== n.parentId) {
      var oldParent = n.parentId, newParent = byId.get(patch.parentId);
      if (newParent) {
        if (oldParent && byParent.has(oldParent)) {
          var list = byParent.get(oldParent);
          var i = list.indexOf(id);
          if (i > -1) list.splice(i, 1);
        }
        n.parentId = patch.parentId;
        if (!byParent.has(patch.parentId)) byParent.set(patch.parentId, []);
        byParent.get(patch.parentId).push(id);
        reindex = true;
      }
    }

    if (reindex) {
      deindexNode(n); indexNode(n);
      (getDescendants(id) || []).forEach(function (c) { deindexNode(c); indexNode(c); });
    }
    if (!(opts && opts.silent)) record('update', { id: id, patch: patch });
    return n;
  }

  /* ── moderation: user-submitted locations ────────────────────
     "Suggest New Location" creates a real graph node immediately
     (so it can be re-parented, aliased, merged like any other) but
     status:'pending' keeps it out of every public read until an
     admin approves it. Nothing else in the product needs to change
     when that happens — same id, same shape. */
  function findDuplicateCandidates(name, parentId) {
    var q = normalize(name);
    return (byParent.get(parentId) || [])
      .map(function (cid) { return byId.get(cid); })
      .filter(function (n) {
        if (!n || n.status === 'rejected') return false;
        if (normalize(n.name) === q) return true;
        return (n.aliases || []).some(function (a) { return normalize(a) === q; });
      });
  }

  function submitLocation(input, opts) {
    var submittedAt = input.submittedAt || new Date().toISOString();
    var dupes = input.parentId ? findDuplicateCandidates(input.name, input.parentId) : [];
    var flags = (input.flags || []).slice();
    if (dupes[0]) {
      flags.push({
        type: 'duplicate', source: 'rule:exact-name-or-alias',
        reason: 'Matches existing "' + dupes[0].name + '" under the same parent.',
        confidence: 1, flaggedAt: submittedAt
      });
    }
    var payload = {
      name: input.name, parentId: input.parentId || null, type: input.type || 'locality',
      note: input.note || '', status: 'pending',
      suggestedBy: input.suggestedBy || null, submittedAt: submittedAt,
      possibleDuplicateOf: dupes[0] ? dupes[0].id : null, flags: flags
    };
    var node = addLocation(payload, { silent: true });
    if (!(opts && opts.silent)) record('add', payload);
    return node;
  }

  function approveLocation(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    n.status = 'approved';
    if (!(opts && opts.silent)) record('approve', { id: id });
    return n;
  }
  function rejectLocation(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    n.status = 'rejected';
    if (!(opts && opts.silent)) record('reject', { id: id });
    return n;
  }

  /* Permanent removal — distinct from reject/disable, which keep the
     record for audit. For bogus/spam/duplicate submissions only.
     Refuses to delete a node with real children unless the caller
     explicitly opts into a cascade, so an admin can't accidentally
     erase approved sub-locations while cleaning up junk. */
  function removeLocation(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    var kids = byParent.get(id) || [];
    if (kids.length && !(opts && opts.cascade)) return null;

    kids.slice().forEach(function (cid) { removeLocation(cid, { cascade: true, silent: true }); });

    deindexNode(n);
    byId.delete(id);
    byParent.delete(id);
    if (n.parentId && byParent.has(n.parentId)) {
      var list = byParent.get(n.parentId);
      var i = list.indexOf(id);
      if (i > -1) list.splice(i, 1);
    }
    popularIds = popularIds.filter(function (pid) { return pid !== id; });
    byCitySlugArea.forEach(function (v, k) { if (v === id) byCitySlugArea.delete(k); });

    if (!(opts && opts.silent)) record('remove', { id: id });
    return true;
  }

  /* ── flags: the extension point for future automated review ───
     No AI or fuzzy detection runs here — this only defines the
     shape a rule engine or AI service pushes into. Admin (and, once
     built, the Admin ERP) reads getFlagged() as its review queue. */
  function addFlag(id, flag, opts) {
    var n = byId.get(id);
    if (!n) return null;
    var entry = {
      type: flag.type || 'suspicious',
      reason: flag.reason || '',
      confidence: flag.confidence != null ? flag.confidence : null,
      source: flag.source || 'unknown',
      flaggedAt: flag.flaggedAt || new Date().toISOString()
    };
    n.flags.push(entry);
    if (!(opts && opts.silent)) record('flag', { id: id, flag: entry });
    return n;
  }
  function clearFlags(id, opts) {
    var n = byId.get(id);
    if (!n) return null;
    n.flags = [];
    if (!(opts && opts.silent)) record('clearFlags', { id: id });
    return n;
  }
  function getFlagged() {
    var out = [];
    byId.forEach(function (n) { if (n.flags && n.flags.length) out.push(decorateForAdmin(n)); });
    return out;
  }

  /* Admin-only decoration: everything decorate() gives a search
     result, plus the moderation fields no public consumer needs. */
  function decorateForAdmin(node) {
    var d = decorate(node);
    d.status = node.status;
    d.active = node.active;
    d.note = node.note;
    d.suggestedBy = node.suggestedBy;
    d.submittedAt = node.submittedAt;
    d.flags = node.flags;
    d.possibleDuplicateOf = node.possibleDuplicateOf;
    d.mergedInto = node.mergedInto;
    return d;
  }

  function getPendingSuggestions() {
    var out = [];
    byId.forEach(function (n) { if (n.status === 'pending') out.push(decorateForAdmin(n)); });
    return out;
  }

  /* One read entry point for a future Admin ERP location screen:
     every node regardless of status/active, optionally filtered.
     Never used by any public search/dropdown path. */
  function getAllForAdmin(opts) {
    opts = opts || {};
    var out = [];
    byId.forEach(function (n) {
      if (opts.status && n.status !== opts.status) return;
      if (opts.type && n.type !== opts.type) return;
      out.push(decorateForAdmin(n));
    });
    return out;
  }

  /* ── future-ready: coordinate-based search ───────────────────
     Architecture only, per the brief. Every node's lat/lng is null
     today, so these intentionally return empty/null rather than
     pretend to compute a real result. The signature is the contract
     a future Maps/AI-search feature builds against. */
  function nearby(lat, lng, radiusKm, opts) {
    return []; // TODO: Haversine filter once nodes carry real coordinates
  }
  function distanceBetween(idA, idB) {
    var a = byId.get(idA), b = byId.get(idB);
    if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    return null; // TODO: Haversine once coordinates exist
  }

  function setCoordinates(id, lat, lng) {
    var n = byId.get(id);
    if (!n) return null;
    n.lat = lat; n.lng = lng;
    return n;
  }

  function getDescendants(id) {
    var out = [];
    (byParent.get(id) || []).forEach(function (childId) {
      var c = byId.get(childId);
      if (c) { out.push(c); out = out.concat(getDescendants(childId)); }
    });
    return out;
  }

  /* ── admin action log (frontend-only persistence, replayed) ──── */
  function record(type, payload) {
    if (!CFG) return;
    try {
      var log = JSON.parse(localStorage.getItem(CFG.storage.locationOverrides) || '[]');
      log.push({ type: type, payload: payload });
      localStorage.setItem(CFG.storage.locationOverrides, JSON.stringify(log));
    } catch (e) {}
  }
  function replayOverrides() {
    if (!CFG) return;
    var log;
    try { log = JSON.parse(localStorage.getItem(CFG.storage.locationOverrides) || '[]'); }
    catch (e) { return; }
    log.forEach(function (a) {
      var silent = { silent: true };
      if (a.type === 'add') addLocation(a.payload, silent);
      else if (a.type === 'disable') disableLocation(a.payload.id, silent);
      else if (a.type === 'enable') enableLocation(a.payload.id, silent);
      else if (a.type === 'rename') renameLocation(a.payload.id, a.payload.name, silent);
      else if (a.type === 'merge') mergeLocations(a.payload.from, a.payload.into, silent);
      else if (a.type === 'update') updateLocation(a.payload.id, a.payload.patch, silent);
      else if (a.type === 'approve') approveLocation(a.payload.id, silent);
      else if (a.type === 'reject') rejectLocation(a.payload.id, silent);
      else if (a.type === 'remove') removeLocation(a.payload.id, { cascade: true, silent: true });
      else if (a.type === 'flag') addFlag(a.payload.id, a.payload.flag, silent);
      else if (a.type === 'clearFlags') clearFlags(a.payload.id, silent);
    });
  }

  /* ── reads ──────────────────────────────────────────────────── */
  function getById(id) { return byId.get(id) || null; }

  function getChildren(id, opts) {
    var ids = byParent.get(id) || [];
    var type = opts && opts.types;
    var showAll = opts && opts.includeInactive; // admin views: bypass moderation + active filter entirely
    return ids.map(function (cid) { return byId.get(cid); })
      .filter(function (n) { return n && (showAll || isPublic(n, opts)); })
      .filter(function (n) { return !type || type.indexOf(n.type) > -1; });
  }

  function listCities(opts) {
    return getChildrenOfType('city', opts);
  }
  function getChildrenOfType(type, opts) {
    var showAll = opts && opts.includeInactive;
    var out = [];
    byId.forEach(function (n) {
      if (n.type === type && (showAll || isPublic(n, opts))) out.push(n);
    });
    return out;
  }

  function findBySlug(citySlug, areaSlug) {
    if (!areaSlug) return findCityBySlug(citySlug);
    return byId.get(byCitySlugArea.get(citySlug + '|' + areaSlug)) || null;
  }
  function findCityBySlug(citySlug) {
    var out = null;
    byId.forEach(function (n) { if (n.type === 'city' && n.slug === citySlug) out = n; });
    return out;
  }
  function findByExactName(name, opts) {
    var ids = byNameLower.get(normalize(name)) || [];
    var nodes = ids.map(function (id) { return byId.get(id); })
      .filter(function (n) { return n && ((opts && opts.includeInactive) || isPublic(n, opts)); });
    if (opts && opts.cityId) nodes = nodes.filter(function (n) { return ancestorOfType(n.id, 'city') && ancestorOfType(n.id, 'city').id === opts.cityId; });
    return nodes[0] || null;
  }

  /* ── search ─────────────────────────────────────────────────── */
  function scoreNode(node, q) {
    var nameNorm = normalize(node.name);
    var nameToks = tokens(node.name);
    var best = 0;

    if (nameNorm === q) best = Math.max(best, 100);
    if (nameNorm.indexOf(q) === 0) best = Math.max(best, 90);
    if (nameToks.some(function (t) { return t.indexOf(q) === 0; })) best = Math.max(best, 80);
    if (nameNorm.indexOf(q) > -1) best = Math.max(best, 40);

    if (best < 80) {
      var ancestors = getBreadcrumb(node.id).slice(1); // exclude self
      for (var i = 0; i < ancestors.length; i++) {
        var an = normalize(ancestors[i].name);
        var atoks = tokens(ancestors[i].name);
        if (atoks.some(function (t) { return t.indexOf(q) === 0; })) { best = Math.max(best, 55); break; }
        if (an.indexOf(q) > -1) best = Math.max(best, 25);
      }
    }

    if (best === 0 && fuzzyMatcher) {
      var fz = fuzzyMatcher(q, node);
      if (fz > 0) best = Math.min(fz, 39); // fuzzy never outranks a real match
    }
    return best;
  }

  function search(query, opts) {
    opts = opts || {};
    var q = normalize(query);
    if (!q) return [];

    var limit = opts.limit || OPT.searchLimit;
    var candidates;

    if (q.length < OPT.bucketChars) {
      /* Shorter than a bucket key (e.g. one letter): union every
         bucket starting with it. The dataset stays small enough
         that this is still instant, and it's the rare case. */
      candidates = new Set();
      tokenIndex.forEach(function (set, k) {
        if (k.indexOf(q) === 0) set.forEach(function (id) { candidates.add(id); });
      });
    } else {
      candidates = tokenIndex.get(bucketKey(q));
    }
    if (!candidates || !candidates.size) return [];

    var scopeId = opts.scopeId || null;
    var types = opts.types || null;
    var out = [];

    candidates.forEach(function (id) {
      var node = byId.get(id);
      if (!isPublic(node, opts)) return;
      if (types && types.indexOf(node.type) === -1) return;
      if (scopeId && node.id !== scopeId) {
        var inScope = getBreadcrumb(node.id).some(function (a) { return a.id === scopeId; });
        if (!inScope) return;
      }
      var score = scoreNode(node, q);
      if (score > 0) out.push({ node: node, score: score });
    });

    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      var ra = TYPE_RANK[a.node.type], rb = TYPE_RANK[b.node.type];
      if (ra !== rb) return ra - rb;
      return a.node.name.localeCompare(b.node.name);
    });

    return out.slice(0, limit).map(function (r) { return decorate(r.node); });
  }

  /* Adds the derived, display-ready fields every consumer needs:
     breadcrumb (self→root), a combined label, and legacy-compatible
     citySlug/areaSlug so existing property filtering never changes. */
  var DISPLAY_SUFFIX_FIRST = { cantt: 1, city: 1 };

  function displayLabel(node) {
    var city = ancestorOfType(node.id, 'city');
    if (node.type === 'city' || !city || city.id === node.id) return node.name;
    var suffixFirst = DISPLAY_SUFFIX_FIRST[normalize(node.name)];
    return suffixFirst ? (city.name + ' ' + node.name) : (node.name + ' ' + city.name);
  }

  function decorate(node) {
    var chain = getBreadcrumb(node.id);
    var city = ancestorOfType(node.id, 'city');
    var areaTier = (node.type === 'locality' || node.type === 'society') ? node
      : chain.slice(1).filter(function (n) { return n.type === 'locality' || n.type === 'society'; })[0] || null;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      label: displayLabel(node),
      breadcrumb: chain.map(function (n) { return n.name; }),
      breadcrumbNodes: chain,
      lat: node.lat, lng: node.lng, active: node.active,
      citySlug: city ? city.slug : '',
      cityName: city ? city.name : '',
      areaSlug: areaTier ? areaTier.slug : '',
      areaName: areaTier ? areaTier.name : ''
    };
  }

  /* ── popular / recent ───────────────────────────────────────── */
  function setPopular(ids) { popularIds = ids.slice(); }
  function getPopular() {
    return popularIds.map(function (id) { return byId.get(id); })
      .filter(function (n) { return isPublic(n); })
      .map(decorate);
  }

  function getRecent() {
    if (!CFG) return [];
    var ids;
    try { ids = JSON.parse(localStorage.getItem(CFG.storage.locationRecents) || '[]'); }
    catch (e) { return []; }
    return ids.map(function (id) { return byId.get(id); })
      .filter(function (n) { return isPublic(n); })
      .slice(0, OPT.recentLimit)
      .map(decorate);
  }
  function addRecent(id) {
    if (!CFG) return;
    var ids;
    try { ids = JSON.parse(localStorage.getItem(CFG.storage.locationRecents) || '[]'); }
    catch (e) { ids = []; }
    ids = ids.filter(function (x) { return x !== id; });
    ids.unshift(id);
    ids = ids.slice(0, OPT.recentLimit);
    try { localStorage.setItem(CFG.storage.locationRecents, JSON.stringify(ids)); } catch (e) {}
  }

  /* ── SEO-ready path (architecture only — no route consumes it yet) ── */
  function seoPath(id) {
    var city = ancestorOfType(id, 'city');
    var node = byId.get(id);
    if (!city) return '/';
    if (node.type === 'city') return '/' + city.slug;
    return '/' + city.slug + '/' + node.slug;
  }

  /* ── typo tolerance (architecture only — no default algorithm) ──
     Registering a matcher activates fuzzy scoring; until then this
     is a no-op so the engine never pays for work nobody asked for. */
  function setFuzzyMatcher(fn) { fuzzyMatcher = typeof fn === 'function' ? fn : null; }

  /* ── seed helper for the fixture (bulk, ordered root→leaf) ──── */
  function seed(nodes) {
    nodes.forEach(function (n) { addLocation(n, { silent: true }); });
  }
  function registerCitySlugArea(citySlug, areaSlug, id) {
    byCitySlugArea.set(citySlug + '|' + areaSlug, id);
  }

  root.MOR_LOC = {
    TYPES: TYPES,
    slugify: slugify,
    seed: seed,
    addLocation: addLocation,
    disableLocation: disableLocation,
    enableLocation: enableLocation,
    renameLocation: renameLocation,
    updateLocation: updateLocation,
    mergeLocations: mergeLocations,
    submitLocation: submitLocation,
    approveLocation: approveLocation,
    rejectLocation: rejectLocation,
    removeLocation: removeLocation,
    addFlag: addFlag,
    clearFlags: clearFlags,
    getFlagged: getFlagged,
    getPendingSuggestions: getPendingSuggestions,
    getAllForAdmin: getAllForAdmin,
    decorateForAdmin: decorateForAdmin,
    findDuplicateCandidates: findDuplicateCandidates,
    nearby: nearby,
    distanceBetween: distanceBetween,
    setCoordinates: setCoordinates,
    getById: getById,
    getChildren: getChildren,
    getDescendants: getDescendants,
    getBreadcrumb: getBreadcrumb,
    getDenormalized: getDenormalized,
    listCities: listCities,
    findBySlug: findBySlug,
    findByExactName: findByExactName,
    search: search,
    decorate: decorate,
    displayLabel: displayLabel,
    setPopular: setPopular,
    getPopular: getPopular,
    getRecent: getRecent,
    addRecent: addRecent,
    seoPath: seoPath,
    setFuzzyMatcher: setFuzzyMatcher,
    registerCitySlugArea: registerCitySlugArea,
    replayOverrides: replayOverrides
  };
})(window);
