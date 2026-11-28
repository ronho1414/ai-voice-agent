import { createHash } from "node:crypto";
import { serviceDatabase } from "./managed-agent-service";

export const MAX_WHATSAPP_VOICE_BYTES = 8 * 1024 * 1024;
const SCRIBE_MODELS = ["scribe_v2", "scribe_v1"] as const;
const TTS_OUTPUT = "opus_48000_64";
const DEFAULT_TTS_MODEL = "eleven_flash_v2_5";

export type ReplyPreference = "auto" | "text" | "voice";
export type ReplyKind = "text" | "voice";
export type ScribeLanguage = "yue" | "zh" | "en";

export type VoiceTranscriptFailure = "too_large" | "download_failed" | "empty" | "stt_failed" | "persist_failed";

export type VoiceTranscriptResult =
  | {
      ok: true;
      transcript: string;
      skipped: boolean;
      language: string | null;
      audioSeconds: number | null;
    }
  | { ok: false; reason: VoiceTranscriptFailure };

export function parseReplyPreference(value: unknown): ReplyPreference {
  if (value === "text" || value === "voice" || value === "auto") return value;
  return "auto";
}

export function decideReplyKind(preference: ReplyPreference, inboundType: string): ReplyKind {
  if (preference === "text") return "text";
  if (preference === "voice") return "voice";
  return inboundType === "audio" ? "voice" : "text";
}

export function scribeLanguageForAgent(languageMode: string): ScribeLanguage | null {
  switch (languageMode) {
    case "cantonese":
      return "yue";
    case "mandarin":
      return "zh";
    case "english":
      return "en";
    default:
      return null;
  }
}

export function voiceFailureMessage(reason: VoiceTranscriptFailure): string {
  switch (reason) {
    case "too_large":
      return "Voice note exceeds the 8 MB limit";
    case "download_failed":
      return "Could not download the WhatsApp voice note";
    case "empty":
      return "Voice note transcript was empty";
    case "persist_failed":
      return "Could not store the voice transcript";
    default:
      return "Voice note transcription failed";
  }
}

export function existingVoiceTranscript(message: Record<string, unknown>): string | null {
  const meta = message.media_metadata;
  if (!meta || typeof meta !== "object") return null;
  const stt = (meta as Record<string, unknown>).stt;
  if (!stt || typeof stt !== "object") return null;
  if ((stt as Record<string, unknown>).status !== "done") return null;
  const body = typeof message.body_text === "string" ? message.body_text.trim() : "";
  return body || null;
}

export function isWhatsAppVoiceNote(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 36 || bytes.byteLength > MAX_WHATSAPP_VOICE_BYTES) return false;
  if (bytes[0] !== 0x4f || bytes[1] !== 0x67 || bytes[2] !== 0x67 || bytes[3] !== 0x53) return false;
  const window = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 128))).toString("latin1");
  const at = window.indexOf("OpusHead");
  if (at < 0 || at + 10 >= bytes.byteLength) return false;
  return bytes[at + 9] === 1;
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function audioBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function mediaIdOf(message: Record<string, unknown>): string {
  const meta = readRecord(message.media_metadata);
  const id = meta && typeof meta.media_id === "string" ? meta.media_id.trim() : "";
  return id.slice(0, 128);
}

