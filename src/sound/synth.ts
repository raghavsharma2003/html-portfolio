// The synthesis — every sound in this app, built from oscillators and shaped
// noise at the moment it is heard. Zero audio files ship.
//
// ── WHY SYNTHESISED AND NOT SAMPLED ───────────────────────────────────────
//
// Three reasons, in the order they mattered:
//
//   1. There is nothing to license, nothing to attribute, nothing to fetch and
//      no CDN to be down. A sound layer that adds a network dependency to the
//      act of sending a message is not a sound layer, it is a new failure mode.
//   2. It is infinitely tweakable. The `receive` cue is two numbers away from
//      being a different personality, and the next person to disagree with my
//      ear can disagree by editing a frequency instead of by commissioning a
//      wav. A 6KB asset is an argument you can only win once.
//   3. It weighs nothing. The whole palette below is smaller than one of the
//      files it replaces.
//
// ── THE TWO-LAYER RULE ────────────────────────────────────────────────────
//
// Every cue is built from a TRANSIENT and a BODY, and both are required.
//
//   the transient  under ~50ms, noise-based, is what makes the sound feel
//                  like it was caused by something physical. Without it a
//                  synthesised cue reads as a beep from a machine, because a
//                  pure tone has no moment of contact.
//   the body       60-400ms, pitched, is what makes it feel like a PLACE or
//                  a PERSON rather than a click. Without it there is contact
//                  and nothing behind it.
//
// A cue with only a body is a notification. A cue with only a transient is a
// UI toolkit. The whole character of this palette is in the ratio between them.
//
// ── WHAT THIS FILE MAY NOT DO ─────────────────────────────────────────────
//
// Nothing here decides WHETHER to make a sound. Not the toggle, not the call
// gate, not the unlock, not the throttle. Every one of those lives in
// index.ts, on one path, because a synth that can be reached directly is a
// synth that will eventually be reached directly by something that skipped the
// gate. These functions take a context and a destination they are handed, and
// they schedule; that is all they can do.

import { CUES, type Cue } from "./vocabulary";

/**
 * One second of white noise, made once per context and shared by every cue
 * that needs air. Regenerating it per sound is 44,100 Math.random() calls on
 * the same frame as a user's tap, which is exactly the kind of cost that turns
 * a felt-response layer into a jank layer.
 */
const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  const cached = NOISE.get(ctx);
  if (cached) return cached;
  const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  NOISE.set(ctx, buf);
  return buf;
}

/**
 * An envelope that starts and ENDS at zero, every time.
 *
 * `exponentialRampToValueAtTime` cannot reach 0 (it throws, or silently does
 * nothing depending on the engine), which is how synthesised UI sounds end up
 * with a gain node parked at a tiny non-zero value forever — inaudible on its
 * own and a growing DC-ish floor once forty of them have accumulated. So every
 * envelope here rides down to a near-zero and is then SET to zero explicitly.
 *
 * This is the audio spelling of `animation-implicit-end`: a curve that does not
 * state its own destination inherits one, and the inherited one is wrong.
 */
function env(g: GainNode, t0: number, peak: number, attackS: number, decayS: number) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t0);
  p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + Math.max(0.0005, attackS));
  p.exponentialRampToValueAtTime(0.0001, t0 + attackS + decayS);
  p.setValueAtTime(0, t0 + attackS + decayS + 0.001);
}

/** A pitched partial. `detune` is in cents and is what keeps a chord human. */
function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: {
    freq: number;
    at: number;
    peak: number;
    attack: number;
    decay: number;
    type?: OscillatorType;
    detune?: number;
    glideTo?: number;
  },
) {
  const o = ctx.createOscillator();
  o.type = opts.type ?? "sine";
  o.frequency.setValueAtTime(opts.freq, opts.at);
  if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, opts.at + opts.attack + opts.decay);
  if (opts.detune) o.detune.setValueAtTime(opts.detune, opts.at);
  const g = ctx.createGain();
  env(g, opts.at, opts.peak, opts.attack, opts.decay);
  o.connect(g).connect(out);
  o.start(opts.at);
  o.stop(opts.at + opts.attack + opts.decay + 0.06);
}

/** A band of air. The transient layer of everything in this file. */
function air(
  ctx: BaseAudioContext,
  out: AudioNode,
  opts: {
    at: number;
    peak: number;
    attack: number;
    decay: number;
    hz: number;
    q?: number;
    sweepTo?: number;
    type?: BiquadFilterType;
  },
) {
  const s = ctx.createBufferSource();
  s.buffer = noise(ctx);
  // Start somewhere random in the second of noise: starting every burst at
  // sample 0 means every burst is the SAME burst, and a "random" click that is
  // byte-identical a hundred times a day stops sounding like contact.
  const offset = Math.random() * 0.9;
  const f = ctx.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.setValueAtTime(opts.hz, opts.at);
  if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, opts.at + opts.attack + opts.decay);
  f.Q.setValueAtTime(opts.q ?? 1, opts.at);
  const g = ctx.createGain();
  env(g, opts.at, opts.peak, opts.attack, opts.decay);
  s.connect(f).connect(g).connect(out);
  s.start(opts.at, offset, opts.attack + opts.decay + 0.05);
}

