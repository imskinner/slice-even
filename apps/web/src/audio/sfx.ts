import type { ObjectKind } from "@slice-even/core";

/**
 * Every sound is synthesized with Web Audio at play time: no audio files to
 * load, license or cache, and each cut sounds slightly different.
 *
 * Browsers only allow audio after a user gesture, so the context is created
 * lazily and resumed on the first click or key press (see unlockOnGesture).
 */

const MUTE_KEY = "slice-even:muted";

type Texture = "crunchy" | "juicy" | "soft";

const TEXTURE: Record<ObjectKind, Texture> = {
  apple: "crunchy",
  carrot: "crunchy",
  cucumber: "crunchy",
  orange: "juicy",
  tomato: "juicy",
  banana: "soft",
  bread: "soft",
  cake: "soft",
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function audio(): { ctx: AudioContext; out: GainNode; noise: AudioBuffer } | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.6;
    // A gentle compressor keeps stacked sounds (cut + splats + jingle) from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") void ctx.resume();
  // Sounds scheduled on a suspended context would all fire at once on resume.
  if (ctx.state !== "running") return null;
  return { ctx, out: master!, noise: noise! };
}

/** Resume audio on the first real user gesture (pointermove does not count). */
export function unlockOnGesture() {
  const unlock = () => {
    audio();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

export function isMuted() {
  return muted;
}

export function setMuted(value: boolean) {
  muted = value;
  try {
    localStorage.setItem(MUTE_KEY, value ? "1" : "0");
  } catch {
    // Not remembered in private mode; still applies for this visit.
  }
  if (value) void ctx?.suspend();
  else void ctx?.resume();
  listeners.forEach((l) => l(value));
}

export function onMuteChange(listener: (muted: boolean) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* ------------------------------------------------------------ building blocks */

interface Env {
  attack?: number;
  decay: number;
  peak?: number;
}

/** Gain node with a fast attack and exponential decay, starting at `at`. */
function envelope(c: AudioContext, at: number, { attack = 0.005, decay, peak = 1 }: Env): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return g;
}

function noiseBurst(
  a: NonNullable<ReturnType<typeof audio>>,
  at: number,
  filter: { type: BiquadFilterType; from: number; to?: number; q?: number },
  env: Env,
) {
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = a.ctx.createBiquadFilter();
  f.type = filter.type;
  f.Q.value = filter.q ?? 1;
  f.frequency.setValueAtTime(filter.from, at);
  if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, at + (env.attack ?? 0.005) + env.decay);
  const g = envelope(a.ctx, at, env);
  src.connect(f).connect(g).connect(a.out);
  src.start(at, Math.random() * 0.5);
  src.stop(at + (env.attack ?? 0.005) + env.decay + 0.05);
}

function tone(
  a: NonNullable<ReturnType<typeof audio>>,
  at: number,
  type: OscillatorType,
  from: number,
  to: number | null,
  env: Env,
  lowpass?: number,
) {
  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  const end = at + (env.attack ?? 0.005) + env.decay;
  if (to) osc.frequency.exponentialRampToValueAtTime(to, end);
  const g = envelope(a.ctx, at, env);
  let node: AudioNode = osc;
  if (lowpass) {
    const f = a.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = lowpass;
    node = node.connect(f);
  }
  node.connect(g).connect(a.out);
  osc.start(at);
  osc.stop(end + 0.05);
}

const jitter = (v: number, amount = 0.08) => v * (1 + (Math.random() * 2 - 1) * amount);

/* ------------------------------------------------------------ sounds */

export const sfx = {
  /** Blade moving through the air. `strength` 0..1 scales pitch and volume. */
  whoosh(strength = 1) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    noiseBurst(a, t, { type: "bandpass", from: 500, to: jitter(2600 * (0.6 + strength * 0.4)), q: 1.2 }, {
      attack: 0.06,
      decay: 0.18,
      peak: 0.35 * (0.5 + strength * 0.5),
    });
  },

  /** The blade going through the object and hitting the board. */
  cut(kind: ObjectKind) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const texture = TEXTURE[kind];
    if (texture === "crunchy") {
      // A quick run of tiny cracks, then the thunk on the board.
      for (let i = 0; i < 7; i++) {
        noiseBurst(a, t + i * 0.012 + Math.random() * 0.006, { type: "highpass", from: jitter(3000, 0.3) }, { decay: 0.02, peak: 0.5 - i * 0.05 });
      }
    } else if (texture === "juicy") {
      noiseBurst(a, t, { type: "lowpass", from: 2400, to: 500, q: 4 }, { attack: 0.01, decay: 0.16, peak: 0.55 });
      tone(a, t + 0.02, "sine", jitter(420), 110, { decay: 0.14, peak: 0.25 });
    } else {
      noiseBurst(a, t, { type: "lowpass", from: 1100, to: 400 }, { attack: 0.02, decay: 0.14, peak: 0.45 });
    }
    // Knife meets the cutting board.
    tone(a, t + 0.07, "sine", jitter(150), 55, { decay: 0.12, peak: 0.6 });
    noiseBurst(a, t + 0.07, { type: "bandpass", from: 900, q: 2 }, { decay: 0.05, peak: 0.25 });
  },

  /** A drop of juice or crumb landing. */
  splat(kind: ObjectKind) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    if (TEXTURE[kind] === "juicy") {
      tone(a, t, "sine", jitter(900, 0.3), 260, { decay: 0.05, peak: 0.08 });
    } else {
      noiseBurst(a, t, { type: "highpass", from: jitter(2500, 0.3) }, { decay: 0.015, peak: 0.08 });
    }
  },

  /** Buttons and chips. */
  click() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "triangle", jitter(620, 0.04), 940, { decay: 0.06, peak: 0.22 });
  },

  /** Something appears (a player joins, a panel pops in). */
  pop() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "sine", 380, 760, { decay: 0.09, peak: 0.25 });
  },

  /** Countdown tick for the last seconds of a round. */
  tick(urgent = false) {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "square", urgent ? 1320 : 990, null, { decay: 0.035, peak: 0.07 }, 3000);
  },

  /** Round starts. */
  ding() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    for (const [f, p] of [[880, 0.25], [1320, 0.1], [1760, 0.05]] as const) tone(a, t, "sine", f, null, { decay: 0.9, peak: p });
  },

  /** The balance beam settling. */
  clunk() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    tone(a, t, "sine", 210, 140, { decay: 0.1, peak: 0.3 });
    noiseBurst(a, t, { type: "bandpass", from: 1400, q: 3 }, { decay: 0.04, peak: 0.12 });
  },

  /** Result jingle by rating tone. */
  result(tone_: "great" | "good" | "meh" | "bad") {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const note = (semitones: number) => 523.25 * 2 ** (semitones / 12);
    const play = (steps: number[], gap: number, type: OscillatorType, decay: number, peak: number) =>
      steps.forEach((s, i) => tone(a, t + i * gap, type, note(s), null, { decay, peak }));
    switch (tone_) {
      case "great":
        play([0, 4, 7, 12], 0.09, "triangle", 0.3, 0.3);
        play([12, 16, 19], 0.09, "sine", 0.5, 0.12);
        break;
      case "good":
        play([0, 7, 12], 0.1, "triangle", 0.28, 0.28);
        break;
      case "meh":
        play([4, 3], 0.16, "triangle", 0.3, 0.25);
        break;
      case "bad":
        // Sad trombone: three falling "wahs" and a long one.
        [0, 0.32, 0.64].forEach((d, i) =>
          tone(a, t + d, "sawtooth", note(-5 - i), note(-6 - i), { attack: 0.03, decay: 0.26, peak: 0.16 }, 1200),
        );
        tone(a, t + 0.96, "sawtooth", note(-8), note(-11), { attack: 0.03, decay: 0.8, peak: 0.16 }, 1000);
        break;
    }
  },

  /** You won the round / the game. */
  fanfare() {
    const a = audio();
    if (!a) return;
    const t = a.ctx.currentTime;
    const note = (s: number) => 523.25 * 2 ** (s / 12);
    [0, 4, 7, 12, 7, 12].forEach((s, i) => tone(a, t + i * 0.11, "square", note(s), null, { decay: 0.2, peak: 0.12 }, 2600));
    tone(a, t + 0.66, "triangle", note(12), null, { decay: 0.9, peak: 0.25 });
  },
};
