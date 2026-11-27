import { createHash, randomUUID } from "node:crypto";
import {
  generateElevenLabsTextReply,
  type ElevenLabsHistoryTurn,
  type GenerateElevenLabsTextReplyInput,
  type GenerateElevenLabsTextReplyResult,
} from "./elevenlabs-text";
import { ManagedError, managedFailure, readBody, serviceDatabase, uuid } from "./managed-agent-service";
import { extractBearerOrSecret } from "./message-service";
import type { PlatformSession } from "./types";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,128}$/;
const LANG_CODE_RE = /^[A-Za-z0-9_-]{2,20}$/;
const DEFAULT_GRAPH_VERSION = "v25.0";
const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

export type WhatsAppConversationRow = {
  id: string;
  scope: "admin" | "merchant";
  organization_id: string | null;
  channel_id: string;
  phone_number_id: string;
  customer_wa_id: string;
  customer_name: string;
  mode: "ai" | "human";
  mode_version: number;
  status: "open" | "needs_human" | "resolved";
  unread_count: number;
  assigned_profile_id: string | null;
  needs_human_reason: string;
  last_message_preview: string;
  last_message_sender: "customer" | "ai" | "human" | "system";
  last_message_at: string;
  last_inbound_at: string | null;
  last_ai_processed_msg_at: string | null;
  last_ai_processed_msg_id: string | null;
  elevenlabs_conversation_id: string;
  created_at: string;
  updated_at: string;
};

export type EnrichedWhatsAppConversation = WhatsAppConversationRow & {
  window24hOpen: boolean;
  windowExpiresAt: string | null;
};

export type ChannelMetaCredentials = {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function configuredGraphVersion(): string {
  const raw =
    process.env.WHATSAPP_GRAPH_API_VERSION?.trim() ||
    process.env.WHATSAPP_GRAPH_VERSION?.trim() ||
    DEFAULT_GRAPH_VERSION;
  return /^v[0-9]+\.[0-9]+$/.test(raw) ? raw : DEFAULT_GRAPH_VERSION;
}

export function compute24hWindow(lastInboundAt: string | null, nowMs = Date.now()): {
  window24hOpen: boolean;
  windowExpiresAt: string | null;
} {
  if (!lastInboundAt) {
    return { window24hOpen: false, windowExpiresAt: null };
  }
  const inboundMs = Date.parse(lastInboundAt);
  if (!Number.isFinite(inboundMs)) {
    return { window24hOpen: false, windowExpiresAt: null };
  }
  const expiresMs = inboundMs + WINDOW_24H_MS;
  return {
    window24hOpen: nowMs < expiresMs,
    windowExpiresAt: new Date(expiresMs).toISOString(),
  };
}

export function enrichConversation(row: WhatsAppConversationRow, nowMs = Date.now()): EnrichedWhatsAppConversation {
  const windowInfo = compute24hWindow(row.last_inbound_at, nowMs);
  return {
    ...row,
    window24hOpen: windowInfo.window24hOpen,
    windowExpiresAt: windowInfo.windowExpiresAt,
  };
}

export async function dispatchMetaWhatsAppMessage(params: {
  phoneNumberId: string;
  accessToken: string;
  graphVersion?: string;
  payload: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<
  | { ok: true; waMessageId: string; httpStatus: number }
  | {
      ok: false;
      networkError: boolean;
      httpStatus: number;
      errorCode: string;
      errorTitle: string;
      errorMessage: string;
    }
> {
  const graphVersion = params.graphVersion || configuredGraphVersion();
  const endpoint = `https://graph.facebook.com/${graphVersion}/${params.phoneNumberId}/messages`;
  const fetchFn = params.fetchImpl ?? fetch;

  let httpStatus = 0;
  let graphJson: Record<string, unknown> = {};
  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.payload),
    });
    httpStatus = response.status;
    graphJson = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      networkError: true,
      httpStatus: 0,
      errorCode: "NETWORK_ERR",
      errorTitle: "Graph API Connection Failed",
      errorMessage: "無法連線至 Meta WhatsApp Cloud API。",
    };
  }

  const graphErr =
    graphJson.error && typeof graphJson.error === "object"
      ? (graphJson.error as Record<string, unknown>)
      : null;
  const messagesArr = Array.isArray(graphJson.messages) ? graphJson.messages : [];
  const firstMsg =
    messagesArr[0] && typeof messagesArr[0] === "object"
      ? (messagesArr[0] as Record<string, unknown>)
      : null;
  const waMessageId = firstMsg && typeof firstMsg.id === "string" ? firstMsg.id.trim() : "";

  if (httpStatus < 200 || httpStatus >= 300 || !waMessageId) {
    return {
      ok: false,
      networkError: false,
      httpStatus,
      errorCode: graphErr && graphErr.code != null ? String(graphErr.code).slice(0, 64) : String(httpStatus || "GRAPH_ERR"),
      errorTitle:
        graphErr && typeof graphErr.type === "string" ? graphErr.type.slice(0, 200) : "Meta Cloud API Error",
      errorMessage:
        graphErr && typeof graphErr.message === "string"
          ? graphErr.message.slice(0, 400)
          : "WhatsApp 訊息傳送失敗，請檢查 Meta Token 權限、接收白名單或範本設定。",
    };
  }

  return { ok: true, waMessageId, httpStatus };
}

