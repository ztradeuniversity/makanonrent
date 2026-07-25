# 12 — Engineering Platform: Security, Disaster Recovery, Backup, Deployment, Git, Testing & QA

> Covers blueprint sections: 42 (Disaster Recovery), 43 (Security Architecture), 44 (Backup Strategy), 45 (Deployment Strategy), 46 (Git Strategy), 47 (Testing Strategy), 48 (QA Strategy)

---

## 1. Security Architecture

### 1.1 Threat Model (what we actually defend against)

| Threat | Vector | Primary Controls |
|---|---|---|
| **Insider fraud** (biggest risk in a field business) | Fake verifications, lead theft, data resale, payout manipulation | Separation of duties (Doc 03 §3.4), evidence sealing (Doc 05 §2.2), scoped access, sensitive-read logging, anomaly detection, re-audits |
| **CNIC/document breach** | Stolen exports, compromised accounts, misconfigured storage | Field-level ACL, encrypted sensitive bucket class, no-bulk-export, watermarking, masked defaults, retention purges (Doc 09 §4) |
| **Account takeover** | Phished internal accounts, SIM-swap on OTP | MFA for internal roles (TOTP/passkey, not SMS-only), device binding for field app, session revocation (FR-A1-4), rate limits |
| **Scraping/harvesting** | Competitors scraping listings + owner numbers | Number masking (NFR-10), rate limiting, bot detection, watermarked images, honeytoken listings |
| **External attack** | OWASP-class web attacks, API abuse | Standard hardening: WAF/CDN, input validation, parameterized queries, secrets management, dependency scanning, least-privilege infra |
| **Ex-employee risk** | Retained access, taken relationships | 60s revocation, handover enumeration (Doc 05 §6), company-owned social accounts (Doc 08 §2.3), forensics pack (Doc 11 §3.3) |
| **Vendor/integration risk** | BSP, SMS gateway, cloud misconfig | Adapter isolation (NFR-22), vendor access reviews, contractual data terms |

### 1.2 Control Architecture (layers)

1. **Identity:** central IAM; MFA mandatory for internal; phone-OTP for public with rate limits + device heuristics; break-glass procedure (Doc 03 §3.5).
2. **Authorization:** deny-by-default server-side RBAC + scope + field-sensitivity classes + certification gates (Doc 03 §3) — one policy engine, used by every surface.
3. **Data:** encryption in transit (TLS everywhere) and at rest; sensitive class additionally envelope-encrypted with separate keys; key management via cloud KMS; tokenized/masked data to AI providers (Doc 10 §1.1); production data never in dev/test (masked fixtures instead — see Testing).
4. **Application:** secure SDLC — dependency and secret scanning in CI, code review gates (Git strategy), security requirements in Definition of Done, annual penetration test from Phase 3.
5. **Infrastructure:** IaC-managed, least-privilege service accounts, network segmentation (DB unreachable publicly), audit-logged admin actions, immutable audit storage (Doc 11 §3.2).
6. **Human:** security SOPs in the SOP library (device policy, phishing, field data handling — no CNIC photos on personal devices), onboarding training + annual refresher (certification-tracked, Doc 06), least-knowledge defaults (masked CNIC in routine screens).
7. **Compliance posture:** lawful-processing register; consent ledger (Doc 09 §1.1); alignment tracking for Pakistan's Personal Data Protection framework + PECA; breach-response runbook (see DR) with notification obligations documented.

---

## 2. Backup Strategy

| Asset | Method | Frequency | Retention |
|---|---|---|---|
| Primary database | Continuous WAL/PITR + daily full snapshot | Continuous / daily | PITR 7–14 days; dailies 30 days; monthlies 12 months |
| Sensitive document store | Versioned object storage, cross-region replication | Continuous | Per retention schedule (Doc 09 §4) |
| Media (photos/evidence) | Versioned object storage + lifecycle tiers | Continuous | Evidence per audit-class retention |
| Warehouse | Rebuildable from events + snapshots; weekly backup of curated marts | Weekly | 90 days |
| Configuration/IaC/secrets | Git + secrets vault backup | On change | Full history |
| Audit log | Immutable storage + cross-region copy | Continuous | 7+ years per class |

Rules: **3-2-1 posture** (primary region, second region/provider, plus periodic offline export of crown-jewel data); backups encrypted with separate keys; **quarterly restore drills are Planner-generated recurring tasks** with pass/fail recorded — an untested backup is a hope, not a backup. RPO ≤ 1h transactional, per NFR-20.

---

## 3. Disaster Recovery

### 3.1 Scenarios & Runbooks

| Scenario | Response | Target |
|---|---|---|
| Region/provider outage | Failover to warm standby (DB replica + IaC-provisioned app tier) in second region | Public site RTO ≤ 4h; internal OS ≤ 8h (NFR-20) |
| Data corruption / bad deploy | PITR to pre-event point + event replay for gap where possible | RPO ≤ 1h |
| Ransomware/compromise | Isolate, revoke credentials fleet-wide, restore from immutable backups, forensics from audit log, breach-response runbook (regulatory + customer notification decision tree) | Documented runbook |
| Key vendor failure (WhatsApp BSP, SMS) | Adapter failover to secondary provider; degraded-mode messaging policy | Hours |
| **Ops continuity (Pakistan-specific):** extended internet/power disruption in an office/area | Field app offline mode (NFR-6); paper-fallback SOPs for verification capture with next-day entry; call-forwarding tree for lead lines; load-shedding-aware office UPS policy | Business continues degraded |

### 3.2 Degradation Order

