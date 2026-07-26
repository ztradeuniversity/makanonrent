/* MakanOnRent — role-based authorisation for the admin console.
   Implements docs/adr/0001-admin-management-rbac.md §3 and the Doc 03
   §2 permission matrix as it applies to the three operational roles.

   PERMISSIONS IS DATA, NOT CODE — deliberately. Doc 18 Article 6.2
   requires the permission matrix to be executable ("generated tests cover
   role × object × scope including deny cases; drift between matrix and
   code is a test failure"). A matrix expressed as scattered if-statements
   cannot be enumerated by a test; this one can. Add capabilities by
   editing the table, never by adding a role check inside a handler. */
import { json } from './cors.js';
import { getServiceClient } from './supabase.js';
import { resolveSession } from './session.js';

export var ROLES = ['ceo', 'assistant_ceo', 'manager'];

/* capability → roles that hold it.
   Read this as the authoritative answer to "who can do what"; the spec in
   the Founder's brief maps onto it one-to-one. */
export var PERMISSIONS = {
  /* — identity management — */
  'users.create.assistant_ceo': ['ceo'],
  'users.create.manager':       ['ceo', 'assistant_ceo'],
  'users.list':                 ['ceo', 'assistant_ceo'],
  'users.toggle_status':        ['ceo', 'assistant_ceo'],
  'users.reset_password':       ['ceo', 'assistant_ceo'],

  /* — area assignment (City → Main → Sub) — */
  'areas.assign':               ['ceo', 'assistant_ceo'],
  'areas.list':                 ['ceo', 'assistant_ceo', 'manager'],

  /* — tasks — */
  'tasks.assign':               ['ceo', 'assistant_ceo'],
  'tasks.list.any':             ['ceo', 'assistant_ceo'],
  'tasks.list.own':             ['ceo', 'assistant_ceo', 'manager'],

  /* — properties — */
  'properties.add':             ['ceo', 'assistant_ceo', 'manager'],
  'properties.edit.assigned':   ['ceo', 'assistant_ceo', 'manager'],
  'properties.verify':          ['ceo', 'assistant_ceo', 'manager'],
  'properties.approve':         ['ceo', 'assistant_ceo', 'manager'],
  'properties.archive':         ['ceo'],
  'properties.restore':         ['ceo'],
  'properties.view.any':        ['ceo', 'assistant_ceo'],

  /* — oversight — */
  'monitor.read':               ['ceo', 'assistant_ceo'],
  'audit.read':                 ['ceo'],
  'comments.create':            ['ceo', 'assistant_ceo', 'manager'],
  'settings.read':              ['ceo', 'assistant_ceo'],
  'settings.write':             ['ceo']
};

export function can(role, capability) {
  var holders = PERMISSIONS[capability];
  if (!holders) return false;          // unknown capability = deny, never allow
  return holders.indexOf(role) > -1;
}

/* Who may act ON whom. "Assistant CEO cannot control CEO" from the brief,
   generalised: authority flows strictly downward and nobody may act on
   themselves (which would let a user re-enable an account the CEO just
   disabled, or reset their own way around must_change_password). */
export function canManageRole(actorRole, targetRole) {
  if (actorRole === 'ceo') return targetRole === 'assistant_ceo' || targetRole === 'manager';
  if (actorRole === 'assistant_ceo') return targetRole === 'manager';
  return false;
}

/* ── request guards ────────────────────────────────────────────────────
   Every handler starts with requireAuth/requireCapability. Returning a
   {response} rather than throwing keeps the handlers flat and makes the
   deny path impossible to forget — you cannot use `auth.user` without
   first having checked `auth.response`. */
export async function requireAuth(context) {
  var session = await resolveSession(context.env, context.request);
  if (!session) {
    return { response: json(context.env, { error: 'Authentication required.' }, 401) };
  }
  return { user: session.user, sessionId: session.sessionId };
}

export async function requireCapability(context, capability) {
  var auth = await requireAuth(context);
  if (auth.response) return auth;

  if (!can(auth.user.role, capability)) {
    return {
      response: json(context.env, {
        error: 'Your role does not permit this action.',
        capability: capability
      }, 403)
    };
  }
  return auth;
}

/* A user who has not yet changed their admin-issued temporary password may
   authenticate and change it, and do nothing else. */
export function requirePasswordChanged(context, user) {
  if (user.must_change_password) {
    return json(context.env, {
      error: 'You must set a new password before continuing.',
      mustChangePassword: true
    }, 403);
  }
  return null;
}

/* ── area scoping ──────────────────────────────────────────────────────
   "Manager cannot access other areas." Doc 03 §3.2: scope is resolved at
   query time; there is no unscoped query path for a scoped role.

   Returns the set of location node_ids a user may act within, or null
   meaning "global, no filter" (CEO only). Assignments cascade downward:
   being assigned a city grants its main and sub locations, which is why
   the caller gets prefixes to match against rather than an exact list. */
export async function getScopeNodeIds(env, user) {
  if (user.role === 'ceo') return null;

  var db = getServiceClient(env);
  var res = await db.from('admin_area_assignments')
    .select('node_id')
    .eq('user_id', user.id)
    .eq('active', true);

  if (res.error) throw res.error;
  return (res.data || []).map(function (r) { return r.node_id; });
}

/* node_id is a path ('lahore/johar-town/block-a'), so descendant checks
   are prefix checks — the same scheme location-bank.js and publish.js use.
   The '/' guard stops 'lahore' from matching 'lahore-cantt'. */
export function isWithinScope(scopeNodeIds, nodeId) {
  if (scopeNodeIds === null) return true;               // CEO
  if (!nodeId) return false;
  for (var i = 0; i < scopeNodeIds.length; i++) {
    var s = scopeNodeIds[i];
    if (nodeId === s || nodeId.indexOf(s + '/') === 0) return true;
  }
  return false;
}

export async function assertAreaScope(env, user, nodeId) {
  var scope = await getScopeNodeIds(env, user);
  if (isWithinScope(scope, nodeId)) return null;
  return json(env, { error: 'That area is outside your assigned scope.' }, 403);
}
