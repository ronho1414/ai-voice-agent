import { fail, json } from "@/lib/http";
import { relayChat } from "@/lib/voice-engine/relay";
import { readKnowledgeBasePath, readSpokenOpener, readTurnContext, readUtterance } from "@/lib/voice-engine/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const text = readUtterance(body);
    const knowledgeBasePath = readKnowledgeBasePath(body);
    return json(await relayChat(text, knowledgeBasePath, readSpokenOpener(body), readTurnContext(body)));
  } catch (error) {
    return fail(error);
  }
}
