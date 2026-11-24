# Orai Service — Project Status & Security Review

> Latest milestone (2026-11-25): PR #5 UI89f393c is READY on https://orai-pr4-staging.vercel.app. Customer/admin preferences now show only gender/style/greeting, with green change highlights. Independent23-test/type/lint/build/SSR gate and real staging browser checks passed. Historical data preserved; no new migration/provider change or production deployment. Prior staging/conflict-recovery milestones below remain chronological.

**Date:** 2026-11-24  
**Branch:** `main` (commit `a258a51`)  
**Target:** `main`  
**Framework:** Next.js 15.5.29 (React 19, TypeScript, Tailwind CSS)  
**Database & Auth:** Supabase (PostgreSQL 15+, Supabase Auth SSR, RLS)  
**Production Hosting:** Vercel (`https://ai-voice-agent-five-tau.vercel.app`)  
**Hosted Database:** Supabase Cloud (`https://jkzjluyldahlifufoiql.supabase.co`)

---

## 1. Verified Functionality

### A. Authentication & Session Management
- **Supabase Auth Integration (`@supabase/ssr`):**
  - Native cookie-based session handling via `withPlatformRequest` adapter.
  - Automatic token refresh persisted into HttpOnly, SameSite=Lax, Secure cookies.
  - Rejection of legacy cookie formats (`orai_auth_session`, `vp_admin`).
- **Session Expiry & Validation:**
  - Database-backed session validation via `private.current_session_is_active()`.
  - Expired, revoked, or banned user tokens cannot access tenant records or APIs.
- **Logout:**
  - `DELETE /api/platform/auth/session` calls `supabase.auth.signOut({ scope: "local" })` and clears all auth cookies.
  - Immediate invalidation verified; cookie replay is rejected.
- **Role-Based Authorization (RBAC):**
  - Roles enforced from PostgreSQL `profiles.system_role` and `organization_members.role` (never trusted from user metadata or frontend tokens).
  - Two primary tiers:
    - `super_admin`: Access to Orai Admin Dashboard (`/admin` and `/api/platform/admin/*`).
    - `customer_admin`: Access to Customer Dashboard (`/dashboard` and `/api/platform/customer/*`).
  - Cross-role elevation and customer tampering rejected.

### B. Multi-Tenant Data Isolation (Customer A vs Customer B)
- **Organization-Scoped Storage & Queries:**
  - Every tenant-owned table (`conversations`, `appointments`, `knowledge_sources`, `agents`, `usage_records`) references `organization_id`.
  - Backend route handlers bind all queries strictly to the caller's verified `auth.organizationId`.
- **Verified Isolation Matrix:**
  - **Conversations:** Customer A cannot list, view, or mutate Customer B's call logs or transcripts.
  - **Appointments:** Customer A cannot list, update status, or delete Customer B's appointments.
  - **Knowledge Base:** Customer A cannot list, create, update, or delete Customer B's documents or FAQs.
  - **Usage Records:** Customer A cannot read or modify Customer B's call minutes or conversation counts.
  - Direct PostgreSQL RLS policies enforce isolation even if Next.js API routes were bypassed.

### C. Appointment Lifecycle
- **Creation:** Public booking submission via `/api/public/beauty/appointments` with rate limiting, input validation, and idempotency keying.
- **Confirmation:** Transition from `pending` -> `confirmed`.
- **Completion:** Transition from `confirmed` -> `completed` (automatically moves record to the "已完成記錄" section).
- **Reversion:** Transition from `completed` -> `confirmed` (moves record back to the active appointments section).
- **Deletion:** Permanent removal via `DELETE /api/platform/customer/appointments?appointmentId=...`.
- **Validation:** Database trigger `private.enforce_appointment_transition()` ensures only permitted state machine transitions occur.

---

## 2. Supabase Migrations & Row Level Security (RLS)

All database migrations are located in `supabase/migrations/`:

| Migration File | Purpose | Local Test Status | Hosted DB Status |
| :--- | :--- | :--- | :--- |
| `001_multi_tenant_foundation.sql` | Core schemas (`organizations`, `profiles`, `members`, `agents`, `conversations`, `appointments`, `usage_records`) & initial RLS | Applied | Applied |
| `002_rls_write_hardening.sql` | Column-level update grants and customer admin helper functions | Applied | Applied |
| `20261123105304_auth_tenant_isolation.sql` | Hardens auth session checks into schema `private`, sets explicit table grants | Applied | Applied |
| `20261123110214_beauty_appointment_requests.sql` | Adds appointment request hash, time window, and state transition trigger | Applied | Applied |
| `20261123233500_update_appointment_transition.sql` | Permits reversible appointment transitions (`completed` <-> `confirmed`) & adds `appointments_delete` policy | Applied | Applied |

### Security Measures & Defense-in-Depth
1. **Private Schema Helpers:** Security definer functions (`current_session_is_active`, `is_super_admin`, `is_customer_admin_for`) are placed in the `private` schema, uncallable by `anon` or public roles.
2. **Column-Level Revocation:** Update permissions on sensitive columns (`system_role`, `organization_id`, `status`) are revoked from `authenticated`.
3. **Same-Origin Mutation Protection:** `isSameOriginMutation` validates request origin against the Host header, mitigating cross-site state-changing requests.

---

## 3. Local Verification vs. Hosted Production Checks

### A. Local Environment Checks (Automated Test Suite)
- **Database Engine:** In-memory PostgreSQL 15 (`@electric-sql/pglite`) running all migrations from scratch.
- **Test Results:** 35 passing tests, 0 failures, 0 skipped (`npm run test:security`, `npm run test:booking`, `tests/production-data.test.ts`).
- **TypeScript Typecheck:** `tsc --noEmit` passed with 0 errors.
- **Production Build:** `next build` passed successfully, producing 24 optimized static and dynamic routes.

### B. Hosted Database Checks (`https://jkzjluyldahlifufoiql.supabase.co`)
- **Minimal Schema Fix Execution (Verified):**
  - Executed minimal fix script in Supabase SQL Editor:
    1. `GRANT DELETE ON public.appointments TO authenticated;`
    2. Created `appointments_delete` policy for authenticated customer admins and super admins.
    3. Recorded version `20261123233500` in `supabase_migrations.schema_migrations`.
  - Verification query output confirmed `appointments_delete` policy is active for `DELETE` commands.
  - Appointment revert (`completed` <-> `confirmed`) and appointment deletion are now fully operational in the database.
- **Account & Profile Audit:**
  - Exactly 1 customer admin exists (`test@orai.hk`, role `user` / `customer_admin` for `test-org`).
  - **Zero `super_admin` accounts exist** in the hosted database. Admin dashboard (`/admin`) login will reject all users until an administrator is provisioned with `system_role = 'super_admin'`.
- **Existing Records:**
  - 3 existing appointment records remain intact (`陳小姐`, `wong 先生`, `Orai`). No production data was altered.

### C. Hosted Vercel Health Checks (`https://ai-voice-agent-five-tau.vercel.app`)
- **Public & Dashboard Pages:**
  - `GET /` -> HTTP 200 (OK)
  - `GET /beauty` -> HTTP 200 (OK)
  - `GET /dashboard` -> HTTP 200 (OK)
  - `GET /admin` -> HTTP 200 (OK)
- **API Authorization Guard:**
  - `GET /api/platform/admin/overview` (unauthenticated) -> HTTP 401 `{"error":"請先登入"}`
  - `GET /api/platform/customer/overview` (unauthenticated) -> HTTP 401 `{"error":"請先登入"}`
- **Auth Endpoint Configuration:**
  - `POST /api/platform/auth/session` -> HTTP 503 `{"error":"尚未設定 Supabase Auth"}`.
  - **Diagnosis:** Vercel project environment variables need `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` configured in the Vercel dashboard and redeployed, as `authConfigured()` evaluates to `false` in the deployed environment.

---

## 4. Remaining Blockers Before Real Customer Onboarding

1. **Supabase Cloud Migration Status:**
   - **Resolved.** All required policies, triggers, and table grants (including `appointments_delete` and version `20261123233500`) are active.
