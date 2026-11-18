import type { Metadata } from "next";
import { VoiceWidgetRoot } from "@/components/voice-widget/VoiceWidgetRoot";
import "./globals.css";

export const metadata: Metadata = {
  title: "VoicePilot AI（領聲智導）｜香港首創三語 AI 語音網頁導航與企業知識庫方案",
  description: "廣東話、普通話、英文語音專員。預錄開場白同知識庫回覆並行，並可按網站地圖跳頁。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-HK" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* next/font subsets Noto Sans TC to latin and drops Traditional Chinese. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&family=Playfair+Display:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <VoiceWidgetRoot />
      </body>
    </html>
  );
}
