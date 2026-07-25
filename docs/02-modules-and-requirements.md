# 02 — Complete Module List, Functional Requirements, Non-Functional Requirements

> Covers blueprint sections: 6 (Complete Module List), 7 (Functional Requirements), 8 (Non-Functional Requirements)

---

## 1. System-of-Systems Overview

MakanOnRent is one platform composed of five planes. **Why planes, not a monolith diagram:** each plane has a different change cadence, different users, and different availability needs — this drives the modular architecture and deployment strategy (Doc 12).

```
┌──────────────────────────────────────────────────────────────────────┐
│ PUBLIC PLANE      Public Website · Tenant App · Owner Portal          │
├──────────────────────────────────────────────────────────────────────┤
│ ENGAGEMENT PLANE  CRM · Lead Mgmt · WhatsApp/Call Hub · Complaints    │
│                   · Notifications · Internal Chat                     │
├──────────────────────────────────────────────────────────────────────┤
│ OPERATIONS PLANE  Property Registry · Verification Engine ·           │
│                   Daily Planner Engine · Task Mgmt · Marketing        │
│                   Planner · Field Ops (Area Managers/Agents)          │
├──────────────────────────────────────────────────────────────────────┤
│ ENTERPRISE PLANE  HR/Recruitment · Training · SOP Library · KPI &     │
│                   Performance · Salary/Incentives · Finance-lite ·    │
│                   Document Mgmt · Audit                               │
├──────────────────────────────────────────────────────────────────────┤
│ INTELLIGENCE PLANE  Analytics · Reporting · AI Modules ·              │
│                     Master Data · Search & Matching                   │
└──────────────────────────────────────────────────────────────────────┘
```

All planes share one identity/RBAC service, one audit log, one notification bus, and one master-data service.

---

## 2. Complete Module List

> 42 modules across 8 domains. Each entry: purpose, primary owner role, and its key interactions (the "HOW it talks to other modules" requirement).

### Domain A — Identity & Platform Core

| # | Module | Purpose | Key Interactions |
|---|---|---|---|
| A1 | **Identity & Access (IAM/RBAC)** | Single sign-on for all internal + external users; role/permission enforcement (Doc 03) | Every module authenticates through A1; permission checks logged to E5 Audit |
| A2 | **Master Data Management** | Cities, areas, sub-areas, housing societies, blocks/phases, landmarks, property types, amenity dictionary, rent-term dictionary | Consumed by Property Registry, Search, Planner (area targets), Analytics (area rollups) |
| A3 | **Notification Bus** | Central outbound messaging: in-app, SMS, WhatsApp template, email, push (Doc 10 §Notifications) | Every module publishes events; A3 applies user channel preferences + quiet hours |
| A4 | **Document Management** | Versioned storage of CNICs, ownership docs, agreements, photos, HR docs, with retention rules (Doc 09 §Documents) | Verification (evidence), HR (contracts), CRM (agreements), Security (encryption, access policy) |
| A5 | **Audit & Activity Log** | Immutable who-did-what-when across all modules (Doc 11 §Audit) | Written to by all modules; read by Compliance dashboards, Performance evaluation, Fraud AI |

### Domain B — Supply (Property Side)

| B1 | **Property Registry** | Canonical record per physical property (not per listing) | Verification, Listings, Owner CRM, Dedup AI, Analytics |
|---|---|---|---|
| B2 | **Listing Management** | Rentable offers on properties (a property can have portions/floors listed separately) | Public site, Freshness engine, Lead matching |
| B3 | **Verification Engine** | Workflow: intake → doc check → field visit → evidence → approval → badge (Doc 05) | Planner (generates visit tasks), Field app, Document Mgmt, Audit, AI fraud scoring |
| B4 | **Freshness & Availability Engine** | Scheduled re-confirmation of price/availability; auto-demote stale listings | Planner (re-confirm call tasks), Public site badges, Analytics |
| B5 | **Owner Management** | Owner profiles, mandates (open/exclusive), consent, communication history | CRM, Verification (ownership proof), Commission engine |
| B6 | **Dealer Management** | Dealer registry, tiering, verified-dealer program, listing attribution, commission splits | Listings, CRM, Marketing Planner (dealer visits), Finance |
| B7 | **To-Let Board Survey Module** | Structured capture of field-discovered boards: photo, GPS, phone, follow-up pipeline | Planner (survey routes), CRM (converts to owner leads), Analytics (supply discovery yield) |

