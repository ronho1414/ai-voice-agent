"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";

export function MarketingVoiceEmbed() {
  const pathname = usePathname();
  if (pathname !== "/") return null;
  return <Script src="/orai-widget.js" data-agent-id="agent_8201m7sbetj3e36s1a2nv3fgcqna" strategy="afterInteractive" />;
}
