# Official domain integration — 2026-11-25

## Code prepared locally

- `lib/site.ts` is the shared, validated public origin configuration. Default: `https://oraiservice.com`. It rejects credentials, paths, query strings, fragments and non-HTTPS remote origins. HTTP is allowed for loopback development only.
- `NEXT_PUBLIC_SITE_URL` controls canonical/metadata base, sitemap and newly generated embed snippets. It is public and compiled at build time. It does **not** configure Supabase, credentials, cookies or provider webhooks.
- `NEXT_PUBLIC_SITE_INDEXING=true` explicitly enables indexing only for the official origin and outside Vercel preview/development. All other configurations produce noindex metadata, a disallow-all robots file and an empty sitemap. This matters because the isolated staging project also uses a Vercel **Production deployment target**.
- Homepage has a canonical URL and Open Graph URL. `/pricing`, `/services` and `/booking` retain their existing relative client redirects and canonicalize to the homepage. Marketing tabs are not invented sitemap routes.
- `/admin`, `/dashboard` and the fictional `/beauty` demo are noindex. These directives do not replace authentication or authorization.
- Both old and new website hosts remain accessible. No host-wide redirect is introduced. Old embed scripts still fetch public client configuration from their own script origin using `credentials: omit`; new snippets encode the merchant slug and use the configured public origin.
- Existing API URLs remain relative. Strict same-origin mutation validation and host-only authentication cookies remain unchanged. Users must sign in separately on different domains.
- Public embed GET/OPTIONS CORS remains available to merchant websites; authenticated API CORS is not widened.
- Contact text and `mailto:` already use `info@oraiservice.com`; no replacement was needed.
- No OAuth, password-recovery flow, email provider, webhook switch, hosted configuration change or database migration was added.

## Pending approval: Production release and third-party settings

Nothing below has been applied by this development task.

1. **Release scope.** This dedicated `codex/domain-integration` PR is based directly on `main` `a258a51`; it excludes stacked, unmerged PR #4/#5. Branch-specific Git deployment is disabled in `vercel.json`. Review the domain-only diff/build before separately approving a Production deployment. Keep the current Production deployment available for rollback. The original feature checkout is preserved.
2. **Vercel → ai-voice-agent → Settings → Environment Variables.** For the official Production site set `NEXT_PUBLIC_SITE_URL=https://oraiservice.com` and `NEXT_PUBLIC_SITE_INDEXING=true`, targeted to Production. A rebuild is required. Preserve the current Production credentials and legacy voice-key aliases. Do not pull staging credentials into this project.
3. **Isolated staging project.** Before any separately approved staging deployment of this code, set `NEXT_PUBLIC_SITE_URL=https://orai-pr4-staging.vercel.app` and `NEXT_PUBLIC_SITE_INDEXING=false` there. Preview deployments should keep indexing false and use their intended stable preview origin for generated embeds. These settings have not been changed remotely.
4. **Vercel → Domains.** Keep `oraiservice.com` and `ai-voice-agent-five-tau.vercel.app` attached. Both returned 200 during the earlier read-only audit. No redirect from the old Vercel host is required: canonical consolidates public search URLs without breaking existing links/API calls. `www.oraiservice.com` was not configured; add it in Vercel and use the exact DNS record Vercel supplies in Cloudflare only if the owner wants a `www` alias. Do not guess DNS targets.
5. **Supabase → Authentication → URL Configuration.** First identify the actual Production Auth project: the Vercel Production env metadata did not show Supabase variables during the audit. Do not assume the historical test project is wired to Production. With the correct project selected, review the current Site URL and redirect allowlist; propose `https://oraiservice.com` as Site URL and retain valid old-domain entries. Add only redirect destinations supported by implemented flows. Actual hosted Auth URL settings were not accessible through the available connector, and no recovery/callback flow was added here. Do not modify staging Auth URLs as part of this step. OAuth remains outside scope.
6. **ElevenLabs.** Leave both staging webhook registrations, signing secrets and agent bindings unchanged. Do **not** point a webhook at `https://oraiservice.com/api/webhooks/elevenlabs` yet: that Production endpoint returned 404 during the audit, since PR #4 is not released. Production webhook rollout requires separate backend/configuration approval. Existing checked agents had an empty domain allowlist; no allowlist tightening was done. Any future restriction must preserve authorized merchant sites, old/new website hosts and separate staging access.
7. **Email.** In Cloudflare Email Routing, confirm `info@oraiservice.com` forwards to the intended verified mailbox, then manually test receipt. DNS MX/SPF existed, but mailbox routing/receipt was not verified. No outbound email provider was configured or purchased. Review email-template links only after the correct Supabase project and supported recovery flow are established. Do not copy SMTP credentials from staging.
8. **Post-release acceptance.** Check both hosts, homepage canonical/OG, robots/sitemap, existing embed snippets, new generated snippets, independent login on each host, customer/admin access, appointments and the unchanged staging ElevenLabs conversation flow. These are hosted release checks, not claims made by local tests.
9. **Rollback.** Restore the previous Vercel deployment and previous public-origin/indexing variables (rebuild if needed). No DNS/database change is required by this code. Retain both domains and all existing webhook registrations.

## Manual local acceptance

- Run `npm.cmd run test:domain`; it covers origin validation, indexing gates, embed escaping, old/new script-origin compatibility and unchanged strict CSRF behavior.
- With the official public origin and indexing true **in a local build command only**, verify `/` has canonical and `og:url` `https://oraiservice.com/`; `/robots.txt` and `/sitemap.xml` return 200 and list only the indexable homepage.
- Verify `/admin`, `/dashboard` and `/beauty` emit noindex. `/pricing`, `/services` and `/booking` preserve same-host navigation and homepage canonical.
- With indexing false, verify robots disallows `/` and sitemap contains no URLs. With a staging origin, indexing must remain off even if the flag was accidentally true.
- Do not interpret local transport/unit tests as evidence of hosted Auth, tenant data persistence, email delivery or a real ElevenLabs call.

## Verification results

The earlier stacked feature checkout passed 76/76 tests, typecheck, lint (0 errors / 9 existing warnings), default-safe and explicitly indexable local production builds, HTTP metadata/robots/sitemap, new/old Host and CSRF compatibility, and headless Edge alias/noindex checks. This main-based domain-only PR has its own independent gate recorded in `PROJECT_STATUS.md`; PR #4/#5 tests are not present in this base and are not added here. Local checks do not verify hosted Auth/database/email/ElevenLabs acceptance.