### Domain C — Demand (Tenant Side)

| C1 | **Public Website & SEO Layer** | Verified listings, Pakistani filters, area guides, Urdu/English (Doc 13) | Listings, Search, Lead capture, Analytics |
|---|---|---|---|
| C2 | **Search & Matching** | Filters (family/bachelor, portion, budget, gas, water…), saved searches, tenant-requirement → listing matching | Listings, AI ranking, Notifications (new-match alerts) |
| C3 | **Tenant Management** | Tenant profiles, requirements, visit history, screening (consented), police-registration service tracking | CRM, Lead Mgmt, Trust Services |
| C4 | **Visit Scheduling** | Property visit booking, field-agent accompaniment, outcome capture | Planner (agent schedules), CRM (lead stage), KPI (visits/agent) |
| C5 | **Trust Services** | Rent agreement drafting, e-stamping guidance, tenant police registration filing, screening reports | Document Mgmt, Finance, Tenant/Owner lifecycles |

### Domain D — Engagement (CRM & Communication)

| D1 | **CRM Core** | Unified contact ledger (owner/tenant/dealer/vendor) with full interaction timeline (Doc 09) | Everything customer-facing |
|---|---|---|---|
| D2 | **Lead Management** | Multi-channel lead intake (call, WhatsApp, web, walk-in, referral), pipeline, assignment, SLA timers | CRM, Planner (follow-up tasks), KPI (speed-to-lead), AI triage |
| D3 | **Communication Hub** | WhatsApp Business API + call logging + SMS in one timeline; templates; consent management | CRM, Notification Bus, Audit |
| D4 | **Complaint Management** | Tickets from tenants/owners/dealers; categories, SLAs, escalation, root-cause tagging (Doc 09) | CRM, Planner (resolution tasks), Analytics, SOP library |
| D5 | **Internal Chat** | Role/area/topic channels, task-linked threads, announcement broadcast (Doc 09) | Task Mgmt (discuss-on-task), HR (broadcasts), Audit (retention) |
| D6 | **Referral & Campaign Module** | Referral codes, campaign attribution, reward tracking | Marketing Planner, CRM, Finance (payouts) |

### Domain E — Operations (the Operating Brain)

| E1 | **Task Management System** | Universal task object: manual + system-generated; states, priorities, estimates, evidence, comments (Doc 07) | The substrate for Planner, Verification, CRM follow-ups, Complaints, HR |
|---|---|---|---|
| E2 | **Master Daily Planner Engine** | Generates every role's daily/weekly/monthly plan from targets, templates, capacity, carry-forwards (Doc 07) | Task Mgmt, KPI, Marketing Planner, Verification, HR capacity |
| E3 | **Target & Capacity Management** | Area targets, role targets, employee capacity calendars (leave, travel time) | Planner, KPI, Analytics |
| E4 | **Field Operations Module** | Area Manager console: route batching, GPS check-ins, evidence capture, offline queue | Verification, To-Let survey, Visit scheduling, Planner |
| E5 | **Marketing Planner** | Daily marketing task generation: FB groups, WhatsApp communities, dealer visits, society visits, content, SEO (Doc 08) | Planner (as a generator plugin), Campaign module, Content library |
| E6 | **Social Media Planner** | Content calendar, posting slots, asset pipeline, platform accounts registry (Doc 08) | Marketing Planner, Document Mgmt (assets), Analytics (engagement import) |

### Domain F — People (Enterprise/HR)

| F1 | **Employee Registry & Lifecycle** | Profiles, roles, areas, contracts, exit workflow (Doc 05/06) | IAM (provisioning), Planner (capacity), Payroll |
|---|---|---|---|
| F2 | **Recruitment Module** | Requisitions, sourcing, pipeline, structured interviews, offers (Doc 06) | Planner (interview tasks), HR docs, Onboarding |
| F3 | **Training & Certification** | Role-based tracks, materials, quizzes, field shadowing sign-offs; certification gates permissions (Doc 06) | SOP Library, IAM (permission gating), KPI |
| F4 | **SOP Library** | Versioned procedures with ownership, review cycles, acknowledgment tracking (Doc 06) | Training, Task templates (tasks link their SOP), Complaints (root-cause → SOP update) |
| F5 | **KPI & Performance** | Metric definitions, auto-capture from operational events, scorecards, evaluation cycles (Doc 06) | Every operational module emits KPI events; Payroll consumes scores |
| F6 | **Salary & Incentive Engine** | Salary structures, attendance, incentive rules bound to KPIs, payroll export (Doc 06) | KPI, Employee registry, Finance-lite, Audit |
| F7 | **Attendance & Leave** | Check-in (GPS for field roles), leave requests, holiday calendar (Pakistani public + Eid/Ramadan schedules) | Planner capacity, Payroll |

