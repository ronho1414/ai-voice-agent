import clipsFile from "@/config/clips-config.json";
import siteMapFile from "@/config/site-map.json";
import { parseSiteMap } from "@/lib/voice-engine/site-map";
import { VoiceWidget } from "@/components/voice-widget/VoiceWidget";

const siteMap = parseSiteMap(siteMapFile);

export function VoiceWidgetRoot() {
  return (
    <VoiceWidget
      knowledgeBasePath="knowledge-base/company-info.md"
      siteMap={siteMap}
      voiceId={clipsFile.voiceSettings.yue.voiceId}
      clips={clipsFile.clips.map((clip) => clip.file)}
    />
  );
}
