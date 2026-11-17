import { fail, json } from "@/lib/http";
import { decideFast } from "@/lib/voice-engine/decision";
import { readSiteMapOverride, readTurnContext, readUtterance } from "@/lib/voice-engine/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hkg1";

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const text = readUtterance(body);
    return json(await decideFast(text, readSiteMapOverride(body), readTurnContext(body)));
  } catch (error) {
    return fail(error);
  }
}
