import { activeKnowledge } from "@/lib/admin/store";
import { loadKnowledgeFile } from "@/lib/voice-engine/read-config";

export async function loadAnswerKnowledge(siteId: string, fallbackPath: string): Promise<string> {
  const documents = await activeKnowledge(siteId);
  if (documents) return documents;
  return loadKnowledgeFile(fallbackPath);
}
