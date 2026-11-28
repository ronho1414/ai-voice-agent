import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ManagedError, managedFailure, readBody, serviceDatabase } from "./managed-agent-service";
import { isWhatsAppTextInboxEnabled, whatsAppTextInboxDisabledResponse } from "./whatsapp-flag";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
const GRAPH_VERSION_RE = /^v\d+\.\d+$/;
const PHONE_NUMBER_ID_RE = /^[0-9]{5,32}$/;

export type WhatsAppRuntimeConfig = {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  phoneNumberId: string;
  wabaId: string;
  graphVersion: string;
  appId: string;
  businessId: string;
};

export type WhatsAppWebhookStatusItem = {
  phone_number_id: string;
  waba_id: string;
  wa_message_id: string;
  status: "sent" | "delivered" | "read" | "failed";
  recipient_id: string;
  timestamp_sec: string;
  error_code: string;
  error_title: string;
  error_message: string;
};

export type WhatsAppWebhookMessageItem = {
  phone_number_id: string;
  waba_id: string;
  wa_message_id: string;
  from_wa_id: string;
  from_name: string;
  timestamp_sec: string;
  message_type: "template" | "text" | "interactive" | "image" | "audio" | "document" | "other";
  body_text: string;
  media_metadata?: Record<string, unknown>;
};

export type SendWhatsAppInput =
  | {
      to: string;
      type: "template";
      templateName: string;
      languageCode: string;
      bodyText?: string;
    }
  | {
      to: string;
      type: "text";
      body: string;
      previewUrl?: boolean;
    };

export function readWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppRuntimeConfig {
  const rawVersion = env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v25.0";
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN?.trim() || "",
    appSecret: env.WHATSAPP_APP_SECRET?.trim() || "",
    verifyToken: env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() || "",
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID?.trim() || "",
    wabaId: env.WHATSAPP_WABA_ID?.trim() || "",
    graphVersion: GRAPH_VERSION_RE.test(rawVersion) ? rawVersion : "v25.0",
    appId: env.WHATSAPP_APP_ID?.trim() || "",
    businessId: env.WHATSAPP_BUSINESS_ID?.trim() || "",
  };
}

function sha256Buffer(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function normalizeWhatsAppRecipient(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ManagedError("請提供有效的 WhatsApp 收件人電話號碼。", 400);
  }
  const digits = raw.replace(/[^0-9]/g, "");
  if (!/^[0-9]{8,15}$/.test(digits)) {
    throw new ManagedError("WhatsApp 收件人號碼格式不正確（需 8 至 15 位國際格式數字，例如 85291234567）。", 400);
  }
  return digits;
}

export function verifyWhatsAppChallengeToken(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  return timingSafeEqual(sha256Buffer(provided), sha256Buffer(expected));
}

export function verifyWhatsAppSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!appSecret || !signatureHeader) return false;
  const trimmed = signatureHeader.trim();
  const match = /^sha256=([0-9a-f]{64})$/i.exec(trimmed);
  if (!match) return false;

  const expectedDigest = createHmac("sha256", appSecret).update(rawBody).digest();
  const providedDigest = Buffer.from(match[1], "hex");
  if (expectedDigest.length !== providedDigest.length) return false;
  return timingSafeEqual(expectedDigest, providedDigest);
}

