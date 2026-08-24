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
import { requireAuth, requireCapability, canManageRole, can, getVisibleSubordinateIds } from '../../utils/rbac.js';
import { hashPassword, validatePasswordStrength } from '../../utils/password.js';
import { revokeAllUserSessions } from '../../utils/session.js';
import { auditFor } from '../../utils/audit.js';
import { notifyDirect } from '../../utils/notify.js';
import { sendQueuedEmail } from '../../utils/mailer.js';

export async function onRequestOptions(context) {
  return preflight(context.env);
}

var FROZEN_ROLE = {
  ceo: 'exec', assistant_ceo: 'city_manager', manager: 'area_manager', field_officer: 'field_officer'
};

export async function onRequestGet(context) {
  var env = context.env;
  var auth = await requireCapability(context, 'users.list');
  if (auth.response) return auth.response;

  try {
    var db = getServiceClient(env);
    var url = new URL(context.request.url);

    /* Removed/archived history (governance pass, audited 2026-08-24):
       CEO-only — an archived member must NEVER reappear in any active
       operational list (Team, selectors, hierarchy), but Doc 18 Article
       2.4 still requires the CEO be able to inspect who they were and
       when they left. A separate query branch, never merged into the
       active list above, so "?archived=1" cannot accidentally leak a
       removed member back into a selector that forgot to filter. */
    if (url.searchParams.get('archived')) {
      if (auth.user.role !== 'ceo') {
        return json(env, { error: 'Only the CEO can view removed team member history.' }, 403);
      }
      /* history_hidden_at (migration 0017, ISSUE 15/16): a "Permanently
         Remove" is presentation-only — this filter is the entire effect
         of that action. Every other table this account ever touched is
         untouched by it. */
      var arcRes = await db.from('admin_users')
        .select('id, username, full_name, email, role, display_title, status, created_at, archived_at')
        .eq('status', 'archived')
        .is('history_hidden_at', null)
        .order('archived_at', { ascending: false });
      if (arcRes.error) throw arcRes.error;

      var arcRows = arcRes.data || [];
      var arcIds = arcRows.map(function (u) { return u.id; });
      var reportCounts = {};
      var taskCounts = {};
      var areaCounts = {};
      if (arcIds.length) {
        var vRes = await db.from('property_verifications').select('verified_by').in('verified_by', arcIds);
        if (!vRes.error) {
          (vRes.data || []).forEach(function (r) { reportCounts[r.verified_by] = (reportCounts[r.verified_by] || 0) + 1; });
        }
        /* Historical task/area counts (ISSUE 17): "Historical Tasks" and
           "Historical Areas" alongside the report count already computed
           above — same pattern, no new tables, counted straight off the
           tables that already carry the CEO's audit obligation. Revoked
           area rows still exist (never hard-deleted), so this counts ALL
           rows ever held, not just active ones. */
        var tRes = await db.from('admin_tasks').select('assigned_to').in('assigned_to', arcIds);
        if (!tRes.error) {
          (tRes.data || []).forEach(function (r) { taskCounts[r.assigned_to] = (taskCounts[r.assigned_to] || 0) + 1; });
        }
        var aRes = await db.from('admin_area_assignments').select('user_id').in('user_id', arcIds);
        if (!aRes.error) {
          (aRes.data || []).forEach(function (r) { areaCounts[r.user_id] = (areaCounts[r.user_id] || 0) + 1; });
        }
      }

      return json(env, {
        removed: arcRows.map(function (u) {
          return {
            id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role,
            displayTitle: u.display_title || null,
            joinedAt: u.created_at, removedAt: u.archived_at,
            historicalReportCount: reportCounts[u.id] || 0,
            historicalTaskCount: taskCounts[u.id] || 0,
            historicalAreaCount: areaCounts[u.id] || 0
          };
        })
      });
    }

    /* Deep profile / progress (Team redesign, ISSUE 11): real numbers off
       the SAME tables the rest of the console already reads — admin_tasks
       (open/completed), property_verifications (field reports submitted),
       property_verification_reviews (decisions made AS reviewer, and
       decisions received on their OWN submissions). Nothing here is a
       stored or derived-elsewhere metric; every count is a live query, so
       it can never drift from what Verify/Approvals/Monitoring show for
       the same person. Visibility: CEO sees anyone, a scoped caller only
       someone in their own hierarchy or themselves — same rule as the
       Team list itself. */
    var profileId = url.searchParams.get('profile');
    if (profileId) {
      if (auth.user.role !== 'ceo' && profileId !== auth.user.id) {
        var profVisible = await getVisibleSubordinateIds(env, auth.user);
        if (profVisible.indexOf(profileId) === -1) {
          return json(env, { error: 'That team member is outside your own hierarchy.' }, 403);
        }
      }
      var pu = await db.from('admin_users')
        .select('id, username, full_name, email, role, display_title, status, created_at, last_login_at, last_verification_at, reports_to_user_id')
        .eq('id', profileId).maybeSingle();
      if (pu.error) throw pu.error;
      if (!pu.data) return json(env, { error: 'No such user.' }, 404);

      var reportsToName = null;
      if (pu.data.reports_to_user_id) {
        var pParent = await db.from('admin_users').select('full_name').eq('id', pu.data.reports_to_user_id).maybeSingle();
        if (!pParent.error && pParent.data) reportsToName = pParent.data.full_name;
      }

      var areaCountRes = await db.from('admin_area_assignments').select('id', { count: 'exact', head: true }).eq('user_id', profileId).eq('active', true);
      var tasksOpenRes = await db.from('admin_tasks').select('id', { count: 'exact', head: true }).eq('assigned_to', profileId).eq('status', 'open');
      var tasksDoneRes = await db.from('admin_tasks').select('id', { count: 'exact', head: true }).eq('assigned_to', profileId).eq('status', 'completed');
      var reportsSubmittedRes = await db.from('property_verifications').select('id', { count: 'exact', head: true }).eq('verified_by', profileId);
      var reviewedByThemRes = await db.from('property_verification_reviews').select('id', { count: 'exact', head: true }).eq('reviewer_id', profileId).eq('decision', 'reviewed');
      var returnedByThemRes = await db.from('property_verification_reviews').select('id', { count: 'exact', head: true }).eq('reviewer_id', profileId).eq('decision', 'returned');

      /* "Returned reports" ABOUT this person's own submissions — needs the
         verification ids they submitted first, since reviews key off
         verification_id, not the submitter directly. */
      var ownVerifIds = await db.from('property_verifications').select('id').eq('verified_by', profileId).limit(500);
      var ownReturnedCount = 0;
      if (!ownVerifIds.error && (ownVerifIds.data || []).length) {
        var ids = ownVerifIds.data.map(function (r) { return r.id; });
        var ownReturnedRes = await db.from('property_verification_reviews').select('id', { count: 'exact', head: true }).in('verification_id', ids).eq('decision', 'returned');
        if (!ownReturnedRes.error) ownReturnedCount = ownReturnedRes.count || 0;
      }

      return json(env, {
        profile: {
          id: pu.data.id, username: pu.data.username, fullName: pu.data.full_name, email: pu.data.email,
          role: pu.data.role, displayTitle: pu.data.display_title || null, status: pu.data.status,
          createdAt: pu.data.created_at, lastLoginAt: pu.data.last_login_at, lastVerificationAt: pu.data.last_verification_at,
          reportsToName: reportsToName,
          assignedAreaCount: areaCountRes.count || 0,
          tasksOpen: tasksOpenRes.count || 0,
          tasksCompleted: tasksDoneRes.count || 0,
          fieldReportsSubmitted: reportsSubmittedRes.count || 0,
          reportsReviewedByThem: reviewedByThemRes.count || 0,
          reportsReturnedByThem: returnedByThemRes.count || 0,
          ownSubmissionsReturned: ownReturnedCount
        }
      });
    }

    var q = db.from('admin_users')
      .select('id, username, full_name, email, role, display_title, status, last_login_at, last_verification_at, created_at, reports_to_user_id')
      .neq('status', 'archived')
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    /* Hierarchy governance pass (audited 2026-08-24): VISIBLE_ROLES alone
       made both an Assistant CEO AND an Area Manager see every account of
       that role SYSTEM-WIDE, not just their own — confirmed root cause of
       a Manager seeing (and being able to hand areas to) Field Officers
       who report to someone else entirely. getVisibleSubordinateIds is
       the single shared definition of "my hierarchy" also used to
       AUTHORISE area/task assignment targets (assignments.js, tasks.js),
       so this list and what those endpoints will actually accept can
       never drift apart. An Assistant CEO/Manager with nobody assigned
       yet legitimately sees nobody, not everybody. */
    /* CEO (the only other role holding users.list) is intentionally left
       unfiltered here — global authority, matches getScopeNodeIds' null
       convention for scope. */
    if (auth.user.role === 'assistant_ceo' || auth.user.role === 'manager') {
      var visibleIds = await getVisibleSubordinateIds(env, auth.user);
      q = visibleIds.length ? q.in('id', visibleIds) : q.eq('id', '00000000-0000-0000-0000-000000000000');
    }

    var res = await q;
    if (res.error) throw res.error;

    return json(env, {
      users: (res.data || []).map(function (u) {
        return {
          id: u.id, username: u.username, fullName: u.full_name, email: u.email, role: u.role,
          displayTitle: u.display_title || null,
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

      /* Custom designation (migration 0016) — display only, never read by
         canManageRole/can/PERMISSIONS. `role` above is the only thing
         that ever decides what this account can do. */
      var displayTitle = isNonEmptyString(body.displayTitle, 120) ? String(body.displayTitle).trim() : null;

      var pw = await hashPassword(body.password);
      var ins = await db.from('admin_users').insert({
        username: String(body.username).trim().toLowerCase(),
        full_name: body.fullName,
        email: email,
        role: role,
        display_title: displayTitle,
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
      /* Empty string clears the title (falls back to the plain role
         label everywhere it's displayed) — only `undefined`/absent means
         "leave it alone", same convention email/fullName already use via
         `!= null`. */
      if (body.displayTitle != null) {
        var titleTrim = String(body.displayTitle).trim();
        if (titleTrim.length > 120) return json(env, { error: 'Designation must be 120 characters or fewer.' }, 422);
        patchFields.display_title = titleTrim || null;
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

    /* ── message (CEO → one team member, Team redesign ISSUE 14) ──────
       Delivered through the SAME notification bus every other event in
       this console uses (notify.js, reused via notifyDirect — no second
       table) and the SAME shared mailer OTP/task/owner mail already goes
       through (mailer.js — no second provider). Email is best-effort:
       the in-app notification is the guaranteed delivery; a missing or
       unreachable inbox never blocks the message from reaching the
       recipient's dashboard. */
    if (body.action === 'message') {
      if (!can(auth.user.role, 'users.message')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);
      if (!isNonEmptyString(body.body, 4000)) return json(env, { error: 'A message body is required.' }, 422);
      var msgType = ['appreciation', 'general', 'warning', 'important'].indexOf(body.messageType) > -1 ? body.messageType : 'general';

      var msgTarget = await db.from('admin_users').select('id, full_name, email, role, status').eq('id', body.userId).maybeSingle();
      if (msgTarget.error) throw msgTarget.error;
      if (!msgTarget.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, msgTarget.data.role)) {
        return json(env, { error: 'You cannot message that user.' }, 403);
      }

      var msgSeverity = msgType === 'warning' ? 'warning' : msgType === 'important' ? 'critical' : 'info';
      var msgTypeLabel = msgType.charAt(0).toUpperCase() + msgType.slice(1);
      var notifyRes = await notifyDirect(env, {
        recipientId: body.userId, actorId: auth.user.id, severity: msgSeverity,
        title: 'Message from CEO' + (msgType !== 'general' ? ' — ' + msgTypeLabel : ''),
        body: body.body
      });

      var emailSent = false;
      if (msgTarget.data.email) {
        try {
          var mailRes = await sendQueuedEmail(env, db, {
            toEmail: msgTarget.data.email, template: 'ceo_message',
            payload: { recipientName: msgTarget.data.full_name, messageType: msgTypeLabel, body: body.body }
          });
          emailSent = !!mailRes.sent;
        } catch (mailErr) { /* in-app delivery already succeeded; email is a bonus channel */ }
      }

      await audit('message_sent', 'admin_user', body.userId, { messageType: msgType, delivered: notifyRes.sent, emailSent: emailSent });
      return json(env, { ok: true, delivered: notifyRes.sent, emailSent: emailSent });
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
    /* CEO-set, not auto-generated (approved policy change, 2026-08-24) —
       leaving a system-generated password nobody chose is the exact gap
       must_change_password already exists to close on CREATE; a RESET
       should hold to the same bar rather than handing back a string the
       CEO has to relay some other way. generateTempPassword()/the old
       temporaryPassword response field are gone from this action. */
    if (body.action === 'reset-password') {
      if (!can(auth.user.role, 'users.reset_password')) {
        return json(env, { error: 'Your role does not permit this action.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);
      if (!isNonEmptyString(body.newPassword, 200)) {
        return json(env, { error: 'A new password is required.' }, 422);
      }

      var t = await db.from('admin_users').select('id, role, username').eq('id', body.userId).maybeSingle();
      if (t.error) throw t.error;
      if (!t.data) return json(env, { error: 'No such user.' }, 404);
      if (!canManageRole(auth.user.role, t.data.role)) {
        return json(env, { error: 'You cannot manage that user.' }, 403);
      }

      var weakReset = validatePasswordStrength(body.newPassword);
      if (weakReset) return json(env, { error: weakReset }, 422);

      var newPw = await hashPassword(body.newPassword);
      var r = await db.from('admin_users').update({
        password_hash: newPw.hash, password_salt: newPw.salt, password_algo: newPw.algo,
        must_change_password: true
      }).eq('id', body.userId);
      if (r.error) throw r.error;

      /* Old password stops working the instant the row above commits —
         verifyPassword only ever checks the CURRENT hash, there is no
         grace window. Sessions revoked so an already-logged-in device
         cannot keep riding the old credential; any not-yet-verified login
         OTP is consumed so it cannot complete a login that started under
         the old password. */
      await revokeAllUserSessions(env, body.userId);
      await db.from('admin_email_otp')
        .update({ consumed_at: new Date().toISOString() })
        .eq('admin_user_id', body.userId).eq('purpose', 'login').is('consumed_at', null);

      /* Never the password itself — only who/when/target, same as every
         other audit entry in this file. */
      await audit('reset_password', 'admin_user', body.userId, { username: t.data.username });

      return json(env, { ok: true });
    }

    /* ── hide-history: "Permanently Remove" from the Removed Team Members
       presentation list (ISSUE 15/16, migration 0017) ──────────────────
       CEO-only, and only ever on an ALREADY-archived account — this is
       not a faster path to removal, it only changes what the history
       view shows for someone already gone. Sets ONE column
       (history_hidden_at); no other table is touched, so every audit/
       verification/task/assignment record this person ever created
       remains queryable by anyone who still has direct access to those
       tables — this action only removes them from the CEO's Team-history
       UI, nothing else. */
    if (body.action === 'hide-history') {
      if (auth.user.role !== 'ceo') {
        return json(env, { error: 'Only the CEO can permanently remove a former member from history.' }, 403);
      }
      if (!isNonEmptyString(body.userId, 60)) return json(env, { error: 'userId is required.' }, 422);

      var hideTarget = await db.from('admin_users').select('id, username, status').eq('id', body.userId).maybeSingle();
      if (hideTarget.error) throw hideTarget.error;
      if (!hideTarget.data) return json(env, { error: 'No such user.' }, 404);
      if (hideTarget.data.status !== 'archived') {
        return json(env, { error: 'Only an already-removed (archived) team member can be permanently removed from history.' }, 422);
      }

      var hideUpd = await db.from('admin_users').update({ history_hidden_at: new Date().toISOString() }).eq('id', body.userId);
      if (hideUpd.error) throw hideUpd.error;

      await audit('history_hidden', 'admin_user', body.userId, { username: hideTarget.data.username });
      return json(env, { ok: true });
    }

    return json(env, { error: "action must be 'create', 'update', 'set-reports-to', 'set-status', 'reset-password', 'message' or 'hide-history'." }, 422);
  } catch (e) {
    return json(env, { error: (e && e.message) || 'User request failed.' }, 500);
  }
}