/* ── the palette ─────────────────────────────────────────────────────────
   One function per cue, each reading its own peak out of the vocabulary
   table so the mix is legible in one place and cannot drift from the numbers
   the gate checks. Times are seconds, because that is what WebAudio speaks
   and converting at every line is how a 220ms duration becomes 0.22ms
   (`minifier-eats-runtime-tokens`, one layer over). */

function send(ctx: BaseAudioContext, out: AudioNode, t: number) {
  const p = CUES.send.gain;
  // BODY: air rising through a band, 700 -> 2600Hz. A rise is a departure.
  air(ctx, out, { at: t, peak: p * 0.5, attack: 0.022, decay: 0.105, hz: 700, sweepTo: 2600, q: 0.9 });
  // TRANSIENT: the thumb leaving the glass, landing ON the whoosh rather than
  // before it, so the two read as one gesture and not as a click plus a sound.
  air(ctx, out, { at: t + 0.012, peak: p, attack: 0.004, decay: 0.038, hz: 2300, q: 1.4 });
  // A whisper of pitch under it. Not a note, just enough body that the whoosh
  // has somewhere to leave FROM.
  tone(ctx, out, { freq: 520, at: t, peak: p * 0.16, attack: 0.006, decay: 0.075, glideTo: 900 });
}

function receive(ctx: BaseAudioContext, out: AudioNode, t: number) {
  const p = CUES.receive.gain;
  // TRANSIENT: a breath, low and dark, so the first note does not begin at
  // absolute digital silence. This is the single thing that separates "warm"
  // from "synthesised" in a two-note cue, and it is 14 milliseconds long.
  air(ctx, out, { at: t, peak: p * 0.3, attack: 0.006, decay: 0.09, hz: 620, q: 0.7, type: "lowpass" });
  // BODY: D5 then G4, a fourth DOWN. Every notification in the category rises,
  // because a rise asks for something. Hers settles.
  tone(ctx, out, { freq: 587.33, at: t + 0.006, peak: p * 0.72, attack: 0.016, decay: 0.2, detune: 4 });
  tone(ctx, out, { freq: 392.0, at: t + 0.072, peak: p, attack: 0.02, decay: 0.245, detune: -5 });
  // The octave under the second note, quiet enough that it is felt as warmth
  // rather than heard as a third voice.
  tone(ctx, out, { freq: 196.0, at: t + 0.072, peak: p * 0.26, attack: 0.03, decay: 0.24 });
}

function place(ctx: BaseAudioContext, out: AudioNode, t: number) {
  const p = CUES.place.gain;
  // TRANSIENT: contact. Three milliseconds of it.
  air(ctx, out, { at: t, peak: p, attack: 0.0016, decay: 0.026, hz: 1800, q: 1.1 });
  // BODY: the piece has mass. A low thud plus the dull ring a wooden thing
  // makes against a wooden thing, both short enough to have no tail at all.
  air(ctx, out, { at: t + 0.002, peak: p * 0.62, attack: 0.004, decay: 0.062, hz: 240, q: 0.6, type: "lowpass" });
  tone(ctx, out, { freq: 152, at: t + 0.002, peak: p * 0.5, attack: 0.003, decay: 0.058, type: "triangle" });
}

function take(ctx: BaseAudioContext, out: AudioNode, t: number) {
  const p = CUES.take.gain;
  // Harder contact than `place`, and brighter: something was struck, not set.
  air(ctx, out, { at: t, peak: p, attack: 0.0012, decay: 0.022, hz: 2600, q: 1.3 });
  // Lower body: a captured piece is leaving, and down is where it goes.
  air(ctx, out, { at: t + 0.002, peak: p * 0.66, attack: 0.004, decay: 0.07, hz: 190, q: 0.6, type: "lowpass" });
  tone(ctx, out, { freq: 118, at: t + 0.002, peak: p * 0.52, attack: 0.003, decay: 0.07, type: "triangle" });
  // The displacement itself: a scrape falling away under the thud. This is the
  // whole difference between the two board cues and it is 45ms long.
  air(ctx, out, { at: t + 0.03, peak: p * 0.3, attack: 0.008, decay: 0.062, hz: 1400, sweepTo: 600, q: 2.2 });
}

function moment(ctx: BaseAudioContext, out: AudioNode, t: number) {
  const p = CUES.moment.gain;
  // TRANSIENT: air, held long and high, under everything. The shimmer.
  air(ctx, out, { at: t, peak: p * 0.16, attack: 0.05, decay: 0.42, hz: 3200, q: 0.5, type: "highpass" });
  // BODY: C5 E5 G5, up, 45ms apart, each with a soft third harmonic so it has
  // a body rather than a shape. The one cue in the palette allowed a tail.
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((f, i) => {
    const at = t + i * 0.045;
    tone(ctx, out, { freq: f, at, peak: p * (1 - i * 0.12), attack: 0.024, decay: 0.44 + i * 0.06, detune: i * 3 });
    tone(ctx, out, { freq: f * 3, at, peak: p * 0.1, attack: 0.03, decay: 0.3 });
  });
  // The ground the triad stands on: one low note, long, quiet.
  tone(ctx, out, { freq: 261.63, at: t, peak: p * 0.3, attack: 0.04, decay: 0.6, type: "triangle" });
}

/**
 * The only export. `index.ts` hands in a context and the master bus; this
 * picks the recipe. There is no path from a component to any function above.
 */
export const RECIPES: Record<Cue, (ctx: BaseAudioContext, out: AudioNode, t: number) => void> = {
  send,
  receive,
  place,
  take,
  moment,
};
