# 05 — Core Lifecycles

> Covers blueprint sections: 14 (Property Lifecycle), 15 (Verification Lifecycle), 16 (Owner Lifecycle), 17 (Tenant Lifecycle), 18 (Dealer Lifecycle), 19 (Employee Lifecycle)

Every lifecycle below is a **state machine**: states, allowed transitions, transition owners (role), automatic triggers, and the tasks/notifications each transition emits. **Why state machines:** they make the Planner able to drive work ("every entity in state X for > N days generates task Y"), make KPIs derivable, and make audit trivial. No entity ever sits in an undefined condition.

---

## 1. Property Lifecycle

Property = the physical asset record. Listings and verification have their own lifecycles that reference it.

```
DISCOVERED → REGISTERED → PROFILED → ACTIVE ⇄ DORMANT → RETIRED
                                   ↘ REJECTED
```

| State | Meaning | Entry Trigger | System Behavior |
|---|---|---|---|
| **Discovered** | Known to exist (To-Let board, dealer mention, referral) but unconfirmed | To-Let survey capture, dealer intake, call note | Creates owner-contact follow-up task (Telesales); dedup check runs |
| **Registered** | Owner/authorized contact confirmed; basic facts captured | Contact confirmed + consent to proceed | Property code issued; profiling task generated to Field Agent |
| **Profiled** | Full structured attributes + units defined + photos | Field/phone profiling task complete; completeness ≥ threshold | Eligible for listings + verification queue |
| **Rejected** | Fake, duplicate (merged), or owner declined | Dedup merge / consent refused / fraud flag | Merged records redirect; fraud flags feed AI training set |
| **Active** | ≥ 1 unit currently listed or rented via us | Listing published or deal closed | Freshness engine covers its listings |
| **Dormant** | No active listings; relationship maintained | All listings withdrawn/rented > N days | Planner generates periodic owner check-in call task (quarterly) — dormant properties are future supply, never deleted |
| **Retired** | Demolished/sold/permanently unavailable | Owner confirmation or field confirmation | History retained (rent index asset) |

**Interactions:** Discovery feeds from To-Let Survey Module (B7) and CRM; profiling tasks come from templates (Doc 07); dedup from AI (Doc 10); dormant check-ins are a Planner recurring rule; every transition emits `domain_events` consumed by Analytics.

---

## 2. Verification Lifecycle (the trust engine)

Applies per **verification_case** on a unit. Types: `initial`, `renewal` (badge expiry), `re_audit` (random compliance sample), `complaint_triggered`.

### 2.1 State Machine

```
OPENED → DOCS_REVIEW → VISIT_SCHEDULED → VISIT_IN_PROGRESS
       → EVIDENCE_SUBMITTED → QC_REVIEW → APPROVED | REJECTED | NEEDS_REWORK
APPROVED → BADGE_ISSUED → (time) → EXPIRING → RENEWAL_OPENED …
Any state → ON_HOLD (owner unavailable) → auto-resume or ABANDONED (30d)
```