Per NFR-7: analytics → AI → planner regeneration (yesterday's plan + SLA-critical minimal path stays up, Doc 07 §8) → CRM → public site last. The public site's read path (static-cacheable listing pages) is designed to survive backend outages via CDN stale-serving.

### 3.3 DR Governance

DR runbooks live in the SOP library with owners + review cycles; annual full DR exercise (game day) + quarterly restore drills; every incident produces a blameless postmortem task with tracked action items.

---

## 4. Deployment Strategy

| Aspect | Decision | Why |
|---|---|---|
| Topology | **Modular monolith** app + workers (planner jobs, notification fan-out, pipelines) + managed Postgres + object storage + search + Redis, behind CDN/WAF | Small team, high coherence needs (NFR-14); extraction path preserved by module boundaries + event spine |
| Environments | `dev` → `staging` (masked data, integration-connected sandboxes) → `production` | Never test on production CNICs |
| Releases | Trunk-based CI/CD; every merge deploys to staging; production deploys on demand (target: multiple/week), blue-green or rolling with health checks + instant rollback | Small batches = small failures |
| Feature flags | All user-visible changes behind flags; ops-tunable config (SLAs, windows, formulas) is runtime config, not deploys (NFR-16) | Decouple deploy from release; area-by-area rollouts mirror the business's area-by-area expansion |
| Migrations | Backward-compatible, two-step (expand → migrate → contract); rehearsed on staging with production-scale masked data | Zero-downtime posture |
| Observability | Structured logs, metrics, tracing with correlation IDs (ties to audit correlation, Doc 11 §3.2); alerting to on-call + internal chat #incidents | NFR-19 |
| Hosting posture | Reputable cloud with a region acceptable for latency to Pakistan + CDN edge presence; sensitive-data residency preference documented and revisited as local options mature (NFR-9) | Pragmatic now, compliant later |

---

## 5. Git Strategy

- **Trunk-based development:** short-lived feature branches (≤ 3 days) → PR → squash-merge to `main`; `main` is always deployable; releases are tags, not branches. **Why not GitFlow:** long-lived branches rot; a single product with continuous deployment doesn't need them.
- **PR gates:** CI green (lint, tests, security scans), at least one review, conventional-commit messages, linked work item; module-boundary lint (no cross-namespace imports — enforces NFR-14 mechanically).
- **Repo layout:** monorepo (app modules, workers, infrastructure-as-code, docs) — this `docs/` blueprint lives in it and evolves by PR like code; ADRs (architecture decision records) required for decisions that change this blueprint.
- **Branch protection:** no direct pushes to `main`; signed commits for release tags; CODEOWNERS per module namespace.
- **Environments-as-code:** IaC changes follow the same PR flow; secrets never in Git (vault + scanning).

---

## 6. Testing Strategy

| Layer | Scope | Policy |
|---|---|---|
| **Unit** | Business rules: state-machine transitions (every lifecycle in Doc 05), priority scoring, incentive formulas, target cascade math, permission checks | The rule layer is where trust lives; highest coverage requirement here |
| **Integration** | Module contracts: events consumed/produced, API contracts, DB constraints (e.g., badge-before-live invariant, Doc 04 §1.4) | Contract tests per module boundary — the extraction insurance |
| **Workflow/E2E** | Golden paths: discover→verify→publish→lead→close; complaint→re-verify; hire→certify→plan→payroll | Automated on staging per release; the same flows QA smoke-tests |
| **Planner simulation** | Generation pipeline against synthetic org/area fixtures: capacity edge cases, carry-forward escalation, seasonality calendars, overload behavior | Deterministic fixture worlds; regression suite for every planner rule change — **the planner is the highest-blast-radius component; it gets its own test discipline** |
| **Permission tests** | Matrix-driven: generated test cases from the Doc 03 matrix (role × object × scope), including deny cases | The matrix is executable — drift between doc and code is a test failure |
| **Performance** | Search latency, planner nightly window, notification fan-out at NFR-4 scale factors | Load tests before each phase gate |
| **Localization/device** | Urdu rendering (RTL), low-end Android profiles, 3G throttling (NFR-1, NFR-11) | Part of public-site release checklist |
| **Data/migration** | Migration rehearsal on masked production-scale data; recompute checks (KPI reproducibility, NFR-18) | Pre-deploy gate |

Test data: **masked/synthetic fixtures only** — a fixture generator produces realistic Pakistani data (areas, marla sizes, Urdu text, phone formats) so tests exercise real shapes without real PII.

---

## 7. QA Strategy

QA is a function (not necessarily a big team) that owns *quality of the operating system as experienced by users* — beyond automated tests:

1. **Release QA:** risk-based manual passes on staging per release train (Doc 01 §4.2): new-feature exploratory testing, regression smoke of golden paths, device/locale spot checks.
2. **Field QA (unique to this business):** every ops-facing release is piloted with one friendly area team before city-wide flag rollout; field feedback is a structured task type, not WhatsApp grumbling. **Why:** the field app's users are on motorbikes in the sun — lab QA can't see their failures.
3. **Data QA:** continuous quality monitors as scheduled checks — completeness scores, geo-validation failures, dedup queue depth, stale master data (Doc 04 §3.5); breaches open tasks to owners.
4. **Process QA:** the QC/re-audit machinery in Verification (Doc 05 §2.2) and call-quality sampling (Doc 06) *is* QA of operations; its dashboards live with Compliance.
5. **UAT gates:** each phase exit (Doc 01 §5) includes named-user acceptance by the actual role-holders (an Area Manager signs off the Area Manager console).
6. **Defect lifecycle:** defects are tasks with severity SLAs (S1 production trust/data issues: same-day) in the same task system — QA work is planner-visible like all work.
7. **Definition of Done (per feature):** code + tests + permission matrix entries + audit events + SOP/template updates + dashboard/metric wiring + docs updated. A feature that ships without its SOP and metrics is not done — this DoD is what keeps the blueprint and reality synchronized for ten years.