export function parseWhatsAppWebhookPayload(raw: unknown): {
  statuses: WhatsAppWebhookStatusItem[];
  messages: WhatsAppWebhookMessageItem[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManagedError("Malformed WhatsApp webhook payload", 400);
  }
  const root = raw as Record<string, unknown>;
  if (root.object !== "whatsapp_business_account") {
    throw new ManagedError("Unsupported WhatsApp webhook object", 400);
  }

  const statuses: WhatsAppWebhookStatusItem[] = [];
  const messages: WhatsAppWebhookMessageItem[] = [];
  const entries = Array.isArray(root.entry) ? root.entry : [];

  for (const entryRaw of entries) {
    if (!entryRaw || typeof entryRaw !== "object") continue;
    const entry = entryRaw as Record<string, unknown>;
    const wabaId = typeof entry.id === "string" && /^[0-9]{5,32}$/.test(entry.id) ? entry.id : "";
    const changes = Array.isArray(entry.changes) ? entry.changes : [];

    for (const changeRaw of changes) {
      if (!changeRaw || typeof changeRaw !== "object") continue;
      const change = changeRaw as Record<string, unknown>;
      if (change.field !== "messages") continue;
      const value = change.value;
      if (!value || typeof value !== "object") continue;
      const valObj = value as Record<string, unknown>;
      const metadata =
        valObj.metadata && typeof valObj.metadata === "object"
          ? (valObj.metadata as Record<string, unknown>)
          : {};
      const phoneNumberId =
        typeof metadata.phone_number_id === "string" ? metadata.phone_number_id.trim() : "";
      if (!PHONE_NUMBER_ID_RE.test(phoneNumberId)) continue;

      const contactsByWaId = new Map<string, string>();
      if (Array.isArray(valObj.contacts)) {
        for (const c of valObj.contacts) {
          if (!c || typeof c !== "object") continue;
          const contact = c as Record<string, unknown>;
          const waId = typeof contact.wa_id === "string" ? contact.wa_id.replace(/[^0-9]/g, "") : "";
          const profile =
            contact.profile && typeof contact.profile === "object"
              ? (contact.profile as Record<string, unknown>)
              : {};
          const name = typeof profile.name === "string" ? profile.name.trim() : "";
          if (waId && name) contactsByWaId.set(waId, name.slice(0, 120));
        }
      }

      if (Array.isArray(valObj.statuses)) {
        for (const s of valObj.statuses) {
          if (!s || typeof s !== "object") continue;
          const st = s as Record<string, unknown>;
          const waMessageId = typeof st.id === "string" ? st.id.trim().slice(0, 160) : "";
          const status = typeof st.status === "string" ? st.status.trim().toLowerCase() : "";
          if (
            !waMessageId ||
            (status !== "sent" && status !== "delivered" && status !== "read" && status !== "failed")
          ) {
            continue;
          }
          const errorsArr = Array.isArray(st.errors) ? st.errors : [];
          const firstErr =
            errorsArr[0] && typeof errorsArr[0] === "object"
              ? (errorsArr[0] as Record<string, unknown>)
              : null;

          statuses.push({
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
            wa_message_id: waMessageId,
            status,
            recipient_id:
              typeof st.recipient_id === "string" ? st.recipient_id.replace(/[^0-9]/g, "").slice(0, 32) : "",
            timestamp_sec: typeof st.timestamp === "string" || typeof st.timestamp === "number" ? String(st.timestamp) : "",
            error_code: firstErr && firstErr.code != null ? String(firstErr.code).slice(0, 64) : "",
            error_title:
              firstErr && typeof firstErr.title === "string" ? firstErr.title.trim().slice(0, 200) : "",
            error_message:
              firstErr && typeof firstErr.message === "string" ? firstErr.message.trim().slice(0, 1000) : "",
          });
        }
      }

      if (Array.isArray(valObj.messages)) {
        for (const m of valObj.messages) {
          if (!m || typeof m !== "object") continue;
          const msg = m as Record<string, unknown>;
          const waMessageId = typeof msg.id === "string" ? msg.id.trim().slice(0, 160) : "";
          const fromWaId =
            typeof msg.from === "string" ? msg.from.replace(/[^0-9]/g, "").slice(0, 20) : "";
          if (!waMessageId || !/^[0-9]{6,20}$/.test(fromWaId)) continue;

          const rawType = typeof msg.type === "string" ? msg.type.trim().toLowerCase() : "other";
          const msgType = (
            ["template", "text", "interactive", "image", "audio", "document"].includes(rawType)
              ? rawType
              : "other"
          ) as WhatsAppWebhookMessageItem["message_type"];

          let bodyText = "";
          const mediaMetadata: Record<string, unknown> = { raw_type: rawType };

          if (msgType === "text" && msg.text && typeof msg.text === "object") {
            const textObj = msg.text as Record<string, unknown>;
            if (typeof textObj.body === "string") bodyText = textObj.body.trim().slice(0, 4096);
          } else if (msgType === "interactive" && msg.interactive && typeof msg.interactive === "object") {
            const inter = msg.interactive as Record<string, unknown>;
            const replyTitle =
              (inter.button_reply && typeof inter.button_reply === "object"
                ? (inter.button_reply as Record<string, unknown>).title
                : undefined) ??
              (inter.list_reply && typeof inter.list_reply === "object"
                ? (inter.list_reply as Record<string, unknown>).title
                : undefined);
            bodyText =
              typeof replyTitle === "string" && replyTitle.trim()
                ? replyTitle.trim().slice(0, 1000)
                : JSON.stringify(msg.interactive).slice(0, 1000);
            mediaMetadata.interactive = inter;
          } else if (
            (rawType === "image" || rawType === "audio" || rawType === "document" || rawType === "video" || rawType === "sticker") &&
            msg[rawType] &&
            typeof msg[rawType] === "object"
          ) {
            const mediaObj = msg[rawType] as Record<string, unknown>;
            if (typeof mediaObj.id === "string") mediaMetadata.media_id = mediaObj.id.slice(0, 128);
            if (typeof mediaObj.mime_type === "string") mediaMetadata.mime_type = mediaObj.mime_type.slice(0, 128);
            if (typeof mediaObj.sha256 === "string") mediaMetadata.sha256 = mediaObj.sha256.slice(0, 128);
            if (typeof mediaObj.filename === "string") mediaMetadata.filename = mediaObj.filename.slice(0, 255);
            if (typeof mediaObj.caption === "string") {
              mediaMetadata.caption = mediaObj.caption.trim().slice(0, 1024);
              bodyText = mediaObj.caption.trim().slice(0, 4096);
            } else if (typeof mediaObj.filename === "string" && mediaObj.filename.trim()) {
              bodyText = mediaObj.filename.trim().slice(0, 255);
            }
            if (mediaObj.voice === true) mediaMetadata.voice = true;
          } else if (rawType === "location" && msg.location && typeof msg.location === "object") {
            const loc = msg.location as Record<string, unknown>;
            mediaMetadata.location = loc;
            const label = [loc.name, loc.address].filter((v) => typeof v === "string" && v.trim()).join(" - ");
            bodyText = label ? `[位置] ${label}`.slice(0, 500) : "[位置訊息]";
          } else if (rawType === "button" && msg.button && typeof msg.button === "object") {
            const btn = msg.button as Record<string, unknown>;
            if (typeof btn.text === "string") bodyText = btn.text.trim().slice(0, 1000);
            mediaMetadata.button = btn;
          } else if (rawType === "contacts" && Array.isArray(msg.contacts)) {
            mediaMetadata.contacts_count = msg.contacts.length;
            bodyText = `[聯絡人卡片 x${msg.contacts.length}]`;
          }

          messages.push({
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
            wa_message_id: waMessageId,
            from_wa_id: fromWaId,
            from_name: contactsByWaId.get(fromWaId) || "",
            timestamp_sec: typeof msg.timestamp === "string" || typeof msg.timestamp === "number" ? String(msg.timestamp) : "",
            message_type: msgType,
            body_text: bodyText,
            media_metadata: mediaMetadata,
          });
        }
      }
    }
  }

  return { statuses, messages };
}

