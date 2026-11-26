import { createHash, timingSafeEqual } from "node:crypto";
import { serviceDatabase, ManagedError, managedFailure, readBody, uuid } from "./managed-agent-service";
import { requestSupabase } from "./supabase-auth";
import type { PlatformSession } from "./types";
import {
  DEFAULT_MARKETING_AGENT_ID,
  detectElevenLabsChannel,
  MESSAGE_CATEGORIES,
  MESSAGE_STATUSES,
  MessageInputError,
  parseCreateMessageInput,
  readTrustedIdentifier,
  resolveMessageIdempotencyKey,
  type CreateMessageInput,
  type InboxMessage,
  type MessageChannel,
  type MessageCounts,
  type MessageEvent,
  type MessageInternalNote,
  type MessageLinkedConversation,
} from "./messages";

export function configuredMarketingAgentId(): string {
  return process.env.ORAI_MARKETING_AGENT_ID?.trim() || DEFAULT_MARKETING_AGENT_ID;
}

export function computeMessagePayloadHash(input: CreateMessageInput, channel: MessageChannel): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        channel,
        senderName: input.senderName,
        contactPhone: input.contactPhone,
        recipientName: input.recipientName,
        messageContent: input.messageContent,
        messageSummary: input.messageSummary,
        category: input.category,
        preferredCallbackTime: input.preferredCallbackTime,
      }),
    )
    .digest("hex");
}

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_TOOL_BODY_BYTES = 32 * 1024;

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function extractBearerOrSecret(request: Request): string {
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return request.headers.get("x-orai-tool-secret")?.trim() ?? "";
}

export function isValidToolSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(sha256Buffer(provided), sha256Buffer(expected));
}

export type PersistMessageRpc = (
  payload: Record<string, unknown>,
) => Promise<{ ok: boolean; replayed?: boolean; error_code?: string; message?: InboxMessage }>;

async function defaultPersistMessage(payload: Record<string, unknown>) {
  const db = serviceDatabase();
  const { data, error } = await db.rpc("create_elevenlabs_message", { payload });
  if (error) {
    if ((error.message || "").includes("conflict: idempotency key reused")) {
      throw new MessageInputError("Idempotency key reused for different message content", 409);
    }
    throw new MessageInputError("Message persistence unavailable", 503);
  }
  if (!data || typeof data !== "object") {
    throw new MessageInputError("Unexpected persistence response", 503);
  }
  return data as { ok: boolean; replayed?: boolean; error_code?: string; message?: InboxMessage };
}