### Domain G — Money (Finance-lite)

| G1 | **Commission & Deal Ledger** | Deal records, commission calculation, splits (dealer/agent), collection tracking | CRM (deal close), Dealer Mgmt, Payroll incentives |
|---|---|---|---|
| G2 | **Expense & Petty Cash** | Field expense claims (fuel, printing), approvals | Planner tasks (expense evidence), Payroll |
| G3 | **Invoicing & Receipts** | Service invoices (trust services, featured listings), receipt records incl. JazzCash/EasyPaisa/bank references | CRM, Analytics revenue reporting |

### Domain H — Intelligence

| H1 | **Analytics Warehouse & Dashboards** | Area P&L, funnel, supply/demand, ops throughput, HR metrics (Doc 11) | Read-side of all modules |
|---|---|---|---|
| H2 | **Reporting Engine** | Scheduled/exportable reports (daily ops digest, weekly exec pack) | Analytics, Notification Bus |
| H3 | **AI Services** | Dedup detection, fraud/quality scoring, lead triage, rent estimation, Urdu/English content drafting, planner tuning (Doc 10) | Consumed by Verification, Listings, CRM, Planner, Marketing |

---

## 3. Functional Requirements

> Requirements are numbered FR-<domain>-<n> and stated as testable behaviors. This section captures the platform-wide and cross-cutting requirements; module-detailed requirements live in each module's document and follow the same numbering scheme. Priority: **M** = must (Phase 0–2), **S** = should (Phase 3–4), **C** = could (Phase 5+).

### 3.1 Identity & Access (FR-A1)

- FR-A1-1 (M): Single account per human across all surfaces; internal roles assigned per Doc 03 matrix; a user may hold multiple roles (e.g., Area Manager + Trainer).
- FR-A1-2 (M): Phone-number-first authentication for public users (OTP via SMS/WhatsApp); email optional. **Why:** Pakistani users are phone-identified; email-first signup kills conversion.
- FR-A1-3 (M): All permission checks are deny-by-default and evaluated server-side.
- FR-A1-4 (M): Session revocation within 60s of role change or termination (ties to Employee exit workflow).
- FR-A1-5 (S): Certification-gated permissions — e.g., "approve verification" requires an active Verifier certification (from F3).

### 3.2 Master Data (FR-A2)

- FR-A2-1 (M): Geographic hierarchy: City → Zone → Area → Sub-area/Society → Phase/Block → Street — with landmark records attachable at any level. **Why landmarks:** Pakistani addresses are landmark-relative ("near Jamia Masjid, back side of Alfalah bank").
- FR-A2-2 (M): Society records carry society-specific rules (bachelor restrictions, gate timings, dealer access rules) surfaced to listings and planners.
- FR-A2-3 (M): Controlled vocabularies for: property type (house, upper/lower portion, flat, room, shop, office, warehouse), furnishing, water source (boring, government line, tanker), gas (sui gas, cylinder, none), electricity (meter installed, submeter, shared), floor level, parking, family/bachelor/silent-family policy.
- FR-A2-4 (M): Master data changes are versioned, audited, and require Master-Data-Editor permission; downstream records reference IDs, never free text.
- FR-A2-5 (S): Rent-norm reference table per area (typical advance months, security deposit norms) maintained by Area Managers, feeding AI rent estimation.

### 3.3 Property, Listing & Verification (FR-B)

