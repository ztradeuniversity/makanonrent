# 07 — Task Management System & Master Daily Planner Engine

> Covers blueprint sections: 23 (Task Management System), 24 (Daily Planner)
> This is the company's **operating brain**: every department receives its work from this engine. Nothing relies on memory.

---

## 1. Task Management System (the substrate)

### 1.1 The Universal Task Object

One task model serves every module (FR-E-1). A task is *any unit of work assigned to a human* — a verification visit, a freshness call, a Facebook post, an interview, an SOP review.

| Attribute | Purpose |
|---|---|
| `origin` | planner \| module_event \| manual \| carry_forward \| escalation — provenance is always known |
| `template_id` | Almost all tasks instantiate a versioned **task template** (title pattern, SOP link, estimate, evidence requirement, priority default) |
| `linked_entity` | The business object the task acts on (verification_case, lead, complaint, tolet_board, campaign_activity, sop, candidate…) |
| `assignee`, `area_id` | Scoped per Doc 03 |
| `priority` | P1 critical / P2 high / P3 normal / P4 flexible (computed — see §4.5) |
| `estimate_min` | From template, tunable by learned actuals (§7) |
| `due_at`, `window` | Deadline + execution window (e.g., field tasks only in daylight window) |
| `state` | todo → in_progress → done → verified_done \| blocked \| cancelled \| expired |
| `evidence_refs` | Required proof class per template (photo, call log, link, geo check-in) — a task requiring evidence cannot reach `done` without it |
| `verified_done` | Some templates require manager/QC confirmation after `done` (e.g., verification QC) |
| `carry_count` | How many times carried forward — drives aging escalation |
| `plan_id` | The daily plan it belongs to (if planner-scheduled) |
| `why` | Human-readable generation reason: target + template + trigger (FR-E-5) |

### 1.2 Task Rules

1. **Everything measurable is a task.** If work matters enough to expect, it matters enough to generate, track, and count. This is what makes KPIs auto-derivable (Doc 06).
2. **Templates are master data** (~60 at launch, Doc 04 §3.4): versioned, SOP-linked, owned by the domain lead. New process = new template + SOP in the same change.
3. **Evidence-gated completion:** self-reported completion without proof is the failure mode of every field business; templates declare their proof class and the system enforces it.
4. **Blocked is a real state** with a mandatory blocker reason + unblock owner — blocked tasks appear on the *blocker owner's* plan, not just the victim's. **Why:** otherwise blocked work silently dies.
5. **Manual tasks are allowed** (managers can assign ad-hoc) but are visibly labeled and count against the "% planner-driven work" metric — the system watches whether the company is drifting back to memory-management.

---

## 2. Master Daily Planner Engine — Concept

### 2.1 What It Is

A nightly (and on-demand) **generation pipeline** that converts *targets + lifecycle states + recurrences + carry-forwards + capacity* into a prioritized, time-feasible, route-aware daily plan for **every employee**, plus weekly and monthly plan skeletons for managers.

```
                    ┌─────────────────────────────┐
  Targets (cascade) │                             │
  Lifecycle states  │   GENERATION PIPELINE       │   Daily Plan per employee
  Recurrence rules  │ 1 Demand collection         │   Weekly/Monthly skeletons
  Module events     │ 2 Task instantiation        │──▶ Route sheets (field)
  Carry-forwards    │ 3 Prioritization            │   Manager exception report
  Capacity calendars│ 4 Capacity fitting          │   Target-risk alerts
  Learned estimates │ 5 Routing & sequencing      │
                    │ 6 Publish + notify          │
                    └─────────────────────────────┘
```

### 2.2 Design Principles

1. **Targets pull, events push.** Two demand sources: *pull* (targets requiring N units of activity this period → generate enough tasks to hit them) and *push* (lifecycle events requiring response — new lead, badge expiring, complaint). The engine merges both.
2. **Feasibility over wishful thinking.** A plan that exceeds capacity is a lie; overflow becomes visible backlog with explicit trade-off decisions for managers — never silent overload.
3. **Explainability.** Every task answers "why am I doing this" (FR-E-5). Trust in the planner is trust in the company.
4. **Human override with memory.** Managers can adjust plans; adjustments are logged and analyzed (chronic overrides = mis-tuned templates/targets, surfaced monthly).
5. **The planner learns** (§7): actual durations, conversion yields, and route times feed back into estimates and generation volumes.

---

## 3. Generation Pipeline (detailed)

### Stage 1 — Demand Collection

Collect all work demands for the planning date:

| Demand Class | Source | Examples |
|---|---|---|
| **Target-driven** | Target ledger (§5) | Area needs 12 verifications this week → 3 visit tasks today per capacity; 40 To-Let boards/week → survey routes |
| **Event-driven (SLA)** | Module events | New leads awaiting first response; complaint SLA timers; badge expiring in 7 days → renewal case tasks; listing freshness due → confirmation calls |
| **Recurring** | Template recurrence rules | Daily FB group posts; weekly dealer visits; monthly SOP reviews; quarterly dormant-owner check-ins; daily attendance-anomaly review (HR) |
| **Carry-forward** | Yesterday's incomplete tasks | Re-enter with aging (§4.6) |
| **Workflow-continuation** | Open cases mid-flow | Verification case in `evidence_submitted` → QC task to AM; rework loops |
| **Managerial** | Manual assignments, PIP milestones, 1:1s | Auto-agenda'd weekly 1:1s; onboarding checklists |
| **Blocked-resolution** | Blocked tasks | Unblock task to blocker owner |

### Stage 2 — Task Instantiation

- Templates instantiate with resolved parameters (entity, area, SOP version, estimate).
- **Deduplication:** one entity+template+period = one task (a freshness call isn't generated twice).
- **Eligibility filter:** assignee candidates must hold required certification + acknowledged SOP + role scope (Docs 03/06).

### Stage 3 — Prioritization (§4.5 scoring)

### Stage 4 — Capacity Fitting

- Employee capacity = working minutes from capacity calendar (shift − leave − holidays − standing meetings − Ramadan-adjusted hours) × utilization factor (default 80%; never plan 100%). Field roles also deduct predicted travel time.
- Tasks packed by priority until capacity fills; remainder → **backlog with visibility** (manager exception report shows "demand exceeded capacity by 340 min in Area X" → hire/target signal, feeding Recruitment and Target modules).
- **Fairness/rotation:** unpleasant recurring tasks (e.g., far-flung survey zones) rotate across eligible agents.

### Stage 5 — Routing & Sequencing (field roles)

- Geo-clustered batching: verifications, To-Let surveys, dealer visits, and society visits in the same vicinity pack into one route (this is the unit-economics lever — Doc 01 §2.2).
- Constraints: owner appointment windows, society gate timings (master data), daylight/prayer-time windows, travel buffers.
- Output: ordered route sheet with map links, contact numbers, and per-stop task bundles.
- Office roles get **time-blocked sequences** instead: SLA-bound work first (lead responses), then batched call blocks (freshness), then flexible work.

### Stage 6 — Publish & Notify

- Plans finalized by evening cutoff (FR-E-2); managers get an adjustment window (e.g., 20:00–08:30); employees receive morning plan notification (in-app + push/WhatsApp).
- Intraday: SLA-critical events (new lead) inject into today's plan in real time, displacing P4 tasks — displacement is logged.

---

## 4. Plan Content Model

### 4.1 Horizons

| Horizon | Content | Audience |
|---|---|---|
| **Daily plan** | Concrete ordered tasks with times/routes | Every employee |
| **Weekly plan** | Target progress vs required run-rate; themed days (e.g., Tue = dealer-visit day); scheduled trainings/1:1s | Employee + manager |
| **Monthly plan** | Target ledger, recurring obligations calendar (SOP reviews, re-audit sampling, payroll cycle, content calendar), capacity forecast vs demand forecast | Managers |
| **Pending/backlog view** | All unscheduled demand, aged, with reasons | Managers, Exec |

### 4.2 Generated Task Families (the full catalog demanded of the engine)

The engine generates, at minimum:

- **Daily tasks** — SLA responses, field routes, posting slots, freshness calls.
- **Weekly tasks** — dealer relationship visits, team 1:1s, content batch production, area target reviews.
- **Monthly tasks** — SOP reviews, re-audit samples, payroll steps, evaluation cycle steps, channel performance reviews.
- **Pending tasks** — backlog surfaced with aging, never lost.
- **Recurring tasks** — from template recurrence rules (cron-like + business-calendar-aware: skips Eid holidays, shifts Ramadan windows).
- **Carry-forward tasks** — §4.6.
- **Estimated time** — every task; plans show total load vs capacity.
- **Priority** — computed (§4.5).
- **Employee capacity** — visible to the employee and manager on every plan.
- **Area targets, Verification targets, Marketing targets, Social media targets, Recruitment targets, Training targets, Documentation targets** — via the target cascade (§5); each target type has generator rules mapping shortfall → task volume.

### 4.5 Priority Scoring

`priority_score = SLA urgency (breach proximity) × business weight (template) × entity value (e.g., hot lead > cold survey) × aging boost (carry_count) × manager boost (bounded)`

Bands: P1 = SLA/safety/integrity-critical (never displaced), P2 = target-critical path, P3 = standard, P4 = flexible/opportunistic. **Why computed, not hand-set:** hand-set priorities decay into everything-is-urgent; computation keeps the scale honest, and manager boosts are bounded + logged.

### 4.6 Carry-Forward & Aging Rules

1. Incomplete `todo/in_progress` tasks at day close → carry forward with `carry_count + 1` and priority aging boost.
2. `carry_count = 2` → flagged on manager's exception report with reason required from assignee.
3. `carry_count = 3` → escalation task generated to the manager (decide: reassign / rescope / cancel-with-reason).
4. SLA-bound tasks never silently carry: breach fires escalation immediately (Doc 09 SLA matrix).
5. Chronic carry-forward patterns per employee/template feed the learning loop (§7) and KPI (backlog-control metrics, Doc 06).
6. Expired-window tasks (e.g., a post slot missed) → `expired` with reason, counted, never resurrected silently.

**Why bounded escalation:** infinite carry-forward is how task systems become graveyards; three strikes forces a human decision.

---

## 5. Target & Capacity Management (the planner's fuel)

### 5.1 Target Cascade

```
Company (North Star: closings/month)
  → City targets (closings, verified supply, integrity, revenue)
    → Area targets (verified-live listings, verifications/week, To-Let
      surveys/week, freshness compliance, leads handled, closings)
      → Role targets (per role in area)
        → Employee targets (capacity-weighted share)
```

- Cascade math is **top-down proposal, bottom-up feasibility-check**: the engine computes what employee-level allocation the cascade implies; if implied load exceeds area capacity, the target is flagged *infeasible at current headcount* → explicit Exec decision (raise capacity, cut target, accept backlog). Targets that ignore capacity are dishonest; the system refuses to pretend.
- **Seasonality profiles** adjust monthly targets (moving seasons around school-year start, Ramadan slowdowns, Eid spikes in relocations).
- Target changes are versioned with effective dates; KPI attainment always reads the target active in-period (single ledger with Doc 06 §4.3).

### 5.2 Target Metric Catalog (seed)

| Domain | Metrics |
|---|---|
| Supply | new properties discovered, verifications completed, verified-live count, freshness compliance %, dormant reactivations |
| Demand | leads responded in SLA, visits conducted, closings, agreement services sold |
| Marketing | posts per channel, groups covered, dealer visits, society visits, referral signups, content pieces, SEO tasks |
| People | hires by role, time-to-certify, training completions, SOP review currency |
| Quality | integrity rate, complaint rate, reopen rate |
| Documentation | SOPs reviewed on schedule, area guides updated, master-data proposals processed |

### 5.3 Capacity Calendar

Per employee per day: shift minutes, leave, public/religious holidays, training blocks, standing meetings, field-travel factor by area geography. Managers maintain exceptions; HR leave flows in automatically; Ramadan schedule applied city-wide by calendar profile.

---

## 6. Manager & Employee Experience (functional, not UI)

- **Employee morning view:** ordered plan, total est. time vs capacity, route sheet, "why" per task, one-tap state changes + evidence capture.
- **Manager morning view:** team plan summary, exceptions (carry-forwards ≥2, SLA risks, capacity overflow, blocked tasks), adjustment actions (reassign/re-prioritize within bounds).
- **Exec view:** target-risk board — which areas/targets are off run-rate and *why* (capacity vs execution vs demand shortfall), fed by planner telemetry. This board is the weekly leadership meeting (Doc 01 Phase 5 exit criterion).

---

## 7. Learning Loop (planner auto-tuning)

| Signal | Learns | Effect |
|---|---|---|
| Actual vs estimated durations (per template × area × employee seniority) | Better `estimate_min` | Honest capacity fitting |
| Route actual travel times | Area travel factors | Better field packing |
| Conversion yields (surveys→contacts→listings; calls→visits→closings) | Generation volumes per target | "To close 5 rentals, area needs ~X verified listings and ~Y fresh leads" — the funnel arithmetic per area, continuously updated |
| Override patterns | Template/target mis-tuning report | Monthly planner-tuning review task (itself recurring) |
| Completion-time-of-day patterns | Slotting preferences | E.g., owners answer calls 11:00–13:00 and after 20:00 → call blocks move |

Phase 6+ (Doc 10): AI layer proposes target adjustments and anomaly alerts; humans approve. The planner never silently changes its own targets.

---

## 8. Failure Modes & Safeguards

| Failure Mode | Safeguard |
|---|---|
| Generation job fails overnight | Fallback: yesterday's plan skeleton + SLA tasks always generate from a minimal independent path; Sys Admin alert; manual re-run |
| Garbage targets → garbage plans | Feasibility check + Exec sign-off on cascade changes |
| Employees gaming easy tasks first | Sequenced plans + priority-order compliance metric |
| Evidence fatigue (proof theater) | Evidence requirements reviewed quarterly; sampling instead of 100% where trust is earned (QC sampling rates tied to individual integrity KPI) |
| Planner distrust ("robot boss") | Explainability, bounded manager overrides, visible fairness rotation, and the rule that capacity is never planned past 80% |
| Task spam / over-generation | Per-role daily task-count budgets; dedup keys; template review cycle |

---

## 9. Interactions Map

- **Consumes:** Targets (E3), lifecycle events (all modules), capacity/leave (F7), certifications (F3), SOP links (F4), geo/master data (A2), learned estimates (H3).
- **Produces:** Tasks (E1) for every module's human work, route sheets (E4), exception reports, KPI source events (F5), backlog/hiring signals (F2), notifications (A3).
- **Marketing & Social planners (Doc 08) are generator plugins** into this engine — same pipeline, domain-specific demand collectors and templates.
