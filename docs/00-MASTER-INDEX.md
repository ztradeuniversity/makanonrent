# MakanOnRent — Master Architecture Blueprint (Index)

**Pakistan-First Rental Property Operating System**
Enterprise architecture & planning documentation. No code — this is the master blueprint for all future development.

> Reading order for a new team member: 01 → 02 → 03 → 05 → 07 → then role-relevant docs. Doc 14 last (the self-critique).

---

## Document Map

| Doc | Title | Blueprint Sections Covered |
|---|---|---|
| [01](01-business-vision-and-strategy.md) | Business Vision & Strategy | 1 Business Vision · 2 Business Model · 3 Long-Term Strategy · 4 Product Roadmap · 5 Phase-wise Development Plan |
| [02](02-modules-and-requirements.md) | Modules & Requirements | 6 Complete Module List (42 modules) · 7 Functional Requirements · 8 Non-Functional Requirements |
| [03](03-users-roles-permissions.md) | Users & Permissions | 9 User Types · 10 Permission Matrix |
| [04](04-database-architecture.md) | Data Architecture | 11 Database Architecture · 12 Entity Relationship Model · 13 Master Data Design |
| [05](05-lifecycles.md) | Core Lifecycles | 14 Property · 15 Verification · 16 Owner · 17 Tenant · 18 Dealer · 19 Employee |
| [06](06-people-os.md) | People OS | 20 Recruitment · 21 Training · 22 SOP Library · 27 KPI System · 28 Performance Evaluation · 29 Salary & Incentives |
| [07](07-daily-planner-engine.md) | **Master Daily Planner Engine** (the operating brain) | 23 Task Management System · 24 Daily Planner (+ targets & capacity) |
| [08](08-marketing-and-social-planner.md) | Marketing Planners | 25 Marketing Planner · 26 Social Media Planner |
| [09](09-crm-and-support.md) | CRM & Support | 33 CRM · 34 Lead Management · 35 Complaint Management · 36 Document Management · 37 Internal Chat |
| [10](10-ai-and-notifications.md) | AI & Notifications | 31 AI Modules (12 modules) · 32 Notification System |
| [11](11-analytics-reporting-audit.md) | Intelligence & Audit | 30 Audit Logs · 38 Analytics · 39 Reporting |
| [12](12-engineering-platform.md) | Engineering Platform | 42 Disaster Recovery · 43 Security Architecture · 44 Backup Strategy · 45 Deployment Strategy · 46 Git Strategy · 47 Testing Strategy · 48 QA Strategy |
| [13](13-apps-expansion-dashboards-website.md) | Surfaces & Scale | 40 Future Mobile App · 41 Expansion Strategy · 49 Admin Dashboards · 50 Public Website Structure |
| [14](14-gaps-assumptions-recommendations.md) | Gaps & Recommendations | Hidden gaps · challenged assumptions · open decisions · scalability recommendations |
| [15](15-architecture-review-board.md) | Architecture Review Board | Adversarial review · two waves of findings · per-module + board scores (pre-remediation) |
| [16](16-p0-remediation-amendments.md) | **P0 Remediation Amendments** (binding) | Closes architecture-blocking P0s · scalability ladder · verification economics · trust/governance · legal/tax/payroll placeholders · **final scores + freeze recommendation** |

> **Governance note:** Docs 00–14 are the baseline. Doc 15 is the review of record. **Doc 16 is the binding amendment layer** — where it conflicts with 00–14, Doc 16 wins for the amended item. Architecture is frozen at **Baseline + Doc 16**; implementation may begin on the core platform.

---

## The System in One Page

**Thesis:** Pakistan's rental market fails on trust (fake listings, duplicate dealer posts, dead availability). MakanOnRent manufactures trust with a human field-verification network run by software, and compounds it into the country's canonical verified rental supply.

**Five planes** (Doc 02): Public (website/apps) · Engagement (CRM/leads/complaints/chat) · Operations (property, verification, **Daily Planner Engine**) · Enterprise (HR/SOP/KPI/payroll) · Intelligence (analytics/AI) — all on one identity model, one audit log, one event spine, one master-data service.

**Three laws encoded everywhere:**
1. **Verification before visibility** — no badge, no public listing; badges expire; re-audits police them (Doc 05).
2. **Nothing relies on memory** — every obligation in the company is a generated, evidence-gated, carry-forward-tracked task (Doc 07).
3. **Quantity is always paired with quality** — every volume KPI has an integrity twin; fraud zeroes incentives (Doc 06).

**Operating loop:** To-Let survey / dealer / owner intake → property registered → verified (field evidence, separated approval) → published verified-only → leads from call/WhatsApp/web in 1 CRM → visits → close (deal + agreement + tenant police registration service) → commission ledger → KPIs → payroll — with the Planner generating every human step and Analytics/AI tuning the whole loop per area.

**Growth model:** dominate area clusters, expand only when trust guardrails hold; the Expansion Kit turns each new area into a checklist (Doc 13). Ten-year fences already in the architecture: multi-org (franchise), multi-city, multi-language, service revenue, rent-index data product.
