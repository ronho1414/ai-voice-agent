"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SpeakingOrb } from "@/components/voice-widget/SpeakingOrb";
import { AudioQueue, preloadClips, type AudioQueueState } from "@/lib/voice-engine/audio-queue";
import { createMicrophoneListener, type MicrophoneListener } from "@/lib/voice-engine/microphone";
import { joinSpeech, revealSpeech } from "@/lib/voice-engine/speech-text";
import type { SiteMap } from "@/lib/voice-engine/site-map";
import { isIntent, isLang, isSitePage, type ChatRelayResult, type FastDecision, type SitePageId } from "@/lib/voice-engine/types";

const MOUNT_ID = "CURSOR_VOICE_WIDGET_MOUNT_POINT";

export type VoiceWidgetProps = {
  knowledgeBasePath: string;
  siteMap: SiteMap;
  voiceId: string;
  clips: readonly string[];
  clipsBasePath?: string;
};

type ChatLine = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

type ActiveSpeech = {
  id: number;
  turn: number;
  generation: number;
  opener: string;
  reply: string;
  started: boolean;
  inserted: boolean;
  holdText: boolean;
  finished: boolean;
};

function currentSitePage(): SitePageId {
  if (typeof window === "undefined") return "home";
  const hash = window.location.hash.replace(/^#/, "");
  if (isSitePage(hash)) return hash;
  const page = new URLSearchParams(window.location.search).get("page") ?? "";
  if (isSitePage(page)) return page;
  return "home";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  if (message.length > 180 || /key|token|secret|bearer/i.test(message)) return "Request failed";
  return message;
}

async function postJson(url: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Request failed");
  }
  if (!response.ok) {
    const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Request failed";
    throw new Error(message);
  }
  return payload;
}

function readDecision(value: unknown): FastDecision {
  if (!isRecord(value)) throw new Error("Request failed");
  const { intent, lang, clipText, clipFile, navigateUrl, sectionId, pageName, confidence } = value;
  if (
    typeof intent !== "string" ||
    !isIntent(intent) ||
    typeof lang !== "string" ||
    !isLang(lang) ||
    typeof clipText !== "string" ||
    typeof clipFile !== "string" ||
    typeof navigateUrl !== "string" ||
    (typeof sectionId !== "string" && sectionId !== null && sectionId !== undefined) ||
    (typeof pageName !== "string" && pageName !== null) ||
    typeof confidence !== "number"
  ) {
    throw new Error("Request failed");
  }
  return {
    intent,
    lang,
    clipText,
    clipFile,
    navigateUrl,
    sectionId: typeof sectionId === "string" ? sectionId : null,
    pageName,
    confidence,
  };
}

function readRelay(value: unknown): ChatRelayResult {
  if (!isRecord(value)) throw new Error("Request failed");
  const { reply, clipText, lang } = value;
  if (typeof reply !== "string" || typeof clipText !== "string" || typeof lang !== "string" || !isLang(lang)) {
    throw new Error("Request failed");
  }
  return { reply, clipText, lang };
}

