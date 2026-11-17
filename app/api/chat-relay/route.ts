import { after } from "next/server";
import { readConversationDraft, recordConversation } from "@/lib/admin/logs";
import { resolveSpokenKnowledge } from "@/lib/admin/knowledge";
import { readSiteId } from "@/lib/admin/site";
import { fail } from "@/lib/http";
import { voiceFor } from "@/lib/voice-engine/clips-config";
import { decideOpener } from "@/lib/voice-engine/decision";
import { openFlashStream } from "@/lib/voice-engine/elevenlabs";
import { buildSystemPrompt, guardReply } from "@/lib/voice-engine/prompt";
import { loadClipsConfig } from "@/lib/voice-engine/read-config";
import { firstClause, replyComplete, streamReplyDeltas } from "@/lib/voice-engine/stream-reply";
import { readKnowledgeBasePath, readSpokenOpener, readTurnContext, readUtterance, readVoiceId } from "@/lib/voice-engine/utterance";
import type { VoiceSetting } from "@/lib/voice-engine/clips-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hkg1";

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  if (message.length > 180 || /key|token|secret|bearer/i.test(message)) return "Request failed";
  return message;
}

async function pipeFlash(
  text: string,
  voice: VoiceSetting,
  signal: AbortSignal,
  sendAudio: (bytes: Uint8Array) => void,
): Promise<void> {
  const spoken = text.trim();
  if (!spoken) return;
  const upstream = await openFlashStream({ voice, text: spoken, signal });
  const reader = upstream.body?.getReader();
  if (!reader) return;
  const parts: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (value && value.byteLength > 0) parts.push(value);
    if (done) break;
  }
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  if (total === 0) return;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  sendAudio(merged);
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return fail(error);
  }

  let text = "";
  try {
    text = readUtterance(body);
  } catch (error) {
    return fail(error);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const knowledgeBasePath = readKnowledgeBasePath(body);
        const siteId = readSiteId(
          typeof body === "object" && body !== null ? (body as { siteId?: unknown }).siteId : undefined,
        );
        const spoken = readSpokenOpener(body);
        const opener = spoken ?? (await decideOpener(text, readTurnContext(body)));
        const resolved = await resolveSpokenKnowledge(
          text,
          siteId,
          knowledgeBasePath ?? "knowledge-base/company-info.md",
        );
        const configured = voiceFor(loadClipsConfig(), opener.lang);
        const voiceId = readVoiceId(body);
        const voice = voiceId ? { ...configured, voiceId } : configured;
        const system = buildSystemPrompt(resolved.knowledge, opener.clipText, opener.lang, resolved.useAdminSources);
        let raw = "";
        let llmFirstTokenMs = 0;
        let spokenClause = "";
        const llmStarted = Date.now();
        for await (const delta of streamReplyDeltas(system, text, request.signal)) {
          if (!llmFirstTokenMs) {
            llmFirstTokenMs = Date.now() - llmStarted;
            send({ type: "token", llmFirstTokenMs });
          }
          raw += delta;
          if (!spokenClause) {
            const clause = firstClause(raw);
            if (clause) {
              spokenClause = clause;
              await pipeFlash(clause, voice, request.signal, (bytes) => {
                send({ type: "audio", b64: Buffer.from(bytes).toString("base64") });
              });
            }
          }
          if (replyComplete(raw)) break;
        }
        const guarded = guardReply(raw, opener.clipText, opener.lang, resolved.knowledge);
        if (!spokenClause) {
          await pipeFlash(guarded, voice, request.signal, (bytes) => {
            send({ type: "audio", b64: Buffer.from(bytes).toString("base64") });
          });
        } else if (guarded.startsWith(spokenClause)) {
          await pipeFlash(guarded.slice(spokenClause.length), voice, request.signal, (bytes) => {
            send({ type: "audio", b64: Buffer.from(bytes).toString("base64") });
          });
        }
        send({
          type: "done",
          reply: guarded,
          clipText: opener.clipText,
          lang: opener.lang,
          llmFirstTokenMs,
        });
        const draft = readConversationDraft(body, guarded);
        after(() => {
          void recordConversation(draft);
        });
      } catch (error) {
        if (request.signal.aborted) return;
        send({ type: "error", error: safeError(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
