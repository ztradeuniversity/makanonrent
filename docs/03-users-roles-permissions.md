# 03 — User Types & Permission Matrix

> Covers blueprint sections: 9 (User Types), 10 (Permission Matrix)

---

## 1. User Type Model

Users divide into **external** (customers/partners) and **internal** (employees/contractors). A human has exactly one identity; roles are attached to the identity. Internal roles are scoped: most carry an **area scope** or **city scope** — an Area Manager's permissions apply only within assigned areas. **Why scoped roles:** expansion multiplies areas, not role types; scoping keeps the matrix stable for 10 years.

### 1.1 External User Types

| Type | Who | Primary Surface | Notes |
|---|---|---|---|
| **Visitor** | Anonymous browser | Public website | Can search/view; lead capture requires phone |
| **Tenant** | Registered rent-seeker (phone-verified) | Public site / tenant app | Saved searches, visit bookings, agreements, complaints |
| **Owner** | Property owner (phone + identity verified during property verification) | Owner portal (PWA) | Listing status, lead activity summary, availability confirmation, services |
| **Dealer (Basic)** | Registered property dealer | Dealer portal | Can submit listings into intake queue; sees own pipeline |
| **Dealer (Verified Partner)** | Vetted dealer under partnership agreement | Dealer portal | Badge, priority routing, commission-split visibility |
| **Vendor** | Service providers (movers, cleaners, repair) | Minimal portal / WhatsApp | Job offers, completion confirmations (Phase 5+) |

### 1.2 Internal User Types

| Type | Reports To | Scope | Core Job |
|---|---|---|---|
| **Founder / Super Admin** | — | Global | Everything; break-glass access (audited) |
| **CEO/COO (Exec)** | Founder | Global | Dashboards, approvals above thresholds, target setting |
| **City Manager** | Exec | City | All areas in city; hiring approvals; city P&L |
| **Area Manager** | City Manager | Area(s) | Field team leadership, verification approvals, dealer/owner relationships, area targets |
| **Field Verification Agent** | Area Manager | Area(s) | Property visits, evidence capture, To-Let surveys, accompanied visits |
| **Telesales / Lead Agent** | Area Manager or CRM Lead | Area(s) | Inbound lead handling, follow-ups, visit scheduling, freshness calls |
| **CRM/Support Lead** | City Manager | City | Lead SLA management, complaint resolution, comms quality |
| **Marketing Executive** | Marketing Lead | Area/City | Executes marketing planner tasks: FB groups, WhatsApp communities, campaigns |
| **Content/Social Executive** | Marketing Lead | Global/City | Content calendar, posts, video, SEO tasks |
| **Marketing Lead** | Exec | Global | Owns marketing + social planners, budgets, channel registry |
| **HR Executive** | Exec | Global | Recruitment pipeline, onboarding, attendance, payroll inputs |
| **Trainer** | HR | Global/City | Training tracks, certifications, shadowing sign-offs |
| **Finance Executive** | Exec | Global | Commission ledger, expenses, invoicing, payroll export |
| **Compliance/Audit Officer** | Founder | Global | Audit log review, verification re-audits, data-access reviews |
| **Master Data Editor** | Ops | Global | Geographic/master data maintenance |
| **System Admin (IT)** | Exec | Global (technical) | Platform config, integrations, user provisioning execution |

**Deliberate design choices:**
- **No generic "Admin" role.** Every internal capability belongs to a named business role; the Super Admin role exists but its use is break-glass and fully audited. *Why:* generic admin accounts are how fraud and untraceable changes happen.
- **Verifier certification is a permission gate, not a role.** A Field Agent cannot submit final verification evidence until certified (Doc 06); an Area Manager cannot approve verifications outside their area.
- **Dealer ≠ internal.** Even Verified Partners never see other dealers' data, owner CNICs, or internal notes.

---

## 2. Permission Matrix

Legend: **C**reate / **R**ead / **U**pdate / **A**pprove / **X**ecute / **—** none. `(a)` = within assigned area scope only. `(o)` = own records only. `(s)` = summary/masked only.

### 2.1 Supply-Side Objects

| Object → Role ↓ | Property | Listing | Verification Case | Owner Profile | Dealer Profile | To-Let Survey |
|---|---|---|---|---|---|---|
| Visitor | R(s) | R (verified only) | — | — | — | — |
| Tenant | R(s) | R (verified only) | — | — | — | — |
| Owner | R(o) | R/U(o, limited fields) | R(o, status only) | R/U(o) | — | — |
| Dealer Basic | C(intake)/R(o) | C(intake)/R(o) | R(o, status) | — | R/U(o) | — |
| Dealer Partner | C(intake)/R(o) | C(intake)/R(o)/U(o price-availability) | R(o, status) | — | R/U(o) | — |
| Field Agent | C/R/U(a) | R(a) | C/R/U(a) — cannot approve | R(a, masked CNIC) | R(a) | C/R/U(a) |
| Telesales Agent | R(a) | R/U(a: availability, freshness) | R(a, status) | R(a, masked) | R(a) | R(a) |
| Area Manager | C/R/U(a) | C/R/U(a) | **A**(a) | C/R/U(a) | C/R/U(a) | R/U/A(a) |
| City Manager | R/U(city) | R/U(city) | A(city, escalations) | R(city) | R/U/A(city) | R(city) |
| CRM Lead | R(city) | R(city) | R(city) | R(city, masked) | R(city) | — |
| Marketing roles | R(s) | R | — | — | R(s) | R |
| HR / Trainer | — | — | — | — | — | — |
| Finance | R(s) | R(s) | — | R(s) | R + commission terms | — |
| Compliance | R (all, incl. evidence) | R | R + re-audit **X** | R (full, logged) | R | R |
| Master Data Editor | — (geo data only) | — | — | — | — | — |
| Sys Admin | — (no business data by default) | — | — | — | — | — |
| Super Admin | break-glass all (audited) | | | | | |

