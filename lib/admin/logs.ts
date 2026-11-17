import { insertConversation, type ConversationRecord } from "@/lib/admin/store";
import { DEFAULT_SITE_ID, readOptionalText, readSiteId } from "@/lib/admin/site";

const HIGH_INTENT = new Set(["navigate_pricing", "price_objection", "booking_demo"]);
const HIGH_TEXT = /收費|幾錢|價錢|報價|預約|demo|優惠|月費/i;

export type ConversationDraft = {
  siteId: string;
  sessionId: string;
  currentPage: string;
  userTranscript: string;
  detectedIntent: string;
  openerClipId: string;
  aiReply: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHighIntent(intent: string, transcript: string): boolean {
  return HIGH_INTENT.has(intent) || HIGH_TEXT.test(transcript);
}

export function readConversationDraft(body: unknown, reply: string): ConversationDraft {
  const record = isRecord(body) ? body : {};
  let siteId = DEFAULT_SITE_ID;
  try {
    siteId = readSiteId(record.siteId);
  } catch {
    siteId = DEFAULT_SITE_ID;
  }
  return {
    siteId,
    sessionId: readOptionalText(record.sessionId, 80) || "anonymous",
    currentPage: readOptionalText(record.currentPage, 40) || "home",
    userTranscript: readOptionalText(record.text, 2000),
    detectedIntent: readOptionalText(record.intent, 80),
    openerClipId: readOptionalText(record.openerClipId, 120),
    aiReply: reply.slice(0, 4000),
  };
}

export async function recordConversation(draft: ConversationDraft): Promise<void> {
  const row: ConversationRecord = {
    id: crypto.randomUUID(),
    site_id: draft.siteId,
    session_id: draft.sessionId,
    current_page: draft.currentPage,
    user_transcript: draft.userTranscript,
    detected_intent: draft.detectedIntent,
    opener_clip_id: draft.openerClipId,
    ai_reply: draft.aiReply,
    is_high_intent: isHighIntent(draft.detectedIntent, draft.userTranscript),
    created_at: new Date().toISOString(),
  };
  try {
    await insertConversation(row);
  } catch {
    // Logging must never change the spoken reply.
  }
}
