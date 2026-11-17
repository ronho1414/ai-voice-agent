export type AudioQueueState =
  | "IDLE"
  | "PLAYING_CLIP"
  | "BUFFERING_STREAM"
  | "PLAYING_STREAM";

export type SpeechPhase = "none" | "clip" | "gap" | "stream";

export type SpeechClock = {
  generation: number;
  phase: SpeechPhase;
  startedAt: number;
  duration: number;
};

const SILENT_CLOCK: SpeechClock = { generation: 0, phase: "none", startedAt: 0, duration: 0 };

export class AudioQueue {
  private state: AudioQueueState = "IDLE";
  private generation = 0;
  private clipSource: AudioBufferSourceNode | null = null;
  private streamSource: AudioBufferSourceNode | null = null;
  private chunks: Uint8Array[] = [];
  private streamDone = false;
  private decodedStream: AudioBuffer | null = null;
  private clipEnded = false;
  private streamFailed = false;
  private clock: SpeechClock = { ...SILENT_CLOCK };
  private readonly listeners = new Set<(state: AudioQueueState) => void>();
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly levelBuffer: Uint8Array<ArrayBuffer>;

  constructor(private readonly context: AudioContext) {
    this.gain = context.createGain();
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.65;
    this.gain.connect(this.analyser);
    this.analyser.connect(context.destination);
    this.levelBuffer = new Uint8Array(this.analyser.fftSize);
  }

  getState(): AudioQueueState {
    return this.state;
  }

  subscribe(listener: (state: AudioQueueState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async resume(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  now(): number {
    return this.context.currentTime;
  }

  getSpeechClock(): SpeechClock {
    return { ...this.clock };
  }

  getLevel(): number {
    if (this.context.state === "closed") return 0;
    this.analyser.getByteTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      const sample = (this.levelBuffer[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / this.levelBuffer.length);
  }

  setMuted(muted: boolean): void {
    this.gain.gain.value = muted ? 0 : 1;
  }

  beginTurn(): number {
    this.generation += 1;
    this.stopNodes();
    this.resetStream();
    this.clipEnded = false;
    this.clock = { generation: this.generation, phase: "none", startedAt: 0, duration: 0 };
    this.setState("IDLE");
    return this.generation;
  }

  bargeIn(): void {
    this.beginTurn();
  }

  playClip(generation: number, buffer: AudioBuffer): void {
    if (generation !== this.generation) return;
    this.stopNode(this.clipSource);
    this.clipSource = null;
    this.clipEnded = false;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (generation !== this.generation || this.clipSource !== source) return;
      this.clipSource = null;
      this.clipEnded = true;
      if (this.clock.phase === "clip") {
        this.clock = { generation, phase: "gap", startedAt: this.context.currentTime, duration: 0 };
      }
      this.kickStream(generation);
    };
    this.clipSource = source;
    this.setState(this.chunks.length > 0 || this.streamDone ? "BUFFERING_STREAM" : "PLAYING_CLIP");
    this.startNode(generation, source, "clip");
  }

  skipClip(generation: number): void {
    if (generation !== this.generation) return;
    this.stopNode(this.clipSource);
    this.clipSource = null;
    this.clipEnded = true;
    if (this.clock.phase !== "stream") {
      this.clock = { generation, phase: "gap", startedAt: this.context.currentTime, duration: 0 };
    }
    this.kickStream(generation);
  }

  pushStreamChunk(generation: number, chunk: Uint8Array): void {
    if (generation !== this.generation || chunk.byteLength === 0) return;
    this.chunks.push(chunk.slice());
    if (this.state === "PLAYING_CLIP" || this.state === "IDLE") {
      this.setState("BUFFERING_STREAM");
    }
  }

  finishStream(generation: number): void {
    if (generation !== this.generation) return;
    this.streamDone = true;
    if (this.byteLength() === 0) {
      if (this.clipEnded) {
        this.clock = { generation, phase: "none", startedAt: 0, duration: 0 };
        this.setState("IDLE");
      }
      return;
    }
    void this.decode(generation);
  }

  failStream(generation: number): void {
    if (generation !== this.generation) return;
    this.streamDone = true;
    this.streamFailed = true;
    this.decodedStream = null;
    if (this.clipEnded) {
      this.clock = { generation, phase: "none", startedAt: 0, duration: 0 };
      this.setState("IDLE");
    }
  }

  private byteLength(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  private async decode(generation: number): Promise<void> {
    const total = this.byteLength();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    try {
      const audio = await this.context.decodeAudioData(copy);
      if (generation !== this.generation) return;
      this.decodedStream = audio;
      if (this.clipEnded) this.kickStream(generation);
    } catch {
      if (generation !== this.generation) return;
      this.failStream(generation);
    }
  }

  private kickStream(generation: number): void {
    if (generation !== this.generation || !this.clipEnded || this.streamSource) return;
    if (this.streamFailed) {
      this.clock = { generation, phase: "none", startedAt: 0, duration: 0 };
      this.setState("IDLE");
      return;
    }
    if (!this.decodedStream) {
      this.setState(this.streamDone && this.byteLength() === 0 ? "IDLE" : "BUFFERING_STREAM");
      if (this.streamDone && this.byteLength() === 0) {
        this.clock = { generation, phase: "none", startedAt: 0, duration: 0 };
      }
      return;
    }
    if (this.context.state === "suspended") {
      void this.context.resume().then(() => {
        this.kickStream(generation);
      });
      return;
    }

    const buffer = this.decodedStream;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (generation !== this.generation || this.streamSource !== source) return;
      this.streamSource = null;
      this.clock = { generation, phase: "none", startedAt: 0, duration: 0 };
      this.setState("IDLE");
    };
    this.streamSource = source;
    this.setState("PLAYING_STREAM");
    this.startNode(generation, source, "stream");
  }

  private startNode(generation: number, source: AudioBufferSourceNode, phase: "clip" | "stream"): void {
    const begin = () => {
      if (generation !== this.generation) return;
      this.clock = {
        generation,
        phase,
        startedAt: this.context.currentTime,
        duration: source.buffer?.duration ?? 0,
      };
      try {
        source.start(0);
      } catch {
        // The buffer may already have been started.
      }
    };

    if (generation !== this.generation) return;
    if (this.context.state === "suspended") {
      void this.context.resume().then(() => {
        if (generation !== this.generation) return;
        begin();
      });
      return;
    }
    begin();
  }

  private resetStream(): void {
    this.chunks = [];
    this.streamDone = false;
    this.decodedStream = null;
    this.streamFailed = false;
  }

  private stopNodes(): void {
    this.stopNode(this.clipSource);
    this.stopNode(this.streamSource);
    this.clipSource = null;
    this.streamSource = null;
  }

  private stopNode(node: AudioBufferSourceNode | null): void {
    if (!node) return;
    node.onended = null;
    try {
      node.stop();
    } catch {
      // The buffer may already have ended.
    }
    node.disconnect();
  }

  private setState(state: AudioQueueState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

export async function preloadClips(
  context: AudioContext,
  files: readonly string[],
  basePath = "/clips",
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  const prefix = basePath.replace(/\/$/, "");
  await Promise.all(
    files.map(async (file) => {
      try {
        const response = await fetch(`${prefix}/${file}`);
        if (!response.ok) return;
        const encoded = await response.arrayBuffer();
        const audio = await context.decodeAudioData(encoded.slice(0));
        buffers.set(file, audio);
      } catch {
        // A missing or undecodable clip is skipped. The reply can still play.
      }
    }),
  );
  return buffers;
}
