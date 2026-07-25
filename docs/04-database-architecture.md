# 04 — Database Architecture, Entity Relationship Model & Master Data Design

> Covers blueprint sections: 11 (Database Architecture), 12 (Entity Relationship Model), 13 (Master Data Design)

---

## 1. Database Architecture

### 1.1 Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| Primary store | Single relational database (PostgreSQL-class), one cluster, **schema-per-module namespaces** | Transactional integrity across property/verification/CRM/task flows matters more than polyglot fashion; namespaces enforce the modular-monolith boundary (NFR-14) so modules can later be extracted with their schema |
| Search | Dedicated search index (OpenSearch/Meilisearch-class) fed by change events | Faceted Pakistani filters + Urdu text search don't belong in OLTP queries |
| Analytics | Separate warehouse (columnar), fed by event stream + nightly snapshots | Protects OLTP from reporting load (NFR-7 degradation order); enables 10-year history cheaply |
| Files/media | Object storage with CDN; DB stores metadata + integrity hashes only | Photos/videos dominate bytes; sensitive docs go to a separate encrypted bucket class |
| Cache/queue | Redis-class for sessions, rate limits, planner job queues | Planner nightly generation and notification fan-out are queue workloads |
| Event log | Append-only `domain_events` table (outbox pattern) → stream consumers (search, warehouse, notifications, AI) | One integration spine instead of N point-to-point couplings; replayable |
| IDs | ULID/UUIDv7 surrogate keys + human-readable business codes (`PROP-LHR-000123`) | Business codes for phone/WhatsApp conversations ("your case PROP-LHR-123"); sortable surrogates for indexes |
| Deletes | No hard deletes on business entities; `status` + `archived_at` (NFR-17) | Audit, dispute resolution, and rent-history data asset |
| Multi-tenancy | `org_id` column on all tables, single org now | Future franchise partners (NFR-21) without a rewrite |
| Money | `amount_minor` integer + `currency` (PKR) | Avoids float bugs; multi-currency fence |
| Time | UTC storage; PKT rendering; date-only fields for business dates (rent due day) | Field ops reason in local dates |

### 1.2 Data Domains & Namespaces

```
core:      identities, roles, role_scopes, permissions, sessions, orgs
geo:       cities, zones, areas, societies, blocks, landmarks
mdm:       attribute dictionaries, rent_norms, vocab versions
supply:    properties, units, listings, owners, dealers, mandates,
           tolet_boards, price_history, availability_history
verify:    verification_cases, checks, evidence, badges, audits
demand:    tenants, requirements, saved_searches, visits
crm:       contacts, leads, interactions, channels, campaigns, referrals,
           complaints
ops:       tasks, task_templates, plans, targets, capacity, routes
people:    employees, contracts, attendance, leave, recruitment,
           training, certifications, sops, sop_acks, kpis, scores,
           payroll_lines, incentives
money:     deals, commissions, splits, expenses, invoices, receipts
comms:     notifications, templates, deliveries, chat_channels, messages
docs:      documents, versions, access_grants
audit:     audit_events (append-only, restricted)
events:    domain_events (outbox)
```

### 1.3 Scale & Partitioning Plan (NFR-4 targets)

- **Hot growth tables:** `ops.tasks`, `crm.interactions`, `comms.deliveries`, `audit.audit_events`, `events.domain_events` → time-range partitioned from day 1 (monthly), with archival tiers after 18–24 months.
- **Geo-heavy queries** (listings by area) → composite indexes on `(area_id, status, published_at)`; search index carries the heavy faceting.
- **Read replicas** introduced when internal reporting or public read load warrants (Phase 3+); warehouse absorbs analytics before replicas are needed.
- **Media growth:** photo evidence ~15–30 images/verification → lifecycle policy: originals to cold storage after badge issuance + retention window; web-optimized derivatives stay hot.

### 1.4 Integrity Rules (selected, cross-module)

1. A `listing` must reference exactly one `unit`; a `unit` exactly one `property`. (Portions/floors are units — see ERD.)
2. A listing row cannot enter `status = verified_live` unless a `verification_case` with `result = approved` and unexpired validity references its unit (enforced by transition guard in the verification module, asserted by DB constraint on the badge reference).
3. `deal` requires: listing, tenant contact, owner contact; dealer optional; commission lines must sum to commission total.
4. `kpi_score` rows are derived — recomputable from `domain_events`; stored for query speed, flagged with computation version (NFR-18).
5. Phone numbers are stored E.164, unique per `contact`; a contact may hold multiple roles (owner AND dealer AND tenant) — role facts live in role tables, not contact duplication. **Why:** in Pakistan the same person is frequently an owner in one area and a dealer in another; duplicating contacts destroys the relationship ledger.

