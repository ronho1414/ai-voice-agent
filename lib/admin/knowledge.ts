import { activeKnowledge } from "@/lib/admin/store";
import { decideAboutAdminSources } from "@/lib/voice-engine/decision";
import { loadKnowledgeFile } from "@/lib/voice-engine/read-config";

export type SpokenKnowledge = {
  knowledge: string;
  adminText: string;
  useAdminSources: boolean;
};

export function sourceBrief(adminText: string): string {
  return adminText
    .split(/\n\n/)
    .slice(0, 8)
    .map((block) => {
      const [title, ...rest] = block.split("\n");
      const preview = rest.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
      return preview ? `${title}: ${preview}` : title;
    })
    .join("\n")
    .slice(0, 3500);
}

export async function resolveSpokenKnowledge(
  text: string,
  siteId: string,
  fallbackPath: string,
): Promise<SpokenKnowledge> {
  const company = await loadKnowledgeFile(fallbackPath);
  const adminText = (await activeKnowledge(siteId)) ?? "";
  if (!adminText) {
    return { knowledge: company, adminText: "", useAdminSources: false };
  }
  const useAdminSources = await decideAboutAdminSources(text, sourceBrief(adminText));
  if (!useAdminSources) {
    return { knowledge: company, adminText: "", useAdminSources: false };
  }
  return {
    knowledge: `${company}\n\nUploaded documents and typed notes:\n${adminText}`,
    adminText,
    useAdminSources: true,
  };
}
