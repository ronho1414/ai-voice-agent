import { requireCustomerAuth } from "@/lib/platform/auth";
import { handleCustomerWhatsAppMediaGet } from "@/lib/platform/whatsapp-inbox";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPlatformRequest(async (request) => {
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  return handleCustomerWhatsAppMediaGet(request, auth);
});
