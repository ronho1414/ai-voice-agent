import { handleWhatsAppWebhookGet, handleWhatsAppWebhookPost } from "@/lib/platform/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleWhatsAppWebhookGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhookPost(request);
}