export async function handleWhatsAppWebhookGet(
  request: Request,
  config: WhatsAppRuntimeConfig = readWhatsAppConfig(),
): Promise<Response> {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  if (!config.verifyToken) {
    return Response.json(
      { ok: false, error: "WhatsApp webhook verification is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode")?.trim() ?? "";
  const token = url.searchParams.get("hub.verify_token")?.trim() ?? "";
  const challenge = url.searchParams.get("hub.challenge") ?? "";

  if (mode !== "subscribe" || !challenge) {
    return Response.json(
      { ok: false, error: "Invalid WhatsApp verification parameters" },
      { status: 400, headers: NO_STORE },
    );
  }

  if (!verifyWhatsAppChallengeToken(token, config.verifyToken)) {
    return Response.json(
      { ok: false, error: "Invalid verify token" },
      { status: 403, headers: NO_STORE },
    );
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
  });
}

export type PersistWhatsAppWebhook = (parsed: {
  statuses: WhatsAppWebhookStatusItem[];
  messages: WhatsAppWebhookMessageItem[];
}) => Promise<Record<string, unknown>>;

async function defaultPersistWebhook(parsed: {
  statuses: WhatsAppWebhookStatusItem[];
  messages: WhatsAppWebhookMessageItem[];
}) {
  const { data, error } = await serviceDatabase().rpc("ingest_whatsapp_webhook", {
    payload: parsed,
  });
  if (error || !data || typeof data !== "object") {
    throw new ManagedError("未能寫入 WhatsApp Webhook 紀錄。", 503);
  }
  return data as Record<string, unknown>;
}

async function verifyChannelSpecificSignature(
  rawBytes: Uint8Array,
  signature: string | null,
  parsedJson: unknown,
): Promise<boolean> {
  if (!signature) return false;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return false;
  }
  try {
    const parsed = parseWhatsAppWebhookPayload(parsedJson);
    const phoneIds = Array.from(
      new Set([
        ...parsed.messages.map((m) => m.phone_number_id),
        ...parsed.statuses.map((s) => s.phone_number_id),
      ]),
    );
    if (phoneIds.length === 0) return false;
    const { data, error } = await serviceDatabase().rpc("list_whatsapp_channel_app_secrets", {
      p_phone_number_ids: phoneIds,
    });
    if (error || !Array.isArray(data) || data.length === 0) return false;
    return data.every((row: { app_secret?: string }) =>
      verifyWhatsAppSignature(rawBytes, signature, typeof row.app_secret === "string" ? row.app_secret : ""),
    );
  } catch {
    return false;
  }
}

