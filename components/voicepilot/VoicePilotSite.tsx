"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { VOICEPILOT_MARKUP } from "@/components/voicepilot/markup";
import { bootSiteMotion } from "@/components/voicepilot/site-motion";
import { VOICEPILOT_SCRIPT } from "@/components/voicepilot/site-script";

declare global {
  interface Window {
    navigateToPage?: (pageId: string, options?: unknown) => void;
    initVoicePilotSite?: () => void;
    lucide?: { createIcons: () => void };
    __voicePilotBooted?: boolean;
    gsap?: typeof gsap;
  }
}

function openRequestedPage(): void {
  const params = new URLSearchParams(window.location.search);
  const page = params.get("page");
  const section = params.get("section");
  if (!page || typeof window.navigateToPage !== "function") return;
  window.navigateToPage(page, section ? { sectionId: section } : undefined);
}

export function VoicePilotSite() {
  useEffect(() => {
    window.gsap = gsap;
    if (!window.__voicePilotBooted) {
      const script = document.createElement("script");
      script.dataset.voicepilot = "site";
      script.text = VOICEPILOT_SCRIPT;
      document.body.appendChild(script);
      window.__voicePilotBooted = true;
      bootSiteMotion(gsap);
    } else {
      window.initVoicePilotSite?.();
      bootSiteMotion(gsap);
    }
    openRequestedPage();

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
        openRequestedPage();
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
      className="bg-white text-[#09090B] antialiased selection:bg-[#09090B]/10 selection:text-[#09090B]"
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: VOICEPILOT_MARKUP }}
    />
  );
}
