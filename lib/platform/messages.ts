export const MESSAGE_STATUSES = ["pending", "in_progress", "completed"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_CATEGORIES = [
  "general_message",
  "callback_request",
  "complaint",
  "specific_recipient",
  "unanswered_question",
  "business_enquiry",
] as const;
export type MessageCategory = (typeof MESSAGE_CATEGORIES)[number];

export const MESSAGE_CHANNELS = ["web", "phone", "whatsapp"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

export type MessageInboxScope = "admin" | "merchant";

export const messageStatusLabels: Record<MessageStatus, string> = {
  pending: "待處理",
  in_progress: "跟進中",
  completed: "已完成",
};

export const messageCategoryLabels: Record<MessageCategory, string> = {
  general_message: "一般留言",
  callback_request: "回電要求",
  complaint: "投訴及意見",
  specific_recipient: "指定負責人",
  unanswered_question: "未能解答問題",
  business_enquiry: "商業合作查詢",
};

export const messageChannelLabels: Record<MessageChannel, string> = {
  web: "網站",
  phone: "電話",
  whatsapp: "WhatsApp",
};

export const DEFAULT_MARKETING_AGENT_ID = "agent_8201m7sbetj3e36s1a2nv3fgcqna";

export type InboxMessage = {
  id: string;
  message_no: number;
  reference: string;
  inbox_scope: MessageInboxScope;
  organization_id: string | null;
  agent_id: string | null;
  conversation_id: string | null;
  provider: string;
  provider_agent_id: string;
  provider_conversation_id: string;
  channel: MessageChannel;
  sender_name: string;
  contact_phone: string;
  recipient_name: string;
  message_content: string;
  message_summary: string;
  category: MessageCategory;
  preferred_callback_time: string;
  status: MessageStatus;
  version: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type MessageEvent = {
  id: string;
  message_id: string;
  actor_id: string | null;
  actor_label: string;
  kind: "created" | "status_changed" | "note_added" | "conversation_linked";
  from_status: MessageStatus | null;
  to_status: MessageStatus | null;
  detail: string;
  created_at: string;
};

export type MessageInternalNote = {
  id: string;
  message_id: string;
  actor_id: string;
  actor_label: string;
  note: string;
  created_at: string;
};

export type MessageLinkedConversation = {
  id: string;
  channel: MessageChannel;
  caller_phone: string;
  caller_name: string;
  duration_seconds: number;
  summary: string;
  created_at: string;
  transcript?: { role: string; message: string; time_in_call_secs?: number }[];
};

export type MessageCounts = {
  pending: number;
  in_progress: number;
  completed: number;
  total: number;
};

export type CreateMessageInput = {
  senderName: string;
  contactPhone: string;
  recipientName: string;
  messageContent: string;
  messageSummary: string;
  category: MessageCategory;
  preferredCallbackTime: string;
};

export class MessageInputError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function readTrustedIdentifier(value: unknown, label: string, required = true): string {
  if (value == null || value === "") {
    if (!required) return "";
    throw new MessageInputError(`Missing ${label}`, 400);
  }
  if (typeof value !== "string") throw new MessageInputError(`Invalid ${label}`, 400);
  const trimmed = value.trim();
  if (!trimmed) {
    if (!required) return "";
    throw new MessageInputError(`Missing ${label}`, 400);
  }
  if (!AGENT_ID_RE.test(trimmed)) throw new MessageInputError(`Invalid ${label}`, 400);
  return trimmed;
}

export function normalizeChannel(value: unknown): MessageChannel {
  if (typeof value !== "string") return "web";
  const clean = value.trim().toLowerCase();
  if (clean === "phone" || clean === "whatsapp" || clean === "web") return clean;
  if (clean.includes("phone") || clean.includes("twilio") || clean.includes("sip")) return "phone";
  if (clean.includes("whatsapp")) return "whatsapp";
  return "web";
}

function cleanText(value: unknown, maxLen: number, fieldName: string, required = false): string {
  if (value == null || value === "") {
    if (required) throw new MessageInputError(`${fieldName} is required`, 400);
    return "";
  }
  if (typeof value !== "string") throw new MessageInputError(`${fieldName} must be a string`, 400);
  const trimmed = value.trim();
  if (required && !trimmed) throw new MessageInputError(`${fieldName} is required`, 400);
  if ([...trimmed].length > maxLen) {
    throw new MessageInputError(`${fieldName} exceeds maximum length (${maxLen})`, 400);
  }
  return trimmed;
}

export function deriveSummary(messageContent: string): string {
  const oneLine = messageContent.replace(/\s+/g, " ").trim();
  const chars = [...oneLine];
  return chars.length > 140 ? `${chars.slice(0, 137).join("")}...` : oneLine;
}

export function parseCreateMessageInput(raw: unknown): CreateMessageInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new MessageInputError("Invalid message payload", 400);
  }
  const body = raw as Record<string, unknown>;

  const senderName = cleanText(body.senderName, 120, "senderName", true);
  const contactPhone = cleanText(body.contactPhone, 64, "contactPhone", false);
  const recipientName = cleanText(body.recipientName, 120, "recipientName", false);
  const messageContent = cleanText(body.messageContent, 4000, "messageContent", true);
  const providedSummary = cleanText(body.messageSummary, 600, "messageSummary", false);
  const messageSummary = providedSummary || deriveSummary(messageContent);
  const preferredCallbackTime = cleanText(
    body.preferredCallbackTime,
    160,
    "preferredCallbackTime",
    false,
  );

  const rawCategory = typeof body.category === "string" ? body.category.trim().toLowerCase() : "";
  if (!(MESSAGE_CATEGORIES as readonly string[]).includes(rawCategory)) {
    throw new MessageInputError("category is invalid", 400);
  }

  return {
    senderName,
    contactPhone,
    recipientName,
    messageContent,
    messageSummary,
    category: rawCategory as MessageCategory,
    preferredCallbackTime,
  };
}

export function resolveMessageIdempotencyKey(params: {
  explicitKey: string;
  providerConversationId: string;
  payloadHash: string;
}): string {
  const cleanExplicit = params.explicitKey.trim();
  if (cleanExplicit) return cleanExplicit.slice(0, 160);
  if (params.providerConversationId) {
    return `conv:${params.providerConversationId}:${params.payloadHash}`.slice(0, 160);
  }
  return `msg:${params.payloadHash}`.slice(0, 160);
}