export async function resolveChannelCredentials(
  channel: Record<string, unknown>,
  readSecrets?: (channelId: string) => Promise<Record<string, unknown> | null>,
): Promise<ChannelMetaCredentials> {
  const channelId = typeof channel.id === "string" ? channel.id : "";
  const allowPlatformEnvFallback = channel.allow_platform_env_fallback === true;
  let stored: Record<string, unknown> | null = null;

  if (channelId) {
    if (readSecrets) {
      stored = await readSecrets(channelId);
    } else {
      const { data } = await serviceDatabase().rpc("read_whatsapp_channel_secrets", {
        p_channel_id: channelId,
      });
      if (data && typeof data === "object") {
        stored = data as Record<string, unknown>;
      }
    }
  }

  const storedAccess = typeof stored?.access_token === "string" ? stored.access_token.trim() : "";
  const storedSecret = typeof stored?.app_secret === "string" ? stored.app_secret.trim() : "";
  const storedVerify = typeof stored?.verify_token === "string" ? stored.verify_token.trim() : "";

  const accessToken =
    storedAccess || (allowPlatformEnvFallback ? process.env.WHATSAPP_ACCESS_TOKEN?.trim() || "" : "");
  const appSecret =
    storedSecret || (allowPlatformEnvFallback ? process.env.WHATSAPP_APP_SECRET?.trim() || "" : "");
  const verifyToken =
    storedVerify ||
    (allowPlatformEnvFallback
      ? process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
        process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
        ""
      : "");

  return {
    accessToken,
    appSecret,
    verifyToken,
    graphVersion: configuredGraphVersion(),
  };
}

function describeMessageForAi(row: Record<string, unknown>): string {
  const body = typeof row.body_text === "string" ? row.body_text.trim() : "";
  if (body) return body;
  const msgType = typeof row.message_type === "string" ? row.message_type : "other";
  switch (msgType) {
    case "image":
      return "[客戶傳送了圖片]";
    case "audio":
      return "[客戶傳送了語音訊息]";
    case "document":
      return "[客戶傳送了文件檔案]";
    case "interactive":
      return "[客戶點選了互動選項]";
    default:
      return `[客戶傳送了 ${msgType} 訊息]`;
  }
}

export type WhatsAppJobRunnerDeps = {
  claimJob?: (conversationId: string | null) => Promise<Record<string, unknown>>;
  reserveAiOutbound?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  finalizeOutbound?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  failJob?: (jobId: string, status: "failed" | "cancelled_by_takeover" | "skipped", error: string) => Promise<void>;
  readChannelSecrets?: (channelId: string) => Promise<Record<string, unknown> | null>;
  generateReply?: (input: GenerateElevenLabsTextReplyInput) => Promise<GenerateElevenLabsTextReplyResult>;
  fetchImpl?: typeof fetch;
};