---

## 2. Entity Relationship Model

### 2.1 Notation

`A 1—* B` = one A has many B. Only key attributes listed; every table implicitly has `id, org_id, created_at, created_by, updated_at, updated_by, status, archived_at`.

### 2.2 Core Identity & Geography

```
org 1—* identity 1—* role_assignment *—1 role
role_assignment 1—* role_scope (scope_type: global|city|area, scope_id)

city 1—* zone 1—* area 1—* society 1—* block
area 1—* landmark          (landmark also attachable to society/block)
society: name, type(private|govt|katchi|scheme), rules_json
         (bachelor_policy, gate_timing, dealer_access), geo_polygon
```

### 2.3 Supply Side

```
contact: full_name, phone_e164 (unique), whatsapp_ok, cnic_masked_ref,
         language_pref, source
owner_profile      *—1 contact   (ownership_doc_refs, consent_tier, bank_ref)
dealer_profile     *—1 contact   (agency_name, tier: basic|partner,
                                  areas_served *—* area, agreement_ref)

property *—1 society (nullable) *—1 area
property: business_code, address_text, landmark_ref, geo_point,
          property_type, plot_size, storeys, year_built_est,
          canonical_hash (dedup), first_discovered_via
          (tolet|owner|dealer|referral|web)

property 1—* unit
unit: unit_type (full_house|upper_portion|lower_portion|flat|room|
      shop|office|warehouse|basement|annexe), floor_no, beds, baths,
      kitchen_type, separate_entrance, separate_meter_elec,
      separate_meter_gas, attributes_json (validated against mdm vocab:
      water_source, gas_type, furnishing, parking, family_policy...)

property *—* owner_profile   via ownership_claim
ownership_claim: claim_type (sole|joint|poa|caretaker),
                 evidence_doc_refs, verified_level

mandate: owner_profile + property, type (open|exclusive),
         commission_terms, valid_from/to

listing *—1 unit, *—1 mandate (nullable early), *—0..1 dealer_profile
listing: rent_amount_minor, advance_months, security_months,
         available_from, family_policy, description_en, description_ur,
         status (draft|intake|pending_verification|verified_live|
                 unconfirmed|paused|rented|withdrawn|rejected),
         freshness_confirmed_at, freshness_window_days,
         published_at, verified_badge_id

listing 1—* price_history
unit    1—* availability_history

tolet_board: photo_ref, geo_point, phone_captured, board_text,
             survey_task_id, status (new|contacted|converted|dead),
             converted_property_id (nullable)
```

### 2.4 Verification

```
verification_case *—1 unit, *—1 listing (nullable: property-level cases)
verification_case: case_code, type (initial|renewal|re_audit|complaint_
                   triggered), state (see Doc 05 state machine),
                   assigned_agent_id, approver_id, scheduled_visit_at,
                   result, validity_until, integrity_flags

verification_case 1—* verification_check
verification_check: check_type (owner_identity|ownership_doc|
                    physical_match|photo_set|geo_match|utility_status|
                    society_noc|rent_terms_confirm), result, notes

verification_case 1—* evidence
evidence: kind (photo|video|doc|gps_fix|call_recording_ref|signature),
          captured_at, captured_by, device_fingerprint, geo_point,
          hash, doc_ref  — capture-flow only (FR-B-4)

verified_badge: unit_id, case_id, issued_at, expires_at, badge_tier
```

### 2.5 Demand & CRM

```
tenant_profile *—1 contact (family_type, occupants, occupation_class,
                            screening_consent, police_reg_status)
requirement *—1 tenant_profile: areas *—* area, budget_min/max,
            unit_types[], family_policy_need, must_haves_json, active

lead *—1 contact, *—0..1 listing, *—0..1 requirement
lead: source (call|whatsapp|web_form|walk_in|referral|fb|dealer),
      channel_ref, area_id, assigned_to, sla_due_at,
      stage (new|contacted|qualified|visit_scheduled|visited|
             negotiating|agreement|won|lost), lost_reason

interaction *—1 contact, *—0..1 lead:
      channel (call|whatsapp|sms|email|visit|walkin),
      direction, summary, recording_ref, duration, logged_by

visit *—1 lead, *—1 listing, *—0..1 field_agent:
      scheduled_at, outcome (done|no_show_tenant|no_show_owner|
      cancelled), feedback_json

complaint *—1 contact, *—0..1 (listing|deal|employee):
      category, severity, sla_due_at, state, resolution_note,
      root_cause_tag, confirmed_by_complainant

campaign 1—* campaign_activity; referral: referrer_contact,
      referee_contact, reward_state
```

