import { requireCustomerAuth } from "@/lib/platform/auth";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { handleCustomerWhatsAppStream } from "@/lib/platform/whatsapp-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPlatformRequest(async (request) => {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  return handleCustomerWhatsAppStream(request, auth);
});
