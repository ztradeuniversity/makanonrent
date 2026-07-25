# 10 — AI Modules & Notification System

> Covers blueprint sections: 31 (AI Modules), 32 (Notification System)

---

## 1. AI Modules

### 1.1 AI Doctrine

1. **AI assists, humans decide** (Doc 01 §4.1). Every AI output is a *recommendation with a confidence score and an explanation*; automation graduates per module only after measured precision on our own data.
2. **Trust-critical paths keep humans in the loop permanently:** no AI ever issues a verification badge, blacklists a person, or fires an employee signal without human approval.
3. **AI is a consumer of the event spine** (Doc 04): models read domain events + entity data through governed interfaces; outputs are written back as scored annotations (flags, ranks, drafts), never as direct state changes.
4. **Provider-agnostic:** all model access behind an internal AI service layer (NFR-22) — hosted LLM APIs now, swappable later; sensitive fields (CNIC, documents) are masked/tokenized before leaving the trust boundary, per Security (Doc 12).
5. **Urdu/Roman-Urdu first-class:** language handling must cover Urdu script, Roman Urdu ("2 kamray wala portion"), and code-switched text — this is where foreign off-the-shelf pipelines fail and where our fine-tuning data becomes a moat.

### 1.2 AI Module Catalog

| # | Module | What It Does | Consumers | Graduation Path |
|---|---|---|---|---|
| AI-1 | **Duplicate Property Detection** | Scores property-pair similarity: geo proximity, normalized address, photo similarity (perceptual hash + embedding), phone reuse across listings | Property Registry merge queue (Area Manager decides) | High-confidence auto-merge only after ≥99% precision on audited samples |
| AI-2 | **Listing Fraud & Quality Scoring** | Flags: stock/recycled photos, price-too-good-for-area (vs rent norms), suspicious posting patterns, description-attribute contradictions | Verification prioritization (risky cases get senior agents), intake triage | Stays assistive permanently |
| AI-3 | **Evidence Anomaly Detection** | Verification photo sets: liveness/recency signals, geo-EXIF consistency, same-photo-reuse across cases, checklist-vs-photo mismatch | QC review screen (Doc 05 §2) | Assistive; drives QC sampling rates |
| AI-4 | **Lead Triage & Scoring** | Intent classification from WhatsApp/call text, response-likelihood, closing-likelihood, ghosting prediction; hot-lead alerts | Lead queues ordering (Doc 09 §2.5) | Auto-prioritization OK; never auto-rejects a lead |
| AI-5 | **Matching & Ranking** | Requirement↔listing semantic matching beyond hard filters (e.g., "near Comsats, silent family") | Search results, shortlist suggestions, demand-pool alerts | Ranking automation OK (hard filters always respected) |
| AI-6 | **Rent Estimation & Norms** | Area/type/size rent benchmarks from our verified history + survey data | Listing intake sanity checks, negotiation support, rent index (H4 strategy) | Advisory only |
| AI-7 | **Content Drafting (bilingual)** | Listing descriptions (Urdu + English) from structured attributes; social captions; area-guide drafts; WhatsApp reply suggestions | Listing pipeline, Social planner, Telesales assist | Human review mandatory before anything publishes (FR-C-4) |
| AI-8 | **Conversation Intelligence** | Call-recording/WhatsApp thread summarization into CRM timeline; action-item extraction → suggested tasks; call-quality scoring support | CRM timeline, KPI call-quality sampling | Summaries auto-post labeled as AI; quality scores always human-confirmed |
| AI-9 | **Planner Intelligence** | Duration estimation, route optimization, conversion-yield forecasting, target feasibility warnings, anomaly alerts ("Area X freshness compliance collapsing") | Daily Planner learning loop (Doc 07 §7) | Estimates/routing automated; target changes always human-approved |
| AI-10 | **Dealer & Partner Risk Scoring** | Composite quality score (Doc 05 §5) + fraud-pattern detection across submissions | Dealer tiering, routing priority | Tier changes human-approved; blacklist always human |
| AI-11 | **Support Copilot (internal)** | Answers staff questions from SOP library + policies ("what's the re-audit procedure?") with citations | Internal chat bot, training reinforcement | Assistive; SOP text remains source of truth |
| AI-12 | **Public Assistant (Phase 5+)** | WhatsApp/site assistant for tenants: capture requirements conversationally (Urdu/English), answer listing questions from verified data only, hand off to humans | Lead capture funnel | Strict guardrails: never invents availability/price; instant human handoff path |

