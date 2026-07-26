# Property Operations — Deployment Runbook

Companion to `0002-property-operations.md`. Assumes ADR 0001 is already
deployed (admin console live, a CEO account exists).

---

## 1. Database migration

Run in the Supabase SQL editor, **after** 0001–0004:

```
migrations/0005_property_operations.sql
```

Idempotent. It adds the lifecycle column + history, the Evidence Service
columns, the Notification Bus table, audit before/after/reason, the
trust-status guard trigger, and six read-model views.

**It backfills `lifecycle_state` on every existing listing** from the
frozen `status` (inverse of the ADR 0002 §3.1 projection), so no row is
left in an undefined condition. Verify nothing was missed:

```sql
select count(*) as undefined_rows from listings where lifecycle_state is null;
-- expect 0
```

Confirm the new objects exist:

```sql
select table_name from information_schema.tables
 where table_schema='public' and table_name in ('listing_status_history','notifications');

select viewname from pg_views
 where schemaname='public' and viewname like 'admin_%'
 order by viewname;
-- expect: admin_manager_overview, admin_manager_performance,
--         admin_report_area_performance, admin_report_manager_ranking,
--         admin_report_pending_workload, admin_report_property_growth,
--         admin_report_verification_trend, admin_task_progress
```

**Confirm the Trust-Status Authority guard is armed** — without it, any
future code path can silently publish a property:

```sql
select tgname from pg_trigger where tgname in
  ('trg_listing_status_guard','trg_status_history_append_only');
-- expect both
```

Prove it actually blocks (this SHOULD fail):

```sql
update listings set status='verified_live' where id=(select id from listings limit 1);
-- expect: ERROR … route this change through functions/utils/lifecycle.js
```

Prove anti-reuse is armed (this SHOULD fail on the second insert):

```sql
select indexname from pg_indexes where indexname='uq_evidence_sha256';
```

## 2. Environment variables

**No new variables.** This change adds no secrets and no third-party
integration. If `ADMIN_BOOTSTRAP_TOKEN` is still set from ADR 0001's
deployment, it should already have been removed — check now.

## 3. Deploy

Standard Pages deploy. New routes: `/api/admin/lifecycle`,
`/api/admin/notifications`, `/api/admin/performance`,
`/api/admin/reports`.

Three existing endpoints changed behaviour and should be re-checked after
deploy — they no longer write `listings.status` themselves:

| Endpoint | Change |
|---|---|
| `/api/admin/approvals` | publish/reject now go through the lifecycle service |
| `/api/admin/properties` | archive/restore now go through it; archive requires a `reason` |
| `/api/admin/verifications` | proof now goes through the Evidence Service; verification moves the lifecycle |

## 4. Post-deploy verification

Signed in as CEO:

1. **Properties → Lifecycle** on any property. The history panel should
   show at least the backfill state. Move it through a transition with a
   reason; confirm a new history row appears with who/when/why.
2. **Reports** → cycle all five reports. Empty data renders "No data for
   this report yet", never an error.
3. **Audit** → the transition from step 1 appears as
   `lifecycle_transition`.
4. **Bell icon** → notification drawer opens; count is accurate.

Signed in as a Manager:

5. **Today** → the performance card shows tasks today/week/month,
   verification %, approval %, rejected %, inactive days.
6. Open a property's Lifecycle. Confirm **no** Reject / Archive / Delete
   buttons are offered — a manager holds none of those transitions.
7. Attempt a verification on a property the manager added themselves:
   must be refused (separation of duties, inherited from ADR 0001).

## 5. Evidence upload flow

Evidence still uploads to R2 via the existing `/api/uploads/presign`,
then the key is passed to `/api/admin/verifications` in `proof[]`:

```json
{ "verifications": [{
    "propertyId": "…", "status": "available", "phoneNumber": "+92…",
    "comments": "Owner confirmed on site",
    "proof": [{
      "kind": "image", "key": "r2/key.jpg", "url": "https://…",
      "sha256": "<64-hex>", "byteSize": 182344,
      "capturedAt": "2026-07-26T09:12:00Z",
      "gpsLat": 31.52, "gpsLng": 74.35, "device": "…"
    }]
}] }
```

`kind` accepts `image`, `video` and `document`. Items are accepted or
rejected individually — a recycled photo does not discard the rest of the
batch.

---

## Known gaps — do not treat these as done

1. **Evidence hashes are client-supplied** (ADR 0002 §6). A malicious
   client can send a plausible hash for bytes it never uploaded, so
   anti-reuse is strong against careless recycling and weak against a
   determined insider. The real fix is server-side hashing of the R2
   object, or a capture-only mobile app (Doc 05 §2.2.1 forbids gallery
   uploads). **Do not describe evidence as tamper-proof until then.**
2. **No SLA/escalation.** "Pending workload" shows backlog and its age;
   nothing escalates on a timer. Hand-rolled timers are forbidden by
   Article 4.1, so this correctly waits for the shared SLA Engine
   (AM-3.1).
3. **Notifications are in-app only.** No WhatsApp/SMS/email. The bus is
   the seam where that lands without touching any caller.
4. **No partitioning** on `listing_status_history`, `admin_audit_log` or
   `notifications`. Doc 04 §1.3 wants monthly time-range partitioning on
   this class. Years away at 120 admin users, but deliberate.
5. **The performance score is a first draft.** `admin_report_manager_ranking`
   weights target attainment 0.6, throughput 0.4, minus inactivity days.
   It is deliberately simple and inspectable — **review it against real
   data before using it in any pay or promotion decision.**
6. **Doc 05 §1 property-level lifecycle** (DISCOVERED…RETIRED) is still
   unimplemented; this covers the listing/operational axis only.
7. **No integration tests have been run** against a live database. The
   guard trigger, the append-only triggers, the anti-reuse index and the
   backfill are implemented and reviewed but unproven at runtime — which
   is exactly what §1 and §4 above exist to check manually.
8. **MFA still unenforced**; **`/api/locations/*` still unauthenticated**
   (both inherited from ADR 0001).

## Rollback

```sql
drop view if exists admin_report_pending_workload, admin_report_verification_trend,
                    admin_report_property_growth, admin_report_area_performance,
                    admin_report_manager_ranking, admin_manager_performance;
drop trigger if exists trg_listing_status_guard on listings;
drop trigger if exists trg_status_history_append_only on listing_status_history;
drop table if exists listing_status_history, notifications cascade;
alter table listings drop column if exists lifecycle_state,
                     drop column if exists lifecycle_changed_at,
                     drop column if exists lifecycle_changed_by,
                     drop column if exists deleted_at,
                     drop column if exists deleted_by;
alter table property_verification_media
  drop column if exists sha256, drop column if exists byte_size,
  drop column if exists captured_at, drop column if exists device_fingerprint,
  drop column if exists gps_lat, drop column if exists gps_lng,
  drop column if exists note;
alter table admin_audit_log drop column if exists before_value,
                            drop column if exists after_value,
                            drop column if exists reason;
```

`listings.status` is untouched by the rollback — it was never repurposed,
which is the entire reason the projection approach was chosen.
