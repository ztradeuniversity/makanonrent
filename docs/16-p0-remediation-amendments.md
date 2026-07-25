# 16 — P0 Remediation: Binding Architecture Amendments

> **Status:** This document closes the P0 (must-fix-before-coding) findings from Doc 15. It is an **amendment layer**, not a redesign. Docs 00–14 remain the baseline; where this document conflicts with them, this document wins for the amended item only. Everything not amended here is unchanged and stands.
> **Compatibility rule:** every amendment is additive or a constraint tightening — no existing entity, event, lifecycle, or permission is removed or renamed. New fields default to values that reproduce today's behavior, so existing designs remain valid.
> **Scope:** the five areas mandated for remediation — Scalability, Production Readiness, Technical Architecture, Verification Economics, Trust & Governance. P0s outside these five (e.g., competitor dossier A-3, deal-leakage A-1) are acknowledged at the end as carried-forward items with an owner, not re-opened here.

Each amendment states: **What** (the change), **Why** (necessity), **Benefit** (long-term), **Amends** (baseline doc).

---

## Area 1 — Scalability (phased, no premature microservices)

### AM-1.1 — Adopt a phased scaling ladder (Phase S1 → S4) with trigger metrics
**What.** Replace the implicit "modular monolith that will scale" with an explicit four-stage ladder. Each stage is entered **only when a trigger metric fires** — never earlier. Complexity is deferred, not avoided.

| Stage | When (trigger) | Data/compute posture | What changes | What does NOT change |
|---|---|---|---|---|
| **S1 — Single node** | Launch → ~1 city, <100k properties, <10 req/s writes | One Postgres primary + 1 read replica; monthly-partitioned hot tables (already in Doc 04); one app + worker pool; object storage + search index + Redis | Nothing new to build — this is Doc 04 as written | Module boundaries, event outbox |
| **S2 — Read + async scale** | Read replica CPU >60% sustained, or search/analytics load impacts OLTP | Add replicas; move all reporting to warehouse; dedicated worker fleets per queue class (planner, notifications, pipelines) | Queue isolation; replica routing | Single primary write node |
| **S3 — Write partitioning by city** | Primary write >40% capacity, or any hot table >~500 GB / partition-maintenance strain | **City is the shard key** (see AM-1.2). Hot append tables (tasks, interactions, notifications, domain_events, audit) physically separated first; then city-sharded writes | Shard router in the data-access layer (already the only path — NFR-14) | Application module code (shard-transparent) |
| **S4 — Selective service extraction** | A module's scaling/deploy cadence provably conflicts with the monolith (measured, not assumed) | Extract that ONE module along its existing boundary + event contract | Only the proven-hot module (candidates: Notifications, Search-indexing, Verification-media) | Everything else stays modular-monolith |

**Why.** The review's SW-3 flagged a single-write-node ceiling with no rehearsed escape. A ladder with triggers gives the escape *without* paying microservice tax on day one. **Benefit.** The team scales by executing a pre-written plan at the moment the metric fires, never by emergency re-architecture on a live national system. **Amends** Doc 04 §1.3, Doc 12 §4.

### AM-1.2 — Fix the shard key now: `city_id` (decided, not deferred)
**What.** Declare **`city_id` the canonical shard/partition key** for all city-scoped data. Every root aggregate (property, listing, verification_case, lead, task, deal, employee) already carries or can carry `city_id`; add it as a mandatory non-null column on those roots at schema creation. Cross-city entities (org, global master data, identities) live in a small **global schema** that is replicated read-only to each shard, never sharded.

**Why.** Choosing the shard key at S1 (when migration is trivial) is the single cheapest scalability decision available; retrofitting it at S3 is the expensive one. City aligns with the org/area **scope model that already exists** (Doc 03) — so sharding reuses the isolation logic RBAC already needs. **Benefit.** S3 becomes a data-relocation exercise, not a code rewrite; also delivers the franchise/multi-org isolation (E-5) and data-residency optionality for free. **Amends** Doc 04 §1.1 (ID/partition strategy).

> Note: `city_id` on a root does not change queries today (single shard = single city set). It is dormant metadata until S3. This preserves backward compatibility exactly.