export async function handleWhatsAppWebhookPost(
  request: Request,
  options: {
    config?: WhatsAppRuntimeConfig;
    persist?: PersistWhatsAppWebhook;
    onJobsEnqueued?: (count: number) => void;
    verifyChannelSignature?: (rawBytes: Uint8Array, signature: string | null, jsonBody: unknown) => Promise<boolean>;
  } = {},
): Promise<Response> {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  const config = options.config ?? readWhatsAppConfig();
  const hasDb = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!config.appSecret && !hasDb && !options.verifyChannelSignature) {
    return Response.json(
      { ok: false, error: "WhatsApp webhook secret is not configured" },
      { status: 503, headers: NO_STORE },
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WEBHOOK_BYTES) {
    return Response.json(
      { ok: false, error: "Payload too large" },
      { status: 413, headers: NO_STORE },
    );
  }

  const reader = request.body?.getReader();
  if (!reader) {
    return Response.json(
      { ok: false, error: "Missing body" },
      { status: 400, headers: NO_STORE },
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return Response.json(
        { ok: false, error: "Payload too large" },
        { status: 413, headers: NO_STORE },
      );
    }
    chunks.push(next.value);
  }
  const rawBytes = Buffer.concat(chunks);

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(rawBytes.toString("utf8"));
  } catch {
    const signaturePrecheck = request.headers.get("x-hub-signature-256");
    if (!config.appSecret || !verifyWhatsAppSignature(rawBytes, signaturePrecheck, config.appSecret)) {
      return Response.json(
        { ok: false, error: "Invalid signature" },
        { status: 401, headers: NO_STORE },
      );
    }
    return Response.json(
      { ok: false, error: "Malformed JSON payload" },
      { status: 400, headers: NO_STORE },
    );
  }

  const signature = request.headers.get("x-hub-signature-256");
  const platformVerified = config.appSecret ? verifyWhatsAppSignature(rawBytes, signature, config.appSecret) : false;
  const channelVerified = platformVerified
    ? true
    : options.verifyChannelSignature
      ? await options.verifyChannelSignature(rawBytes, signature, jsonBody)
      : await verifyChannelSpecificSignature(rawBytes, signature, jsonBody);

  if (!channelVerified) {
    return Response.json(
      { ok: false, error: "Invalid signature" },
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const parsed = parseWhatsAppWebhookPayload(jsonBody);
    const persist = options.persist ?? defaultPersistWebhook;
    const summary = await persist(parsed);
    const aiJobsEnqueued =
      typeof summary.ai_jobs_enqueued === "number" ? summary.ai_jobs_enqueued : 0;
    if (aiJobsEnqueued > 0 && options.onJobsEnqueued) {
      options.onJobsEnqueued(aiJobsEnqueued);
    }
    return Response.json({ ok: true, ...summary }, { status: 200, headers: NO_STORE });
  } catch (err) {
    return managedFailure(err);
  }
}

