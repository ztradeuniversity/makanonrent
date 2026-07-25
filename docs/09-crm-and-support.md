# 09 — CRM, Lead Management, Complaint Management, Document Management & Internal Chat

> Covers blueprint sections: 33 (CRM), 34 (Lead Management), 35 (Complaint Management), 36 (Document Management), 37 (Internal Chat)

---

## 1. CRM Core

### 1.1 Design Philosophy

Pakistani rental transactions happen on **phone calls and WhatsApp**, across weeks, with the same people wearing multiple hats (a contact can be owner + dealer + tenant over time). The CRM is therefore built as a **contact-centric relationship ledger**, not a lead-centric sales tool:

- **One contact, one timeline:** every call, WhatsApp thread, visit, deal, complaint, and consent event across all roles and years appears on one chronological timeline (FR-D-4). *Why:* trust compounds through remembered context — "aap ne pichhle saal Johar Town mein flat rent kiya tha" is a competitive weapon.
- **Role facts, not duplicate records:** owner_profile / tenant_profile / dealer_profile hang off the contact (Doc 04 §2.8).
- **Consent ledger:** what the contact agreed to (listing publication, WhatsApp marketing, screening) with timestamps — the privacy backbone (Doc 12).
- **Relationship health:** computed recency/frequency/sentiment flags drive Planner check-in tasks (dormant owner calls, alumni tenant referral asks — Doc 05).

### 1.2 Communication Hub (channel layer)

| Channel | Phase 1 | Phase 3+ |
|---|---|---|
| Phone calls | Manual log task after each call (template: outcome, summary, next step) — logging is enforced by making the follow-up task depend on it | Cloud telephony/tracked numbers where feasible: auto call records, recordings (consent notice), missed-call auto-tasks |
| WhatsApp | Company handsets with logging discipline (SOP) + manual timeline entries | WhatsApp Business API (BSP): threads in-system, templates (bilingual, versioned), session-window compliance |
| SMS | OTPs + fallback notifications via gateway | Same |
| Web forms / portal | Auto-ingested | Same |
| Walk-in / field | Field agent logs via app | Same |

All channels normalize into `interaction` records; the Notification Bus (Doc 10) handles outbound; consent + quiet hours enforced centrally.

---

## 2. Lead Management

### 2.1 Lead Model & Pipeline

Stages (Doc 04): `new → contacted → qualified → visit_scheduled → visited → negotiating → agreement → won | lost`. Two lead classes share the pipeline machinery:

- **Demand leads** (tenants seeking) — attach to requirement + candidate listings.
- **Supply leads** (owners/dealers offering) — flow into Property Discovery (Doc 05 §1) after qualification.

### 2.2 Intake & Assignment

1. **Capture within 1 minute** of any channel event (FR-D-1); every lead carries source attribution (channel registry code, campaign, listing reference).
2. **Assignment rules:** area → role (telesales pool for that area) → load balancing → skill/language flags. Verified-Partner dealers may receive routed leads per their tier (Doc 05 §5) with tracked outcomes.
3. **SLA timers:** first-response SLA (15 min working hours — the Speed-to-Lead guardrail, Doc 01 §1.5); stage-dwell SLAs (e.g., qualified leads must have a visit scheduled or a disposition within 48h). Breaches escalate: agent → Area Manager → CRM Lead, each escalation being a generated task + notification.
4. **Missed-call discipline:** a missed inbound call is automatically a `new` lead with a P1 callback task. In a phone-culture market, missed calls are the single biggest silent revenue leak.

### 2.3 Qualification & Matching

- Structured requirement capture (budget, areas, unit type, family policy, move date, occupants) — mandatory before `qualified`.
- System proposes matching **verified** listings ranked by fit; agent curates a shortlist sent via WhatsApp template (listing cards with reference codes).
- No-match leads park in a **demand pool** per area: when matching supply is verified later, the Planner generates outreach tasks ("3 waiting tenants match this new listing") — demand backlog becomes a supply-acquisition signal shown to Area Managers.

### 2.4 Visits → Negotiation → Close

- Visit scheduling books both sides + optional field-agent accompaniment (owner-trust and conversion booster); outcomes captured with reason codes (feeds listing quality and lead scoring).
- Negotiation stage surfaces area rent norms (master data) to keep agents honest brokers.
- `won` requires a Deal record (rent, commission, splits, agreement doc) — closing without paperwork is structurally impossible, protecting revenue and the North-Star metric's integrity.
- `lost` requires a coded reason (budget, availability, chose competitor, ghosted, family-policy mismatch) — loss analytics steer supply targets.

### 2.5 Lead Scoring & AI (Phase 5+, Doc 10)

Response-likelihood and closing-likelihood scores order agent queues; hot-lead alerts; ghosting prediction triggers a different cadence template. Always assistive — SLA rules remain deterministic.

---

## 3. Complaint Management

### 3.1 Intake Channels & Categories

Anyone (tenant, owner, dealer, employee-reported) can open a complaint via call, WhatsApp keyword, portal form, or agent logging. Categories (master data): `fake_info` (trust-critical), `behavior`, `payment_dispute`, `maintenance`, `verification_error`, `service_delay`, `other`. Severity: S1 (trust/safety) → S3 (minor).

