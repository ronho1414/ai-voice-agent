import { readFileSync } from "node:fs";
import path from "node:path";
import { parseClipsConfig, type ClipsConfig } from "@/lib/clips-config";
import { parseSiteMap, type SiteMap } from "@/lib/site-map";

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

export function loadKnowledge(root = process.cwd()): string {
  return readFileSync(path.join(root, "knowledge-base", "company-info.md"), "utf8");
}
