/* MakanOnRent — Property Lifecycle / Trust-Status Authority.
   Implements docs/adr/0002-property-operations.md §3–§5.

   THIS MODULE IS THE ONLY THING THAT MAY WRITE listings.lifecycle_state
   OR listings.status. Doc 16 AM-3.3: "One service owns the computed
   public trust state … none writes the public trust state directly."

   ADR 0001 shipped approvals.js writing status='verified_live' inline,
   which was exactly that violation. It is fixed here, and the database
   now refuses the old shortcut: trg_listing_status_guard raises if
   status changes without lifecycle_state changing with it. So this is
   not a convention anyone can quietly forget — it is enforced. */
import { getServiceClient } from './supabase.js';

/* The eight operational states from the brief. */
export var STATES = [
  'submitted', 'pending_review', 'verified', 'published',
  'unavailable', 'rejected', 'archived', 'deleted'
];

/* Projection onto the FROZEN listings.status enum (ADR 0002 §3.1).
   pending_review and verified share a projection deliberately: the frozen
   enum has no "verified but unpublished" value and both are correctly
   not-public. Only 'published' maps to verified_live — that mapping is
   the single place the public site's visibility is decided. */
export var STATUS_PROJECTION = {
  submitted:      'intake',
  pending_review: 'pending_verification',
  verified:       'pending_verification',
  published:      'verified_live',
  unavailable:    'unconfirmed',
  rejected:       'rejected',
  archived:       'withdrawn',
  deleted:        'withdrawn'
};

/* Allowed transitions. A state machine, not a free-for-all: an entity
   must never sit in an undefined condition (Doc 05 §0), and an
   unreachable transition is a bug we want to hear about loudly. */
export var TRANSITIONS = {
  submitted:      ['pending_review', 'rejected', 'archived', 'deleted'],
  pending_review: ['verified', 'unavailable', 'rejected', 'archived', 'deleted'],
  verified:       ['published', 'unavailable', 'rejected', 'archived', 'deleted'],
  published:      ['unavailable', 'rejected', 'archived', 'deleted'],
  unavailable:    ['verified', 'published', 'archived', 'deleted'],
  rejected:       ['pending_review', 'archived', 'deleted'],
  archived:       ['pending_review', 'deleted'],
  /* Restore-from-deleted lands in archived, never straight back to
     published: something removed for a reason gets re-examined, it does
     not silently reappear on the public site. */
  deleted:        ['archived']
};

/* Which roles may drive which transition. Layered ON TOP of the rbac.js
   capability check — this is the transition-level grain that a single
   'properties.approve' capability cannot express. */
export var TRANSITION_ROLES = {
  'submitted->pending_review':  ['ceo', 'assistant_ceo', 'manager'],
  'pending_review->verified':   ['ceo', 'assistant_ceo', 'manager'],
  'pending_review->unavailable':['ceo', 'assistant_ceo', 'manager'],
  'verified->published':        ['ceo', 'assistant_ceo', 'manager'],
  'verified->unavailable':      ['ceo', 'assistant_ceo', 'manager'],
  'published->unavailable':     ['ceo', 'assistant_ceo', 'manager'],
  'unavailable->verified':      ['ceo', 'assistant_ceo', 'manager'],
  'unavailable->published':     ['ceo', 'assistant_ceo'],
  'rejected->pending_review':   ['ceo', 'assistant_ceo'],
  'archived->pending_review':   ['ceo', 'assistant_ceo'],
  /* Rejection is a judgement with consequences for an owner relationship,
     so a lone manager cannot end a property's life on the platform. */
  'submitted->rejected':        ['ceo', 'assistant_ceo'],
  'pending_review->rejected':   ['ceo', 'assistant_ceo'],
  'verified->rejected':         ['ceo', 'assistant_ceo'],
  'published->rejected':        ['ceo', 'assistant_ceo'],
  /* Removal and restoration are CEO-only, matching ADR 0001's
     properties.archive / properties.restore capabilities. */
  'submitted->archived':        ['ceo'],
  'pending_review->archived':   ['ceo'],
  'verified->archived':         ['ceo'],
  'published->archived':        ['ceo'],
  'unavailable->archived':      ['ceo'],
  'rejected->archived':         ['ceo'],
  'submitted->deleted':         ['ceo'],
  'pending_review->deleted':    ['ceo'],
  'verified->deleted':          ['ceo'],
  'published->deleted':         ['ceo'],
  'unavailable->deleted':       ['ceo'],
  'rejected->deleted':          ['ceo'],
  'archived->deleted':          ['ceo'],
  'deleted->archived':          ['ceo']
};

export function canTransition(fromState, toState) {
  var allowed = TRANSITIONS[fromState];
  return !!allowed && allowed.indexOf(toState) > -1;
}

export function roleMayTransition(role, fromState, toState) {
  var roles = TRANSITION_ROLES[fromState + '->' + toState];
  /* Unknown transition = deny. Never fall through to allow: an unlisted
     transition is either a typo or an attack, and both should fail. */
  if (!roles) return false;
  return roles.indexOf(role) > -1;
}

