# AI Voice Agent

VoicePilot AI（領聲智導）marketing site with a trilingual voice agent (Cantonese, Mandarin, English). The spec is in `SPEC.md`.

The company shell is `app/page.tsx`. Voice behavior lives in `components/voice-widget/` and `lib/voice-engine/`. The page passes the knowledge base path, site map, voice id, and clip files into the widget.

A short opener plays from memory while the answer is generated, then the spoken reply starts as soon as that opener ends.

## Develop

```bash
npm install
npm run dev
```

Keys live in the environment: `DEEPGRAM_API_KEY`, `JEV_API_KEY`, `OPENROUTER_API_KEY`, and `ELEVENLABS_API_KEY`. Names are listed in `.env.example`.

```bash
npm run lint
npm run typecheck
```

## Platform authentication and tenant isolation

Sprint 1.1 data-integrity guards cover both legacy and platform stores: a
production database configuration/query failure cannot fall back to local JSON
or memory, a failed write cannot report local success, and failed conversation
statistics cannot return a fabricated zero. Dashboards surface failed data
requests and show a dash before overview data is available. This does not turn
manually inserted test rows in a database into real business activity: keep
`test-org` and other fictional fixtures in the designated test project, and use
a separate clean production database when launching real merchants.

Both `/admin` and `/dashboard` now require a Supabase Auth email and password.
The former merchant-slug login, shared `ADMIN_PASSWORD`, `vp_admin` cookie,
and signed `orai_auth_session` cookie are not accepted. Existing users must log
in again after this change. `SESSION_SECRET` is not used by the new auth flow.

Configure `NEXT_PUBLIC_SUPABASE_URL` and either
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or the existing
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Privileged administrative data operations also
require the server-only `SUPABASE_SERVICE_ROLE_KEY`. Never expose that key to a
browser. Production platform operations fail when database configuration is
missing; local JSON files are not production storage.

Apply the migrations in this order to a staging Supabase project before
deploying the application:

1. `supabase/migrations/001_multi_tenant_foundation.sql`
2. `supabase/migrations/002_rls_write_hardening.sql`
3. `supabase/migrations/20261123105304_auth_tenant_isolation.sql`

The last migration replaces the platform policies and grants, disables profile
creation/deletion and role updates through the user Data API, and restricts
customer writes to safe columns. Authorization checks the current Auth session,
database role, active membership and active organization on every API request.
The Supabase SSR cookie adapter refreshes tokens and writes HttpOnly cookies on
API responses. Mutations require an Origin matching the application's origin.
No access or refresh tokens are returned in response JSON.

Provision accounts through trusted administration (Supabase Dashboard / a
server-side provisioning process), never through customer-editable metadata:

1. Create the Auth user using their verified email.
2. Create a `profiles` row whose `id` is exactly that `auth.users.id`.
3. For Orai staff, set `profiles.system_role = 'super_admin'` through trusted SQL
   or the service role. For merchants, keep `system_role = 'user'` and create an
   active `organization_members` row with `role = 'customer_admin'`.
4. Ensure the merchant organization has `status = 'active'`.

There is no public role assignment or automatic user creation in this release.
A user with several memberships currently enters their earliest active merchant
membership; a tenant switcher is deferred. Internal admins use `/admin` and
cannot silently assume a customer identity through `/api/platform/customer/*`.

The profile Auth foreign key and the appointment/conversation tenant foreign key
are initially `NOT VALID` to preserve old rows while enforcing new writes. Before
production, reconcile legacy profiles and cross-tenant appointment references,
then validate both constraints. Do not assign old profiles to Auth users by
guessing identities. Check for unresolved rows with read-only SQL:

```sql
select p.id from public.profiles p
left join auth.users u on u.id = p.id where u.id is null;

select a.id from public.appointments a
join public.conversations c on c.id = a.conversation_id
where a.organization_id <> c.organization_id;
```

The public voice demo now uses published company Markdown only. Private uploaded
merchant knowledge remains behind authenticated admin/customer APIs until the
tenant voice integration is implemented. Legacy admin APIs share the new auth;
the unused `AdminConsole` password-only login should not be re-enabled.

Run the security checks without live credentials or a hosted database:

```bash
npm run test:security
npm run typecheck
npm run lint
npm run build
```

The database suite runs migrations against in-memory Postgres (PGlite) with
minimal Supabase Auth tables/functions. It checks both tenants, protected roles,
safe column writes, anonymous access, viewer permissions, session revocation and
same-tenant foreign keys. API tests mock only Supabase HTTP responses to verify
real route handlers, cookies, refresh, logout, CSRF checks and tenant filters.
These checks do not replace staging verification of real Supabase Auth, grants,
private schema configuration and migrations. They do not modify a hosted project.

