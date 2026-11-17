import { fail } from "@/lib/http";
import { voiceFor } from "@/lib/voice-engine/clips-config";
import { openSpeechStream } from "@/lib/voice-engine/elevenlabs";
import { loadClipsConfig } from "@/lib/voice-engine/read-config";
import { readSpeechRequest, readVoiceId } from "@/lib/voice-engine/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "hkg1";

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const { text, lang } = readSpeechRequest(body);
    const voiceId = readVoiceId(body);
    const configured = voiceFor(loadClipsConfig(), lang);
    const voice = voiceId ? { ...configured, voiceId } : configured;
    const upstream = await openSpeechStream({ voice, text });
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