/* Human-readable labels, used by the console and by notification copy so
   the two never disagree about what a state is called. */
export var STATE_LABEL = {
  submitted: 'Submitted', pending_review: 'Pending Review', verified: 'Verified',
  published: 'Published', unavailable: 'Unavailable', rejected: 'Rejected',
  archived: 'Archived', deleted: 'Deleted'
};

/* THE transition function.
   Returns { ok:true, from, to } or { ok:false, error, code }.

   Writes, in one place:
     1. listings.lifecycle_state + the projected status (together — the DB
        guard rejects them apart)
     2. listing_status_history (append-only; who/when/why/old/new)
     3. admin_audit_log via the caller's audit helper

   `reason` is mandatory for the destructive/negative transitions. A
   rejection or removal with no recorded reason is unusable six months
   later when someone asks why. */
var REASON_REQUIRED = ['rejected', 'archived', 'deleted', 'unavailable'];

export async function transition(env, opts) {
  var db = getServiceClient(env);
  var listingId = opts.listingId;
  var toState = opts.toState;
  var actor = opts.actor || null;
  var actorKind = opts.actorKind || (actor ? 'human' : 'system');

  if (STATES.indexOf(toState) === -1) {
    return { ok: false, code: 'bad_state', error: 'Unknown lifecycle state: ' + toState };
  }

  var cur = await db.from('listings')
    .select('id, lifecycle_state, status, archived_at, deleted_at, units!inner(property_id)')
    .eq('id', listingId).maybeSingle();
  if (cur.error) return { ok: false, code: 'db', error: cur.error.message };
  if (!cur.data) return { ok: false, code: 'not_found', error: 'No such listing.' };

  var fromState = cur.data.lifecycle_state || 'submitted';

  if (fromState === toState) {
    return { ok: false, code: 'noop', error: 'That property is already ' + STATE_LABEL[toState] + '.' };
  }
  if (!canTransition(fromState, toState)) {
    return {
      ok: false, code: 'illegal_transition',
      error: STATE_LABEL[fromState] + ' cannot move directly to ' + STATE_LABEL[toState] + '.'
    };
  }
  if (actor && !roleMayTransition(actor.role, fromState, toState)) {
    return {
      ok: false, code: 'forbidden',
      error: 'Your role cannot move a property from ' + STATE_LABEL[fromState] + ' to ' + STATE_LABEL[toState] + '.'
    };
  }
  if (REASON_REQUIRED.indexOf(toState) > -1 && !(opts.reason && String(opts.reason).trim())) {
    return {
      ok: false, code: 'reason_required',
      error: 'A reason is required when marking a property ' + STATE_LABEL[toState] + '.'
    };
  }

  var now = new Date().toISOString();
  var patch = {
    lifecycle_state: toState,
    status: STATUS_PROJECTION[toState],
    lifecycle_changed_at: now,
    lifecycle_changed_by: actor ? actor.id : null
  };

  /* Archive/delete/restore bookkeeping. Note deleted_at is set, never a
     SQL DELETE — the row, its media, its verifications and its approval
     chain all survive (ADR 0002 §4). */
  if (toState === 'archived') {
    patch.archived_at = now;
    patch.archived_by = actor ? actor.id : null;
    patch.deleted_at = null;
    patch.deleted_by = null;
  } else if (toState === 'deleted') {
    patch.deleted_at = now;
    patch.deleted_by = actor ? actor.id : null;
  } else {
    patch.archived_at = null;
    patch.archived_by = null;
    patch.deleted_at = null;
    patch.deleted_by = null;
  }
  if (toState === 'published') patch.published_at = now;

  var upd = await db.from('listings').update(patch).eq('id', listingId);
  if (upd.error) return { ok: false, code: 'db', error: upd.error.message };

  var before = { lifecycle_state: fromState, status: cur.data.status };
  var after = { lifecycle_state: toState, status: STATUS_PROJECTION[toState] };

  var hist = await db.from('listing_status_history').insert({
    listing_id: listingId,
    property_id: cur.data.units ? cur.data.units.property_id : null,
    from_state: fromState,
    to_state: toState,
    actor_id: actor ? actor.id : null,
    actor_role: actor ? actor.role : null,
    actor_kind: actorKind,
    reason: opts.reason || null,
    before_value: before,
    after_value: after
  });
  /* A failed history write must not be swallowed: the brief says "Every
     status change must be stored", so losing the record is a real failure
     even though the state already changed. Surfaced, not hidden. */
  if (hist.error) {
    return {
      ok: true, from: fromState, to: toState,
      warning: 'State changed but history could not be written: ' + hist.error.message
    };
  }

  return { ok: true, from: fromState, to: toState, before: before, after: after };
}

/* Convenience for the console: which moves this actor could make next. */
export function availableTransitions(role, fromState) {
  return (TRANSITIONS[fromState] || []).filter(function (to) {
    return roleMayTransition(role, fromState, to);
  });
}