export function parseSendWhatsAppInput(raw: Record<string, unknown>): SendWhatsAppInput {
  const to = normalizeWhatsAppRecipient(raw.to);
  const mode = typeof raw.type === "string" ? raw.type.trim().toLowerCase() : "template";

  if (mode === "text") {
    const body = typeof raw.body === "string" ? raw.body.trim() : "";
    if (!body || [...body].length > 4096) {
      throw new ManagedError("請提供 1 至 4,096 字的 WhatsApp 訊息內容。", 400);
    }
    return {
      to,
      type: "text",
      body,
      previewUrl: raw.previewUrl === true,
    };
  }

  if (mode !== "template") {
    throw new ManagedError("不支援的 WhatsApp 訊息類型（僅支援 template 或 text）。", 400);
  }

  const templateName = typeof raw.templateName === "string" && raw.templateName.trim()
    ? raw.templateName.trim()
    : "hello_world";
  if (!/^[a-z0-9_]{1,128}$/.test(templateName)) {
    throw new ManagedError("WhatsApp 範本名稱格式不正確。", 400);
  }
  const languageCode = typeof raw.languageCode === "string" && raw.languageCode.trim()
    ? raw.languageCode.trim()
    : "en_US";
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(languageCode)) {
    throw new ManagedError("WhatsApp 範本語言代碼格式不正確。", 400);
  }
  const bodyText = typeof raw.bodyText === "string" ? raw.bodyText.trim().slice(0, 1000) : "";
  return { to, type: "template", templateName, languageCode, bodyText };
}

