# Orai Voice Agent — project instructions

This is Orai Service's shared Next.js backend, public website, Orai Beauty demo,
internal `/admin` dashboard and tenant-scoped `/dashboard` customer portal.
Confirm `package.json` (`ai-voice-agent`), README and the repository remote before
working. Preserve unrelated and pre-existing uncommitted changes.

## Required independent verification before delivery

- After implementation, delegate verification to the independent
  `orai-test-runner` agent defined in `.cursor/agents/orai-test-runner.md`.
  This is an explicit project instruction to use an independent subagent.
- Run it in the background while the implementation agent completes unrelated
  read-only work. Wait for its final results before delivering an implementation.
- Give it the exact workspace, changed areas, relevant existing test commands,
  expected behavior, and current preview/build process ownership.
- Reuse `npm run test:security`, `npm run test:booking`, `npm run typecheck`,
  `npm run lint`, and `npm run build` as appropriate. On Windows use `npm.cmd`.
- The tester verifies independently and does not implement product changes.
  If a check fails, the implementation agent fixes it and sends the change back
  for an independent rerun. Do not weaken assertions or skip failures to pass.
- Do not run builds, dev servers, or type generation concurrently against the
  same `.next` directory. Stop or coordinate owned preview processes first.
- Run feasible local HTTP/browser smoke tests. Never call mocked transport tests
  proof of hosted Supabase persistence, real authentication, or browser behavior.
- Final delivery must state **passed**, **failed**, and **not verified** items,
  with reasons for warnings, blocked checks and remote/browser verification gaps.
  If delegation is unavailable, explicitly record that the independent gate was
  not performed; do not claim it passed.

## Data and release boundaries

Keep secrets in approved environment variables and never print or commit them.
Use fictional customer data. Verify tenant isolation and database roles when
changing auth or tenant operations. Follow the current user's authorization for
remote changes; a local test does not authorize migrations or hosted writes.
Do not commit, push, merge or deploy unless explicitly authorized for that task.
