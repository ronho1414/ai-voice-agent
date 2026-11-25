# Orai Service — Project Status & Security Review

## Domain Integration PR — 2026-11-25 (unreleased)

- Dedicated `codex/domain-integration` branch is based directly on `main` `a258a51`, without the unmerged PR #4/#5 features, migrations, dependencies or credentials. The original feature checkout and its uncommitted work remain intact.
- Shared validated public origin; official homepage canonical/Open Graph; same-host legacy aliases; robots/sitemap with explicit official-site indexing opt-in; private/demo noindex; configured-origin new embed snippets. Existing embeds retain their script origin and strict CSRF stays unchanged.
- Contact email already uses `info@oraiservice.com`; receipt has not been tested.
- Branch-specific Vercel Git deployment is disabled in `vercel.json` before pushing this PR. No hosted settings, Staging settings, webhooks, credentials, migrations or deployments are changed.
- Independent gate for this main-based branch **passed**: domain 5 + security 27 + booking 8 = **40/40**, typecheck, lint (0 errors / 9 existing warnings), both default-safe and explicit-official-indexing production builds, and `git diff --check`; all exited 0. Sandbox build EPERM was resolved by rerunning the same local build with approved permissions.
- Local HTTP passed on 11 routes: homepage, admin/customer/demo pages, three aliases, robots/sitemap and both embed/widget scripts. Safe default blocks indexing with an empty sitemap; explicit official indexing emits the homepage sitemap/canonical/OG while private/demo pages remain noindex. New/old Host and loopback same-origin checks passed (invalid same-origin input 400, foreign/missing Origin 403); embed OPTIONS returned 204.
- Headless Edge passed same-host legacy alias navigation and private/demo noindex with external provider traffic blocked. Both local preview processes were stopped. Failed/unresolved product checks: none.
- Earlier stacked feature checkout separately passed 76 tests plus build/type/HTTP/Edge. Webhook/managed-agent suites do not exist on this main base and were not imported or claimed as rerun. Hosted Auth, database persistence, email delivery, real ElevenLabs calls and post-deployment acceptance remain **not verified**. No environment files were copied into this worktree.
- Release/configuration/rollback details: [DOMAIN_INTEGRATION.md](./DOMAIN_INTEGRATION.md). Production release and settings require separate approval. Hosted Auth/data persistence, email delivery and real ElevenLabs calls are not verified by these local tests.

**Date:** 2026-11-24  
**Branch:** `review/supabase-auth-audit`  
**Target:** `main`  
**Framework:** Next.js 15.5.29 (React 19, TypeScript, Tailwind CSS)  
**Database & Auth:** Supabase (PostgreSQL 15+, Supabase Auth SSR, RLS)

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

| Migration File | Purpose | Status |
| :--- | :--- | :--- |
| `001_multi_tenant_foundation.sql` | Core schemas (`organizations`, `profiles`, `members`, `agents`, `conversations`, `appointments`, `usage_records`) & initial RLS | Applied |
| `002_rls_write_hardening.sql` | Column-level update grants and customer admin helper functions | Applied |
| `20261123105304_auth_tenant_isolation.sql` | Hardens auth session checks into schema `private`, sets explicit table grants | Applied |
| `20261123110214_beauty_appointment_requests.sql` | Adds appointment request hash, time window, and state transition trigger | Applied |
| `20261123233500_update_appointment_transition.sql` | Permits reversible appointment transitions (`completed` <-> `confirmed`) & adds `appointments_delete` policy | New |

### Security Measures & Defense-in-Depth
1. **Private Schema Helpers:** Security definer functions (`current_session_is_active`, `is_super_admin`, `is_customer_admin_for`) are placed in the `private` schema, uncallable by `anon` or public roles.
2. **Column-Level Revocation:** Update permissions on sensitive columns (`system_role`, `organization_id`, `status`) are revoked from `authenticated`.
3. **Same-Origin Mutation Protection:** `isSameOriginMutation` validates request origin against the Host header, mitigating cross-site state-changing requests.

---

## 3. Unfinished Integrations (Out-of-Scope for Current Phase)

The following integrations are intentionally stubbed or scheduled for future phases:
- **ElevenLabs Live Webhook:** Real-time conversational webhook parsing and post-call analytics ingestion.
- **Live Telephony / Twilio Integration:** Inbound/outbound SIP trunks and live Hong Kong phone number binding.
- **WhatsApp Cloud API:** Automated appointment confirmation and reminder messaging.
- **Google Calendar / External CalDAV Sync:** Real-time bi-directional synchronization with salon calendars.
- **Subscription Billing:** Automated Stripe billing periods, tier caps, and overage invoicing.

---

## 4. Known Issues & Operational Setup Requirements

1. **Supabase Cloud Database Trigger Update:**
   - The cloud database (`https://jkzjluyldahlifufoiql.supabase.co`) was initially populated with migration `20261123110214`, which rejected transitions from `completed` back to `confirmed`.
   - **Resolution:** Execute `supabase/migrations/20261123233500_update_appointment_transition.sql` in the Supabase SQL Editor to update `private.enforce_appointment_transition()`.
2. **Production Data Fallback Protection:**
   - In `NODE_ENV=production`, local JSON fallbacks are disabled (`assertLocalAllowed()`). If database credentials are missing or down, the API returns HTTP 503 instead of serving sample or mock data.

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
