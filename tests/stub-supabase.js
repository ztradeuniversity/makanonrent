/* Test stub for '@supabase/supabase-js'.

   functions/utils/rbac.js and approval-chain.js pull in supabase.js
   through their import graph, which would otherwise make them
   unloadable outside the Workers bundler. The import map in
   permission-matrix.html points the bare specifier here so the tests
   exercise the REAL rbac.js / approval-chain.js source rather than a
   copy that can silently drift from it.

   Nothing in the pure functions under test touches the database, so the
   stub only has to exist — it is never called. */
export function createClient() {
  return new Proxy({}, {
    get: function () {
      throw new Error('The database must not be reached from a pure-function test.');
    }
  });
}
