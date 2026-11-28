import { requireCustomerAuth } from "@/lib/platform/auth";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { isWhatsAppTextInboxEnabled, whatsAppTextInboxDisabledResponse } from "@/lib/platform/whatsapp-flag";
import { handleCustomerWhatsAppGet, handleCustomerWhatsAppPost } from "@/lib/platform/whatsapp-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPlatformRequest(async (request) => {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  return handleCustomerWhatsAppGet(request, auth);
});

export const POST = withPlatformRequest(async (request) => {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  const auth = await requireCustomerAuth(request);
  if (auth instanceof Response) return auth;
  return handleCustomerWhatsAppPost(request, auth);
});
