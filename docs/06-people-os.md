# 06 — People OS: Recruitment, Training, SOP Library, KPI, Performance, Salary & Incentives

> Covers blueprint sections: 20 (Recruitment Process), 21 (Training Process), 22 (SOP Library), 27 (Employee KPI System), 28 (Performance Evaluation), 29 (Salary & Incentive System)

The People OS exists because the strategy (Doc 01 §3.3) depends on making *average hires perform like top performers through system + SOP + training*, and on expansion being a hiring-replication exercise. Every process here is task-driven through the Planner — HR work is never memory-driven either.

---

## 1. Recruitment Process

### 1.1 Pipeline

```
REQUISITION → SOURCING → SCREENING → INTERVIEW-1 (competency)
→ FIELD/ROLE TEST → INTERVIEW-2 (manager) → REFERENCE CHECK
→ OFFER → ACCEPTED → HIRED (handoff to Onboarding)
```

| Stage | Owner | System Behavior |
|---|---|---|
| **Requisition** | Hiring manager → City Manager/Exec approval | Role, area, headcount, target start date, budgeted comp band; approval workflow; expansion phases auto-generate requisitions from the Expansion Kit (Doc 13) |
| **Sourcing** | HR Executive | Channel registry: Rozee.pk-class job boards, Facebook job groups, WhatsApp referral broadcasts, employee referral program (bonus tracked), field poaching notes (dealers' staff often make good agents). Source attribution mandatory → cost-per-hire per channel in Analytics |
| **Screening** | HR | Structured phone screen script (SOP); knockout questions per role (own motorbike + smartphone + area familiarity for field agents; typing + WhatsApp fluency for telesales) |
| **Interview 1** | HR + functional lead | Structured scorecard (competencies per role profile), recorded in system — free-text-only interviews are prohibited. **Why:** comparability + audit + bias reduction |
| **Field/Role Test** | Area Manager / Trainer | Field agent: mock To-Let survey walk in a real block; Telesales: mock lead call role-play; Marketing: draft 3 posts for a real listing. Scored against rubric |
| **Interview 2** | Hiring manager | Values/situational; salary expectation |
| **Reference Check** | HR | Minimum 2; template call script |
| **Offer → Accepted** | HR | Offer letter from template (Doc Mgmt); e-acceptance or signed scan |
| **Hired** | HR | Fires Employee Lifecycle `Hired` (Doc 05 §6): IAM provisioning, onboarding plan generation |

### 1.2 Role Profiles (seed set)

Each role has a stored profile: mission, outcomes, competencies, knockouts, test rubric, comp band, training track, 30/60/90 expectations. Profiles are versioned master data — the Expansion Kit clones them per new city.

### 1.3 Recruitment KPIs

Time-to-fill, pipeline conversion by stage, cost-per-hire by channel, 90-day retention by source, quality-of-hire (new-hire KPI attainment at day 90 vs cohort).

---

## 2. Training Process

### 2.1 Structure: Tracks → Modules → Certifications

| Track | Audience | Modules (examples) | Certification Gate |
|---|---|---|---|
| **Foundation** (all staff) | Everyone | Company mission & trust doctrine; system navigation; data privacy & CNIC handling; communication etiquette (call + WhatsApp); Urdu/English templates | Required to exit Onboarding |
| **Field Verification** | Field agents | Verification SOP deep-dive; evidence capture flow; ownership documents literacy (fard, registry, allotment letters); geo/photo standards; fraud patterns; safety protocol | **Verifier Certification** — required before solo verification tasks (permission gate, FR-A1-5) |
| **To-Let & Supply Discovery** | Field agents | Survey method, board photography, owner-conversation script, dealer etiquette | Survey tasks unlocked |
| **Telesales & Lead Handling** | Lead agents | Speed-to-lead doctrine; qualification script; objection handling; freshness call script; visit scheduling | Lead-queue access |
| **Verification QC** | Area Managers | Approval standards, integrity red flags, re-audit method | **Approver Certification** |
| **Marketing Execution** | Marketing execs | Channel rules (FB group norms, WhatsApp community etiquette), content standards, attribution discipline | Posting task eligibility |
| **Management** | AMs/City Managers | Planner management, KPI coaching conversations, PIP handling, dealer negotiation | Manager toolkit access |

### 2.2 Delivery Mechanics

- **Blended:** in-system modules (text/video + quiz), shadowing days (sign-off by certified senior — recorded as tasks), then supervised solo work with elevated QC sampling.
- **Quizzes:** pass threshold; attempts logged; failed twice → Trainer coaching task auto-generated.
- **Shadow-reverse-shadow:** trainee observes (2 days) → performs observed (3 days) → solo with 100% QC review (1 week) → normal sampling. All stages are Planner-scheduled tasks.
- **Recertification:** annually or on SOP major-version change — the SOP Library triggers recertification tasks automatically for affected certifications.
- **Training content ownership:** Trainer role owns modules; SOP changes flow into module updates via linked review tasks (SOP and training can never drift apart silently).

### 2.3 Training KPIs

Time-to-certify by role, first-attempt pass rate, post-training performance delta, trainer load, recertification compliance %.

---

## 3. SOP Library

### 3.1 Design

The SOP Library is a **first-class module** (F4), not a folder of PDFs:

- **Structured SOP object:** code, title, domain, owner role, version, effective date, review-due date, linked task templates, linked training modules, linked KPI definitions.
- **Versioning:** semantic (major = behavior change → triggers re-acknowledgment + possible recertification; minor = clarification).
- **Acknowledgment tracking:** employees must acknowledge SOPs relevant to their role; unacknowledged mandatory SOP blocks claiming related task types (FR-F-4).
- **Review cycles:** every SOP carries `review_due`; the Planner generates review tasks to the owner role. Stale SOPs surface on the Compliance dashboard.
- **Feedback loop:** complaint root-cause tags and QC rejection reasons link back to SOPs → "SOPs causing failures" report → improvement tasks. **Why:** SOPs must be living operational code, not shelf-ware; the feedback loop is what keeps them true.

### 3.2 Seed SOP Catalog (v1, ~40 SOPs)

| Domain | SOPs |
|---|---|
| Verification | Property verification visit; Evidence capture standards; Ownership document review; QC approval checklist; Re-audit procedure; Fraud escalation |
| Supply | To-Let board survey; Owner first-call script; Owner consent recording; Dealer intake handling; Duplicate merge procedure; Dormant owner check-in |
| Demand/CRM | Speed-to-lead handling; Lead qualification; Visit scheduling & accompaniment; No-show handling; Negotiation support; Deal closing & agreement; Freshness confirmation call |
| Trust services | Rent agreement drafting; E-stamping guidance; Tenant police registration filing (Punjab/Sindh variants); Tenant screening with consent |
| Complaints | Intake & triage; Fake-info investigation; Resolution & confirmation; Escalation matrix |
| Marketing | FB group posting rules; WhatsApp community conduct; Dealer relationship visit; Society office visit; Referral campaign execution; Content standards; Photography standards |
| HR | Interview scorecarding; Onboarding day-1; Attendance & leave; Exit & handover; Payroll cutoff |
| Field safety & conduct | Personal safety on visits; Cash handling; Anti-harassment; Data privacy in the field (no CNIC photos on personal devices) |
| Platform | Incident reporting; Data correction requests; Master data proposal |

---

## 4. Employee KPI System

### 4.1 Principles

1. **Auto-captured** (FR-F-2): KPI values derive from operational events (task completions, verification results, lead stamps, deal records). Manual entry only for explicitly qualitative scores (e.g., call-quality review), and those require reviewer identity.
2. **Few and weighted:** each role has 4–6 KPIs with weights summing to 100. More metrics = gamed metrics.
3. **Quality paired with quantity — always.** Every volume KPI has a paired integrity/quality KPI so the pair cannot be gamed together. **Why:** paying for verification volume alone manufactures fraud; the pairing is the incentive-safety mechanism.
4. **Transparent:** every employee sees their live scorecard and exactly which events produced each number (drill-down to source events, NFR-18).

### 4.2 Role Scorecards (v1)

| Role | KPI (weight) — quality pair in bold |
|---|---|
| **Field Verification Agent** | Verifications completed vs target (25) · **Verification Integrity rate from QC/re-audits (25)** · To-Let boards surveyed & converted-to-contact rate (15) · Evidence first-pass acceptance (15) · Task on-time completion (10) · Visit punctuality/no-show (10) |
| **Telesales/Lead Agent** | Speed-to-lead median (25) · Lead→visit conversion (20) · **Call quality score (sampled reviews) (20)** · Freshness calls completed on time (15) · Follow-up discipline (no overdue follow-ups) (10) · Data completeness of captured requirements (10) |
| **Area Manager** | Area verified-live listings vs target (20) · Area closings vs target (20) · **Area integrity rate (20)** · Team KPI attainment avg (15) · Carry-forward backlog control (10) · Dealer/owner relationship tasks done (15) |
| **Marketing Executive** | Planned activities executed (25) · Leads generated per channel vs target (25) · **Lead quality: qualified-rate of their leads (20)** · Channel compliance (no group bans/spam flags) (15) · Content acceptance rate (15) |
| **Content/Social Executive** | Calendar adherence (25) · Engagement vs benchmark (20) · **Content quality review (20)** · SEO tasks completed (20) · Asset library contributions (15) |
| **CRM/Support Lead** | City SLA compliance (30) · Complaint resolution within SLA (25) · **Reopen rate (20)** · Team coaching tasks done (15) · Escalation handling time (10) |
| **HR Executive** | Time-to-fill (25) · 90-day retention of hires (25) · **Quality-of-hire index (20)** · Onboarding completion on time (15) · Payroll accuracy (15) |
| **City Manager** | City P&L vs plan (25) · City North-Star closings (25) · **City integrity + complaint index (25)** · Expansion milestones (15) · Team health (attrition, eNPS) (10) |

### 4.3 Mechanics

- **Periods:** daily raw capture → weekly scorecard → monthly official score (used by payroll) → quarterly evaluation input.
- **Targets:** come from the Target & Capacity module (Doc 07 §5) — same numbers the Planner plans against. KPI attainment = actual/target on the same ledger. **Why single ledger:** if planning targets and evaluation targets diverge, employees rightly stop trusting both.
- **Seasonality:** target profiles adjust for Ramadan hours, Eid weeks, monsoon field constraints — fairness is configured, not argued monthly.
- **Anti-gaming reviews:** Compliance dashboard flags statistical anomalies (e.g., 100% integrity with abnormal speed; lead conversions clustered at period end).

---

## 5. Performance Evaluation

### 5.1 Cadence

| Rhythm | Content | System Support |
|---|---|---|
| **Daily** | Planner completion + exceptions | Automatic; no meeting |
| **Weekly 1:1 (manager↔report)** | Scorecard walk, blockers, coaching note | Auto-generated 1:1 task with agenda pre-filled from the week's data; coaching note logged |
| **Monthly** | Official KPI score freeze | System computes; manager adds qualitative modifier within bounded range (±10) with mandatory justification text |
| **Quarterly Evaluation** | KPI trend (70%) + competency/values rubric (20%) + 360-lite peer input (10%) | Structured forms; calibration meeting per city (managers align ratings); outcomes: increment eligibility, promotion nomination, PIP trigger |
| **Annual** | Compensation review, promotion decisions, track changes | Uses four quarterly records; no surprise reviews — **Why:** annual-only reviews in a field business let problems compound for months |

### 5.2 PIP (Performance Improvement Plan)

Trigger: monthly score < threshold twice consecutively, or integrity breach (immediate). PIP = 4–6 week structured plan with specific system-tracked milestones (e.g., "integrity ≥ 95% on next 20 verifications"), weekly check-in tasks, defined outcomes (restore / role change / exit). All PIP steps are Planner tasks — HR compliance is automatic.

### 5.3 Promotion Pathways

Field Agent → Senior Agent → Area Manager → City Manager; Telesales → CRM Lead; Marketing Exec → Marketing Lead. Promotion requires: sustained KPI attainment, relevant certifications (Management track), and an open requisition. Internal-first policy: requisitions post internally for 7 days before external sourcing. **Why explicit ladders:** expansion (Doc 13) needs a City Manager pipeline; growing them beats hiring them.

---

## 6. Salary & Incentive System

### 6.1 Structure

| Component | Basis | Notes |
|---|---|---|
| **Base salary** | Role band × city cost index × experience step | Bands versioned master data; Exec approval to change |
| **Monthly incentive** | Formula over official monthly KPI score + role-specific event bonuses | See 6.2 |
| **Deal incentives** | Per-closing bonus split rules (agent who sourced, agent who closed, AM override) | Computed from Deal/Commission ledger lines — traceable to deals (FR-F-3) |
| **Referral bonuses** | Employee referral hires (paid at hire + 90-day retention) | From Recruitment module |
| **Allowances** | Fuel/mobile for field roles (fixed or task-distance-based) | Expense module integration |
| **Deductions** | Advances, late/absence policy per attendance | Attendance module |
| **Annual increment** | Quarterly evaluation record | Bounded matrix by rating |

### 6.2 Incentive Formula Mechanics

- **Versioned rules:** `incentive_rule` objects per role with effective ranges; changing a rule never rewrites history (FR-F-3).
- **Gate + multiplier shape:** incentives unlock at KPI score ≥ gate (e.g., 70), scale with score, and are **zeroed by integrity breach regardless of volume**. Example shape (illustrative, values configurable): `incentive = base_pool × (score−gate)/(100−gate) × integrity_multiplier` where integrity_multiplier ∈ {0, 0.5, 1}.
- **Team overrides:** AM/City Manager incentives derive partly from team attainment — aligns coaching with outcomes.
- **Caps and floors:** monthly caps prevent windfall gaming; no negative incentives (deductions are a separate, policy-governed lane).

### 6.3 Payroll Cycle

```
Day 1–30: events accrue → Month close: KPI freeze (Day 2 of next month)
→ Payroll draft auto-computed (Day 3) → Manager/Finance review & approve
(Day 5) → Exec approval above thresholds → Export to bank/disbursement
(Day 7) → Payslips issued (system) → Discrepancy window (5 days, ticket-
based) → Ledger locked
```

Every payroll line links to its KPI scores, which link to source events — a disputed incentive is resolved by drill-down, not argument (NFR-18). Payroll data is field-ACLed (Doc 03); Finance approves, HR drafts, Exec approves above thresholds — three-party separation.

### 6.4 Interactions Summary

Recruitment feeds Employee Lifecycle → IAM + Planner capacity. Training certifications gate task eligibility and permissions. SOPs bind to task templates and training. KPIs read the operational event stream and feed Performance + Payroll. Payroll reads KPI + attendance + deal ledgers. Every arrow is automated; HR's job is judgment, not data entry.