### AM-1.3 — Event spine hardening: contracts, backpressure, idempotency (minimum viable)
**What.** Keep the single outbox → consumers design (Doc 04). Add only four guarantees, all buildable at S1 with no new infrastructure beyond the queue already assumed:
1. **Versioned, additive-only event schemas** — a schema registry file in-repo; fields are only ever added, never renamed/removed; each event carries `event_type` + `schema_version`.
2. **Independent consumer offsets + per-consumer lag SLO + alert** — one slow consumer cannot stall others; lag breach pages on-call.
3. **Dead-letter + poison-message quarantine** — a bad event is parked and alerted, never blocks the stream.
4. **Idempotency keys on money and message consumers** — incentive computation and every outbound notification are exactly-once via a dedup key; all other consumers are at-least-once with dedup.

**Why.** SW-4: unbounded outbox growth and replay double-counting (which corrupts payroll) are the classic scale failures. These four are the *minimum* that prevents them; nothing more is added. **Benefit.** The integration spine survives a broken consumer and event replays without financial or messaging corruption — the prerequisite for trusting derived KPIs at scale (NFR-18). **Amends** Doc 04 §1.1, Doc 12 §6 (adds event-governance subsection).

### AM-1.4 — Data lifecycle & media cost tiering (the 1M-property storage reality)
**What.** Add a stated lifecycle policy: hot tables age partitions to cold storage after 18–24 months (already hinted, now mandatory); verification **media** gets a derivative-first policy — originals to cold tier after badge issuance + retention window, web derivatives stay hot; a **storage cost model** becomes a Phase-0 artifact (ties to AM-2.4 budget).

**Why.** I-1/SW-1: at 1M properties, media is tens of TB and re-verification multiplies it; unbudgeted cold-tier cost is a silent scalability tax. **Benefit.** Storage cost grows sub-linearly to property count, not linearly. **Amends** Doc 04 §1.3, Doc 12 §2.

---

## Area 2 — Production Readiness (prerequisites, legal, finance/tax, payroll)

### AM-2.1 — Pakistan legal placeholder layer (Phase-0 legal workstream, jurisdiction-aware)
**What.** Introduce **`jurisdiction` (province: Punjab / Sindh / KP / Balochistan / ICT) as a first-class dimension** on the Trust-Services, agreement, tenant-registration, and tax models. Create a **Legal Parameter Register** (master data, counsel-owned, versioned) holding per-province: rent-agreement mandatory terms, security-deposit norms, tenant police-registration procedure, call-recording consent rule, screening-data lawfulness, and blacklist/appeal due-process (B-5) standard. Templates and validations read the register by jurisdiction.

**Why.** SW-10/F-4: the services product generates legal instruments across provinces with divergent law; one defective template used at scale is mass liability. **Benefit.** Legal correctness is configuration maintained by counsel, not code — new provinces onboard by adding a register row, not a release. **Amends** Doc 09 §4 (Trust Services), Doc 05 §3–4.

> These are **placeholders with owners and structure**, not legal drafting — the actual clauses are filled by counsel in Phase 0. The architecture is what must be ready before coding; the legal content is a parallel Phase-0 deliverable.

### AM-2.2 — Tax engine placeholder (jurisdiction-aware)
**What.** Add a **Tax module (G4-Tax)** to Finance-lite: computes provincial **sales-tax-on-services** (PRA/SRB/KPRA/BRA per jurisdiction) on service invoices, **withholding** on commissions and vendor payments, and exposes **filing calendars (FBR + provincial) as recurring planner tasks**. Invoice/receipt schema gains tax lines (additive).

**Why.** SW-11: services and commission revenue attract these taxes from the first rupee; recording money without computing tax is illegal invoicing. **Benefit.** Compliant revenue from day one; back-tax and diligence risk eliminated. **Amends** Doc 04 §2.7 (invoice/receipt entities), Doc 09/Doc 11 (Finance).

### AM-2.3 — Statutory payroll compliance layer
**What.** Extend the Salary module (F6) with a **statutory layer**: EOBI + provincial social security (PESSI/SESSI) registration tracking per employee, provincial **minimum-wage validation**, income-tax withholding per FBR slabs, and compliant contract templates per employment class — with **field-agent employment classification (employee vs commission-agent) flagged for Phase-0 legal opinion.** Statutory filings become recurring planner tasks.

**Why.** F-1: payroll is otherwise illegal from day one, with compounding back-liability. **Benefit.** Legal payroll + audit-ready employment records; removes the top diligence blocker. **Amends** Doc 06 §6.

