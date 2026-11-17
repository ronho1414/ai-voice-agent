"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioQueue, preloadClips, type AudioQueueState } from "@/lib/voice-engine/audio-queue";
import type { SiteMap } from "@/lib/voice-engine/site-map";
import { isIntent, isLang, type ChatRelayResult, type FastDecision } from "@/lib/voice-engine/types";

const MOUNT_ID = "CURSOR_VOICE_WIDGET_MOUNT_POINT";

export type VoiceWidgetProps = {
  knowledgeBasePath: string;
  siteMap: SiteMap;
  voiceId: string;
  clips: readonly string[];
  clipsBasePath?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  const { intent, lang, clipText, clipFile, navigateUrl, pageName, confidence } = value;
  if (
    typeof intent !== "string" ||
    !isIntent(intent) ||
    typeof lang !== "string" ||
    !isLang(lang) ||
    typeof clipText !== "string" ||
    typeof clipFile !== "string" ||
    typeof navigateUrl !== "string" ||
    (typeof pageName !== "string" && pageName !== null) ||
    typeof confidence !== "number"
  ) {
    throw new Error("Request failed");
  }
  return { intent, lang, clipText, clipFile, navigateUrl, pageName, confidence };
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
  const router = useRouter();
  const pathname = usePathname();
  const mountNode = useMountNode(MOUNT_ID, pathname);
  const queueRef = useRef<AudioQueue | null>(null);
  const buffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const turnRef = useRef(0);
  const [queueState, setQueueState] = useState<AudioQueueState>("IDLE");
  const [clipCount, setClipCount] = useState(0);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const clipKey = clips.join("|");

  useEffect(() => {
    const context = new AudioContext();
    const queue = new AudioQueue(context);
    queueRef.current = queue;
    let active = true;
    const unsubscribe = queue.subscribe((state) => {
      if (active) setQueueState(state);
    });
    void preloadClips(context, clips, clipsBasePath).then((buffers) => {
      if (!active) return;
      buffersRef.current = buffers;
      setClipCount(buffers.size);
    });
    return () => {
      active = false;
      unsubscribe();
      queue.bargeIn();
      void context.close();
    };
    // clipKey tracks the configured file list. clips is read for this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey, clipsBasePath]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const openPanel = () => setOpen(true);
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("#open-voice-demo-btn")) {
        setOpen(true);
      }
    };
    window.addEventListener("voicepilot:open-widget", openPanel);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("voicepilot:open-widget", openPanel);
      document.removeEventListener("click", onClick);
    };
  }, []);

  async function pumpReply(turn: number, generation: number, result: ChatRelayResult, signal: AbortSignal) {
    const queue = queueRef.current;
    if (!queue || turnRef.current !== turn) return;
    setReply(result.reply);
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

  async function runTurn(text: string) {
    const queue = queueRef.current;
    if (!queue) return;
    const turn = turnRef.current;
    await queue.resume();
    if (turnRef.current !== turn) return;
    const generation = queue.beginTurn();
    const controller = new AbortController();
    abortRef.current = controller;
    setTranscript(text);
    setReply("");
    setError("");
    setOpen(true);

    const fastBody = { text, siteMap };
    const relayBody = { text, knowledgeBasePath };

    void postJson("/api/fast-decision", fastBody, controller.signal)
      .then((payload) => {
        if (turnRef.current !== turn) return;
        const decision = readDecision(payload);
        const buffer = buffersRef.current.get(decision.clipFile);
        if (buffer) queue.playClip(generation, buffer);
        else queue.skipClip(generation);
        if (decision.navigateUrl !== "NONE" && decision.pageName) {
          setHint(`正在為您前往：${decision.pageName}`);
          if (decision.navigateUrl !== pathname) router.push(decision.navigateUrl);
        } else {
          setHint(null);
        }
      })
      .catch((reason: unknown) => {
        if (turnRef.current !== turn || controller.signal.aborted) return;
        queue.skipClip(generation);
        setError(reason instanceof Error ? reason.message : "Request failed");
      });

    void postJson("/api/chat-relay", relayBody, controller.signal)
      .then((payload) => pumpReply(turn, generation, readRelay(payload), controller.signal))
      .catch((reason: unknown) => {
        if (turnRef.current !== turn || controller.signal.aborted) return;
        queue.failStream(generation);
        setError(reason instanceof Error ? reason.message : "Request failed");
      });
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  async function startRecording() {
    const queue = queueRef.current;
    turnRef.current += 1;
    abortRef.current?.abort();
    queue?.bargeIn();
    setHint(null);
    setError("");
    setReply("");
    setTranscribing(false);
    await queue?.resume();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "";
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    const parts: Blob[] = [];
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) parts.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setRecording(false);
      const blob = new Blob(parts, { type: recorder.mimeType || "audio/webm" });
      const turn = turnRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      setTranscribing(true);
      void fetch("/api/stt", {
        method: "POST",
        headers: { "Content-Type": blob.type },
        body: blob,
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload: unknown = await response.json();
          if (!response.ok) {
            const message = isRecord(payload) && typeof payload.error === "string" ? payload.error : "Request failed";
            throw new Error(message);
          }
          if (!isRecord(payload) || typeof payload.text !== "string") {
            throw new Error("Request failed");
          }
          return payload.text.trim();
        })
        .then((text) => {
          if (turnRef.current !== turn) return;
          if (!text) {
            setError("聽唔到內容");
            return;
          }
          return runTurn(text);
        })
        .catch((reason: unknown) => {
          if (turnRef.current !== turn || controller.signal.aborted) return;
          setError(reason instanceof Error ? reason.message : "Request failed");
        })
        .finally(() => {
          if (turnRef.current === turn) setTranscribing(false);
        });
    };
    recorder.start();
    setRecording(true);
  }

  async function onMic() {
    if (recording) {
      stopRecording();
      return;
    }
    try {
      await startRecording();
    } catch {
      setRecording(false);
      setError("麥克風未獲允許");
    }
  }

  function closePanel() {
    if (recording) stopRecording();
    setOpen(false);
  }

  const status = recording
    ? "聆聽緊"
    : transcribing
      ? "識別緊"
      : queueState === "PLAYING_CLIP"
        ? "播放開場白"
        : queueState === "BUFFERING_STREAM"
          ? "等緊接句"
          : queueState === "PLAYING_STREAM"
            ? "播放回覆"
            : "按一下講";

  const panel = (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(100vw-2.5rem,22rem)] flex-col items-end gap-3">
      {open ? (
        <section
          id="voice-widget-panel"
          className="pointer-events-auto w-full rounded-2xl border border-[#E2E8F0] bg-white p-4 text-[#0A2540] shadow-stripe-lg"
          data-queue-state={queueState}
          data-clip-count={clipCount}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold">語音專員</p>
              <p className="text-xs text-[#425466]">
                {status}
                <span className="ml-2 opacity-60">{queueState}</span>
                <span className="ml-2 opacity-60">clips {clipCount}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={closePanel}
              className="rounded-lg px-2 py-1 text-xs font-semibold text-[#425466] hover:bg-[#F6F9FC]"
            >
              關閉
            </button>
          </div>
          {hint ? (
            <p className="mb-3 text-sm font-medium" aria-live="polite">
              {hint}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              void onMic();
            }}
            aria-pressed={recording}
            aria-label="Microphone"
            className="rounded-full bg-[#635BFF] px-4 py-2 text-sm font-bold text-white hover:bg-[#5249F5]"
          >
            {recording ? "停止" : "麥克風"}
          </button>
          {transcript ? <p className="mt-3 text-sm">你：{transcript}</p> : null}
          {reply ? <p className="mt-2 text-sm">回覆：{reply}</p> : null}
          {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        </section>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls="voice-widget-panel"
        className="pointer-events-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#635BFF] text-white shadow-stripe-md hover:bg-[#5249F5]"
        aria-label="語音專員助手"
      >
        <MicIcon />
      </button>
    </div>
  );

  if (mountNode) return createPortal(panel, mountNode);
  return panel;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}
