import { requireSuperAdmin } from "@/lib/platform/auth";
import { withPlatformRequest } from "@/lib/platform/supabase-auth";
import { handleAdminWhatsAppSend, handleAdminWhatsAppStatus } from "@/lib/platform/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withPlatformRequest(async (request) => {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;
  return handleAdminWhatsAppStatus();
});

export const POST = withPlatformRequest(async (request) => {
  const auth = await requireSuperAdmin(request);
  if (auth instanceof Response) return auth;
  return handleAdminWhatsAppSend(request);
});
