# ADR 0002 — Property Operations: lifecycle, evidence, notifications, audit

- **Status:** Accepted — Founder sign-off 2026-07-26
- **Change class:** **Minor CR** (additive; no frozen contract removed, renamed, or weakened)
- **Architecture version:** v1.1.0 → **v1.2.0**
- **Builds on:** ADR 0001 (admin RBAC). Same mapping precedent, applied to status vocabulary.
- **Frozen items touched:** Doc 17 item **2** (data contracts — additive columns/tables only)
- **Frozen items this change finally *honours* rather than bypasses:** item **4**
  (shared platform services — Evidence Service AM-3.2, Trust-Status Authority AM-3.3,
  Notification Bus FR-A3-1)

---

## 1. Context

ADR 0001 delivered roles, tasks, verification capture and an approval chain.
It left three things done the expedient way:

1. `approvals.js` wrote `listings.status = 'verified_live'` **directly** — a
   direct write to public trust state, which Doc 16 AM-3.3 forbids
   ("none writes the public trust state directly").
2. Verification proof was stored with no hash, no seal, no anti-reuse —
   Doc 16 AM-3.2 requires all four, and Doc 05 §2.2.1 requires
   capture-flow evidence to be "sealed with content hash".
3. Nothing notified anyone of anything.

The Founder has now specified the full operations layer: an 8-state
property lifecycle with complete history, evidence (images/videos/
documents/notes/GPS), a CEO audit showing who/when/why/old/new for every
action, role-targeted notifications, manager performance metrics, and CEO
reports — at a scale of 100 managers, 20 Assistant CEOs, unlimited
cities/areas/properties.

## 2. Problem

The requested status vocabulary is **not** the frozen one.

| Requested | Doc 04 §2.3 frozen `listings.status` |
|---|---|
| Submitted | `intake` |
| Pending Review | `pending_verification` |
| Verified | *(no equivalent — frozen enum has no "verified but unpublished")* |
| Published | `verified_live` |
| Unavailable | `unconfirmed` |
| Rejected | `rejected` |
| Archived | `withdrawn` |
| Deleted | *(no equivalent — and Article 2.4 forbids hard deletes)* |

`listings.status` is a frozen data contract (Doc 17 item 2). Doc 05 §1
separately freezes the *property* lifecycle as a state machine
(`DISCOVERED → REGISTERED → PROFILED → ACTIVE ⇄ DORMANT → RETIRED`),
which is a different axis and is **not** what the brief describes — the
eight requested states are listing/operational states, not physical-asset
states.

## 3. Options considered

