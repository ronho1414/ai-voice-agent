import { handleElevenLabsWhatsAppHandoff } from "@/lib/platform/whatsapp-inbox";
import { isWhatsAppTextInboxEnabled, whatsAppTextInboxDisabledResponse } from "@/lib/platform/whatsapp-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  return handleElevenLabsWhatsAppHandoff(request);
}
