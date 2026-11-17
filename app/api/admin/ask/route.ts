import { requireAdmin } from "@/lib/admin/guard";
import { readSiteId } from "@/lib/admin/site";
import { fail, json } from "@/lib/http";
import { answerFromKnowledge } from "@/lib/voice-engine/relay";
import { readUtterance } from "@/lib/voice-engine/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const denied = requireAdmin(request);
  if (denied) return denied;
  try {
    const body: unknown = await request.json();
    const text = readUtterance(body);
    const siteId = readSiteId(
      typeof body === "object" && body !== null ? (body as { siteId?: unknown }).siteId : undefined,
    );
    return json({ reply: await answerFromKnowledge(text, siteId) });
  } catch (error) {
    return fail(error);
  }
}
