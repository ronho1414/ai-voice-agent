import { fail, json } from "@/lib/http";
import { transcribeAudio } from "@/lib/voice-engine/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const audio = await request.arrayBuffer();
    if (audio.byteLength === 0) throw new Error("Audio is required");
    if (audio.byteLength > 8_000_000) throw new Error("Audio is too large");
    const contentType = request.headers.get("content-type") ?? "audio/webm";
    const text = await transcribeAudio(audio, contentType);
    return json({ text });
  } catch (error) {
    return fail(error);
  }
}
