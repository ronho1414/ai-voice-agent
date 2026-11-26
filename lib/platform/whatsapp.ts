import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ManagedError, managedFailure, readBody, serviceDatabase } from "./managed-agent-service";

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
          if (msgType === "text" && msg.text && typeof msg.text === "object") {
            const textObj = msg.text as Record<string, unknown>;
            if (typeof textObj.body === "string") bodyText = textObj.body.trim().slice(0, 4096);
          } else if (msgType === "interactive" && msg.interactive && typeof msg.interactive === "object") {
            bodyText = JSON.stringify(msg.interactive).slice(0, 1000);
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

export async function handleWhatsAppWebhookPost(
  request: Request,
  options: {
    config?: WhatsAppRuntimeConfig;
    persist?: PersistWhatsAppWebhook;
  } = {},
): Promise<Response> {
  const config = options.config ?? readWhatsAppConfig();
  if (!config.appSecret) {
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

  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWhatsAppSignature(rawBytes, signature, config.appSecret)) {
    return Response.json(
      { ok: false, error: "Invalid signature" },
      { status: 401, headers: NO_STORE },
    );
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(rawBytes.toString("utf8"));
  } catch {
    return Response.json(
      { ok: false, error: "Malformed JSON payload" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const parsed = parseWhatsAppWebhookPayload(jsonBody);
    const persist = options.persist ?? defaultPersistWebhook;
    const summary = await persist(parsed);
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

async function defaultRecordOutbound(payload: Record<string, unknown>) {
  const { data, error } = await serviceDatabase().rpc("record_whatsapp_outbound", { payload });
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
    record?: RecordOutboundWhatsApp;
  } = {},
): Promise<Response> {
  const config = options.config ?? readWhatsAppConfig();
  if (!config.accessToken || !PHONE_NUMBER_ID_RE.test(config.phoneNumberId)) {
    return Response.json(
      { ok: false, error: "WhatsApp Cloud API 尚未完成憑證設定（WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID）。" },
      { status: 503, headers: NO_STORE },
    );
  }

  let input: SendWhatsAppInput;
  try {
    input = parseSendWhatsAppInput(await readBody(request));
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
    return Response.json(
      { ok: false, error: "無法連線至 Meta WhatsApp Cloud API。" },
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

  const recordFn = options.record ?? defaultRecordOutbound;
  if (graphStatus < 200 || graphStatus >= 300 || !waMessageId) {
    const errCode = graphErr && graphErr.code != null ? String(graphErr.code) : String(graphStatus || "GRAPH_ERR");
    const errTitle = graphErr && typeof graphErr.type === "string" ? graphErr.type : "Meta Cloud API Error";
    const errMessage =
      graphErr && typeof graphErr.message === "string"
        ? graphErr.message.slice(0, 400)
        : "WhatsApp 訊息傳送失敗，請檢查收件人測試白名單、Token 權限及範本設定。";

    try {
      await recordFn({
        phone_number_id: config.phoneNumberId,
        waba_id: config.wabaId,
        wa_message_id: "",
        peer_wa_id: input.to,
        message_type: input.type,
        template_name: input.type === "template" ? input.templateName : "",
        body_text: input.type === "text" ? input.body : input.bodyText || "",
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
      },
      { status: graphStatus >= 400 && graphStatus < 500 ? 422 : 502, headers: NO_STORE },
    );
  }

  try {
    const persisted = await recordFn({
      phone_number_id: config.phoneNumberId,
      waba_id: config.wabaId,
      wa_message_id: waMessageId,
      peer_wa_id: input.to,
      message_type: input.type,
      template_name: input.type === "template" ? input.templateName : "",
      body_text: input.type === "text" ? input.body : input.bodyText || "",
      status: "sent",
      metadata: { graph_version: config.graphVersion, messaging_product: "whatsapp" },
    });

    return Response.json(
      {
        ok: true,
        waMessageId,
        status: "sent",
        record: persisted,
      },
      { status: 200, headers: NO_STORE },
    );
  } catch (err) {
    return managedFailure(err);
  }
}

export async function handleAdminWhatsAppStatus(
  config: WhatsAppRuntimeConfig = readWhatsAppConfig(),
): Promise<Response> {
  const dbConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  let messages: unknown[] = [];
  let events: unknown[] = [];
  if (dbConfigured) {
    try {
      const db = serviceDatabase();
      const [msgsRes, evRes] = await Promise.all([
        db
          .from("whatsapp_messages")
          .select("id,scope,organization_id,phone_number_id,direction,wa_message_id,peer_wa_id,peer_name,message_type,template_name,body_text,status,error_code,error_title,error_message,sent_at,delivered_at,read_at,failed_at,received_at,created_at")
          .order("created_at", { ascending: false })
          .limit(30),
        db
          .from("whatsapp_status_events")
          .select("id,whatsapp_message_id,wa_message_id,status,recipient_id,error_code,error_title,error_message,provider_timestamp,created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (!msgsRes.error && msgsRes.data) messages = msgsRes.data;
      if (!evRes.error && evRes.data) events = evRes.data;
    } catch {
      return Response.json(
        { ok: false, error: "未能讀取 WhatsApp 紀錄。" },
        { status: 503, headers: NO_STORE },
      );
    }
  }

  return Response.json(
    {
      ok: true,
      configured: {
        accessToken: Boolean(config.accessToken),
        appSecret: Boolean(config.appSecret),
        verifyToken: Boolean(config.verifyToken),
        phoneNumberId: config.phoneNumberId || null,
        wabaId: config.wabaId || null,
        appId: config.appId || null,
        businessId: config.businessId || null,
        graphVersion: config.graphVersion,
      },
      messages,
      events,
    },
    { status: 200, headers: NO_STORE },
  );
}
