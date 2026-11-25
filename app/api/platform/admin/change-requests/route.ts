import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireSuperAdmin } from "@/lib/platform/auth";
import { command, listOrDetail, managedFailure, ManagedError, readBody } from "@/lib/platform/managed-agent-service";
export const GET = withPlatformRequest(async request => {
  const session = await requireSuperAdmin(request); if (session instanceof Response) return session;
  try { return Response.json(await listOrDetail(request, session, true)); } catch (e) { return managedFailure(e); }
});
export const PATCH = withPlatformRequest(async request => {
  const session = await requireSuperAdmin(request); if (session instanceof Response) return session;
  try {
    const body = await readBody(request);
    if (typeof body.action !== "string" || !["start", "needs_information", "complete", "reject", "add_note"].includes(body.action)) throw new ManagedError("不允許此操作。");
    return Response.json({ request: await command(session, body.action, body) });
  } catch (e) { return managedFailure(e); }
});