### AM-2.4 — Budget & Forecast module + operational readiness checklist
**What.** (a) Add **G4-Budget**: per-city/area/department budgets, budget-vs-actual on the City P&L dashboard, cash-flow forecast fed by payroll/expense/collection ledgers, and the **verification-renewal cost curve** (AM-4). (b) Adopt a **Production Readiness Checklist** (below) as the Phase-0 exit gate.

**Operational Readiness Checklist (must be green before coding a module):**
- [ ] Module owns its schema namespace; cross-module access only via API/events (NFR-14)
- [ ] Event contracts registered (AM-1.3); consumers idempotent where money/messages involved
- [ ] Permission-matrix rows exist and are covered by generated tests (Doc 12 §6)
- [ ] Audit events defined for every mutation + sensitive read
- [ ] SLAs/escalations registered with the shared SLA engine (AM-3.1), not hand-rolled
- [ ] Evidence flows use the shared Evidence service (AM-3.2)
- [ ] Jurisdiction dimension applied where legal/tax-relevant (AM-2.1/2.2)
- [ ] KPI/metric definitions added to the single semantic layer (Doc 11)
- [ ] Backfill/rollback + backward-compatible migration plan documented
- [ ] SOP + task templates shipped with the module (Definition of Done, Doc 12 §7)

**Why.** A-2/SW-14: expansion gates cite margins no module computes; and "ready to code" must be a checklist, not a vibe. **Benefit.** Money is planned not just recorded; every module enters implementation against one objective gate. **Amends** Doc 11 (Finance/Analytics), Doc 12 §7 (DoD).

### AM-2.5 — Analytics data-observability (numbers that pay people must be monitored)
**What.** Treat the analytics pipeline as production infrastructure: per-mart **freshness SLA**, row-count/volume monitors, distribution-drift alerts, and a **source-vs-warehouse reconciliation check** that must be green before the monthly payroll/KPI freeze. A stale/suspect pipeline **blocks** payroll freeze rather than paying wrong numbers.

**Why.** SW-14: the semantic layer drives payroll and expansion decisions; a silent pipeline fault pays people wrong and opens cities wrong. **Benefit.** Wrong-pay and wrong-strategy failures become loud and blocked, not silent. **Amends** Doc 11 §1.1.

---

## Area 3 — Technical Architecture (decouple, strengthen boundaries, simplify)

### AM-3.1 — Extract one **SLA & Escalation Engine** (removes 4× duplication)
**What.** Replace the separately-described SLA/escalation timers in Leads, Complaints, Verification, and Tasks with **one platform service**: register `(entity, policy_id, deadline)` → the engine runs timers, fires escalation ladders (config-driven), and emits events. The four modules keep their SLAs as *policy configuration*, not code.

**Why.** SW-6: four implementations of one temporal pattern guarantee drift and quadruple every future change. **Benefit.** SLA behavior changes in one place; new modules get SLAs for free. **Amends** Doc 07 (Tasks), Doc 09 (Leads/Complaints), Doc 05 §2 (Verification) — as a shared dependency, not a rewrite of each.

### AM-3.2 — Extract one **Evidence Service** (capture, hash, seal, anti-reuse)
**What.** Consolidate the capture-flow, hashing, GPS/time-sealing, and perceptual-dedup logic (described in Verification, Field Ops, and Tasks) into **one service** consumed by every evidence-gated task, with per-template plausibility rules layered on top.

**Why.** SW-7/B-4: three reimplementations, and anti-reuse existing only in verification means evidence-gating becomes theater everywhere else. **Benefit.** Uniform, hard-to-fake evidence across all task types; one place to strengthen anti-fraud. **Amends** Doc 05 §2, Doc 07 §1, Doc 13 §1.

### AM-3.3 — Name a single **Trust-Status Authority**
**What.** One service **owns the computed public trust state** of a unit/listing. Verification (issues), Freshness (decays), Complaints (revokes), and Search (displays) all **emit inputs to** or **read outputs from** this authority — none writes the public trust state directly. Revocation/demotion is a **priority, synchronous cache-invalidation path** to the public index (target: seconds).

**Why.** SW-8/E-2/A-5: four writers to one trust-state with no authority guarantees inconsistency, and a revoked-but-still-shown badge is a brand-ending screenshot. **Benefit.** The public badge is always exactly one authority's answer; revocation is fast and consistent. **Amends** Doc 05 §2, Doc 02 (B4/C2), adds one NFR (revocation SLO) to Doc 02 §4.

