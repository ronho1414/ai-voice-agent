import { after } from "next/server";
import { readConversationDraft, recordConversation } from "@/lib/admin/logs";
import { readSiteId } from "@/lib/admin/site";
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
    const siteId = readSiteId(typeof body === "object" && body !== null ? (body as { siteId?: unknown }).siteId : undefined);
    const result = await relayChat(text, knowledgeBasePath, readSpokenOpener(body), readTurnContext(body), siteId);
    const draft = readConversationDraft(body, result.reply);
    after(() => {
      void recordConversation(draft);
    });
    return json(result);
  } catch (error) {
    return fail(error);
  }
}
