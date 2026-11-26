import { requireCustomerAuth } from "@/lib/platform/auth";
import { managedFailure } from "@/lib/platform/managed-agent-service";
import { handleMessagePatch, listMessagesOrDetail } from "@/lib/platform/message-service";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPlatformRequest(async (request) => {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json(await listMessagesOrDetail(request, auth, false), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return managedFailure(error);
  }
});

export const PATCH = withPlatformRequest(async (request) => {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  return handleMessagePatch(request, auth);
});
