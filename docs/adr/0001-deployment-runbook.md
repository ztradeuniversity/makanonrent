# Admin Management — Deployment Runbook

Companion to `0001-admin-management-rbac.md`. Follow in order; steps 1–4
must all complete before the console is usable, and step 6 must not be
skipped.

---

## 1. Database migration

Run in the Supabase SQL editor (or `supabase db push`), **after** 0001–0003:

```
migrations/0004_admin_rbac.sql
```

Idempotent — safe to re-run. It creates the `admin_*` tables, the
verification/approval tables, the additive columns on `properties` and
`listings`, the separation-of-duty triggers, the append-only triggers,
and the two read-model views.

**Verify it applied** (expect 10 rows):

```sql
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('admin_users','admin_sessions','admin_area_assignments',
                      'admin_tasks','property_verifications','property_verification_media',
                      'property_approvals','admin_comments','admin_audit_log','admin_settings');
```

**Verify the separation-of-duty triggers exist** — if these are missing the
control is silently absent:

```sql
select tgname from pg_trigger
 where tgname in ('trg_verification_sod','trg_approval_sod',
                  'trg_audit_append_only','trg_verifications_append_only');
```

## 2. Environment variables (Cloudflare Pages → Settings → Variables)

Already present from earlier phases:

| Name | Notes |
|---|---|
| `SUPABASE_URL` | existing |
| `SUPABASE_SERVICE_ROLE_KEY` | existing — **secret**, never in `web/` |
| `SITE_URL` | existing; now also gates `Access-Control-Allow-Credentials` |

New, temporary:

| Name | Notes |
|---|---|
| `ADMIN_BOOTSTRAP_TOKEN` | **secret.** A long random string. Used once. Remove at step 6. |

Generate one:

```bash
openssl rand -hex 32
```

## 3. Deploy

Standard Pages deploy. New Functions routes appear under `/api/admin/*`.

## 4. Create the first CEO (once)

No CEO is seeded by SQL — a password hash in git is a backdoor. Create the
first account with the bootstrap endpoint, which refuses to run once any
CEO row exists:

```bash
curl -X POST https://YOUR-SITE/api/admin/bootstrap -H "Content-Type: application/json" -H "X-Bootstrap-Token: YOUR_TOKEN" -d '{"username":"ceo","fullName":"Founder Name","password":"a-long-passphrase-you-choose"}'
```

Expect `{"ok":true,"userId":"…"}`. A second call returns
`409 A CEO account already exists. Bootstrap is closed.`

## 5. Sign in and configure

1. Go to `/admin-login.html`, sign in as the CEO.
2. **Settings** → choose the approval chain and Auto Publish.
3. **Team** → create Assistant CEOs and Managers. Each is issued a
   temporary password **shown once** — copy it before leaving the screen.
4. **Team → Assign an area** → give each Manager their City / Main / Sub
   location paths (e.g. `lahore`, `lahore/johar-town`).

Area paths come from the existing location bank — the same `node_id`
values `location-manager.html` publishes.

## 6. Close the bootstrap door

**Delete `ADMIN_BOOTSTRAP_TOKEN` from the Pages environment and redeploy.**
With it unset the endpoint returns 404 regardless of any token supplied.
This is not optional.

## 7. Verify the security posture

```bash
# unauthenticated access must be refused, not redirected
curl -i https://YOUR-SITE/api/admin/users          # expect 401
curl -i https://YOUR-SITE/api/admin/monitor        # expect 401
curl -i -X POST https://YOUR-SITE/api/admin/bootstrap -H "X-Bootstrap-Token: anything"   # expect 404 after step 6
```

Then, signed in as a **Manager**, confirm:
- `/api/admin/users` → 403
- `/api/admin/monitor` → 403
- the Verify tab lists only their assigned areas
- a property they added shows “another person must verify it” and cannot
  be selected

---

## Known gaps — do not treat these as done

1. **MFA is not enforced.** Doc 18 Article 9.4 requires it for internal
   roles. The schema is ready (`totp_secret`, `mfa_enforced`); no TOTP
   flow is implemented. Until then, admin accounts are password-only.
   Mitigate with strong passphrases and, ideally, Cloudflare Access in
   front of `/admin*.html` and `/api/admin/*`.
2. **`/api/locations/publish` and `/api/locations/cities` are still
   unauthenticated.** They predate this work and still carry their
   original warning. They now *can* be protected — wrap their handlers
   with `requireCapability(context, 'areas.assign')` — but this change
   deliberately did not touch them, because doing so would break
   `location-manager.html`, which has no login flow yet.
3. **No integration tests have been executed** against a live database.
   The SoD triggers, the one-active-manager-per-area index and the
   append-only enforcement are implemented and reviewed but unproven at
   runtime. Exercise step 7 and the self-added-property case manually
   before trusting them in production.
4. **`admin_audit_log` and `admin_sessions` are unpartitioned.** Doc 04
   §1.3 calls for monthly time-range partitioning on audit-class tables.
   Fine at launch volume; revisit before the log passes a few million
   rows.
5. **Expired sessions are never reaped.** Rows accumulate in
   `admin_sessions`. Add a scheduled cleanup
   (`delete from admin_sessions where expires_at < now() - interval '30 days'`)
   when convenient — expiry is enforced on read, so this is hygiene, not
   a correctness issue.

## Rollback

Every added column is nullable and every added table is new, so rollback
is a pure drop with no data reconstruction:

```sql
drop view if exists admin_manager_overview;
drop view if exists admin_task_progress;
drop table if exists property_verification_media, property_verifications,
                     property_approvals, admin_comments, admin_audit_log,
                     admin_tasks, admin_area_assignments, admin_sessions,
                     admin_settings, admin_users cascade;
alter table properties drop column if exists added_by_admin_id,
                       drop column if exists area_node_id;
alter table listings   drop column if exists approval_state,
                       drop column if exists approved_by,
                       drop column if exists approved_at,
                       drop column if exists availability_state,
                       drop column if exists archived_at,
                       drop column if exists archived_by;
```
