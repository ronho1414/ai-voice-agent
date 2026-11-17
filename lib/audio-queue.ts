export type AudioQueueState =
  | "IDLE"
  | "PLAYING_CLIP"
  | "BUFFERING_STREAM"
  | "PLAYING_STREAM";

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
  private readonly listeners = new Set<(state: AudioQueueState) => void>();

  constructor(private readonly context: AudioContext) {}

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

  beginTurn(): number {
    this.generation += 1;
    this.stopNodes();
    this.resetStream();
    this.clipEnded = false;
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
    source.connect(this.context.destination);
    source.onended = () => {
      if (generation !== this.generation || this.clipSource !== source) return;
      this.clipSource = null;
      this.clipEnded = true;
      this.kickStream(generation);
    };
    this.clipSource = source;
    this.setState(this.chunks.length > 0 || this.streamDone ? "BUFFERING_STREAM" : "PLAYING_CLIP");
    this.startNode(generation, source);
  }

  skipClip(generation: number): void {
    if (generation !== this.generation) return;
    this.stopNode(this.clipSource);
    this.clipSource = null;
    this.clipEnded = true;
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
      if (this.clipEnded) this.setState("IDLE");
      return;
    }
    void this.decode(generation);
  }

  failStream(generation: number): void {
    if (generation !== this.generation) return;
    this.streamDone = true;
    this.streamFailed = true;
    this.decodedStream = null;
    if (this.clipEnded) this.setState("IDLE");
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
      this.setState("IDLE");
      return;
    }
    if (!this.decodedStream) {
      this.setState(this.streamDone && this.byteLength() === 0 ? "IDLE" : "BUFFERING_STREAM");
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
    source.connect(this.context.destination);
    source.onended = () => {
      if (generation !== this.generation || this.streamSource !== source) return;
      this.streamSource = null;
      this.setState("IDLE");
    };
    this.streamSource = source;
    this.setState("PLAYING_STREAM");
    this.startNode(generation, source);
  }

  private startNode(generation: number, source: AudioBufferSourceNode): void {
    if (generation !== this.generation) return;
    if (this.context.state === "suspended") {
      void this.context.resume().then(() => {
        if (generation !== this.generation) return;
        source.start(0);
      });
      return;
    }
    source.start(0);
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
  files: string[],
): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  await Promise.all(
    files.map(async (file) => {
      try {
        const response = await fetch(`/clips/${file}`);
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
