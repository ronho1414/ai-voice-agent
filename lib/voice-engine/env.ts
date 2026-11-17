import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const STORE_ENV = "/cursor/stores/self/docs/.env.local.txt";

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function ensureEnv(): void {
  const flag = globalThis as typeof globalThis & { __voiceEnvLoaded?: boolean };
  if (flag.__voiceEnvLoaded) return;
  flag.__voiceEnvLoaded = true;

  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));
  loadEnvFile(STORE_ENV);
}

const ENV_ALIASES: Record<string, readonly string[]> = {
  DEEPGRAM_API_KEY: ["DEEPGRAM"],
  JEV_API_KEY: ["JEV"],
  ELEVENLABS_API_KEY: ["ELEVENLABS"],
  OPENROUTER_API_KEY: ["OPENROUTER"],
};

export function requireEnv(name: string): string {
  ensureEnv();
  const names = [name, ...(ENV_ALIASES[name] ?? [])];
  for (const key of names) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing ${name}`);
}
