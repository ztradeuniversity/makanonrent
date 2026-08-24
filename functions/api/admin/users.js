/* GET  /api/admin/users        → identities the caller may see
   POST /api/admin/users        → { action: 'create' | 'update' | 'set-status' | 'reset-password', ... }

   Authority flows strictly downward (rbac.canManageRole):
     CEO           → Assistant CEOs, Area Managers ('manager') and Field Officers
     Assistant CEO → Area Managers and Field Officers   ("cannot control CEO")
     Area Manager  → Field Officers only
     Field Officer → nobody

   There is no delete. Doc 18 Article 2.4 forbids hard deletes on business
   entities; the Team UI's "Delete" action is status='archived', which
   preserves every verification and approval the account ever signed. */
import { json, preflight } from '../../utils/cors.js';
import { getServiceClient } from '../../utils/supabase.js';
import { isNonEmptyString } from '../../utils/validate.js';
import { requireAuth, requireCapability, canManageRole, can, getManagedManagerIds, getScopeNodeIds, isWithinScope } from '../../utils/rbac.js';
import { hashPassword, generateTempPassword, validatePasswordStrength } from '../../utils/password.js';
import { revokeAllUserSessions } from '../../utils/session.js';
import { auditFor } from '../../utils/audit.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var FROZEN_ROLE = {
  ceo: 'exec', assistant_ceo: 'city_manager', manager: 'area_manager', field_officer: 'field_officer'
};

/* Downward visibility only, same shape as canManageRole but for LISTING
   rather than acting: a role may see everyone it is entitled to manage,
   never a peer or a superior — that would leak the org chart upward. */
var VISIBLE_ROLES = {
  assistant_ceo: ['manager', 'field_officer'],
  manager: ['field_officer']
};

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'users.list');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var q = db.from('admin_users')
      .select('id, username, full_name, email, role, status, last_login_at, last_verification_at, created_at, reports_to_user_id')
      .neq('status', 'archived')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    /* Assistant CEO hierarchy (migration 0014, approved 2026-08-24):
       VISIBLE_ROLES alone made an Assistant CEO see EVERY manager/FO
       system-wide, not just its own. Managers are scoped to the explicit
       reports_to_user_id link. Field Officers have no equivalent explicit
       link (approved scope: "FO visibility remains subject to existing
       scope and reporting rules"), so they're scoped by the SAME
       area-overlap mechanism already used for properties/tasks — an FO
       whose own active area assignment falls within the Assistant CEO's
       own assigned territory. An Assistant CEO with no managers assigned
       legitimately sees nobody, not everybody. */
    if (auth.user.role === 'assistant_ceo') {
      var managerIds = await getManagedManagerIds(env, auth.user.id);
      var aceoScope = await getScopeNodeIds(env, auth.user);
      var foRows = await db.from('admin_area_assignments')
        .select('user_id, node_id, admin_users!admin_area_assignments_user_id_fkey!inner(role, status)')
        .eq('active', true).eq('admin_users.role', 'field_officer').eq('admin_users.status', 'active');
      var foIds = (!foRows.error ? (foRows.data || []) : [])
        .filter(function (r) { return isWithinScope(aceoScope, r.node_id); })
        .map(function (r) { return r.user_id; });
      var visibleIds = managerIds.concat(foIds);
      q = visibleIds.length ? q.in('id', visibleIds) : q.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      var visible = VISIBLE_ROLES[auth.user.role];
      if (visible) q = q.in('role', visible);
    }

    var res = await q;
    if (res.error) throw res.error;

    return json(env, {
      users: (res.data || []).map(function (u) {
        return {
          id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role,
          status: u.status, lastLoginAt: u.last_login_at,
          lastVerificationAt: u.last_verification_at, createdAt: u.created_at,
          reportsToUserId: u.reports_to_user_id || null,
          /* `manageable` still drives area/task assignment eligibility
             elsewhere (unchanged, canManageRole). Identity-management
             actions (edit/reset/disable/delete) are a NARROWER, now
             CEO-only capability (migration 0014) — the frontend must gate
             those buttons on this, not on `manageable`, or a hidden-but-
             not-actually-blocked action would render for Assistant CEO. */
          manageable: canManageRole(auth.user.role, u.role),
          identityManageable: can(auth.user.role, 'users.edit')
        };
      })
    });
  } catch (e) {
    return json(env, { error: (e && e.message) || 'Could not load users.' }, 500);
  }
}

