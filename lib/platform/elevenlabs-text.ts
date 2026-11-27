export type ElevenLabsHistoryTurn = {
  senderType: "customer" | "ai" | "human" | "system";
  senderLabel?: string | null;
  bodyText: string;
  createdAt?: string | null;
};

export type GenerateElevenLabsTextReplyInput = {
  agentId: string;
  conversationHistory?: ElevenLabsHistoryTurn[];
  unhandledCustomerMessages: string[];
  dynamicVariables?: Record<string, string | number | boolean>;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  WebSocketImpl?: typeof WebSocket;
};

export type GenerateElevenLabsTextReplyResult = {
  replyText: string;
  elevenlabsConversationId: string | null;
};

export class ElevenLabsTextConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsTextConfigError";
  }
}

export class ElevenLabsTextRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ElevenLabsTextRuntimeError";
  }
}

const MAX_HISTORY_CHARS = 12_000;
const DEFAULT_TIMEOUT_MS = 25_000;
const METADATA_WAIT_FALLBACK_MS = 1_200;

function senderPrefix(turn: ElevenLabsHistoryTurn): string {
  switch (turn.senderType) {
    case "customer":
      return "[顧客]";
    case "ai":
      return "[AI專員]";
    case "human":
      return turn.senderLabel ? `[真人客服:${turn.senderLabel}]` : "[真人客服]";
    default:
      return "[系統]";
  }
}

export function formatElevenLabsContextUpdate(history: ElevenLabsHistoryTurn[]): string {
  const lines: string[] = [];
  for (const turn of history) {
    const text = (turn.bodyText || "").trim();
    if (!text) continue;
    lines.push(`${senderPrefix(turn)} ${text}`);
  }
  if (lines.length === 0) return "";

  const header =
    "以下為此 WhatsApp 對話的既有紀錄（包含真人客服在接管期間的回覆）。請延續目前對話脈絡自然回覆客戶的最新訊息，不要重複真人客服或 AI 已經回答或完成的事項：\n";

  const kept: string[] = [];
  let total = header.length;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (total + line.length + 1 > MAX_HISTORY_CHARS && kept.length > 0) break;
    kept.unshift(line);
    total += line.length + 1;
  }
  return `${header}${kept.join("\n")}`;
}