export async function processPendingWhatsAppJobs(
  options: {
    conversationId?: string | null;
    maxJobs?: number;
  } & WhatsAppJobRunnerDeps = {},
): Promise<{
  processed: number;
  sent: number;
  abortedByTakeover: number;
  failed: number;
}> {
  const maxJobs = Math.max(1, Math.min(options.maxJobs ?? 6, 20));
  const summary = { processed: 0, sent: 0, abortedByTakeover: 0, failed: 0 };

  const claimFn =
    options.claimJob ??
    (async (convId: string | null) => {
      const { data, error } = await serviceDatabase().rpc("claim_whatsapp_ai_job", {
        p_conversation_id: convId,
      });
      if (error || !data || typeof data !== "object") {
        throw new ManagedError("Failed to claim WhatsApp AI job", 503);
      }
      return data as Record<string, unknown>;
    });

  const reserveAiFn =
    options.reserveAiOutbound ??
    (async (payload: Record<string, unknown>) => {
      const { data, error } = await serviceDatabase().rpc("reserve_whatsapp_ai_outbound", { payload });
      if (error || !data || typeof data !== "object") {
        throw new ManagedError("Failed to reserve WhatsApp AI outbound message", 503);
      }
      return data as Record<string, unknown>;
    });

  const finalizeFn =
    options.finalizeOutbound ??
    (async (payload: Record<string, unknown>) => {
      const { data, error } = await serviceDatabase().rpc("finalize_whatsapp_outbound", { payload });
      if (error || !data || typeof data !== "object") {
        throw new ManagedError("Failed to finalize WhatsApp outbound message", 503);
      }
      return data as Record<string, unknown>;
    });

  const failJobFn =
    options.failJob ??
    (async (jobId: string, status: "failed" | "cancelled_by_takeover" | "skipped", errorMessage: string) => {
      await serviceDatabase().rpc("complete_whatsapp_ai_job_failure", {
        p_job_id: jobId,
        p_status: status,
        p_error: errorMessage,
      });
    });

  const generateReplyFn = options.generateReply ?? generateElevenLabsTextReply;

  for (let i = 0; i < maxJobs; i += 1) {
    const claimed = await claimFn(options.conversationId ?? null);
    if (claimed.claimed !== true) {
      if (claimed.cancelled === true) summary.abortedByTakeover += 1;
      break;
    }

    summary.processed += 1;
    const job = (claimed.job ?? {}) as Record<string, unknown>;
    const conv = (claimed.conversation ?? {}) as Record<string, unknown>;
    const channel = (claimed.channel ?? {}) as Record<string, unknown>;
    const elevenlabsAgentId =
      typeof claimed.elevenlabs_agent_id === "string" ? claimed.elevenlabs_agent_id.trim() : "";
    const unhandled = Array.isArray(claimed.unhandled_messages)
      ? (claimed.unhandled_messages as Record<string, unknown>[])
      : [];
    const historyRows = Array.isArray(claimed.history)
      ? (claimed.history as Record<string, unknown>[])
      : [];

    const jobId = typeof job.id === "string" ? job.id : "";
    const convId = typeof conv.id === "string" ? conv.id : "";
    const expectedModeVersion = typeof job.mode_version === "number" ? job.mode_version : Number(job.mode_version || 1);

    if (!jobId || !convId || !elevenlabsAgentId || unhandled.length === 0) {
      if (jobId) {
        await failJobFn(jobId, "skipped", "Invalid claimed WhatsApp AI job payload");
      }
      continue;
    }

    const unhandledIds = new Set(
      unhandled.map((m) => (typeof m.id === "string" ? m.id : "")).filter(Boolean),
    );
    const historyTurns: ElevenLabsHistoryTurn[] = historyRows
      .filter((row) => typeof row.id === "string" && !unhandledIds.has(row.id))
      .map((row) => ({
        senderType:
          row.sender_type === "ai" || row.sender_type === "human" || row.sender_type === "system"
            ? row.sender_type
            : "customer",
        bodyText: describeMessageForAi(row),
        createdAt: typeof row.created_at === "string" ? row.created_at : null,
      }));

    const unhandledTexts = unhandled.map((m) => describeMessageForAi(m));
    const lastUnhandled = unhandled[unhandled.length - 1];
    const lastMsgAt = typeof lastUnhandled.created_at === "string" ? lastUnhandled.created_at : new Date().toISOString();
    const lastMsgId = typeof lastUnhandled.id === "string" ? lastUnhandled.id : "";

    let aiResult: GenerateElevenLabsTextReplyResult;
    try {
      const creds = await resolveChannelCredentials(channel, options.readChannelSecrets);
      if (!creds.accessToken) {
        throw new ManagedError("Channel Meta access token is not configured", 503);
      }

      aiResult = await generateReplyFn({
        agentId: elevenlabsAgentId,
        conversationHistory: historyTurns,
        unhandledCustomerMessages: unhandledTexts,
        dynamicVariables: {
          channel: "whatsapp",
          whatsapp_conversation_id: convId,
          whatsapp_customer_wa_id: typeof conv.customer_wa_id === "string" ? conv.customer_wa_id : "",
          whatsapp_customer_name: typeof conv.customer_name === "string" ? conv.customer_name : "",
        },
      });

      const cleanReply = aiResult.replyText.trim().slice(0, 4096);
      if (!cleanReply) {
        await failJobFn(jobId, "skipped", "Empty reply from ElevenLabs text agent");
        continue;
      }

      const idempotencyKey = `ai:${jobId}`;
      const payloadHash = sha256Hex(
        JSON.stringify({
          conversationId: convId,
          jobId,
          replyText: cleanReply,
        }),
      );

      const reserve = await reserveAiFn({
        job_id: jobId,
        whatsapp_conversation_id: convId,
        expected_mode_version: expectedModeVersion,
        processed_until_at: lastMsgAt,
        processed_last_msg_id: lastMsgId,
        body_text: cleanReply,
        idempotency_key: idempotencyKey,
        payload_hash: payloadHash,
        elevenlabs_conversation_id: aiResult.elevenlabsConversationId || "",
        metadata: {
          elevenlabs_agent_id: elevenlabsAgentId,
          elevenlabs_conversation_id: aiResult.elevenlabsConversationId || null,
          source: "orai_whatsapp_ai_worker",
        },
      });

      if (reserve.action === "aborted_by_takeover") {
        summary.abortedByTakeover += 1;
        continue;
      }
      if (reserve.action !== "reserved") {
        continue;
      }

      const reservedRow = (reserve.record ?? {}) as Record<string, unknown>;
      const reservedId = typeof reservedRow.id === "string" ? reservedRow.id : "";
      const phoneNumberId = typeof conv.phone_number_id === "string" ? conv.phone_number_id : "";
      const recipientWaId = typeof conv.customer_wa_id === "string" ? conv.customer_wa_id : "";

      const metaRes = await dispatchMetaWhatsAppMessage({
        phoneNumberId,
        accessToken: creds.accessToken,
        graphVersion: creds.graphVersion,
        fetchImpl: options.fetchImpl,
        payload: {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: recipientWaId,
          type: "text",
          text: { preview_url: false, body: cleanReply },
        },
      });

      if (!metaRes.ok) {
        await finalizeFn({
          id: reservedId,
          status: "failed",
          error_code: metaRes.errorCode,
          error_title: metaRes.errorTitle,
          error_message: metaRes.errorMessage,
          metadata: { graph_version: creds.graphVersion, http_status: metaRes.httpStatus },
        });
        summary.failed += 1;
      } else {
        await finalizeFn({
          id: reservedId,
          status: "sent",
          wa_message_id: metaRes.waMessageId,
          metadata: { graph_version: creds.graphVersion, messaging_product: "whatsapp" },
        });
        summary.sent += 1;
      }
    } catch (err) {
      summary.failed += 1;
      const msg = err instanceof Error ? err.message : "Unknown AI worker error";
      await failJobFn(jobId, "failed", msg.slice(0, 1000)).catch(() => {});
    }
  }

  return summary;
}

