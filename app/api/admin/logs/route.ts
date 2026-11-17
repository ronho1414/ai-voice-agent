import { requireAdmin } from "@/lib/admin/guard";
import { readSiteId } from "@/lib/admin/site";
import { conversationReport } from "@/lib/admin/store";
import { fail, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const siteId = readSiteId(url.searchParams.get("siteId"));
    const highIntentOnly = url.searchParams.get("highIntent") === "1";
    return json(await conversationReport(siteId, highIntentOnly));
  } catch (error) {
    return fail(error);
  }
}
