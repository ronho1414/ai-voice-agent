import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { requireCustomerAuth } from "@/lib/platform/auth";
import { lookupDuplicateChangeRequest, managedFailure, readBody } from "@/lib/platform/managed-agent-service";

export const POST = withPlatformRequest(async request => {
  const session = await requireCustomerAuth(request);
  if (session instanceof Response) return session;
  try {
    return Response.json(await lookupDuplicateChangeRequest(request, session, await readBody(request)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return managedFailure(e);
  }
});
