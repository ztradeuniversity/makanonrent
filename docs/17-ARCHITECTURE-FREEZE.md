# 17 — ARCHITECTURE-FREEZE

> Governance document. Binding. Supersedes informal agreement, not the architecture itself.

---

## Architecture Version
**v1.0.0 — "Foundation"**

## Freeze Date
**2026-07-24** (effective immediately; remains in force until a version bump per the Versioning Rules below).

## Frozen Baseline
The frozen architecture is **Docs 00–14 (baseline) + Doc 16 (binding amendments)**. Where Doc 16 conflicts with 00–14, Doc 16 wins for the amended item. Doc 15 is the review of record (informational, not part of the buildable contract). This document (17) and the Development Constitution (18) govern how the frozen architecture is implemented and changed.

## Scope of Freeze
Frozen = **must not change without an approved Change Request (CR)**:
1. **Module boundaries & ownership** — the module list (Doc 02) and each module's schema namespace (Doc 04 §1.2).
2. **Data contracts** — root entities, the `city_id` shard key, `jurisdiction` dimension, assurance-level fields, and no-hard-delete rule (Doc 04, Doc 16 AM-1.2 / AM-2.1 / AM-5.2).
3. **Event contracts** — event types and schemas are additive-only; the outbox spine and idempotency rules (Doc 04 §1.1, Doc 16 AM-1.3).
4. **Shared platform services** — SLA & Escalation Engine, Evidence Service, Trust-Status Authority (Doc 16 AM-3.1 / AM-3.2 / AM-3.3). Modules consume them; they do not re-implement them.
5. **Verification economics** — the risk-tiered T0–T3 model and Trust Score inputs (Doc 16 AM-4.1).
6. **Trust & governance controls** — approval independence, identity/title assurance, anti-spoofing, whistleblower channel, money-config dual-control, staffing-stage matrix (Doc 16 AM-5.x).
7. **Permission model** — role set, scoping model, separation-of-duty rules (Doc 03).
8. **Non-negotiable NFRs** — security/privacy (NFR-8/9/10), auditability (NFR-17/18), revocation SLO (Doc 16 AM-3.3), and the deny-by-default RBAC posture.

Out of scope of freeze (may change without a CR, per normal engineering review): UI/copy, config values already declared runtime-tunable (SLA hours, freshness windows, incentive formulas, target templates — NFR-16), template content, non-contract internal implementation details, and the five carried-forward feature designs (Doc 16 final section) at their own module sprints.

## Frozen Modules
All modules in Doc 02 are frozen at the **boundary + contract** level. Implementation inside a frozen boundary is free; the boundary, its schema namespace, its events, and its permission rows are not.

| Domain | Frozen modules |
|---|---|
| A — Platform Core | IAM/RBAC, Master Data, Notification Bus, Document Mgmt, Audit |
| B — Supply | Property Registry, Listing Mgmt, Verification Engine, Freshness Engine, Owner Mgmt, Dealer Mgmt, To-Let Survey |
| C — Demand | Public Website/SEO, Search & Matching, Tenant Mgmt, Visit Scheduling, Trust Services |
| D — Engagement | CRM Core, Lead Mgmt, Communication Hub, Complaints, Internal Chat, Referrals |
| E — Operations | Task System, **Daily Planner Engine**, Targets & Capacity, Field Ops, Marketing Planner, Social Planner |
| F — People | Employee/Recruitment/Training/SOP, KPI, Salary & Incentive (+ statutory layer), Attendance |
| G — Money | Commission & Deal Ledger, Expense, Invoicing (+ Tax module), Budget & Forecast |
| H — Intelligence | Analytics/Reporting, AI Services |
| Platform services | SLA & Escalation Engine, Evidence Service, Trust-Status Authority |

## What Cannot Change Without Approval
The eight items under **Scope of Freeze** above. In one line: **no change to a boundary, a contract, a shared service, the shard/jurisdiction keys, the verification-economics model, the trust/governance controls, the permission model, or a non-negotiable NFR** without an approved CR. A pull request attempting any of these without an approved CR is rejected at review by default.

## Change Request (CR) Process
1. **Raise** — Open a CR as an ADR (Architecture Decision Record) in `docs/adr/`, stating: what frozen item, why, options, chosen change, backward-compatibility + migration plan, blast radius, and rollback.
2. **Classify** — Author proposes change class (Patch / Minor / Major, see Versioning).
3. **Review** — Required approvers by class:
   - **Patch** → module owner + one senior engineer.
   - **Minor** → above + Architecture owner.
   - **Major** → above + Founder/CTO sign-off; if it touches money, legal/tax, or trust-governance, add Finance/Compliance approval respectively.
4. **Merge gate** — CR (ADR) must be **approved and merged before** any implementation PR that depends on it. Implementation PRs link the ADR.
5. **Record** — Approved ADR updates the affected doc via the amendment convention (new amendment entry; existing docs not rewritten), and bumps the Architecture Version.
6. **Emergency CR** — A production-critical fix may merge with a single senior + Founder verbal approval, but the ADR must be filed within 24h and pass full review retroactively, or be reverted.

## Versioning Rules
Semantic versioning of the **architecture** (independent of code versions):
- **MAJOR (x.0.0)** — a breaking contract change: removing/renaming an entity, event, or field; changing the shard key; splitting/merging a module; altering a separation-of-duty or a non-negotiable NFR. Requires a Major CR.
- **MINOR (1.x.0)** — additive, backward-compatible: a new module, new additive event/field, new shared-service capability, new tier/assurance value. Requires a Minor CR.
- **PATCH (1.0.x)** — clarifications, corrections, or config-policy edits that change no contract. Requires a Patch CR.
- **Compatibility guarantee** — no MAJOR bump ships without a documented migration + rollback path and a deprecation window for any consumer of a changed contract.
- **Freeze integrity** — the frozen baseline is a git tag `arch-v1.0.0`. Every version bump is a new tag with the merged ADR(s) referenced in its annotation.