Dependency audit also reports existing Next.js/PostCSS advisories. A framework
dependency update needs a separate compatibility review before production use;
the authentication package change does not resolve those existing advisories.

## Orai Beauty appointment demonstration

For a persistent local trial on port 3010, run `npm run build` and then
`node scripts/start-local-preview.mjs` with network permission for Supabase.
The launcher copies the verified build (excluding cache) to ignored
`.next-preview/`, starts a hidden detached process, and records its PID/logs in
ignored `data/preview.pid`, `data/preview.stdout.log` and `data/preview.stderr.log`.
Normal checks/builds continue in `.next/` without taking this preview offline.
The launcher refuses to replace a process already listening on port 3010. Stop
only the recorded owned preview before taking a new snapshot; do not overwrite
the snapshot of a running process. Refresh the browser after replacing a build.

Local booking is bound through ignored `.env.local` to existing test merchant
`test-org`. On 2026-11-23, both auth/tenant-isolation and beauty appointment
migrations were applied to the user-approved Supabase test project. Real API
checks confirmed submission, idempotency, tenant isolation and persistence after
fresh login. Browser visual/mobile interaction remains unverified because the
browser tool kernel could not start. The remote test left one clearly fictional
confirmed sample in `test-org`; temporary test accounts/second merchant were
removed. Future environments still require their own migration verification.

Run `npm run dev` and open `/beauty`. The original generated salon image is
`public/beauty/salon-hero.png` (built-in imagegen; prompt: original warm ivory Hong
Kong salon reception with curved travertine desk, oak joinery, arch and natural
light, no logos or text). The page is an original fictional demonstration, not a
real salon. Only enter fictional test contact details.

The public POST `/api/public/beauty/appointments` validates Hong Kong phone
numbers, dates within 90 days and the server-defined treatment catalogue. The
server resolves its merchant from `ORAI_BEAUTY_ORGANIZATION_SLUG` (default:
`orai-beauty`); visitors cannot supply an organization ID. Bind it to an active
test merchant whose Auth user has a matching active customer-admin membership.
No merchant, user or membership is automatically created by the public endpoint.

Before database-backed testing, apply
`supabase/migrations/20261123110214_beauty_appointment_requests.sql` after the
authentication migrations above. It adds the tenant-scoped idempotency key,
payload hash, preferred time window, request source and `rejected` status.
Anonymous database insert/read permissions remain disabled. Booking creation
uses the server-only service role and fails closed if configuration, merchant or
database storage is unavailable; there is no JSON or browser-only success path.

Submitting the same key and payload returns the same receipt without a second
row. A reused key with a changed payload returns 409. The browser stores only a
payload hash and opaque request key in sessionStorage to support retries;
customer contact details are not stored there. The public response includes
only a reference, status and confirmation message. Production publication still
requires a distributed abuse/rate limit (for example a hosting WAF), retention
policy and privacy review. The demo does not send real notifications.

In `/dashboard`, the merchant can confirm or reject pending requests, then
complete or cancel confirmed requests. Terminal requests cannot be reopened.
Updates include an organization filter and the current status to prevent lost
updates. Appointment display uses Hong Kong time. Selecting a time window is
only a preference; no calendar availability is asserted.

Run `npm run test:booking` for validation, real local PostgreSQL persistence,
retry protection, merchant A/B API isolation, status updates, and database restart
plus fresh-login checks. The HTTP bridge mocks the Supabase transport/Auth only;
database operations and all migrations run against disk-backed PGlite. This is
not evidence that a hosted Supabase migration has been applied. Verify the same
flow against an explicitly designated staging project before public deployment.

## Clips

`config/clips-config.json` holds the opener lines and a `voiceSettings` entry per language (`voiceId`, `stability`, `similarity_boost`). The clip script and the live reply both read the voice for that language from this file.

```bash
npm run generate:clips
```

The script writes `public/clips/{intent}_{lang}.mp3`. It tries ElevenLabs `eleven_turbo_v4`, then `eleven_v4_turbo`, then `eleven_flash_v2_5`. It does not run on install or on `npm run dev`.

## Talk

Open the voice panel from **立即語音體驗** (`#open-voice-demo-btn`) or the bottom-right assistant. Speech is transcribed with Deepgram (`nova-3`, then `nova-2`). `/api/fast-decision` and `/api/chat-relay` run together. The opener plays from the preloaded buffer. When a page should open, the widget calls `window.navigateToPage` with `home`, `advantages`, `pricing`, or `about`. A demo booking also passes `{ sectionId: "demo-booking-form" }`. The reply is spoken with ElevenLabs when the opener ends. Clicking the microphone again stops the audio. Guests can also type in the panel.
