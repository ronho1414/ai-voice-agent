import type { Metadata } from "next";
import { VoiceAgent } from "@/components/VoiceAgent";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Voice Agent",
  description: "Trilingual voice agent with a fast opener and a spoken reply.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">
        {children}
        <VoiceAgent />
      </body>
    </html>
  );
}