### 1.3 Data & Evaluation Infrastructure

- **Labeled-data flywheel:** every human decision on an AI recommendation (merge accepted/rejected, fraud flag confirmed/dismissed, draft edited) is captured as training signal — the review UIs are labeling UIs.
- **Model registry & versioning:** every scored annotation records model + version + confidence; KPIs computed per model version (precision/recall dashboards in Analytics).
- **Bias & fairness review:** quarterly Compliance review of AI flags by area/demographic proxies (e.g., ensure fraud flags aren't proxying a neighborhood).
- **Cost governance:** per-module inference budgets; batch where latency allows (overnight dedup sweeps vs real-time lead triage).

---

## 2. Notification System

### 2.1 Architecture

Central **Notification Bus** (A3): modules publish typed events; the bus resolves audience → template → channel policy → delivery, with full delivery tracking. **No module sends messages directly** (FR-A3-1) — this is what makes consent, quiet hours, dedup, and auditing enforceable in one place.

```
domain_event → subscription rules → notification intent
→ audience resolution (roles/scopes/contacts + consent check)
→ template render (versioned, bilingual, channel-specific)
→ channel policy (priority, fallback chain, quiet hours, dedup, rate caps)
→ provider adapters (WhatsApp BSP | SMS gateway | push | in-app | email)
→ delivery tracking (sent/delivered/read/failed) → retry/fallback → audit
```

### 2.2 Channels & Fallback Chains

| Channel | Use | Notes (Pakistan-first) |
|---|---|---|
| **WhatsApp (template messages)** | Primary external channel: OTPs, listing shortlists, visit confirmations, freshness confirmations, payment receipts | BSP-approved templates; session-window rules; Urdu/English per contact preference |
| **SMS** | OTP fallback, critical alerts for non-WhatsApp users | Delivery is unreliable on some networks — hence fallback chains, never single-channel for critical messages |
| **In-app + push** | All internal notifications (tasks, escalations, plans) | Internal default; WhatsApp only for urgent internal (SLA breach to managers) |
| **Email** | Documents, payslips, exec reports | Secondary in Pakistan; never sole channel for customers |
| **Calls (human)** | Not a bus channel — but the bus can generate a *call task* | "Notify by human call" is a first-class policy for high-stakes events (deal confirmation, S1 complaints) |

Fallback example (OTP): WhatsApp → 30s → SMS. Critical internal (S1 complaint): in-app + push → 10 min unacked → WhatsApp to manager → 30 min → call task to City Manager.

### 2.3 Event Class → Policy Matrix (seed)

| Event Class | Audience | Channels | Priority |
|---|---|---|---|
| OTP / auth | Contact | WA → SMS | Immediate, bypasses quiet hours |
| New matching verified listing | Tenant (saved search) | WA template (daily digest cap: max 1/day) | Batched |
| Visit confirmation/reminder | Tenant + Owner + Agent | WA + in-app; reminder T-2h | Scheduled |
| Freshness confirmation request | Owner | WA quick-reply → telesales call task if no reply in 24h | Scheduled |
| New lead assigned | Agent | In-app + push | Immediate |
| SLA breach | Agent's manager chain | In-app + WA | Immediate |
| Daily plan published | Employee | In-app + push, morning slot | Scheduled |
| Badge expiring | Area Manager + Owner | In-app / WA | Batched daily |
| Payslip issued | Employee | In-app + email | Scheduled |
| S1 complaint opened | CRM Lead + City Manager | In-app + WA | Immediate |
| System incident | On-call + Sys Admin | Push + WA + call task | Immediate |

### 2.4 Governance Rules

1. **Consent-checked:** marketing-class messages require consent tier; transactional messages ride legitimate-interest with opt-out honored (Doc 12 privacy register).
2. **Quiet hours:** default 21:30–08:30 for external non-critical; Ramadan profile shifts windows (sehri/iftar blackouts, later evening OK) (FR-A3-3).
3. **Dedup + digest:** dedup keys prevent double-sends; per-contact daily caps convert overflow into digests. **Why:** notification fatigue destroys the channel — WhatsApp blocks from annoyed users are a real, measurable risk.
4. **Template governance:** versioned, bilingual, owned by domain leads, Exec-approved for external marketing classes; BSP template approval status tracked.
5. **Delivery analytics:** per-template delivery/read/response rates in Analytics — templates are A/B-testable master data.
6. **Full audit:** every external message (what, to whom, when, which template version, consent basis) is queryable — dispute protection and regulatory posture.
