# ADR 0001 — Admin Management System: CEO / Assistant CEO / Manager

- **Status:** Accepted — Founder sign-off recorded 2026-07-26
- **Change class:** **Minor CR** (additive; no frozen contract removed, renamed, or weakened)
- **Architecture version:** v1.0.0 "Foundation" → **v1.1.0**
- **Frozen items touched:** Doc 17 scope item **7** (permission model — *extended*, not replaced) and item **2** (data contracts — additive tables/columns only)
- **Frozen items reviewed and deliberately NOT altered:** Doc 17 item **6** (trust & governance controls — approval independence / separation of duties)
- **Amends:** Doc 03 §1.2, Doc 04 §1.2 (amendment entries; frozen text not rewritten)

---

## 1. Context

The product has no authentication or authorisation layer at all. Every
admin surface shipped so far (`web/location-manager.html`,
`functions/api/locations/publish.js`, `functions/api/locations/cities.js`)
carries an explicit `⚠ ADMIN AUTH IS NOT IMPLEMENTED` warning and is
protected only by URL obscurity. That is acceptable for a pre-launch
location tool and unacceptable for property operations.

The Founder has specified the operational management hierarchy the
business will actually run on:

```
CEO  →  Assistant CEO  →  Manager
```

with area-scoped managers performing field verification of properties,
task targets assigned downward, and a configurable approval chain
before a property is published.

## 2. Problem

The specified 3-role hierarchy does not literally match the frozen
17-role internal model in Doc 03 §1.2, and the specified workflow
("Manager can add properties" + "Manager can verify properties" +
"Auto Publish → manager approval immediately publishes") would, taken
literally, let a single identity create and publish a property with no
independent review.

Doc 17 freezes both of these:

- item **7** — *"Permission model — role set, scoping model,
  separation-of-duty rules (Doc 03)."*
- item **6** — *"Trust & governance controls — approval independence …"*

and Doc 17 §Versioning classifies *"altering a separation-of-duty …"* as
a **MAJOR** change. Doc 18 Article 1.3 forbids silently diverging.

## 3. Options considered

### Option A — Replace the frozen role set with the 3 roles
Drop the other 14 internal roles from the architecture. Simplest
permission table today. **Rejected:** re-introducing Finance,
Compliance, Field Agent, Telesales, HR later each require a fresh Major
CR plus a data migration, and Docs 05–13 reference those roles
throughout, so they would all be invalidated at once.

### Option B — Map the 3 roles onto the frozen role set *(chosen)*
The 3 roles become the **operational admin model** that exists today,
each carrying a `frozen_role` mapping back into Doc 03. The frozen
matrix stays valid and unamended; the remaining roles simply have no
provisioned users yet. Additive → **Minor CR**, not Major.

| Operational role | Doc 03 frozen role | Scope |
|---|---|---|
| CEO | Exec (+ Super Admin break-glass) | Global |
| Assistant CEO | City Manager | City / assigned territory |
| Manager | Area Manager + Field Verification Agent | Assigned area(s) |

> The Manager role intentionally unions two frozen roles. Doc 03 §1.2
> separates them because a Field Agent *captures* evidence and an Area
> Manager *approves* it. That distinction is preserved not by the role
> boundary here but by the separation-of-duty rule in §4 below — the
> control survives even though the job title merged.

### Option C — Implement the workflow exactly as specified
Allow a Manager to add, verify and auto-publish the same property.
**Rejected by the Founder** in favour of Option B + §4.

## 4. Decision: separation of duties is preserved

**A Manager may add properties, and a Manager may verify properties,
but never the same property.**

- Enforced in the database by trigger (`enforce_verification_sod`,
  `enforce_approval_sod` in `migrations/0004_admin_rbac.sql`), not by
  application code and not by UI hiding — per Doc 18 Article 9.1 and
  Doc 03 §3.4 ("enforced structurally, not by policy memo").
- Auto Publish is retained exactly as specified in every other respect:
  when enabled, an approval short-circuits the Assistant CEO and CEO
  tiers and publishes immediately. What it cannot do is collapse
  *submitter* and *approver* into one identity.