| Stage | Owner | Mandatory Checks / Evidence |
|---|---|---|
| **Opened** | System (from listing intake) | Completeness score passes; owner consent on file (FR-B-5) |
| **Docs Review** | Area Manager or certified senior agent | Owner identity vs CNIC (masked handling), ownership evidence (registry/fard/allotment letter/utility bills in owner's name — `verified_level` graded, not pass/fail), mandate terms |
| **Visit Scheduled** | Planner (route-batched into agent's field day) | Owner/caretaker appointment confirmed by Telesales |
| **Visit In Progress** | Field Agent (certified) | GPS check-in within geo-fence of claimed location; capture-flow only |
| **Evidence Submitted** | Field Agent | Photo set per SOP (exterior w/ street context, each room, meters, water source, entrance), utility meter status, physical-match checklist (beds/baths/portion match claim), rent-terms confirmation with owner, short video walkthrough |
| **QC Review** | Area Manager (never the visiting agent — separation of duties, Doc 03 §3.4) | Evidence completeness, geo-fence match, photo liveness/recency signals (AI-assisted, Doc 10), attribute mismatches |
| **Approved → Badge Issued** | Area Manager | Badge with `expires_at` (validity: 90 days initial, renewable; configurable per area) |
| **Rejected** | Area Manager | Reason coded (fraud / mismatch / owner-withdrew / docs-insufficient); fraud codes feed Dealer/Owner risk scores |
| **Needs Rework** | → back to agent | Bounded to 2 rework loops, then escalates to City Manager |

### 2.2 Integrity Mechanisms (anti-fraud by design)

1. **Capture-flow-only evidence** (FR-B-4): no gallery uploads; device fingerprint + GPS + timestamp sealed with content hash.
2. **Separation of duties:** submitter ≠ approver, structurally enforced.
3. **Random re-audits:** Planner auto-samples ~5% of live badges monthly per area for a different agent (or Compliance) to re-verify; mismatches hit the original agent's and approver's Integrity KPI (Doc 06).
4. **Badge expiry:** trust decays; renewal is a lighter workflow (call + spot evidence) unless risk flags exist.
5. **Complaint linkage:** any `fake_info` complaint on a verified listing auto-opens a `complaint_triggered` case and demotes the listing to "Under Review" pending outcome.
6. **Public accountability:** verification date + last-confirmed date shown publicly (FR-C-2); aggregate integrity stats published (strategy: out-verify copycats).

### 2.3 Interactions

Planner generates and routes visit tasks (E2/E4); Docs go to Document Mgmt sensitive class (A4); every check result is an audit event (A5); AI pre-screens photo sets and flags anomalies (H3); KPI events (verifications completed, integrity rate) flow to F5; badge state drives public site display (C1).

---

## 3. Owner Lifecycle

```
PROSPECT → CONTACTED → CONSENTED → VERIFIED_OWNER → ACTIVE_LANDLORD
        ⇄ DORMANT → CHURNED   (+ BLACKLISTED from any state)
```

| State | Meaning | Key System Behavior |
|---|---|---|
| **Prospect** | Phone known (To-Let board, referral, dealer mention) | Telesales outreach task with script SOP; max-attempt rule then park |
| **Contacted** | Spoke; interest gauged | CRM timeline begins; objection codes captured (feeds marketing messaging) |
| **Consented** | Agreed to list; consent recorded | Property registration flow opens; mandate terms (open/exclusive) offered |
| **Verified Owner** | Identity + ownership claim verified in a case | Unlocks Verified badge path; owner portal invite |
| **Active Landlord** | ≥1 live listing or active tenancy via us | Freshness confirmations, lead summaries, renewal offers; NPS pulse after each closing |
| **Dormant** | No live inventory | Quarterly relationship call (Planner recurring); "planning to rent again?" seasonal pings before moving seasons |
| **Churned** | Explicitly left / repeated non-response | Reason coded; win-back campaign eligibility after cooling period |
| **Blacklisted** | Fraud, abusive behavior, fake-info complaints upheld | Blocks new listings; visible to internal roles only; Compliance can lift |

**Owner-specific design points:**
- **Trust is bidirectional:** we verify owners; owners judge us on lead quality and paperwork help. The lifecycle therefore includes *service* touchpoints (agreement drafting, tenant police registration reminders — a legal obligation in Punjab/Sindh that most owners neglect; doing it for them is a retention hook).
- **Overseas owner variant:** flag on profile switches communication defaults (WhatsApp-first, timezone-aware quiet hours) and unlocks the future management-lite product (Phase 6).

---

## 4. Tenant Lifecycle

```
VISITOR → LEAD → QUALIFIED → VISITING → NEGOTIATING → TENANT (moved-in)
       → RESIDENT (ongoing) → MOVING_OUT → ALUMNI    (+ FLAGGED)
```

| State | Meaning | Key System Behavior |
|---|---|---|
| **Visitor** | Anonymous search | Analytics only; no PII |
| **Lead** | Phone captured via call/WhatsApp/form | SLA timer starts (speed-to-lead KPI); AI triage suggests matching verified listings |
| **Qualified** | Requirement captured (budget, areas, family policy, move date) | Requirement object drives matching + saved-search alerts |
| **Visiting** | Visits scheduled/executed | Field-agent accompaniment tasks; visit outcome feedback captured (feeds listing quality) |
| **Negotiating** | Offer/terms discussion | Rent-terms norms surfaced to agent; deal draft opens |
| **Tenant** | Agreement signed, moved in | Trust services: agreement doc, e-stamp guidance, police-registration filing task; commission collection triggers |
| **Resident** | Ongoing tenancy | Anniversary/renewal reminders to both sides; complaint channel; move-in services offers (Phase 5+) |
| **Moving Out** | Notice given | Auto-creates *supply* signal: the unit returns to available pipeline (owner prompted); tenant gets next-home search head start — **the flywheel moment** |
| **Alumni** | Past tenant | Referral program target; re-activation on new search |
| **Flagged** | Screening/behavior issues upheld | Visible to internal roles; affects screening reports only with consent framework |

**Why Moving-Out is a first-class state:** every departing tenant is simultaneously new demand and new supply. Foreign portals miss this loop; for us it's automated by the Planner (tasks to both the owner-side and tenant-side agents).

---

## 5. Dealer Lifecycle

```
IDENTIFIED → ENGAGED → REGISTERED (Basic) → VETTED → PARTNER (Verified)
          ⇄ SUSPENDED → TERMINATED   (+ BLACKLISTED)
```

| State | Meaning | Key System Behavior |
|---|---|---|
| **Identified** | Known dealer in area (field survey, market walk) | Dealer registry stub; Area Manager relationship-visit tasks (Marketing Planner) |
| **Engaged** | Met; value proposition pitched | Objection/interest coded; follow-up cadence via Planner |
| **Registered (Basic)** | Signed up; can submit intake listings | Submissions require owner-contact confirmation before verification scheduling (FR-B-6); dealer quality score starts accruing |
| **Vetted** | Track record: N accurate submissions, no fraud flags, docs on file (CNIC, agency info) | Eligible for partnership offer |
| **Partner (Verified)** | Partnership agreement signed: commission splits, conduct rules | Badge on listings, lead routing priority, portal analytics; joint closing workflow |
| **Suspended** | Quality score breach / unresolved complaint | Submissions frozen; remediation plan task to Area Manager |
| **Terminated / Blacklisted** | Agreement ended / fraud upheld | Attribution history retained; blacklist blocks re-registration by CNIC/phone |

**Dealer quality score** (computed, Doc 10/11): submission accuracy (verification pass rate), availability truthfulness, responsiveness, closing conduct, complaint rate. Score drives tier, routing priority, and split terms. **Why scoring instead of gut feel:** dealer management at 100+ dealers per city must be systematic; the score also gives dealers a fair, transparent ladder — co-option strategy (Doc 01 §3.3).

---

## 6. Employee Lifecycle

```
CANDIDATE → OFFERED → HIRED → ONBOARDING → PROBATION → CONFIRMED
         → (ROLE_CHANGE | PROMOTED | TRANSFERRED)* 
         → NOTICE | PIP → EXITED   (+ TERMINATED_FOR_CAUSE)
```

| State | Owner | Key System Behavior |
|---|---|---|
| **Candidate → Offered** | HR + hiring manager | Full pipeline in Recruitment module (Doc 06); structured interview scorecards |
| **Hired** | HR | Contract docs to Document Mgmt; IAM provisioning auto-triggered with role + scope (FR-F-1); equipment checklist tasks |
| **Onboarding** | Trainer + manager | Template-driven onboarding plan (day 1–30 tasks in Planner); SOP acknowledgments; training track enrollment |
| **Probation** | Manager | Reduced targets profile in Planner; weekly check-in tasks auto-generated; certification milestones gate field permissions (e.g., cannot solo-verify until certified) |
| **Confirmed** | Manager + HR approval | Full targets; incentive eligibility begins |
| **Role Change / Promotion / Transfer** | Manager + HR | IAM re-provisioning; Planner re-templates their task generation; area scope updates; handover checklist auto-generated |
| **PIP (Performance Improvement)** | Manager + HR | Triggered by KPI thresholds (Doc 06); structured plan with system-tracked milestones |
| **Notice / Exited** | HR | Exit checklist: task handover (open tasks auto-flagged for reassignment), device/document return, access revocation ≤ 60s of effective time (FR-A1-4), exit interview task, final settlement via payroll |
| **Terminated for Cause** | HR + Exec | Immediate revocation; Compliance review of their recent audit trail (fraud pattern check on their verifications/deals) |

**Why the exit path is engineered:** field businesses leak knowledge and assets at exit. The system makes handover mechanical: every open task, owned relationship (owner/dealer assignments), and pending case is enumerable and reassignable in one screen.

---

## 7. Lifecycle Interaction Map

```
To-Let Survey ──▶ Property: Discovered ──▶ Owner: Prospect
Owner: Consented ──▶ Listing intake ──▶ Verification: Opened
Verification: Badge ──▶ Listing: verified_live ──▶ Public site
Public lead ──▶ Tenant: Lead ──▶ Visit ──▶ Deal ──▶ Tenant: Tenant
Deal closed ──▶ Commission ledger ──▶ Agent/Dealer incentives (KPI)
Tenant: Moving Out ──▶ Unit availability ──▶ Listing re-open + Owner task
Complaint(fake_info) ──▶ Verification: complaint_triggered re-case
Badge expiry ──▶ Renewal case ──▶ Planner field routing
Employee: Hired/Exited ──▶ IAM provisioning ──▶ Planner capacity
Dealer quality score ──▶ Lifecycle tier transitions ──▶ lead routing
```

Every arrow above is implemented as: **domain event → task template instantiation (Planner) or state transition — never a human remembering to do something.**
