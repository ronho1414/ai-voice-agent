"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

export const OFFICIAL_ELEVENLABS_AGENT_ID = "agent_8201m7sbetj3e36s1a2nv3fgcqna";
export const OFFICIAL_WIDGET_LANGUAGE_FALLBACK = "zh";
export const OFFICIAL_WIDGET_SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";
export const OFFICIAL_WIDGET_SCRIPT_ATTR = "data-elevenlabs-convai-embed";
export const OFFICIAL_WIDGET_HOST_ATTR = "data-orai-official-widget-host";

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "agent-id": string;
          "override-language"?: string;
        },
        HTMLElement
      >;
    }
  }
}

export function shouldRenderOfficialWidget(pathname: string | null | undefined): boolean {
  return pathname === "/";
}

export function findOfficialWidgetScript(doc: Document): HTMLScriptElement | null {
  return doc.querySelector<HTMLScriptElement>(
    `script[src="${OFFICIAL_WIDGET_SCRIPT_SRC}"], script[${OFFICIAL_WIDGET_SCRIPT_ATTR}="true"]`,
  );
}

export function ensureOfficialWidgetScript(doc: Document, win?: Pick<Window, "customElements">): HTMLScriptElement | null {
  const existing = findOfficialWidgetScript(doc);
  if (existing) return existing;
  if (win?.customElements?.get("elevenlabs-convai")) return null;

  const script = doc.createElement("script");
  script.src = OFFICIAL_WIDGET_SCRIPT_SRC;
  script.async = true;
  script.type = "text/javascript";
  script.setAttribute(OFFICIAL_WIDGET_SCRIPT_ATTR, "true");
  (doc.body ?? doc.head ?? doc.documentElement)?.appendChild(script);
  return script;
}

export function hasCompetingWidget(doc: Document, ownHost: Element | null): boolean {
  const existingWidget = doc.querySelector("elevenlabs-convai");
  if (existingWidget && (!ownHost || !ownHost.contains(existingWidget))) return true;
  const activeHost = doc.querySelector(`[${OFFICIAL_WIDGET_HOST_ATTR}="active"]`);
  return Boolean(activeHost && activeHost !== ownHost);
}

export function MarketingVoiceEmbed() {
  const pathname = usePathname();
  const isHomepage = shouldRenderOfficialWidget(pathname);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [shouldMountWidget, setShouldMountWidget] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!isHomepage || !host) {
      setShouldMountWidget(false);
      return;
    }
    if (hasCompetingWidget(document, host)) {
      setShouldMountWidget(false);
      return;
    }

    host.setAttribute(OFFICIAL_WIDGET_HOST_ATTR, "active");
    setShouldMountWidget(true);
    ensureOfficialWidgetScript(document, window);

    return () => {
      if (host.getAttribute(OFFICIAL_WIDGET_HOST_ATTR) === "active") {
        host.removeAttribute(OFFICIAL_WIDGET_HOST_ATTR);
      }
      setShouldMountWidget(false);
    };
  }, [isHomepage]);

  if (!isHomepage) return null;

  return (
    <div ref={hostRef}>
      {shouldMountWidget ? (
        /* The upstream embed bundle (@elevenlabs/convai-widget-embed) lacks a "yue" entry and throws reading languageCode unless override-language selects the agent's configured "zh" preset. */
        <elevenlabs-convai
          agent-id={OFFICIAL_ELEVENLABS_AGENT_ID}
          override-language={OFFICIAL_WIDGET_LANGUAGE_FALLBACK}
        />
      ) : null}
    </div>
  );
}
