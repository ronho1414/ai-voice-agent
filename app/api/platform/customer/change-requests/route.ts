import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { command, listOrDetail, managedFailure, ManagedError, readBody } from "@/lib/platform/managed-agent-service";
export const GET = withPlatformRequest(async request => {
  const session = await requireCustomerAuth(request); if (session instanceof Response) return session;
  try { return Response.json(await listOrDetail(request, session, false)); } catch (e) { return managedFailure(e); }
});
export const POST = withPlatformRequest(async request => {
  const session = await requireCustomerAuth(request); if (session instanceof Response) return session;
  try { return Response.json({ request: await command(session, "submit", await readBody(request)) }, { status: 201 }); } catch (e) { return managedFailure(e); }
});
export const PATCH = withPlatformRequest(async request => {
  const session = await requireCustomerAuth(request); if (session instanceof Response) return session;
  try {
    const body = await readBody(request);
    if (body.action !== "cancel" && body.action !== "provide_information") throw new ManagedError("不允許此操作。", 403);
    return Response.json({ request: await command(session, body.action, body) });
  } catch (e) { return managedFailure(e); }
});
