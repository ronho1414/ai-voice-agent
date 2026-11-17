/**
 * Offline filler-clip generator.
 *
 * Reads config/clips-config.json and writes public/clips/{intent}_{lang}.mp3
 * with ElevenLabs model_id eleven_turbo_v4. If that request fails, the same
 * text is retried with eleven_flash_v2_5. The API key is read only from
 * process.env.ELEVENLABS_API_KEY. Nothing in this file runs on import.
 *
 *   npm run generate:clips
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ELEVENLABS_MODEL_ID = "eleven_turbo_v4";
const ELEVENLABS_FALLBACK_MODEL_ID = "eleven_flash_v2_5";
// Change this to the ElevenLabs voice that should speak the clips.
const ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

type ClipLang = "yue" | "zh" | "en";

type ClipConfigItem = {
  intent: string;
  lang: ClipLang;
  file: string;
  clipText: string;
};

const LANGS: readonly ClipLang[] = ["yue", "zh", "en"];

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function isClipLang(value: string): value is ClipLang {
  return LANGS.some((lang) => lang === value);
}

function readClips(configPath: string): ClipConfigItem[] {
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error("config/clips-config.json must be an array");
  }

  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Clip ${index} is not an object`);
    }
    const clip = item as Record<string, unknown>;
    const intent = clip.intent;
    const lang = clip.lang;
    const file = clip.file;
    const clipText = clip.clipText;
    if (
      typeof intent !== "string" ||
      typeof lang !== "string" ||
      typeof file !== "string" ||
      typeof clipText !== "string"
    ) {
      throw new Error(`Clip ${index} is missing intent, lang, file, or clipText`);
    }
    if (!isClipLang(lang)) {
      throw new Error(`Clip ${index} has unknown lang ${lang}`);
    }
    const expected = `${intent}_${lang}.mp3`;
    if (file !== expected) {
      throw new Error(`Clip ${index} file must be ${expected}`);
    }
    return { intent, lang, file, clipText };
  });
}

async function requestElevenLabs(
  text: string,
  apiKey: string,
  modelId: string,
): Promise<Uint8Array> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed (${response.status}) for ${modelId}`);
  }

  return new Uint8Array(await response.arrayBuffer());
}

async function synthesizeWithElevenLabs(
  text: string,
  apiKey: string,
): Promise<Uint8Array> {
  try {
    return await requestElevenLabs(text, apiKey, ELEVENLABS_MODEL_ID);
  } catch (primaryError) {
    const primaryMessage =
      primaryError instanceof Error ? primaryError.message : String(primaryError);
    console.error(
      `${ELEVENLABS_MODEL_ID} failed, falling back to ${ELEVENLABS_FALLBACK_MODEL_ID}: ${primaryMessage}`,
    );
    return requestElevenLabs(text, apiKey, ELEVENLABS_FALLBACK_MODEL_ID);
  }
}

async function main(): Promise<void> {
  const root = repoRoot();
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("Set ELEVENLABS_API_KEY before generating clips.");
  }

  const clips = readClips(path.join(root, "config", "clips-config.json"));
  const outDir = path.join(root, "public", "clips");
  mkdirSync(outDir, { recursive: true });

  for (const clip of clips) {
    const outPath = path.join(outDir, clip.file);
    if (path.dirname(outPath) !== outDir) {
      throw new Error(`Refusing to write outside public/clips: ${clip.file}`);
    }

    const audio = await synthesizeWithElevenLabs(clip.clipText, apiKey);
    writeFileSync(outPath, audio);
    console.log(`wrote ${path.relative(root, outPath)}`);
  }
}

function runDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (runDirectly()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
