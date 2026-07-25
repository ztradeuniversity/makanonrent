# 08 — Marketing Planner & Social Media Planner

> Covers blueprint sections: 25 (Marketing Planner), 26 (Social Media Planner)
> Both planners are **generator plugins** into the Master Daily Planner Engine (Doc 07): they collect marketing demand, instantiate tasks from templates, and the shared pipeline handles prioritization, capacity, routing, and evidence. Marketing is field + digital work driven by the same brain — every employee is told **where to post, when to post, whom to visit, and what to do today**.

---

## 1. Marketing Planner

### 1.1 Purpose

Convert marketing strategy into daily executable tasks across two motions:

- **Supply marketing** — get owners and dealers to list with us (field-heavy).
- **Demand marketing** — get tenants to search with us (digital-heavy).

Both motions run per-area with area-specific targets (Doc 07 §5), because rental marketing in Pakistan is hyper-local: a Johar Town Facebook group and a Johar Town dealer network are the actual market.

### 1.2 The Channel Registry (master data)

The registry is the planner's map of where marketing can happen. Every channel record carries: type, platform, area mapping, audience size estimate, posting rules/frequency caps, account ownership (which company asset posts there), performance history, and compliance status (warned/banned).

| Channel Type | Examples | Cadence Rules |
|---|---|---|
| **Facebook Groups** | "Rent in Johar Town Lahore", "DHA Lahore Rentals", city-level rental groups | Per-group frequency caps (avoid bans), content rotation rules, admin-relationship notes |
| **Facebook Pages/Marketplace** | Company page, Marketplace listings | Daily listing slots |
| **WhatsApp Communities/Groups** | Area rental groups, society resident groups, dealer broadcast lists | Etiquette SOP; community-owner relationship tracked like a CRM contact |
| **Instagram / TikTok / YouTube** | Property video tours, area guides | Content calendar (see §2) |
| **Google (SEO/GBP)** | Area landing pages, Google Business Profile | SEO task backlog |
| **Physical: dealer offices** | Registered dealers per area | Relationship visit cadence by tier |
| **Physical: society offices/gates** | Society management, guards (discovery allies) | Monthly relationship visits |
| **Physical: To-Let board zones** | Street survey sectors per area | Survey route coverage map — every sector surveyed on rotation |
| **Referral network** | Past tenants/owners, employees, shopkeepers (points of presence) | Campaign waves |
| **Print/local** | Flyers at gyms/marts near universities (bachelor demand), banners | Campaign-based |

**Why a registry:** "post in Facebook groups" is not a plan. A named group with a cap, an owner, an area, and a performance history is a plan. Channel discovery itself is a recurring task ("find 3 new active rental groups for Area X monthly").

### 1.3 Daily Generated Marketing Tasks (catalog)

Each is a task template with SOP, estimate, evidence class, and KPI wiring:

| Task Template | Trigger/Cadence | Evidence | Notes |
|---|---|---|---|
| **FB group posting slot** | Daily per group within caps | Post link | Engine selects which listings to feature (fresh, high-quality, area-matched); rotates copy variants |
| **WhatsApp community share** | Per community cadence | Screenshot/link | Templated bilingual copy with listing reference codes |
| **Marketplace listing refresh** | Listing publish/refresh cycle | Link | Auto-list from verified inventory |
| **Dealer visit** | Weekly (partners), bi-weekly (vetted), monthly (registered) — relationship cadence by tier (Doc 05 §5) | GPS check-in + visit note | Route-batched with field day |
| **Housing society office visit** | Monthly per society | GPS + note | Rules updates, relationship, referral seeding |
| **To-Let board survey** | Sector rotation (every sector each N weeks) | Board photos + GPS | Feeds Property Discovery (Doc 05 §1); yield tracked per sector |
| **Field survey (market walk)** | New area ramp-up or quarterly refresh | Structured survey form | Rent norms, dealer census, society mapping — feeds master data |
| **Internet research** | Weekly | Research log | Competitor listings in area (dupes/fakes intelligence), new groups, rent trends |
| **Referral campaign wave** | Campaign calendar | Signups logged | Alumni tenants + owners + shopkeeper network |
| **Flyer/banner placement** | Campaign-based | Photo + GPS | Near universities/offices for bachelor demand |
| **Content creation** | Content calendar (§2) | Asset in library | Photography, video tours, area guides |
| **SEO work** | Backlog-driven weekly quota | Task artifact | Area pages, listing schema, GBP updates |
| **Channel discovery** | Monthly per area | New registry entries | Keeps the map alive |

