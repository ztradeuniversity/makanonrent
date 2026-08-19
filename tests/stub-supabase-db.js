/* Test stub for '@supabase/supabase-js' — a QUERYABLE fake.

   tests/stub-supabase.js exists only to make pure modules loadable and
   throws if anything touches it. Endpoints like
   functions/api/properties/detail.js and functions/api/locations/*.js are
   not pure: their whole job is a database read plus a gate, so testing
   them needs a client that actually answers.

   This fake answers from DB below, applying only the operations those
   endpoints use, so the REAL endpoint source runs unmodified. Rows are
   returned WHOLE — the select() column list is deliberately ignored — so
   a test can seed a row carrying private columns and prove the endpoint
   maps an allowlist rather than spreading whatever the database handed
   it. Writes land back in DB, so a test can assert what a request
   actually persisted (status flips, audit stamps, rows NOT created). */

/* Declared up front rather than created on first write, so a test can
   assert that a table is still EMPTY — reading .length off a table nothing
   has written to yet must give 0, not throw. */
export var DB = {
  /* property chain (migrations 0001, 0005) */
  contacts: [],
  owner_profiles: [],
  property_ownership_claims: [],
  properties: [],
  units: [],
  listings: [],
  property_media: [],
  listing_status_history: [],
  verification_cases: [],
  documents: [],
  /* admin (0004) */
  admin_users: [],
  admin_sessions: [],
  admin_area_assignments: [],
  admin_settings: [],
  admin_audit_log: [],
  property_verifications: [],
  property_approvals: [],
  /* locations (0002) */
  locations: [],
  location_suggestions: [],
  /* notify + push (0007, 0008, 0010) */
  property_notify_requests: [],
  property_alert_sends: [],
  email_delivery_queue: [],
  push_subscriptions: [],
  push_sends: [],
  push_broadcasts: []
};

export function reset() {
  Object.keys(DB).forEach(function (k) { DB[k] = []; });
}

/* Set to a message to make the next write on a table fail, so error
   handling can be exercised without corrupting the fake. */
export var FAIL = { table: null, message: 'stub failure' };

/* The unique indexes that carry a guarantee the code under test relies
   on. Without these the fake would silently accept a duplicate insert and
   a dedup test would pass while the real database rejected nothing —
   which is the opposite of what those tests are for.

   Mirrors the migrations:
     push_sends            uq_push_send            (0010)
     property_alert_sends  uq_property_alert_send  (0008)
     push_subscriptions    endpoint unique         (0010)
     locations             node_id unique          (0002) */
var UNIQUE = {
  push_sends: ['subscription_id', 'listing_id'],
  property_alert_sends: ['request_id', 'listing_id'],
  push_subscriptions: ['endpoint'],
  locations: ['node_id'],
  location_suggestions: null
};

function uniqueClash(table, row) {
  var cols = UNIQUE[table];
  if (!cols) return false;
  return (DB[table] || []).some(function (existing) {
    return cols.every(function (c) { return existing[c] === row[c]; });
  });
}

function norm(v) { return String(v == null ? '' : v).toLowerCase(); }

/* PostgREST's `or=` string: comma-separated `col.op.value` terms, any one
   of which satisfies the filter. approvals.js uses it to pick up listings
   that have no approval_state yet alongside those at the caller's stage,
   so without this the review queue could not be tested at all. */
function matchesOr(row, expr) {
  return String(expr).split(',').some(function (term) {
    var bits = term.trim().split('.');
    if (bits.length < 2) return false;
    var col = bits[0], op = bits[1], raw = bits.slice(2).join('.');
    var v = row[col];
    if (op === 'is') return raw === 'null' ? (v === null || v === undefined) : String(v) === raw;
    if (op === 'eq') return String(v) === raw;
    if (op === 'neq') return String(v) !== raw;
    return false;
  });
}

/* PostgREST allows a filter to address a column on an EMBEDDED resource
   by a dotted path ('units.property_id'), which is how mine.js scopes a
   listing query to the owner's own properties. Walking the path here is
   what makes that filter mean the same thing to the fake. */
