export type EndpointState = {
  noise: number;
  heardMs: number;
  attackMs: number;
  utteranceMs: number;
  silenceMs: number;
  voicedMs: number;
  active: boolean;
};

export type EndpointEvent = "start" | "end" | null;

const CALIBRATION_MS = 180;
const ATTACK_MS = 80;
const RELEASE_MS = 640;
const MIN_VOICED_MS = 160;
const MAX_UTTERANCE_MS = 14_000;

export function createEndpointState(): EndpointState {
  return {
    noise: 0.006,
    heardMs: 0,
    attackMs: 0,
    utteranceMs: 0,
    silenceMs: 0,
    voicedMs: 0,
    active: false,
  };
}

export function endpointThreshold(noise: number, playback: boolean): number {
  const floor = Math.max(0.007, noise * 2.4);
  if (!playback) return floor;
  return Math.max(0.02, floor * 2.2);
}

export function feedEndpoint(
  state: EndpointState,
  level: number,
  dtMs: number,
  playback: boolean,
): { state: EndpointState; event: EndpointEvent } {
  const next: EndpointState = {
    ...state,
    heardMs: state.heardMs + dtMs,
  };

  if (next.heardMs < CALIBRATION_MS) {
    if (level < 0.03) next.noise = state.noise * 0.85 + level * 0.15;
    return { state: next, event: null };
  }

  const hot = level >= endpointThreshold(next.noise, playback);
  if (!hot && level < next.noise * 2) {
    next.noise = next.noise * 0.98 + level * 0.02;
  }

  if (!next.active) {
    if (!hot) {
      next.attackMs = 0;
      return { state: next, event: null };
    }
    next.attackMs += dtMs;
    if (next.attackMs < ATTACK_MS) return { state: next, event: null };
    next.active = true;
    next.utteranceMs = next.attackMs;
    next.voicedMs = next.attackMs;
    next.silenceMs = 0;
    return { state: next, event: "start" };
  }

  next.utteranceMs += dtMs;
  if (hot) {
    next.voicedMs += dtMs;
    next.silenceMs = 0;
  } else {
    next.silenceMs += dtMs;
  }

  const finished = next.silenceMs >= RELEASE_MS || next.utteranceMs >= MAX_UTTERANCE_MS;
  if (!finished) return { state: next, event: null };

  const voiced = next.voicedMs;
  next.attackMs = 0;
  next.utteranceMs = 0;
  next.silenceMs = 0;
  next.voicedMs = 0;
  next.active = false;
  return { state: next, event: voiced >= MIN_VOICED_MS ? "end" : null };
}
