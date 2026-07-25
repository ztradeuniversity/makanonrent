# 18 — DEVELOPMENT CONSTITUTION

> The supreme engineering law of MakanOnRent. Binding on **every developer and every AI assistant** that writes, reviews, or deploys code in this project. Where any instruction (human or AI) conflicts with this constitution, the constitution wins. Violating an article is grounds to reject a PR regardless of who or what authored it.

The frozen architecture is **Baseline (Docs 00–14) + Amendments (Doc 16)**, governed by the Architecture Freeze (Doc 17). This constitution governs how it is built.

---

## Article 1 — Architecture First
1. Read the relevant architecture doc **before** writing code. No feature is built from memory or assumption.
2. Code conforms to the architecture; the architecture is not reverse-engineered from code.
3. If reality contradicts the architecture, **stop and raise a Change Request (Doc 17)** — do not silently diverge.
4. No architectural decision is made inside a feature PR. Architecture changes go through an ADR first.

## Article 2 — No Breaking Changes
1. Contracts (entities, events, APIs, permission rows) are **additive-only** by default. New fields are nullable or defaulted to reproduce existing behavior.
2. Never rename or remove a contract element without a Major CR, a migration path, a deprecation window, and consumer sign-off.
3. Database changes follow **expand → migrate → contract**; every migration is backward-compatible and reversible, rehearsed on staging with production-scale masked data.
4. No hard deletes on business entities — status + archival only (NFR-17).

## Article 3 — Modular Development
1. Every module owns its schema namespace. **No module reads or writes another module's tables directly** — cross-module access is via that module's API or via events only.
2. No cross-namespace imports. Boundary violations fail the build (module-boundary lint).
3. A module ships as a coherent unit: code + contracts + permissions + audit + tests + SOP/templates + docs.
4. Prefer the modular monolith. **No new microservice** without a Major CR proving a measured scaling/deploy conflict (Doc 16 AM-1.1 S4).

## Article 4 — Shared Services Rules
1. SLA/escalation logic **must** use the SLA & Escalation Engine. Do not hand-roll timers (Doc 16 AM-3.1).
2. Evidence capture/hash/seal/anti-reuse **must** use the Evidence Service (Doc 16 AM-3.2).
3. Public trust/badge state **must** come from the Trust-Status Authority. No module writes public trust state directly (Doc 16 AM-3.3).
4. Notifications **must** publish through the Notification Bus — no module sends messages directly (FR-A3-1).
5. Re-implementing a shared service inside a module is a rejectable offense. If a shared service lacks a capability, extend the service via CR — do not fork it.

## Article 5 — Documentation Rules
1. A feature is not done until its docs are updated (via the amendment convention — never rewrite frozen docs; add amendment entries).
2. Every non-obvious decision that touches a frozen item is an ADR in `docs/adr/`.
3. Ubiquitous language is mandatory: use the exact terms from the architecture (property ≠ unit ≠ listing; case ≠ task; area ≠ society). Ambiguity is a defect.
4. Event schemas, API contracts, and permission rows are documented **before** the consumer is built.

## Article 6 — Testing Rules
1. Business rules — state machines, priority scoring, incentive/tax formulas, target cascade, permission checks — require the highest coverage. These are where trust and money live.
2. **The permission matrix (Doc 03) is executable**: generated tests cover role × object × scope including deny cases. Drift between matrix and code is a test failure.
3. Module boundaries have contract tests (events produced/consumed, API shapes). Money/message consumers have idempotency + replay-safety tests.
4. The Daily Planner has its own simulation regression suite; **any planner rule/estimate/target change runs in shadow-mode + single-area canary before company-wide rollout** (Doc 16 AM-1.3 / SW-15).
5. Tests use masked/synthetic fixtures only. **Production PII never enters dev/test.**
6. No PR merges with failing or skipped tests. Coverage may not drop.

