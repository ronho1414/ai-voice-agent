import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

export type SyncedCall = {
  provider_conversation_id: string; provider_agent_id: string;
  channel: "web" | "phone"; duration_seconds: number; started_at: string;
  ended_at: string; summary: string; transcript: { role: string; message: string; time_in_call_secs?: number }[];
  analysis: Record<string, unknown>;
};
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid object");
  return v as Record<string, unknown>;
};
const id = (v: unknown) => {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) throw new Error("Invalid identifier");
  return v;
};
export function parseCall(event: unknown): SyncedCall | null {
  const root = object(event);
  if (typeof root.type !== "string") throw new Error("Missing event type");
  if (root.type !== "post_call_transcription") return null;
  const data = object(root.data), metadata = object(data.metadata);
  const start = metadata.start_time_unix_secs, duration = metadata.call_duration_secs;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0 ||
      typeof duration !== "number" || !Number.isSafeInteger(duration) || duration < 0) throw new Error("Invalid timing");
  if (!Array.isArray(data.transcript) || data.transcript.length > 10000) throw new Error("Invalid transcript");
  const transcript = data.transcript.map((value: unknown) => {
    const turn = object(value);
    if (turn.role !== "user" && turn.role !== "agent") throw new Error("Invalid role");
    if (turn.message !== null && typeof turn.message !== "string") throw new Error("Invalid message");
    if (typeof turn.message === "string" && turn.message.length > 100000) throw new Error("Message too long");
    const time = turn.time_in_call_secs;
    if (time !== undefined && (typeof time !== "number" || !Number.isFinite(time) || time < 0)) throw new Error("Invalid turn time");
    return { role: turn.role, message: (turn.message ?? "") as string, ...(typeof time === "number" ? { time_in_call_secs: time } : {}) };
  });
  const analysis = data.analysis == null ? {} : object(data.analysis);
  // Store only the MVP result flags, never dynamic variables, tool arguments or data-collection fields.
  const safeAnalysis: Record<string, unknown> = {};
  if (["success", "failure", "unknown"].includes(String(analysis.call_successful))) safeAnalysis.call_successful = analysis.call_successful;
  const summary = analysis.transcript_summary;
  if (summary !== undefined && summary !== null && (typeof summary !== "string" || summary.length > 100000)) throw new Error("Invalid summary");
  return { provider_conversation_id: id(data.conversation_id), provider_agent_id: id(data.agent_id),
    channel: metadata.phone_call ? "phone" : "web", duration_seconds: duration,
    started_at: new Date(start * 1000).toISOString(), ended_at: new Date((start + duration) * 1000).toISOString(),
    transcript, summary: typeof summary === "string" ? summary : "", analysis: safeAnalysis };
}

export async function receiveWebhook(request: Request, secret: string | undefined,
  save: (call: SyncedCall) => Promise<string>): Promise<Response> {
  if (!secret) return Response.json({ error: "Webhook unavailable" }, { status: 503 });
  const signature = request.headers.get("elevenlabs-signature");
  if (!signature) return Response.json({ error: "Invalid signature" }, { status: 401 });
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  if (!reader) return Response.json({ error: "Missing body" }, { status: 400 });
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > 2 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Payload too large" }, { status: 413 }); }
    chunks.push(next.value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  let event: unknown;
  try { event = await new ElevenLabsClient({ apiKey: "webhook-verification-only" }).webhooks.constructEvent(raw, signature, secret); }
  catch { return Response.json({ error: "Invalid signature or payload" }, { status: 401 }); }
  let call: SyncedCall | null;
  try { call = parseCall(event); } catch { return Response.json({ error: "Malformed event" }, { status: 400 }); }
  if (!call) return Response.json({ status: "ignored" });
  try { return Response.json({ status: await save(call) }); }
  catch { return Response.json({ error: "Persistence unavailable" }, { status: 503 }); }
}