export async function handleCreateElevenLabsMessage(
  request: Request,
  options: {
    marketingSecret?: string | undefined;
    secret?: string | undefined;
    marketingAgentId?: string | undefined;
    persist?: PersistMessageRpc;
  } = {},
): Promise<Response> {
  const marketingSecret = (
    options.marketingSecret ??
    options.secret ??
    process.env.ELEVENLABS_MARKETING_TOOL_SECRET ??
    process.env.ELEVENLABS_SERVER_TOOL_SECRET
  )?.trim() ?? "";

  const dbConfigured = Boolean(
    options.persist ||
      (process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
  );

  if (!marketingSecret && !dbConfigured) {
    return Response.json(
      { ok: false, recorded: false, error: "Server tool authentication is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const providedSecret = extractBearerOrSecret(request);
  if (!providedSecret) {
    return Response.json(
      { ok: false, recorded: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const isMarketingToken = Boolean(
    marketingSecret && isValidToolSecret(providedSecret, marketingSecret),
  );
  if (!isMarketingToken && !dbConfigured) {
    return Response.json(
      { ok: false, recorded: false, error: "Unauthorized" },
      { status: 401, headers: NO_STORE },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_TOOL_BODY_BYTES) {
    return Response.json(
      { ok: false, recorded: false, error: "Payload too large" },
      { status: 413, headers: NO_STORE },
    );
  }

  let rawBodyText = "";
  try {
    rawBodyText = await request.text();
  } catch {
    return Response.json(
      { ok: false, recorded: false, error: "Missing request body" },
      { status: 400, headers: NO_STORE },
    );
  }
  if (Buffer.byteLength(rawBodyText, "utf8") > MAX_TOOL_BODY_BYTES) {
    return Response.json(
      { ok: false, recorded: false, error: "Payload too large" },
      { status: 413, headers: NO_STORE },
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBodyText);
  } catch {
    return Response.json(
      { ok: false, recorded: false, error: "Malformed JSON body" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const url = new URL(request.url);
    // Optional agent header is verified against the credential's bound agent identity;
    // callers can never impersonate another agent or merchant.
    const claimedAgentId = readTrustedIdentifier(
      request.headers.get("x-elevenlabs-agent-id") ?? url.searchParams.get("agent_id"),
      "trusted agent identity",
      false,
    );
    const providerConversationId = readTrustedIdentifier(
      request.headers.get("x-elevenlabs-conversation-id") ?? url.searchParams.get("conversation_id"),
      "conversation identity",
      false,
    );

    const marketingAgentId = (options.marketingAgentId ?? configuredMarketingAgentId()).trim();
    if (isMarketingToken) {
      if (!marketingAgentId) {
        return Response.json(
          { ok: false, recorded: false, error: "Marketing agent identity is not configured" },
          { status: 503, headers: NO_STORE },
        );
      }
      if (claimedAgentId && claimedAgentId !== marketingAgentId) {
        return Response.json(
          { ok: false, recorded: false, error: "Agent credential does not match agent identity" },
          { status: 403, headers: NO_STORE },
        );
      }
    }

    const knownWaIds = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
      ? [process.env.WHATSAPP_PHONE_NUMBER_ID.trim()]
      : [];
    const { channel, calledNumber } = detectElevenLabsChannel({
      rawChannelHeader: request.headers.get("x-elevenlabs-channel"),
      callerHeader: request.headers.get("x-elevenlabs-caller-id"),
      calledNumberHeader: request.headers.get("x-elevenlabs-called-number"),
      knownWhatsAppPhoneIds: knownWaIds,
    });

    const parsedInput = parseCreateMessageInput(parsedJson);
    const payloadHash = computeMessagePayloadHash(parsedInput, channel);

    const explicitKey =
      request.headers.get("x-idempotency-key")?.trim() ||
      request.headers.get("x-elevenlabs-tool-call-id")?.trim() ||
      "";
    const idempotencyKey = resolveMessageIdempotencyKey({
      explicitKey,
      providerConversationId,
      payloadHash,
    });

    const credentialTokenHash = isMarketingToken
      ? ""
      : createHash("sha256").update(providedSecret, "utf8").digest("hex");

    const persist = options.persist ?? defaultPersistMessage;
    const rpcResult = await persist({
      auth_mode: isMarketingToken ? "marketing" : "agent_token",
      credential_token_hash: credentialTokenHash,
      claimed_provider_agent_id: claimedAgentId,
      marketing_agent_id: marketingAgentId,
      provider_conversation_id: providerConversationId,
      called_number: calledNumber,
      channel,
      sender_name: parsedInput.senderName,
      contact_phone: parsedInput.contactPhone,
      recipient_name: parsedInput.recipientName,
      message_content: parsedInput.messageContent,
      message_summary: parsedInput.messageSummary,
      category: parsedInput.category,
      preferred_callback_time: parsedInput.preferredCallbackTime,
      idempotency_key: idempotencyKey,
      payload_hash: payloadHash,
    });

    if (!rpcResult.ok || !rpcResult.message) {
      if (rpcResult.error_code === "unauthorized") {
        return Response.json(
          { ok: false, recorded: false, error: "Unauthorized" },
          { status: 401, headers: NO_STORE },
        );
      }
      if (rpcResult.error_code === "agent_mismatch") {
        return Response.json(
          { ok: false, recorded: false, error: "Agent credential does not match agent identity" },
          { status: 403, headers: NO_STORE },
        );
      }
      if (rpcResult.error_code === "unknown_agent") {
        return Response.json(
          { ok: false, recorded: false, error: "Agent is not provisioned or inactive" },
          { status: 404, headers: NO_STORE },
        );
      }
      return Response.json(
        { ok: false, recorded: false, error: "Message persistence failed" },
        { status: 503, headers: NO_STORE },
      );
    }

    const msg = rpcResult.message;
    return Response.json(
      {
        ok: true,
        recorded: true,
        replayed: Boolean(rpcResult.replayed),
        messageId: msg.id,
        reference: msg.reference,
        status: msg.status,
        category: msg.category,
        summary: msg.message_summary,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    if (err instanceof MessageInputError || err instanceof ManagedError) {
      return Response.json(
        { ok: false, recorded: false, error: err.message },
        { status: err.status, headers: NO_STORE },
      );
    }
    return Response.json(
      { ok: false, recorded: false, error: "Message persistence unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function listMessagesOrDetail(
  request: Request,
  session: PlatformSession,
  admin: boolean,
): Promise<Record<string, unknown>> {
  const db = requestSupabase(request);
  const url = new URL(request.url);
  const scope = admin ? "admin" : "merchant";
  const id = url.searchParams.get("id");

  if (id) {
    let query = db
      .from("messages")
      .select("*")
      .eq("id", uuid(id))
      .eq("inbox_scope", scope);
    if (!admin) query = query.eq("organization_id", session.organizationId!);
    const { data: msg, error } = await query.maybeSingle();
    if (error) throw new ManagedError("未能載入留言詳情。", 503);
    if (!msg) throw new ManagedError("留言不存在或沒有權限。", 404);

    const typedMsg = msg as InboxMessage;
    const [eventsRes, notesRes, convRes] = await Promise.all([
      db
        .from("message_events")
        .select("id,message_id,actor_id,actor_label,kind,from_status,to_status,detail,created_at")
        .eq("message_id", typedMsg.id)
        .order("created_at", { ascending: true }),
      db
        .from("message_internal_notes")
        .select("id,message_id,actor_id,actor_label,note,created_at")
        .eq("message_id", typedMsg.id)
        .order("created_at", { ascending: true }),
      !admin && typedMsg.conversation_id
        ? db
            .from("conversations")
            .select("id,channel,caller_phone,caller_name,duration_seconds,summary,created_at,transcript")
            .eq("id", typedMsg.conversation_id)
            .eq("organization_id", session.organizationId!)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (eventsRes.error || notesRes.error || convRes.error) {
      throw new ManagedError("未能載入留言紀錄。", 503);
    }

    return {
      message: typedMsg,
      events: (eventsRes.data ?? []) as MessageEvent[],
      internal_notes: (notesRes.data ?? []) as MessageInternalNote[],
      linked_conversation: (convRes.data ?? null) as MessageLinkedConversation | null,
    };
  }

  const page = Math.max(1, Math.min(10000, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1));
  const pageSize = 30;
  let query = db.from("messages").select("*", { count: "exact" }).eq("inbox_scope", scope);
  if (!admin) query = query.eq("organization_id", session.organizationId!);

  const status = url.searchParams.get("status")?.trim();
  if (status) {
    if (!(MESSAGE_STATUSES as readonly string[]).includes(status)) {
      throw new ManagedError("狀態篩選不正確。");
    }
    query = query.eq("status", status);
  }

  const category = url.searchParams.get("category")?.trim();
  if (category) {
    if (!(MESSAGE_CATEGORIES as readonly string[]).includes(category)) {
      throw new ManagedError("分類篩選不正確。");
    }
    query = query.eq("category", category);
  }

  const search = url.searchParams.get("search")?.trim();
  if (search) {
    if (search.length > 100) throw new ManagedError("搜尋關鍵字過長。");
    const safe = search.replace(/[%,_()]/g, "").trim();
    if (safe) {
      const pattern = `%${safe}%`;
      query = query.or(
        `reference.ilike.${pattern},sender_name.ilike.${pattern},contact_phone.ilike.${pattern},recipient_name.ilike.${pattern},message_summary.ilike.${pattern},message_content.ilike.${pattern}`,
      );
    }
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (error) throw new ManagedError("未能載入留言列表。", 503);

  const countQueries = await Promise.all(
    MESSAGE_STATUSES.map(async (st) => {
      let q = db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("inbox_scope", scope)
        .eq("status", st);
      if (!admin) q = q.eq("organization_id", session.organizationId!);
      const { count: c, error: cErr } = await q;
      if (cErr) throw new ManagedError("未能載入留言統計。", 503);
      return [st, c ?? 0] as const;
    }),
  );

  const counts: MessageCounts = {
    pending: countQueries[0][1],
    in_progress: countQueries[1][1],
    completed: countQueries[2][1],
    total: countQueries[0][1] + countQueries[1][1] + countQueries[2][1],
  };

  return {
    messages: (data ?? []) as InboxMessage[],
    counts,
    total: count ?? 0,
    page,
    pageSize,
  };
}

export async function handleMessagePatch(
  request: Request,
  session: PlatformSession,
): Promise<Response> {
  try {
    const body = await readBody(request);
    const allowed = ["id", "action", "status", "expected_version", "note"];
    if (Object.keys(body).some((k) => !allowed.includes(k))) {
      throw new ManagedError("包含不允許修改的欄位。");
    }

    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action !== "update_status" && action !== "add_note") {
      throw new ManagedError("不支援的留言操作。");
    }

    const id = uuid(body.id);
    const payload: Record<string, unknown> = { id };

    if (action === "update_status") {
      if (!Number.isSafeInteger(body.expected_version) || (body.expected_version as number) < 1) {
        throw new ManagedError("版本不正確，請重新載入。");
      }
      const nextStatus = typeof body.status === "string" ? body.status.trim() : "";
      if (!(MESSAGE_STATUSES as readonly string[]).includes(nextStatus)) {
        throw new ManagedError("留言狀態不正確。");
      }
      payload.expected_version = body.expected_version;
      payload.status = nextStatus;
    } else {
      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (!note || [...note].length > 2000) {
        throw new ManagedError("請填寫內部跟進備註，最多 2,000 字。");
      }
      payload.note = note;
    }

    const { data, error } = await serviceDatabase().rpc("message_inbox_command", {
      actor_id: session.userId,
      tenant_id: session.organizationId || null,
      operation: action,
      payload,
    });

    if (error) {
      if ((error.message || "").includes("conflict: message changed")) {
        throw new ManagedError("留言狀態已由其他用戶更新，請重新整理後再試。", 409);
      }
      if (error.code === "42501") {
        throw new ManagedError("你沒有權限更新這則留言。", 403);
      }
      if (["P0001", "23514", "22P02", "23502", "22023"].includes(error.code || "")) {
        throw new ManagedError("留言狀態或備註內容不正確。", 400);
      }
      throw new ManagedError("未能儲存留言更新，請稍後重試。", 503);
    }

    return Response.json({ message: data }, { headers: NO_STORE });
  } catch (err) {
    return managedFailure(err);
  }
}