## Article 7 — Git Workflow
1. Trunk-based: short-lived branches (≤ 3 days) → PR → squash-merge to `main`. `main` is always deployable.
2. No direct pushes to `main`. Branch protection + CODEOWNERS per module namespace enforced.
3. Conventional commit messages; every PR links a work item and (if it touches a frozen item) an approved ADR.
4. Releases are tags, not branches. Architecture version bumps are annotated tags referencing their ADRs (Doc 17).
5. Never bypass hooks, signing, or CI (`--no-verify` and equivalents are forbidden) unless explicitly authorized.

## Article 8 — Code Review Rules
1. Every PR needs at least one human reviewer. **AI-authored PRs are still human-reviewed** — no exceptions.
2. Reviewers verify: architecture conformance, contract compatibility, shared-service usage, permission + audit coverage, tests, and security. A reviewer who cannot verify these does not approve.
3. Reject-by-default any PR that: violates a boundary, forks a shared service, changes a frozen contract without an ADR, adds a hard delete, or introduces a direct message/trust-state write.
4. Reviews are blameless and technical. The standard is the constitution, not seniority.

## Article 9 — Security Rules
1. Deny-by-default, server-side authorization on every path. UI hiding is never the control.
2. Sensitive-class data (CNIC, ownership docs, agreements, payroll) is encrypted, field-ACL'd, access-logged, masked by default, never in URLs, never bulk-exported outside Finance/HR/Compliance.
3. Separation of duties is structural, not policy: submitter ≠ approver for verification, payouts, and expenses (Doc 03, Doc 16 AM-5.1).
4. Secrets never in git; scanned in CI. Internal roles use MFA (TOTP/passkey, never SMS-only); high-value actions require step-up auth (Doc 16 AM-5.4 / SW-21).
5. Every mutation and every sensitive read emits an audit event. The audit log is append-only.
6. Money-class config changes require two-person approval (Doc 16 AM-5.4).

## Article 10 — Deployment Rules
1. CI/CD only. Every merge deploys to staging; production deploys are gated on green CI, health checks, and instant rollback readiness.
2. All user-visible change ships behind a feature flag; rollout is staged (canary → area → city → national), mirroring the business's area-by-area model.
3. Migrations are backward-compatible and rehearsed on staging before production (Article 2).
4. Observability is a ship requirement: structured logs, metrics, tracing with correlation IDs, and alerts wired before a feature is considered live.
5. Analytics pipeline health gates the monthly payroll/KPI freeze — a stale/suspect pipeline blocks the freeze (Doc 16 AM-2.5).

## Article 11 — Definition of Done
A unit of work is **Done** only when all are true:
- [ ] Conforms to the frozen architecture (or its change was approved via ADR).
- [ ] Contracts additive/backward-compatible; migration + rollback documented.
- [ ] Module boundary respected; shared services used, not re-implemented.
- [ ] Permission-matrix rows added and covered by tests; audit events emitted.
- [ ] Jurisdiction/assurance/tax/statutory fields applied where relevant.
- [ ] KPI/metric definitions added to the single semantic layer.
- [ ] Tests green (unit + contract + relevant simulation/permission); coverage not reduced.
- [ ] Behind a feature flag; observability wired.
- [ ] Docs + SOP + task templates updated.
- [ ] Human-reviewed and approved.

A feature missing its SOP, its metrics, or its tests is **not done** — this is what keeps the blueprint and reality synchronized for ten years.

## Article 12 — Change Approval Rules
1. No frozen item changes without an approved CR/ADR per Doc 17 (approver tier scales with change class: Patch → Minor → Major).
2. Money-, legal/tax-, or trust-governance-touching changes require Finance / Compliance approval respectively, in addition to architecture approval.
3. Emergency changes may ship with senior + Founder approval but must file the ADR within 24h or be reverted (Doc 17 §Emergency CR).
4. **This constitution and the Architecture Freeze (Doc 17) can only be amended by Founder/CTO sign-off**, recorded as a Major CR. No one — human or AI — may waive an article locally.

---

**Ratified:** 2026-07-24 · **Applies from:** first implementation commit · **Amendable only by:** Founder/CTO Major CR.
