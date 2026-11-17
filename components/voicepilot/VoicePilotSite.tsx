"use client";

import { useEffect } from "react";
import { VOICEPILOT_MARKUP } from "@/components/voicepilot/markup";
import { VOICEPILOT_SCRIPT } from "@/components/voicepilot/site-script";

declare global {
  interface Window {
    navigateToPage?: (pageId: string, options?: unknown) => void;
    initVoicePilotSite?: () => void;
    lucide?: { createIcons: () => void };
    __voicePilotBooted?: boolean;
  }
}

export function VoicePilotSite() {
  useEffect(() => {
    if (!window.__voicePilotBooted) {
      const script = document.createElement("script");
      script.dataset.voicepilot = "site";
      script.text = VOICEPILOT_SCRIPT;
      document.body.appendChild(script);
      window.__voicePilotBooted = true;
    } else {
      window.initVoicePilotSite?.();
    }

    let cancelled = false;
    const paintIcons = () => {
      if (!cancelled) window.lucide?.createIcons();
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-lucide-cdn="true"]');
    if (window.lucide) {
      paintIcons();
    } else if (!existing) {
      const lucide = document.createElement("script");
      lucide.src = "https://unpkg.com/lucide@latest";
      lucide.async = true;
      lucide.dataset.lucideCdn = "true";
      lucide.onload = () => {
        paintIcons();
        window.initVoicePilotSite?.();
      };
      document.body.appendChild(lucide);
    } else {
      existing.addEventListener("load", paintIcons);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="bg-white text-[#0A2540] antialiased selection:bg-[#635BFF]/15 selection:text-[#635BFF]"
      dangerouslySetInnerHTML={{ __html: VOICEPILOT_MARKUP }}
    />
  );
}
