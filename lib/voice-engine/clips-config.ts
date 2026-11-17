import { isIntent, isLang, type Intent, type Lang } from "@/lib/voice-engine/types";

export type VoiceSetting = {
  voiceId: string;
  stability: number;
  similarity_boost: number;
};

export type ClipItem = {
  intent: Intent;
  lang: Lang;
  file: string;
  clipText: string;
};

export type ClipsConfig = {
  voiceSettings: Record<Lang, VoiceSetting>;
  clips: ClipItem[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVoice(value: unknown, lang: Lang): VoiceSetting {
  if (!isRecord(value)) {
    throw new Error(`Missing voice settings for ${lang}`);
  }
  const voiceId = value.voiceId;
  const stability = value.stability;
  const similarity = value.similarity_boost;
  if (typeof voiceId !== "string" || voiceId.trim() === "") {
    throw new Error(`Missing voice settings for ${lang}`);
  }
  if (
    typeof stability !== "number" ||
    typeof similarity !== "number" ||
    stability < 0 ||
    stability > 1 ||
    similarity < 0 ||
    similarity > 1
  ) {
    throw new Error(`Missing voice settings for ${lang}`);
  }
  return {
    voiceId: voiceId.trim(),
    stability,
    similarity_boost: similarity,
  };
}

function readClip(value: unknown, index: number): ClipItem {
  if (!isRecord(value)) {
    throw new Error(`Clip ${index} is not an object`);
  }
  const intent = value.intent;
  const lang = value.lang;
  const file = value.file;
  const clipText = value.clipText;
  if (
    typeof intent !== "string" ||
    typeof lang !== "string" ||
    typeof file !== "string" ||
    typeof clipText !== "string"
  ) {
    throw new Error(`Clip ${index} is missing intent, lang, file, or clipText`);
  }
  if (!isIntent(intent) || !isLang(lang)) {
    throw new Error(`Clip ${index} has an unknown intent or lang`);
  }
  const expected = `${intent}_${lang}.mp3`;
  if (file !== expected) {
    throw new Error(`Clip ${index} file must be ${expected}`);
  }
  return { intent, lang, file, clipText };
}

export function parseClipsConfig(value: unknown): ClipsConfig {
  if (!isRecord(value) || !isRecord(value.voiceSettings) || !Array.isArray(value.clips)) {
    throw new Error("config/clips-config.json must include voiceSettings and clips");
  }

  const voiceSettings = {
    yue: readVoice(value.voiceSettings.yue, "yue"),
    zh: readVoice(value.voiceSettings.zh, "zh"),
    en: readVoice(value.voiceSettings.en, "en"),
  };
  const clips = value.clips.map((item, index) => readClip(item, index));
  return { voiceSettings, clips };
}

export function voiceFor(config: ClipsConfig, lang: Lang): VoiceSetting {
  return config.voiceSettings[lang];
}

export function clipFor(config: ClipsConfig, intent: Intent, lang: Lang): ClipItem {
  const clip = config.clips.find((item) => item.intent === intent && item.lang === lang);
  if (!clip) {
    throw new Error(`Missing clip ${intent}_${lang}`);
  }
  return clip;
}