export type RecordOutboundWhatsApp = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type ReserveOutboundResult =
  | { action: "reserved"; record: Record<string, unknown> }
  | { action: "replay"; record: Record<string, unknown> }
  | { action: "in_flight"; record: Record<string, unknown> }
  | { action: "previous_failed"; record: Record<string, unknown> }
  | { action: "conflict" }
  | { action: "unmapped_channel" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseReconcileWhatsAppInput(raw: Record<string, unknown>, headerIdemKey: string): {
  reservationId: string;
  idempotencyKey: string;
  waMessageId: string;
  status: "sent" | "failed";
  errorCode: string;
  errorTitle: string;
  errorMessage: string;
} {
  const reservationId = typeof raw.reservationId === "string" ? raw.reservationId.trim() : "";
  const idempotencyKey =
    headerIdemKey || (typeof raw.idempotencyKey === "string" ? raw.idempotencyKey.trim() : "");
  if (reservationId && !UUID_RE.test(reservationId)) {
    throw new ManagedError("reservationId 格式不正確。", 400);
  }
  if (!reservationId && !idempotencyKey) {
    throw new ManagedError("對帳需要提供 reservationId 或 idempotencyKey。", 400);
  }
  if ([...idempotencyKey].length > 160) {
    throw new ManagedError("idempotencyKey 長度不可超過 160 字元。", 400);
  }
  const statusRaw = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "sent";
  if (statusRaw !== "sent" && statusRaw !== "failed") {
    throw new ManagedError("對帳狀態僅支援 sent 或 failed。", 400);
  }
  const waMessageId = typeof raw.waMessageId === "string" ? raw.waMessageId.trim() : "";
  if (statusRaw === "sent" && (!waMessageId || waMessageId.length > 128)) {
    throw new ManagedError("對帳為 sent 時必須提供有效的 waMessageId。", 400);
  }
  return {
    reservationId,
    idempotencyKey,
    waMessageId: waMessageId.slice(0, 128),
    status: statusRaw,
    errorCode: typeof raw.errorCode === "string" ? raw.errorCode.trim().slice(0, 64) : "",
    errorTitle: typeof raw.errorTitle === "string" ? raw.errorTitle.trim().slice(0, 200) : "",
    errorMessage: typeof raw.errorMessage === "string" ? raw.errorMessage.trim().slice(0, 400) : "",
  };
}

export type ReserveOutboundWhatsApp = (payload: Record<string, unknown>) => Promise<ReserveOutboundResult>;
export type FinalizeOutboundWhatsApp = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

async function defaultReserveOutbound(payload: Record<string, unknown>): Promise<ReserveOutboundResult> {
  const { data, error } = await serviceDatabase().rpc("reserve_whatsapp_outbound", { payload });
  if (error || !data || typeof data !== "object") {
    throw new ManagedError("未能保留 WhatsApp 發送紀錄，已中止送出以免重複發訊。", 503);
  }
  return data as ReserveOutboundResult;
}

async function defaultFinalizeOutbound(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await serviceDatabase().rpc("finalize_whatsapp_outbound", { payload });
  if (error || !data || typeof data !== "object") {
    throw new ManagedError("WhatsApp 訊息紀錄儲存失敗。", 503);
  }
  return data as Record<string, unknown>;
}

export async function handleAdminWhatsAppSend(
  request: Request,
  options: {
    config?: WhatsAppRuntimeConfig;
    fetchImpl?: typeof fetch;
    reserve?: ReserveOutboundWhatsApp;
    finalize?: FinalizeOutboundWhatsApp;
    record?: RecordOutboundWhatsApp;
  } = {},
): Promise<Response> {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  const config = options.config ?? readWhatsAppConfig();
  if (!config.accessToken || !PHONE_NUMBER_ID_RE.test(config.phoneNumberId)) {
    return Response.json(
      { ok: false, error: "WhatsApp Cloud API 尚未完成憑證設定（WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID）。" },
      { status: 503, headers: NO_STORE },
    );
  }

  let rawBody: Record<string, unknown>;
  const headerIdemKey = request.headers.get("x-idempotency-key")?.trim() || "";
  const finalizeFn: FinalizeOutboundWhatsApp =
    options.finalize ?? options.record ?? defaultFinalizeOutbound;

  try {
    rawBody = await readBody(request);
  } catch (err) {
    return managedFailure(err);
  }

  if (typeof rawBody.action === "string" && rawBody.action.trim().toLowerCase() === "reconcile") {
    try {
      const rec = parseReconcileWhatsAppInput(rawBody, headerIdemKey);
      const persisted = await finalizeFn({
        ...(rec.reservationId ? { id: rec.reservationId } : {}),
        phone_number_id: config.phoneNumberId,
        ...(rec.idempotencyKey ? { idempotency_key: rec.idempotencyKey } : {}),
        status: rec.status,
        wa_message_id: rec.waMessageId,
        error_code: rec.errorCode,
        error_title: rec.errorTitle,
        error_message: rec.errorMessage,
        metadata: {
          graph_version: config.graphVersion,
          reconciled: true,
          reconciled_at: new Date().toISOString(),
        },
      });
      const persistedIdemKey =
        typeof persisted.idempotency_key === "string" && persisted.idempotency_key
          ? persisted.idempotency_key
          : rec.idempotencyKey;
      const persistedReservationId =
        typeof persisted.id === "string" && persisted.id ? persisted.id : rec.reservationId;
      const persistedWamid =
        typeof persisted.wa_message_id === "string" && persisted.wa_message_id
          ? persisted.wa_message_id
          : rec.waMessageId;
      return Response.json(
        {
          ok: true,
          reconciled: true,
          waMessageId: persistedWamid,
          status: typeof persisted.status === "string" ? persisted.status : rec.status,
          reservationId: persistedReservationId,
          idempotencyKey: persistedIdemKey,
          record: persisted,
        },
        { status: 200, headers: NO_STORE },
      );
    } catch (err) {
      return managedFailure(err);
    }
  }

  let input: SendWhatsAppInput;
  try {
    input = parseSendWhatsAppInput(rawBody);
  } catch (err) {
    return managedFailure(err);
  }

  const rawIdemKey =
    headerIdemKey ||
    (typeof rawBody.idempotencyKey === "string" ? rawBody.idempotencyKey.trim() : "") ||
    randomUUID();
  if ([...rawIdemKey].length > 160) {
    return Response.json(
      { ok: false, error: "idempotencyKey 長度不可超過 160 字元。" },
      { status: 400, headers: NO_STORE },
    );
  }
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({ phoneNumberId: config.phoneNumberId, ...input }), "utf8")
    .digest("hex");

  const reserveFn: ReserveOutboundWhatsApp =
    options.reserve ??
    (options.record
      ? async (p) => ({ action: "reserved", record: { id: randomUUID(), ...p } })
      : defaultReserveOutbound);

  let reservedRowId = "";
  try {
    const reservation = await reserveFn({
      phone_number_id: config.phoneNumberId,
      waba_id: config.wabaId,
      peer_wa_id: input.to,
      message_type: input.type,
      template_name: input.type === "template" ? input.templateName : "",
      body_text: input.type === "text" ? input.body : input.bodyText || "",
      idempotency_key: rawIdemKey,
      payload_hash: payloadHash,
      metadata: { graph_version: config.graphVersion, integration_mode: "orai_admin_staging_test" },
    });

    if (reservation.action === "unmapped_channel") {
      return Response.json(
        { ok: false, error: "此 WhatsApp Phone Number ID 尚未於平台註冊或已停用。" },
        { status: 404, headers: NO_STORE },
      );
    }
    if (reservation.action === "conflict") {
      return Response.json(
        { ok: false, retrySafe: false, idempotencyKey: rawIdemKey, error: "相同的 idempotencyKey 不可用於不同收件人或訊息內容。" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (reservation.action === "replay") {
      const existing = reservation.record;
      const existingIdemKey =
        typeof existing.idempotency_key === "string" && existing.idempotency_key
          ? existing.idempotency_key
          : rawIdemKey;
      return Response.json(
        {
          ok: true,
          replayed: true,
          waMessageId: typeof existing.wa_message_id === "string" ? existing.wa_message_id : "",
          status: typeof existing.status === "string" ? existing.status : "sent",
          idempotencyKey: existingIdemKey,
          record: existing,
        },
        { status: 200, headers: NO_STORE },
      );
    }
    if (reservation.action === "previous_failed") {
      const existing = reservation.record;
      const existingIdemKey =
        typeof existing.idempotency_key === "string" && existing.idempotency_key
          ? existing.idempotency_key
          : rawIdemKey;
      return Response.json(
        {
          ok: false,
          replayed: false,
          retrySafe: false,
          reconciliationRequired: false,
          previousStatus: "failed",
          reservationId: typeof existing.id === "string" ? existing.id : "",
          idempotencyKey: existingIdemKey,
          error: "此 idempotencyKey 先前發送失敗；請確認狀態後改用新的 idempotencyKey 重新送出。",
        },
        { status: 409, headers: NO_STORE },
      );
    }
    if (reservation.action === "in_flight") {
      const existing = reservation.record;
      const existingIdemKey =
        typeof existing.idempotency_key === "string" && existing.idempotency_key
          ? existing.idempotency_key
          : rawIdemKey;
      return Response.json(
        {
          ok: false,
          replayed: false,
          retrySafe: false,
          reconciliationRequired: true,
          reservationId: typeof existing.id === "string" ? existing.id : "",
          idempotencyKey: existingIdemKey,
          error: "相同請求正在發送中或尚待對帳，已攔截重複送出。",
        },
        { status: 409, headers: NO_STORE },
      );
    }
    reservedRowId = typeof reservation.record.id === "string" ? reservation.record.id : "";
  } catch (err) {
    return managedFailure(err);
  }

  const endpoint = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  const graphBody =
    input.type === "template"
      ? {
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: input.templateName,
            language: { code: input.languageCode },
          },
        }
      : {
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: input.to,
          type: "text",
          text: {
            preview_url: Boolean(input.previewUrl),
            body: input.body,
          },
        };

  const fetchFn = options.fetchImpl ?? fetch;
  let graphStatus = 0;
  let graphJson: Record<string, unknown> = {};
  try {
    const res = await fetchFn(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(graphBody),
    });
    graphStatus = res.status;
    graphJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    try {
      await finalizeFn({
        id: reservedRowId,
        status: "failed",
        error_code: "NETWORK_ERR",
        error_title: "Graph API Connection Failed",
        error_message: "無法連線至 Meta WhatsApp Cloud API。",
        metadata: { graph_version: config.graphVersion },
      });
    } catch {
      // Reserve row stays in 'queued' for manual reconciliation; retrySafe stays false.
    }
    return Response.json(
      {
        ok: false,
        retrySafe: false,
        reconciliationRequired: true,
        reservationId: reservedRowId,
        idempotencyKey: rawIdemKey,
        error: "無法連線至 Meta WhatsApp Cloud API。",
      },
      { status: 502, headers: NO_STORE },
    );
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

  if (graphStatus < 200 || graphStatus >= 300 || !waMessageId) {
    const errCode = graphErr && graphErr.code != null ? String(graphErr.code) : String(graphStatus || "GRAPH_ERR");
    const errTitle = graphErr && typeof graphErr.type === "string" ? graphErr.type : "Meta Cloud API Error";
    const errMessage =
      graphErr && typeof graphErr.message === "string"
        ? graphErr.message.slice(0, 400)
        : "WhatsApp 訊息傳送失敗，請檢查收件人測試白名單、Token 權限及範本設定。";

    try {
      await finalizeFn({
        id: reservedRowId,
        status: "failed",
        error_code: errCode,
        error_title: errTitle,
        error_message: errMessage,
        metadata: { graph_version: config.graphVersion, http_status: graphStatus },
      });
    } catch {
      // Best-effort failure log; never expose token or suppress the failure response
    }

    return Response.json(
      {
        ok: false,
        error: errMessage,
        errorCode: errCode,
        reservationId: reservedRowId,
        idempotencyKey: rawIdemKey,
      },
      { status: graphStatus >= 400 && graphStatus < 500 ? 422 : 502, headers: NO_STORE },
    );
  }

  try {
    const persisted = await finalizeFn({
      id: reservedRowId,
      status: "sent",
      wa_message_id: waMessageId,
      metadata: { graph_version: config.graphVersion, messaging_product: "whatsapp" },
    });

    return Response.json(
      {
        ok: true,
        replayed: false,
        waMessageId,
        status: "sent",
        idempotencyKey: rawIdemKey,
        record: persisted,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    return Response.json(
      {
        ok: false,
        acceptedByMeta: true,
        persisted: false,
        reconciliationRequired: true,
        retrySafe: false,
        waMessageId,
        reservationId: reservedRowId,
        idempotencyKey: rawIdemKey,
        error: "Meta 已接受並送出訊息，但儲存資料庫紀錄失敗；請勿重試發送，請先進行狀態對帳。",
      },
      { status: 503, headers: NO_STORE },
    );
  }
}

export async function handleAdminWhatsAppStatus(
  config: WhatsAppRuntimeConfig = readWhatsAppConfig(),
): Promise<Response> {
  if (!isWhatsAppTextInboxEnabled()) return whatsAppTextInboxDisabledResponse();
  const dbConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!dbConfigured) {
    return Response.json(
      { ok: false, error: "WhatsApp 資料庫未設定，無法讀取訊息紀錄。" },
      { status: 503, headers: NO_STORE },
    );
  }

  try {
    const db = serviceDatabase();
    const [msgsRes, evRes] = await Promise.all([
      db
        .from("whatsapp_messages")
        .select("id,scope,organization_id,phone_number_id,direction,wa_message_id,peer_wa_id,peer_name,message_type,template_name,body_text,status,idempotency_key,error_code,error_title,error_message,sent_at,delivered_at,read_at,failed_at,received_at,created_at")
        .eq("scope", "admin")
        .order("created_at", { ascending: false })
        .limit(30),
      db
        .from("whatsapp_status_events")
        .select("id,whatsapp_message_id,wa_message_id,status,recipient_id,error_code,error_title,error_message,provider_timestamp,created_at")
        .eq("scope", "admin")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (msgsRes.error || evRes.error) {
      return Response.json(
        { ok: false, error: "未能讀取 WhatsApp 訊息及狀態紀錄。" },
        { status: 503, headers: NO_STORE },
      );
    }

    return Response.json(
      {
        ok: true,
        configured: {
          integrationMode: "orai_admin_staging_test",
          accessToken: Boolean(config.accessToken),
          appSecret: Boolean(config.appSecret),
          verifyToken: Boolean(config.verifyToken),
          phoneNumberId: config.phoneNumberId || null,
          wabaId: config.wabaId || null,
          appId: config.appId || null,
          businessId: config.businessId || null,
          graphVersion: config.graphVersion,
        },
        messages: msgsRes.data ?? [],
        events: evRes.data ?? [],
      },
      { status: 200, headers: NO_STORE },
    );
  } catch {
    return Response.json(
      { ok: false, error: "未能讀取 WhatsApp 紀錄。" },
      { status: 503, headers: NO_STORE },
    );
  }
}