- FR-B-1 (M): One canonical property record per physical unit; listings reference properties; duplicate-candidate detection runs on create (address + geo + photos + phone heuristics, AI-assisted per Doc 10).
- FR-B-2 (M): A listing cannot reach public "Verified" status without a completed verification workflow instance with all mandatory evidence (Doc 05 defines states/evidence).
- FR-B-3 (M): Every listing has a freshness window by area/type; expiry auto-demotes to "Unconfirmed" and generates a re-confirmation task.
- FR-B-4 (M): Field evidence (photos, GPS, timestamps) is captured through the system camera flow — no gallery uploads for verification evidence. **Why:** prevents recycled/fake photos, the core fraud vector.
- FR-B-5 (M): Owner consent (recorded call note or digital consent) required before a property is published; consent record stored in Document Mgmt.
- FR-B-6 (S): Dealer-submitted listings enter a distinct intake queue with mandatory owner-contact confirmation before verification is scheduled.
- FR-B-7 (S): Price history and availability history retained permanently per property (feeds rent index, H4 strategy).

### 3.4 Search, Website & Tenant (FR-C)

- FR-C-1 (M): Public search filters must include: budget range, area/society, property type, portion/floor, beds/baths, family/bachelor policy, gas type, water source, furnished, parking, floor level. All filters operate on structured attributes (never text match).
- FR-C-2 (M): Every public listing displays: verification badge + verification date + "availability last confirmed" date. **Why:** dated trust is the differentiator; undated badges become meaningless.
- FR-C-3 (M): Lead capture paths: click-to-call (tracked number where feasible), WhatsApp deep link with pre-filled listing reference, and callback-request form. All three create CRM leads automatically.
- FR-C-4 (M): Urdu and English UI; listing descriptions stored bilingually (AI-drafted, human-approved per Doc 10).
- FR-C-5 (S): Saved searches with WhatsApp/notification alerts on new matching verified listings.
- FR-C-6 (S): Area guide pages (rents, societies, schools, transport) generated from master data + analytics for SEO.

### 3.5 CRM, Leads, Complaints (FR-D) — detailed in Doc 09

- FR-D-1 (M): Every inbound contact (call log, WhatsApp, form) becomes a timestamped lead with source attribution within 1 minute of capture.
- FR-D-2 (M): Lead assignment rules by area + role + load; SLA timers with escalation to Area Manager on breach.
- FR-D-3 (M): Complaint tickets carry category, severity, SLA, and resolution evidence; closure requires complainant confirmation or documented attempt.
- FR-D-4 (S): One interaction timeline per contact across calls, WhatsApp, visits, deals, complaints.

### 3.6 Tasks & Planner (FR-E) — detailed in Doc 07

- FR-E-1 (M): Single task object model used by all modules; every task carries: origin (manual/template/engine/module), assignee, area, priority, estimate, due, state, evidence requirement, SOP link.
- FR-E-2 (M): Planner generates each employee's next-day plan by a defined evening cutoff, and a manager-adjustable window before day start.
- FR-E-3 (M): Incomplete tasks carry forward with aging and escalation rules; carry-forward volume is itself a KPI.
- FR-E-4 (M): Targets cascade: company → city → area → role → employee; planner allocation must respect employee capacity (hours, leave, travel).
- FR-E-5 (S): Planner explains every generated task ("why am I doing this") by linking target + template + trigger.

### 3.7 People (FR-F) — detailed in Doc 06

- FR-F-1 (M): Employee lifecycle states drive IAM provisioning/deprovisioning automatically.
- FR-F-2 (M): KPI values are computed from operational events (tasks, verifications, leads, deals) — never manually entered, except explicitly-designated qualitative scores.
- FR-F-3 (M): Incentive rules are versioned formulas over KPI values; every payout line traceable to source events.
- FR-F-4 (S): SOP acknowledgment required before related task types can be claimed by an employee.

### 3.8 Finance-lite (FR-G)

- FR-G-1 (M): Every closed deal records: property, tenant, owner, dealer (if any), rent, commission due/collected, splits.
- FR-G-2 (M): Field expenses require planner-task linkage and photo evidence; approval workflow by Area Manager → Ops.
- FR-G-3 (S): Receipts record payment channel (cash, bank, JazzCash, EasyPaisa) with reference IDs.

### 3.9 Notifications (FR-A3) — detailed in Doc 10

