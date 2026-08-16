/* ══════════════════════════════════════════════════════════════
   MakanOnRent — LOCATION DATA BANK MANAGER
   ------------------------------------------------------------------
   Replaces hand-edited location files as the way locations enter the
   product. Nothing is hardcoded any more: an admin pastes text into
   location-manager.html, this module parses it into Main Areas + Sub
   Areas, and publishing writes it into the Data Bank — after which it
   is immediately searchable everywhere, with no code change.

   RELATIONSHIP TO THE EXISTING FILES (deliberate, not an oversight):
     pk-locations.js + location-fixture.js remain the immutable SEED —
     the baseline cities/areas the product shipped with. They are no
     longer the place new locations are added. The Bank is an override
     layer applied on top at boot, so every previously-working page
     keeps working byte-for-byte while all NEW data flows through here.

   PERSISTENCE
     localStorage today (instant, offline, zero-latency reads), with an
     optional durable sync to Supabase via functions/api/locations/*.
     The Bank is the source of truth the engine is hydrated from; the
     API is a durability + multi-device layer, never a hard dependency,
     so a failed/absent network never breaks search.

   Exposes MOR_BANK. Load AFTER location-fixture.js, BEFORE any page
   controller that reads locations.
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var CFG = root.MOR_CONFIG;
  var LOC = root.MOR_LOC;

  /* ── parser ──────────────────────────────────────────────────
     Accepts the format in the brief:

        Main Area
        Johar Town
        Sub Areas
        Block A
        Block B

     …and, as a fallback when no headers are present, an indentation
     / bullet form (a flush-left line starts a new Main Area, an
     indented or bulleted line is one of its Sub Areas). Tree glyphs,
     bullets and list numbering are stripped either way, so pasting
     back a copied preview round-trips cleanly. */
  var MAIN_HEADER = /^(main\s*area|main\s*areas|area|areas)\s*:?\s*$/i;
  var SUB_HEADER = /^(sub\s*area|sub\s*areas|subarea|subareas|blocks?|sectors?|phases?)\s*:?\s*$/i;
  /* "Also Known As" introduces further NAMES FOR THE MAIN AREA ABOVE —
     not a location tier of its own. Without this the header line itself
     would be read as content and stored as an alias literally called
     "Also Known As". */
  var ALIAS_HEADER = /^(also\s*known\s*as|a\.?k\.?a\.?|alias|aliases|alternat(e|ive)\s*names?|other\s*names?)\s*:?\s*$/i;

  /* Leading tree/bullet/number decoration, e.g. "├── ", "- ", "3. " */
  var DECORATION = /^[\s ]*(?:[├└│]+[-─\s]*|[-•*·—–>]+\s*|\d+[.)]\s+)/;

  function cleanLine(raw) {
    return String(raw)
      .replace(DECORATION, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* A line is "marked" as a child either by leading whitespace or by
     carrying list decoration ("- ", "1. ", tree glyphs). Both count —
     a numbered sub-list is not indented but is still clearly a child,
     which a whitespace-only test would miss. */
  function isMarked(raw) {
    return /^[\s]{2,}/.test(raw) || /^\t/.test(raw) || DECORATION.test(raw);
  }

  function parse(text) {
    var lines = String(text || '').split(/\r?\n/);

    /* If EVERY content line is marked, it is a flat list all at one
       tier (a wholly bulleted or numbered list of main areas) — nothing
       is a child of anything. Only a MIX of bare and marked lines
       expresses a parent/child relationship. */
    var content = lines.filter(function (l) { return cleanLine(l); });
    var allMarked = content.length > 0 && content.every(isMarked);

    var groups = [];
    var current = null;
    var mode = null;          // 'main' | 'sub' once a header has been seen
    var sawHeader = false;

    lines.forEach(function (raw) {
      var line = cleanLine(raw);
      if (!line) return;

      /* One 'Main Area' header introduces ONE main location. The first
         line under it is the canonical name; any further line before the
         next header is another NAME FOR THE SAME PLACE (an alias), as is
         everything under an explicit 'Also Known As' header. "LDA City,
         Lahore", "LDA City", "Lahore Development Authority City" and
         "ایل ڈی اے سٹی" are ONE area whose sub areas belong to all four.
         Repeat the 'Main Area' header to start a genuinely different main
         location — `current = null` is what makes the next line canonical
         again. */
      if (MAIN_HEADER.test(line)) { mode = 'main'; sawHeader = true; current = null; return; }
      if (ALIAS_HEADER.test(line)) { mode = 'alias'; sawHeader = true; return; }
      if (SUB_HEADER.test(line)) { mode = 'sub'; sawHeader = true; return; }

      if (sawHeader) {
        if (mode === 'sub' && current) { current.subs.push(line); return; }
        if ((mode === 'alias' || mode === 'main') && current) { current.aliases.push(line); return; }
        current = { main: line, aliases: [], subs: [] };
        groups.push(current);
        mode = 'main';
        return;
      }

      /* No headers anywhere: fall back to indentation/bullets. A flush-left
         line is its own main area here — without a header there is nothing
         to scope an alias list to, so this path is unchanged. */
      if (allMarked || !isMarked(raw) || !current) {
        current = { main: line, aliases: [], subs: [] };
        groups.push(current);
      } else {
        current.subs.push(line);
      }
    });

    /* De-duplicate case-insensitively, preserving first-seen order. */
    var seenMain = {};
    return groups.filter(function (g) {
      var k = g.main.toLowerCase();
      if (seenMain[k]) return false;
      seenMain[k] = 1;
      return true;
    }).map(function (g) {
      var mainKey = g.main.toLowerCase();
      var seenAlias = {};
      g.aliases = (g.aliases || []).filter(function (a) {
        var k = a.toLowerCase();
        if (seenAlias[k] || k === mainKey) return false;
        seenAlias[k] = 1;
        return true;
      });
      var seenSub = {};
      g.subs = g.subs.filter(function (s) {
        var k = s.toLowerCase();
        if (seenSub[k] || k === mainKey) return false;
        seenSub[k] = 1;
        return true;
      });
      return g;
    });
  }

  /* ── bank store ─────────────────────────────────────────────
     Shape: { version, entries: [{ cityId, main, subs[], publishedAt }] }
     Stored as intent (names), not as engine ids, so the Bank stays
     replayable onto a rebuilt graph and portable to the database. */
  function emptyBank() { return { version: 1, entries: [] }; }

  function read() {
    try {
      var raw = localStorage.getItem(CFG.storage.locationBank);
      var bank = raw ? JSON.parse(raw) : null;
      return (bank && bank.entries) ? bank : emptyBank();
    } catch (e) { return emptyBank(); }
  }

  function write(bank) {
    try { localStorage.setItem(CFG.storage.locationBank, JSON.stringify(bank)); }
    catch (e) { /* quota/private-mode: the engine still holds this session */ }
  }

  /* ── writing into the engine ────────────────────────────────
     Silent adds: a bulk publish must not emit one action-log record
     per node (a 5,000-sub-area city would otherwise write 5,000 log
     entries). The Bank entry itself is the durable record. */
  /* Node ids are deterministic (`parentId + '/' + slug`, the same scheme
     the engine and the fixture both use), so an existing node is found
     by exact id — never by name, which could collide with an identically
     named area in another city ("Block A" exists in dozens of places). */
  function childId(parentId, name) {
    return parentId + '/' + LOC.slugify(name);
  }

  /* explicitId is the node_id the SERVER stores. When it is supplied it
     always wins over a slug derived from the name: the server allows a
     display-name rename that deliberately keeps node_id fixed, so
     re-deriving the id here would invent a SECOND node for the renamed
     location and the picker would list the same place twice with two
     different sub-area sets. */
  function ensure(parentId, name, type, sortOrder, aliases, explicitId) {
    var id = explicitId || childId(parentId, name);
    var node = LOC.getById(id);

    if (node) {
      /* Re-publishing repairs a previously unpublished/disabled area
         and refreshes its ordering, rather than creating a twin. */
      if (!node.active || node.status !== 'approved') LOC.enableLocation(id, { silent: true });
      if (sortOrder != null) LOC.updateLocation(id, { sortOrder: sortOrder }, { silent: true });
      /* Adopt a rename that happened server-side. */
      if (node.name !== name) LOC.updateLocation(id, { name: name }, { silent: true });
      /* updateLocation reindexes on an aliases patch, which is what makes
         every alias searchable against this one node. */
      if (aliases) LOC.updateLocation(id, { aliases: aliases.slice() }, { silent: true });
      return node;
    }

    return LOC.addLocation({
      id: id,
      parentId: parentId, name: name, type: type,
      status: 'approved', source: 'bank',
      aliases: aliases ? aliases.slice() : [],
      sortOrder: sortOrder != null ? sortOrder : 0
    }, { silent: true });
  }

  function applyEntry(entry) {
    var city = LOC.getById(entry.cityId);
    if (!city) return null;

    /* ONE node for the canonical name, carrying every alias — never one
       node per alias. Sub areas hang off this single id, so resolving any
       alias (search indexes them all) reaches the same 29 sub areas. */
    var main = ensure(city.id, entry.main, 'locality', null, entry.aliases || [], entry.nodeId);
    /* Keeps the legacy citySlug|areaSlug lookup (used by slug-based
       URLs and property filtering) resolving for bank-added areas. */
    LOC.registerCitySlugArea(city.slug, main.slug, main.id);
    /* Slug-based URLs must resolve for an alias too, all pointing at the
       canonical node. */
    (entry.aliases || []).forEach(function (a) {
      LOC.registerCitySlugArea(city.slug, LOC.slugify(a), main.id);
    });

    /* subNodes carries the server's real ids (same reasoning as the main
       above); `subs` is the older names-only shape, still accepted so a
       locally-published bank that predates subNodes keeps hydrating. */
    if (entry.subNodes && entry.subNodes.length) {
      entry.subNodes.forEach(function (s, i) {
        if (!s || !s.name) return;
        ensure(main.id, s.name, LOC.SUB_AREA_TYPE, i, null, s.nodeId);
      });
    } else {
      (entry.subs || []).forEach(function (name, i) {
        ensure(main.id, name, LOC.SUB_AREA_TYPE, i);
      });
    }

    return main;
  }

  /* Hydrates the engine from the Bank. Called once at boot (below),
     after the fixture seed so Bank data wins on conflict. */
  function hydrate() {
    var bank = read();
    bank.entries.forEach(applyEntry);
    return bank.entries.length;
  }

  /* ── publish ────────────────────────────────────────────────
     One published group = one Main Area plus its Sub Areas, under a
     city. Re-publishing the same main area MERGES (adds new subs,
     re-orders existing) rather than duplicating — the brief's "no
     duplicated names" rule.

     Async: the local apply below still happens synchronously first (so
     search stays instant even if the caller doesn't await), but the
     returned promise only resolves ok:true once the server sync has
     actually confirmed — a failed sync used to be swallowed here and
     reported as success, which is exactly how locations ended up
     existing only in this browser's localStorage and never in
     Supabase. skipSync callers still get the old fire-and-forget
     behaviour, unchanged. */
  async function publish(cityId, groups, opts) {
    var city = LOC.getById(cityId);
    if (!city) return { ok: false, error: 'Unknown city.' };
    if (!groups || !groups.length) return { ok: false, error: 'Nothing to publish.' };

    var bank = read();
    var now = new Date().toISOString();
    var applied = [];

    groups.forEach(function (g) {
      if (!g.main) return;
      var entry = {
        cityId: cityId, citySlug: city.slug, cityName: city.name,
        main: g.main, aliases: (g.aliases || []).slice(),
        subs: (g.subs || []).slice(), publishedAt: now
      };

      /* Replace an existing Bank entry for the same city+main area so
         the Bank never accumulates conflicting versions of one area. */
      var idx = -1;
      for (var i = 0; i < bank.entries.length; i++) {
        var e = bank.entries[i];
        if (e.cityId === cityId && e.main.toLowerCase() === g.main.toLowerCase()) { idx = i; break; }
      }
      if (idx > -1) bank.entries[idx] = entry; else bank.entries.push(entry);

      var node = applyEntry(entry);
      if (node) applied.push({ mainId: node.id, main: entry.main, subs: entry.subs.length });
    });

    write(bank);

    if (opts && opts.skipSync) {
      return { ok: true, applied: applied, totalEntries: bank.entries.length };
    }

    try {
      var syncRes = await syncToApi(bank);
      return { ok: true, applied: applied, totalEntries: bank.entries.length, sync: syncRes };
    } catch (e) {
      return {
        ok: false, applied: applied, totalEntries: bank.entries.length, syncFailed: true,
        error: 'Saved on this device, but failed to save to the server (' + ((e && e.message) || 'unknown error') +
          '). It will not appear on the site or survive a refresh until this succeeds — try publishing again.'
      };
    }
  }

  /* Removes a published entry from the Bank and disables its nodes.
     Disable (not delete) so any property already referencing the area
     keeps resolving — matches the engine's no-hard-delete stance for
     data that other records may point at. */
  function unpublish(cityId, mainName) {
    var bank = read();
    bank.entries = bank.entries.filter(function (e) {
      return !(e.cityId === cityId && e.main.toLowerCase() === String(mainName).toLowerCase());
    });
    write(bank);

    var main = LOC.getById(childId(cityId, mainName));
    if (main) {
      LOC.getSubAreas(main.id, { includeInactive: true }).forEach(function (s) {
        LOC.disableLocation(s.id, { silent: true });
      });
      LOC.disableLocation(main.id, { silent: true });
    }
    return { ok: true };
  }

  /* ── durable sync (Supabase via Pages Functions) ──────────────
     Rejects (rather than resolving to a falsy "didn't work" value) on
     any failure — no route configured, network failure, or a non-OK
     response — so publish() can tell the admin the truth instead of
     treating "didn't sync" the same as "synced". */
  function syncToApi(bank) {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locationsPublish) {
      return Promise.reject(new Error('Publish sync endpoint is not configured.'));
    }
    return root.fetch(CFG.routes.api.locationsPublish, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bank: bank || read() })
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          throw new Error((data && data.error) || ('Publish sync failed (' + r.status + ')'));
        }
        return data || { synced: true };
      });
    });
  }

  /* Reads the bank AS THE SERVER HAS IT, without touching localStorage.
     This is what the Location Manager's "Published Data" panel renders:
     that panel is a verification surface, so it must show the durable
     database records, never the optimistic local copy that made an
     un-synced publish look successful. Rejects on failure so the panel
     can say "couldn't read" instead of silently showing nothing. */
  function readServer() {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locations) {
      return Promise.reject(new Error('Locations endpoint is not configured.'));
    }
    return root.fetch(CFG.routes.api.locations, { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Could not read published data (' + r.status + ')');
        return r.json();
      })
      .then(function (res) {
        if (!res || !res.bank || !Array.isArray(res.bank.entries)) {
          throw new Error((res && res.warning) || 'Published data unavailable.');
        }
        if (res.warning) throw new Error(res.warning);
        return res.bank;
      });
  }

  /* Pulls the published bank from the server and merges it in. Safe to
     call on any page; a failure is silent because the local Bank and
     fixture already provide a complete, working dataset. */
  function pullFromApi() {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locations) {
      return Promise.resolve({ pulled: 0 });
    }
    return root.fetch(CFG.routes.api.locations)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !res.bank || !res.bank.entries) return { pulled: 0 };
        write(res.bank);
        res.bank.entries.forEach(applyEntry);
        return { pulled: res.bank.entries.length };
      })
      .catch(function () { return { pulled: 0 }; });
  }

  /* ── City master-data sync (Location Manager's City Management) ──
     Best-effort, same pattern as syncToApi/pullFromApi: the local
     engine already applied the change (so the UI never waits on the
     network), this just makes it durable/cross-device. A failure here
     never surfaces as an error to the admin — the city still exists
     for the rest of this session and gets synced on the next
     successful publish/add/rename/delete. */
  function cityApiCall(payload) {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locationsCities) {
      return Promise.resolve({ synced: false });
    }
    return root.fetch(CFG.routes.api.locationsCities, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.ok ? r.json() : { synced: false }; })
      .catch(function () { return { synced: false }; });
  }
  /* Pulls the FULL durable city list (migrations/0003_city_seed.sql +
     every city added since through this panel) into the engine. Without
     this, Step 1's picker would only ever show the handful of cities
     hardcoded in pk-locations.js/location-fixture.js — the district and
     tehsil cities the SQL seed adds would never reach the browser.
     Existing cities are refreshed in place (name, active state); new
     ones are added as root nodes with the server's exact node_id/slug,
     so a later Main Location publish resolves the same parent id the
     server already has. Safe to call on any page; failure is silent,
     same contract as pullFromApi. */
  function pullCitiesFromApi() {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locationsCities) {
      return Promise.resolve({ pulled: 0 });
    }
    return root.fetch(CFG.routes.api.locationsCities)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (res) {
        if (!res || !Array.isArray(res.cities)) return { pulled: 0 };
        res.cities.forEach(function (c) {
          if (!c.nodeId || !c.name) return;
          var node = LOC.getById(c.nodeId);
          if (!node) {
            node = LOC.addLocation({
              id: c.nodeId, parentId: null, name: c.name, type: 'city',
              slug: c.slug || LOC.slugify(c.name), active: c.active !== false,
              status: c.active === false ? 'disabled' : 'approved', source: 'bank'
            }, { silent: true });
          } else {
            if (node.name !== c.name) LOC.updateLocation(c.nodeId, { name: c.name }, { silent: true });
            if (c.active === false && node.active) LOC.disableLocation(c.nodeId, { silent: true });
            else if (c.active !== false && !node.active) LOC.enableLocation(c.nodeId, { silent: true });
          }
        });
        return { pulled: res.cities.length };
      })
      .catch(function () { return { pulled: 0 }; });
  }

  /* ── Published Data mutations (server-authoritative) ──────────
     Unlike the fire-and-forget syncCity* helpers above, these REJECT on
     failure and are awaited by the caller, because the Published Data
     panel reports the database's state: telling the admin a delete
     succeeded when the server refused it is the exact class of bug this
     panel exists to catch. */
  function cityApiStrict(payload) {
    if (!root.fetch || !CFG.routes.api || !CFG.routes.api.locationsCities) {
      return Promise.reject(new Error('Locations endpoint is not configured.'));
    }
    return root.fetch(CFG.routes.api.locationsCities, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (data) {
        if (!r.ok) {
          var err = new Error((data && data.error) || ('Request failed (' + r.status + ')'));
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data || { ok: true };
      });
    });
  }

  /* Deletes a Main or Sub Location on the SERVER. Without confirm the
     server refuses with 409 + a dependents breakdown so the caller can
     show the admin exactly what else would be affected. */
  function deleteNode(nodeId, confirm) {
    return cityApiStrict({ action: 'delete-node', nodeId: nodeId, confirm: !!confirm });
  }

  /* Creates one Main Location (parent = city) or one Sub Location
     (parent = main). `aliases` applies to a Main Location only and lands
     on that single row — it never becomes another location. */
  function addNode(parentNodeId, name, aliases) {
    return cityApiStrict({
      action: 'add-node', parentNodeId: parentNodeId, name: name,
      aliases: aliases || []
    });
  }

  /* Display-name-only rename. node_id is intentionally preserved so sub
     locations, property links and area assignments keep resolving. */
  function renameNode(nodeId, name) {
    return cityApiStrict({ action: 'rename-node', nodeId: nodeId, name: name });
  }

  /* Replaces the Also Known As list on a canonical Main Location. */
  function setAliases(nodeId, aliases) {
    return cityApiStrict({ action: 'set-aliases', nodeId: nodeId, aliases: aliases || [] });
  }

  /* Publishes a single main-location entry (canonical + aliases + subs).
     Upserts by node_id, so this is the ADD and the EDIT path both — the
     canonical name is what derives node_id, so aliases and sub areas can
     be changed freely while the identity stays put. */
  function publishEntry(entry) {
    return syncToApi({ version: 1, entries: [entry] });
  }

  function syncCityAdd(name) { return cityApiCall({ action: 'add', name: name }); }
  function syncCityRename(nodeId, name) { return cityApiCall({ action: 'rename', nodeId: nodeId, name: name }); }
  /* cascade=true after the client's single confirmation dialog — deletes
     every Main/Sub Location under the city too (server: one LIKE query
     on the node_id path, no recursion). */
  function syncCityDelete(nodeId, cascade) { return cityApiCall({ action: 'delete', nodeId: nodeId, cascade: !!cascade }); }
  function syncCityDisable(nodeId) { return cityApiCall({ action: 'disable', nodeId: nodeId }); }
  function syncCityEnable(nodeId) { return cityApiCall({ action: 'enable', nodeId: nodeId }); }
  /* Deletes a Main or Sub Location node (never a city). Always cascades
     server-side — a Main Location without its Subs is never offered. */
  function syncNodeDelete(nodeId) { return cityApiCall({ action: 'delete-node', nodeId: nodeId }); }

  /* ── sub-area suggestions (users may suggest sub areas ONLY) ──
     Enforced here as well as in the UI: the parent must resolve to a
     Main Area, and the created node is always SUB_AREA_TYPE with
     status 'pending'. Nothing goes live without admin approval. */
  function suggestSubArea(input) {
    var parent = LOC.getById(input.parentId);
    if (!parent) return { ok: false, error: 'Choose the main area it belongs to.' };
    if (LOC.MAIN_AREA_TYPES.indexOf(parent.type) === -1) {
      return { ok: false, error: 'Suggestions can only be added inside a main area.' };
    }
    var node = LOC.submitLocation({
      name: input.name, parentId: parent.id, type: LOC.SUB_AREA_TYPE,
      note: input.note || '', suggestedBy: input.suggestedBy || null
    });

    if (root.fetch && CFG.routes.api && CFG.routes.api.locationsSuggest) {
      root.fetch(CFG.routes.api.locationsSuggest, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: input.name, parentId: parent.id, parentName: parent.name,
          note: input.note || ''
        })
      }).catch(function () {});
    }
    return { ok: true, node: node };
  }

  /* ── SEO keyword surface (architecture-ready, per the brief) ──
     Every published node already has a slug; this assembles the
     keyword/permalink rows an SEO or AI-search layer will consume.
     Nothing generates pages yet — no route reads this. */
  function seoIndex(cityId) {
    var out = [];
    var cities = cityId ? [LOC.getById(cityId)] : LOC.listCities();
    cities.filter(Boolean).forEach(function (city) {
      LOC.getMainAreas(city.id).forEach(function (main) {
        out.push({
          path: '/' + city.slug + '/' + main.slug,
          keywords: [main.name, main.name + ' ' + city.name, city.name],
          type: 'main-area'
        });
        LOC.getSubAreas(main.id).forEach(function (sub) {
          out.push({
            path: '/' + city.slug + '/' + main.slug + '/' + sub.slug,
            keywords: [sub.name, sub.name + ' ' + main.name, sub.name + ' ' + city.name],
            type: 'sub-area'
          });
        });
      });
    });
    return out;
  }

  function stats() {
    var bank = read();
    var subs = 0;
    bank.entries.forEach(function (e) { subs += (e.subs || []).length; });
    return { entries: bank.entries.length, mainAreas: bank.entries.length, subAreas: subs };
  }

  root.MOR_BANK = {
    parse: parse,
    publish: publish,
    unpublish: unpublish,
    hydrate: hydrate,
    read: read,
    readServer: readServer,
    deleteNode: deleteNode,
    addNode: addNode,
    renameNode: renameNode,
    setAliases: setAliases,
    publishEntry: publishEntry,
    stats: stats,
    seoIndex: seoIndex,
    suggestSubArea: suggestSubArea,
    syncToApi: syncToApi,
    pullFromApi: pullFromApi,
    syncCityAdd: syncCityAdd,
    syncCityRename: syncCityRename,
    syncCityDelete: syncCityDelete,
    syncCityDisable: syncCityDisable,
    syncCityEnable: syncCityEnable,
    syncNodeDelete: syncNodeDelete,
    pullCitiesFromApi: pullCitiesFromApi
  };

  /* Boot: hydrate the engine from the Bank on every page, so a newly
     published area is searchable immediately and everywhere. Pulling
     the full city list AND the published Main/Sub Location bank is
     best-effort and asynchronous — a page that renders a city/area
     picker at load time re-renders once this resolves so a location
     published from another device/browser isn't missing until a
     manual refresh. pullFromApi() was previously defined but never
     invoked, so Location Manager publishes never reached Property
     Submission, Manage Submission or Frontend Search on a second
     device — this is the fix. */
  hydrate();
  pullCitiesFromApi();
  pullFromApi();
})(window);
