# 13 — Future Mobile App, Expansion Strategy, Admin Dashboards & Public Website Structure

> Covers blueprint sections: 40 (Future Mobile App), 41 (Expansion Strategy), 49 (Admin Dashboards), 50 (Public Website Structure)

---

## 1. Future Mobile App Strategy

### 1.1 Sequencing (why this order)

| Order | App | Rationale |
|---|---|---|
| 1 | **Field Ops app** (internal) | Highest operational leverage: offline verification kit is a hard requirement (NFR-6) that the mobile web cannot fully deliver. Ships Phase 6, PWA precursor from Phase 2 |
| 2 | **Tenant app** | Retention + saved-search alerts + visit management; but tenants transact via WhatsApp happily, so the PWA carries demand until volume justifies native |
| 3 | **Owner app** | Lower frequency use; owner portal PWA suffices long; native when management-lite (rent collection, inspections) launches |
| 4 | **Dealer app** | Partner tier tooling; PWA-first |

**Platform decision:** PWA-first everywhere, then a single cross-platform codebase (Flutter/React-Native-class) for native shells — Android overwhelmingly first (Pakistan's device reality), iOS later for owner/overseas segments. All apps consume the same APIs and permission model as the web (Doc 03 enforcement is server-side, so surfaces are thin).

### 1.2 Field Ops App (the one that matters most)

- **Offline-first:** day's plan, route sheet, entity data for assigned tasks, and capture flows all work with zero connectivity; sync queue with conflict rules (server wins on state, field wins on evidence) when signal returns.
- **Evidence capture:** in-app camera only (FR-B-4), GPS sealing, checklist-driven photo sets, compression tuned for weak uplinks.
- **One-hand operation, sunlight-readable, Urdu labels** (NFR-12); battery-frugal (load-shedding days mean no charging).
- **Field safety:** check-in/out per visit, SOS action, expected-duration alerts to Area Manager.

### 1.3 Tenant App (differentiating features when it comes)

Saved-search push alerts (faster than portals' email habits), verified-badge-forward browsing, visit scheduling + reminders, agreement/service tracking, complaint channel, referral program hooks. No feature ships in-app before its API + PWA proves demand.

---

## 2. Expansion Strategy (Pakistan-wide)

### 2.1 Expansion Doctrine

**Area-by-area, never city-splash.** An "expansion unit" is an *area cluster* (2–4 adjacent areas sharing a field team), not a city. A city is entered by winning one cluster, then tiling outward. **Why:** trust is local; a thin presence across a whole city produces stale listings and broken promises — the exact failure we exist to fix.

### 2.2 City Sequencing (indicative, data-revisable)

1. **Launch city:** Lahore (assumed home base — dense rental stock, society structure well-defined, single language market).
2. **City 2:** Rawalpindi/Islamabad (high rents, transferable playbook, strong overseas-owner segment).
3. **City 3:** Karachi (largest market, entered later deliberately: sq-yd conventions, distinct society/board structures, higher complexity — needs a hardened playbook and a strong City Manager).
4. **Then:** Faisalabad, Multan, Gujranwala, Peshawar, Hyderabad — chosen by data: rental volume signals (portal listing counts, To-Let density surveys), university/industrial demand anchors, and recruitment feasibility.

### 2.3 The Expansion Kit (product feature, per Doc 01 R8)

Opening a new area/city is a **wizard-driven checklist** the system executes:

1. **Market survey pack:** templated field-survey tasks (rent norms, dealer census, society mapping, To-Let density) → go/no-go scorecard with thresholds.
2. **Master data cloning:** geo tree seeding, vocab reuse, holiday/season calendars, commission norm table for the city.
3. **Recruitment kit:** auto-generated requisitions from the staffing model (1 Area Manager + N field agents + telesales per projected supply), role profiles cloned (Doc 06 §1.2).
4. **Target templates:** ramp curves (month 1–6 targets) derived from launch-city actuals via the funnel arithmetic (Doc 07 §7).
5. **Channel bootstrap:** channel-discovery task wave (FB groups, WhatsApp communities, dealer offices for the new areas).
6. **Launch sequence:** supply-first (verify 100+ listings before public switch-on per area), then demand marketing wave.
7. **Gate reviews:** the phase-gate exit criteria (Doc 01 §5) applied per new unit; expansion pauses automatically if guardrails (integrity, freshness) degrade in existing units — **growth never outruns trust.**

### 2.4 Organizational Scaling

Founder → City Managers (grown internally, Doc 06 §5.3) → Area Managers → field teams; central shared services (HR, Finance, Marketing content, Engineering, Compliance) stay lean because the OS carries coordination. Tier-2/3 cities (Year 7+): evaluate franchise/partner Area Managers operating on our OS with our SOPs and QC — the `org_id` multi-tenancy fence (NFR-21) and the permission scope model were designed for this day.

### 2.5 Expansion Risks

Capital pacing (each unit is months of ops cost before margin) → gated by per-area contribution (Doc 11 City P&L); playbook drift in far cities → re-audit sampling + Planner telemetry are city-agnostic watchdogs; local incumbent dealer resistance → partner program leads every new-city entry.

---

## 3. Admin Dashboards (internal consoles)

> Distinct from analytics dashboards (Doc 11): these are **work consoles** — where roles operate. Each console = queues + actions + its slice of analytics. All are role/scope-filtered (Doc 03).

| Console | Primary Role | Core Panels |
|---|---|---|
| **Founder/Exec Console** | Exec | North-Star board, target-risk board, approvals queue (thresholded payouts, targets, SOPs, tiers), expansion gate status, compliance summary |
| **City Console** | City Manager | Area comparison, escalation queue, requisition approvals, P&L, calibration tools |
| **Area Operations Console** | Area Manager | Team plan board + exceptions, verification QC queue, dealer/owner relationship boards, target progress, merge queue, backlog triage |
| **Verification Console** | AM/QC + Compliance | Case pipeline by state, evidence review screen (side-by-side claim vs evidence + AI flags), re-audit queue, integrity stats |
| **CRM Console** | Telesales/CRM Lead | Lead queues (SLA-ordered), contact 360° timeline, matching/shortlist builder, visit calendar, complaint board, freshness call queue |
| **Marketing Console** | Marketing roles | Today's posting slots, channel registry manager, campaign builder, content calendar + asset library, attribution reports |
| **HR Console** | HR/Trainer | Recruitment pipeline board, onboarding tracker, training/certification matrix, attendance/leave, PIP tracker, payroll workbench |
| **Finance Console** | Finance | Commission ledger, collections queue, expense approvals, invoicing, payroll export, revenue reports |
| **Compliance Console** | Compliance | Audit search, sensitive-access reviews, break-glass log, anomaly flags, re-audit outcomes, retention/purge certifications |
| **Master Data Console** | MD Editor | Geo tree editor, vocab manager, proposal queue (field-submitted), template/SLA/config registries with version history |
| **System Console** | Sys Admin | Job monitor (planner runs, pipelines), integration health, feature flags, notification delivery health, environment status |
| **My Day (every employee)** | All | Personal plan, task execution, evidence capture, scorecard, payslips, SOP acknowledgments, chat |

Design rule: **every console is queue-driven** — a role logs in and sees *what needs them now*, ordered; browsing is secondary. This is the UI expression of "system-driven, not memory-driven."

---

## 4. Public Website Structure

### 4.1 Information Architecture

```
Home
├─ Search & Listings
│  ├─ /rent/{city}                      city hub
│  ├─ /rent/{city}/{area}               area hub (SEO core)
│  ├─ /rent/{city}/{area}/{unit-type}   e.g., /rent/lahore/johar-town/upper-portion
│  └─ /listing/{code}-{slug}            listing detail
├─ Area Guides  /guide/{city}/{area}    rents, societies, schools, transport
├─ How Verification Works               the trust story + public integrity stats
├─ For Owners   list-your-property funnel, services (agreement, tenant registration, screening)
├─ For Dealers  partner program
├─ Trust & Safety  fake-listing education, report-a-listing, complaint portal
├─ Company      about, careers (feeds Recruitment), contact
├─ Legal        terms, privacy (consent explanations), complaint policy
└─ Account      tenant dashboard (saved searches, visits, agreements, complaints)
```

### 4.2 Listing Detail Page (the trust artifact)

Content order is deliberate: **Verified badge + verification date + availability-last-confirmed** (FR-C-2) → photos (watermarked, capture-verified) → rent + advance/security terms → structured attributes (portion, floor, beds/baths, sui gas, water source, meters, parking, family policy) → location (area/society/landmark; exact address withheld until visit stage) → contact actions (**call, WhatsApp with pre-filled reference, request callback** — all three lead-tracked, FR-C-3) → area rent-norm context ("typical for 5-marla upper portion in this area") → similar verified listings.

### 4.3 Search Experience

Filter set per FR-C-1 (budget, area/society multi-select, unit type, family policy, gas, water, furnishing, floor, parking, beds); default sort = freshness-weighted relevance (never pure recency — rewards our freshness engine, punishes staleness); map view secondary (landmark/area mental model dominates in Pakistan, map is a helper not the hero); saved search with WhatsApp alerts (FR-C-5).

### 4.4 SEO Architecture

- **Area hubs + unit-type pages** are the SEO core: "upper portion for rent in Johar Town" is the actual query language of the market — URL structure mirrors it.
- Structured data (schema.org listing markup), bilingual content (Urdu pages: `/ur/...` mirrored tree, hreflang), area guides fed by master data + rent index (Doc 11 §1.3) — content competitors can't fake because it comes from verified data.
- Performance budget per NFR-1 (3G-class targets); listing pages statically cacheable with revalidation (also the DR stale-serve path, Doc 12 §3.2).

### 4.5 Conversion Design Principles

Phone-first CTAs everywhere (call/WhatsApp above the fold); OTP-phone signup only when value is exchanged (saving a search, booking a visit) — never gate browsing; every public interaction lands in CRM with attribution; Urdu toggle prominent; low-literacy affordances (icons + numbers over dense text) on filters.