### 3.2 Workflow

```
NEW → TRIAGED (category, severity, owner assigned)
    → INVESTIGATING → RESOLVED_PENDING_CONFIRMATION
    → CLOSED_CONFIRMED | CLOSED_UNCONFIRMED (documented attempts)
    → REOPENED (within window) ↩
```

| Rule | Detail |
|---|---|
| SLAs by severity | S1: triage 2h / resolve 24h; S2: 4h / 72h; S3: 24h / 7d — configurable (NFR-16); breaches escalate CRM Lead → City Manager |
| Trust-critical linkage | `fake_info` or `verification_error` on a verified listing auto-opens a complaint-triggered verification case and demotes the listing (Doc 05 §2.2) — complaints police the badge |
| Employee-behavior complaints | Route to Area Manager + HR visibility; repeated patterns feed performance records |
| Resolution evidence | Required note + artifacts; closure needs complainant confirmation or 3 documented contact attempts (FR-D-3) |
| Root-cause tagging | Mandatory at close; tags link to SOPs → the SOP feedback loop (Doc 06 §3.1) |
| Reopen tracking | Reopen rate is a quality KPI (CRM Lead scorecard) |

### 3.3 Complaint Analytics

Complaint rate per 100 closings, by category/area/employee/dealer; trust-critical complaint trend is an executive guardrail metric (Doc 11).

---

## 4. Document Management

### 4.1 Classes & Policies

| Class | Examples | Policy |
|---|---|---|
| **Sensitive** | CNIC copies, ownership documents, rent agreements, screening reports, HR contracts, payroll files | Encrypted bucket class; field-level ACL (Doc 03 §3.3); every access logged; watermarked views ("For MakanOnRent verification only"); no bulk export; retention per legal schedule |
| **Internal** | SOPs, evidence photo sets, training materials, reports | Role-scoped access |
| **Public assets** | Listing photos/videos (consented), content library | CDN-served derivatives; originals retained |

### 4.2 Capabilities

- **Versioning** on every document; immutable version history with hashes (evidence integrity, Doc 05 §2.2).
- **Entity linkage:** every document belongs to a module entity (verification case, deal, employee, SOP) — no orphan files.
- **Templates:** agreements, offers, notices generated from versioned templates with merge fields (agreement templates per city norms; Urdu/English).
- **Retention engine:** per-class schedules (e.g., CNIC copies purged N months after relationship end unless legal hold); deletion is certified and logged. **Why explicit retention:** holding CNICs forever is a liability, not an asset — this is the module that keeps the promise.
- **Physical-document tracking (Pakistan reality):** stamp papers and signed originals exist on paper; the system tracks physical custody (location, holder, movement log) alongside scans.

---

## 5. Internal Chat

### 5.1 Purpose & Boundaries

Chat is for **coordination speed**; the Planner/tasks are for **work of record**. The design enforces that boundary — decisions and assignments made in chat must land as tasks, and the system makes that a one-tap action.

### 5.2 Structure

| Channel Type | Examples | Rules |
|---|---|---|
| Area channels | #lahore-johar-town | Auto-membership by role scope; field coordination |
| Role channels | #verification-agents, #telesales | SOP updates discussion, peer help |
| Topic channels | #fraud-alerts, #wins | #fraud-alerts posts auto-generated from integrity flags |
| Task threads | Per-task discussion | Attached to the task record; part of its audit context |
| Announcements | Company/city broadcast | Post = read-receipt tracked (policy/SOP announcements require acknowledgment via SOP module, not chat) |
| DMs | 1:1 | Retention policy applies; harassment reporting hook |

### 5.3 Governance

- **Convert-to-task:** any message can spawn a task (pre-filled from message) — the anti-"lost in chat" mechanism.
- **Retention:** business-record channels retained per policy; DMs shorter window; Compliance search access only via logged, justified queries (Doc 03 §2.4).
- **No customer PII dumping in chat:** sensitive-data detector warns/blocks CNIC numbers and document images in chat — customer data lives in CRM/Docs where it's ACLed.
- **Why build/integrate chat at all** (vs "just use WhatsApp"): company WhatsApp groups leak customer data, are unauditable, vanish with personal phones, and can't link to tasks. Internal chat inside the OS is a security and continuity requirement, not a convenience. (Implementation may embed a self-hosted chat component — decision deferred to engineering; the requirement is the integration contract above.)

---

## 6. Interactions Map

- CRM timeline aggregates events from Leads, Visits, Deals, Complaints, Notifications, Trust Services.
- Leads generate Planner tasks (follow-ups, callbacks, freshness) and consume matching from Search/AI.
- Complaints police Verification (badge demotion) and feed SOP improvement + KPI quality pairs.
- Documents underpin Verification evidence, Deals (agreements), HR (contracts), with the audit log recording all sensitive access.
- Chat links to tasks; tasks link to SOPs; everything emits domain events for Analytics (Doc 11).
