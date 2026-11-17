import { requireEnv } from "@/lib/env";
import type { VoiceSetting } from "@/lib/clips-config";

// The spec names eleven_turbo_v4. ElevenLabs serves that turbo model as eleven_v4_turbo.
const TTS_MODELS = ["eleven_turbo_v4", "eleven_v4_turbo", "eleven_flash_v2_5"] as const;

export async function openSpeechStream(options: {
  voice: VoiceSetting;
  text: string;
}): Promise<Response> {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  let lastStatus = 0;

  for (const modelId of TTS_MODELS) {
    let response: Response;
    try {
      response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voice.voiceId)}/stream`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: options.text,
            model_id: modelId,
            voice_settings: {
              stability: options.voice.stability,
              similarity_boost: options.voice.similarity_boost,
            },
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
    } catch {
      continue;
    }

    if (response.ok && response.body) return response;
    lastStatus = response.status;
    await response.body?.cancel().catch(() => undefined);
  }

  throw new Error(`ElevenLabs TTS failed (${lastStatus})`);
}

export async function synthesizeSpeech(options: {
  voice: VoiceSetting;
  text: string;
}): Promise<Uint8Array> {
  const response = await openSpeechStream(options);
  return new Uint8Array(await response.arrayBuffer());
}
