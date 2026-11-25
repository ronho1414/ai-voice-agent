# Orai Voice Agent — AI Handover Guide

Start every session by reading [AGENTS.md](AGENTS.md) and [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Source of Truth
- **Code & Git history** override outdated specs. Ignore legacy mentions of `VoicePilot AI`, shared `ADMIN_PASSWORD`, `site_id`, or production JSON fallbacks in `SPEC.md` and `.cursor/rules/01-pm.mdc`–`05-backend-architect.mdc`.
- Current platform: **Orai Service** (`oraiservice.com`) shared Next.js `15.5.29` backend, Supabase Auth SSR, `organization_id`-scoped PostgreSQL RLS, and fail-closed production database handling (`503` on missing DB config).

## Mandatory Engineering & Verification Rules (`AGENTS.md`)
- Preserve unrelated and pre-existing uncommitted changes (use isolated git worktrees when needed).
- Run independent verification via `.cursor/agents/orai-test-runner.md` (`test:security`, `test:webhooks`, `test:booking`, `test:managed-agent`, `test:domain` when present, `typecheck`, `lint`, `build`, and local HTTP smoke) before delivering any implementation. On Windows use `npm.cmd`.
- Never run builds, dev servers, or typegen concurrently against the same `.next` directory.
- Keep secrets in `.env*.local` / Vercel env only; never print, log, or commit credentials.
- Never claim mocked local/PGlite tests prove hosted Supabase persistence, real Auth, or browser behavior.
- Never commit, push, merge, migrate hosted DBs, or deploy without explicit task authorization.

## Environments & Branch Topology
- **Production (`origin/main`)**: `oraiservice.com` / `ai-voice-agent-five-tau.vercel.app` (includes merged PR #6 domain/SEO; does NOT include PR #4 or PR #5).
- **Isolated Staging**: `orai-pr4-staging.vercel.app` + Supabase `wnajobvcldveajtdvbwg` (fictional test accounts only; PR #4/#5 auto-deploys disabled in `vercel.json`).
- **Stacked Open PRs**: PR #4 (`codex/elevenlabs-post-call` -> `main`) and PR #5 (`codex/managed-agent-requests` -> `codex/elevenlabs-post-call`).
- **Required After Every Task**: Update [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) with exact changes, passed/failed/unverified checks, limitations, and next steps.
