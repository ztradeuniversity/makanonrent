# 11 — Analytics, Reporting & Audit Logs

> Covers blueprint sections: 30 (Audit Logs), 38 (Analytics), 39 (Reporting)

---

## 1. Analytics

### 1.1 Architecture

- **Event spine → warehouse:** all modules emit domain events (Doc 04 §1.1); a streaming/nightly pipeline lands them in a columnar warehouse alongside nightly entity snapshots (for state-in-time questions like "verified-live count on March 1").
- **Semantic layer:** every metric in the company has exactly one definition, versioned, in a metric catalog (the same catalog the Target system and KPI system read — Doc 07 §5.2). **Why:** the classic failure is three dashboards disagreeing on "closings"; a single semantic layer makes targets, KPIs, dashboards, and payroll arithmetic provably consistent (NFR-18).
- **Access:** dashboards are role/scope-filtered like everything else (an Area Manager sees their areas; scorecards are self-visible; salary analytics are Finance/Exec/HR only).

### 1.2 Dashboard Suite

| Dashboard | Audience | Core Content |
|---|---|---|
| **Executive (North Star)** | Founder/Exec | Closings/month vs target; guardrails: Verification Integrity, Speed-to-Lead, Freshness (Doc 01 §1.5); revenue vs plan; city comparison; trust-critical complaint trend |
| **City P&L** | City Manager, Exec | Revenue (commissions, services), direct costs (salaries, incentives, field expenses, marketing), contribution margin per area; expansion-gate metrics (Doc 01 phases) |
| **Area Operations** | Area Manager | Supply funnel (discovered→registered→verified-live), freshness compliance, demand funnel (leads→visits→closings), backlog/carry-forward, team scorecard summary, dealer leaderboard |
| **Supply Health** | Ops | Verified-live by area/type; badge expiries upcoming; verification throughput & first-pass rate; dedup queue; dormant reactivation |
| **Demand & Funnel** | CRM Lead, Marketing Lead | Leads by source/channel/campaign; SLA compliance; stage conversion; loss reasons; demand-pool (unmet requirements by area — supply targeting input) |
| **Marketing Mix** | Marketing Lead | Channel yield (leads, qualified-rate, cost-per-qualified-lead, cost-per-closing), campaign attribution, channel compliance, content/social engagement |
| **Verification Integrity** | Compliance, Exec | Re-audit results, integrity rate by agent/approver/area, evidence anomaly flags, fraud cases, complaint-triggered case outcomes |
| **People** | HR, managers | Headcount vs plan, attrition, time-to-fill/certify, KPI attainment distributions, PIP pipeline, incentive spend vs budget |
| **Planner Telemetry** | Ops, Exec | % planner-driven work, capacity vs demand by area, estimate accuracy, override patterns, backlog aging — the health of the operating brain itself (Doc 07 §8) |
| **Employee Scorecard (self)** | Every employee | Own KPIs with drill-down to source events, targets, incentive projection |
| **AI Performance** | Ops/Engineering | Per-model precision/recall vs human decisions, cost per module (Doc 10 §1.3) |

### 1.3 Signature Analyses (the questions the business runs on)

- **Verifications-per-Rental** by area (unit-economics ratio, Doc 01 §2.2) and its decomposition (supply quality × matching × lead handling).
- **Funnel arithmetic per area** (Doc 07 §7 learning loop): how much of each activity yields one closing — powers target setting.
- **Rent index:** median rents by area/type/size over time from verified data — the future data product (H4) and an SEO/PR asset now.
- **Trust ledger (public-facing subset):** verification counts, re-audit pass rates — published stats backing the brand claim (Doc 05 §2.2).

---

## 2. Reporting Engine

### 2.1 Scheduled Report Catalog

| Report | Cadence | Recipients | Delivery |
|---|---|---|---|
| Daily Ops Digest | Daily 21:00 | Area/City Managers | In-app + WhatsApp summary card |
| Daily Exec Pulse | Daily 21:30 | Exec | North Star + guardrails + exceptions only |
| Weekly Area Review Pack | Weekly | Area Managers (pre-filled 1:1/team meeting agenda) | In-app |
| Weekly Exec Pack | Weekly | Leadership meeting | Target-risk board (Doc 07 §6) |
| Monthly City P&L | Monthly close | Exec, Finance | In-app + export |
| Monthly KPI/Payroll Freeze Report | Day 2–3 | HR, Finance, managers | System |
| Monthly Compliance Report | Monthly | Compliance, Founder | Audit exceptions, integrity, access reviews |
| Quarterly Board/Investor Pack | Quarterly | Founder | Export (PDF) |

Reports are generated from the same semantic layer as dashboards (no divergent numbers), delivered via the Notification Bus, archived in Document Mgmt, and every report has an owner + review cycle like SOPs — dead reports get retired.

### 2.2 Self-Serve & Exports

Role-scoped explore views over curated datasets; exports watermarked + logged; sensitive classes (payroll, CNIC-linked) never exportable outside Finance/HR/Compliance roles (Doc 03).

---

## 3. Audit Logs

### 3.1 Scope — What Is Audited

| Class | Examples |
|---|---|
| **Data mutations** | Every C/U/state-transition on business entities: actor, entity, before/after (hashed payload + diff), timestamp, context (IP, device, session) |
| **Sensitive reads** | CNIC/document views, payroll views, full-contact exports, Compliance searches — reads are events too (Doc 03 §3.8) |
| **Approvals** | Verification approvals, payouts, expenses, target changes, SOP publications, tier changes |
| **Access control** | Logins, failed attempts, role/scope changes, break-glass sessions (with reason), permission denials (attempted overreach is signal) |
| **Automated actions** | Planner generation runs, notification sends, AI annotations, badge expiries — machine actors are logged like humans, with run IDs |
| **Configuration** | Template/SLA/incentive-rule/master-data changes (versioned diffs) |

### 3.2 Properties

1. **Append-only, tamper-evident:** no update/delete path; periodic hash-chaining/anchoring so alteration is detectable; storage-level immutability policies (Doc 12).
2. **Separate access plane:** queryable only by Compliance (and Exec via Compliance reports); Sys Admin administers storage but cannot read content (Doc 03 §2.4).
3. **Retention:** long-horizon (7+ years for financial/verification classes; policy per class) with tiered cold storage; partitioned from day 1 (Doc 04 §1.3).
4. **Correlation:** every event carries request/run correlation IDs so an incident can be replayed end-to-end (who did what, which automation reacted, what got sent to whom).

### 3.3 Audit as an Active System (not a graveyard)

- **Compliance review queues:** monthly sampled reviews (sensitive-access review, break-glass review, anomaly review) are *Planner-generated recurring tasks* — auditing is scheduled work, not intention.
- **Anomaly detection feeds:** unusual access volumes, after-hours mutations, statistically improbable KPI patterns (Doc 06 §4.3) surface to the Integrity dashboard.
- **Dispute resolution:** payroll, commission, and complaint disputes resolve by audit drill-down (NFR-18) — the log is a customer-trust and employee-trust instrument.
- **Fraud forensics:** terminated-for-cause employees trigger an automatic retrospective query pack over their recent verifications/deals/accesses (Doc 05 §6).
