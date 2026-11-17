import { createEndpointState, feedEndpoint, type EndpointState } from "@/lib/voice-engine/endpoint";

const WORKLET_SOURCE = `
class UtteranceCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(2048);
    this.used = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || !channel.length) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(this.pending.length - this.used, channel.length - offset);
      this.pending.set(channel.subarray(offset, offset + take), this.used);
      this.used += take;
      offset += take;
      if (this.used === this.pending.length) {
        const copy = new Float32Array(this.pending);
        this.port.postMessage(copy, [copy.buffer]);
        this.used = 0;
      }
    }
    return true;
  }
}
registerProcessor("utterance-capture", UtteranceCapture);
`;

const PREROLL_MS = 260;
const HISTORY_MS = 600;
const MIC_GAIN = 4;

type PcmChunk = {
  at: number;
  samples: Float32Array;
};

export type MicrophoneHandlers = {
  onSpeechStart: () => void;
  onUtterance: (audio: Blob) => void;
  onLevel: (level: number) => void;
};

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

function boost(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] * MIC_GAIN;
    out[i] = value > 1 ? 1 : value < -1 ? -1 : value;
  }
  return out;
}

export type MicrophoneListener = {
  start(): Promise<void>;
  stop(): void;
  isRunning(): boolean;
  setPlaybackActive(active: boolean): void;
  hold(ms: number): void;
};

export function createMicrophoneListener(
  context: AudioContext,
  handlers: MicrophoneHandlers,
): MicrophoneListener {
  let running = false;
  let opening: Promise<void> | null = null;
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let capture: AudioNode | null = null;
  let silent: GainNode | null = null;
  let playbackActive = false;
  let quietUntil = 0;
  let endpoint: EndpointState = createEndpointState();
  let cursor = 0;
  let smoothed = 0;
  let speechMark = 0;
  let chunks: PcmChunk[] = [];

  function resetCapture(): void {
    endpoint = createEndpointState();
    cursor = 0;
    smoothed = 0;
    speechMark = 0;
    chunks = [];
  }

  function releaseGraph(): void {
    capture?.disconnect();
    source?.disconnect();
    silent?.disconnect();
    if (capture instanceof AudioWorkletNode) capture.port.onmessage = null;
    stream?.getTracks().forEach((track) => track.stop());
    capture = null;
    source = null;
    silent = null;
    stream = null;
  }

  function stop(): void {
    running = false;
    opening = null;
    releaseGraph();
    resetCapture();
  }

  function onSamples(samples: Float32Array): void {
    if (!running || samples.length === 0) return;
    const heard = boost(samples);
    const sampleRate = context.sampleRate || 48000;
    const at = (cursor / sampleRate) * 1000;
    const dt = (heard.length / sampleRate) * 1000;
    cursor += heard.length;
    chunks.push({ at, samples: heard });

    const level = rms(heard);
    smoothed = smoothed * 0.62 + level * 0.38;
    handlers.onLevel(smoothed);
    const audible = !endpoint.active && performance.now() < quietUntil ? 0 : smoothed;
    const step = feedEndpoint(endpoint, audible, dt, playbackActive);
    endpoint = step.state;

    if (step.event === "start") {
      speechMark = Math.max(0, at - 160);
      handlers.onSpeechStart();
    } else if (step.event === "end") {
      const from = Math.max(0, speechMark - PREROLL_MS);
      const selected = chunks.filter((chunk) => chunk.at >= from).map((chunk) => chunk.samples);
      speechMark = 0;
      if (selected.length > 0) {
        const audio = encodeWav(selected, sampleRate);
        if (audio.size > 1200) {
          void Promise.resolve(handlers.onUtterance(audio)).catch(() => undefined);
        }
      }
    }

    const keep = endpoint.active ? speechMark - HISTORY_MS : at - HISTORY_MS;
    while (chunks.length > 1 && chunks[0].at < keep) chunks.shift();
  }

  async function connectInput(live: MediaStream): Promise<void> {
    source = context.createMediaStreamSource(live);
    silent = context.createGain();
    silent.gain.value = 0;
    capture = await createCaptureNode(context, onSamples);
    if (!running) {
      capture.disconnect();
      return;
    }
    source.connect(capture);
    capture.connect(silent);
    silent.connect(context.destination);
  }

  async function open(pending: Promise<MediaStream>): Promise<void> {
    try {
      await context.resume();
      const live = await pending;
      if (!running) {
        live.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = live;
      resetCapture();
      await connectInput(live);
    } catch (error) {
      stop();
      throw error;
    }
  }

  return {
    start() {
      if (opening) return opening;
      running = true;
      if (!navigator.mediaDevices?.getUserMedia) {
        running = false;
        return Promise.reject(new Error("Microphone failed"));
      }
      void context.resume();
      const pending = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      opening = open(pending);
      return opening;
    },
    stop,
    isRunning: () => running && stream !== null,
    setPlaybackActive(active: boolean) {
      playbackActive = active;
    },
    hold(ms: number) {
      quietUntil = Math.max(quietUntil, performance.now() + ms);
    },
  };
}

async function createCaptureNode(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void,
): Promise<AudioNode> {
  try {
    return await createWorkletNode(context, onSamples);
  } catch {
    return createScriptProcessor(context, onSamples);
  }
}

async function createWorkletNode(
  context: AudioContext,
  onSamples: (samples: Float32Array) => void,
): Promise<AudioWorkletNode> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/already registered|already exists/i.test(message)) throw error;
  } finally {
    URL.revokeObjectURL(url);
  }

  const node = new AudioWorkletNode(context, "utterance-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
  });
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (event.data instanceof Float32Array) onSamples(event.data);
  };
  return node;
}

function createScriptProcessor(context: AudioContext, onSamples: (samples: Float32Array) => void): ScriptProcessorNode {
  const factory = context as AudioContext & {
    createScriptProcessor?: (bufferSize: number, inputs: number, outputs: number) => ScriptProcessorNode;
  };
  if (!factory.createScriptProcessor) {
    throw new Error("Microphone failed");
  }
  const processor = factory.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const input = event.inputBuffer.getChannelData(0);
    const copy = new Float32Array(input.length);
    copy.set(input);
    onSamples(copy);
  };
  return processor;
}