function valueAt(row, path) {
  if (path.indexOf('.') === -1) return row[path];
  var parts = path.split('.');
  var cur = row;
  for (var i = 0; i < parts.length; i++) {
    if (cur == null) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

function matches(row, filters) {
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    var v = f.col ? valueAt(row, f.col) : undefined;
    if (f.op === 'or') { if (!matchesOr(row, f.val)) return false; continue; }
    if (f.op === 'eq' && v !== f.val) return false;
    if (f.op === 'in' && (f.val || []).indexOf(v) === -1) return false;
    /* `.is(col, null)` must match a row that never set the column: in SQL
       an absent value IS null, and treating undefined as "not null" here
       silently filtered out rows Postgres would have returned. */
    if (f.op === 'is') {
      if (f.val === null) { if (v !== null && v !== undefined) return false; }
      else if (v !== f.val) return false;
    }
    if (f.op === 'not_is' && v === f.val) return false;
    /* ilike without % is an exact, case-insensitive compare — which is
       exactly how the approval clash check uses it. */
    if (f.op === 'ilike') {
      var pat = String(f.val);
      if (pat.indexOf('%') === -1) { if (norm(v) !== norm(pat)) return false; }
      else if (norm(v).indexOf(norm(pat.replace(/%/g, ''))) === -1) return false;
    }
  }
  return true;
}

function builder(table) {
  var filters = [];
  var selectStr = '';
  var limitN = Infinity;

  /* PostgREST resolves an embedded relation from the foreign key. A row
     the API itself inserted has no nested object, so without this every
     `!inner` join would drop rows that Postgres would have returned —
     which reads as "the record does not exist" instead of "the fake
     cannot join". Only the FKs the code under test actually embeds. */
  var EMBEDS = {
    admin_area_assignments: [
      { rel: 'admin_users', fk: 'user_id', target: 'admin_users', key: 'id' },
      { rel: 'locations', fk: 'node_id', target: 'locations', key: 'node_id' }
    ],
    property_approvals: [
      { rel: 'admin_users', fk: 'actor_id', target: 'admin_users', key: 'id' }
    ],
    property_verifications: [
      { rel: 'admin_users', fk: 'verified_by', target: 'admin_users', key: 'id' }
    ],
    /* listing → unit → property, the chain every property read walks. */
    listings: [{ rel: 'units', fk: 'unit_id', target: 'units', key: 'id' }],
    units: [{ rel: 'properties', fk: 'property_id', target: 'properties', key: 'id' }]
  };

  /* Attaches to the ORIGINAL row rather than a copy: update() writes
     through whatever rows() hands back, so a copy here would silently
     make every update a no-op.

     Recursive, because the embeds nest — `units!inner(properties!inner(…))`
     needs the property attached to the unit, not just the unit to the
     listing. Depth-capped so a cyclic definition cannot spin. */
  function embed(tableName, row, depth) {
    var defs = EMBEDS[tableName];
    if (!defs || !row || depth > 3) return row;
    defs.forEach(function (d) {
      if (selectStr.indexOf(d.rel) === -1) return;
      if (!row[d.rel]) {
        var hit = (DB[d.target] || []).filter(function (x) { return x[d.key] === row[d.fk]; })[0];
        if (hit) row[d.rel] = hit;
      }
      if (row[d.rel]) embed(d.target, row[d.rel], depth + 1);
    });
    return row;
  }

  function resolveEmbeds(row) { return embed(table, row, 0); }

  function rows() {
    var all = (DB[table] || [])
      .map(resolveEmbeds)
      .filter(function (r) { return matches(r, filters); });
    /* `x!inner(...)` is an INNER join: a parent row with no child is not
       returned at all. Simulated so an endpoint's join can be tested. */
    ['units', 'properties', 'admin_users'].forEach(function (rel) {
      if (selectStr.indexOf(rel + '!inner') === -1) return;
      all = all.filter(function (r) {
        return rel === 'properties' ? !!(r.units && r.units.properties) : !!r[rel];
      });
    });
    return all.slice(0, limitN);
  }

  function fail() {
    return FAIL.table === table
      ? { data: null, error: { message: FAIL.message } }
      : null;
  }

  function write(rowsIn, mode, conflictKey) {
    var f = fail();
    if (f) return Promise.resolve(f);
    var list = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
    DB[table] = DB[table] || [];
    var out = [];
    var violation = null;
    list.forEach(function (r) {
      if (violation) return;
      var key = conflictKey || 'node_id';
      var existing = mode === 'upsert'
        ? DB[table].filter(function (x) { return x[key] === r[key]; })[0]
        : null;
      /* A plain INSERT that collides with a unique index fails, exactly as
         Postgres would. upsert is the caller saying "update it instead",
         so it is not a violation. */
      if (!existing && mode === 'insert' && uniqueClash(table, r)) {
        violation = { message: 'duplicate key value violates unique constraint', code: '23505' };
        return;
      }
      if (existing) {
        Object.keys(r).forEach(function (k) { existing[k] = r[k]; });
        out.push(existing);
      } else {
        /* Both locations and location_suggestions declare
           `created_at timestamptz not null default now()`, so a row that
           did not name it still has one. Without this the fake would make
           an endpoint look like it dropped a timestamp it never sets. */
        var copy = Object.assign(
          { id: r.id || ('row-' + (DB[table].length + 1)), created_at: new Date().toISOString() },
          r);
        DB[table].push(copy);
        out.push(copy);
      }
    });
    if (violation) return Promise.resolve({ data: null, error: violation });
    return Promise.resolve({ data: out, error: null });
  }

  var api = {
    select: function (s) { selectStr = s || ''; return api; },
    eq: function (col, val) { filters.push({ op: 'eq', col: col, val: val }); return api; },
    in: function (col, val) { filters.push({ op: 'in', col: col, val: val }); return api; },
    or: function (expr) { filters.push({ op: 'or', col: null, val: expr }); return api; },
    is: function (col, val) { filters.push({ op: 'is', col: col, val: val }); return api; },
    not: function (col, _op, val) { filters.push({ op: 'not_is', col: col, val: val }); return api; },
    ilike: function (col, val) { filters.push({ op: 'ilike', col: col, val: val }); return api; },
    order: function () { return api; },
    /* Returns the builder, not a promise: PostgREST keeps the chain alive
       after .limit(), and approvals.js relies on that by calling .or()
       afterwards. `api` is thenable, so `await q.limit(1)` still resolves
       exactly as before for the callers that end there. */
    limit: function (n) { limitN = n; return api; },
    maybeSingle: function () {
      var f = fail();
      if (f) return Promise.resolve(f);
      var r = rows();
      return Promise.resolve({ data: r.length ? r[0] : null, error: null });
    },
    single: function () {
      var f = fail();
      if (f) return Promise.resolve(f);
      var r = rows();
      return Promise.resolve({ data: r.length ? r[0] : null, error: r.length ? null : { message: 'no rows' } });
    },
    /* `.insert(row).select('id').single()` must resolve to ONE row, the way
       PostgREST does — returning the whole array here made `created.data.id`
       undefined and let a caller carry an undefined id into its next query
       without anything failing loudly. */
    insert: function (r) {
      var res = write(r, 'insert');
      var one = function () {
        return res.then(function (out) {
          if (out.error) return out;
          var rows = out.data || [];
          return rows.length
            ? { data: rows[0], error: null }
            : { data: null, error: { message: 'no rows returned' } };
        });
      };
      return Object.assign(res, {
        select: function () { return { single: one, maybeSingle: one }; }
      });
    },
    upsert: function (r, opts) { return write(r, 'upsert', opts && opts.onConflict); },
    update: function (patch) {
      var chain = {
        eq: function (col, val) {
          filters.push({ op: 'eq', col: col, val: val });
          return chain;
        },
        then: function (resolve, reject) {
          var f = fail();
          if (f) return Promise.resolve(f).then(resolve, reject);
          rows().forEach(function (r) {
            Object.keys(patch).forEach(function (k) { r[k] = patch[k]; });
          });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
      };
      return chain;
    },
    then: function (res, rej) {
      var f = fail();
      return Promise.resolve(f || { data: rows(), error: null }).then(res, rej);
    }
  };
  return api;
}

export function createClient() {
  return { from: function (table) { return builder(table); } };
}