function useMountNode(id: string, pathname: string): HTMLElement | null {
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let current = document.getElementById(id);
    setNode(current);
    const observer = new MutationObserver(() => {
      const next = document.getElementById(id);
      if (next === current) return;
      current = next;
      setNode(next);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [id, pathname]);

  return node;
}

export function VoiceWidget({
  knowledgeBasePath,
  siteMap,
  voiceId,
  clips,
  clipsBasePath = "/clips",
}: VoiceWidgetProps) {
  const pathname = usePathname();
  const mountNode = useMountNode(MOUNT_ID, pathname);
  const queueRef = useRef<AudioQueue | null>(null);
  const listenerRef = useRef<MicrophoneListener | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef(0);
  const spokenTurnsRef = useRef(0);
  const sessionRef = useRef(globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`);
  const lineIdRef = useRef(0);
  const inflightRef = useRef(false);
  const speakerOnRef = useRef(true);
  const openRef = useRef(false);
  const listeningRef = useRef(false);
  const activeRef = useRef<ActiveSpeech | null>(null);
  const captionRef = useRef("");
  const micLevelRef = useRef(0);
  const utteranceRef = useRef<(audio: Blob) => void>(() => {});
  const speechStartRef = useRef<() => void>(() => {});
  const syncRef = useRef<() => void>(() => {});
  const [queueState, setQueueState] = useState<AudioQueueState>("IDLE");
  const [clipCount, setClipCount] = useState(0);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [open, setOpen] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const clipKey = clips.join("|");

  openRef.current = open;
  speakerOnRef.current = speakerOn;
  listeningRef.current = listening;

  const getPlaybackLevel = useCallback(() => queueRef.current?.getLevel() ?? 0, []);
  const getMicLevel = useCallback(() => micLevelRef.current, []);

  function writeAssistant(active: ActiveSpeech, text: string): void {
    if (!text || active.finished) return;
    if (!active.inserted) {
      active.inserted = true;
      setMessages((prev) => [...prev, { id: active.id, role: "assistant", text }]);
      return;
    }
    setMessages((prev) => {
      const index = prev.findIndex((line) => line.id === active.id);
      if (index === -1 || prev[index].text === text) return prev;
      const next = prev.slice();
      next[index] = { ...prev[index], text };
      return next;
    });
  }

  function clearCaption(): void {
    if (!captionRef.current) return;
    captionRef.current = "";
    setCaption("");
  }

  function publishActive(active: ActiveSpeech): void {
    writeAssistant(active, joinSpeech(active.opener, active.reply));
  }

  syncRef.current = () => {
    const queue = queueRef.current;
    const active = activeRef.current;
    if (!queue || !active || active.finished || active.generation !== queue.getSpeechClock().generation) return;
    const clock = queue.getSpeechClock();
    if (clock.phase !== "none") active.started = true;

    if (active.holdText || !speakerOnRef.current) {
      publishActive(active);
      clearCaption();
      if (active.started && clock.phase === "none" && queue.getState() === "IDLE") {
        active.finished = true;
        if (turnRef.current === active.turn) inflightRef.current = false;
      }
      return;
    }

    if (clock.phase === "none") {
      if (!active.started) return;
      publishActive(active);
      clearCaption();
      active.finished = true;
      if (turnRef.current === active.turn) inflightRef.current = false;
      return;
    }

    const ratio = clock.duration > 0 ? Math.min(1, Math.max(0, (queue.now() - clock.startedAt) / clock.duration)) : 1;
    let spoken = "";
    let bubble = "";
    if (clock.phase === "clip") {
      spoken = revealSpeech(active.opener, ratio);
      bubble = spoken;
    } else if (clock.phase === "gap") {
      spoken = active.opener;
      bubble = active.opener;
    } else {
      spoken = revealSpeech(active.reply, ratio);
      bubble = joinSpeech(active.opener, spoken);
    }
    if (bubble) writeAssistant(active, bubble);
    if (spoken !== captionRef.current) {
      captionRef.current = spoken;
      setCaption(spoken);
    }
  };

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      syncRef.current();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, caption, hint, open]);

  useEffect(() => {
    const context = new AudioContext();
    const queue = new AudioQueue(context);
    const listener = createMicrophoneListener(context, {
      onSpeechStart: () => speechStartRef.current(),
      onUtterance: (audio) => utteranceRef.current(audio),
      onLevel: (level) => {
        micLevelRef.current = level;
      },
    });
    queueRef.current = queue;
    listenerRef.current = listener;
    let alive = true;
    const unsubscribe = queue.subscribe((state) => {
      listener.setPlaybackActive(state !== "IDLE");
      if (state === "PLAYING_CLIP" || state === "PLAYING_STREAM") listener.hold(240);
      else if (state === "IDLE") listener.hold(300);
      if (alive) setQueueState(state);
    });
    void preloadClips(context, clips, clipsBasePath).then((buffers) => {
      if (!alive) return;
      buffersRef.current = buffers;
      setClipCount(buffers.size);
    });
    return () => {
      alive = false;
      unsubscribe();
      listener.stop();
      queue.bargeIn();
      void context.close();
      if (queueRef.current === queue) queueRef.current = null;
      if (listenerRef.current === listener) listenerRef.current = null;
    };
    // clipKey tracks the configured file list. clips is read for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, clipsBasePath]);

  function bargeInFromUser(): void {
    const queue = queueRef.current;
    const playing = queue !== null && queue.getState() !== "IDLE";
    if (!playing && !inflightRef.current) return;
    turnRef.current += 1;
    inflightRef.current = false;
    abortRef.current?.abort();
    queue?.bargeIn();
    setTranscribing(false);
    setHint(null);
    clearCaption();
  }

  function beginListening(): void {
    const listener = listenerRef.current;
    if (!listener) return;
    void listener
      .start()
      .then(() => {
        if (!openRef.current || !listener.isRunning()) return;
        listeningRef.current = true;
        setListening(true);
        setError("");
      })
      .catch(() => {
        listeningRef.current = false;
        setListening(false);
        setError("麥克風未獲允許");
      });
  }

  function openPanel(): void {
    openRef.current = true;
    setOpen(true);
    beginListening();
  }

  function closePanel(): void {
    openRef.current = false;
    setOpen(false);
    listenerRef.current?.stop();
    listeningRef.current = false;
    setListening(false);
    turnRef.current += 1;
    inflightRef.current = false;
    abortRef.current?.abort();
    queueRef.current?.bargeIn();
    setTranscribing(false);
    clearCaption();
  }

  useEffect(() => {
    const openFromSite = () => openPanel();
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("#open-voice-demo-btn")) openFromSite();
    };
    window.addEventListener("voicepilot:open-widget", openFromSite);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("voicepilot:open-widget", openFromSite);
      document.removeEventListener("click", onClick);
    };
    // openPanel reads refs and the listener created on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pumpReply(turn: number, generation: number, result: ChatRelayResult, signal: AbortSignal) {
    const queue = queueRef.current;
    if (!queue || turnRef.current !== turn) return;
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: result.reply, lang: result.lang, voiceId }),
      signal,
    });
    if (!response.ok || !response.body) {
      queue.failStream(generation);
      throw new Error("Request failed");
    }
    const reader = response.body.getReader();
    while (turnRef.current === turn) {
      const { done, value } = await reader.read();
      if (value) queue.pushStreamChunk(generation, value);
      if (done) {
        queue.finishStream(generation);
        return;
      }
    }
    await reader.cancel();
    queue.failStream(generation);
  }

  function openSitePage(pageId: string, sectionId: string | null, pageName: string): void {
    setHint(`正在為您前往：${pageName}`);
    const options = sectionId ? { sectionId } : undefined;
    if (window.location.pathname === "/" && typeof window.navigateToPage === "function") {
      window.navigateToPage(pageId, options);
      return;
    }
    const target = sectionId
      ? `/?page=${encodeURIComponent(pageId)}&section=${encodeURIComponent(sectionId)}`
      : `/#${encodeURIComponent(pageId)}`;
    window.location.assign(target);
  }

  async function runTurn(text: string, turn: number): Promise<void> {
    const queue = queueRef.current;
    if (!queue || turnRef.current !== turn) return;
    await queue.resume();
    if (turnRef.current !== turn) return;

    const generation = queue.beginTurn();
    const speak = speakerOnRef.current;
    queue.setMuted(!speak);
    const userId = ++lineIdRef.current;
    const assistantId = ++lineIdRef.current;
    setMessages((prev) => [...prev, { id: userId, role: "user", text }]);
    const active: ActiveSpeech = {
      id: assistantId,
      turn,
      generation,
      opener: "",
      reply: "",
      started: false,
      inserted: false,
      holdText: !speak,
      finished: false,
    };
    activeRef.current = active;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");

    const turnCount = (spokenTurnsRef.current += 1);
    const currentPage = currentSitePage();
    const fast = postJson(
      "/api/fast-decision",
      { text, siteMap, currentPage, turnCount },
      controller.signal,
    )
      .then((payload) => {
        if (turnRef.current !== turn || activeRef.current !== active) return null;
        const decision = readDecision(payload);
        active.opener = decision.clipText;
        if (active.holdText || !speakerOnRef.current) {
          active.holdText = true;
          publishActive(active);
        } else {
          const buffer = buffersRef.current.get(decision.clipFile);
          if (buffer) queue.playClip(generation, buffer);
          else queue.skipClip(generation);
        }
        if (decision.navigateUrl !== "NONE" && decision.pageName) {
          openSitePage(decision.navigateUrl, decision.sectionId, decision.pageName);
        }
        return decision;
      })
      .catch((reason: unknown) => {
        if (turnRef.current !== turn || controller.signal.aborted) return null;
        if (!active.holdText) queue.skipClip(generation);
        setError(publicError(reason));
        return null;
      });

    const relay = fast.then(async (decision) => {
      if (turnRef.current !== turn || activeRef.current !== active) return;
      const body = decision
        ? {
            text,
            knowledgeBasePath,
            currentPage,
            turnCount,
            openerTranscript: decision.clipText,
            lang: decision.lang,
            siteId: "voicepilot-hq",
            sessionId: sessionRef.current,
            intent: decision.intent,
            openerClipId: decision.clipFile,
          }
        : {
            text,
            knowledgeBasePath,
            currentPage,
            turnCount,
            siteId: "voicepilot-hq",
            sessionId: sessionRef.current,
          };
      try {
        const payload = await postJson("/api/chat-relay", body, controller.signal);
        if (turnRef.current !== turn || activeRef.current !== active) return;
        const result = readRelay(payload);
        active.reply = result.reply;
        if (!active.opener) active.opener = result.clipText;
        if (active.holdText || !speakerOnRef.current) {
          active.holdText = true;
          publishActive(active);
          return;
        }
        await pumpReply(turn, generation, result, controller.signal);
      } catch (reason: unknown) {
        if (turnRef.current !== turn || controller.signal.aborted) return;
        queue.failStream(generation);
        setError(publicError(reason));
      }
    });

    await Promise.allSettled([fast, relay]);
    if (turnRef.current !== turn || activeRef.current !== active) return;
    if (queue.getState() === "IDLE") {
      publishActive(active);
      inflightRef.current = false;
    }
  }

  async function transcribe(audio: Blob, signal: AbortSignal): Promise<string> {
    const response = await fetch("/api/stt", {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/wav" },
      body: audio,
      signal,
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Request failed";
      throw new Error(message);
    }
    if (!isRecord(payload) || typeof payload.text !== "string") throw new Error("Request failed");
    return payload.text.trim();
  }

  utteranceRef.current = (audio) => {
    const turn = turnRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    inflightRef.current = true;
    setTranscribing(true);
    setError("");
    void transcribe(audio, controller.signal)
      .then(async (text) => {
        if (turnRef.current !== turn) return;
        if (!text) {
          inflightRef.current = false;
          setError("聽唔到內容");
          return;
        }
        setTranscribing(false);
        await runTurn(text, turn);
      })
      .catch((reason: unknown) => {
        if (turnRef.current !== turn || controller.signal.aborted) return;
        inflightRef.current = false;
        setError(publicError(reason));
      })
      .finally(() => {
        if (turnRef.current === turn) setTranscribing(false);
      });
  };

  speechStartRef.current = () => {
    const queue = queueRef.current;
    const playing = queue !== null && queue.getState() !== "IDLE";
    if (!playing && !inflightRef.current) return;
    bargeInFromUser();
  };

  function toggleSpeaker(): void {
    setSpeakerOn((current) => {
      const next = !current;
      speakerOnRef.current = next;
      queueRef.current?.setMuted(!next);
      const active = activeRef.current;
      if (!next && active && !active.finished) {
        active.holdText = true;
        publishActive(active);
        clearCaption();
      }
      return next;
    });
  }

  function sendDraft(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const queue = queueRef.current;
    const playing = queue !== null && queue.getState() !== "IDLE";
    if (playing || inflightRef.current) bargeInFromUser();
    const turn = turnRef.current;
    inflightRef.current = true;
    void runTurn(text, turn);
  }

  function onMicPress(): void {
    const queue = queueRef.current;
    const playing = queue !== null && queue.getState() !== "IDLE";
    if (playing || inflightRef.current) {
      bargeInFromUser();
      return;
    }
    if (!listeningRef.current) beginListening();
  }

  const talking = queueState !== "IDLE" && speakerOn;
  const status = talking ? "講緊" : transcribing ? "識別緊" : listening ? "聆聽緊" : "準備麥克風";
  const showOrb = open && talking;

  const panel = (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(28rem,calc(100vw-1.5rem))] flex-col items-end gap-3">
      {open ? (
        <section
          id="voice-widget-panel"
          role="dialog"
          aria-label="語音專員"
          className="pointer-events-auto flex h-[min(40rem,calc(100dvh-6.5rem))] w-full flex-col overflow-hidden rounded-3xl border border-[#E2E8F0] bg-[#F4F7FB] text-[#0A2540] shadow-stripe-lg"
          data-queue-state={queueState}
          data-clip-count={clipCount}
          data-listening={listening ? "true" : "false"}
          data-speaker={speakerOn ? "on" : "off"}
          data-caption={caption}
        >
          <header className="flex items-center justify-between gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3">
            <div>
              <p className="text-sm font-extrabold">語音專員</p>
              <p className="text-xs text-[#425466]">{status}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                role="switch"
                aria-checked={speakerOn}
                aria-label={speakerOn ? "關閉語音播放" : "開啟語音播放"}
                onClick={toggleSpeaker}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  speakerOn ? "bg-[#635BFF] text-white" : "bg-[#E8EDF5] text-[#425466]"
                }`}
              >
                <SpeakerIcon muted={!speakerOn} />
                <span>{speakerOn ? "聲音開" : "聲音關"}</span>
              </button>
              <button
                type="button"
                onClick={closePanel}
                aria-label="關閉"
                className="rounded-lg px-2 py-1 text-xs font-semibold text-[#425466] hover:bg-[#F6F9FC]"
              >
                關閉
              </button>
            </div>
          </header>
          {hint ? (
            <p className="bg-white px-4 py-2 text-sm font-medium text-[#635BFF]" aria-live="polite">
              {hint}
            </p>
          ) : null}
          {error ? <p className="bg-white px-4 py-2 text-sm text-red-600">{error}</p> : null}
          <div className="flex min-h-0 flex-1 flex-col">
            {showOrb ? (
              <div className="shrink-0 border-b border-[#E2E8F0] bg-white px-4 py-4">
                <SpeakingOrb getLevel={getPlaybackLevel} caption={caption} onInterrupt={bargeInFromUser} />
              </div>
            ) : null}
            <div ref={threadRef} className="flex min-h-36 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 ? (
                <p className="px-4 pt-6 text-center text-sm leading-6 text-[#425466]">
                  直接講，或者打字。我會先出一句開場白，再答重點。
                </p>
              ) : null}
              {messages.map((line) => (
                <div key={line.id} className={line.role === "user" ? "flex justify-end" : "flex justify-start"} data-role={line.role}>
                  <p
                    className={
                      line.role === "user"
                        ? "max-w-[85%] rounded-2xl rounded-br-md bg-[#635BFF] px-3.5 py-2.5 text-sm leading-6 text-white"
                        : "max-w-[85%] rounded-2xl rounded-bl-md border border-[#E2E8F0] bg-white px-3.5 py-2.5 text-sm leading-6 text-[#0A2540] shadow-stripe-sm"
                    }
                  >
                    {line.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <footer className="border-t border-[#E2E8F0] bg-white">
            <form onSubmit={sendDraft} className="flex items-center gap-2 px-3 pt-3">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="打字問我"
                aria-label="打字問我"
                maxLength={2000}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-full border border-[#E2E8F0] bg-[#F6F9FC] px-3 py-2 text-sm text-[#0A2540] outline-none focus:border-[#635BFF]"
              />
              <button
                type="submit"
                aria-label="送出"
                className="shrink-0 rounded-full bg-[#635BFF] px-3 py-2 text-xs font-semibold text-white hover:bg-[#5249F5]"
              >
                送出
              </button>
            </form>
            <div className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                onClick={onMicPress}
                aria-label={talking || transcribing ? "打斷" : "麥克風"}
                className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#635BFF] text-white"
              >
                <MicPulse getLevel={getMicLevel} />
                <MicIcon />
              </button>
              <p className="text-sm text-[#425466]">{status}</p>
            </div>
          </footer>
        </section>
      ) : null}
      <button
        type="button"
        onClick={() => {
          if (openRef.current) closePanel();
          else openPanel();
        }}
        aria-expanded={open}
        aria-controls="voice-widget-panel"
        className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#635BFF] text-white shadow-stripe-md hover:bg-[#5249F5]"
        aria-label="語音專員助手"
      >
        <MicIcon />
      </button>
    </div>
  );

  if (pathname?.startsWith("/admin")) return null;
  if (mountNode) return createPortal(panel, mountNode);
  return panel;
}

function MicPulse({ getLevel }: { getLevel: () => number }) {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = () => {
      shown += (getLevel() - shown) * 0.45;
      const next = 1 + Math.min(0.7, shown * 9);
      setScale((current) => (Math.abs(current - next) < 0.03 ? current : next));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel]);

  return (
    <span
      aria-hidden="true"
      className="absolute inset-0 rounded-full bg-[#635BFF]/30"
      style={{ transform: `scale(${scale})` }}
    />
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="relative h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 10v4h3l4 3V7L7 10H4Z" />
      {muted ? <path d="M16 10l4 4M20 10l-4 4" /> : <path d="M16 9a4 4 0 0 1 0 6" />}
    </svg>
  );
}
