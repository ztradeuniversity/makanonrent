/* Test stub for '@supabase/supabase-js' — a QUERYABLE fake.

   tests/stub-supabase.js exists only to make pure modules loadable and
   throws if anything touches it. functions/api/properties/detail.js is
   not pure: its whole job is a database read plus a publication gate, so
   testing it needs a client that actually answers.

   This fake answers from DB below, applying only the operations detail.js
   uses (.select / .eq / .limit / .maybeSingle) so the REAL endpoint source
   runs unmodified. Rows are returned WHOLE — the select() column list is
   deliberately ignored — so a test can seed a row carrying private
   columns and prove the endpoint maps an allowlist rather than spreading
   whatever the database handed it. */

export var DB = { listings: [], property_verifications: [] };

export function reset() {
  DB.listings = [];
  DB.property_verifications = [];
}

function matches(row, filters) {
  for (var i = 0; i < filters.length; i++) {
    var f = filters[i];
    if (row[f.col] !== f.val) return false;
  }
  return true;
}

function builder(table) {
  var filters = [];
  var selectStr = '';
  var limitN = Infinity;

  function rows() {
    var all = (DB[table] || []).filter(function (r) { return matches(r, filters); });
    /* `units!inner(...)` is an INNER join: a listing with no unit row is
       not returned at all. Simulated so the endpoint's join can be tested. */
    if (selectStr.indexOf('units!inner') > -1) {
      all = all.filter(function (r) { return !!r.units; });
    }
    if (selectStr.indexOf('properties!inner') > -1) {
      all = all.filter(function (r) { return !!(r.units && r.units.properties); });
    }
    return all.slice(0, limitN);
  }

  var api = {
    select: function (s) { selectStr = s || ''; return api; },
    eq: function (col, val) { filters.push({ col: col, val: val }); return api; },
    limit: function (n) { limitN = n; return Promise.resolve({ data: rows(), error: null }); },
    maybeSingle: function () {
      var r = rows();
      return Promise.resolve({ data: r.length ? r[0] : null, error: null });
    },
    then: function (res, rej) {
      return Promise.resolve({ data: rows(), error: null }).then(res, rej);
    }
  };
  return api;
}

export function createClient() {
  return { from: function (table) { return builder(table); } };
}