### 1.4 Allocation Logic (where/when decisions)

The Marketing Planner decides *where to post and when* using:

1. **Target shortfall pull** (Doc 07 §5): lead targets per area/channel vs actuals → allocate more slots to under-performing areas via best-yielding channels.
2. **Channel yield ranking:** leads-per-post and qualified-rate per channel (attribution via source codes, tracked numbers, and "how did you hear" capture) → the engine shifts effort toward what works *in that area*.
3. **Timing intelligence:** per-channel engagement windows learned from history (e.g., FB groups peak post-Isha; WhatsApp mornings; Marketplace weekend browsing) → slot times, not just slot counts. Ramadan profile shifts everything.
4. **Frequency caps + compliance:** never exceed group rules; a warned channel auto-reduces cadence; a banned channel opens a remediation task to Marketing Lead.
5. **Inventory matching:** posts feature listings whose attributes match the channel's audience (bachelor-friendly listings → university-adjacent groups; family houses → society groups).

### 1.5 Campaign Layer

Campaigns are time-boxed pushes (new-area launch, Ramadan pre-Eid moving wave, referral drive) defined by Marketing Lead: objective, budget, channel mix, task-wave templates, and attribution code. The planner explodes a campaign into dated task waves; Analytics reports cost-per-lead and cost-per-closing per campaign (Doc 11).

### 1.6 Marketing KPIs (wired per Doc 06)

Activities executed vs planned; leads by channel; qualified-rate by channel (quality pair); channel compliance; cost-per-qualified-lead; supply-side yields (surveys→discovered properties→listings).

---

## 2. Social Media Planner

### 2.1 Scope

Owns brand-building and content distribution on owned social channels (Page, Instagram, TikTok, YouTube, GBP) — distinct from the Marketing Planner's group/community posting motion, but sharing the engine, registry, and asset library. **Why separate:** group posting is a lead-gen chore with caps and rotation; content is an editorial pipeline with production stages. They plan differently.

### 2.2 Content Calendar Model

- **Pillars (v1):** Verified listing showcases (video tours) · Area guides ("Renting in G-11: rents, schools, transport") · Trust education ("How to spot a fake listing", "Tenant police registration explained") · Owner education ("How verification protects your property") · Company/culture (field team stories) · Seasonal (Ramadan moving tips, Eid greetings, school-admission season).
- **Calendar mechanics:** Monthly editorial plan (Marketing Lead approves) → weekly production batches → daily posting slots per platform. Every stage is a generated task: shoot → edit → caption (bilingual) → review → schedule → post → engagement check (respond to comments/DMs within SLA — comments are leads!).
- **Asset pipeline:** every verification visit's media (with owner consent flag) feeds the asset library (Document Mgmt); content tasks draw from it — field ops and content compound each other.
- **AI assist (Doc 10):** draft captions/scripts in Urdu + English from listing data; human review mandatory before publish.

### 2.3 Posting Governance

- Account registry: who holds credentials (company-owned accounts only, no personal-account dependency), 2FA policy, access reviews (Doc 12).
- Brand + claims rules: only verified listings may be promoted; no rent promises; complaint-handling tone guide. Violations are complaint-category events.
- Engagement SLA: DMs/comments on owned channels create CRM leads automatically (manual log at first, API later) — social is a lead channel, not a broadcast.

### 2.4 Social KPIs

Calendar adherence; engagement vs benchmark; DM/comment response SLA; leads attributed to social; content quality review score; follower growth (tracked, but never a paid-incentive KPI — vanity metric guardrail).

---

## 3. Interactions

- **Engine:** both planners are demand collectors + template packs inside Doc 07's pipeline (capacity, routing, carry-forward, evidence all inherited).
- **CRM:** every channel's inbound flows to Lead Management with source attribution; channel yield closes the loop back into allocation logic.
- **Field Ops:** dealer/society/survey visits route-batch with verification visits — one field day, one route.
- **Analytics:** channel/campaign performance dashboards; the *area marketing mix* view answers "what actually generates closings in Gulshan?" per area.
- **HR/Training:** channel conduct SOPs gate posting-task eligibility; group bans hit compliance KPI.
