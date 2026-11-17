"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { SpeakingOrb } from "@/components/voice-widget/SpeakingOrb";
import { AudioQueue, preloadClips, type AudioQueueState } from "@/lib/voice-engine/audio-queue";
import { matchLocalFast } from "@/lib/voice-engine/local-fast";
import { createMicrophoneListener, type MicrophoneListener } from "@/lib/voice-engine/microphone";
import { joinSpeech, revealSpeech } from "@/lib/voice-engine/speech-text";
import type { SiteMap } from "@/lib/voice-engine/site-map";
import { isIntent, isLang, isSitePage, type FastDecision, type SitePageId } from "@/lib/voice-engine/types";

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

type VoiceTimings = {
  sttMs: number;
  fastPathMs: number | null;
  llmFirstTokenMs: number | null;
  slowPathAudioMs: number | null;
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

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

type StreamDone = {
  reply: string;
  clipText: string;
  lang: string;
};

async function readVoiceStream(
  response: Response,
  hooks: {
    onToken: (ms: number) => void;
    onAudio: (bytes: Uint8Array) => Promise<void>;
  },
): Promise<StreamDone> {
  if (!response.ok || !response.body) throw new Error("Request failed");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let donePayload: StreamDone | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isRecord(parsed)) continue;
        event = parsed;
      } catch {
        continue;
      }
      if (event.type === "token" && typeof event.llmFirstTokenMs === "number") hooks.onToken(event.llmFirstTokenMs);
      if (event.type === "audio" && typeof event.b64 === "string") await hooks.onAudio(decodeBase64(event.b64));
      if (event.type === "error") {
        throw new Error(typeof event.error === "string" ? event.error : "Request failed");
      }
      if (event.type === "done" && typeof event.reply === "string") {
        donePayload = {
          reply: event.reply,
          clipText: typeof event.clipText === "string" ? event.clipText : "",
          lang: typeof event.lang === "string" ? event.lang : "yue",
        };
      }
    }
    if (done) break;
  }
  if (!donePayload) throw new Error("Request failed");
  return donePayload;
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
  const callOnRef = useRef(false);
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
  const [callOn, setCallOn] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [caption, setCaption] = useState("");
  const [timings, setTimings] = useState<VoiceTimings | null>(null);
  const [messages, setMessages] = useState<ChatLine[]>([]);
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const clipKey = clips.join("|");

  openRef.current = open;
  callOnRef.current = callOn;
  speakerOnRef.current = speakerOn;
  listeningRef.current = listening;

  const getPlaybackLevel = useCallback(() => queueRef.current?.getLevel() ?? 0, []);

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
    callOnRef.current = true;
    setCallOn(true);
    void listener
      .start()
      .then(() => {
        if (!openRef.current || !callOnRef.current || !listener.isRunning()) return;
        listeningRef.current = true;
        setListening(true);
        setError("");
      })
      .catch(() => {
        listeningRef.current = false;
        callOnRef.current = false;
        setListening(false);
        setCallOn(false);
        setError("麥克風未獲允許");
      });
  }

  function hangUp(): void {
    if (queueRef.current?.getState() !== "IDLE" || inflightRef.current) bargeInFromUser();
    listenerRef.current?.stop();
    listeningRef.current = false;
    callOnRef.current = false;
    setListening(false);
    setCallOn(false);
    setTranscribing(false);
  }

  function openPanel(): void {
    openRef.current = true;
    setOpen(true);
  }

  function closePanel(): void {
    openRef.current = false;
    setOpen(false);
    setSettingsOpen(false);
    callOnRef.current = false;
    setCallOn(false);
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
    const openFromSite = () => {
      openPanel();
      beginListening();
    };
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

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-voice-settings]")) return;
      setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [settingsOpen]);

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

  async function runTurn(text: string, turn: number, sttMs: number): Promise<void> {
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
    const textReady = performance.now();
    const timings: VoiceTimings = {
      sttMs,
      fastPathMs: null,
      llmFirstTokenMs: null,
      slowPathAudioMs: null,
    };
    const publishTimings = () => {
      const snapshot = { ...timings };
      setTimings(snapshot);
      console.info("[voice]", snapshot);
    };
    publishTimings();

    const applyDecision = (decision: FastDecision) => {
      if (turnRef.current !== turn || activeRef.current !== active) return;
      active.opener = decision.clipText;
      if (active.holdText || !speakerOnRef.current) {
        active.holdText = true;
        publishActive(active);
      } else {
        const buffer = buffersRef.current.get(decision.clipFile);
        if (buffer) queue.playClip(generation, buffer);
        else queue.skipClip(generation);
      }
      timings.fastPathMs = Math.round(performance.now() - textReady);
      publishTimings();
      if (decision.navigateUrl !== "NONE" && decision.pageName) {
        openSitePage(decision.navigateUrl, decision.sectionId, decision.pageName);
      }
    };

    let decision: FastDecision | null = matchLocalFast(text, siteMap, { currentPage, turnCount });
    if (decision) {
      applyDecision(decision);
    } else {
      try {
        const payload = await postJson(
          "/api/fast-decision",
          { text, siteMap, currentPage, turnCount },
          controller.signal,
        );
        if (turnRef.current !== turn || activeRef.current !== active) return;
        decision = readDecision(payload);
        applyDecision(decision);
      } catch (reason: unknown) {
        if (turnRef.current !== turn || controller.signal.aborted) return;
        if (!active.holdText) queue.skipClip(generation);
        setError(publicError(reason));
        decision = null;
      }
    }

    if (turnRef.current !== turn || activeRef.current !== active) return;
    const slowStarted = performance.now();
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
            voiceId,
          }
        : {
            text,
            knowledgeBasePath,
            currentPage,
            turnCount,
            siteId: "voicepilot-hq",
            sessionId: sessionRef.current,
            voiceId,
          };
    try {
      const response = await fetch("/api/chat-relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (turnRef.current !== turn || activeRef.current !== active) return;
      let heardAudio = false;
      const result = await readVoiceStream(response, {
        onToken: (ms) => {
          timings.llmFirstTokenMs = ms;
          publishTimings();
        },
        onAudio: async (bytes) => {
          if (turnRef.current !== turn || active.holdText || !speakerOnRef.current) return;
          const played = await queue.appendMp3(generation, bytes);
          if (played && !heardAudio) {
            heardAudio = true;
            timings.slowPathAudioMs = Math.round(performance.now() - slowStarted);
            publishTimings();
          }
        },
      });
      if (turnRef.current !== turn || activeRef.current !== active) return;
      active.reply = result.reply;
      if (!active.opener) active.opener = result.clipText;
      if (active.holdText || !speakerOnRef.current) {
        active.holdText = true;
        publishActive(active);
      } else {
        queue.endSegments(generation);
      }
    } catch (reason: unknown) {
      if (turnRef.current !== turn || controller.signal.aborted) return;
      queue.failStream(generation);
      queue.endSegments(generation);
      setError(publicError(reason));
    }
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
    const sttStarted = performance.now();
    void transcribe(audio, controller.signal)
      .then(async (text) => {
        const sttMs = Math.round(performance.now() - sttStarted);
        if (turnRef.current !== turn) return;
        if (!text) {
          inflightRef.current = false;
          setError("聽唔到內容");
          return;
        }
        setTranscribing(false);
        await runTurn(text, turn, sttMs);
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
    void runTurn(text, turn, 0);
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

  function onCallPress(): void {
    if (callOnRef.current) hangUp();
    else beginListening();
  }

  const talking = queueState !== "IDLE" && speakerOn;
  const callLabel = callOn ? "結束通話" : "開始通話";
  const status = talking ? "講緊" : transcribing ? "識別緊" : listening ? "聆聽緊" : "準備麥克風";

  const panel = (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(28rem,calc(100vw-1.5rem))] flex-col items-end">
      {open ? (
        <section
          id="voice-widget-panel"
          role="dialog"
          aria-label="語音專員"
          className="pointer-events-auto flex h-[min(44rem,calc(100dvh-2rem))] w-full flex-col overflow-hidden rounded-[1.75rem] bg-white text-[#101828] shadow-stripe-lg"
          data-queue-state={queueState}
          data-clip-count={clipCount}
          data-listening={listening ? "true" : "false"}
          data-speaker={speakerOn ? "on" : "off"}
          data-caption={caption}
        >
          <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center px-6">
            <div className="relative">
              <SpeakingOrb getLevel={getPlaybackLevel} expanded={callOn} />
              <button
                type="button"
                onClick={onCallPress}
                aria-label={callLabel}
                data-call={callOn ? "on" : "off"}
                className={`absolute bottom-0 left-1/2 z-10 grid h-14 w-14 -translate-x-1/2 translate-y-1/2 place-items-center rounded-full border-[3px] border-white text-white shadow-[0_8px_18px_rgba(16,24,40,0.18)] ${
                  callOn ? "bg-[#22C55E]" : "bg-[#E11D48]"
                }`}
              >
                <PhoneIcon className="h-6 w-6" />
              </button>
            </div>
            <p className="sr-only" aria-live="polite">
              {status}
            </p>
            {caption || hint || error ? (
              <div className="mt-10 flex w-full flex-col items-center gap-2">
                {caption ? (
                  <p className="max-w-[18rem] bg-black px-3 py-2 text-center text-sm font-semibold leading-5 text-white" aria-live="polite">
                    {caption}
                  </p>
                ) : null}
                {hint ? (
                  <p className="text-center text-sm font-medium text-[#635BFF]" aria-live="polite">
                    {hint}
                  </p>
                ) : null}
                {error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
              </div>
            ) : null}
          </div>
          {messages.length > 0 ? (
            <div ref={threadRef} className="max-h-28 space-y-1 overflow-y-auto px-5 pb-2 text-sm leading-6">
              {messages.map((line) => (
                <p key={line.id} data-role={line.role} className={line.role === "user" ? "text-right text-[#667085]" : "text-[#101828]"}>
                  {line.text}
                </p>
              ))}
            </div>
          ) : (
            <div ref={threadRef} />
          )}
          <form onSubmit={sendDraft} className="px-4 pb-4">
            {timings ? (
              <p className="px-1 pb-1 text-[10px] leading-4 text-[#98A2B3]" data-voice-timings="true">
                sttMs {timings.sttMs} · fastPathMs {timings.fastPathMs ?? "—"} · llmFirstTokenMs{" "}
                {timings.llmFirstTokenMs ?? "—"} · slowPathAudioMs {timings.slowPathAudioMs ?? "—"}
              </p>
            ) : null}
            <div className="rounded-[1.35rem] border border-[#E4E7EC] bg-white px-3 pb-2.5 pt-3">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="發送訊息以開始聊天"
                aria-label="發送訊息以開始聊天"
                maxLength={2000}
                autoComplete="off"
                className="w-full bg-transparent px-1 pb-2 text-sm text-[#101828] outline-none placeholder:text-[#98A2B3]"
              />
              <div className="flex items-center gap-1.5">
                <div className="relative" data-voice-settings="">
                  <button
                    type="button"
                    aria-label="設定"
                    aria-expanded={settingsOpen}
                    aria-controls="voice-widget-settings"
                    onClick={() => setSettingsOpen((current) => !current)}
                    className="grid h-9 w-9 place-items-center rounded-full text-[#667085] hover:bg-[#F2F4F7]"
                  >
                    <GearIcon />
                  </button>
                  {settingsOpen ? (
                    <div
                      id="voice-widget-settings"
                      className="absolute bottom-11 left-0 z-20 w-40 rounded-2xl border border-[#E4E7EC] bg-white p-1.5 shadow-stripe-md"
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={speakerOn}
                        aria-label={speakerOn ? "關閉語音播放" : "開啟語音播放"}
                        onClick={toggleSpeaker}
                        className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm text-[#101828] hover:bg-[#F2F4F7]"
                      >
                        <SpeakerIcon muted={!speakerOn} />
                        <span>{speakerOn ? "聲音開" : "聲音關"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={closePanel}
                        className="flex w-full rounded-xl px-2.5 py-2 text-left text-sm text-[#101828] hover:bg-[#F2F4F7]"
                      >
                        關閉
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={onMicPress}
                  aria-label={talking || transcribing ? "打斷" : "麥克風"}
                  className={`grid h-9 w-9 place-items-center rounded-full hover:bg-[#F2F4F7] ${
                    listening ? "text-[#101828]" : "text-[#667085]"
                  }`}
                >
                  <MicIcon />
                </button>
                <button
                  type="button"
                  onClick={onCallPress}
                  aria-label={callLabel}
                  className="inline-flex items-center gap-1.5 rounded-full px-1 py-1 text-sm font-medium text-[#E11D48]"
                >
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#E11D48] text-white">
                    <PhoneIcon className="h-3 w-3" />
                  </span>
                  電話
                </button>
                <div className="flex-1" />
                <button
                  type="submit"
                  aria-label="送出"
                  className="grid h-11 w-11 place-items-center rounded-full bg-black text-white"
                >
                  <PlayIcon />
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          aria-expanded={open}
          aria-controls="voice-widget-panel"
          className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-black text-white shadow-stripe-md"
          aria-label="語音專員助手"
        >
          <PhoneIcon className="h-6 w-6" />
        </button>
      )}
    </div>
  );

  if (pathname?.startsWith("/admin")) return null;
  if (mountNode) return createPortal(panel, mountNode);
  return panel;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 3.5a2.5 2.5 0 0 1 2.5 2.5v5a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 12 3.5Z" />
      <path d="M7 11a5 5 0 0 0 10 0" />
      <path d="M12 16v3.5" />
    </svg>
  );
}

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.5.6 3.6.1.4 0 .7-.3 1l-2.2 2.2Z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor" aria-hidden="true">
      <path d="M8 5.2v13.6L19 12 8 5.2Z" />
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