2. **Vercel Production Environment Variables:**
   - Configure `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the Vercel dashboard and trigger a redeploy so Supabase Auth can process login requests on production.
3. **Super Admin Account Provisioning:**
   - Provision an administrative user in Supabase Auth and assign `system_role = 'super_admin'` in `profiles` to enable access to `/admin`.
4. **Out-of-Scope Production Integrations (Phase 2):**
   - ElevenLabs live webhook & Agent ID binding.
   - Live telephony / Twilio Hong Kong phone numbers.
   - WhatsApp business confirmation notifications.
   - Google Calendar sync.
4. **Out-of-Scope Production Integrations (Phase 2):**
   - ElevenLabs live webhook & Agent ID binding.
   - Live telephony / Twilio Hong Kong phone numbers.
   - WhatsApp business confirmation notifications.
   - Google Calendar sync.

---

## 5. Automated Test Results

Ran test suite with `@electric-sql/pglite` and Node.js native test runner on Windows:

```
✔ slug-only, missing password, invalid JSON and old admin password cannot log in (19.6ms)
✔ wrong password fails; customer login uses DB role and returns no tokens (9.4ms)
✔ Auth rate limiting is not reported as an incorrect password (0.6ms)
✔ Auth connectivity failures return service unavailable rather than incorrect password (0.9ms)
✔ old and forged custom cookies are rejected by both API families (1.2ms)
✔ merchant cannot enter either admin API; cross-tenant selection is rejected (5.8ms)
✔ requesting super_admin at login does not elevate a merchant (2.0ms)
✔ customer list and update APIs bind all data queries to authenticated tenant (9.4ms)
✔ cross-origin and missing-origin mutations fail before contacting Auth (0.4ms)
✔ same-origin check handles Next canonical localhost URL with actual loopback Host (0.4ms)
✔ Supabase refresh persists updated cookies (2.4ms)
✔ membership removal and admin demotion are observed on the next request (6.6ms)
✔ logout revokes session; replay of the old cookie is rejected (4.5ms)
✔ validation rejects missing fields, invalid dates, long notes and tenant spoofing (2148.9ms)
✔ network failure has actionable Chinese text without pretending the booking succeeded (0.3ms)
✔ public submission persists to Postgres and returns a pending receipt without personal details (8.6ms)
✔ missing configuration, merchant or migration returns a setup error rather than success (3.2ms)
✔ same idempotency key does not create a duplicate and changed payload is rejected (5.8ms)
✔ merchant A sees request after login; merchant B cannot read or change it (26.8ms)
✔ appointment confirm, complete, revert and delete lifecycle persists across restart and fresh login (224.9ms)
✔ pending request can be rejected; invalid status cannot be persisted (24.3ms)
✔ production with missing database settings cannot load local/example data (1.3ms)
✔ database errors cannot silently return local documents, notes or clients in production (22.6ms)
✔ failed writes are never acknowledged as locally saved in production (1.9ms)
✔ unavailable statistics are not reported as a genuine zero (0.6ms)
✔ tenant A and B can only read their own organization and tenant rows (1189.0ms)
✔ customer cannot promote self, insert privileged profile, delete profile, or edit memberships (5.8ms)
✔ safe own-profile and merchant fields remain editable (3.4ms)
✔ foreign tenant writes return no rows or reject ownership (8.2ms)
✔ viewers read own tenant but cannot write (3.4ms)
✔ anonymous users cannot read tenant data or call identity helpers (2.1ms)
✔ internal admin reads all tenants but cannot self-assign roles through Data API (1.7ms)
✔ inactive membership and inactive/suspended organization revoke tenant access immediately (3.5ms)
✔ revoked, expired, banned or anonymous Auth sessions cannot access data (5.2ms)
✔ same-tenant foreign keys prevent cross-tenant appointment links even for service role (2.3ms)