export async function onRequestPost(context) {
  var env = context.env;
  var auth = await requireAuth(context);
  if (auth.response) return auth.response;

  var body;
  try {
    body = await context.request.json();
  } catch (e) {
    return json(env, { error: 'Request body must be valid JSON.' }, 400);
  }

  try {
    /* getServiceClient() throws when an env var is missing (env.js
       requireEnv) — kept inside this try so a misconfigured deployment
       returns clean JSON instead of an unhandled Cloudflare exception. */
    var db = getServiceClient(env);
    var audit = auditFor(env, auth.user, context.request);

    /* ── create ─────────────────────────────────────────────────────── */
    if (body.action === 'create') {
      var role = body.role;
      if (['assistant_ceo', 'manager', 'field_officer'].indexOf(role) === -1) {
        return json(env, { error: "role must be 'assistant_ceo', 'manager' or 'field_officer'." }, 422);
      }
      var cap = 'users.create.' + role;
      if (!can(auth.user.role, cap)) {
        return json(env, { error: 'Your role cannot create that role.' }, 403);
      }
      if (!isNonEmptyString(body.username, 60)) return json(env, { error: 'username is required.' }, 422);
      if (!isNonEmptyString(body.fullName, 160)) return json(env, { error: 'fullName is required.' }, 422);
      if (!/^[a-zA-Z0-9._-]+$/.test(body.username)) {
        return json(env, { error: 'Username may contain only letters, numbers, dot, underscore and hyphen.' }, 422);
      }
      /* Registered Gmail/email is what the login-time OTP is sent to
         (see functions/api/admin/login.js), so it is required for every
         newly created team member — not optional the way it was when
         email only existed for later self-service verification. */
      if (!isNonEmptyString(body.email, 200) || body.email.indexOf('@') === -1) {
        return json(env, { error: 'A valid Gmail/email is required.' }, 422);
      }
      var email = String(body.email).trim().toLowerCase();

      /* Password is REQUIRED at creation — the CEO/Assistant CEO/Area
         Manager creating this account must set it explicitly. No
         auto-generation fallback: an account the creator never actually
         set a password for is exactly the gap that would let the
         username+password+email+OTP login flow start from a password
         nobody chose. reset-password (below) still generates one, which
         is the correct place for that — a RESET is explicitly requested,
         a CREATE must not be silently substituted. */
      if (!isNonEmptyString(body.password, 200)) {
        return json(env, { error: 'A password is required to create a team member.' }, 422);
      }
      var weak = validatePasswordStrength(body.password);
      if (weak) return json(env, { error: weak }, 422);

      var pw = await hashPassword(body.password);
      var ins = await db.from('admin_users').insert({
        username: String(body.username).trim().toLowerCase(),
        full_name: body.fullName,
        email: email,
        role: role,
        frozen_role: FROZEN_ROLE[role],
        password_hash: pw.hash, password_salt: pw.salt, password_algo: pw.algo,
        must_change_password: true,
        created_by: auth.user.id,
        status: 'active'
      }).select('id, username').single();

      if (ins.error) {
        if (String(ins.error.message || '').indexOf('uq_admin_users_username') > -1) {
          return json(env, { error: 'That username is already taken.' }, 409);
        }
        if (String(ins.error.message || '').indexOf('uq_admin_users_email') > -1) {
          return json(env, { error: 'That email is already registered to another account.' }, 409);
        }
        throw ins.error;
      }

      await audit('create_user', 'admin_user', ins.data.id, { role: role, username: ins.data.username });

      /* No temporaryPassword in this response — the CEO/manager set the
         password themselves, so there is nothing generated to echo back.
         The password itself is never stored in readable form or written
         to the audit detail. */
      return json(env, { ok: true, userId: ins.data.id, username: ins.data.username }, 201);
    }

    /* ── update (edit allowed profile fields) ─────────────────────────── */
    if (body.action === 'update') {
      if (!can(auth.user.role, 'users.edit')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var editTarget = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (editTarget.error) throw editTarget.error;
      if (!editTarget.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, editTarget.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var patchFields = {};
      if (body.fullName != null) {
        if (!isNonEmptyString(body.fullName, 160)) return json(env, { error: 'fullName cannot be empty.' }, 422);
        patchFields.full_name = body.fullName;
      }
      if (body.email != null) {
        if (!isNonEmptyString(body.email, 200) || body.email.indexOf('@') === -1) {
          return json(env, { error: 'A valid email is required.' }, 422);
        }
        patchFields.email = String(body.email).trim().toLowerCase();
        patchFields.email_verified_at = null;
      }
      if (!Object.keys(patchFields).length) {
        return json(env, { error: 'Nothing to update.' }, 422);
      }

      var editUpd = await db.from('admin_users').update(patchFields).eq('id', body.userId);
      if (editUpd.error) {
        if (String(editUpd.error.message || '').indexOf('uq_admin_users_email') > -1) {
          return json(env, { error: 'That email is already registered to another account.' }, 409);
        }
        throw editUpd.error;
      }

      await audit('update_user', 'admin_user', body.userId, { fields: Object.keys(patchFields), username: editTarget.data.username });
      return json(env, { ok: true });
    }

    /* ── set-reports-to (reporting hierarchy) ──────────────────────────
       Manager  → may report to an active Assistant CEO, or nobody (null,
                  meaning "reports to CEO" in practice — unchanged today).
       Field Officer → may report to CEO (null), an active Assistant CEO,
                  or an active Manager — the three options the brief asks
                  for, explicit rather than inferred from location. */
    if (body.action === 'set-reports-to') {
      if (!can(auth.user.role, 'users.set_reports_to')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var mgr = await db.from('admin_users').select('id, role').eq('id', body.userId).maybeSingle();
      if (mgr.error) throw mgr.error;
      if (!mgr.data) return json(env, { error: 'No such user.' }, 404);
      if (['manager', 'field_officer'].indexOf(mgr.data.role) === -1) {
        return json(env, { error: 'Only an Area Manager or Field Officer has a reports-to relationship.' }, 422);
      }

      var reportsTo = null;
      if (body.reportsToUserId != null) {
        if (!isNonEmptyString(body.reportsToUserId, 60)) {
          return json(env, { error: 'reportsToUserId must be a user id or null.' }, 422);
        }
        if (body.reportsToUserId === body.userId) {
          return json(env, { error: 'A team member cannot report to themselves.' }, 422);
        }
        var parent = await db.from('admin_users').select('id, role, status, reports_to_user_id').eq('id', body.reportsToUserId).maybeSingle();
        if (parent.error) throw parent.error;
        if (!parent.data || parent.data.status !== 'active') {
          return json(env, { error: 'reportsToUserId must be an active team member.' }, 422);
        }
        var validParentRole = mgr.data.role === 'manager'
          ? parent.data.role === 'assistant_ceo'
          : (parent.data.role === 'assistant_ceo' || parent.data.role === 'manager');
        if (!validParentRole) {
          return json(env, {
            error: mgr.data.role === 'manager'
              ? 'An Area Manager may only report to an Assistant CEO.'
              : 'A Field Officer may only report to an Assistant CEO or an Area Manager.'
          }, 422);
        }
        /* Circular-hierarchy guard: the only cycle this two-tier-deep
           relationship can form is a Manager whose chosen Assistant CEO
           chain loops back to a Field Officer that itself already
           reports to the Manager being edited — one hop is enough to
           check given the max depth (FO→Manager→AssistantCEO, no deeper
           chain exists in this schema). */
        if (parent.data.reports_to_user_id === body.userId) {
          return json(env, { error: 'That would create a circular reporting relationship.' }, 422);
        }
        reportsTo = body.reportsToUserId;
      }

      var repUpd = await db.from('admin_users').update({ reports_to_user_id: reportsTo }).eq('id', body.userId);
      if (repUpd.error) throw repUpd.error;

      await audit('set_reports_to', 'admin_user', body.userId, { reportsToUserId: reportsTo });
      return json(env, { ok: true });
    }

    /* ── set-status (disable / enable / archive) ─────────────────────── */
    if (body.action === 'set-status') {
      if (!can(auth.user.role, 'users.toggle_status')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);
      if (['active', 'disabled', 'archived'].indexOf(body.status) === -1) {
        return json(env, { error: "status must be 'active', 'disabled' or 'archived'." }, 422);
      }
      if (body.userId === auth.user.id) {
        return json(env, { error: 'You cannot change your own status.' }, 403);
      }

      var target = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, target.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      /* Removal (archive) must resolve any active area assignments first —
         audited root cause of "removed member still owns properties": area
         assignment is how a property's operational owner is derived here
         (there is no per-property assignee column), so an archived user
         left with an active admin_area_assignments row keeps looking like
         the responsible manager for every property in that area. Disable
         is exempt on purpose (spec 3A): it only blocks login, history and
         standing assignments are meant to survive it. */
      if (body.status === 'archived') {
        var active = await db.from('admin_area_assignments')
          .select('id, node_id, scope_level, locations!inner(name)')
          .eq('user_id', body.userId).eq('active', true);
        if (active.error) throw active.error;
        var activeRows = active.data || [];

        if (activeRows.length && !body.resolution) {
          return json(env, {
            error: 'This member still has active area assignments. Choose how to resolve them before removing.',
            needsResolution: true,
            assignments: activeRows.map(function (a) {
              return { id: a.id, nodeId: a.node_id, level: a.scope_level, areaName: a.locations && a.locations.name };
            })
          }, 409);
        }

        if (activeRows.length && body.resolution === 'transfer') {
          if (!isNonEmptyString(body.transferToUserId, 60)) {
            return json(env, { error: 'transferToUserId is required to transfer assignments.' }, 422);
          }
          if (body.transferToUserId === body.userId) {
            return json(env, { error: 'Cannot transfer to the same member being removed.' }, 422);
          }
          var recipient = await db.from('admin_users').select('id, role, status').eq('id', body.transferToUserId).maybeSingle();
          if (recipient.error) throw recipient.error;
          if (!recipient.data || recipient.data.status !== 'active') {
            return json(env, { error: 'Transfer recipient must be an active team member.' }, 422);
          }
          if (recipient.data.role !== target.data.role) {
            return json(env, { error: 'Transfer recipient must hold the same role as the member being removed.' }, 422);
          }
          if (!canManageRole(auth.user.role, recipient.data.role)) {
            return json(env, { error: 'You cannot assign areas to that recipient.' }, 403);
          }

          for (var i = 0; i < activeRows.length; i++) {
            var row = activeRows[i];
            var ins2 = await db.from('admin_area_assignments').insert({
              user_id: body.transferToUserId, node_id: row.node_id, scope_level: row.scope_level,
              scope_role: recipient.data.role, assigned_by: auth.user.id, active: true
            });
            /* uq_area_one_active_manager (migration 0004) legitimately
               blocks a second active manager on the same area — surfaced
               to the CEO rather than silently skipped, since it means the
               transfer is incomplete and needs a manual pick for that one
               area. Field Officer/Assistant CEO transfers are unaffected
               (that constraint is manager-only). */
            if (ins2.error && String(ins2.error.message || '').indexOf('uq_area_one_active_manager') === -1) {
              throw ins2.error;
            }
            if (!ins2.error) {
              await db.from('admin_area_assignments')
                .update({ active: false, revoked_at: new Date().toISOString() }).eq('id', row.id);
            }
          }
          await audit('transfer_assignments', 'admin_user', body.userId,
            { toUserId: body.transferToUserId, count: activeRows.length });
        } else if (activeRows.length && body.resolution === 'unassign') {
          await db.from('admin_area_assignments')
            .update({ active: false, revoked_at: new Date().toISOString() })
            .eq('user_id', body.userId).eq('active', true);
          await audit('unassign_areas', 'admin_user', body.userId, { count: activeRows.length });
        } else if (activeRows.length) {
          return json(env, { error: "resolution must be 'transfer' or 'unassign'." }, 422);
        }
      }

      var patch = { status: body.status };
      if (body.status === 'archived') patch.archived_at = new Date().toISOString();

      var upd = await db.from('admin_users').update(patch).eq('id', body.userId);
      if (upd.error) throw upd.error;

      /* Revocation must be immediate, not at cookie expiry — a disabled
         user loses access on their next request (session.resolveSession
         re-checks status on every call, this kills the token outright). */
      if (body.status !== 'active') await revokeAllUserSessions(env, body.userId);

      await audit('set_user_status', 'admin_user', body.userId,
        { status: body.status, username: target.data.username });
      return json(env, { ok: true });
    }

    /* ── reset-password ─────────────────────────────────────────────── */
    if (body.action === 'reset-password') {
      if (!can(auth.user.role, 'users.reset_password')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var t = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, t.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var temp = generateTempPassword();
      var newPw = await hashPassword(temp);
      var r = await db.from('admin_users').update({
        password_hash: newPw.hash, password_salt: newPw.salt, password_algo: newPw.algo,
        must_change_password: true
      }).eq('id', body.userId);
      if (r.error) throw r.error;

      await revokeAllUserSessions(env, body.userId);
      await audit('reset_password', 'admin_user', body.userId, { username: t.data.username });

      return json(env, { ok: true, temporaryPassword: temp });
    }

    return json(env, { error: "action must be 'create', 'update', 'set-reports-to', 'set-status' or 'reset-password'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'User request failed.' }, 500);
  }
}