function sanitizeDynamicVariables(
  input?: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    if (!key) continue;
    if (typeof value === "string") {
      if (value.trim()) out[key] = value.trim().slice(0, 500);
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
}

async function getSignedConversationUrl(params: {
  agentId: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<string> {
  const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(
    params.agentId,
  )}`;
  const response = await params.fetchImpl(url, {
    method: "GET",
    headers: {
      "xi-api-key": params.apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const snippet = (await response.text().catch(() => "")).slice(0, 240);
    throw new ElevenLabsTextRuntimeError(
      `Failed to fetch ElevenLabs signed URL (${response.status}): ${snippet || "upstream error"}`,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ElevenLabsTextRuntimeError("Invalid JSON from ElevenLabs signed-url endpoint");
  }

  const signedUrl = typeof data.signed_url === "string" ? data.signed_url.trim() : "";
  if (!signedUrl.startsWith("wss://") && !signedUrl.startsWith("ws://")) {
    throw new ElevenLabsTextRuntimeError("Missing signed_url in ElevenLabs response");
  }
  return signedUrl;
}

function extractAgentResponseText(payload: Record<string, unknown>): string {
  const event = payload.agent_response_event;
  if (event && typeof event === "object") {
    const text = (event as Record<string, unknown>).agent_response;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  if (typeof payload.agent_response === "string" && payload.agent_response.trim()) {
    return payload.agent_response.trim();
  }
  return "";
}

function extractConversationId(payload: Record<string, unknown>): string | null {
  const meta = payload.conversation_initiation_metadata_event;
  if (meta && typeof meta === "object") {
    const id = (meta as Record<string, unknown>).conversation_id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return null;
}

export async function generateElevenLabsTextReply(
  input: GenerateElevenLabsTextReplyInput,
): Promise<GenerateElevenLabsTextReplyResult> {
  const agentId = (input.agentId || "").trim();
  if (!agentId) {
    throw new ElevenLabsTextConfigError("Missing ElevenLabs agent_id for WhatsApp channel");
  }

  const apiKey = (input.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new ElevenLabsTextConfigError("ELEVENLABS_API_KEY is not configured");
  }

  const combinedUserText = input.unhandledCustomerMessages
    .map((m) => m.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!combinedUserText) {
    throw new ElevenLabsTextRuntimeError("No unhandled customer message text to send to ElevenLabs");
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const WebSocketCtor = input.WebSocketImpl ?? globalThis.WebSocket;
  if (typeof WebSocketCtor !== "function") {
    throw new ElevenLabsTextRuntimeError("WebSocket runtime is unavailable");
  }

  const signedUrl = await getSignedConversationUrl({ agentId, apiKey, fetchImpl });
  const contextText = formatElevenLabsContextUpdate(input.conversationHistory ?? []);
  const dynamicVars = sanitizeDynamicVariables(input.dynamicVariables);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<GenerateElevenLabsTextReplyResult>((resolve, reject) => {
    let settled = false;
    let promptsDispatched = false;
    let elevenlabsConversationId: string | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    const ws = new WebSocketCtor(signedUrl);

    const cleanup = () => {
      if (overallTimer) clearTimeout(overallTimer);
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };

    const finishSuccess = (replyText: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.close(1000, "done");
      } catch {
        // Ignore socket close failures after final reply
      }
      resolve({ replyText, elevenlabsConversationId });
    };

    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.close(1011, "error");
      } catch {
        // Ignore socket close failures
      }
      reject(err);
    };

    const overallTimer = setTimeout(() => {
      finishError(new ElevenLabsTextRuntimeError("ElevenLabs text WebSocket timed out"));
    }, timeoutMs);

    const sendTurns = () => {
      if (promptsDispatched || settled) return;
      promptsDispatched = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      if (contextText) {
        ws.send(JSON.stringify({ type: "contextual_update", text: contextText }));
      }
      ws.send(JSON.stringify({ type: "user_message", text: combinedUserText }));
    };

    ws.addEventListener("open", () => {
      const initPayload: Record<string, unknown> = {
        type: "conversation_initiation_client_data",
        conversation_config_override: {
          conversation: {
            text_only: true,
          },
        },
      };
      if (Object.keys(dynamicVars).length > 0) {
        initPayload.dynamic_variables = dynamicVars;
      }
      ws.send(JSON.stringify(initPayload));
      fallbackTimer = setTimeout(sendTurns, METADATA_WAIT_FALLBACK_MS);
    });

    ws.addEventListener("message", (event: MessageEvent) => {
      if (settled) return;
      const raw = typeof event.data === "string" ? event.data : String(event.data ?? "");
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === "string" ? msg.type : "";
      if (type === "ping") {
        const pingEvent = msg.ping_event;
        const eventId =
          pingEvent && typeof pingEvent === "object"
            ? (pingEvent as Record<string, unknown>).event_id
            : undefined;
        if (eventId !== undefined) {
          ws.send(JSON.stringify({ type: "pong", event_id: eventId }));
        }
        return;
      }

      if (type === "conversation_initiation_metadata") {
        elevenlabsConversationId = extractConversationId(msg);
        sendTurns();
        return;
      }

      if (type === "agent_response") {
        const text = extractAgentResponseText(msg);
        if (text) {
          finishSuccess(text);
        }
        return;
      }

      if (type === "error") {
        const errorMsg =
          typeof msg.message === "string"
            ? msg.message
            : typeof msg.error === "string"
              ? msg.error
              : "ElevenLabs WebSocket error event";
        finishError(new ElevenLabsTextRuntimeError(errorMsg));
      }
    });

    ws.addEventListener("error", () => {
      finishError(new ElevenLabsTextRuntimeError("ElevenLabs WebSocket connection error"));
    });

    ws.addEventListener("close", (event: CloseEvent) => {
      if (!settled) {
        const reason = event.reason ? `: ${event.reason}` : "";
        finishError(
          new ElevenLabsTextRuntimeError(
            `ElevenLabs WebSocket closed before agent_response (code ${event.code}${reason})`,
          ),
        );
      }
    });
  });
}
