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

/* 'manager' is the "Area Manager" the CEO Team UI shows — same DB role,
   relabelled only. 'field_officer' is new (migration 0012): audited and
   confirmed no existing role covered field data collection. */
export var ROLES = ['ceo', 'assistant_ceo', 'manager', 'field_officer'];

/* capability → roles that hold it.
   Read this as the authoritative answer to "who can do what"; the spec in
   the Founder's brief maps onto it one-to-one. */
export var PERMISSIONS = {
  /* — identity management — */
  /* CEO-only (policy change, audited+approved 2026-08-24): account
     lifecycle — who exists, their credentials, their standing — is CEO
     authority exclusively. Assistant CEO/Manager previously held create/
     reset/edit/toggle for their downward tier; that capability is
     removed here, not merely hidden in the UI. Assistant CEO still SEES
     its hierarchy (users.list) — visibility and account-management
     authority are different capabilities. */
  'users.create.assistant_ceo':  ['ceo'],
  'users.create.manager':        ['ceo'],
  'users.create.field_officer':  ['ceo'],
  'users.list':                  ['ceo', 'assistant_ceo', 'manager'],
  'users.toggle_status':         ['ceo'],
  'users.reset_password':        ['ceo'],
  'users.edit':                  ['ceo'],
  /* CEO assigns/reassigns which Assistant CEO a Manager reports to
     (migration 0014, admin_users.reports_to_user_id). Same CEO-only
     reasoning as the rest of identity management above. */
  'users.set_reports_to':        ['ceo'],

  /* — area assignment (City → Main → Sub) — */
  'areas.assign':               ['ceo', 'assistant_ceo', 'manager'],
  'areas.list':                 ['ceo', 'assistant_ceo', 'manager', 'field_officer'],

  /* — Location Data Bank (Location Manager: City/Main/Sub master data) —
     Distinct from areas.assign, which grants a MANAGER access to areas
     already published here; this is the authority to create/edit/publish
     the master data itself. */
  'locations.manage':           ['ceo', 'assistant_ceo'],

  /* — tasks — */
  'tasks.assign':               ['ceo', 'assistant_ceo'],
  'tasks.list.any':             ['ceo', 'assistant_ceo'],
  'tasks.list.own':             ['ceo', 'assistant_ceo', 'manager', 'field_officer'],

  /* — properties — */
  /* Field Officer = data capture in the field, not approval authority:
     add/edit/verify, never properties.approve/archive/restore. */
  'properties.add':             ['ceo', 'assistant_ceo', 'manager', 'field_officer'],
  'properties.edit.assigned':   ['ceo', 'assistant_ceo', 'manager', 'field_officer'],
  'properties.verify':          ['ceo', 'assistant_ceo', 'manager', 'field_officer'],
  'properties.approve':         ['ceo', 'assistant_ceo', 'manager'],
  'properties.archive':         ['ceo'],
  'properties.restore':         ['ceo'],
  'properties.view.any':        ['ceo', 'assistant_ceo'],

  /* Field Report review (migration 0015). A separate capability from
     properties.approve — reviewing a field VISIT report ("did this FO
     do the work properly, does it need correction") is not the same
     authority as approving a PROPERTY LISTING for publication. Field
     Officer never holds this — they submit reports, they don't review
     their own or anyone else's. */
  'verification.review':        ['ceo', 'assistant_ceo', 'manager'],

  /* — oversight — */
  'monitor.read':               ['ceo', 'assistant_ceo'],
  'audit.read':                 ['ceo'],
  'comments.create':            ['ceo', 'assistant_ceo', 'manager', 'field_officer'],
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
  if (actorRole === 'ceo') return targetRole === 'assistant_ceo' || targetRole === 'manager' || targetRole === 'field_officer';
  if (actorRole === 'assistant_ceo') return targetRole === 'manager' || targetRole === 'field_officer';
  if (actorRole === 'manager') return targetRole === 'field_officer';
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

/* ── Assistant CEO → Area Manager hierarchy (migration 0014) ──────────
   admin_users.reports_to_user_id is the single authoritative link — no
   second hierarchy table. Returns the ACTIVE manager ids reporting to
   this Assistant CEO, or [] if none (an Assistant CEO with nobody
   assigned legitimately sees an empty dashboard, not an error and not
   "everyone"). Callers other than 'ceo' must always pass this through —
   there is no unscoped path for assistant_ceo the way CEO gets `null`
   from getScopeNodeIds. */
export async function getManagedManagerIds(env, assistantCeoUserId) {
  var db = getServiceClient(env);
  var res = await db.from('admin_users')
    .select('id').eq('reports_to_user_id', assistantCeoUserId).eq('role', 'manager').eq('status', 'active');
  if (res.error) throw res.error;
  return (res.data || []).map(function (r) { return r.id; });
}

/* ── hierarchical visibility/authority (governance pass, audited 2026-08-24) ──
   Single source of truth for "which subordinate accounts may this caller
   see or act on" — used both to SCOPE what a list endpoint returns and to
   AUTHORISE a target user id on a mutating request, so the two can never
   drift apart (a dropdown that hides someone the API would still accept
   is exactly the "hidden UI is not enforcement" gap this pass closes).

   Returns null for CEO (global, unrestricted — matches getScopeNodeIds'
   convention). Returns an array of user ids for assistant_ceo/manager:
     assistant_ceo → Managers with reports_to_user_id = self (explicit),
                      union Field Officers whose own active area assignment
                      falls within this Assistant CEO's assigned territory
                      (area-overlap — approved 2026-08-24, "FO visibility
                      remains subject to existing scope and reporting
                      rules"), union FOs who report to self directly even
                      before they hold any area (so a freshly-assigned FO
                      is not invisible to the person who must grant them
                      their first one).
     manager        → the same FO rule one tier down: reports_to = self,
                      union area-overlap with the Manager's own scope.
   Every other role (field_officer) delegates nothing downward → []. */
export async function getVisibleSubordinateIds(env, user) {
  if (user.role === 'ceo') return null;
  if (user.role !== 'assistant_ceo' && user.role !== 'manager') return [];

  var db = getServiceClient(env);
  var scope = await getScopeNodeIds(env, user);

  var foRows = await db.from('admin_area_assignments')
    .select('user_id, node_id, admin_users!admin_area_assignments_user_id_fkey!inner(role, status)')
    .eq('active', true).eq('admin_users.role', 'field_officer').eq('admin_users.status', 'active');
  var foIdsByArea = (!foRows.error ? (foRows.data || []) : [])
    .filter(function (r) { return isWithinScope(scope, r.node_id); })
    .map(function (r) { return r.user_id; });

  var directRes = await db.from('admin_users')
    .select('id').eq('reports_to_user_id', user.id).eq('role', 'field_officer').eq('status', 'active');
  var directFoIds = (!directRes.error ? (directRes.data || []) : []).map(function (r) { return r.id; });

  var foIds = Array.from(new Set(foIdsByArea.concat(directFoIds)));

  if (user.role === 'assistant_ceo') {
    var managerIds = await getManagedManagerIds(env, user.id);
    return managerIds.concat(foIds);
  }
  return foIds;
}

/* ── cascade safety: CHILD_SCOPE ⊆ PARENT_SCOPE after a revoke ────────
   Containment is enforced AT ASSIGN TIME (assignments.js checks the
   assigner's own scope before inserting), so the only way a subordinate's
   area can end up outside their superior's territory is the superior
   later losing that area themselves. Call this AFTER an owner's revoke/
   revoke-all/transfer-out has already committed: it recomputes that
   owner's remaining active scope, finds direct reports (assistant_ceo →
   its Managers; manager → its Field Officers) holding an area no longer
   inside it, and soft-revokes exactly those rows — never a hard delete,
   the row and its history stay queryable exactly like a manual Remove.
   Recurses one hop further per affected child so a Manager's own loss can
   correctly ripple down to that Manager's Field Officers too. */
export async function cascadeInvalidateChildren(env, audit, ownerUserId) {
  var db = getServiceClient(env);
  var owner = await db.from('admin_users').select('id, role').eq('id', ownerUserId).maybeSingle();
  if (owner.error || !owner.data) return;
  if (owner.data.role !== 'assistant_ceo' && owner.data.role !== 'manager') return;

  var scopeRes = await db.from('admin_area_assignments')
    .select('node_id').eq('user_id', ownerUserId).eq('active', true);
  if (scopeRes.error) return;
  var remainingScope = (scopeRes.data || []).map(function (r) { return r.node_id; });

  var childField = owner.data.role === 'assistant_ceo' ? 'manager' : 'field_officer';
  var childRes = await db.from('admin_users')
    .select('id').eq('reports_to_user_id', ownerUserId).eq('role', childField).eq('status', 'active');
  if (childRes.error) return;
  var childIds = (childRes.data || []).map(function (r) { return r.id; });
  if (!childIds.length) return;

  var childRowsRes = await db.from('admin_area_assignments')
    .select('id, user_id, node_id').eq('active', true).in('user_id', childIds);
  if (childRowsRes.error) return;

  var orphaned = (childRowsRes.data || []).filter(function (r) { return !isWithinScope(remainingScope, r.node_id); });
  if (!orphaned.length) return;

  var upd = await db.from('admin_area_assignments')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .in('id', orphaned.map(function (r) { return r.id; }));
  if (upd.error) return;

  if (audit) {
    await audit('cascade_revoke_area', 'admin_area_assignment', ownerUserId, {
      reason: 'Parent scope reduced below a subordinate\'s delegated area.',
      affected: orphaned.map(function (r) { return { userId: r.user_id, nodeId: r.node_id }; })
    });
  }

  var affectedUserIds = Array.from(new Set(orphaned.map(function (r) { return r.user_id; })));
  for (var i = 0; i < affectedUserIds.length; i++) {
    await cascadeInvalidateChildren(env, audit, affectedUserIds[i]);
  }
}
