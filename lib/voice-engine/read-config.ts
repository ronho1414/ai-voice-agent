import { readFileSync } from "node:fs";
import path from "node:path";
import { parseClipsConfig, type ClipsConfig } from "@/lib/voice-engine/clips-config";
import { parseSiteMap, type SiteMap } from "@/lib/voice-engine/site-map";

function readJson(root: string, name: string): unknown {
  const file = path.join(root, "config", name);
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

export function loadClipsConfig(root = process.cwd()): ClipsConfig {
  return parseClipsConfig(readJson(root, "clips-config.json"));
}

export function loadSiteMap(root = process.cwd()): SiteMap {
  return parseSiteMap(readJson(root, "site-map.json"));
}

export function loadKnowledgeFile(relativePath: string, root = process.cwd()): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
    throw new Error("Knowledge base path is invalid");
  }
  const base = path.resolve(root, "knowledge-base");
  const target = path.resolve(root, normalized);
  const relative = path.relative(base, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !target.endsWith(".md")) {
    throw new Error("Knowledge base path is invalid");
  }
  return readFileSync(target, "utf8");
}

export function loadKnowledge(root = process.cwd()): string {
  return loadKnowledgeFile("knowledge-base/company-info.md", root);
}