- FR-A3-1 (M): All user-facing messages route through the Notification Bus (no module sends directly); templates versioned and bilingual.
- FR-A3-2 (M): Channel policy per event class (e.g., OTP → SMS/WhatsApp; task assignment → in-app + push; SLA breach → in-app + WhatsApp to manager).
- FR-A3-3 (M): Quiet hours + Ramadan-adjusted schedules configurable per audience.

### 3.10 Analytics, Reporting, Audit (FR-H, FR-A5) — detailed in Doc 11

- FR-H-1 (M): Every module emits domain events to the analytics pipeline; dashboards defined for exec, city, area, and self-serve employee scorecards.
- FR-A5-1 (M): Audit log is append-only, captures actor/action/entity/before-after/context (IP, device), and is queryable by Compliance role only.

---

## 4. Non-Functional Requirements

> NFRs are numbered NFR-<n>. Each has a target and a rationale grounded in Pakistani operating conditions.

### 4.1 Performance & Capacity

- NFR-1: Public listing pages usable on 3G-class connections: ≤ 200KB critical payload, first contentful render < 2.5s on mid-range Android. **Why:** the tenant audience skews to low-mid Android devices on congested mobile data.
- NFR-2: Search results < 1.5s p95 server time at 10× current-city load.
- NFR-3: Internal OS screens < 2s p95; planner generation for 500 employees completes in < 10 min nightly window.
- NFR-4: Design capacity targets (10-year): 5M property records, 50M leads, 100M tasks, 500M audit events — drives partitioning strategy in Doc 04.

### 4.2 Availability & Resilience

- NFR-5: Public site availability 99.9%; internal OS 99.5% during business hours (8:00–22:00 PKT). **Why differentiated:** field ops can queue offline briefly; public trust cannot.
- NFR-6: Field app (later PWA/native) must operate offline for a full field day and sync when connectivity returns — load shedding and dead zones are normal.
- NFR-7: Degradation order under stress: analytics → AI → planner regeneration → CRM → public site (public site last to degrade).

### 4.3 Security & Privacy (full architecture in Doc 12)

- NFR-8: CNIC numbers, ownership documents, and agreements are sensitive-class data: encrypted at rest, field-level access control, access-logged, never in URLs/exports by default.
- NFR-9: Compliance posture aligned to Pakistan's Personal Data Protection framework (track the PDPB as it finalizes) + PECA obligations; data residency preference for sensitive data, with a documented lawful-processing register.
- NFR-10: Public phone numbers are masked/tracked where technically feasible; owner numbers never displayed publicly without explicit consent tier.

### 4.4 Usability & Localization

- NFR-11: Full Urdu localization (RTL-correct) on public surfaces; internal OS English-primary with Urdu glossary for field terminology.
- NFR-12: Field flows designed one-handed, camera-first, ≤ 3 taps to evidence capture; every field screen usable in direct sunlight (contrast standards).
- NFR-13: Accessibility: WCAG 2.1 AA on public site.

### 4.5 Maintainability & Modularity

- NFR-14: Modular monolith first with enforced module boundaries (each Domain A–H module owns its schema namespace; cross-module access via internal APIs/events only). **Why:** microservices at day 1 would sink a small team; boundaries now enable extraction later (Doc 12 elaborates).
- NFR-15: Every module ships with: API contract doc, event catalog entries, seed/test fixtures, and its SOP/template pack.
- NFR-16: All business rules that ops may tune (SLA hours, freshness windows, incentive formulas, target templates) are configuration, not code.

### 4.6 Auditability & Data Integrity

- NFR-17: No hard deletes on business entities — state transitions + archival only.
- NFR-18: Every KPI and payout figure reproducible from immutable source events (recompute = same answer).

### 4.7 Operability

- NFR-19: Centralized structured logging, error alerting to internal chat + on-call, health dashboards (Doc 12).
- NFR-20: Backups & DR per Doc 12: RPO ≤ 1h (sensitive/transactional), RTO ≤ 4h public site, ≤ 8h internal OS.

### 4.8 Extensibility (10-year fences)

- NFR-21: `transaction_type` extensible (rent → future sale), multi-tenancy-ready org model (future franchise partners), multi-currency-ready money fields (PKR now), and locale-ready content model (Urdu/English now, regional languages later).
- NFR-22: All integrations (WhatsApp BSP, SMS gateway, maps, payment rails) behind provider-agnostic adapters. **Why:** Pakistani provider landscape shifts; vendor swaps must be config-level events.
