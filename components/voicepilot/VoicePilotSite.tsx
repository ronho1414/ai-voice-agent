"use client";

import { useEffect } from "react";
import { VOICEPILOT_MARKUP } from "@/components/voicepilot/markup";
import { VOICEPILOT_SCRIPT } from "@/components/voicepilot/site-script";

declare global {
  interface Window {
    navigateToPage?: (pageId: string, options?: unknown) => void;
    initVoicePilotSite?: () => void;
    __voicePilotBooted?: boolean;
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
    document.documentElement.classList.add("vp-world");
    if (!window.__voicePilotBooted) {
      const script = document.createElement("script");
      script.dataset.voicepilot = "site";
      script.text = VOICEPILOT_SCRIPT;
      document.body.appendChild(script);
      window.__voicePilotBooted = true;
    } else {
      window.initVoicePilotSite?.();
    }
    openRequestedPage();

    let cancelled = false;
    let stopEarth = () => {};
    void import("@/components/voicepilot/earth")
      .then((mod) => {
        if (!cancelled) stopEarth = mod.mountVoicePilotEarth();
      })
      .catch(() => {
        const fallback = document.getElementById("earth-fallback");
        if (fallback) fallback.hidden = false;
      });

    return () => {
      cancelled = true;
      stopEarth();
      document.documentElement.classList.remove("vp-world");
    };
  }, []);

  return <div className="vp-world" dangerouslySetInnerHTML={{ __html: VOICEPILOT_MARKUP }} />;
}