### 2.6 Operations (Tasks/Planner) — detail in Doc 07

```
task_template: code, domain, title_pattern, sop_id, default_priority,
               estimate_min, evidence_required, recurrence_rule,
               generator (planner|module|manual), role_target,
               area_scoped, active_from/to, version

task *—0..1 task_template, *—1 assignee(identity), *—0..1 area
task: origin (planner|module_event|manual|carry_forward|escalation),
      linked_entity (polymorphic: verification_case|lead|complaint|
      tolet_board|campaign_activity|...), priority, estimate_min,
      due_at, state (todo|in_progress|blocked|done|verified_done|
      cancelled|expired), evidence_refs, carry_count, plan_id

plan: plan_date, identity_id, generated_at, capacity_min,
      allocated_min, generation_run_id, manager_adjusted

target: scope (company|city|area|role|identity), metric_code,
        period (day|week|month|quarter), value, source
        (cascade|manual_override), effective_range

capacity_calendar: identity_id, date, available_min, reason_deltas
route: date, agent_id, ordered stops (task_ids), est_travel_min
```

### 2.7 People, Money, Platform

```
employee *—1 identity: emp_code, role_history, area_history, joined_at,
         state (see Doc 05 employee lifecycle), contract_refs
attendance: employee, date, checkin (ts, geo), checkout, source
leave_request: type, range, state, approver
requisition 1—* candidate 1—* pipeline_stage_event; offer; onboarding_
         checklist (template-driven tasks)
training_track 1—* training_module 1—* completion (score, attempt)
certification: employee, cert_type, granted_by, valid_until  → gates
sop: code, title, domain, version, owner_role, review_due, body_ref
sop_ack: sop_version, employee, acked_at
kpi_def: code, formula_version, source_event_types, aggregation
kpi_score: employee|area|city, kpi_def, period, value, computed_at
incentive_rule: role, formula_ref(version), active_range
payroll_line: employee, period, base, incentive_lines[], deductions,
              state (draft|approved|exported)

deal *—1 listing, tenant contact, owner contact, 0..1 dealer:
     rent_final, commission_total, close_date, agreement_doc_ref
commission_line: deal, party (company|dealer|agent_incentive),
     amount, collect_state
expense: employee, task_ref, category, amount, evidence, approval_chain
invoice / receipt: party, lines, payment_channel
     (cash|bank|jazzcash|easypaisa), external_ref

notification: event_type, audience, template_version, channel,
     delivery_state, dedup_key
chat_channel (type: area|role|topic|task|dm) 1—* message
document: class (public|internal|sensitive), owner_module, entity_ref,
     versions[], hash, retention_policy, access_grants[]
audit_event: actor, action, entity, before_hash/after_hash,
     context(ip, device), at   [append-only]
domain_event: type, entity, payload, occurred_at, published_at
```

### 2.8 Relationship Highlights (the ones that prevent 10-year regrets)

1. **Property ≠ Unit ≠ Listing.** Pakistani houses rent as upper portion + lower portion + annexe simultaneously; modeling this as one listing (like foreign portals) makes verification and history incoherent. Verification badges attach to **units**; freshness attaches to **listings**.
2. **Contact is the universal person record.** Owner/Dealer/Tenant/Employee-adjacent roles hang off one contact — the relationship ledger (strategy §3.1) depends on this.
3. **Ownership is a claim with evidence, not a boolean.** `ownership_claim.verified_level` lets us represent caretaker/POA/joint-family realities honestly.
4. **Everything operational is a task.** Verification visits, freshness calls, complaint resolutions, marketing posts — all become `task` rows via templates. This is what makes the Planner (Doc 07) the company brain and makes KPIs derivable (FR-F-2).
5. **Events are the integration spine.** Search, analytics, notifications, and AI consume `domain_events`; modules never write into each other's namespaces.

---