export async function listCustomerWhatsAppInbox(
  session: PlatformSession,
  params: {
    conversationId?: string | null;
    filter?: string | null;
    q?: string | null;
    since?: string | null;
  },
) {
  if (!session.organizationId) {
    throw new ManagedError("缺少商戶組織識別碼。", 403);
  }
  const db = serviceDatabase();
  const orgId = session.organizationId;
  const nowMs = Date.now();

  const [allConvRes, channelsRes] = await Promise.all([
    db
      .from("whatsapp_conversations")
      .select("*")
      .eq("scope", "merchant")
      .eq("organization_id", orgId)
      .order("last_message_at", { ascending: false })
      .limit(100),
    db
      .from("whatsapp_channels")
      .select("id,phone_number_id,display_phone,country_code,ai_auto_reply_enabled,is_active")
      .eq("scope", "merchant")
      .eq("organization_id", orgId)
      .eq("is_active", true),
  ]);

  if (allConvRes.error) {
    throw new ManagedError("未能讀取 WhatsApp 對話列表。", 503);
  }

  const allRows = (allConvRes.data ?? []) as WhatsAppConversationRow[];
  const enrichedAll = allRows.map((row) => enrichConversation(row, nowMs));

  const counts = {
    total: enrichedAll.length,
    unread: enrichedAll.filter((c) => c.unread_count > 0).length,
    needsHuman: enrichedAll.filter((c) => c.status === "needs_human" || c.mode === "human").length,
    ai: enrichedAll.filter((c) => c.mode === "ai" && c.status !== "resolved").length,
    human: enrichedAll.filter((c) => c.mode === "human" && c.status !== "resolved").length,
    resolved: enrichedAll.filter((c) => c.status === "resolved").length,
  };

  const filter = (params.filter || "all").trim().toLowerCase();
  const query = (params.q || "").trim().toLowerCase();
  const sinceMs = params.since ? Date.parse(params.since) : NaN;

  const filtered = enrichedAll.filter((conv) => {
    if (filter === "unread" && conv.unread_count <= 0) return false;
    if (filter === "needs_human" && conv.status !== "needs_human" && conv.mode !== "human") return false;
    if (filter === "ai" && (conv.mode !== "ai" || conv.status === "resolved")) return false;
    if (filter === "human" && (conv.mode !== "human" || conv.status === "resolved")) return false;
    if (filter === "resolved" && conv.status !== "resolved") return false;
    if (Number.isFinite(sinceMs) && Date.parse(conv.updated_at) <= sinceMs) return false;
    if (query) {
      const hay = `${conv.customer_name} ${conv.customer_wa_id} ${conv.last_message_preview}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  let selected: {
    conversation: EnrichedWhatsAppConversation;
    messages: Record<string, unknown>[];
    events: Record<string, unknown>[];
  } | null = null;

  if (params.conversationId) {
    const convId = uuid(params.conversationId);
    const targetConv = enrichedAll.find((c) => c.id === convId);
    if (!targetConv) {
      throw new ManagedError("找不到指定的 WhatsApp 對話。", 404);
    }

    const [msgsRes, eventsRes] = await Promise.all([
      db
        .from("whatsapp_messages")
        .select(
          "id,whatsapp_conversation_id,direction,sender_type,sender_actor_id,wa_message_id,peer_wa_id,peer_name,message_type,template_name,body_text,media_metadata,status,dispatched_before_takeover,error_code,error_title,error_message,sent_at,delivered_at,read_at,failed_at,received_at,created_at,updated_at",
        )
        .eq("scope", "merchant")
        .eq("organization_id", orgId)
        .eq("whatsapp_conversation_id", convId)
        .order("created_at", { ascending: true })
        .limit(200),
      db
        .from("whatsapp_takeover_events")
        .select("id,whatsapp_conversation_id,action,actor_id,actor_label,previous_mode,next_mode,note,created_at")
        .eq("scope", "merchant")
        .eq("organization_id", orgId)
        .eq("whatsapp_conversation_id", convId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (msgsRes.error || eventsRes.error) {
      throw new ManagedError("未能讀取 WhatsApp 對話訊息明細。", 503);
    }

    selected = {
      conversation: targetConv,
      messages: (msgsRes.data ?? []) as Record<string, unknown>[],
      events: (eventsRes.data ?? []) as Record<string, unknown>[],
    };
  }

  return {
    ok: true,
    serverTime: new Date(nowMs).toISOString(),
    conversations: filtered,
    counts,
    channels: (channelsRes.data ?? []) as Record<string, unknown>[],
    selected,
  };
}

export async function handleCustomerWhatsAppGet(
  request: Request,
  session: PlatformSession,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const data = await listCustomerWhatsAppInbox(session, {
      conversationId: url.searchParams.get("conversationId"),
      filter: url.searchParams.get("filter"),
      q: url.searchParams.get("q"),
      since: url.searchParams.get("since"),
    });
    return Response.json(data, { status: 200, headers: NO_STORE });
  } catch (err) {
    return managedFailure(err);
  }
}

export async function handleCustomerWhatsAppPost(
  request: Request,
  session: PlatformSession,
  options: {
    fetchImpl?: typeof fetch;
    readChannelSecrets?: (channelId: string) => Promise<Record<string, unknown> | null>;
  } = {},
): Promise<Response> {
  if (!session.organizationId) {
    return Response.json({ ok: false, error: "此帳戶沒有商戶權限。" }, { status: 403, headers: NO_STORE });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch (err) {
    return managedFailure(err);
  }

  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  const orgId = session.organizationId;
  const db = serviceDatabase();

  if (
    action === "take_over" ||
    action === "resume_ai" ||
    action === "mark_resolved" ||
    action === "reopen" ||
    action === "mark_read" ||
    action === "mark_unread"
  ) {
    try {
      const conversationId = uuid(body.conversationId);
      const { data, error } = await db.rpc("whatsapp_conversation_command", {
        actor_id: session.userId,
        tenant_id: orgId,
        operation: action,
        payload: { conversation_id: conversationId },
      });
      if (error || !data || typeof data !== "object") {
        const msg = error?.message || "";
        if (error?.code === "42501" || msg.includes("unavailable") || msg.includes("authorized")) {
          throw new ManagedError("找不到該對話或沒有操作權限。", 403);
        }
        throw new ManagedError("更新 WhatsApp 對話狀態失敗。", 503);
      }
      const resObj = data as Record<string, unknown>;
      const convRow = resObj.conversation as WhatsAppConversationRow | undefined;
      return Response.json(
        {
          ok: true,
          conversation: convRow ? enrichConversation(convRow) : null,
          inFlightAiDispatch: Boolean(resObj.in_flight_ai_dispatch),
        },
        { status: 200, headers: NO_STORE },
      );
    } catch (err) {
      return managedFailure(err);
    }
  }

  if (action === "send_text" || action === "send_template") {
    try {
      const conversationId = uuid(body.conversationId);
      const headerIdem = request.headers.get("x-idempotency-key")?.trim() || "";
      const rawIdemKey =
        headerIdem ||
        (typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()) ||
        `hum:${randomUUID()}`;
      if ([...rawIdemKey].length > 160) {
        throw new ManagedError("idempotencyKey 長度不可超過 160 字元。", 400);
      }

      let messageType: "text" | "template" = "text";
      let bodyText = "";
      let templateName = "";
      let languageCode = "zh_HK";
      let previewUrl = false;

      if (action === "send_text") {
        bodyText = typeof body.body === "string" ? body.body.trim() : "";
        if (!bodyText || [...bodyText].length > 4096) {
          throw new ManagedError("請提供 1 至 4,096 字的回覆內容。", 400);
        }
        previewUrl = body.previewUrl === true;
      } else {
        messageType = "template";
        templateName =
          typeof body.templateName === "string" && body.templateName.trim()
            ? body.templateName.trim()
            : "hello_world";
        if (!TEMPLATE_NAME_RE.test(templateName)) {
          throw new ManagedError("WhatsApp 範本名稱格式不正確。", 400);
        }
        languageCode =
          typeof body.languageCode === "string" && body.languageCode.trim()
            ? body.languageCode.trim()
            : "en_US";
        if (!LANG_CODE_RE.test(languageCode)) {
          throw new ManagedError("WhatsApp 範本語言代碼格式不正確。", 400);
        }
        bodyText =
          typeof body.bodyText === "string" && body.bodyText.trim()
            ? body.bodyText.trim().slice(0, 1000)
            : `[範本] ${templateName}`;
      }

      const payloadHash = sha256Hex(
        JSON.stringify({
          conversationId,
          messageType,
          templateName,
          languageCode,
          bodyText,
        }),
      );

      const { data: reserveData, error: reserveErr } = await db.rpc("reserve_whatsapp_human_outbound", {
        actor_id: session.userId,
        tenant_id: orgId,
        payload: {
          whatsapp_conversation_id: conversationId,
          message_type: messageType,
          template_name: templateName,
          body_text: bodyText,
          idempotency_key: rawIdemKey,
          payload_hash: payloadHash,
          metadata: {
            source: "orai_dashboard_human_inbox",
            language_code: languageCode,
          },
        },
      });

      if (reserveErr || !reserveData || typeof reserveData !== "object") {
        if (reserveErr?.code === "42501") {
          throw new ManagedError("找不到該對話或沒有操作權限。", 403);
        }
        throw new ManagedError("未能建立 WhatsApp 發送紀錄，已中止送出。", 503);
      }

      const reserve = reserveData as Record<string, unknown>;
      if (reserve.action === "window_expired") {
        return Response.json(
          {
            ok: false,
            errorCode: "WINDOW_24H_EXPIRED",
            error: "距離客戶最後一次回覆已超過 24 小時（Customer Service Window），請改用核准範本訊息。",
            lastInboundAt: reserve.last_inbound_at ?? null,
          },
          { status: 422, headers: NO_STORE },
        );
      }
      if (reserve.action === "unmapped_channel") {
        return Response.json(
          { ok: false, error: "此對話所屬的 WhatsApp Channel 已停用或未設定。" },
          { status: 404, headers: NO_STORE },
        );
      }
      if (reserve.action === "conflict") {
        return Response.json(
          { ok: false, error: "相同的 idempotencyKey 不可用於不同訊息內容。" },
          { status: 409, headers: NO_STORE },
        );
      }
      if (reserve.action === "replay") {
        return Response.json(
          {
            ok: true,
            replayed: true,
            idempotencyKey: rawIdemKey,
            record: reserve.record,
          },
          { status: 200, headers: NO_STORE },
        );
      }
      if (reserve.action === "previous_failed" || reserve.action === "in_flight") {
        return Response.json(
          {
            ok: false,
            error:
              reserve.action === "previous_failed"
                ? "此訊息先前的發送曾失敗，請重新提交新訊息。"
                : "相同訊息正在傳送中，請稍候再檢查狀態。",
            record: reserve.record,
          },
          { status: 409, headers: NO_STORE },
        );
      }

      const reservedRow = (reserve.record ?? {}) as Record<string, unknown>;
      const channelRow = (reserve.channel ?? {}) as Record<string, unknown>;
      const convRow = (reserve.conversation ?? {}) as WhatsAppConversationRow;
      const reservedId = typeof reservedRow.id === "string" ? reservedRow.id : "";

      const creds = await resolveChannelCredentials(channelRow, options.readChannelSecrets);
      if (!creds.accessToken) {
        await db
          .rpc("finalize_whatsapp_outbound", {
            payload: {
              id: reservedId,
              status: "failed",
              error_code: "MISSING_CHANNEL_TOKEN",
              error_title: "WhatsApp Token Missing",
              error_message: "此 WhatsApp Channel 尚未設定 Meta Access Token。",
            },
          })
          .then(() => {}, () => {});
        return Response.json(
          { ok: false, error: "此 WhatsApp Channel 尚未設定 Meta Access Token。" },
          { status: 503, headers: NO_STORE },
        );
      }

      const graphPayload =
        messageType === "template"
          ? {
              messaging_product: "whatsapp",
              to: convRow.customer_wa_id,
              type: "template",
              template: {
                name: templateName,
                language: { code: languageCode },
              },
            }
          : {
              messaging_product: "whatsapp",
              recipient_type: "individual",
              to: convRow.customer_wa_id,
              type: "text",
              text: { preview_url: previewUrl, body: bodyText },
            };

      const metaRes = await dispatchMetaWhatsAppMessage({
        phoneNumberId: convRow.phone_number_id,
        accessToken: creds.accessToken,
        graphVersion: creds.graphVersion,
        payload: graphPayload,
        fetchImpl: options.fetchImpl,
      });

      if (!metaRes.ok) {
        await db
          .rpc("finalize_whatsapp_outbound", {
            payload: {
              id: reservedId,
              status: "failed",
              error_code: metaRes.errorCode,
              error_title: metaRes.errorTitle,
              error_message: metaRes.errorMessage,
              metadata: { graph_version: creds.graphVersion, http_status: metaRes.httpStatus },
            },
          })
          .then(() => {}, () => {});

        return Response.json(
          {
            ok: false,
            error: metaRes.errorMessage,
            errorCode: metaRes.errorCode,
            reservationId: reservedId,
            idempotencyKey: rawIdemKey,
          },
          { status: metaRes.networkError ? 502 : metaRes.httpStatus >= 400 && metaRes.httpStatus < 500 ? 422 : 502, headers: NO_STORE },
        );
      }

      const { data: persisted } = await db.rpc("finalize_whatsapp_outbound", {
        payload: {
          id: reservedId,
          status: "sent",
          wa_message_id: metaRes.waMessageId,
          metadata: { graph_version: creds.graphVersion, messaging_product: "whatsapp" },
        },
      });

      return Response.json(
        {
          ok: true,
          replayed: false,
          waMessageId: metaRes.waMessageId,
          idempotencyKey: rawIdemKey,
          record: persisted ?? reservedRow,
        },
        { status: 200, headers: NO_STORE },
      );
    } catch (err) {
      return managedFailure(err);
    }
  }

  return Response.json({ ok: false, error: "不支援的操作指令。" }, { status: 400, headers: NO_STORE });
}

export function handleCustomerWhatsAppStream(
  request: Request,
  session: PlatformSession,
): Response {
  if (!session.organizationId) {
    return Response.json({ ok: false, error: "此帳戶沒有商戶權限。" }, { status: 403, headers: NO_STORE });
  }
  const orgId = session.organizationId;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let lastSignature = "";

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Ignore double-close
        }
      };

      request.signal.addEventListener("abort", closeStream);

      const snapshotSignature = async (): Promise<string> => {
        const db = serviceDatabase();
        const [convRes, msgRes] = await Promise.all([
          db
            .from("whatsapp_conversations")
            .select("id,mode,mode_version,status,unread_count,updated_at")
            .eq("scope", "merchant")
            .eq("organization_id", orgId)
            .order("updated_at", { ascending: false })
            .limit(15),
          db
            .from("whatsapp_messages")
            .select("id,status,updated_at")
            .eq("scope", "merchant")
            .eq("organization_id", orgId)
            .order("updated_at", { ascending: false })
            .limit(5),
        ]);
        return JSON.stringify({
          c: convRes.data ?? [],
          m: msgRes.data ?? [],
        });
      };

      lastSignature = await snapshotSignature().catch(() => "");
      safeEnqueue(`event: ready\ndata: ${JSON.stringify({ ok: true, ts: new Date().toISOString() })}\n\n`);

      const startedAt = Date.now();
      const maxWindowMs = 24_000;
      const pollMs = 2_000;

      while (!closed && Date.now() - startedAt < maxWindowMs) {
        await new Promise((r) => setTimeout(r, pollMs));
        if (closed) break;

        try {
          const nextSig = await snapshotSignature();
          if (nextSig && nextSig !== lastSignature) {
            lastSignature = nextSig;
            safeEnqueue(`event: update\ndata: ${JSON.stringify({ changed: true, ts: new Date().toISOString() })}\n\n`);
          } else {
            safeEnqueue(`: keepalive ${Date.now()}\n\n`);
          }
        } catch {
          safeEnqueue(`: keepalive ${Date.now()}\n\n`);
        }
      }

      closeStream();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function handleElevenLabsWhatsAppHandoff(
  request: Request,
  options: {
    escalate?: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  } = {},
): Promise<Response> {
  const token = extractBearerOrSecret(request);
  if (!token) {
    return Response.json(
      { ok: false, error: "Unauthorized ElevenLabs tool request" },
      { status: 401, headers: NO_STORE },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await readBody(request);
  } catch (err) {
    return managedFailure(err);
  }

  const claimedAgentId =
    (typeof body.agent_id === "string" && body.agent_id.trim()) ||
    request.headers.get("x-elevenlabs-agent-id")?.trim() ||
    "";

  const convIdRaw = typeof body.whatsapp_conversation_id === "string" ? body.whatsapp_conversation_id.trim() : "";
  if (convIdRaw && !UUID_RE.test(convIdRaw)) {
    return Response.json({ ok: false, error: "Invalid whatsapp_conversation_id" }, { status: 400, headers: NO_STORE });
  }

  const rpcPayload = {
    credential_token_hash: sha256Hex(token),
    claimed_provider_agent_id: claimedAgentId,
    whatsapp_conversation_id: convIdRaw,
    customer_wa_id: typeof body.customer_wa_id === "string" ? body.customer_wa_id.trim() : "",
    elevenlabs_conversation_id:
      typeof body.elevenlabs_conversation_id === "string" ? body.elevenlabs_conversation_id.trim() : "",
    reason: typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : "顧客要求真人客服協助",
    switch_to_human: body.switch_to_human !== false,
  };

  try {
    const escalateFn =
      options.escalate ??
      (async (payload: Record<string, unknown>) => {
        const { data, error } = await serviceDatabase().rpc("whatsapp_handoff_escalation", { payload });
        if (error || !data || typeof data !== "object") {
          throw new ManagedError("WhatsApp handoff persistence unavailable", 503);
        }
        return data as Record<string, unknown>;
      });

    const result = await escalateFn(rpcPayload);
    if (result.ok !== true) {
      const code = result.error_code;
      const status = code === "unauthorized" ? 401 : code === "agent_mismatch" ? 403 : 404;
      return Response.json({ ok: false, errorCode: code }, { status, headers: NO_STORE });
    }

    return Response.json(
      {
        ok: true,
        handoff: true,
        conversation: result.conversation ?? null,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return managedFailure(err);
  }
}