### AM-3.4 — Physically partition the universal Task table (keep the logical abstraction)
**What.** Keep the universal Task *contract* (a genuine strength). Physically **partition tasks by domain + time** (verification/comms/marketing/hr…) behind the shared interface, with completed tasks aging to cold storage.

**Why.** SW-5: at 100M rows the God-table is the hottest, widest, most-coupled object in the system. **Benefit.** The best abstraction in the architecture stops being its worst scaling bottleneck. **Amends** Doc 04 §2.6, Doc 07 §1.

### AM-3.5 — Collapse Marketing + Social planners into template packs (remove needless split)
**What.** Confirm Marketing Planner and Social Planner are **configuration/template packs on the one Planner Engine**, not two modules with separate code paths (Doc 08 already says "generator plugins" — make it binding).

**Why.** SW-9: two modules where one engine + two template packs suffice is avoidable surface area. **Benefit.** Less code, one planner to maintain and test. **Amends** Doc 08 (framing only; no capability lost).

---

## Area 4 — Verification Economics (multi-tier, risk-based, sub-linear cost)

### AM-4.1 — Replace fixed 90-day field re-verification with a **risk-tiered trust model**
**What.** Verification is no longer "full field visit every 90 days for everything." A per-unit **Trust Score** (0–100, computed) drives which of four re-verification tiers applies and how often:

| Tier | Method | Cost | Applies when |
|---|---|---|---|
| **T0 — Full field** | Certified agent on-site, full evidence (today's flow) | Highest | First-ever verification (always); high-risk score; complaint-triggered; post-anomaly |
| **T1 — Remote video** | Live video walkthrough with owner, agent-guided, recorded+sealed | Medium | Medium-risk renewals; trusted owner, minor time elapsed |
| **T2 — Owner guided self-confirm** | Time-sealed capture link: owner photographs meter/rooms + liveness selfie via portal; AI checks against prior sealed evidence | Low | Low-risk renewals; high-trust owner; unchanged listing |
| **T3 — Passive re-affirm** | One-tap "still available, same terms" + freshness cross-signals (no new media) | Near-zero | Very-high-trust owner, recent T0/T1, short interval |

**Trust Score inputs:** owner history & `identity_assurance_level`, prior verification outcomes, complaint history, re-audit pass record, price/attribute stability, vacancy pattern, dealer quality (if dealer-sourced), AI anomaly signals. Score **decays with time and jumps on any negative signal**, pulling the unit up to a stricter tier automatically.

**Why.** SW-1: fixed quarterly field re-verification is ~11,000 field visits/day at 1M properties (~1,400 agents standing still) — the model's cost bomb. **Benefit.** Operating cost scales with **risk**, not with **property count**: trusted, stable inventory costs near-zero to keep fresh, field labor concentrates where fraud risk actually is. This is the amendment that makes 1M properties economically survivable. **Amends** Doc 05 §2 (adds tiers + Trust Score), Doc 02 (B3/B4).

### AM-4.2 — Public **Trust Status shows method + freshness**, and stricter tiers are the premium
**What.** The public badge exposes *how* trust was last established (field / video / owner-confirmed / re-affirmed) and *when*. A single unified Trust Status (via AM-3.3) with defined precedence. Field-verified is the top signal; cheaper tiers are honestly labeled.

**Why.** A-5: cheaper renewal tiers must not silently dilute the premium badge. **Benefit.** Honesty preserves the trust brand while cost drops; owners can *earn* the premium field badge by behavior. **Amends** Doc 05 §2, Doc 13 §4.2.

### AM-4.3 — Renewal cost curve is modeled and governed
**What.** The Budget module (AM-2.4) tracks projected re-verification cost by tier-mix per area; a target **tier distribution** (e.g., steady-state majority in T2/T3) is a governed operating metric. Sliding backward (too much T0) triggers review.

**Why.** SW-1/SW-2: the treadmill must be *measured* to stay sub-linear. **Benefit.** Verification cost becomes a managed curve, not an emergent surprise. **Amends** Doc 11 (dashboards).

---

## Area 5 — Trust & Governance (remove conflict of interest, strengthen audit)

### AM-5.1 — **Separate trust decisions from area performance** — independent verification approval
**What.** Badge issuance is removed from the Area Manager's sole authority where their volume incentive creates conflict. Concretely:
1. A **risk-tiered independent second review**: AI anomaly score + agent tenure + AM approval-velocity route a **dynamic 15–30% of approvals to a City QC pool / Compliance reviewer outside the area's P&L chain** (replaces the flat 5% sample as the *approval* control; the 5% random re-audit remains as a *post-hoc* control).
2. **A named future end-state:** at multi-city maturity, badge issuance moves to a **central Verification QC function independent of area/city P&L** (org-design commitment now, staffed at Phase 5).
3. **KPI reweight + clawback:** Area Manager integrity KPI weight ≥ volume KPI weight; integrity breaches **claw back prior-period volume incentives** via the clawback ledger (F-6), not just zero the current month.

**Why.** B-1: an approver paid on the volume they approve is exactly how "verified" rots under quarter-end pressure. **Benefit.** Trust decisions are structurally insulated from the performance pressure that corrupts them — the core defensibility of the whole company. **Amends** Doc 05 §2.2, Doc 06 §4–6.

### AM-5.2 — Owner **identity assurance level** + title/encumbrance check
**What.** Add `identity_assurance_level` (self-declared / CNIC-photo / CNIC-original-with-liveness / NADRA-Verisys-verified) and `title_assurance_level` (claimed / evidence-graded / encumbrance-checked) to the owner/verification model. NADRA-Verisys via authorized channel is the target rail; until integrated, T0 mandates CNIC-original-in-hand photo + owner liveness selfie in the sealed flow. Verification checklist gains **encumbrance/litigation red-flag questions**; public T&Cs state precisely what "verified" does and does not guarantee.

**Why.** B-2/SW-12: identity by photocopy and a badge that implies clean title are both brand-existential fraud/liability vectors. **Benefit.** Assurance is explicit and gradable, liability is bounded by honest scope language, and higher assurance can gate the premium tier. **Amends** Doc 04 §2.3–2.4, Doc 05 §2–3.

### AM-5.3 — Field-app anti-spoofing + all-evidence anti-reuse
**What.** Field-app requirements gain: platform integrity API (Play Integrity), mock-location detection, GPS+cell+wifi consistency cross-check, EXIF/time-skew validation, and **randomized in-visit challenges** ("photograph the meter serial now"). Anti-reuse (via the AM-3.2 Evidence Service) applies to **all** evidence classes, not just verification.

**Why.** B-3/B-4: spoofed GPS + recycled media let an agent fabricate visits from home; evidence-gating outside verification is currently unchecked. **Benefit.** Fabrication becomes hard across the board; the planner's evidence-gating is real everywhere. **Amends** Doc 13 §1.2, Doc 05 §2.2.

### AM-5.4 — Governance controls that scale past the founder
**What.** Three additions: (1) an **anonymous whistleblower channel** to Compliance/Founder outside all area chains, with case SLA + anti-retaliation policy (F-3); (2) **two-person approval + Founder digest** for money-class config changes (incentive formulas, commission tables, tier thresholds) (F-7); (3) a **governance-evolution note**: thresholded delegation tiers now, an independent Compliance/Internal-Audit function reporting outside the operating chain by Phase 5, and documented succession for every single-point-of-authority role (SW-13).

**Why.** F-3/F-7/SW-13: AM-collusion is the top fraud scenario with no safe reporting path; money-config is a single-account attack surface; founder-as-backstop is bus-factor-1. **Benefit.** Fraud has a safe exit, the money machine can't be silently re-tuned, and control survives the founder scaling out. **Amends** Doc 03 §3, Doc 06, Doc 11 §3.

### AM-5.5 — Staffing-stage matrix (which separations survive role-collapse)
**What.** A one-page matrix: for each phase's real headcount, which roles are combined, which **separations-of-duty are non-negotiable even when combined** (verification submit≠approve; payout draft≠approve; the whistleblower channel always bypasses the chain), and which are consciously waived with a **named compensating control** (e.g., founder weekly re-audit while acting as Compliance).

**Why.** C-1: the 16-role model meets a 4-person launch reality in week one; without this, teams either share accounts (audit dies) or take Super Admin (RBAC dies). **Benefit.** The control architecture stays intact at small scale instead of being bypassed. **Amends** Doc 03 (adds staffing-stage matrix).

---

## Carried-Forward P0s (outside the 5 mandated areas — not re-opened, assigned)

These P0s from Doc 15 are **not** closed by this document because they fall outside the five remediation areas. They are business/product decisions, not architecture blockers, and are assigned owners with a due gate. Coding of the **core platform** may begin; these gate the **specific features** they touch.

| P0 | Owner | Gate | Note |
|---|---|---|---|
| A-1 Deal leakage | Founder / Product | Before Deal/commission module build | Detection workflow + bundled-services economics + Leakage guardrail metric |
| A-3 Competitor dossier | Founder / Product | Phase-0 exit | Living teardown of Zameen/Graana/OLX + dealer economics |
| D-1 Comms infra to Phase 1 | Product / Eng | Before CRM module build | Tracked telephony + WhatsApp API are R2 infra (roadmap reorder, not architecture change) |
| D-2 Multi-SIM contact merge | Eng | Before CRM module build | Contact alternate-numbers + merge queue (additive to contact model) |
| SW-2 Supply/demand governor | Product / Ops | Before target-generation build | Verification target = f(measured demand) per area |

**Why carried, not closed here:** each is a bounded feature-level design, safe to finalize during its module's design sprint using the amended foundation above; none blocks the platform skeleton, schema, or governance that must be frozen first.

---

## Final Assessment

### Remaining P0 issues (architecture-blocking)
**None.** Every architecture-blocking P0 (scalability ceiling, event-spine integrity, coupling/duplication, verification economics, trust-conflict, legal/tax/payroll placeholders, identity/anti-fraud) is closed by amendments AM-1.1 → AM-5.5 above. The five carried-forward items are **feature-level**, owner-assigned, and gated at their specific module builds — they do not block freezing the foundation or starting core implementation.

### Architecture Ready for Coding? **YES — conditionally frozen.**
The **platform foundation** (schema with `city_id` shard key + jurisdiction dimension + assurance levels + tax/statutory fields, event spine with contracts+idempotency, the three extracted platform services — SLA, Evidence, Trust-Status, the risk-tiered verification model, and the governance/staffing controls) is ready to freeze and build. The **five carried-forward features** finalize their design during their own module sprints against this frozen foundation.

### Scores (post-remediation)

| Dimension | Pre (Doc 15 Wave-2) | **Post-Remediation** | Driver |
|---|---|---|---|
| **Architecture Readiness** | 7.0 | **8.7** | Coupling removed (AM-3.1/3.2/3.3), task table de-risked (AM-3.4), boundaries + DoD gate explicit |
| **Production Readiness** | 5.0 | **8.5** | Legal/tax/payroll placeholders structured (AM-2.1/2.2/2.3), readiness checklist + data-observability (AM-2.4/2.5); remaining gap is executing the Phase-0 legal/counsel content, not architecture |
| **Scalability** | 5.5 | **8.6** | Phased ladder + decided shard key + hardened event spine + tiered verification make 1M properties an executable path, not an aspiration |
| **Technical Architecture** | 7.0 | **8.6** | Three shared services eliminate 4× duplication; God-table partitioned; needless module split collapsed; simplicity preserved (no premature microservices) |
| **Verification Economics** | (implied ~5) | **8.8** | Risk-tiered T0–T3 model makes cost scale with risk not count — the decisive fix |
| **Trust & Governance** | 6.0–6.5 | **8.7** | Approval independence + clawback, assurance levels, anti-spoofing, whistleblower + config dual-control + staffing matrix |
| **OVERALL FINAL** | 6.3 | **8.6 — Enterprise-grade for a Phase-0 start** | Foundation frozen; feature P0s gated at their sprints |

**Why not higher / not 10:** the residual to reach 9+ is **execution evidence, not architecture** — the Phase-0 legal register must be filled by counsel, the tiered-verification cost curve must be validated against real field data, and scale stages S2–S4 prove out only in production. This board does not award those points to paper. 8.6 is the correct ceiling for a well-remediated pre-implementation blueprint.

### Recommendation
**Freeze the architecture at Docs 00–14 (baseline) + Doc 16 (binding amendments) and begin implementation of the core platform.** Sequence the build so the three shared services (SLA, Evidence, Trust-Status), the sharded/jurisdictioned schema, and the event-spine contracts land first — they are the foundation every module depends on. Run the Phase-0 legal/tax/payroll content workstream **in parallel** with early coding (it gates the Finance/Services modules, not the platform skeleton). Finalize the five carried-forward features at their respective module design sprints. Re-score is not required before coding — the architecture-blocking gate is cleared.
