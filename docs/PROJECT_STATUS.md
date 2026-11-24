# Orai Service — Project Status & Security Review

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