- Properties created through the public Submit Wizard have
  `added_by_admin_id IS NULL` and are therefore unaffected — any manager
  may verify them. This is what keeps the change backward-compatible.

**Consequence accepted:** a single-manager area cannot self-serve its
own additions; a second identity (another Manager, the Assistant CEO,
or the CEO) must verify. This is the intended cost of the control.

## 5. Decision: authentication mechanism

Custom credential auth, not Supabase Auth. Rationale: the spec requires
**no self-registration** and admin-created `username + password`
identities; Supabase Auth is email/invite-centric and would put a second
identity store beside `admin_users`. Concretely:

- **PBKDF2-SHA256, 210,000 iterations**, 16-byte random salt, via Web
  Crypto (`crypto.subtle`) — available in the Workers runtime, no
  dependency added.
- Session tokens are 32 bytes of CSPRNG entropy; the **SHA-256 hash** is
  stored, never the token itself, so a database disclosure does not
  yield usable sessions.
- Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`.

### MFA — deliberate, recorded gap
Doc 18 Article 9.4 requires MFA for internal roles. The Founder's spec
specifies username + password only. This ADR does **not** waive Article
9.4; it defers it. `admin_users.totp_secret` and
`admin_users.mfa_enforced` ship in migration 0004 unused, so enabling
TOTP later is additive and needs no migration. **Until MFA is enabled,
Article 9.4 is unmet and this is an open compliance item, not a closed
one.**

## 6. AI readiness (architecture only — no AI implemented)

Per the instruction to prepare, not build:
- `admin_tasks.source` = `'human' | 'ai'` — an AI task assigner writes
  rows with `source='ai'` and needs no schema change.
- `admin_tasks.ai_rationale` (nullable) — reserved for explanation text.
- The CEO monitoring view `admin_manager_overview` is the read model an
  AI performance analyser consumes; it is deliberately a view, not
  hand-rolled per-dashboard SQL.

No AI code, model call, or inference path ships in this change.

## 7. Backward compatibility & migration plan

Additive throughout, per Doc 18 Article 2:
- **New tables only** (`admin_*`, `property_verifications`,
  `property_verification_media`, `property_approvals`).
- **New nullable columns** on `properties` and `listings` via
  `ADD COLUMN IF NOT EXISTS`. Every existing row keeps working with
  `NULL`, which reproduces exactly today's behaviour (no approval chain,
  no admin owner).
- **No hard deletes** (Article 2.4): disable/archive via `status` +
  `archived_at`; property "Remove/Restore" is `archived_at` toggling.
- Migration `0004_admin_rbac.sql` is idempotent (`IF NOT EXISTS`
  throughout) and safe to re-run.

## 8. Blast radius

- Public site, Submit Wizard, and the location bank are **untouched**.
  No existing endpoint changes its request or response shape.
- `functions/api/locations/publish.js` and `cities.js` remain
  unauthenticated in this change; wiring them behind `requireRole` is
  tracked as follow-up work, not silently assumed done.

## 9. Rollback

Drop the new tables and the added columns; no existing data depends on
them. Because every added column is nullable and every added table is
new, rollback is a pure `DROP` with no data reconstruction.

## 10. Open items (explicitly not closed by this ADR)

1. **MFA (Article 9.4)** — schema-ready, not enforced. See §5.
2. **Existing admin endpoints** (`locations/publish`, `locations/cities`)
   still unauthenticated pending follow-up.
3. **Doc 03 / Doc 04 amendment entries** to be appended on merge.
4. ~~Executable permission matrix (Article 6.2)~~ — **done.**
   `tests/permission-matrix.html` imports `rbac.js`, `approval-chain.js`
   and `password.js` directly (via an import map that stubs the Supabase
   bare specifier) and asserts 71 cases including every deny, the
   exhaustive role × capability sweep, the area-scope prefix trap, and
   PBKDF2 round-trips. It is a browser runner rather than a CI job
   because this project has no Node toolchain installed; wiring it into
   CI remains open.
5. **Integration tests** against a live Supabase (the SoD triggers, the
   one-manager-per-area index, append-only enforcement) are NOT written.
   Those constraints are implemented and reviewed but have not been
   executed — see "What I could not verify" in the handover notes.