## 3. Master Data Design

### 3.1 Principles

- **IDs, never free text, in operational records** (FR-A2-4). Free text is allowed only in note fields.
- **Versioned vocabularies:** every dictionary value carries `active_from/active_to`; retired values remain resolvable historically.
- **Stewardship:** Master Data Editor role owns geo + vocab; Area Managers *propose* (new society, new landmark) via tasks; editor approves. **Why:** field teams discover reality first, but uncontrolled writes fragment the geo tree.
- **Bilingual labels:** every vocab entry has `label_en`, `label_ur`.

### 3.2 Geographic Master Data

| Level | Examples | Attributes |
|---|---|---|
| City | Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad | timezone, launch_state, city_manager |
| Zone | e.g., "Lahore South" | ops grouping only (not public) |
| Area | Johar Town, Gulshan-e-Iqbal, G-11 | public browse node, target unit, SEO page |
| Society | DHA Phase 6, Bahria Town Sector C, WAPDA Town | type, rules_json, geo polygon |
| Block/Phase | Block J2, Phase 6 | optional granularity |
| Landmark | masjid, school, bank branch, chowk, hospital | name_en/ur, type, geo point |

Seeding strategy: launch areas seeded manually with field-walk validation (Phase 0 task templates exist for "society mapping walk"); new cities seeded via the Expansion Kit wizard (Doc 13) from survey + open data, then field-validated.

### 3.3 Property Attribute Dictionaries (Pakistan-first)

| Dictionary | Values (v1) |
|---|---|
| `unit_type` | full_house, upper_portion, lower_portion, ground_portion, annexe, flat, studio, room, penthouse, shop, office, warehouse, plaza_floor, basement |
| `water_source` | govt_line, boring, boring+govt, tanker_dependent, society_supply |
| `gas_type` | sui_gas, cylinder, electric_only, none |
| `electricity` | separate_meter, shared_meter, submeter, solar_backup, generator_backup, ups_backup |
| `family_policy` | family_only, bachelors_allowed, bachelors_only, silent_family_pref, any |
| `furnishing` | unfurnished, semi_furnished, furnished |
| `parking` | none, street, single_covered, double_covered, basement |
| `plot_size_unit` | marla, kanal, sq_yd (Karachi), sq_ft (flats) — with canonical sq_ft conversion stored |
| `occupancy_class` (tenant) | family, bachelors_male, bachelors_female, company_lease, student |
| `rent_terms` | advance_months (0–12), security_months (0–6), rent_due_day, annual_increment_pct, utilities_included flags |
| `complaint_category` | fake_info, behavior, payment_dispute, maintenance, verification_error, service_delay, other |
| `lead_source` / `discovery_source` | call, whatsapp, web_form, walk_in, referral, fb_group, fb_page, tolet_board, dealer, society_office, google |

**Why marla/kanal as first-class units:** every rent conversation in Punjab is in marla; storing only sq_ft makes the platform feel foreign and breaks comparability. Canonical conversion enables analytics.

### 3.4 Operational Master Data

- **Task template catalog** (Doc 07): ~60 seed templates across verification, freshness, To-Let survey, lead follow-up, marketing, HR — each versioned with SOP link.
- **Target metric catalog** (Doc 07 §targets): metric codes with units, cascade rules, seasonality profiles (Ramadan/Eid/school-year moving season adjustments).
- **Channel registry** (Doc 08): Facebook groups, WhatsApp communities, pages — with area mapping, posting rules, account ownership.
- **Notification template catalog** (Doc 10): versioned, bilingual, channel-specific.
- **Holiday & season calendar:** Pakistani public holidays, Eid windows, Ramadan timings (affects planner scheduling and quiet hours), monsoon adjustments for field routing.
- **Commission norm table:** default commission structures per city (editable by Finance + Exec approval).

### 3.5 Data Quality Machinery

- **Dedup keys:** `property.canonical_hash` from normalized (geo-cell + street + plot markers); AI similarity (photos, phone reuse) flags candidates into a merge queue owned by Area Managers (Doc 10).
- **Completeness scoring:** every property/listing has a computed completeness % ; below-threshold listings can't enter verification queue.
- **Geo validation:** unit geo_point must fall within claimed society/area polygon, else flagged.
- **Mandatory re-validation cycles:** society rules and rent norms carry `review_due`; Planner auto-generates review tasks to Area Managers (nothing relies on memory).
