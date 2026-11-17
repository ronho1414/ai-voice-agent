"use client";

import { usePathname } from "next/navigation";
import { createElement, useEffect, useRef } from "react";

const EMBED_SCRIPT = "https://unpkg.com/@elevenlabs/convai-widget-embed";

function openConvai(): boolean {
  const event = new CustomEvent("elevenlabs-agent:expand", { detail: { action: "expand" } });
  document.dispatchEvent(event);
  const detail = event.detail as { _convaiEventHandled?: boolean };
  return Boolean(detail._convaiEventHandled);
}

export function VoiceWidgetRoot() {
  const pathname = usePathname();
  const hidden = pathname?.startsWith("/admin") ?? false;
  const waitingRef = useRef(false);

  useEffect(() => {
    if (hidden) return;
    const requestOpen = () => {
      waitingRef.current = true;
      if (openConvai()) waitingRef.current = false;
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("#open-voice-demo-btn")) requestOpen();
    };
    document.addEventListener("click", onClick);
    window.addEventListener("voicepilot:open-widget", requestOpen);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("voicepilot:open-widget", requestOpen);
    };
  }, [hidden]);

  useEffect(() => {
    if (hidden) return;
    const existing = document.querySelector(`script[src="${EMBED_SCRIPT}"]`);
    const reveal = () => {
      if (!waitingRef.current) return;
      window.setTimeout(() => {
        if (openConvai()) waitingRef.current = false;
      }, 0);
    };
    if (existing) {
      reveal();
      return;
    }
    const script = document.createElement("script");
    script.src = EMBED_SCRIPT;
    script.async = true;
    script.type = "text/javascript";
    script.addEventListener("load", reveal);
    document.body.appendChild(script);
  }, [hidden]);

  if (hidden) return null;

  return createElement("elevenlabs-convai", {
    "agent-id": "agent_5201m7mr47ymf9tb4ztdvv0vw29f",
  });
}
