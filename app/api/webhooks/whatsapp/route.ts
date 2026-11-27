import { after } from "next/server";
import { handleWhatsAppWebhookGet, handleWhatsAppWebhookPost } from "@/lib/platform/whatsapp";
import { processPendingWhatsAppJobs } from "@/lib/platform/whatsapp-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleWhatsAppWebhookGet(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleWhatsAppWebhookPost(request, {
    onJobsEnqueued: (count) => {
      if (count > 0) {
        after(async () => {
          await processPendingWhatsAppJobs().catch(() => {});
        });
      }
    },
  });
}