Total: 35 passing (0 failures, 0 skipped)
TypeScript check: PASSED (tsc --noEmit)
Next.js Production Build: PASSED (24/24 static/dynamic routes generated)
```

## ElevenLabs post-call transcription (feature branch, 2026-11-24)

Implemented POST /api/webhooks/elevenlabs using the pinned official SDK and the
unmodified request body, signature validation, 2 MiB input bound, strict MVP
payload projection, and retryable 503 responses for persistence failures.
Tenant ownership is resolved inside a service-role-only SQL function from the
unique agents mapping. Provider conversation uniqueness makes concurrent retries
idempotent; conflicting ownership is rejected. Existing rows and RLS remain.
Dashboard transcript disclosures retain legacy conversation rendering.

### Configuration and release steps

1. Review migration 20261124055712_elevenlabs_post_call.sql in staging first.
   Resolve duplicate non-empty agents.elevenlabs_agent_id mappings before applying.
   No hosted migration was executed by this feature task.
2. Provision each merchant's unique ElevenLabs agent ID in public.agents against
   the correct active organization. Do not accept tenant IDs from dynamic variables.
3. In ElevenLabs workspace settings create an HMAC post-call webhook targeting
   https://<your-approved-domain>/api/webhooks/elevenlabs. Select transcription
   events (post_call_transcription / transcript); leave audio and unredacted events
   disabled. Confirm the intended agents use this webhook and enable retries.
4. Copy its signing secret directly into Vercel Project > Settings > Environment
   Variables as ELEVENLABS_WEBHOOK_SECRET for the intended environment. Keep the
   Supabase URL and server-only SUPABASE_SERVICE_ROLE_KEY configured. Never prefix
   the signing secret with NEXT_PUBLIC_. Preview and Production require their own
   deliberate configuration. Redeployment requires separate approval.
5. The route uses HMAC, not browser login/Origin checks. Ensure Vercel deployment
   protection permits ElevenLabs requests to this one endpoint; do not disable
   protection indiscriminately. Localhost cannot receive hosted deliveries.
6. Enable provider-side transcript PII redaction and agree retention before real
   callers. MVP stores conversation transcript text and summary, timing, channel,
   provider IDs and call_successful flag only. It does NOT guarantee text contains
   no personal information: no local semantic PII detector is claimed. No raw
   payloads, dynamic variables, tool arguments, phone metadata, recordings or
   data_collection_results are stored or logged. Additional analysis requires
   explicit field review. Unknown mapped channels are currently web/phone only.
7. After approved staging release, make a fictional test conversation. Verify
   transcript and summary in tenant A, replay for one row, and verify tenant B
   cannot read it. Recheck mapping changes before reusing agents for another tenant.

Validation: official-SDK webhook unit tests pass (4/4). Full independent gate
results will be appended before PR delivery. Real provider delivery, hosted
migration, redaction configuration and browser UI are not yet verified.

MVP limitations: the existing conversations list still returns full rows rather
than a paginated summary/detail API. The local duplicate test uses one PGlite
connection; production concurrent uniqueness is enforced by PostgreSQL's unique
index, but multi-connection stress testing was not performed. Agent UI was
implemented through Cursor Agent and reviewed by the implementation owner.
vercel.json disables automatic deployments for codex/elevenlabs-post-call only,
so pushing this review branch does not authorize or trigger a Vercel preview.

Final independent verification: security 28/28, webhook 4/4, booking 8/8;
typecheck, lint (0 errors, 9 existing warnings), build and diff check passed.
Built HTTP smoke: homepage/beauty/dashboard 200, unauthenticated conversations
401, missing webhook secret 503. No failing gate remains. Hosted migration,
real provider delivery, redaction setup and interactive browser UI unverified.

## PR #4 Bugbot follow-up (2026-11-24)

- Ownership conflicts now return the permanent `ownership_conflict` result with
  HTTP 200, preserving the existing owner and preventing retry storms. Genuine
  RPC/database failures still return 503. RPC results are checked against the
  accepted result set before acknowledgement.
- createOrganization now provisions organization and agent via one service-only,
  SECURITY INVOKER PostgreSQL RPC. Constraint failures roll back the whole call;
  the application propagates errors instead of logging and reporting success.
  Local development also rejects duplicate non-empty provider agent IDs.
- Dashboard excerpt falls back to the first non-empty transcript turn, after
  trimmed summary and legacy text.
- Removed redundant service-role table grants from the pending feature migration.
  Existing auth-isolation migration supplies table privileges; both RPCs revoke
  PUBLIC/anon/authenticated execution and explicitly grant only service_role.
- Regression tests cover permanent acknowledgement, transient failure, immutable
  ownership, service-role provisioning, duplicate-agent/invalid-agent rollback,
  organization failure without orphan agents, and anonymous/authenticated RPC denial.
  No remote migration was executed. Apply the reviewed feature migration before
  releasing application code that calls create_organization_with_agent.

Initial targeted results: security 30/30, webhooks 5/5. Independent full gate pending.

Final independent Bugbot-fix gate: security 30/30, webhooks 5/5, booking 8/8;
typecheck, lint (9 existing warnings), build, diff check and built HTTP smoke pass.
No failing local gate remains. Hosted migration/provider delivery, true concurrent
connections and interactive browser UI remain unverified. Review branch automatic
Vercel deployment remains disabled. No remote migration, merge or deployment run.

## Staging readiness audit — 2026-11-24 (review baseline 4ae464c)

### Verified read-only findings

Hosted target inspected: jkzjluyldahlifufoiql. Treat as an existing environment,
NOT as an isolated staging database. Supabase connector performed SELECT-only
checks; no hosted schema, accounts, sessions or rows were modified.

- Duplicate non-empty ElevenLabs agent ID groups: **0** at audit time.
- agents/conversations/organizations all have RLS enabled. service_role has
  SELECT/INSERT/UPDATE on each, sufficient for ingestion row locking and inserts.
- Hosted conversations has the legacy columns but lacks provider/provider IDs,
  transcript JSONB, analysis JSONB, started_at/ended_at. Both PR ingestion and
  atomic provisioning RPCs are absent. PR #4 is NOT compatible until migrations.
- Hosted migration history: 20261123112258 auth_tenant_isolation,
  20261123112314 beauty_appointment_requests, 20261123233500. Earlier foundation
  tables exist despite 001/002 not appearing in history. Do NOT blindly db push
  local migration history onto this existing database or repair history here.
- Super Admin profiles: **0**. Password-capable, non-banned Super Admins: **0**.
  These are aggregates; no user email, password hash or credentials were output.
- Supabase development branches: **none**. No branch/project has been created.
- Existing Vercel origin https://ai-voice-agent-five-tau.vercel.app: GET /admin200,
  GET /api/platform/auth/session200, unauthenticated conversations401. These
  prove public availability/access rejection, NOT correct login or env values.
- Vercel management connector is not installed, CLI is unavailable, no .vercel
  project binding was found. Hosted env variable scopes, Supabase project target,
  Auth keys, Auth Site URL/redirect allowlist and working admin login remain
  UNVERIFIED. Public HTTP alone cannot verify these. Connect Vercel for read-only
  metadata review or have an operator inspect the settings below; never paste keys.

### Isolated staging plan and approval gates

No cloud environment was provisioned: creation may incur billing and apply schema
or deploy code, all outside the current no-remote-write boundary. Prepared local
migration/tests/probe are ready; hosted staging is NOT ready or claimed created.

1. Approve a separate Supabase project or persistent data-less branch named
   orai-pr4-staging. Branches have separate credentials; explicitly exclude data
   and storage cloning. Confirm costs and target project ref before creation.
   Keep production/existing database credentials out of staging entirely.
2. Disable automatic Git-to-Supabase migrations/branch merges and Vercel auto
   deployments during preparation. PR branch vercel.json currently disables
   codex/elevenlabs-post-call deployments. Keep that setting until a separately
   approved manual deployment to a dedicated Vercel project orai-pr4-staging.
3. On an EMPTY staging database only, apply migration files in order: 001,002,
   20261123105304,20261123110214,20261123233500,20261124055712, then
   20261124103151_immutable_agent_ownership.sql. Review CLI --help and dry-run
   against the explicitly approved staging target before execution. Never use
   the existing jkzjluyldahlifufoiql as the default linked target.
4. Verify schema/indexes/RLS, service-role execution, and authenticated/anon RPC
   denial. Any duplicate/ambiguous historical mapping must stop migration;
   do not silently select an owner or delete conflicting rows.
5. Provision fictional staging organizations A/B and separate Auth users plus
   one Orai admin. profiles.id must match auth.users.id; admin system_role is
   assigned only through trusted administration. Merchant memberships must be
   active customer_admin and organizations active. Do not reuse production
   users, passwords, agent IDs, telephone numbers or storage objects.
6. Configure TWO dedicated ElevenLabs staging agents, one per tenant. No real
   phone routing or customers. Authorize a manual staging deployment separately.
7. Rollback: disable staging webhook first, revert application to previous
   compatible version; preserve database evidence. Prefer forward fix. Never
   drop columns, destroy ownership tombstones or run down-migrations on existing
   environments as an automatic rollback. Staging teardown requires approval.

### Agent ownership protection (local, not remotely applied)

20261124103151 adds an RLS-protected provider-ID ownership registry, backfilled
from current mappings AND historical conversations. A private SECURITY DEFINER
trigger (fixed search_path, direct EXECUTE revoked) reserves each non-empty ID
for its original tenant. Neither service-role API edits nor delete/clear and
reinsert can move that ID to another tenant. Registry rows contain only IDs,
no transcript/PII, deliberately survive merchant deletion (no cascading FK), and
are inaccessible to authenticated/anon/service_role direct writes. Privileged
DB owners can still bypass controls; access must remain restricted and audited.

Never recycle provider agent IDs. Retired IDs remain reserved indefinitely;
new merchants require new agents. A same-tenant reinstatement is allowed.
Retired agents without a live mapping are ignored; delayed deliveries cannot
be routed to a new tenant. Any pre-existing reassignment before registry setup
without surviving historical evidence cannot be reconstructed: operator must
attest inventory or replace such agents before real traffic.

### Exact staging configuration checklist (after approval)

Vercel dedicated staging project > Settings > Environment Variables:
- NEXT_PUBLIC_SUPABASE_URL: isolated staging project URL.
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY):
  SAME staging project's public key. Never use a service key here.
- SUPABASE_SERVICE_ROLE_KEY: SAME staging project's server-only key.
- ELEVENLABS_WEBHOOK_SECRET: generated signing secret for staging webhook only.
- ORAI_BEAUTY_ORGANIZATION_SLUG: fictional staging slug if testing Beauty flow.
- ELEVENLABS_API_KEY is unnecessary for verifying incoming webhooks; configure
  a separate staging key only for separately approved outgoing ElevenLabs work.
- ADMIN_PASSWORD and SESSION_SECRET do not authenticate current dashboards.
Scope keys to the dedicated staging project's intended Preview/custom staging
(or Production scope ONLY within that separate project), never Orai production.
Changing variables needs an approved deployment before it takes effect.

Supabase staging > Authentication > URL Configuration: Site URL is the fixed
staging HTTPS origin. Allow only exact staging callback/reset destinations used
by the app. Current email/password API does not use a redirect callback, so do
not invent a route or broadly wildcard production redirects. Confirm email Auth
is enabled, password-capable users are provisioned, admin role exists, sessions
are HttpOnly/Secure and merchant/admin login/logout work end-to-end.

ElevenLabs > Agents settings > Post-call webhooks: create staging HMAC webhook
at https://<approved-staging-host>/api/webhooks/elevenlabs; store generated secret
in Vercel without copying it into docs/logs. Enable transcription event
post_call_transcription (agent override UI may call it transcript), enable
retries and bind both staging agents to it. Disable audio, unredacted transcript,
unredacted audio and all unrelated events. Ensure Vercel Deployment Protection
permits this endpoint via a narrowly scoped supported exception/integration;
HMAC remains mandatory. Do not globally remove protection. Confirm with a signed
fictional delivery. Keep production webhook configuration untouched.

### PII, retention and deletion acceptance requirements

These are proposed release requirements, not a claim of implemented deletion:
- Fictional-only staging now. No real caller names, phone numbers, HKID/payment,
  medical details, recordings or production transcript copies. Summary and
  transcript BOTH require redaction; tool arguments/dynamic variables/raw events
  remain excluded. Logs contain only safe IDs/status, never content or secrets.
- ElevenLabs history redaction is Enterprise-only per official docs. Confirm
  entitlement and that redaction covers delivered webhook text/summary using
  synthetic markers. If unavailable or webhook remains unredacted, block real
  calls until application-side redaction is implemented and tested. Regex-only
  masking is not proof that all sensitive free text is removed.
- Proposed staging text retention: 7 days; proposed real-data text retention:
  30 days, pending business approval. Disable provider audio saving. Configure
  provider retention independently; database expiry is not provider deletion.
- Before real traffic implement/schedule tenant-scoped expiry, explicit deletion
  requests, and audit counts without transcript. Delete transcript, summary and
  analysis in Orai AND the provider; invalidate caches/exports; define backup
  expiry and restoration re-deletion. Limit actions to authorized staff.
- Retain minimal conversation-ID deletion tombstones so retries do not resurrect
  erased conversations. This is NOT yet implemented and blocks a real-data
  deletion promise. Agent ownership tombstones must not be removed by text purge.
- Deletion must respect linked appointment foreign keys; define retain/anonymize
  policy for appointments separately instead of cascading customer data blindly.

Sources: https://supabase.com/docs/guides/deployment/branching ;
https://supabase.com/docs/guides/auth/redirect-urls ;
https://elevenlabs.io/docs/eleven-agents/customization/privacy

### Prepared fictional end-to-end acceptance matrix

Use run-specific fixture IDs and record environment/ref/commit with evidence.
After explicit staging-write approval, set STAGING_BASE_URL (HTTPS hostname must
contain staging), STAGING_AGENT_ID, ELEVENLABS_WEBHOOK_SECRET and
STAGING_TEST_APPROVED=fictional-data-only in a secure local shell, then run
node scripts/staging-webhook-probe.mjs. The script was prepared, not executed
against any hosted target. It sends one invalid HMAC and two valid duplicate
fictional deliveries, prints statuses and a fixture ID, never the secret/body.

[ ] Admin logs in and creates A/B with distinct dedicated agents; duplicate agent
    attempt fails and creates neither partial merchant nor agent.
[ ] Probe invalid401; valid/duplicate200; DB exactly one provider conversation,
    tenant A ownership despite forged dynamic organization_id; transcript-only
    row shows first non-empty message; full roles/duration/channel visible.
[ ] A refresh/relogin retains row; B list/API cannot read or change A's row.
[ ] Normal user/anon cannot invoke ingestion/provisioning RPC or ownership writes.
[ ] Change A agent to B, clear/delete and recreate under B: all transfers rejected;
    delayed original ID never lands in B. Same-tenant reinstatement allowed.
[ ] Unknown agent200 ignored; malformed signed400; missing/invalid/expired HMAC401;
    missing server config503; genuine transient staging failure503 then retry
    persists once; permanent ownership conflict200 without changing owner.
[ ] Actual fictional ElevenLabs call ends and analysis completes; real signed
    webhook populates correct tenant. This validates provider interoperability,
    unlike the synthetic HTTP probe alone.
[ ] Synthetic PII markers are redacted in provider webhook, transcript AND summary;
    audio absent; expiry/delete/replay-resurrection tests pass before real callers.
[ ] Authorized cleanup only: remove fictional text/fixtures per recorded IDs,
    retain agent ownership/deletion tombstones and aggregate evidence.

Remaining blockers: staging provisioning/cost/target approval, Vercel settings
access, missing hosted admin, unapplied feature migrations, redaction entitlement
and coverage, retention/deletion machinery, approval for migration and staging
deployment/test writes. No hosted E2E or real provider success is claimed.

Final independent staging-preparation verification: security31/31, webhooks5/5,
booking8/8, typecheck/lint/build/diff check pass (9 existing lint warnings).
Local built HTTP smoke passes; staged probe syntax passes but no hosted probe
executed. Extra local SQL probe rejects conflicting current/historical owners.
New ownership protection is local code only until separately approved migration.

## Approved staging execution — actual progress 2026-11-24

User approved isolated staging setup, migrations, fictional accounts, deployment
and E2E tests, conditional on confirming any additional costs. Production remains
untouched; PR #4 remains unmerged.

- Organization confirmed by user: ronho1414's Org / jbzapppkcyvhaadwltec.
- Supabase quoted separate project additional monthly amount0; branch0.01344/hour.
  Chose separate project; no paid branch. No paid upgrade/add-on authorized.
- CREATED orai-pr4-staging, ref wnajobvcldveajtdvbwg, region ap-northeast-1,
  ACTIVE_HEALTHY. Before schema setup public application table count was0.
- APPLIED all five prerequisites to this empty staging project, then both new
  migrations: elevenlabs_post_call and immutable_agent_ownership. All7 succeeded.
  No existing/production database was targeted or copied.
- Verified both RPCs service-role-only (anon/authenticated execute=false), registry
  RLS=true, initial organizations/profiles/conversations counts all0.
- CREATED two fictional merchant records staging-salon-a and staging-salon-b,
  each with a draft agent and empty provider agent ID. No real agent IDs assigned.
- Vercel connection newly added by user, but both get_git_deployment_context and
  list_teams returned teams=[]. No deployment/team/plan/cost can be confirmed yet.
  Need the intended Vercel team/account slug or expanded team authorization.
- Created ignored .env.staging.local template pointed ONLY to staging. Missing
  SUPABASE_SERVICE_ROLE_KEY blocks use of supported Auth Admin API. Operator must
  paste the staging project's server key into the LOCAL file, not chat or docs.
  Public key/URL present. Do not copy any production service key.
- Prepared ignored local account provisioning helper data/staging-provision.mjs
  (syntax checked), to run via node --env-file=.env.staging.local after key setup.
  It creates test-admin plus two fictional merchant Auth users, confirms email via
  Admin API without sending email, persists random passwords only in ignored
  data/staging-test-accounts.json, links roles/memberships and checks password
  login and tenant isolation. NOT executed yet: no Auth users/admin claimed ready.
- No Vercel project/deployment, hosted webhook probe or actual ElevenLabs call
  performed yet. Existing31/5/8 local suites stand; no unrelated repeated audit.

Immediate operator actions: authorize the intended Vercel team or provide its
slug; insert staging server key from Supabase staging Settings > API Keys into
.env.staging.local. Never paste secrets into chat. After these prerequisites,
continue account setup, dedicated Vercel staging project/cost check, deployment,
then configure TWO new ElevenLabs staging agents. Copy their IDs (not API keys)
for tenant A/B mapping; webhook secret must go only into staging Vercel env and
local ignored staging env. Keep webhook disabled until endpoint is ready.

Vercel post-install recheck: connection exists, but get_git_deployment_context
and list_teams still return teams=[]. Need target team/account slug to request
team-specific authorization; installing alone did not expose a deployment scope.
Local staging config presence check (no values output): staging URL correct,
server key absent, signing secret absent. Auth Admin provisioning/deployment
remain pending these inputs; no extra cloud resources or deployments created.

## Vercel staging deployment — actual READY and protection checks (2026-11-24)

- Vercel team ronho1414 authorization now works; confirmed existing Hobby plan.
  Created only dedicated project orai-pr4-staging / prj_jFozNUtpm9Ak2b4aDXOoXV3lS2Y0.
  A request explicitly selecting Build Machines was rejected by the plan; retried
  WITHOUT paid build-machine settings. No plan upgrade or paid add-on purchased.
- Deployment dpl_BhCM2E7Y5uyayY93KfW121Zwborf is READY. Git source is exact PR4
  commit cf09b4c8efc255c550a4938ea6757c0d0773247d. No main merge or production
  project mutation. Vercel labels target=production inside this NEW dedicated
  staging project; this is not the existing ai-voice-agent production project.
- Canonical staging URL: https://orai-pr4-staging.vercel.app
- Commit alias: https://orai-pr4-staging-git-cf09b4c-ronho1414.vercel.app
- Immutable URL: https://orai-pr4-staging-fk0hbbbmw-ronho1414.vercel.app
- Complete webhook: https://orai-pr4-staging.vercel.app/api/webhooks/elevenlabs
- Deployment Protection remains enabled for ALL deployments of staging project.
  Generated a staging-project-only automation bypass; kept value solely in the
  git-ignored .env.staging.local as VERCEL_AUTOMATION_BYPASS_SECRET. No bypass
  value is printed here. Revoke after tests; it grants staging-project access,
  not a path-specific exception. App Auth and webhook HMAC remain required.
- Real external HTTP checks against canonical URL: no bypass -> protected401;
  x-vercel-protection-bypass but no signature -> app401 Invalid signature;
  bypass + valid HMAC on ignored fictional staging_probe -> app200 ignored.
  This proves the bypass/HMAC access path works, NOT real post-call persistence.
- Supabase URL was read back from Vercel env and equals ONLY
  https://wnajobvcldveajtdvbwg.supabase.co. Staging public key configured.
  SUPABASE_SERVICE_ROLE_KEY is still ABSENT (local and Vercel); no claim of
  working privileged database connectivity, test Auth accounts or sync success.
- A temporary local random ELEVENLABS_WEBHOOK_SECRET was generated for HMAC
  transport testing and set only on this staging project. It does NOT yet match
  a provider-created ElevenLabs webhook secret. Replace it with that webhook's
  actual signing secret before real provider testing and redeploy staging.
- Configure ElevenLabs request_headers with x-vercel-protection-bypass using
  the saved local bypass value. Header configuration may require ElevenLabs API;
  do not assume the Dashboard exposes custom headers. A Vercel browser login
  or this endpoint URL alone cannot authenticate ElevenLabs deliveries.

Immediate blockers remaining: staging server key via local ignored file,
provision the test admin/merchant Auth users, dedicated ElevenLabs agent IDs,
provider signing secret and automation-bypass header configuration, then approved
staging env update/redeployment and first actual fictional post-call test.
No product-code changes or repeated full audits were introduced for deployment.

## Staging integration execution — credentials supplied, hosted synthetic E2E passes

User supplied the provider signing secret and staging server key in local ignored
.env.staging.local. Values were transferred only into dedicated Vercel staging
project encrypted env; no secret values were printed or committed.

- Provisioned 1 test Super Admin and 2 fictional merchant Auth accounts using
  supported Supabase Auth Admin API. Passwords stay only in ignored
  data/staging-test-accounts.json. Supabase password login and A/B row isolation
  passed. No emails sent (test accounts created confirmed).
- Redeployed same cf09b4c to dpl_nEHcenaPvtQfgtoc7tnA1S53s1yX, READY.
  New immutable URL: https://orai-pr4-staging-bz4cxvaxd-ronho1414.vercel.app
  Canonical https://orai-pr4-staging.vercel.app now explicitly aliases this new
  deployment, not the previous missing-server-key build. Commit alias remains
  https://orai-pr4-staging-git-cf09b4c-ronho1414.vercel.app .
- Both staging Supabase public URL/key and server key configured in dedicated
  staging project's environments; data writes confirmed in wnajobvcldveajtdvbwg.
- Fixed LOCAL-only missing bypass entry after local env editing (restored the
  already-configured bypass, did not disable protection or create broad rules).
- Hosted synthetic post_call_transcription: invalid HMAC401, valid200 synced,
  duplicate200 synced, exactly1 Supabase row with2 speaker turns and30s duration.
  Supplied forged tenant B dynamic variables did not affect tenant A ownership.
  Retained fictional fixture ID staging_d9ca306fd33e43f4a2b81777cc07fb6c for review.
- Website API login works for admin/A/B. Admin organization API200; A sees its
  fixture, B cannot see it. Logout revokes old merchant cookies (replay401),
  relogin preserves correct visibility and persisted data. All sessions used by
  the main test were signed out afterward.
- Rechecked protection on new canonical deployment: no bypass401 protected,
  bypass without signature401 Invalid signature, bypass+valid HMAC200 ignored.
  These checks use synthetic ignored events, not an ElevenLabs-delivered call.
- Tenant A temporarily uses fictional provider ID staging_transport_probe_A
  for the synthetic test. Replace live mapping with the actual new A staging
  Agent ID when supplied; old fictional ID stays reserved to tenant A by design.
  Tenant B's provider ID remains blank. No real provider agent IDs reused.

Still pending: actual ElevenLabs staging Agent ID A (B optional until second
lane), provider webhook configured with clean endpoint plus
x-vercel-protection-bypass header, a real fictional conversation and observed
provider delivery. The user-supplied signing secret has been deployed, but its
match to provider configuration is not proven until that delivery. Interactive
browser UI remains unverified; dashboard APIs were tested, not rendered UI.

Independent hosted verification passed (target wnajobvcldveajtdvbwg, deployed
cf09b4c): retained synthetic fixture exactly1 row,2 turns,30s. A website login200
and conversations200 sees fixture once; B login200/list200 does not see it.
Revoked cookies401 for both. Protection bypass works. Independent pass created
no product rows and revoked its own test sessions. Interactive browser UI and
actual ElevenLabs-originated conversation remain unverified.

## Real staging Agent A mapping (2026-11-24)

User supplied Agent A URL; extracted provider ID
agent_7801m86m0v65fxw9n0twtx4ex54v (branch UI reference
agtbrch_4401m86m0wdsfgp9rk4fq045nbe2 is not part of agent_id).
Updated ONLY staging wnajobvcldveajtdvbwg merchant staging-salon-a draft/probe
mapping to this supplied Agent A ID, status active. Ownership registry reserves
it for tenant A. Existing synthetic probe ID remains reserved to A.

Staging webhook signing secret and automation bypass are present locally;
ELEVENLABS_API_KEY is absent from staging config, so provider agent settings,
webhook selection and request_headers cannot yet be read/configured via API.
No API key or webhook secret was requested in chat. Need provider-side staging
webhook bound to this agent and x-vercel-protection-bypass configured before a
real call, or a staging-scoped API key in ignored local config to complete that
setup. Mapping success is NOT proof of provider-originated webhook delivery.

Staging Agent B supplied and bound to staging-salon-b:
agent_0501m86m1znrf7sbmedzj8yxvfy1. Read-back confirms A/B have distinct active
provider IDs and both immutable registry owners match their own staging tenant.
Production unchanged. Provider configuration and real call delivery still pending.

## ElevenLabs API configuration attempt — actual permission blocker

Local staging ELEVENLABS_API_KEY is now present. Read-only GET for both supplied
Agent IDs returned401 missing_permissions; provider explicitly reports missing
convai_read. Workspace webhook listing succeeds, but creating a dedicated
staging webhook returns401 missing_permissions. No webhook was created/changed,
no provider secret rotated, no Agent settings or workspace defaults were modified.

Existing workspace webhook named ORAI Staging Webhook (22b0b02983704e80a3487364f1a561fd)
points to the OLD ai-voice-agent-git-review-supabase-auth-audit-ronho1414.vercel.app
endpoint, not orai-pr4-staging.vercel.app, with no active usages in returned list.
Do not treat that callback as the new staging integration or change production
workspace defaults. Need an API key with Agents read/write and workspace webhook
create/update permission (convai_read was directly confirmed missing), restricted
to staging resources where possible. Do not enable unrelated billing/deletion
permissions or paste credentials into chat. Once fixed, continue dedicated
webhook creation with bypass header, update its provider-generated signing secret
in staging only, attach it to the two test agents, then perform a fictional call.

## ElevenLabs permissions repaired and staging webhook configured

Retry succeeded: specified Agent A/B reads now return200. Created dedicated
ORAI PR4 Isolated Staging webhook f1da4e614ddb4542b687fb5ee3666532 at the correct
https://orai-pr4-staging.vercel.app/api/webhooks/elevenlabs endpoint, HMAC auth,
staging automation bypass request header and retries enabled. Existing old
ORAI Staging Webhook and workspace-wide defaults were left unchanged.

Updated ONLY the supplied staging branches:
A agtbrch_4401m86m0wdsfgp9rk4fq045nbe2;
B agtbrch_3801m86m20k5e8qvf3e35r6xg88g.
Read-back confirms each overrides post_call_webhook_id to the dedicated staging
webhook, events=[transcript], JSON full transcript, send_audio=false. Both had
no assigned phone/WhatsApp channels. Disabled provider audio recording and set
7-day retention for these agents, apply_to_existing_conversations=false. No
existing conversation data deleted. Fictional data only; PII redaction still
not enabled and does not qualify this environment for real customers.

New provider-generated webhook secret was saved only to ignored staging env
and encrypted Vercel staging env, replacing the older secret. Deployment
 dpl_Bd9tKqLHMa96EFAskbZ4He2szvbt is building the same cf09b4c in the dedicated
staging project to activate it. Wait for READY before testing actual provider
post-call delivery. No Production project, other agent or global setting changed.

Staging secret activation deployment dpl_Bd9tKqLHMa96EFAskbZ4He2szvbt reached
READY; canonical https://orai-pr4-staging.vercel.app points to it. Official
ElevenLabs Send Test Webhook Event was invoked ONCE for post_call_transcription:
provider API200, outcome=delivered, endpoint response200 application/json,
failure_origin=null, delivery f47469837e37442e98bd83f8ba6beb8a. This independently
originated provider sample proves request_headers bypass + actual provider HMAC
secret alignment. It is NOT a real conversation or proof of merchant call data.
Next required human action: run Agent A Test Agent with fictional speech, end
call, wait for analysis, then verify that provider conversation ID in staging A
only. No billable automated conversation or simulation was initiated.

## FIRST REAL ELEVENLABS STAGING CONVERSATION SYNCHRONIZED

Conversation conv_0901m872wz6me4pbqq2ecdwc89nk completed by the user on Agent A
agent_7801m86m0v65fxw9n0twtx4ex54v and automatically arrived in staging Supabase
wnajobvcldveajtdvbwg. No manual ingestion/backfill was performed for this call.

Verified against provider Get Conversation and deployed customer APIs:
- Provider status done; tenant staging-salon-a; channel web; duration82 seconds.
- 13 ordered transcript turns, including speaker roles/times; exact normalized
  transcript comparison to provider PASS, exact summary comparison PASS.
- Exactly1 stored provider conversation row; summary present.
- Provider has_audio=false. No recording fetched or stored by Orai.
- A deployed password login200 + conversations API200 sees the call exactly once
  with transcript/summary. B deployed login200 + API200 sees zero matching calls.
- Both test sessions logged out200. No conversation content, caller information,
  credentials or cookies printed during checks; output contained only safe metadata.

This is a REAL provider conversation, unlike earlier synthetic POST/test delivery.
The first-conversation sync objective is achieved. Browser-rendered dashboard UI
is still not independently exercised; API delivery to the existing dashboard is
verified. Existing privacy restrictions remain: fictional-only staging,7-day
provider retention, no audio; production rollout/deletion automation still needs
its own approval and completion. No production project/database changed and no
main merge. Independent focused verification is running; no repeat full audit.

Independent focused real-call verification PASSED (exit0): exact single persisted
row for conv_0901m872wz6me4pbqq2ecdwc89nk;82s/13turns/web; provider transcript and
summary match; has_audio=false; deployed A login/list/logout200 sees1 call and
B login/list/logout200 sees0. Only test Auth sessions created/revoked, no product
writes. Interactive browser rendering and complete PII redaction remain unverified;
this pass compares provider conversation data and deployed APIs, not a separate
webhook delivery-log trace. No further audit/feature development required for
this milestone. Production rollout remains unapproved.

## Managed AI preferences and change requests — implementation (2026-11-24)

Branch: `codex/managed-agent-requests`, stacked on unmerged PR #4
(`codex/elevenlabs-post-call`, base412a3f6). This entry supersedes earlier claims
that customers can edit AI instructions. No hosted migration or deployment has
been performed for this feature. Existing staging continues running the previous
version. Vercel git deployments are disabled for this feature branch.

### Implemented

- `/dashboard` → 我的 AI 專員: safe agent summary with unknown status/voice/hours
  explicitly awaiting confirmation; no provider ID, prompt editor or security
  claims. Voice/service preferences, dynamic Cantonese style examples,300-character
  greeting and2,000-character service notes. Active values shown separately from
  drafts; confirmation, duplicate guards, real API error/success states and history.
- `/admin` → 調整要求: persistent pending count, four summary counts, merchant-name
  search, status filter, date sort,20-row pagination, overdue indicator, assigned
  administrator and update times. Detail shows active/requested/snapshot/final
  settings, audit events, private notes, customer response and manual workflow.
- Customer admins submit/cancel pending/respond to requests for information.
  Super Admin starts, requests information, rejects with reasons or completes.
  Completion requires explicit manual provider update/test confirmation and final
  preferences. No ElevenLabs configuration API calls or prompt injection path.
- Both dashboards have persistent per-user notifications, unread totals, individual
  and all-read actions, request navigation and15-second background refresh.
- Legacy `agents.config.customer_instructions` retained, accessible to trusted
  administrative code only. Authenticated Data API column grants now exclude
  `agents.config` and `elevenlabs_agent_id`; admin server APIs use service role.

### Database and authorization

Migration: `supabase/migrations/20261124160158_managed_agent_requests.sql`.
Creates `agent_preferences`, `agent_change_requests`,
`agent_change_request_events`, `agent_change_request_internal_notes` and
`notifications`, with tenant FKs, enum/text constraints, indexes and read RLS.
Active settings begin unknown rather than inventing deployed settings; future
curated voice catalogue identifier reserved without implementing audio previews.
Current MVP chooses one primary agent per tenant deterministically (created_at,id).
An explicit agent selector would need a separate multi-agent product decision.

`managed_agent_command` is SECURITY INVOKER and executable only by service_role.
Next.js validates Supabase Auth/session/origin and derives actor/tenant before
calling it; the function rechecks database roles and active admin membership.
Authenticated users cannot directly mutate these tables or invoke this RPC.
Internal notes have a separate Super Admin-only policy and never enter public
history/events/customer responses.

Per-tenant preference locks serialize submissions/completions. Idempotency keys
bind to the original payload and version; identical open requests rejected.
Request optimistic versions prevent stale actions. Final activation, completion,
audit event and notifications share one transaction. Stale preference snapshots
require explicit administrator review; reviewed active version is compared under
lock to prevent overwriting another administrator's newer activation.

### Configuration and limitations

- Reuses existing server-only SUPABASE_SERVICE_ROLE_KEY and existing public
  Supabase Auth environment variables. No new secrets/provider costs.
- Migration must be reviewed and approved separately before applying to isolated
  staging, after PR #4 migrations. Do not execute against production.
- No configured email provider or scheduling mechanism found in repository.
  `lib/platform/change-request-email.ts` provides an explicit not-configured adapter;
  EMAIL DELIVERY IS NOT IMPLEMENTED. No external paid service introduced.
- Overdue requests show indicators after24h. Scheduled one-time overdue admin
  notifications require an approved scheduler (deduplicate by request/reminder key);
  no claim of background scheduled delivery in this release.
- Preferences describe human service requests; they never execute as prompts.
  Actual provider changes/tests remain manual and must precede completion.
- DB constraints/RLS exercised with local PGlite Postgres and fictional users.
  Mocked API transport tests are not evidence of hosted Auth or persistence.
  Hosted migration, browser acceptance and notification refresh across real
  concurrent sessions remain NOT VERIFIED until approved staging rollout.

### Manual staging acceptance checklist (requires separate approval)

1. Review stacked PR dependency and database backup/rollback strategy. Apply this
   additive migration only to isolated staging; keep production untouched.
2. Verify service_role-only RPC grants and customer agent column restrictions.
   Sign in as fictional Super Admin, merchant A/B and a read-only role.
3. A changes preferences/notes: cancel confirmation, confirm once, double-click,
   retry same delivery, refresh/re-login; verify exactly one persisted request,
   unchanged active preferences, real history and recipient-specific notifications.
4. B cannot list/read/cancel/respond to A's request or mark A's notifications.
   Read-only roles cannot submit/cancel/process. Customer cannot submit status,
   tenant, actor, internal note or final-setting fields via forged requests.
5. Admin starts, requests info (reason required), A responds; admin private notes
   invisible in customer JSON and direct authenticated Data API queries.
6. Manually update/test the isolated ElevenLabs agent. Review final values and
   explicit confirmation; complete and check active preferences/request/audit/
   notifications persisted together after refresh/re-login.
7. Open two requests on the same snapshot; complete one, ensure the older needs
   explicit review. Simultaneous admins must receive409 for outdated versions.
8. Reject with reason and cancel a pending request; preserve all history. Mark
   notifications read/all-read; verify15s refresh and persistence in another session.
9. Exercise desktop/mobile dialogs, keyboard focus, errors/loading/empty states.
   Verify previous real-call transcript and appointment workflows still work.
10. Configure an email provider/scheduler separately only if approved; until then
    validate in-app notifications and overdue indicators without claiming email.

### Independent verification result

Independent orai-test-runner completed against this feature working tree:

- PASSED: security31/31, webhook5/5, booking8/8 and managed-agent14/14
  (58 tests total). Managed-agent tests cover local SQL/RLS persistence,
  authorization, malformed payloads, duplicate/unchanged requests, cancellation,
  information/rejection transitions, private notes, per-recipient read state,
  stale request/reviewed-active versions and atomic rollback if notifications fail.
- PASSED: typecheck, lint (0 errors;9 pre-existing warnings in unrelated voice/
  widget files), production build and git diff whitespace check. A transient
  Windows EPERM during a build rerun resolved on retry; final build exit0.
- PASSED: independent owned production-server HTTP smoke, both localhost and
  127.0.0.1: /, /beauty, /dashboard, /admin returned200. New authenticated APIs
  returned401 without login; same-origin request POST401; foreign/missing origin
  POST403; retired customer agent PATCH405. Own smoke server was stopped.
- FAILED: no remaining automated check failures.
- NOT VERIFIED: authenticated interactive browser UI, real hosted persistence and
  cross-tenant workflow for this new migration, multi-session15s browser refresh,
  actual manual ElevenLabs configuration changes, email/scheduled delivery.
  Hosted migration/deployment remains intentionally unperformed and requires
  approval. Existing webhook/auth/booking regression tests passed; this feature
  did not re-run a billable live provider conversation.

No secrets or local data/config were staged. Unrelated .codex files preserved.
No merge, hosted migration, production data change, deployment or added cost.

## PR #5 Bugbot follow-up — 2026-11-25

Scope limited to the two unresolved findings on d4b678e. The branch remains
`codex/managed-agent-requests`, stacked on PR #4 (`codex/elevenlabs-post-call`).

- Submit RPC now marks replayed results explicitly on both idempotency lookup
  paths. Replays retain the original row/current status and perform no request,
  preference, event or notification writes. API returns200 for replay,201 only
  for a new pending request; private RPC metadata is mapped to a public replay flag.
- Customer feedback uses the persisted status rather than always claiming a new
  pending request. Terminal replay keeps the draft, refreshes the active baseline,
  displays the original request, and rotates the idempotency key. An intentional
  new request requires another explicit confirmation. Unknown/network failures
  preserve the original key for safe retry.
- Empty/whitespace-only admin messages no longer clear the last non-empty
  customer-visible response. New non-empty responses replace the summary field;
  every transition and each prior response remain in customer-readable audit events.
- Regression tests cover all three terminal statuses, side-effect-free retries,
  fresh-key intentional resubmission, replay HTTP/feedback for all six statuses,
  and repeated information/start/complete transitions with full response history.

The existing UNAPPLIED managed-agent migration is amended; it has not been applied
to hosted staging or production. No changes to ElevenLabs ingestion or existing
hosted staging, RLS grants, automatic deployment settings or PR dependency.

Independent verification PASSED: security31/31, webhook5/5, booking8/8,
managed-agent17/17 (61 total). Typecheck, lint (0 errors,9 existing unrelated
warnings), production build and diff check passed. Initial missing PGlite test
result types were fixed without weakening assertions; final rerun passed. Build
initially hit Windows EPERM; approved elevated retry passed exit0.

Independent production-server smoke passed on both localhost and127.0.0.1:
/, /beauty, /dashboard and /admin200; protected GET APIs401; same-origin POST401,
foreign/missing-origin POST403; retired agent PATCH405. Owned server stopped.

FAILED: no remaining verification failures. NOT VERIFIED: authenticated browser
interaction and hosted persistence for this unapproved migration. SQL tests use
local PGlite and API transport is mocked, not proof of real Supabase sessions.
No hosted migration, deployment, merge or production data change was performed.
Existing real ElevenLabs staging integration was preserved and not reconfigured.

## PR #5 isolated staging deployment and acceptance — 2026-11-25

User explicitly approved this staging migration/deployment. No new paid resources
or paid features were created. Existing project resources were reused:

- Supabase: `wnajobvcldveajtdvbwg` (`orai-pr4-staging`).
- Vercel project: `prj_jFozNUtpm9Ak2b4aDXOoXV3lS2Y0` (`orai-pr4-staging`).
- Deployment: `dpl_5JMdKR8YL8bHwgFCzUyLhDVsi1dy`, READY, exact source
  `912bad8e24afd0307a0bb7bf9e9d0f11a08a8111`.
- Stable staging URL: https://orai-pr4-staging.vercel.app
- Deployment URL: https://orai-pr4-staging-9trowjhxt-ronho1414.vercel.app
- Existing webhook remains https://orai-pr4-staging.vercel.app/api/webhooks/elevenlabs
  with its existing configured protection access and signing secret unchanged.

Vercel calls this dedicated project's default target `production`; that is the
ISOLATED STAGING PROJECT's stable domain, not the separate Orai production project.
No request targeted the Orai production project/database. Both PRs remain unmerged.
No agent mapping, ElevenLabs setting, webhook secret or Deployment Protection
setting was changed. Feature branch automatic deployments remain disabled.

### Migration and rollback readiness

All seven dependency migrations were present. Source migration
`20261124160158_managed_agent_requests.sql` was applied successfully. Its SHA256 is
`b4be2226ef234822ff7b486197a58a7c1078f4328753d6fea19a6b595e0536cd`.
MCP records it as `20261124164911 / managed_agent_requests` (server-generated
migration timestamp; do not blindly reapply the local file using CLI db push).

Before applying, a gitignored scoped snapshot captured the nine existing public
business tables, agent ownership mappings, helper definitions and agents ACL at
`data/pr5-pre-migration-backup.json`. Counts:2 organizations,3 profiles,2 agents,
5 conversations,0 appointments. Snapshot is a local scoped backup, NOT a tested
full PITR restore or Auth backup; no paid backup product was enabled.

Rollback plan: retain additive tables/audit data, restore the prior STAGING app
`dpl_Bd9tKqLHMa96EFAskbZ4He2szvbt` (cf09b4c), then diagnose/roll forward. Do not
reset the DB or drop collected requests. Any destructive schema reversal requires
separate review/approval and export of new data. No rollback was needed/performed.

After migration: all5new tables have RLS; authenticated users cannot INSERT or
UPDATE them; RPC is executable only by service_role (anon/authenticated denied).
Authenticated reads cannot access agents.config or provider agent IDs.

### Actual hosted API and database acceptance — PASSED

- Real existing fictional A/B/Super Admin password login; A request persists
  after logout/re-login and exact stored data agrees with deployed APIs.
- Submit201, retry200/same ID, unchanged/forged-tenant validation rejected.
  Active preferences unchanged through submission/information/processing; only
  completion updates active preferences/version and final applied snapshot.
- Information request/customer reply/private admin notes/completion flow; missing
  confirmation rejected, cancelled/rejected/completed replay preserves real status.
- Per-recipient notifications/unread counts, individual read and all-read persist;
  B cannot mark A's notification read. Real pending summary counts verified.
- B receives404 for A detail and cannot cancel/process A requests. Direct
  authenticated Data API returns zero foreign requests/preferences/events/
  notifications; customer notes remain hidden; direct mutation RPC denied.
- Original5conversations retained. The real82s/13turn ElevenLabs conversation
  `conv_0901m872wz6me4pbqq2ecdwc89nk` remains visible to A and hidden from B.
- Fictional appointment `b2a6612c-3213-4883-8ec8-e13809337259` created for this
  acceptance, listed/updated to confirmed and persisted; B cannot read/update it.
- Webhook route accepts existing automation protection access and rejects an
  unsigned request401. No new billable provider conversation was initiated.

### Actual browser acceptance — PASSED

Built-in browser/node REPL failed to initialize (kernel assets path missing).
Temporary Playwright1.65.1 + installed Edge headless successfully verified the
real deployed UI instead. No dependency/package-lock/product code was changed;
protection header was scoped only to the staging origin and not printed.

- Separate A/B/admin browser sessions, real login and dashboard navigation.
- Customer confirmation back/cancel, real form submission, cancellation and
  request history after browser reload.
- Admin list/sidebar pending badge and notification bell/unread/read-all actions.
  Background polling observed at15,002ms without a full reload.
- Full browser sequence on REQ-000005: admin starts, requests information,
  customer replies, admin resumes, reviews completion modal, checks confirmation
  and completes; customer final values auto-refresh and persist after reload.
- Completion button disabled before confirmation. Desktop and390px mobile render
  checked, mobile has no horizontal overflow; screenshots stored locally ignored.

Completion confirmation in these fictional staging fixtures is a QA INPUT ONLY.
It verifies the Orai workflow and transaction; it is NOT evidence that someone
actually updated or tested the ElevenLabs provider. Agent rows/provider config
remain exactly equal to the pre-migration snapshot. Actual provider updates are
outside this acceptance and were not performed.

Final stored requests: REQ-000001 completed; REQ-000002 cancelled;
REQ-000003 rejected; REQ-000004 cancelled; REQ-000005 completed. Active version2
matches the latest completed final preferences. All request history is retained.

### Independent gate and limitations

Independent orai-test-runner separately verified hosted Auth/API/DB consistency,
A/B API and RLS isolation, private note confidentiality, service-only RPC grants,
persistent notification state, unchanged agent/provider config and old real call,
and confirmed appointment ownership/status. Its test sessions were logged out.

PASSED: hosted acceptance above. FAILED: no remaining product failures. A test
harness initially used global logout and another typed into a form before the
prior action settled; corrected harness sequencing/local logout passed on resume.
Product code was not changed to pass these tests.

The61local regression tests/typecheck/lint/build already passed for912bad8 and
were not unnecessarily repeated during this unchanged-code rollout. Vercel build
for912bad8 also completed successfully. Independent hosted verification is new.

NOT VERIFIED: actual ElevenLabs manual configuration/update/test, paid-provider
email delivery, scheduled overdue notification delivery, full backup restoration,
and real-device/Safari/Firefox visual behavior. Email remains unconfigured and
scheduled overdue reminders remain a documented future configuration step.
No production data changes, merge or production deployment were performed.

### Exact manual browser acceptance steps

1. Open https://orai-pr4-staging.vercel.app/dashboard . If Vercel Authentication
   appears, sign in with the existing authorized Vercel account. Do not disable
   Deployment Protection or paste bypass secrets into URLs/screenshots.
2. Use the existing password for `orai-staging-a@example.test`. Open 我的 AI 專員.
   Check active values, select a different preference and add a clearly fictional
   note. Submit → 返回修改 should save nothing; submit → 確認提交 creates one row.
3. In a separate browser profile open https://orai-pr4-staging.vercel.app/admin
   using `orai-staging-admin@example.test` and its existing password. Open 調整要求.
   Without reload, wait up to20seconds for the new pending row/badge/bell count.
4. Open the row, compare current/requested settings, 開始處理, add a private note,
   enter a customer-visible reason and 要求補充資料. In A, open the notification or
   request, fill 補充資料給 Orai and send. Confirm private notes never appear there.
5. Admin starts again. Blank transition must preserve the previous Orai reply.
   Before a REAL service change is marked complete, manually update/test the
   isolated ElevenLabs agent yourself; only then confirm the manual-update box.
   This rollout's existing completed QA rows do not prove that provider step.
   Review final settings and 完成並套用; A should update without reload and retain
   the completed request, response, timestamp and final preferences after login.
6. Submit a separate fictional request and 取消此要求 while pending; refresh and
   confirm history remains cancelled. Test another with admin rejection/reason.
7. Open the bell: mark one/all read, refresh/re-login and verify read state persists.
8. In another profile use `orai-staging-b@example.test` and its existing password.
   A's request rows, notification references and conversations must not appear.
9. In A open 通話紀錄 for the original real call, then 預約管理 to see the confirmed
   FICTIONAL PR5 QA appointment. Repeat at mobile width; no real customer data.

Passwords/bypass/signing secrets are not included here. All backup, credentials,
test scripts, browser artifacts and result JSON remain gitignored under data/.

## PR #5 stale-version recovery — 2026-11-25

Bugbot issue: terminal replay retained the draft but a failed one-shot refresh or
later admin completion left its base_version stale, with no safe in-app recovery.
Fix commit: `7eb458833019cc33ced1ec276e0ed18b0ecc7206`.

- Customer draft now owns distinct baseline/latest snapshots. Background polling
  preserves unsaved preferences and notes, flags changed versions and closes an
  outdated confirmation instead of silently rebasing/submitting.
- Typed HTTP409 errors trigger an in-app review panel. Failed refresh keeps the
  draft and blocks confirmation until a successful fresh fetch. Subsequent polls
  or the retry button can recover without navigating/reloading.
- Review shows the latest active values and a highlighted submission preview.
  Explicit review carries only customer-edited fields onto the latest snapshot;
  untouched fields adopt current active values. Overlapping edits stay visible.
  Review checks the exact rendered version; another update requires re-review.
- Terminal replay always enters this review flow. Confirmation allocates a fresh
  idempotency key after review; unknown/network errors preserve the exact original
  key/payload. No automatic re-POST or active setting update is performed.
- Refresh epochs reject requests started before terminal/conflict/acceptance,
  including old failures; lower-version responses cannot undo a newer snapshot.
- SQL/RLS/idempotency validation remain unchanged. No new migration is needed.

Independent verification PASSED: security31, webhook5, booking8, managed-agent23
(67 tests total), typecheck, lint (0 errors/9 existing warnings), production build
and local HTTP smoke. Six new regressions cover concurrent completions, failed
refresh after terminal replay,409 recovery with another update, frozen retry
payload/key, typed409 errors, and late pre-terminal refreshes. Initial epoch test
fixture errors and an owned temporary helper lint failure were corrected without
weakening assertions/rules.

Staging regression PASSED on deployment
`dpl_CodSb5bV11hQegyRodVbeqYPUuQk` (READY), exact7eb4588 source, existing
isolated project/domain https://orai-pr4-staging.vercel.app/dashboard . Previous
working deployment dpl_5JMdKR8YL8bHwgFCzUyLhDVsi1dy remains the rollback target.
No new migration, paid resource or protection/secret setting was changed.

Real deployed Edge headless test used fictional A/admin accounts and selectively
injected transport failures (not fake persistence). It actually created/cancelled
REQ-000007, replayed the same payload/key against its real terminal row, then
blocked the refresh. The UI retained greeting/notes and blocked review until a
fresh fetch succeeded. A real concurrent admin completion of REQ-000008 advanced
active version2→3 while the customer held an older confirmation. The next real
POST returned409; the UI preserved the draft, fetched current settings, displayed
the comparison and required explicit review and another confirmation. REQ-000009
then persisted with base_version3, a new idempotency key, the customer's greeting/
notes and the newer untouched speaking-speed value. It was cancelled after the
check to avoid leaving an open QA request. No full page reload was used.

A final hosted SQL read confirmed these states/versions and active version3.
Agent/provider configuration still exactly equals the pre-migration snapshot.
The concurrent-completion confirmation was clearly marked fictional QA only;
no actual ElevenLabs update/provider test was claimed or performed.

PASSED: independent67test/type/lint/build/HTTP gate;3deployed browser regression
scenarios and actual persisted rows. FAILED: no unresolved failures. NOT VERIFIED:
real provider manual updates, email/scheduler delivery and full backup restoration
remain outside scope. Earlier staging tests already verified tenant RLS, original
conversations and appointment management; unchanged infrastructure was not audited
again. Both PRs remain unmerged, production untouched.

Customer recovery: select「重新取得最新設定」if refresh failed, inspect「最新生效設定」
and「保留修改後的提交預覽」, select「已覆核，保留我的修改」, then「提交調整要求」and
「確認提交」. If an administrator updates again, repeat review; never reload to
recover a draft. Unknown submission/transport errors keep the original retry key.

## Dashboard preference simplification — 2026-11-25

User removed voice character, speaking speed, response detail and preferred reply
language from both dashboards. Shared edit forms, read-only snapshots/current/
requested/final comparisons, conflict review and request summary/counts now show
only voice gender, response style and greeting (plus the existing request notes).
Changed selections, greetings and comparison values use green text/light green
backgrounds; unchanged values retain their normal style.

Historical JSON/schema are preserved; no migration is needed. When completing
old requests, hidden legacy values are carried from the latest active snapshot
instead of silently applying invisible historical requested values. Existing
optimistic-version checks still protect the completion transaction.

Independent verification: managed-agent23/23, typecheck and temporary SSR checks
passed. SSR confirms exactly3kept fields, no4retired labels/controls, green changed
values and normal unchanged values; hidden active values survive historical
request completion projection. Final lint/build/staging results recorded below.

Independent final result: managed-agent23/23, typecheck/lint/build and local HTTP
checks passed (lint0errors/9pre-existing warnings). Unrelated security/webhook/
booking suites were not repeated for this UI-only change. Staging code revision:
89f393c; deployment dpl_Bp9eQxTLpWyBkgKv7rYqc78tTutZ READY at
https://orai-pr4-staging.vercel.app . Real Edge headless acceptance passed on
customer and admin: retired fields absent,3retained fields rendered, changed
selection/comparison values green. Desktop screenshot visually inspected.
No product data was submitted during this browser check; test sessions logged out.
FAILED: none. NOT VERIFIED: physical mobile-device visual behavior in this pass.
No migration, provider configuration, production deployment or PR merge.
