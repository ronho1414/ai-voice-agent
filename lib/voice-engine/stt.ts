import { requireEnv } from "@/lib/voice-engine/env";

const ATTEMPTS = [
  "model=nova-3&language=multi&language_hint=zh-HK&language_hint=zh-CN&language_hint=en&smart_format=true",
  "model=nova-2&language=multi&smart_format=true",
  "model=nova-2&detect_language=true&smart_format=true",
];

function readTranscript(payload: unknown): string {
  if (typeof payload !== "object" || payload === null) return "";
  const results = (payload as { results?: unknown }).results;
  if (typeof results !== "object" || results === null) return "";
  const channels = (results as { channels?: unknown }).channels;
  if (!Array.isArray(channels) || channels.length === 0) return "";
  const alternatives = (channels[0] as { alternatives?: unknown }).alternatives;
  if (!Array.isArray(alternatives) || alternatives.length === 0) return "";
  const transcript = (alternatives[0] as { transcript?: unknown }).transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}

export async function transcribeAudio(audio: ArrayBuffer, contentType: string): Promise<string> {
  const apiKey = requireEnv("DEEPGRAM_API_KEY");
  let lastStatus = 0;

  for (const query of ATTEMPTS) {
    let response: Response;
    try {
      response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${apiKey}`,
          "Content-Type": contentType || "audio/webm",
        },
        body: audio,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      continue;
    }

    if (!response.ok) {
      lastStatus = response.status;
      continue;
    }

    const payload: unknown = await response.json();
    return readTranscript(payload);
  }

  throw new Error(`Deepgram STT failed (${lastStatus})`);
}
