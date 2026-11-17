import { voiceFor } from "@/lib/clips-config";
import { openSpeechStream } from "@/lib/elevenlabs";
import { fail } from "@/lib/http";
import { loadClipsConfig } from "@/lib/read-config";
import { readSpeechRequest } from "@/lib/utterance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const { text, lang } = readSpeechRequest((await request.json()) as unknown);
    const voice = voiceFor(loadClipsConfig(), lang);
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