async function readCappedBytes(response: Response): Promise<Uint8Array | "too_large"> {
  const declared = Number(response.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > MAX_WHATSAPP_VOICE_BYTES) return "too_large";
  if (!response.body) {
    const buffered = new Uint8Array(await response.arrayBuffer());
    return buffered.byteLength > MAX_WHATSAPP_VOICE_BYTES ? "too_large" : buffered;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > MAX_WHATSAPP_VOICE_BYTES) {
      await reader.cancel().catch(() => undefined);
      return "too_large";
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function scribeTiming(payload: Record<string, unknown>): number | null {
  const words = payload.words;
  if (!Array.isArray(words)) return null;
  let end = 0;
  for (const word of words) {
    const row = readRecord(word);
    const value = row && typeof row.end === "number" ? row.end : null;
    if (value !== null && Number.isFinite(value) && value > end) end = value;
  }
  return end > 0 ? end : null;
}

function readScribePayload(payload: unknown): { text: string; language: string | null; audioSeconds: number | null } | null {
  const row = readRecord(payload);
  if (!row || typeof row.text !== "string") return null;
  const text = row.text.trim().slice(0, 4096);
  const language = typeof row.language_code === "string" ? row.language_code.trim().slice(0, 16) : null;
  return { text, language, audioSeconds: scribeTiming(row) };
}

async function voiceRpc(name: string, payload: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const { data, error } = await serviceDatabase().rpc(name, { payload });
  if (error || !data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

export async function transcribeWhatsAppVoiceNote(input: {
  message: Record<string, unknown>;
  organizationId: string;
  accessToken: string;
  graphVersion: string;
  agentLanguageMode: string;
  fetchImpl?: typeof fetch;
  apiKey?: string;
}): Promise<VoiceTranscriptResult> {
  const cached = existingVoiceTranscript(input.message);
  if (cached) {
    return { ok: true, transcript: cached, skipped: true, language: null, audioSeconds: null };
  }

  const messageId = typeof input.message.id === "string" ? input.message.id : "";
  const mediaId = mediaIdOf(input.message);
  if (!messageId || !mediaId || !input.accessToken) {
    return { ok: false, reason: "download_failed" };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const graphVersion = input.graphVersion || "v25.0";
  let audio: Uint8Array;
  let contentType = "audio/ogg";
  try {
    const metaRes = await fetchFn(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    const meta = readRecord(await metaRes.json().catch(() => null));
    const declared = meta && typeof meta.file_size === "number" ? meta.file_size : 0;
    if (!metaRes.ok || !meta || declared > MAX_WHATSAPP_VOICE_BYTES) {
      return { ok: false, reason: declared > MAX_WHATSAPP_VOICE_BYTES ? "too_large" : "download_failed" };
    }
    const downloadUrl = typeof meta.url === "string" ? meta.url : "";
    if (!downloadUrl.startsWith("https://")) return { ok: false, reason: "download_failed" };
    if (typeof meta.mime_type === "string" && meta.mime_type.trim()) contentType = meta.mime_type.trim().slice(0, 128);
    const binRes = await fetchFn(downloadUrl, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!binRes.ok) return { ok: false, reason: "download_failed" };
    const bytes = await readCappedBytes(binRes);
    if (bytes === "too_large") return { ok: false, reason: "too_large" };
    if (bytes.byteLength === 0) return { ok: false, reason: "download_failed" };
    audio = bytes;
  } catch {
    return { ok: false, reason: "download_failed" };
  }

  const apiKey = (input.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, reason: "stt_failed" };
  const language = scribeLanguageForAgent(input.agentLanguageMode);
  let parsed: { text: string; language: string | null; audioSeconds: number | null } | null = null;
  for (const modelId of SCRIBE_MODELS) {
    const form = new FormData();
    form.set("model_id", modelId);
    form.set("tag_audio_events", "false");
    form.set("diarize", "false");
    if (language) form.set("language_code", language);
    form.set("file", audioBlob(audio, contentType || "audio/ogg"), "voice.ogg");
    let response: Response;
    try {
      response = await fetchFn("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      continue;
    }
    if (!response.ok) continue;
    parsed = readScribePayload(await response.json().catch(() => null));
    if (parsed) break;
  }
  if (!parsed || !parsed.text) return { ok: false, reason: "empty" };

  const saved = await voiceRpc("record_whatsapp_voice_transcript", {
    message_id: messageId,
    organization_id: input.organizationId,
    transcript: parsed.text,
    language: parsed.language ?? language ?? "",
    audio_seconds: parsed.audioSeconds,
  });
  if (!saved || saved.ok !== true) return { ok: false, reason: "persist_failed" };
  const transcript = typeof saved.transcript === "string" && saved.transcript.trim() ? saved.transcript.trim() : parsed.text;

  await voiceRpc("store_whatsapp_voice_media", {
    message_id: messageId,
    organization_id: input.organizationId,
    content_type: "audio/ogg",
    sha256: sha256Bytes(audio),
    audio_base64: bytesToBase64(audio),
  });

  return {
    ok: true,
    transcript,
    skipped: saved.applied === false,
    language: parsed.language,
    audioSeconds: parsed.audioSeconds,
  };
}

function readAgentVoice(payload: unknown): { voiceId: string; modelId: string } | null {
  const root = readRecord(payload);
  const config = root ? readRecord(root.conversation_config) : null;
  const tts = config ? readRecord(config.tts) : null;
  const voiceId = tts && typeof tts.voice_id === "string" ? tts.voice_id.trim() : "";
  if (!voiceId) return null;
  const modelId = tts && typeof tts.model_id === "string" && tts.model_id.trim() ? tts.model_id.trim() : DEFAULT_TTS_MODEL;
  return { voiceId, modelId: modelId.slice(0, 64) };
}

export async function synthesizeAgentVoiceNote(input: {
  agentId: string;
  text: string;
  fetchImpl?: typeof fetch;
  apiKey?: string;
}): Promise<{ ok: true; audio: Uint8Array; characters: number; modelId: string } | { ok: false }> {
  const text = input.text.trim();
  const apiKey = (input.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "").trim();
  if (!text || !input.agentId || !apiKey) return { ok: false };
  const fetchFn = input.fetchImpl ?? fetch;
  let voice: { voiceId: string; modelId: string } | null = null;
  try {
    const agentRes = await fetchFn(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(input.agentId)}`,
      {
        headers: { "xi-api-key": apiKey },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!agentRes.ok) return { ok: false };
    voice = readAgentVoice(await agentRes.json().catch(() => null));
  } catch {
    return { ok: false };
  }
  if (!voice) return { ok: false };

  try {
    const speechRes = await fetchFn(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${TTS_OUTPUT}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/ogg",
        },
        body: JSON.stringify({ text, model_id: voice.modelId }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!speechRes.ok) return { ok: false };
    const bytes = await readCappedBytes(speechRes);
    if (bytes === "too_large" || !isWhatsAppVoiceNote(bytes)) return { ok: false };
    return { ok: true, audio: bytes, characters: text.length, modelId: voice.modelId };
  } catch {
    return { ok: false };
  }
}

export async function uploadWhatsAppVoiceNote(input: {
  phoneNumberId: string;
  accessToken: string;
  graphVersion: string;
  audio: Uint8Array;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; mediaId: string } | { ok: false }> {
  if (!isWhatsAppVoiceNote(input.audio) || !input.accessToken || !input.phoneNumberId) return { ok: false };
  const fetchFn = input.fetchImpl ?? fetch;
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", "audio/ogg");
  form.set("file", audioBlob(input.audio, "audio/ogg"), "voice.ogg");
  try {
    const response = await fetchFn(
      `https://graph.facebook.com/${input.graphVersion || "v25.0"}/${input.phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${input.accessToken}` },
        body: form,
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = readRecord(await response.json().catch(() => null));
    const mediaId = payload && typeof payload.id === "string" ? payload.id.trim() : "";
    if (!response.ok || !mediaId) return { ok: false };
    return { ok: true, mediaId };
  } catch {
    return { ok: false };
  }
}

export async function recordVoiceTranscript(input: {
  messageId: string;
  organizationId: string;
  transcript: string;
  language: string | null;
  audioSeconds: number | null;
}): Promise<{ ok: true; transcript: string } | { ok: false }> {
  const saved = await voiceRpc("record_whatsapp_voice_transcript", {
    message_id: input.messageId,
    organization_id: input.organizationId,
    transcript: input.transcript,
    language: input.language ?? "",
    audio_seconds: input.audioSeconds,
  });
  if (!saved || saved.ok !== true || typeof saved.transcript !== "string" || !saved.transcript.trim()) {
    return { ok: false };
  }
  return { ok: true, transcript: saved.transcript.trim() };
}

export async function storeOutboundVoice(input: {
  messageId: string;
  organizationId: string;
  audio: Uint8Array;
}): Promise<void> {
  if (!isWhatsAppVoiceNote(input.audio)) return;
  await voiceRpc("store_whatsapp_voice_media", {
    message_id: input.messageId,
    organization_id: input.organizationId,
    content_type: "audio/ogg",
    sha256: sha256Bytes(input.audio),
    audio_base64: bytesToBase64(input.audio),
  });
}

export async function recheckWhatsAppAiSend(input: {
  conversationId: string;
  expectedModeVersion: number;
}): Promise<Record<string, unknown> | null> {
  return voiceRpc("recheck_whatsapp_ai_send", {
    whatsapp_conversation_id: input.conversationId,
    expected_mode_version: input.expectedModeVersion,
  });
}

export async function retargetQueuedOutbound(input: {
  messageId: string;
  messageType: "text" | "audio";
  mediaMetadata?: Record<string, unknown>;
}): Promise<void> {
  await voiceRpc("retarget_whatsapp_queued_outbound", {
    id: input.messageId,
    message_type: input.messageType,
    media_metadata: input.mediaMetadata ?? {},
  });
}

export async function purgeExpiredVoiceMedia(): Promise<void> {
  await voiceRpc("purge_expired_whatsapp_voice_media", {});
}
