/**
 * Offline filler-clip generator.
 *
 * Reads config/clips-config.json, including voiceSettings for the clip
 * language, and writes public/clips/{intent}_{lang}.mp3.
 * Speech uses ElevenLabs eleven_turbo_v4, then eleven_flash_v2_5.
 * Nothing in this file runs on import.
 *
 *   npx tsx scripts/generate-clips.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { synthesizeSpeech } from "@/lib/elevenlabs";
import { loadClipsConfig } from "@/lib/read-config";

function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

async function main(): Promise<void> {
  const root = repoRoot();
  process.chdir(root);

  const config = loadClipsConfig(root);
  const outDir = path.join(root, "public", "clips");
  mkdirSync(outDir, { recursive: true });

  for (const clip of config.clips) {
    const voice = config.voiceSettings[clip.lang];
    const outPath = path.resolve(outDir, clip.file);
    if (path.dirname(outPath) !== path.resolve(outDir)) {
      throw new Error(`Refusing to write outside public/clips: ${clip.file}`);
    }

    const audio = await synthesizeSpeech({ voice, text: clip.clipText });
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
    const message = error instanceof Error ? error.message : "Clip generation failed";
    console.error(message);
    process.exitCode = 1;
  });
}
