import { VoicePilotSite } from "@/components/voicepilot/VoicePilotSite";
import type { Metadata } from "next";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    type: "website", locale: "zh_HK", siteName: "Orai Service", url: "/",
    title: "Orai Service｜香港三語 AI 接待服務",
    description: "為香港商戶提供廣東話、普通話及英語 AI 接待服務。",
  },
};

export default function HomePage() {
  return <VoicePilotSite />;
}
