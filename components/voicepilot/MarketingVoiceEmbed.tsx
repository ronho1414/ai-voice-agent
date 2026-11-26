"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  attachClientToolsListener,
  buildHomepageClientTools,
  installHomepageActionHandlers,
  type OraiWindow,
} from "@/lib/embed/orai-client-tools";

export const OFFICIAL_ELEVENLABS_AGENT_ID = "agent_8201m7sbetj3e36s1a2nv3fgcqna";
export const OFFICIAL_WIDGET_DEFAULT_LANGUAGE = "yue";
export const OFFICIAL_WIDGET_VERSION = "0.28.1";
export const OFFICIAL_WIDGET_SCRIPT_SRC = `https://unpkg.com/@elevenlabs/convai-widget-embed@${OFFICIAL_WIDGET_VERSION}/dist/index.js`;
export const OFFICIAL_WIDGET_LEGACY_SCRIPT_SRC = "https://unpkg.com/@elevenlabs/convai-widget-embed";
export const OFFICIAL_WIDGET_SCRIPT_ATTR = "data-elevenlabs-convai-embed";
export const OFFICIAL_WIDGET_HOST_ATTR = "data-orai-official-widget-host";

const CANTONESE_LANGUAGE_ENTRY = 'yue:{name:"Cantonese",flagCode:"hk",languageCode:"yue"}';
const ENGLISH_LANGUAGE_ENTRY_RE = /(en:\{name:[`'"']English[`'"'],flagCode:[`'"']us[`'"'],languageCode:[`'"']en[`'"']\})/;
const HAS_CANTONESE_ENTRY_RE = /languageCode:\s*[`'"']yue[`'"']/;

const inFlightScriptLoads = new WeakMap<Document, Promise<HTMLScriptElement | null>>();

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "elevenlabs-convai": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          "agent-id": string;
          language?: string;
        },
        HTMLElement
      >;
    }
  }
}

export function shouldRenderOfficialWidget(pathname: string | null | undefined): boolean {
  return pathname === "/";
}

export function patchCantoneseLanguageEntry(code: string): string {
  if (HAS_CANTONESE_ENTRY_RE.test(code)) return code;
  if (!ENGLISH_LANGUAGE_ENTRY_RE.test(code)) return code;
  return code.replace(ENGLISH_LANGUAGE_ENTRY_RE, `${CANTONESE_LANGUAGE_ENTRY},$1`);
}

export function findOfficialWidgetScript(doc: Document): HTMLScriptElement | null {
  return doc.querySelector<HTMLScriptElement>(
    `script[src="${OFFICIAL_WIDGET_SCRIPT_SRC}"], script[src="${OFFICIAL_WIDGET_LEGACY_SCRIPT_SRC}"], script[${OFFICIAL_WIDGET_SCRIPT_ATTR}="true"]`,
  );
}

function appendOfficialScript(
  doc: Document,
  src: string,
  onSettled?: () => void,
  onBlobError?: () => void,
): HTMLScriptElement | null {
  const target = doc.body ?? doc.head ?? doc.documentElement;
  if (!target) return null;

  const script = doc.createElement("script");
  script.src = src;
  script.async = true;
  script.type = "text/javascript";
  script.setAttribute(OFFICIAL_WIDGET_SCRIPT_ATTR, "true");
  if (typeof script.addEventListener === "function") {
    script.addEventListener("load", () => onSettled?.(), { once: true });
    script.addEventListener(
      "error",
      () => {
        onSettled?.();
        if (onBlobError) {
          script.remove();
          onBlobError();
        }
      },
      { once: true },
    );
  }
  target.appendChild(script);
  return script;
}

export async function ensureOfficialWidgetScript(
  doc: Document,
  win?: Pick<Window, "customElements" | "fetch">,
): Promise<HTMLScriptElement | null> {
  const existing = findOfficialWidgetScript(doc);
  if (existing) return existing;
  if (win?.customElements?.get("elevenlabs-convai")) return null;

  const pending = inFlightScriptLoads.get(doc);
  if (pending) return pending;

  const loadPromise = (async (): Promise<HTMLScriptElement | null> => {
    const fetchFn = win?.fetch ?? globalThis.fetch;
    let srcToAppend = OFFICIAL_WIDGET_SCRIPT_SRC;
    let revokeBlob: (() => void) | undefined;

    if (typeof fetchFn === "function") {
      try {
        const response = await fetchFn(OFFICIAL_WIDGET_SCRIPT_SRC);
        if (response.ok) {
          const code = await response.text();
          const patched = patchCantoneseLanguageEntry(code);
          if (
            patched !== code &&
            typeof Blob === "function" &&
            typeof URL !== "undefined" &&
            typeof URL.createObjectURL === "function"
          ) {
            const blobUrl = URL.createObjectURL(new Blob([patched], { type: "text/javascript" }));
            srcToAppend = blobUrl;
            revokeBlob = () => URL.revokeObjectURL(blobUrl);
          }
        }
      } catch {
        // Fall back to loading the official CDN URL directly if fetch fails.
      }
    }

    const alreadyAdded = findOfficialWidgetScript(doc);
    if (alreadyAdded) {
      revokeBlob?.();
      return alreadyAdded;
    }
    if (win?.customElements?.get("elevenlabs-convai")) {
      revokeBlob?.();
      return null;
    }

    const fallbackDirect =
      revokeBlob && srcToAppend !== OFFICIAL_WIDGET_SCRIPT_SRC
        ? () => {
            if (!findOfficialWidgetScript(doc) && !win?.customElements?.get("elevenlabs-convai")) {
              appendOfficialScript(doc, OFFICIAL_WIDGET_SCRIPT_SRC);
            }
          }
        : undefined;

    return appendOfficialScript(doc, srcToAppend, revokeBlob, fallbackDirect);
  })().finally(() => {
    inFlightScriptLoads.delete(doc);
  });

  inFlightScriptLoads.set(doc, loadPromise);
  return loadPromise;
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
    installHomepageActionHandlers(document, window as OraiWindow);
    const detachClientTools = attachClientToolsListener(document, () =>
      buildHomepageClientTools(window as OraiWindow, document),
    );
    void ensureOfficialWidgetScript(document, window);

    return () => {
      detachClientTools();
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
        /* Set initial language="yue" so zh-HK/zh browsers start in Cantonese instead of auto-switching while keeping the language picker active. */
        <elevenlabs-convai
          agent-id={OFFICIAL_ELEVENLABS_AGENT_ID}
          language={OFFICIAL_WIDGET_DEFAULT_LANGUAGE}
        />
      ) : null}
    </div>
  );
}