### 2.2 Demand & Engagement Objects

| Object → Role ↓ | Lead | Tenant Profile | Visit | Deal/Commission | Complaint | CRM Timeline |
|---|---|---|---|---|---|---|
| Tenant | C(o) | R/U(o) | C/R(o) | R(o, own agreement) | C/R(o) | — |
| Owner | R(o, summary of leads on own listings) | — | R(o listings) | R(o) | C/R(o) | — |
| Dealer Partner | R(o, routed leads) | — | C/R(o) | R(o, splits) | C/R(o) | — |
| Telesales Agent | C/R/U(a) | C/R/U(a) | C/R/U(a) | C(draft, a) | C/R/U(a) | R(a) |
| Field Agent | R(a, assigned) | R(a, assigned) | R/U(a, assigned) | — | C(a) | R(a, assigned) |
| Area Manager | R/U/**A**(a) reassign | R(a) | R/U(a) | C/R/U(a), A ≤ threshold | R/U/A(a) | R(a) |
| CRM Lead | R/U/A(city) | R(city) | R(city) | R(city) | R/U/A(city) + SLA config | R(city) |
| City Manager | R(city) | R(city) | R(city) | A(city) | A(city escalations) | R(city) |
| Finance | — | — | — | R/U(collections), A(payout) | — | — |
| Compliance | R | R (logged) | R | R | R | R |

### 2.3 Operations & People Objects

| Object → Role ↓ | Task (own) | Task (others) | Planner Config/Targets | SOP | KPI Scorecard | Employee Record | Payroll/Incentive | Recruitment | Training |
|---|---|---|---|---|---|---|---|---|---|
| Any Employee | R/U/X(o) | — | R (own targets) | R + acknowledge | R(o) | R(o, limited) | R(o, payslip) | — | R/X(o, assigned) |
| Area Manager | R/U/X(o) | C/R/U(a) reassign | R/U(a, within bounds) | R, propose edits | R(a team) | R(a team, limited) | R(a team incentives) | interview X | assign(a) |
| City Manager | ″ | C/R/U(city) | U/A(city) | A (city-scope SOPs) | R(city) | R(city) | A(city) | A(requisitions) | A(city) |
| Marketing Lead | ″ | C/R/U(marketing roles) | U(marketing targets) | A(marketing SOPs) | R(marketing team) | — | R(team) | — | — |
| HR Executive | ″ | C(HR tasks) | — | R | R (all, HR views) | C/R/U (all) | C/R/U (draft) | C/R/U/X | C/R/U |
| Trainer | ″ | C(training tasks) | — | C/R/U (training SOPs) | R (trainees) | R (trainees, limited) | — | R | C/R/U/**A** certify |
| Finance | ″ | — | — | R | R (payout-relevant) | R (limited) | **A**/X export | — | — |
| Exec | R all | C/R/U all | C/R/U/A global | A | R all | R all | A above threshold | A | R |
| Compliance | R all | R all | R | R | R all | R all (logged) | R all | R | R |
| Sys Admin | — | — | X (run/rerun engine jobs) | — | — | — | — | — | — |

### 2.4 Platform Objects

| Object → Role ↓ | Master Data | Notification Templates | Audit Log | Documents (sensitive class) | Internal Chat | Analytics Dashboards |
|---|---|---|---|---|---|---|
| Employees (general) | R | — | — | R (need-to-know per object ACL) | C/R (member channels) | R (own scorecard + area public boards) |
| Master Data Editor | C/R/U | — | — | — | ″ | R |
| CRM Lead / Marketing Lead | R | C/R/U (own domain) A by Exec | — | R (domain) | + create channels | R (domain) |
| Area/City Manager | R, propose | R | — | R (a/city, logged) | + area channels | R (a/city) |
| Compliance | R | R | **R/X (search, export)** | R all (logged) | R (retention review) | R all |
| Exec | R/A | A | R (via Compliance reports) | R (logged) | all | R all |
| Sys Admin | X (imports) | X (delivery config) | — (no read of content) | — (no read; storage admin only) | admin (no read of private w/o Compliance) | X (pipeline admin) |
| Super Admin | break-glass (audited) | | | | | |

---

## 3. Enforcement Rules (how the matrix is real, not aspirational)

1. **Deny-by-default, server-side** (FR-A1-3). UI hiding is a courtesy; the API is the enforcement point.
2. **Scope resolution at query time:** every internal query is filtered by the actor's role-scope pairs; there is no "unscoped" query path for scoped roles.
3. **Field-level sensitivity classes:** CNIC, ownership docs, salaries, and audit content are field-ACLed on top of object permissions. Masked variants (last-4 CNIC, initials) serve routine screens.
4. **Approval separation-of-duties:** the same identity cannot both submit and approve a verification case, a payout, or an expense — enforced structurally, not by policy memo.
5. **Elevation is temporary and logged:** break-glass Super Admin sessions require reason entry, expire in hours, and trigger a Compliance notification.
6. **Role changes flow from HR lifecycle events** (Doc 05/06): hire → provision, role change → re-provision, exit → revoke within 60s (FR-A1-4).
7. **Certification gates** (Doc 06) sit above the matrix: holding the role is necessary but not sufficient for gated actions.
8. **Every A (approve) and every sensitive R is an audit event** with actor, scope, and justification where required (Doc 11).

**Why this design scales 10 years:** new cities/areas add *scopes*, new services add *objects*, and the role list stays short and human-comprehensible. The permission system's complexity budget is spent on scoping and field sensitivity — the two dimensions that actually grow.