**Option A — Rewrite the `listings.status` CHECK to the 8 new values.**
Rejected: renaming contract values is a **Major** change, and every
existing consumer (`/api/locations`, the public site's `verified_live`
filter, migration 0001's integrity rule) would have to change at once.

**Option B — Add a parallel `lifecycle_state` column, projected onto the
frozen `status`. (Chosen.)** The operational vocabulary lives in its own
column; a single service keeps `status` in sync by projection. Every
existing reader of `status` keeps working with unchanged semantics and
never learns the new values. Additive → **Minor CR**.

This is the same manoeuvre ADR 0001 §3 used for roles (`role` +
`frozen_role`), which is now established precedent in this codebase.

### 3.1 The projection

| `lifecycle_state` | → `listings.status` | Public? |
|---|---|---|
| `submitted` | `intake` | no |
| `pending_review` | `pending_verification` | no |
| `verified` | `pending_verification` | no |
| `published` | `verified_live` | **yes** |
| `unavailable` | `unconfirmed` | no |
| `rejected` | `rejected` | no |
| `archived` | `withdrawn` | no |
| `deleted` | `withdrawn` | no |

`pending_review` and `verified` deliberately share a projection: the
frozen enum has no "verified but not yet published" concept, and both
are correctly *not public*. No existing behaviour changes.

## 4. Decision: "Deleted" is a state, never a DELETE

Doc 18 Article 2.4 / NFR-17 forbid hard deletes on business entities.
`deleted` is a lifecycle state on a retained row. The listing, its
media, its verification history and its approval chain all survive —
which is the entire point, since a deleted property is exactly the one a
dispute will later ask about.

`deleted → archived` is a permitted transition (CEO restore). There is no
SQL `DELETE` anywhere in this change.

## 5. Decision: one Trust-Status Authority

`functions/utils/lifecycle.js` becomes the **only** writer of
`listings.lifecycle_state` and `listings.status`. `approvals.js` and
`verifications.js` are refactored to call it instead of updating the
column themselves. This closes the AM-3.3 violation introduced in ADR
0001 §8, rather than leaving it as a known gap.

Enforced structurally, not by convention: `trg_listing_status_guard`
raises if `status` is changed without `lifecycle_state` changing in the
same statement, so a stray `update listings set status=…` fails loudly.

## 6. Decision: one Evidence Service

`functions/utils/evidence.js` owns capture, hash, seal and anti-reuse per
AM-3.2:

- **Hash** — SHA-256 of the uploaded bytes, supplied by the client and
  stored on the row.
- **Seal** — `captured_at`, `device_fingerprint`, `gps_lat/lng` recorded
  alongside, so the evidence carries its provenance.
- **Anti-reuse** — a partial unique index on `sha256` means the same file
  cannot be submitted as proof for two different properties. This is the
  single highest-value anti-fraud control in the whole feature: recycling
  one photo across fifty "visits" is the cheapest possible fabrication.
- **Documents** — the `kind` CHECK gains `'document'` (additive value).

**Honest limitation:** the hash is computed *client-side*. A malicious
client can send a correct-looking hash for bytes it never uploaded. Real
sealing requires server-side hashing of the R2 object (or a capture-only
mobile app, per Doc 05 §2.2.1 "no gallery uploads"). Recorded in §11 as
open, not quietly presented as solved.

## 7. Decision: Notification Bus, not direct sends

Doc 18 Article 4.4: "Notifications must publish through the Notification
Bus — no module sends messages directly." `functions/utils/notify.js` is
the single publisher; modules call `publish(event)` and the bus resolves
recipients from role + area scope. Delivery today is in-app only
(`notifications` table + console badge). Adding WhatsApp/SMS/email later
is a delivery-channel change inside the bus, touching no caller.

## 8. Audit: who / when / why / old / new

`admin_audit_log` gains `before_value jsonb`, `after_value jsonb`,
`reason text` (additive). Every lifecycle transition writes both the
structured diff and a `listing_status_history` row, so the CEO audit can
answer all five questions the brief lists without joining to guesswork.

`listing_status_history` is append-only (trigger), like the verification
history before it.

## 9. Scale

Targets: 100 managers, 20 Assistant CEOs, unlimited cities/areas/properties.

- Composite indexes on the actual dashboard access paths
  (`lifecycle_state + area_node_id`, `verified_by + verified_at`,
  `recipient_id + read_at`), per Doc 04 §1.3.
- Reporting is served by **views over indexed columns**, not per-request
  aggregation in JS. The one exception (`averageResponseHours` in
  monitor.js) is already flagged.
- History tables (`listing_status_history`, `admin_audit_log`,
  `notifications`) are the growth tables. Doc 04 §1.3 wants monthly
  time-range partitioning on this class; **not implemented here** — see
  §11. At 100 managers this is comfortably years away, but it is a
  deliberate deferral, not an oversight.

## 10. AI readiness (architecture only)

`notifications.source` and `listing_status_history.actor_kind` both admit
`'ai'`, so an AI agent's actions are attributable and separable from a
human's in every history table. No AI code ships.

## 11. Open items (explicitly NOT closed)

1. **Client-supplied evidence hashes** (§6). Server-side hashing of the
   R2 object is the real fix.
2. **No partitioning** on history tables (§9).
3. **No SLA/escalation engine** (AM-3.1). The brief's "Pending workload"
   report shows backlog but nothing escalates on a timer. Hand-rolling
   timers is forbidden by Article 4.1, so this correctly waits for the
   shared engine.
4. **MFA still unenforced** (inherited from ADR 0001 §5).
5. **`/api/locations/*` still unauthenticated** (inherited from ADR 0001 §10.2).
6. **Notification delivery is in-app only** — no WhatsApp/SMS/email.
7. **Doc 05 §1 property-level lifecycle** (DISCOVERED…RETIRED) remains
   unimplemented; this ADR covers the listing/operational axis only.

## 12. Rollback

All additive. Drop the new tables, the new columns and the new triggers;
`listings.status` is untouched by the rollback because it was never
repurposed.
