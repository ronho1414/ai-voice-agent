import { handleElevenLabsWhatsAppHandoff } from "@/lib/platform/whatsapp-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleElevenLabsWhatsAppHandoff(request);
}
