// Gemini Live realtime call engine — true speech-to-speech. The mic streams
// 16kHz PCM up a WebSocket; her voice streams back as 24kHz PCM chunks that
// play with ~zero buffering. Auth is a single-use ephemeral token minted by
// /api/live-token — the Google key never reaches this code.
//
// The cascade engine (STT→LLM→TTS) remains the fallback: startLiveCall
// rejects or calls onEnded("failed"), and the caller falls back seamlessly.
//
// ── WHO OWNS THE FLOOR ──────────────────────────────────────────────────
// The server's automatic activity detection is a bare speech DETECTOR with no
// usable threshold. Measured against the pinned model, one stimulus per
// session: real speech at full level interrupts her in 123-136ms; the same
// speech attenuated to 0.30 ("voice in the next room") in 199-218ms; at 0.12
// ("distant TV") in 203-216ms; a 0.45s "haan" backchannel in 199-211ms. LOW
// and HIGH startOfSpeechSensitivity are behaviourally IDENTICAL — the knob is
// a no-op for barge-in, which is why it is not in the setup block below and
// must not be added. The only thing the server reliably ignores is broadband
// noise (a fan at rms .015 and .05 both left her talking).
//
// So there is no server-side way to say "that was the television". But the
// server can only react to audio we CHOOSE to send it, and withholding the
// uplink for the length of one of her turns is safe (measured: 11 seconds of
// a completely dark uplink, turn completed normally, next question
// transcribed correctly, no double generation). That makes the client the
// floor authority, and this file is where that decision lives:
//
//   while she is audible, incoming mic audio is HELD in a ring instead of
//   sent. A sound only earns the floor by clearing a real bar (duration +
//   energy well above the rolling noise floor + not her own voice coming
//   back). When it does, the whole ring is burst-released so nothing the
//   person said is lost; when it doesn't — a fan, a TV, a door, a "haan" —
//   the ring is dropped and she never even hears about it.
//
// Measured on the production endpoint with the exact constants below, timed
// from the person's first sound: she DUCKS at +171ms, the ring is released at
// +598ms, and the server stops her at +672ms (i.e. 71-77ms after the burst) —
// 3/3 clean, exactly two turns, and the whole utterance transcribed INCLUDING
// the 600ms that was held back. A 450ms "haan" left her untouched 3/3, where
// the straight-through path kills her at +200ms. A distant TV at 0.12 gain
// left her untouched 2/2, where the straight-through path kills her at
// +130ms and she then answers the television.
//
// One measurement that cost an hour and is worth writing down: the ring must
// only ever contain OPEN-gate audio. Buffering the silence in front of a
// candidate puts a dead prefix at the head of the burst, and the server's
// onset detection is then late by that prefix's whole length — 2.2s of ringed
// silence moved release→interrupted from ~76ms to ~600ms. Ring words, not
// waiting.

import { attachAnalyser, detachAnalyser } from "./level";
import { diag } from "../engine/diag";

const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

export interface LiveSession {
  stop: () => void;
  setMuted: (m: boolean) => void;
  /** Speak an invisible directive (e.g. the pickup greeting trigger). */
  direct: (contextNote: string) => void;
  /**
   * Stream a screen frame (base64 JPEG) — realtime co-watching. Returns
   * whether the frame actually entered the socket: a caller may only tell
   * her to look at the screen when it did.
   */
  sendFrame: (b64Jpeg: string) => boolean;
  /**
   * Uplink pressure read from the socket queue's TROUGHS: 0 clear, 1
   * moderate, 2 heavy. Callers shed VIDEO against this (rate/quality) —
   * never audio.
   */
  congestion: () => 0 | 1 | 2;
  active: () => boolean;
}

export interface LiveCallOpts {
  base: string; // "" on web, absolute origin on the APK
  system: string;
  onState: (s: "listening" | "speaking") => void;
  onMyText: (t: string) => void; // finalized user transcript per turn
  onHerText: (t: string) => void; // finalized her transcript per turn
  onEnded: (reason: "failed" | "closed") => void;
  /**
   * Connect-path timings, so remote telemetry can say WHERE the seconds go.
   * readyMs is the roll-up everyone already reads; the rest break it apart,
   * because a real device reported readyMs 7618 with mintMs 0 and there was
   * no way to tell which segment ate the seven seconds.
   */
  onTiming?: (t: {
    mintMs?: number;
    preminted?: boolean;
    readyMs?: number;
    /** getUserMedia: permission plumbing + opening the mic. */
    micMs?: number;
    /** new WebSocket -> open: DNS + TLS + HTTP upgrade. */
    wsOpenMs?: number;
    /** setup written -> setupComplete: the server's own handshake. */
    setupMs?: number;
    /** how much of the slower leg the faster one hid, i.e. what parallelism saved. */
    overlapMs?: number;
  }) => void;
}

// ── uplink: what the socket queue is allowed to do to the call ──
// bufferedAmount is ONE counter for audio AND video, so every threshold here
// is stated in "seconds of mic audio". 16k PCM16 as base64+JSON runs
// ~43.5KB/s (a 4096-frame tick = 85ms = 2730 PCM bytes -> 3640 base64 chars
// + ~60 bytes of JSON ≈ 3.7KB per 85ms).
//
// DELIBERATELY NOT HERE ANY MORE: speech dropping. There is no backlog level
// at which a mic chunk carrying WORDS is discarded. Her hearing every word is
// the product; a "gracefully degraded" call that quietly eats syllables is
// just a broken call that hides it. A slow link now delays her instead of
// deafening her.
//
// The one thing a queue must never do is grow without bound: a socket that
// has stopped draining will happily accept minutes of audio and then deliver
// all of it at once, and she replays speech from most of a minute ago as if
// it were now (measured, 45s of stale audio). So there is exactly ONE hard
// ceiling, below — a stall backstop, not a quality knob. Nothing between
// "fine" and "the socket is dead" changes behaviour.
//
// 400_000 / 43_500 ≈ 9.2s of mic audio already waiting. Chosen to be
// unreachable on any link that can carry a call at all: a healthy socket sits
// near zero, a bad-but-usable one spikes to tens of KB and drains inside a
// second, and one 120KB video frame is still under a third of it. Getting
// here means the socket has accepted nothing for the better part of ten
// seconds, at which point the conversation is already over and the only
// question is whether she also shouts ten seconds of history when it comes
// back. It bounds that damage at ~9s instead of unbounded.
const STALL_CEILING = 400_000;
/** A frame may only enter a socket holding under ~1.1s of audio backlog —
 *  deliberately far below STALL_CEILING so video always gives way first and
 *  the stall backstop stays what it claims to be: unreachable on any link
 *  that can carry a call at all. */
const VIDEO_GATE = 48_000;
// Wordless chunks are a different matter and this stays exactly as it was.
// A gated chunk carries no words, only VAD continuity, so it sheds at the
// first sign of backlog. 8_000 / 43_500 ≈ 185ms of audio backlog (~2 mic
// ticks). ~60-70% of a call is gated, so this alone frees most of the uplink
// — and it costs nothing, because nothing was said in those chunks.
const SILENCE_CAP = 8_000;
// ...but silence is never shed to NOTHING. The server ends their turn by
// HEARING the pause: if a congested link suppressed every gated chunk, the
// stream would go dark the moment they stop talking, the VAD clock would
// stop advancing, and she would sit there listening forever — the exact
// "she never replies" failure this whole lane exists to prevent. So the
// pause right after words is untouchable (it is what commits the turn), and
// past that at least one chunk in SILENCE_KEEP always goes.
const SILENCE_ENDPOINT_MS = 700; // protected pause after the gate closes
const SILENCE_KEEP = 3; // heartbeat: ≥1 of every 3 gated chunks survives
// A pathological encode (~90KB of JPEG) would be ~2.8s of uplink on its own.
// This is the ONLY thing that can now refuse a frame: frames are no longer
// gated on how drained the socket is. Refusing a frame because ~185ms of
// backlog exists is how she goes blind mid-screen-share and then has nothing
// to say — the failure is silence, and it looks exactly like lag.
const FRAME_MAX_B64 = 120_000;
// ── congestion, measured at the TROUGHS (identical numbers on Android —
// see LiveWatchEngine.CONGEST_*) ──
// ADVISORY ONLY. Nothing inside this file reduces quality from it; it is
// computed so callers that still ask can display or log it.
// The counter's time-average is dominated by our own frame sawtooth, which
// says nothing about the link. Its MINIMUM over the last 8 mic ticks does:
// that is what the socket drains back down to between frames. > 6_000
// (≈140ms of audio) at the emptiest moment means the link never fully caught
// up; > 20_000 (≈460ms) means it is badly behind. Hysteresis down at 3_000
// (≈70ms) / 12_000 (≈275ms).
const CONGEST_UP_1 = 6_000;
const CONGEST_UP_2 = 20_000;
const CONGEST_DOWN_1 = 3_000;
const CONGEST_DOWN_2 = 12_000;
const TROUGH_RING = 8; // 8 mic ticks ≈ 680ms of history

// ── THE FLOOR MODEL ─────────────────────────────────────────────────────
// Every number here is a ratio against a MEASURED room, stated in dB so the
// arithmetic can be argued with. RMS 1.0 = full scale, so dBFS = 20·log10(rms).
//
// One mic tick is 4096 frames ≈ 85.3ms at 48kHz, which is far too coarse to
// express "280ms of speech" as anything but "either 256 or 341ms". Every tick
// is therefore sub-framed into 4 blocks of 1024 (21.3ms), and every duration
// below is counted in those.
const SUBS = 4;
// Ambience. The old estimator was the MINIMUM of the last 29 tick RMS values.
// A min is a 1-in-29 order statistic — maximally noisy, biased low, and one
// freak-quiet chunk pins it for 2.5s. Worse, a min tracks the DIPS of the
// interferer rather than its level, so it converges correctly on a fan (no
// dips) and falls straight through a television (inter-syllable dips just
// like a person). A 10th percentile over 3s of sub-frames is the same cost
// and does neither.
const FLOOR_WIN_MS = 3000; // 141 sub-frames
const FLOOR_PCT = 0.1;
const FLOOR_MIN = 0.0015; // −56 dBFS: a genuinely silent room
// −28 dBFS: a loud room. This was briefly raised to 0.12 (−18.4 dBFS) as part
// of the RATIO_MIN fix below, and that combination is deafness. RATIO_MIN
// makes the listen bar track the floor at +5.1 dB with no absolute cap, so the
// floor ceiling IS the listen-bar ceiling: at floor 0.12 the bar is
// 0.12·1.8 = 0.216 = −13.3 dBFS, an 18.7 dB move off the old 0.025 (−32.0
// dBFS) cap. Ordinary speech at 1m is −26…−20 dBFS, so from floor ≈ 0.05
// upward the gate stops opening for a normal voice at all — and because a
// closed gate transmits a ZEROED buffer, the whole uplink goes silent on an
// IDLE session, where the hold logic never runs and nothing else can rescue
// it. 0.04 bounds the worst case at 0.04·1.8 = 0.072 = −22.9 dBFS, which is
// still inside the range a person raises their voice into in a room that
// genuinely measures −28 dBFS of ambience.
const FLOOR_MAX = 0.04; // −28 dBFS
// Absolute backstop on the listen bar, independent of the floor. It is a
// no-op at FLOOR_MAX = 0.04 (0.04·1.8 = 0.072 exactly), and exists so that
// raising FLOOR_MAX again cannot silently re-open the deafness above: the
// listen bar can never be pushed past −22.9 dBFS by ANY ambience estimate.
// Deliberately set AT the ratio-min value rather than below it, so it can
// never fight LISTEN_RATIO_MIN and re-create the clamp crossing that fix
// exists to close.
const LISTEN_ABS_MAX = 0.072; // −22.9 dBFS
// LISTEN bar — used when she is NOT talking. A false open costs ~nothing
// here (the server still needs 300ms of silence to end a turn) and a false
// close costs a clipped first syllable, so this stays exactly as sensitive
// as the shipped gate that produced the measured 1536ms endpointing: the
// clamp band 0.01…0.025 is unchanged in every room quiet enough for it to
// mean anything.
//
// What IS fixed is an inversion. `clamp(floor*3, 0.01, 0.025)` and a floor
// clamped at 0.04 CROSS: above floor = 0.00833 (−41.6 dBFS) the threshold
// froze at 0.025 (−32 dBFS) however loud the room got, and above floor =
// 0.025 the threshold sat BELOW the noise floor — at the old floor ceiling
// of 0.04 it was 20·log10(0.025/0.04) = −4.1 dB UNDER ambient, so the gate
// could never close. A living-room TV (−40…−30 dBFS) crosses that routinely.
// A gate that never closes transmits the whole room as speech AND never
// sends the server the digital silence that ends a turn — which is both
// "she stops for the TV" and "she waits for the room to go quiet", from one
// arithmetic error. RATIO_MIN is the fix: the threshold may never sit less
// than +5.1 dB above the measured floor, whatever the clamps say.
const LISTEN_MULT = 3;
const LISTEN_MIN = 0.01;
const LISTEN_MAX = 0.025;
const LISTEN_RATIO_MIN = 1.8; // +5.1 dB — the gate can always close again
// BARGE bar — used while she IS audible, where the cost function inverts: a
// false open costs her being killed mid-word by a television. +16 dB over
// ambient (6.3×) is the near-field argument: inverse square between a mouth
// at 0.2m and a TV at 3m is 20·log10(3/0.2) = 23.5 dB, and hands-free at
// 0.5m vs 3m is 15.6 dB. +16 dB is inside the margin a real talker always
// has and outside the 0-6 dB a same-room interferer can muster. The
// 2.5× (+8 dB) over the LISTEN bar is what keeps it meaningful in a quiet
// room, where the LISTEN bar is a floor-independent constant.
const BARGE_MULT = 6.3; // +16.0 dB over ambience
const BARGE_OVER_LISTEN = 2.5; // +8.0 dB over the listen bar
const BARGE_MAX = 0.35; // −9 dBFS: nothing may ever be unbargeable
// SOFT bar — the escape valve. A quiet talker in a loud room can fail the
// hard bar honestly, and "she is uninterruptible" is a worse product than
// "she is over-interruptible". +12 dB over ambience for a much longer run
// releases the floor anyway. A distant TV usually sits under this too (it
// raises the very floor it is measured against), and when it doesn't, the
// failure is bounded at one late interruption instead of a permanent one.
//
// The soft bar is deliberately NOT raised by the echo term. It used to be
// `min(thrB, max(…, echoTerm))`, which collapses onto thrB the instant echo
// binds thrB — so on the leaky speakerphone the valve exists for, it gave
// zero extra LEVEL sensitivity and only a longer duration, which is a pure
// loss. Echo may now raise the hard bar only. What stops her own leak from
// walking through the lower soft bar is not the bar, it is `claimPeak >
// echoTerm` at the claim site: a real second source puts at least one
// sub-frame above everything her own voice can explain, and pure echo cannot.
const SOFT_MULT = 4.0; // +12.0 dB over ambience
const SOFT_OVER_LISTEN = 1.6; // +4.1 dB over the listen bar
// Durations. A door, a cough, a keyboard, a chair scrape are all sub-300ms.
// A "haan"/"hmm"/"achha" is 300-500ms and is a CONTINUER, not a floor claim —
// it means "keep going", so it must not be able to stop her. 550ms of speech
// inside an 850ms window (26 of 40 sub-frames, so up to 300ms of plosive gaps
// and stop consonants are tolerated without resetting anything) is above every
// backchannel in this language and below any real sentence.
//
// The cost is stated plainly: the floor claim itself is 550ms, the server
// reacts ~230ms after the burst release, and the yield fade is up to 450ms
// more, so she can still be audible ~1.2s after a person starts talking.
// That is only tolerable because of the duck below — she audibly softens at
// 171ms, which is what makes an overlap read as "she noticed" rather than
// "she is ignoring me". Measured human overlaps are under 374ms at the 75th
// percentile; nobody in a real conversation stops on contact.
const CLAIM_MS = 550;
const CLAIM_WIN_MS = 850;
const SOFT_CLAIM_MS = 1100;
const SOFT_CLAIM_WIN_MS = 2000;
const DUCK_AT_MS = 150; // 7 sub-frames — she notices, she does not stop
// Steadiness veto. Between a fan switching on and the 3s the floor needs to
// learn it, a loud machine can clear the level bar. Speech runs 5-9 dB of
// log-RMS standard deviation over half a second (the ~4Hz syllabic
// envelope); a fan or a hum runs 1-2 dB. So a claim that is BOTH steady
// (<2 dB) and not overwhelming (<+24 dB over ambience) is refused. A real
// talker fails neither test, and anyone who raises their voice skips it.
//
// Two corrections to how this is measured.
//
// (1) The deviation is taken over EVERY sub-frame in the claim window, not
// only the ones above the hard bar. Selecting on "above thrB" is a
// left-truncated sample: it discards precisely the inter-syllable dips that
// MAKE speech look like speech, and what survives is the top of the envelope,
// which is flat for anybody. A marginal talker measured that way lands at
// σ ≈ 2.1-2.4 dB against a 2.0 dB bar and gets refused as a machine. The dips
// are already in sub[]; there is no reason to throw them away.
//
// (2) The override compares against the floor as it was BEFORE the interferer
// arrived. The floor is a 3s trailing percentile, so for ~2.7s after a fan
// starts, `noiseFloor·16` is still computed from the quiet room — the fan
// clears it trivially and the veto switches itself off for exactly the
// stimulus it exists to catch. The comparison is made against the LOUDER of
// the trailing floor and a fast in-window ambience estimate (the median of
// this claim's own sub-frames), which a steady machine raises immediately.
const STEADY_DB = 2.0;
const STEADY_OVERRIDE_MULT = 16.0; // +24.1 dB — loud enough to skip the check
// Held audio. The ring must span the whole claim window plus the pre-roll,
// or the burst back-fills a truncated sentence and the first syllable of the
// utterance she finally admits is gone. The binding case is the SOFT claim:
// ceil(2000/85.3) + 2 = 26 ticks ≈ 2.22s ≈ 71KB of Int16, which is nothing in
// memory and ~85KB on the wire in one burst — under a fifth of the stall
// ceiling, and a 2s held burst has been measured to replay cleanly.
const HOLD_RING = 26;
// Her own voice is a first-class interrupter: it opens the gate, the server
// interrupts her, she starts a new turn, that leaks too. Web asks for
// echoCancellation, but she is rendered through a SEPARATE AudioContext and
// on Android WebView the platform AEC's reference is device-dependent. We do
// not have to guess — we know exactly what we are playing. κ is the observed
// coupling (mic RMS ÷ her playback RMS): good software AEC gives 30-40 dB of
// echo return loss (κ ≈ 0.01-0.03) and the term never binds; a bare
// speakerphone gives 10-16 dB (κ ≈ 0.15-0.3) and it correctly dominates.
// It is SEEDED PESSIMISTICALLY at 0.12 (≈18 dB ERL) and learns DOWNWARD,
// because the two failure directions are not symmetric: under-protection is a
// self-sustaining loop (her voice opens the gate, she is interrupted, the new
// turn leaks too — it reads as her randomly cutting herself off and
// stuttering), while over-protection costs one late barge-in during her turn.
// A device with real AEC decays to the 0.02 floor over about a minute of her
// speech and the term stops binding at all.
// HOW κ IS MEASURED: it only ever DECAYS, from a pessimistic seed.
//
// The old rule was `κ <- κ + a·(micRms/herNow − κ)` over the whole mic signal,
// excluded only while something had already cleared thrB. Its fixed point is
// κ* = micRms/herNow, so echoTerm = κ*·herNow = micRms: the barge bar
// converges onto the TOTAL MIC LEVEL — ambience, the person and the leak
// together. Nothing at or below what the mic currently hears can then clear
// it, and anything a person adds that fails to clear it raises the bar by
// exactly what they added. That is positive feedback, and on a leaky
// speakerphone it leaves her talking-deaf for a whole turn.
//
// The direction is the fix, and it is forced. κ cannot be allowed to rise on
// mic level, because NO level statistic separates her echo from a person:
// measured over a 1s window, a person raises the 20th percentile of the ratio
// from 0.05 to 0.51, and the dispersion of the ratio is 1.92 for a person
// against 1.93 for pure echo — the two distributions are not distinguishable
// from level alone. So κ starts at the worst coupling the hardware plausibly
// has and only ever comes DOWN, toward the observed 90th percentile of
// r = sqrt(max(0, sub² − floor²)) / herNow, with her level taken at the same
// 20ms resolution and the same instant (see herLevels).
//
// What that costs, stated plainly: a device with real AEC spends the first
// second or so of the session over-protected, until her first turn measures
// it. Barge-ins during that window are late, not lost — measured at +0 to
// +256ms against the old arbiter, with every one of them still landing. What
// it buys is that she stops taking the floor from herself: at −12 dB and −8 dB
// echo return loss the old arbiter self-interrupted in 6 of 6 trials and this
// one in 0 of 6.
//
// ── ...AND WHY IT MAY NOW ALSO RISE, ON EVIDENCE THAT IS NOT A LEVEL ──
//
// Everything above is still true and none of it is being undone. But the seed
// is a GUESS about the device, and when the guess is too low the arbiter is
// under-protected for the whole call with no way back: κ = 0.30 against a
// phone at loud volume or on speakerphone (−6 dB of coupling, κ ≈ 0.5) puts
// the bar BELOW her own leak. Measured in the simulator below, 8 seeds per
// cell, nobody in the room at all: at −6 dB she spent 93% of her own turn
// ducked by her own voice and handed the server 2389ms of it as if it were
// the user talking, at every turn end; at −3 dB she took the floor from
// herself in 1 of 8 turns outright. On a phone at loud volume that is not an
// exotic device, it is Tuesday — exactly the complaint.
//
// The paragraph above says no LEVEL statistic separates her echo from a
// person, and that is correct. This is not a level statistic. Her echo is a
// filtered copy of a signal WE OWN, so across a window of mic ticks
//
//     micPower ≈ C²·herPower(t − lag) + (room + anyone else)²
//
// is an affine relation, and a second talker — who is uncorrelated with her
// envelope — moves the INTERCEPT, not the SLOPE. So the fit's quality is the
// gate ("this window really is her, and the lag is this") and the existing
// 90th-percentile ratio stays the estimate (it is already measured in the
// same units the bar uses). Measured, best-lag fit over 12 ticks ≈ 1.0s:
//
//   r² of the fit, pure echo, all couplings   p10 0.73   median 0.89-0.90
//   √slope vs the true coupling, no one there   1.10-1.14× (bias, not spread)
//   √slope with a LOUD person talking across her whole turn, gated at r²≥0.7:
//       −6 dB 0.582 (pure 0.561) · −9 dB 0.397 (0.405) · −12 dB 0.272 (0.280)
//
// i.e. the gate throws away ~80% of the windows when someone else is talking
// and the ones it keeps still measure the device, not the person. UNGATED the
// same estimator collapses (median 0.000, p90 1.02) — the gate is the whole
// mechanism, not a decoration.
//
// The direction stays asymmetric where it matters: κ rises only on a locked
// fit and never past ECHO_KAPPA_MAX, and the decay path is untouched, so the
// good-AEC device still walks down to 0.02 and stays there.
const ECHO_KAPPA_SEED = 0.3; // ≈10 dB ERL: a bare hands-free speakerphone
const ECHO_KAPPA_MIN = 0.02; // ≈34 dB ERL: real AEC, the term stops binding
// ≈ −2.4 dB ERL. Past this the "room" is a speaker pointed at a microphone and
// no bar can tell her voice from anyone else's; refusing to go further keeps
// the failure at "late barge-in" instead of "permanently deaf".
const ECHO_KAPPA_MAX = 0.76;
const ECHO_WIN_MS = 1000; // ~47 sub-frames of ratio history
const ECHO_PCT = 0.9; // the TOP of the leak distribution — it must bound peaks
const ECHO_MIN_SAMPLES = 16; // never estimate from a handful of sub-frames
const ECHO_RATE = 0.4; // how fast κ comes down once the evidence is in
// Rising is FASTER than decaying, deliberately: an under-protected arbiter is
// the self-sustaining failure (her leak takes the floor, which starts a new
// turn, which leaks) and every tick spent under-protected is a tick of her own
// voice going into the hold ring. Over-protection just costs a late barge-in.
const ECHO_UP_RATE = 0.55;
// ── the lock ──
// 12 ticks ≈ 1.02s of (her aligned power, mic power) pairs, which is both the
// window the ratio percentile already uses and long enough to contain two or
// three of her syllables — the fit needs her envelope to MOVE.
const ECHO_FIT_WIN = 12;
const ECHO_FIT_R2 = 0.7; // measured: pure echo p10 = 0.73, so this is the knee
// The acoustic round trip is a device property nobody can look up, so it is
// searched: 0-260ms in 20ms steps covers a phone against a face (~20ms) and a
// speakerphone across a reverberant room. Measured best lag in the simulator:
// 40ms, stable across every coupling.
const ECHO_LAG_STEP_MS = 20;
const ECHO_LAGS = 14; // 0…260ms
// How far BEHIND the playhead her envelope is kept. It cannot be a frame
// count: the downlink runs seconds ahead of playback (a median of ~5s of
// unplayed lead on his own calls), so a fixed-size ring fills with audio that
// has not been heard yet and the lookup falls off the front of it — measured,
// as the prediction reading 0.000 for the whole back half of every turn and
// the bar collapsing onto ambience. Pruned by TIME against the playhead, the
// ring holds whatever lead the server sends plus this much history.
const ECHO_ENV_KEEP_S = 1.5; // > lag + tail + the fit window, with room over
const ECHO_ENV_CAP = 2000; // ~40s of lead: a backstop, never reached in a call
// How long a room keeps handing her last syllable back, and by how much it is
// down by the end of that. The prediction decays her envelope across this, so
// the bar can fall into her pauses without her own reverb tail walking through
// it. 200ms / −20 dB is a live small room, chosen pessimistically: a deader
// room only means the bar is higher than it needed to be for 200ms.
const ECHO_TAIL_MS = 200;
const ECHO_TAIL_DB = 20;
// How far back the ring-admission test peak-holds the prediction: 3 mic ticks
// ≈ 256ms, the same span herRecentRms uses, so the two questions differ in
// their statistic and not in the window they look at.
const ECHO_ADMIT_TICKS = 3;
// Only sub-frames where she is within this much of her recent peak are used to
// measure κ. Her pauses carry no coupling information, only model error.
const ECHO_MEASURE_FRAC = 0.7;
// The bar sits a MARGIN above the leak estimate, never at it: κ is an RMS
// ratio and the sub-frames it has to reject are the loud ones. +2.3 dB was
// chosen by sweeping it against BOTH failure directions at once — below 1.3
// she starts interrupting herself again, above 1.6 the quiet talker stops
// getting through.
// It was re-swept once κ stopped being a guess, because the old note here
// ("below 1.3 she starts interrupting herself again") was true of a κ pinned
// at a seed that could be 6 dB wrong — the margin was covering the ESTIMATOR's
// error as much as the leak's crest. It STAYS at 1.3. n=8 per cell, whole
// calls of three of her turns, against the shipped arbiter:
//
//                    −6 dB coupling               −12 dB coupling
//   margin   self-duck  her voice out   quiet talker 0.10   TV 0.12   TV 0.08
//    1.30       14%        1280ms              5/8            5/8       2/8
//    1.15       19%        1792ms              6/8            7/8       6/8
//   shipped     91%        6996ms              5/8            8/8       2/8
//
// 1.15 buys one extra quiet talker in eight and gives back most of the
// background rejection, which is the half of the complaint that says "because
// of background sound she keep listening to it and kept stopped". 1.3 holds
// the quiet talker exactly where the shipped arbiter had it and takes the
// television from 8/8 false stops to 5/8 (and at −6 dB from 8/8 to 2/8). A
// κ-dependent ramp between the two was built and measured and dominated
// neither (quiet talker 4/8, talker in a noisy room 5/8); it is not in the
// file and is not worth re-deriving.
//
// What DOES move together in every cell of that sweep is the quiet talker and
// the distant television, which is the same thing this file has always said:
// at 0.10-0.12 they are not separable by level, and the margin only chooses
// which way to be wrong.
const ECHO_MARGIN = 1.3; // +2.3 dB over the leak estimate
// The soft bar's LEVEL no longer carries the echo term (see thrS), but an
// individual soft HIT still has to out-shout the leak at the instant it was
// captured. That is a per-sub-frame test, not a test on the finished
// candidate: her voice pauses, and a span statistic compared against the
// CURRENT echo term passes during her every breath — measured, on the real
// endpoint, as her taking the floor from herself in 3 of 3 sessions even with
// the hard bar holding.
//
// What this buys, and what it does not: while echo is not the binding term —
// a headset, any real AEC, and every moment she is quiet — the soft valve is
// a genuinely lower bar and gives the 3.5-14 dB of extra level sensitivity it
// is supposed to. When her leak IS the loudest thing in the room, the valve
// collapses back onto the leak, and that is not a bug to fix: a bar below the
// echo cannot distinguish a quiet talker from her own voice, and the soft
// path's remaining advantage there is its longer duration.
// ── overlap: what she sounds like while it is being resolved ──
// Ported from the cascade lane's duckSpeech(), which has production miles.
const DUCK_SOFT = 0.62; // −4.2 dB: "haan bolo" — she softens, keeps talking
const DUCK_CLAIM = 0.3; // −10.5 dB: the floor is going, she is on her way out
const DUCK_RAMP = 0.12; // seconds
const UNDUCK_RAMP = 0.18; // slower back up — a snap reads as a glitch
// When the floor is genuinely lost, do NOT gate off mid-syllable. At the
// instant `interrupted` lands the client is holding a MEDIAN OF 5.05 SECONDS
// of her finished, already-paid-for voice (measured: 3.00/4.72/7.49/5.05s of
// unplayed lead across four trials) and the server will send nothing more for
// that turn. Today all of it is destroyed and replaced with a 220ms ramp.
// Instead we play on to the next phrase boundary in her own audio — a real
// gap between words — and fade across it. Humans trail off; they do not cut.
const YIELD_MAX = 0.45; // seconds of continuation we will ever pay for
const YIELD_DEFAULT = 0.26; // no boundary in reach: a slightly longer dissolve
const YIELD_HARD = 0.13; // they are plainly taking the floor: get out of the way
const YIELD_HARD_AFTER_MS = 700; // overlap this long = not a hesitation
const BOUNDARY_RMS = 0.02; // a 20ms frame this quiet is a word gap
const BOUNDARY_MIN_GAP = 0.06; // don't record two boundaries inside one gap
// If she is talking and we released a real floor claim, the server owes us an
// `interrupted`. On the pinned model there is an acknowledged case where it
// never arrives (the user already speaking as her turn begins), and today
// that single message is the ONLY thing in this file that can stop her. The
// watchdog makes the client's own decision authoritative instead.
const RELEASE_WATCHDOG_MS = 600;
// ...but when her generation is ALREADY COMPLETE the server owes us nothing —
// there is no turn left to interrupt, so waiting for a message that cannot
// come is pure dead air on top of her talking over them. Act at the next
// phrase boundary instead, almost immediately. 300ms is a real barge settling
// (long enough that a single "haan" backchannel has already been refused the
// floor upstream), not a 1.5s stare.
const RELEASE_SETTLE_MS = 300;
// A killed turn's stragglers must not resurrect: chunks are dropped between
// `interrupted` and the `turnComplete` that follows it 4-21ms later. The cap
// is a safety net so a missing turnComplete can never mute her forever.
const DISCARD_CAP_MS = 2000;

// ── THE LISTENING SOUND, and why it is placed where it is ────────────────
// The complaint this answers is that she is completely silent while you talk,
// so the line feels dead. A real listener backchannels — "hmm", "haan" — and
// the honest finding is that on this architecture she CANNOT do it while you
// are still speaking. Measured in scratchpad/echosim (exp11.mjs, 8 seeds per
// cell, one 450ms sound dropped 1.5s into a 4s utterance, paired against the
// identical run without it):
//
//   how it is played                 extra digital     longest silent    other-
//                                    silence in        run inside        energy
//                                    their sentence    their sentence    uplinked
//   registered (protected properly)     +171ms          427 -> 597ms       +0ms
//   as a model turn (prompted)          +85ms           427 -> 512ms       +0ms
//   stray, via a 2nd AudioContext       -171ms          427ms (unch.)      +171ms
//   in the GAP after they stop           0ms            427ms (unch.)      +0ms
//
// The two "during" options fail for opposite reasons and there is no third.
// Protecting the sound means HOLDING the microphone (the only mechanism this
// file has for not feeding her own output back to the server), and a hold puts
// digital silence on the uplink — which is precisely how the server ends a
// turn (automaticActivityDetection.silenceDurationMs = 300). So the protection
// and the damage are the same act: their sentence gets split in two and she
// answers the first half while they are saying the second. NOT protecting it
// hands her own voice to the server inside their turn (+171ms of foreign
// energy per sound, at EVERY coupling measured, −6 through −18 dB, because the
// listen gate carries no echo term) and simultaneously fills their own pauses,
// so the endpointer commits LATER and she replies slower. That second one is
// what calling speech.ts's playAck() during a live call would do today.
//
// The gap AFTER they stop is free on every axis: the uplink there is already
// digital silence (the gate has closed), so a hold costs nothing the server
// was not already being told, and 0ms of their speech is displaced.
//
// WHAT IT MAY NEVER DO: touch `playhead`. Her first word is scheduled off that
// value, so a sound that advances it would delay her — the one thing this lane
// is not allowed to trade. The murmur therefore runs on its own source into
// its own gain, overlapping her real audio rather than queueing in front of it,
// and fades out under her first chunk.
const ACK_MIN_USER_MS = 2500; // only after a real stretch of them talking
const ACK_MIN_VOICE_MS = 1200; // ...of which this much was actually voice
// A silence longer than this ends their stretch of talking. Shorter than it is
// one of their own pauses and the stretch continues through it: the gate closes
// after 250ms of hangover, which is inside the gap an ordinary talker leaves
// between phrases, so anything less generous measures phrases instead of turns.
const ACK_TALK_GAP_MS = 800;
const ACK_MIN_GAP_MS = 15_000; // rarely, and never twice running
const ACK_AFTER_CHUNKS = 2; // ≈420ms after they stop: where a human lands one
const ACK_SECS = 0.42;
const ACK_PEAK = 0.12; // −18 dBFS: a backchannel is quieter than a sentence
// Her own reverb tail keeps arriving after the sound itself has stopped, and
// the listen gate has no echo term, so an unguarded tail is streamed to the
// server as if the user had started talking. Measured as the +427ms of
// uplinked energy the "after" arm cost at −6 dB before this guard existed
// (+171ms at −12, +85ms at −18) — one extra turn's worth of exactly the leak
// the echo work just spent itself reducing. Holding the microphone across the
// tail is free here: their turn is already committed and the uplink is already
// silent. 320ms > ECHO_TAIL_MS (200) + the acoustic round trip.
const ACK_TAIL_GUARD_MS = 320;
const ACK_FADE = 0.1; // seconds — she trails the hum off as she starts talking

/**
 * Mint the ephemeral token with two STAGGERED attempts inside one budget.
 * On a lossy mobile link a single lost SYN burns the entire ring window
 * (8s of retransmit backoff, then no live call at all); a second attempt
 * fired at 2.5s costs one request and wins the race outright when the
 * first one is stuck. First success wins — and the loser's in-flight fetch
 * is ABORTED, because /api/live-token hands out SINGLE-USE tokens: letting
 * the loser complete mints a second session credential nobody will ever
 * connect with. The stagger is also a ceiling, not a floor: if the first
 * attempt fails fast (refused, 5xx, DNS), the second starts immediately
 * instead of sleeping out 2.5s of an 8s budget on an already-dead request.
 */
// ── pre-minted token ────────────────────────────────────────────────────
// The mint is a full round trip to our server and on to Google. On a weak
// mobile link that is seconds, and it lands squarely on the call-start path
// where it becomes dead air. So it happens EARLY — while they are reading
// chat — and the call spends the cached token instead. Single-use: taking it
// clears it. The server issues a 9-minute start window; we keep a margin
// under that and fall back to a normal mint whenever the cache is cold.
const TOKEN_FRESH_MS = 7 * 60_000;
const PREWARM_RETRY_MS = 20_000; // a failing mint must not hammer the limiter
let pre: { token: string; model?: string; at: number } | null = null;
let preFlight: Promise<void> | null = null;
let preTried = 0;

/** Mint ahead of time (chat idle). Safe to call often — it self-throttles. */
export function prewarmLiveToken(base: string) {
  if (typeof fetch === "undefined") return;
  if (preFlight) return; // one in flight is enough
  if (pre && Date.now() - pre.at < TOKEN_FRESH_MS) return; // still good
  if (Date.now() - preTried < PREWARM_RETRY_MS) return; // backoff after a miss
  preTried = Date.now();
  preFlight = fetch(`${base}/api/live-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (j?.token) pre = { token: j.token, model: j.model, at: Date.now() };
    })
    .catch(() => {})
    .finally(() => {
      preFlight = null;
    });
}

/** Take the pre-minted token if one is fresh. Single-use: this consumes it. */
function takePre() {
  if (pre && Date.now() - pre.at < TOKEN_FRESH_MS) {
    const t = pre;
    pre = null;
    return t;
  }
  pre = null;
  return null;
}

async function mintToken(base: string, budgetMs: number) {
  const t0 = Date.now();
  let won = false;
  const ctrls: AbortController[] = [];
  const attempt = async (gate?: Promise<void>) => {
    if (gate) {
      await gate;
      if (won) throw new Error("superseded"); // never mint a second token for nothing
    }
    const left = budgetMs - (Date.now() - t0);
    if (left <= 0) throw new Error("no live token");
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    // one controller carries BOTH the remaining budget and the "the other
    // attempt won" abort, so a winner can always cancel the loser's request
    const budgetTimer = setTimeout(() => ctrl.abort(), left);
    try {
      const res = await fetch(`${base}/api/live-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error("no live token");
      const j = await res.json();
      if (!j?.token) throw new Error("no live token");
      won = true;
      for (const c of ctrls) if (c !== ctrl) c.abort();
      return j as { token: string; model?: string };
    } finally {
      clearTimeout(budgetTimer);
    }
  };
  const first = attempt();
  // the second attempt starts at the stagger OR the moment the first gives
  // up, whichever comes first
  const gate = new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 2500);
    first.catch(() => {
      clearTimeout(t);
      resolve();
    });
  });
  try {
    return await Promise.any([first, attempt(gate)]);
  } catch {
    throw new Error("no live token"); // both attempts failed inside the budget
  }
}

export async function startLiveCall(opts: LiveCallOpts): Promise<LiveSession> {
  // 1. ephemeral token from our server (never the real key). A token minted
  // while they were in chat skips this round trip entirely; the next one is
  // minted in the background so the call after this is instant too.
  const tMint = Date.now();
  const warmed = takePre();
  const { token, model } = warmed ?? (await mintToken(opts.base, 8000));
  const mintMs = Date.now() - tMint;
  opts.onTiming?.({ mintMs, preminted: !!warmed });
  // refill for the NEXT call, but not now: a mint racing this session's own
  // handshake is exactly the contention this change exists to remove
  setTimeout(() => prewarmLiveToken(opts.base), 15_000);

  // ── 2. THE TWO SLOW THINGS START TOGETHER ──
  // These used to be serialized: the mic was awaited first and the socket was
  // only constructed afterwards, so a device that takes seconds to hand over
  // the microphone (Android WebView permission plumbing is the bad case) paid
  // for that AND then paid DNS + TLS + upgrade + the server handshake on top.
  // A real call reported readyMs 7618 with the token already in hand.
  //
  // Nothing in the setup message depends on the microphone, so the socket can
  // connect, send setup and collect setupComplete while the mic is still
  // opening. Whichever leg is slower now hides the other one entirely.
  //
  // Ordering note that makes this safe: everything from here to the end of
  // the `opened` block is SYNCHRONOUS. A WebSocket event cannot be dispatched
  // until this call stack unwinds, so no open/message can be missed by
  // assigning the handlers a few statements later.
  const tPar = Date.now();
  let micMs = 0;
  let wsOpenMs = 0;
  let setupMs = 0;
  let tSetupSent = 0;
  const micP = navigator.mediaDevices
    .getUserMedia({
      // echo cancellation on: she plays through the same phone's speaker
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    .then((s) => {
      micMs = Date.now() - tPar;
      return s;
    });
  micP.catch(() => {}); // the socket leg may reject first; never go unhandled

  let ws: WebSocket | null = new WebSocket(`${WS_BASE}?access_token=${token}`);
  let dead = false;
  let muted = false;
  let ready = false;

  // ── uplink: mic → 16k PCM16. Built once the stream lands, below. ──
  let inCtx: AudioContext | null = null;
  let proc: ScriptProcessorNode | null = null;
  let src: MediaStreamAudioSourceNode | null = null;
  let stream: MediaStream | null = null;
  /**
   * Wire the microphone into the socket. Called the moment getUserMedia
   * resolves — which may be before OR after the socket finished its
   * handshake; the tick guards on `ready` either way.
   */
  const buildUplink = (ms: MediaStream) => {
    stream = ms;
    inCtx = new AudioContext();
    src = inCtx.createMediaStreamSource(ms);
    // ScriptProcessor still works everywhere (incl. Android WebView) and 4096
    // frames ≈ 85ms at 48k — fine granularity for realtime
    proc = inCtx.createScriptProcessor(4096, 1, 1);
    const sink = inCtx.createGain();
    sink.gain.value = 0; // processor needs a destination; we never monitor the mic
    src.connect(proc);
    proc.connect(sink);
    sink.connect(inCtx.destination);
    attachAnalyser("you", inCtx, src); // presence UI reads YOUR real amplitude
  // ── adaptive noise gate + floor arbiter ──
  // Two questions with opposite cost functions used to share one threshold.
  // "Is anyone talking?" (she is silent) wants to be sensitive — a false open
  // costs nothing, a false close clips a first syllable. "Is this a PERSON
  // taking the floor from her?" (she is talking) wants to be strict — a false
  // open costs her being killed mid-word by a television. So there are two
  // bars now, and while she is audible the audio is HELD rather than sent
  // until one of them is genuinely cleared.
  const chunkMs = (4096 / inCtx.sampleRate) * 1000; // actual, not assumed
  const subMs = chunkMs / SUBS; // 21.3ms at 48kHz
  const hangChunks = Math.max(2, Math.ceil(250 / chunkMs));
  const floorN = Math.max(16, Math.round(FLOOR_WIN_MS / subMs));
  const echoN = Math.max(ECHO_MIN_SAMPLES, Math.round(ECHO_WIN_MS / subMs));
  const claimWin = Math.round(CLAIM_WIN_MS / subMs);
  const claimNeed = Math.round(CLAIM_MS / subMs);
  const softWin = Math.round(SOFT_CLAIM_WIN_MS / subMs);
  const softNeed = Math.round(SOFT_CLAIM_MS / subMs);
  const duckNeed = Math.max(2, Math.round(DUCK_AT_MS / subMs));
  const floorRing: number[] = [];
  let noiseFloor = 0.003;
  let tickNo = 0;
  let gateLeft = 0;
  let prevPcm: Int16Array | null = null;
  let wasOpen = false;
  const endpointChunks = Math.ceil(SILENCE_ENDPOINT_MS / chunkMs);
  let gatedRun = 0; // consecutive gated (wordless) chunks
  // this stretch of them talking: when it began, when it last had words in it,
  // and how much of it was actually voice rather than their own pauses
  let talkStart = 0;
  let talkEndAt = 0;
  let talkOpen = 0;
  const talkGapChunks = Math.max(2, Math.round(ACK_TALK_GAP_MS / chunkMs));
  // ── floor-arbitration state ──
  let subIdx = 0; // monotonic sub-frame counter — the claim windows' clock
  const hardHits: number[] = []; // sub-frames above the BARGE bar
  const softHits: number[] = []; // sub-frames above the SOFT bar
  let claimPeak = 0;
  // EVERY sub-frame while she is audible, linear RMS, oldest first — one entry
  // per sub-frame, so position maps straight back to subIdx. The steadiness
  // test reads this rather than only the above-bar sub-frames, because
  // selecting on "above the bar" throws away the dips that distinguish a mouth
  // from a motor. Bounded by the soft window, the longer of the two.
  const subLin: number[] = [];
  let hold: Int16Array[] = []; // her turn's withheld audio, oldest first
  let ducked = 0; // 0 full volume · 1 soft duck · 2 yielding
  let kappa = ECHO_KAPPA_SEED; // learned mic-to-speaker coupling
  const echoRing: number[] = []; // per-sub-frame mic÷her ratios, for the percentile
  // ── the echo lock ──
  // One row per mic tick while she is audible: the mic's own power, and her
  // power at each candidate acoustic lag. A good affine fit across the window
  // means this stretch of mic audio IS her, at that lag — the only evidence
  // that lets κ move UP. Fixed-length arrays: this runs on the audio tick.
  const echoHold: number[] = []; // recent ticks' predicted echo, for admission
  const fitMic: number[] = [];
  const fitHer: number[][] = []; // [tick][lag]
  let echoLocked = false;
  let echoLag = -1; // index into the lag search; -1 = never locked, use herMax
  /** Her own output power over `winSec` ending at `endT`, from herEnv. */
  const herPowerAt = (endT: number, winSec: number) => {
    let acc = 0;
    let n = 0;
    for (let i = herEnv.length - 1; i >= 0; i--) {
      const e = herEnv[i];
      if (e.t > endT) continue;
      if (e.t <= endT - winSec) break; // herEnv is time-ordered
      acc += e.p;
      n++;
    }
    return n ? acc / n : 0;
  };
  /**
   * What her voice is still expected to measure at the microphone at `endT`:
   * the loudest 20ms she played in the window before it, each one DECAYED by
   * how long ago it was.
   *
   * A flat peak-hold over the tail is the 250ms max again wearing a hat — it
   * was measured as exactly neutral, because her syllables are close enough
   * together that the local peak is always the recent peak. The decay is the
   * point: a syllable 100ms back is still arriving, but 15 dB down, so the bar
   * follows her envelope DOWN into her own pauses instead of sitting at her
   * loudest word through all of them. That is where people start talking.
   */
  const herTailPowerAt = (endT: number) => {
    let m = 0;
    for (let i = herEnv.length - 1; i >= 0; i--) {
      const e = herEnv[i];
      if (e.t > endT) continue;
      const age = endT - e.t;
      if (age >= ECHO_TAIL_MS / 1000) break;
      // −ECHO_TAIL_DB over the whole tail, in power
      const d = e.p * Math.pow(10, (-ECHO_TAIL_DB * age) / (ECHO_TAIL_MS / 1000) / 10);
      if (d > m) m = d;
    }
    return m;
  };
  let herTurnSeen = -1; // which of her turns the arbitration state belongs to
  const toPcm = (input: Float32Array, ratio: number, outLen: number) => {
    const p = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const s = input[Math.floor(i * ratio)];
      p[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
    }
    return p;
  };
  proc.onaudioprocess = (e) => {
    if (dead || !ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const N = input.length;
    // Sub-frame RMS. 85ms granularity cannot express a 550ms guard as
    // anything better than "either 512 or 597ms", and every duration in the
    // floor model is counted in these.
    const sub: number[] = [];
    let sum = 0;
    for (let s = 0; s < SUBS; s++) {
      const a = Math.floor((s * N) / SUBS);
      const b = Math.floor(((s + 1) * N) / SUBS);
      let acc = 0;
      for (let i = a; i < b; i++) acc += input[i] * input[i];
      sum += acc;
      sub.push(Math.sqrt(acc / Math.max(1, b - a)));
    }
    const rms = Math.sqrt(sum / N);
    const herSpeaking = speakingUntil > Date.now();
    // Do NOT learn ambience from her own leak. The floor is what the ROOM
    // sounds like; every sub-frame captured while she is audible carries some
    // amount of her, and folding that in ratchets the ambience estimate up on
    // audio that is not the room — which then raises every bar derived from
    // it, on a leaky device, for the whole turn. The Android lane has always
    // guarded this (`if (!herAudible)`); the web lane did not.
    //
    // Learning while MUTED is still deliberate and still correct: web mute
    // means "the line is not open yet", so that audio is clean room.
    if (!herSpeaking) {
      for (const v of sub) {
        floorRing.push(v);
        if (floorRing.length > floorN) floorRing.shift();
      }
    }
    // the percentile is a sort of 141 doubles; once every 4 ticks (~341ms) is
    // plenty for a statistic with a 3s window and keeps this off the hot path
    if ((tickNo++ & 3) === 0 && floorRing.length > 8) {
      const sorted = [...floorRing].sort((x, y) => x - y);
      noiseFloor = Math.min(
        FLOOR_MAX,
        Math.max(FLOOR_MIN, sorted[Math.floor(sorted.length * FLOOR_PCT)]),
      );
    }
    // ── the ONE buffered sample of this mic tick ──
    // Both readers (the advisory congestion trough and the silence-shed
    // decision) take this single value: the counter is sampled on the mic
    // clock and nowhere else, so the signal is evenly spaced and a tick that
    // happens to send twice (gate-open pre-roll) can't double-weight it.
    const buffered = ws.bufferedAmount;
    // Retire the burst credit as the socket actually drains it: it can never
    // exceed what is really queued, and it expires on a wall clock regardless.
    if (burstBytes) {
      if (Date.now() > burstUntil) burstBytes = 0;
      else if (buffered < burstBytes) burstBytes = buffered;
    }
    const linkBuffered = Math.max(0, buffered - burstBytes);
    noteBuffered(linkBuffered);
    if (muted) {
      // Muting is not a reason to leave her quiet. This return used to sit
      // ABOVE the duck restore, so muting while she was ducked pinned
      // outBus.gain at −4.2 dB (or −10.5 dB after a claim) for the entire
      // mute and, because nothing else writes the gain outside this tick, for
      // every turn after it too. Unwind the overlap state on the way out, and
      // drop the held ring: it is room audio from before the mute and must
      // never be burst at the server after it.
      if (ducked && !yieldTimer) {
        rampGain(1, UNDUCK_RAMP);
        ducked = 0;
      }
      hardHits.length = 0;
      softHits.length = 0;
      subLin.length = 0;
      hold = [];
      claimPeak = 0;
      floorLost = false;
      floorClaimSince = 0;
      floorReleasedAt = 0;
      prevPcm = null;
      wasOpen = false;
      return;
    }
    // ── the two bars ──
    const thrL = Math.min(
      LISTEN_ABS_MAX,
      Math.max(
        noiseFloor * LISTEN_RATIO_MIN,
        Math.min(Math.max(noiseFloor * LISTEN_MULT, LISTEN_MIN), LISTEN_MAX),
      ),
    );
    // ── WHAT HER OWN VOICE IS EXPECTED TO SOUND LIKE, SUB-FRAME BY SUB-FRAME ──
    //
    // herRecentRms is a MAX over the last 250ms, taken that way so the bar
    // could bound a peak without anyone having to measure the device's
    // acoustic round trip. It is measured on the samples BEFORE the output bus
    // gain, so it is scaled by what is actually reaching the speaker — a
    // ducked voice leaks proportionally less.
    //
    // The cost of a 250ms max is that the bar is flat: it stays at her LOUDEST
    // recent syllable through her every pause, so the moments when a person is
    // most audible — the gaps between her words, which is exactly where people
    // start talking — are the moments the bar is least deserved. It is also
    // mis-aligned in the dangerous direction: anchored at `now`, it contains
    // audio that has not reached the microphone yet and drops her tail from
    // 250-300ms ago, which on a reverberant speakerphone is still arriving.
    //
    // Once the lock has measured the round trip we can do the honest thing and
    // PREDICT the echo instead: her own envelope, at the measured lag, peak-
    // held across a reverb tail. The bar then rises on her syllables and falls
    // in her gaps, which protects her strictly better AND hears people
    // strictly better. Until the lock exists — the first second of the first
    // turn — this is exactly the old expression, unchanged.
    const herMax = herRecentRms() * outGain();
    let nowT = 0;
    try {
      nowT = outCtx.currentTime;
    } catch {
      /* ctx closed */
    }
    const gNow = outGain();
    const lagS = echoLag >= 0 ? (echoLag * ECHO_LAG_STEP_MS) / 1000 : 0;
    // her predicted level at each sub-frame of THIS mic buffer (the buffer
    // covers the chunkMs that just elapsed, so sub-frame s ends that far back)
    const herAt: number[] = [];
    for (let s = 0; s < SUBS; s++) {
      if (echoLag < 0) {
        herAt.push(herMax);
        continue;
      }
      const tEnd = nowT - chunkMs / 1000 + ((s + 1) * subMs) / 1000 - lagS;
      herAt.push(Math.sqrt(herTailPowerAt(tEnd)) * gNow);
    }
    let herNow = 0;
    for (const h of herAt) if (h > herNow) herNow = h;
    const echoAt = herAt.map((h) => kappa * h * ECHO_MARGIN);
    let echoTick = 0;
    for (const e of echoAt) if (e > echoTick) echoTick = e;
    // Whether ANYTHING in this chunk out-shouts her leak is a different
    // question from whether it is clearing the bar at this instant, and it has
    // a whole turn to be answered rather than one sub-frame. It gets a
    // peak-held estimate, because its failure mode is her own voice ending up
    // in the hold ring and being flushed at the server as the user's turn:
    // with the instantaneous prediction alone that leak was 1792ms per call at
    // −6 dB, with the peak hold 938ms, and barge-in is unchanged either way.
    //
    // The peak is held over the PREDICTION, never over `kappa * herMax`: κ is
    // measured against the prediction, so pairing it with the 250ms max
    // multiplies the same headroom in twice and the bar lands ~3 dB high. That
    // mistake, made here first, locked a quiet talker out completely — 8/8
    // releases to 0/8 at −12 dB, where there is no real conflict to trade.
    echoHold.push(echoTick);
    if (echoHold.length > ECHO_ADMIT_TICKS) echoHold.shift();
    let admitEcho = 0;
    for (const e of echoHold) if (e > admitEcho) admitEcho = e;
    const echoTerm = echoTick;
    const thrBAt = echoAt.map((e) =>
      Math.min(BARGE_MAX, Math.max(thrL * BARGE_OVER_LISTEN, noiseFloor * BARGE_MULT, e)),
    );
    // The soft bar carries NO echo term. With it, `min(thrB, max(…, echoTerm))`
    // evaluates to exactly thrB whenever echo binds thrB — the valve collapsed
    // onto the bar it is supposed to sit below, in the one case it exists for.
    // The min() is kept only as a sanity rail; with SOFT_OVER_LISTEN < BARGE_
    // OVER_LISTEN and SOFT_MULT < BARGE_MULT it can bind only when BARGE_MAX
    // clamps thrB.
    const softBar = Math.max(thrL * SOFT_OVER_LISTEN, noiseFloor * SOFT_MULT);
    const thrSAt = thrBAt.map((b) => Math.min(b, softBar));
    if (rms > thrL) gateLeft = hangChunks;
    else if (gateLeft > 0) gateLeft--;
    const open = gateLeft > 0;
    // HOW LONG HAVE THEY BEEN TALKING. Not "consecutive open chunks": the gate
    // closes inside anybody's sentence — 250ms of hangover against the 300ms+
    // gaps a real talker leaves between phrases — so a consecutive count
    // measures their longest phrase, not their turn, and it measured ~1s on a
    // 3s utterance (the murmur never fired once in 8 seeds). A stretch of talk
    // is a SPAN with their own pauses inside it, ended only by a silence long
    // enough to be a turn boundary.
    const wasGated = gatedRun;
    if (open) gatedRun = 0;
    else gatedRun++;
    // ...and NONE of it is credited while she is audible. The listen gate
    // carries no echo term, so on a leaky device her own voice holds it open
    // for her whole turn; counting that as "them talking" made her hum at her
    // own echo (measured: 2 murmurs per call in a scenario with one user turn
    // in it). Her leak also outlives `speakingUntil` by a reverb tail, and the
    // two thresholds below are what stop that tail from qualifying on its own.
    if (herSpeaking) {
      talkStart = 0;
      talkOpen = 0;
    } else if (open) {
      if (!talkStart || wasGated > talkGapChunks) {
        talkStart = Date.now();
        talkOpen = 0;
      }
      talkOpen += chunkMs;
      talkEndAt = Date.now();
    }
    // ── the listening sound ──
    // Placed where a person places one: a beat after they stop, while she has
    // nothing to say yet. The conditions are the ones speech.ts already argued
    // for on the cascade lane — humans do not make a sound after every turn,
    // only after someone has actually been talking, and never twice running.
    //
    // Cheap tests first, and every one of them is a reason NOT to make a sound:
    // she is already audible, they only said two words, one was made recently,
    // or the gate is open because they are still going.
    if (
      !open &&
      gatedRun === ACK_AFTER_CHUNKS &&
      !herSpeaking &&
      !genInFlight && // her answer is already being written; it will arrive
      talkEndAt - talkStart >= ACK_MIN_USER_MS &&
      talkOpen >= ACK_MIN_VOICE_MS // a span of mostly silence is not a turn
    ) {
      emitAck();
    }
    // Measure the coupling from ground truth rather than trusting AEC. Every
    // sub-frame she is audible for contributes one ratio sample; κ then DECAYS
    // toward the 90th percentile of those and never rises. See ECHO_KAPPA_SEED
    // for why the direction is forced.
    if (herSpeaking && herMax > 0.02) {
      // The ratio is taken against the SAME prediction the bar is built on, so
      // κ and the bar stay in one another's units whichever branch is live.
      for (let s = 0; s < SUBS; s++) {
        // Measure the coupling only where the PREDICTION is trustworthy: her
        // loud moments. In her quiet ones the predicted level is small and the
        // model's error is a large fraction of it, so the ratio's 90th
        // percentile ends up absorbing prediction error rather than coupling —
        // measured as κ = 0.41 on a device whose true coupling is 0.25, which
        // is 4.3 dB of bar that nothing in the room put there.
        if (herAt[s] <= 0.02 || herAt[s] < herMax * ECHO_MEASURE_FRAC) continue;
        // subtract ambience in POWER: the mic sums two uncorrelated sources
        const v = sub[s];
        const excess = Math.sqrt(Math.max(0, v * v - noiseFloor * noiseFloor));
        echoRing.push(excess / herAt[s]);
        if (echoRing.length > echoN) echoRing.shift();
      }
      // THE LOCK. One (her power at lag L, mic power) pair per tick; when the
      // affine fit across the window is good at some lag, this window is her.
      const winSec = chunkMs / 1000;
      const row: number[] = [];
      for (let L = 0; L < ECHO_LAGS; L++) {
        row.push(herPowerAt(nowT - (L * ECHO_LAG_STEP_MS) / 1000, winSec));
      }
      fitHer.push(row);
      fitMic.push(Math.max(0, rms * rms - noiseFloor * noiseFloor));
      if (fitHer.length > ECHO_FIT_WIN) {
        fitHer.shift();
        fitMic.shift();
      }
      echoLocked = false;
      if (fitHer.length === ECHO_FIT_WIN) {
        const n = ECHO_FIT_WIN;
        let my = 0;
        for (const y of fitMic) my += y;
        my /= n;
        let syy = 0;
        for (const y of fitMic) syy += (y - my) * (y - my);
        if (syy > 0) {
          let bestR2 = 0;
          let bestL = -1;
          for (let L = 0; L < ECHO_LAGS; L++) {
            let mx = 0;
            for (const r of fitHer) mx += r[L];
            mx /= n;
            let sxx = 0;
            let sxy = 0;
            for (let i = 0; i < n; i++) {
              const dx = fitHer[i][L] - mx;
              sxx += dx * dx;
              sxy += dx * (fitMic[i] - my);
            }
            // sxy > 0 as well as r²: a NEGATIVE slope fits just as tightly and
            // means the opposite of what we are looking for.
            if (sxx <= 0 || sxy <= 0) continue;
            const r2 = (sxy * sxy) / (sxx * syy);
            if (r2 > bestR2) {
              bestR2 = r2;
              bestL = L;
            }
          }
          if (bestL >= 0 && bestR2 >= ECHO_FIT_R2) {
            echoLocked = true;
            // The round trip is a property of the device and the room, not of
            // this second: keep the last lag that was actually earned, so the
            // prediction survives the windows where the fit is inconclusive.
            echoLag = bestL;
          }
        }
      }
      if (echoRing.length >= ECHO_MIN_SAMPLES) {
        const srt = [...echoRing].sort((a, b) => a - b);
        const r = srt[Math.min(srt.length - 1, Math.floor(srt.length * ECHO_PCT))];
        // DOWN is unconditional: a ratio below κ can only mean the device
        // leaks less than we feared, whoever else is in the room.
        if (r < kappa) kappa = Math.max(ECHO_KAPPA_MIN, kappa - ECHO_RATE * (kappa - r));
        // UP only on a locked fit. A ratio above κ is not, on its own,
        // evidence of a leakier device — a person raises every percentile of
        // it. It is evidence once we can also show that this window's mic
        // audio is an affine function of her own output at a fixed lag, which
        // a person cannot make true.
        else if (echoLocked) {
          kappa = Math.min(ECHO_KAPPA_MAX, kappa + ECHO_UP_RATE * (r - kappa));
        }
      }
    } else if (!herSpeaking && (echoRing.length || fitHer.length)) {
      echoRing.length = 0; // her turn is over; the next one measures itself
      fitHer.length = 0; // and a gap in her audio is not a fit, it is a jump
      fitMic.length = 0;
      echoLocked = false;
    }
    // A NEW turn of hers must not inherit the last one's candidate. If she
    // starts speaking again inside one mic tick, the `!herSpeaking` branch
    // below never runs and hits from her previous turn stay in the window,
    // where they can complete a claim that no one is actually making.
    if (herTurnSeen !== herTurnGen) {
      herTurnSeen = herTurnGen;
      // The hit windows and the claim belong to the turn that just ended;
      // carrying them forward can complete a claim nobody is making. The HOLD
      // ring deliberately survives: if a person really is talking across her
      // turn boundary, that is their speech and it still has to reach the
      // server. It is released by the `!herSpeaking` branch below, or by the
      // dead-candidate drop, exactly as it would have been.
      hardHits.length = 0;
      softHits.length = 0;
      subLin.length = 0;
      claimPeak = 0;
      floorClaimSince = 0;
      floorLost = false;
    }
    if (!herSpeaking) {
      // Her turn is over: nothing left to arbitrate. But a still-live hold
      // must be RELEASED here, not dropped — the most common overlap in any
      // conversation is the turn transition, someone starting on her last
      // word, and there is nothing left to protect at that point. The ring is
      // only ever non-empty here if the candidate was still going (a dead one
      // is cleared mid-turn), so this costs nothing and saves the leading
      // syllables of the single most frequent overlap in the product.
      if (hold.length) {
        if (ws.bufferedAmount <= STALL_CEILING) for (const c of hold) sendPcm(c);
      }
      if (floorLost || hardHits.length || softHits.length || hold.length) {
        hardHits.length = 0;
        softHits.length = 0;
        subLin.length = 0;
        hold = [];
        claimPeak = 0;
      }
      floorLost = false;
      floorClaimSince = 0;
      floorReleasedAt = 0;
      // never fight a dissolve that is still running — it owns the gain
      if (ducked && !yieldTimer) {
        rampGain(1, UNDUCK_RAMP);
        ducked = 0;
      }
    }
    const holding = herSpeaking && !floorLost;
    let claim = false;
    if (holding) {
      for (let s = 0; s < SUBS; s++) {
        const v = sub[s];
        subIdx++;
        subLin.push(v);
        if (subLin.length > softWin + 1) subLin.shift();
        if (v > thrBAt[s]) hardHits.push(subIdx);
        // a soft hit must also out-shout her own leak, at this instant
        if (v > thrSAt[s] && v > echoAt[s]) softHits.push(subIdx);
        while (hardHits.length && subIdx - hardHits[0] > claimWin) hardHits.shift();
        while (softHits.length && subIdx - softHits[0] > softWin) softHits.shift();
      }
      // THE CANDIDATE'S OWN SPAN: from its oldest surviving hit to now. Every
      // sub-frame in there counts, above the bar or not — the sub-bar dips
      // inside a candidate ARE the syllabic envelope. Sub-frames BEFORE it are
      // room silence that is no part of the candidate and would inflate the
      // deviation into an automatic pass.
      const firstHit = hardHits.length
        ? softHits.length
          ? Math.min(hardHits[0], softHits[0])
          : hardHits[0]
        : softHits.length
          ? softHits[0]
          : 0;
      let span: number[] = [];
      if (firstHit) span = subLin.slice(Math.max(0, subLin.length - 1 - (subIdx - firstHit)));
      claimPeak = 0;
      for (const v of span) if (v > claimPeak) claimPeak = v;
      if (hardHits.length && !floorClaimSince) floorClaimSince = Date.now();
      // THE DUCK. She softens the moment something is plainly a voice, long
      // before it has earned anything — that is the hitch a person produces
      // on contact, and it is fully reversible.
      if (!ducked && hardHits.length >= duckNeed) {
        rampGain(DUCK_SOFT, DUCK_RAMP);
        ducked = 1;
      } else if (ducked === 1 && hardHits.length < Math.max(1, duckNeed >> 1)) {
        rampGain(1, UNDUCK_RAMP); // it was nothing — bring her back up NOW
        ducked = 0;
        floorClaimSince = 0;
      }
      // THE CLAIM. Long enough to be a sentence and not a continuer, loud
      // enough to be in this room and not on a screen across it, and varied
      // enough to be a mouth and not a motor.
      if (hardHits.length >= claimNeed || softHits.length >= softNeed) {
        // Ambience for the override. The trailing 3s percentile has not seen a
        // machine that started less than 3s ago — which is the entire window
        // in which the veto matters — so it is taken against the LOUDER of
        // that percentile and the candidate's own median, which a steady
        // source raises on its first half-second.
        let ambient = noiseFloor;
        let varied = true;
        if (span.length >= 6) {
          const srt = [...span].sort((a, b) => a - b);
          const med = srt[srt.length >> 1];
          if (med > ambient) ambient = med;
          if (claimPeak < ambient * STEADY_OVERRIDE_MULT) {
            let m = 0;
            const db = span.map((v) => 20 * Math.log10(Math.max(v, 1e-6)));
            for (const d of db) m += d;
            m /= db.length;
            let v2 = 0;
            for (const d of db) v2 += (d - m) * (d - m);
            varied = Math.sqrt(v2 / db.length) >= STEADY_DB;
          }
        }
        // Her own leak must not walk through the soft bar now that the bar no
        // longer rises with echo. The candidate's SUSTAINED level has to clear
        // the leak estimate: a second source in the room adds power on top of
        // the leak, while pure echo sits at it. The median is the right
        // statistic here — κ is RMS-derived, and comparing a PEAK against it
        // passes on the crest factor of her own voice alone. A HARD claim
        // clears this for free (thrB ≥ echoTerm already), so it bites only on
        // soft-only claims, which is where the risk was created.
        claim = varied;
      }
    }
    // WORDS ALWAYS GO. A chunk with the gate open is never dropped for
    // backpressure at any queue depth — only the stall backstop below can
    // stop it, and that means the socket is dead, not slow.
    //
    // A GATED chunk (no words in it) still sheds as soon as there is real
    // backlog: it costs nothing to lose and it is where the uplink is
    // actually recovered. The turn-ending pause is still untouchable (it is
    // what commits their turn) and the SILENCE_KEEP heartbeat still means the
    // stream never goes dark.
    const drop =
      !open &&
      buffered > SILENCE_CAP &&
      gatedRun > endpointChunks && // the turn-ending pause always goes
      gatedRun % SILENCE_KEEP !== 0; // and the stream never goes dark
    const ratio = e.inputBuffer.sampleRate / 16000;
    const outLen = Math.floor(input.length / ratio);
    if (claim) {
      // RELEASE. The whole ring goes out in one burst, oldest first, ahead of
      // the mic clock — the server then hears the sentence from its first
      // syllable, not from the moment we made up our mind. Measured: it
      // interrupts her ~230ms after the burst and transcribes the utterance in
      // full, held prefix included, with no double generation.
      //
      // The stall ceiling is checked ONCE, before the loop. A partial flush
      // would splice the middle out of the person's word and scramble the
      // turn's transcript — worse than not releasing at all.
      if (ws.bufferedAmount <= STALL_CEILING) {
        const before = ws.bufferedAmount;
        for (const c of hold) sendPcm(c);
        // credit exactly what this burst added, and only until it drains
        burstBytes = Math.max(0, ws.bufferedAmount - before);
        burstUntil = Date.now() + 2500;
      }
      hold = [];
      floorLost = true;
      floorReleasedAt = Date.now();
      rampGain(DUCK_CLAIM, DUCK_RAMP);
      ducked = 2;
      diag("call", "floor_release", {
        claimMs: floorClaimSince ? Date.now() - floorClaimSince : 0,
        ratioDb: Math.round(20 * Math.log10(Math.max(claimPeak, 1e-6) / Math.max(noiseFloor, 1e-6))),
        floorDb: Math.round(20 * Math.log10(Math.max(noiseFloor, 1e-6))),
        kappa: Math.round(kappa * 100) / 100,
        // What her own voice was expected to measure at the microphone when
        // this claim was allowed, and whether the echo model was locked. A
        // self-interruption and a real barge-in are indistinguishable in this
        // event without them: both are "someone cleared the bar".
        echoDb: Math.round(20 * Math.log10(Math.max(echoTerm, 1e-6))),
        lagMs: echoLag >= 0 ? echoLag * ECHO_LAG_STEP_MS : -1,
        soft: hardHits.length < claimNeed,
      });
    } else if (holding) {
      // HOLD. Real audio into the ring, digital silence onto the wire — which
      // is exactly what the server already receives for most of every call, so
      // its VAD state and its silence clock see nothing unusual. If the sound
      // dies out before it earns anything (a "haan", a door, a passing car),
      // the ring is dropped and she never knows it happened.
      // Only audio that OUT-SHOUTS her own leak may enter the ring. The gate
      // (thrL) carries no echo term, so on a leaky device the ring fills with
      // her own voice — and the ring has two exits, the burst release AND the
      // turn-end flush. The flush is unconditional by design (the turn
      // transition is the most common overlap there is), so without this test
      // her own echo is handed to the server as the user's turn at the end of
      // every turn she speaks. Observed on the real endpoint at −12 dB echo
      // return loss: her own words appearing in inputTranscription in 5 of 6
      // sessions, with no barge-in involved at all.
      let aboveEcho = false;
      for (let s = 0; s < SUBS; s++) if (sub[s] > admitEcho) aboveEcho = true;
      if (open && aboveEcho) {
        hold.push(toPcm(input, ratio, outLen));
        if (hold.length > HOLD_RING) hold.shift();
      } else if (gatedRun > hangChunks && hold.length) {
        hold = [];
        if (floorClaimSince) {
          diag("call", "floor_hold", {
            heldMs: Math.round(Date.now() - floorClaimSince),
            ratioDb: Math.round(
              20 * Math.log10(Math.max(claimPeak, 1e-6) / Math.max(noiseFloor, 1e-6)),
            ),
          });
          floorClaimSince = 0;
        }
      }
      prevPcm = null;
      wasOpen = open;
      if (!drop) sendPcm(new Int16Array(outLen));
      return;
    }
    // ── normal streaming: she is silent, or the floor is genuinely theirs ──
    const pcm = new Int16Array(outLen); // stays zeroed (silence) when gated
    if (open) {
      for (let i = 0; i < outLen; i++) {
        const s = input[Math.floor(i * ratio)];
        pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32767)));
      }
      if (!wasOpen && prevPcm) {
        // closed→open: replay the previous chunk first so the syllable that
        // OPENED the gate arrives whole. Unconditional now — `drop` is false
        // by construction whenever the gate is open.
        sendPcm(prevPcm);
      }
    } else {
      // keep a real-audio pre-roll ready even while closed
      prevPcm = toPcm(input, ratio, outLen);
    }
    wasOpen = open;
    if (open) prevPcm = null;
    if (!drop) sendPcm(pcm);
    // The server owes us an `interrupted` after a release. On this model
    // there is an acknowledged case where it never sends one (the user is
    // already speaking as her turn begins) and today that single message is
    // the only thing in this file that can stop her. The client made the
    // floor decision, so the client enforces it.
    if (floorReleasedAt && herSpeaking) {
      // TWO COMPLETELY DIFFERENT SITUATIONS, and conflating them is what made
      // her "stop all of a sudden" on his device. Measured on his own calls
      // (meera_diag, two sessions): 4 of 5 releases got no `interrupted` at
      // all, waited the full 1500ms, and were then hard-cut with a 130ms
      // guillotine. The one healthy release was interrupted at +150ms and
      // faded softly in 87ms.
      //
      // The reason the server said nothing is that there was nothing to say:
      // she had FINISHED GENERATING and we were playing out a buffered
      // sentence (median ~5s of unplayed lead). A completed turn cannot be
      // interrupted, so silence there is correct server behaviour, not a
      // failure — and treating it as failure is what chopped her mid-word.
      const genDone = !genInFlight;
      const waited = Date.now() - floorReleasedAt;
      if (waited > (genDone ? RELEASE_SETTLE_MS : RELEASE_WATCHDOG_MS)) {
        const overlapMs = floorClaimSince ? Date.now() - floorClaimSince : 0;
        let bufferedMs = 0;
        try {
          bufferedMs = Math.max(0, (playhead - outCtx.currentTime) * 1000);
        } catch {
          /* ctx closed */
        }
        floorReleasedAt = 0;
        // whether turnComplete had landed and how much of her voice was still
        // queued are the two facts that separate the two cases — log them so
        // the next call from his device proves this rather than infers it
        diag("call", "floor_watchdog", {
          afterMs: waited,
          genDone,
          bufferedMs: Math.round(bufferedMs),
          overlapMs,
          hard: !genDone && overlapMs > YIELD_HARD_AFTER_MS,
        });
        // A finished sentence is NEVER hard-cut: there is no runaway
        // generation to stop, only her own voice to land gracefully. That is
        // the boundary-seeking fade — she finishes the word, reaches the next
        // real gap between words, and trails off across it.
        yieldFloor(!genDone && overlapMs > YIELD_HARD_AFTER_MS);
      }
    }
  };
  };
  // ── uplink congestion, read from the TROUGHS of bufferedAmount ──
  // bufferedAmount is the browser's own count of bytes we handed the socket
  // that have not reached the network. Averaging it (an EMA) measures mostly
  // OUR OWN frame sawtooth: a 50KB frame every tier period gives a time
  // average near F²/2RT, so a perfectly healthy 2Mbps link reads "congested"
  // and the video tier oscillates for no reason. The MINIMUM across the last
  // TROUGH_RING mic ticks measures the link instead: if the socket drains a
  // frame before the next one is grabbed, the trough sits near 0 no matter
  // how big the bursts are; if it cannot, the troughs climb — and that is
  // congestion, by definition. Sampled ONLY on the mic clock (sendFrame must
  // never add a sample, or the signal becomes the sawtooth again).
  const troughRing = new Array<number>(TROUGH_RING).fill(0);
  let troughIdx = 0;
  let congestionLevel: 0 | 1 | 2 = 0;
  const noteBuffered = (buffered: number) => {
    troughRing[troughIdx] = buffered;
    troughIdx = (troughIdx + 1) % TROUGH_RING;
    let trough = troughRing[0];
    for (const v of troughRing) if (v < trough) trough = v;
    if (congestionLevel < 2 && trough > CONGEST_UP_2) congestionLevel = 2;
    else if (congestionLevel < 1 && trough > CONGEST_UP_1) congestionLevel = 1;
    else if (congestionLevel === 2 && trough < CONGEST_DOWN_2) congestionLevel = 1;
    else if (congestionLevel === 1 && trough < CONGEST_DOWN_1) congestionLevel = 0;
  };
  // pure sender: the sample and the shed decision both belong to the mic
  // tick, which is the only clock allowed to observe the socket.
  //
  // The one exception is the stall backstop, which lives HERE rather than in
  // the tick so that nothing — not a pre-roll replay, not a frame — can push
  // a dead socket past the ceiling. It is not a quality mechanism: on a link
  // that can carry the call it never fires, and when it does fire the call is
  // already gone. It only stops the queue turning into a nine-second delay
  // line that shouts stale speech at her when the socket wakes up.
  function sendPcm(pcm: Int16Array) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > STALL_CEILING) return;
    let bin = "";
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: { data: btoa(bin), mimeType: "audio/pcm;rate=16000" },
        },
      }),
    );
  }

  // ── downlink: 24k PCM chunks → gapless WebAudio playback ──
  const outCtx = new AudioContext();
  // every chunk passes this bus, so the presence UI reads HER real amplitude
  const outBus = outCtx.createGain();
  attachAnalyser("her", outCtx, outBus);
  outBus.connect(outCtx.destination);
  let playhead = 0;
  let liveSources: AudioBufferSourceNode[] = [];
  let speakingUntil = 0;
  // ── floor state shared with the uplink tick (which is built later) ──
  let floorLost = false; // a person has taken this turn from her
  let floorClaimSince = 0; // when the current candidate first looked like a voice
  let floorReleasedAt = 0; // when we burst the held audio at the server
  // Is the SERVER still generating this turn? True from her first audio chunk
  // until generationComplete/turnComplete. It is the difference between "stop
  // her, she is still being written" and "she is finished, we are just playing
  // it out" — only the first can be interrupted, and only the first may be cut.
  let genInFlight = false;
  // Bumped on every boundary of HER turns. The mic tick clears its candidate
  // when this moves, so a turn that starts again inside one 85ms tick — where
  // `herSpeaking` never reads false and the end-of-turn reset never runs —
  // cannot inherit the previous turn's hits.
  let herTurnGen = 0;
  // ── a deliberate release burst is not congestion ──
  // The floor release hands the socket the whole hold ring at once (up to 26
  // chunks ≈ 96KB of base64). bufferedAmount then reads far above VIDEO_GATE
  // (48_000) for as long as it takes to drain, so screen share goes blind for
  // ~2.2s after EVERY barge-in and the congestion trough pins at 2 for ~2s —
  // reporting a link problem that does not exist. This is the same argument
  // the trough estimator already makes about the frame sawtooth: our own
  // deliberate bursts are not evidence about the link. The burst is therefore
  // credited back out of the reading that the video gate and the trough see —
  // and ONLY those. The stall backstop still reads the raw counter, because a
  // genuinely dead socket must never be masked by a credit.
  let burstBytes = 0;
  let burstUntil = 0; // hard time bound: a credit can never outlive its drain
  // her own output, sampled as it is SCHEDULED — ground truth for echo
  let herLevels: { a: number; b: number; rms: number }[] = [];
  // The same audio at 20ms resolution, as POWER, stamped with the outCtx time
  // the frame is scheduled to END. herLevels answers "how loud is she around
  // now" (a max, so it can bound a peak without knowing the acoustic delay);
  // this answers "what exactly was she doing 140ms ago", which is what the
  // echo fit correlates against. Both come out of the one loop in playChunk.
  let herEnv: { t: number; p: number }[] = [];
  // times (in outCtx seconds) where her own audio has a real gap between
  // words. Yielding across one of these is the difference between trailing
  // off and being cut off mid-syllable.
  let boundaries: number[] = [];
  let discardTurn = false; // stragglers from a killed turn must not resurrect
  let discardAt = 0;
  let yieldTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * The ONE writer of outBus.gain. A duck and a dissolve scheduling on the
   * same AudioParam is how she snaps back to full volume in the middle of a
   * fade, so every ramp cancels what came before it.
   */
  const rampGain = (v: number, secs: number) => {
    try {
      const t = outCtx.currentTime;
      outBus.gain.cancelScheduledValues(t);
      outBus.gain.setValueAtTime(outBus.gain.value, t);
      outBus.gain.linearRampToValueAtTime(Math.max(0.0001, v), t + secs);
    } catch {
      /* ctx closed */
    }
  };
  /** What fraction of her voice is actually reaching the speaker right now. */
  const outGain = () => {
    try {
      return outBus.gain.value;
    } catch {
      return 1;
    }
  };
  /** Loudest thing she has actually put through the speaker in the last
   *  250ms. Taking a MAX over a lag window means we never have to measure the
   *  device's acoustic round trip — whatever the mic hears now, she played
   *  some of it within that window. */
  const herRecentRms = () => {
    let m = 0;
    try {
      const now = outCtx.currentTime;
      let w = 0;
      for (const s of herLevels) {
        if (s.b <= now - 0.25) continue;
        herLevels[w++] = s;
        if (s.a <= now && s.rms > m) m = s.rms;
      }
      herLevels.length = w;
    } catch {
      /* ctx closed */
    }
    return m;
  };
  // ── fixed jitter lead ──
  // 30ms, always. This used to be an adaptive cushion that GREW to 320ms on a
  // jittery downlink to hide stutter, and that is a bad trade for this
  // product: it buys smoothness by making her answer up to 290ms later, on
  // exactly the calls that already feel slow, and it stays inflated for ten
  // more utterances after the jitter has passed. The whole point of this lane
  // is that she comes back fast; a scheduler that quietly adds a third of a
  // second is working against it.
  //
  // What we give up is stated plainly: on a genuinely jittery downlink her
  // voice will now STUTTER — a short gap mid-word when a chunk arrives after
  // the previous one has finished playing — instead of arriving late but
  // smooth. That is the deliberate call. Everything else about the scheduler
  // is unchanged: the playhead still anchors chunks back-to-back, so audio is
  // still gapless whenever the network delivers on time.
  const LEAD = 0.03;
  // ── the listening sound ──
  // A closed-mouth "mm": a nasal murmur is one of the few speech sounds with
  // no consonant edge and almost no formant structure — a fundamental in her
  // register, two fast-decaying harmonics, a small downward glide and a soft
  // attack. It is generated here rather than fetched so that it costs no
  // network on the call path and cannot arrive late; the price is that WHETHER
  // IT SOUNDS LIKE HER IS THE ONE THING IN THIS FILE THAT HAS NOT BEEN
  // MEASURED. Everything below is measured; the timbre needs a human ear.
  let lastAckAt = 0;
  let ackNode: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  const makeMurmur = () => {
    const sr = 24000;
    const n = Math.round(sr * ACK_SECS);
    const buf = outCtx.createBuffer(1, n, sr);
    const ch = buf.getChannelData(0);
    const f0 = 194 + Math.random() * 26;
    const fall = 0.87 + Math.random() * 0.06; // "mm" falls; "hm?" would rise
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      ph += (2 * Math.PI * (f0 * (1 + (fall - 1) * u))) / sr;
      const s = Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.09 * Math.sin(3 * ph);
      // no plosive onset, a long release: an unhurried, non-committal sound
      const env = Math.min(1, u / 0.14) * Math.min(1, (1 - u) / 0.34);
      const wobble = 1 + 0.05 * Math.sin(2 * Math.PI * 4.6 * u * ACK_SECS);
      ch[i] = (s / 1.39) * env * wobble * ACK_PEAK;
    }
    return buf;
  };
  /** Trail the hum off — she is starting a word, not being cut off. */
  const fadeAck = () => {
    if (!ackNode) return;
    const { src, g } = ackNode;
    ackNode = null;
    try {
      const t = outCtx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(0.0001, t + ACK_FADE);
      src.stop(t + ACK_FADE + 0.02);
    } catch {
      /* ctx closed */
    }
  };
  /**
   * "I'm here" in the gap after they stop, before her answer exists.
   *
   * Three invariants, in the order they matter:
   *  1. `playhead` is not touched, so her first word is not delayed by a
   *     single sample. The murmur is a parallel source; if her audio lands on
   *     top of it, the murmur fades and she does not wait.
   *  2. It is REGISTERED with the echo apparatus — speakingUntil, herLevels,
   *     herEnv — before it is audible. That is what makes the arbiter hold the
   *     microphone across it and across its reverb tail, so not one sample of
   *     it is uplinked as if the user had made it. An unregistered clip played
   *     through any other AudioContext is the failure measured in exp11.
   *  3. It does NOT push `boundaries`. Those are the places her SENTENCE may
   *     be faded across; a hum has no words to land between.
   */
  const emitAck = () => {
    if (dead) return;
    const now = Date.now();
    if (now - lastAckAt < ACK_MIN_GAP_MS) return;
    try {
      const t0 = outCtx.currentTime;
      const buf = makeMurmur();
      const at = t0 + LEAD;
      const src = outCtx.createBufferSource();
      src.buffer = buf;
      const g = outCtx.createGain();
      src.connect(g);
      g.connect(outBus); // through her own bus: the presence UI and the duck
      src.start(at);
      const node = { src, g };
      ackNode = node;
      src.onended = () => {
        if (ackNode === node) ackNode = null;
        try {
          g.disconnect();
        } catch {
          /* already gone */
        }
      };
      // the same two readings playChunk takes off her real audio, so the echo
      // prediction and the coupling estimate see this exactly as they see her
      let peak20 = 0;
      const ch = buf.getChannelData(0);
      const fr = 480;
      for (let f = 0; f + fr <= buf.length; f += fr) {
        let a2 = 0;
        for (let i = f; i < f + fr; i++) a2 += ch[i] * ch[i];
        herEnv.push({ t: at + (f + fr) / 24000, p: a2 / fr });
        const r20 = Math.sqrt(a2 / fr);
        if (r20 > peak20) peak20 = r20;
      }
      herLevels.push({ a: at, b: at + buf.duration, rms: peak20 });
      // The guard is the whole point: `herSpeaking` has to outlive the sound
      // by its own reverb, or the tail is streamed to the server as the user.
      speakingUntil = Math.max(
        speakingUntil,
        now + LEAD * 1000 + buf.duration * 1000 + ACK_TAIL_GUARD_MS,
      );
      lastAckAt = now;
      opts.onState("speaking");
      diag("call", "ack_emitted", { afterUserMs: Math.round(ACK_SECS * 1000) });
    } catch {
      /* ctx closed — silence is the correct failure here */
    }
  };
  const playChunk = (b64: string) => {
    // a turn that was yielded is over: anything still arriving for it is a
    // straggler and must not resurrect her. The cap is a safety net so a
    // missing turnComplete can never mute her for the rest of the call.
    if (discardTurn) {
      if (Date.now() - discardAt < DISCARD_CAP_MS) return;
      discardTurn = false;
    }
    const raw = atob(b64);
    const n = raw.length / 2;
    if (!n) return;
    // her real voice has arrived: the hum gives way to it, under her first
    // word rather than in front of it. Nothing here moves `playhead`.
    fadeAck();
    const buf = outCtx.createBuffer(1, n, 24000);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const lo = raw.charCodeAt(i * 2);
      const hi = raw.charCodeAt(i * 2 + 1);
      let v = (hi << 8) | lo;
      if (v >= 32768) v -= 65536;
      ch[i] = v / 32768;
    }
    const s = outCtx.createBufferSource();
    s.buffer = buf;
    s.connect(outBus);
    const now = outCtx.currentTime;
    // The playhead still anchors this chunk to the end of the last one, so a
    // stream that arrives on time plays gapless. If it arrived late the
    // playhead is already behind `now` and this chunk simply starts as soon
    // as it can — late, audibly, and without dragging every later reply.
    const at = Math.max(now + LEAD, playhead);
    s.start(at);
    // Two things are read off this chunk while we are already walking its
    // samples, both free: how loud she is (the echo reference) and where her
    // words stop touching each other (the only safe places to fade out).
    let acc = 0;
    let peak20 = 0; // loudest 20ms block in this chunk — see herLevels below
    let lastB = boundaries.length ? boundaries[boundaries.length - 1] : 0;
    const fr = 480; // 20ms at 24kHz
    for (let f = 0; f + fr <= n; f += fr) {
      let a2 = 0;
      for (let i = f; i < f + fr; i++) a2 += ch[i] * ch[i];
      acc += a2;
      const r20 = Math.sqrt(a2 / fr);
      if (r20 > peak20) peak20 = r20;
      herEnv.push({ t: at + (f + fr) / 24000, p: a2 / fr });
      if (Math.sqrt(a2 / fr) < BOUNDARY_RMS) {
        const tB = at + (f + fr) / 24000;
        if (tB - lastB >= BOUNDARY_MIN_GAP) {
          boundaries.push(tB);
          lastB = tB;
        }
      }
    }
    if (boundaries.length > 128) boundaries.splice(0, boundaries.length - 128);
    {
      const cut = now - ECHO_ENV_KEEP_S; // `now` is outCtx.currentTime: the playhead
      let d = 0;
      while (d < herEnv.length && herEnv[d].t < cut) d++;
      if (herEnv.length - d > ECHO_ENV_CAP) d = herEnv.length - ECHO_ENV_CAP;
      if (d) herEnv.splice(0, d);
    }
    // Her level is stored as the LOUDEST 20ms BLOCK, not the chunk's RMS.
    // The echo term bounds a 21.3ms MIC sub-frame, and a chunk-wide RMS is a
    // different statistic: speech crest over 20ms against an 80ms average is
    // routinely 2-3×, so a bar built from the average sits BELOW the echo it
    // is supposed to reject and her own voice clears it — measured, on the
    // real endpoint, as her taking the floor from herself in every session at
    // −12 dB echo return loss. Same time resolution on both sides, or the
    // comparison means nothing.
    herLevels.push({ a: at, b: at + buf.duration, rms: peak20 || Math.sqrt(acc / Math.max(1, n)) });
    playhead = at + buf.duration;
    speakingUntil = Math.max(speakingUntil, Date.now() + (playhead - outCtx.currentTime) * 1000);
    liveSources.push(s);
    s.onended = () => {
      liveSources = liveSources.filter((x) => x !== s);
    };
    opts.onState("speaking");
  };
  /**
   * Give up the floor — the human way, not the switch way.
   *
   * When `interrupted` lands, the client is holding a median of five seconds
   * of her finished voice that the server will never resend. Throwing all of
   * it away and ramping to silence in 220ms is a machine stopping; a person
   * finishes the word they are on, lands on the next gap between words, and
   * fades across it. So we look ahead in her own audio for a real boundary
   * inside the next 450ms and dissolve to that. If the overlap has already
   * run long enough to be unambiguous, we skip the courtesy and get out of
   * the way in 130ms instead.
   */
  const yieldFloor = (hard: boolean) => {
    if (yieldTimer) return; // already on our way out
    // the dissolve clears herLevels/herEnv, which are what protect the hum's
    // leak — so the hum goes out with the same gesture rather than outliving
    // the registration that covers it
    fadeAck();
    let now = 0;
    try {
      now = outCtx.currentTime;
    } catch {
      /* ctx closed */
    }
    let stopAt = now + (hard ? YIELD_HARD : YIELD_DEFAULT);
    if (!hard) {
      const b = boundaries.find((t) => t > now + 0.06 && t <= now + YIELD_MAX);
      if (b) stopAt = b;
    }
    // never promise more audio than actually exists
    stopAt = playhead > now + 0.02 ? Math.min(stopAt, playhead) : now + 0.02;
    const doomed = liveSources;
    liveSources = [];
    discardTurn = true;
    discardAt = Date.now();
    boundaries = [];
    herLevels = [];
    herEnv = []; // the audio these describe is being thrown away
    const fadeMs = Math.max(0, stopAt - now) * 1000;
    speakingUntil = Date.now() + fadeMs;
    playhead = stopAt;
    try {
      const t = outCtx.currentTime;
      outBus.gain.cancelScheduledValues(t);
      outBus.gain.setValueAtTime(outBus.gain.value, t);
      outBus.gain.linearRampToValueAtTime(0.0001, stopAt);
    } catch {
      /* ctx closed */
    }
    yieldTimer = setTimeout(() => {
      yieldTimer = null;
      for (const s of doomed) {
        try {
          s.stop();
        } catch {
          /* already done */
        }
      }
      try {
        const t2 = outCtx.currentTime;
        outBus.gain.cancelScheduledValues(t2);
        outBus.gain.setValueAtTime(1, t2); // ready for her next turn
      } catch {
        /* ctx closed */
      }
      if (!liveSources.length) playhead = 0;
      speakingUntil = 0;
      opts.onState("listening");
    }, fadeMs + 30);
    // genDone rides along so a single event proves which case this was: a
    // hard cut is only ever legitimate while the server is still generating
    diag("call", "floor_yield", { hard, fadeMs: Math.round(fadeMs), genDone: !genInFlight });
  };
  // she's "listening" again once the queued audio drains
  const stateTick = setInterval(() => {
    if (dead) return;
    if (speakingUntil && Date.now() > speakingUntil) {
      speakingUntil = 0;
      opts.onState("listening");
    }
  }, 250);

  // ── transcripts: accumulate per turn, flush on turnComplete ──
  let myBuf = "";
  let herBuf = "";
  const flushTexts = () => {
    if (myBuf.trim()) opts.onMyText(myBuf.trim());
    if (herBuf.trim()) opts.onHerText(herBuf.trim());
    myBuf = "";
    herBuf = "";
  };

  const teardown = (reason: "failed" | "closed") => {
    if (dead) return;
    dead = true;
    clearInterval(stateTick);
    if (yieldTimer) clearTimeout(yieldTimer);
    yieldTimer = null;
    flushTexts();
    try {
      proc?.disconnect();
      src?.disconnect();
    } catch {
      /* already gone */
    }
    // the uplink may not exist yet: teardown can fire while getUserMedia is
    // still open, and a stream that lands after that is stopped on arrival
    stream?.getTracks().forEach((t) => t.stop());
    detachAnalyser("her");
    detachAnalyser("you");
    inCtx?.close().catch(() => {});
    outCtx.close().catch(() => {});
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    ws = null;
    // pre-setup failures surface as the startLiveCall rejection — notifying
    // onEnded too would make the caller run its mid-call takeover logic for
    // a session it never adopted
    if (ready) opts.onEnded(reason);
  };

  const opened = new Promise<void>((resolve, reject) => {
    if (!ws) return reject(new Error("no ws"));
    const failTimer = setTimeout(() => reject(new Error("live setup timeout")), 10_000);
    ws.onopen = () => {
      wsOpenMs = Date.now() - tPar;
      tSetupSent = Date.now();
      ws!.send(
        JSON.stringify({
          setup: {
            model,
            generationConfig: {
              responseModalities: ["AUDIO"],
              // she must SPEAK, not deliberate — thinking added seconds of
              // dead air before every reply (measured 3-5.5s vs ~0.9s)
              thinkingConfig: { thinkingBudget: 0 },
              // HOW HER VOICE GETS ITS PERSONALITY, and where it does NOT
              // come from. There is no expressiveness knob here to turn: the
              // native-audio model speaks the characters she emits, so her
              // stretched vowels, "..." pauses and written-out laughter ARE
              // the prosody. That lives in the spoken register in persona.ts;
              // this block only picks the timbre.
              //
              // Measured and rejected, so nobody re-chases them:
              //   enableAffectiveDialog  NOT A FIELD on v1alpha
              //     BidiGenerateContent — the server closes 1007 "Unknown name
              //     enableAffectiveDialog at 'setup': Cannot find field". It
              //     is not a model limitation and no spelling of it works here.
              //   dropping languageCode  no consistent prosodic gain (A/B,
              //     n=5 each, identical prompt: pitch range 21.2 vs 25.2 st,
              //     pauses 23.2/min vs 10.9/min — the two measures move in
              //     OPPOSITE directions, which at this n is noise, not a
              //     result), and unpinning it gives up the hi-IN phoneme
              //     handling her Hinglish depends on. Keep it pinned.
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
                languageCode: "hi-IN",
              },
            },
            systemInstruction: { parts: [{ text: opts.system }] },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                // NOTHING IS SET FOR START-OF-SPEECH ON PURPOSE, and nothing
                // should be. startOfSpeechSensitivity was tested head to head
                // on this model, 14 sessions, one stimulus each: LOW and HIGH
                // are behaviourally identical — full-level speech interrupts
                // in 123-136ms at both, a 0.12-gain "distant TV" in 203-216ms
                // at both, a 0.45s "haan" in 199-211ms at both, and broadband
                // noise interrupts at neither. It is a no-op for barge-in.
                // Deciding what deserves to stop her is done in the uplink,
                // above, where the client can actually see the room.
                //
                // activityHandling: NO_INTERRUPTION is likewise NOT set. It
                // really does stop barge-in — and it makes her deaf for the
                // whole turn including the seconds of audio delivery after
                // generation ends (measured: ~16s of deafness on a ~9s reply,
                // the barge-in never transcribed and never answered). That
                // trades "she stops when I speak" for "she talks over me and
                // ignores me", which is worse. turnCoverage is not set either:
                // TURN_INCLUDES_ALL_INPUT does not rescue audio and short
                // windows make the server ASR invent whole Hindi sentences
                // out of room noise for her to answer.
                //
                // end HIGH: commit their turn from the SPEECH being complete,
                // not from the room going quiet — background noise was making
                // her wait forever ("how are you?" ...silence... while traffic
                // hums). If she ever jumps in early, they just talk over her —
                // human conversation self-corrects in that direction.
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                // the client gate already spends ~250ms of hangover after the
                // words stop; the server silence budget comes down to match so
                // total commit stays ~550ms
                silenceDurationMs: 300,
                prefixPaddingMs: 60,
              },
            },
            contextWindowCompression: { slidingWindow: {} },
          },
        }),
      );
    };
    ws.onmessage = async (ev) => {
      let text: string;
      if (typeof ev.data === "string") text = ev.data;
      else if (ev.data instanceof Blob) text = await ev.data.text();
      else text = new TextDecoder().decode(ev.data as ArrayBuffer);
      let msg: any;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (msg.setupComplete) {
        ready = true;
        clearTimeout(failTimer);
        setupMs = Date.now() - tSetupSent;
        const readyMs = Date.now() - tMint;
        // The two legs ran together, so the connect cost is the SLOWER of
        // them, not the sum. overlapMs is what that parallelism actually
        // saved on this device — the old serialized path would have taken
        // roughly readyMs + overlapMs.
        const socketLeg = wsOpenMs + setupMs;
        const overlapMs = Math.max(0, Math.min(micMs, socketLeg));
        const timing = { readyMs, micMs, wsOpenMs, setupMs, overlapMs };
        opts.onTiming?.(timing);
        diag("call", "live_connect", { ...timing, mintMs, preminted: !!warmed });
        resolve();
        opts.onState("listening");
        return;
      }
      const sc = msg.serverContent;
      if (!sc) return;
      if (sc.interrupted) {
        // The server has already stopped generating and everything it will
        // ever send for this turn is in our buffer. Whether that ends as a
        // trail-off or a clean break depends on how long the overlap has
        // been running: a hesitation gets the phrase boundary, someone who
        // has plainly been talking for most of a second gets out of the way.
        const overlapMs = floorClaimSince ? Date.now() - floorClaimSince : 0;
        // same fields as floor_watchdog so the two paths are directly
        // comparable in the diag trail: this is the HEALTHY case (server
        // answered, soft fade) and it must stay the common one
        diag("call", "floor_interrupted", {
          afterMs: floorReleasedAt ? Date.now() - floorReleasedAt : 0,
          genDone: !genInFlight,
          overlapMs,
          hard: overlapMs > YIELD_HARD_AFTER_MS,
        });
        // `genInFlight &&` is the same principle as the watchdog: a hard cut
        // is only ever legitimate while there is live generation to stop. On
        // his device this path also fired a 130ms guillotine once (t=68455,
        // overlap 852ms) — if generation had already closed there, nothing
        // was being stopped and the fade should have been graceful. When the
        // server really did interrupt a live turn this is unchanged, which
        // keeps the healthy +150ms/87ms case exactly as it is.
        yieldFloor(genInFlight && overlapMs > YIELD_HARD_AFTER_MS);
        floorReleasedAt = 0; // the server answered; the watchdog stands down
        herTurnGen++; // this turn of hers is over, whatever follows is a new one
      }
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data) {
          genInFlight = true; // a turn is being generated: it CAN be interrupted
          playChunk(p.inlineData.data);
        }
      }
      if (sc.inputTranscription?.text) myBuf += sc.inputTranscription.text;
      if (sc.outputTranscription?.text) herBuf += sc.outputTranscription.text;
      // The server has stopped producing. Everything still to come out of the
      // speakers is already in our buffer, so from here there is nothing left
      // for an `interrupted` to stop — and none will ever arrive.
      if (sc.generationComplete) genInFlight = false;
      if (sc.turnComplete) {
        genInFlight = false;
        discardTurn = false; // the killed turn is closed; the next one may play
        herTurnGen++; // and the arbiter's candidate does not cross the boundary
        flushTexts();
      }
    };
    ws.onerror = () => {
      clearTimeout(failTimer);
      reject(new Error("live ws error"));
    };
    ws.onclose = () => {
      clearTimeout(failTimer);
      if (!ready) reject(new Error("live ws closed early"));
      else teardown("closed");
    };
  });

  opened.catch(() => {}); // the mic leg may reject first; never go unhandled
  // a stream that arrives after we've already given up must not stay live
  micP
    .then((s) => {
      if (dead) s.getTracks().forEach((t) => t.stop());
    })
    .catch(() => {});

  // ── join the two legs ──
  // The mic is awaited first only because the uplink graph needs it; the
  // socket has been handshaking underneath this whole time, so this await
  // costs max(mic, socket) rather than mic + socket.
  try {
    buildUplink(await micP);
  } catch (e) {
    teardown("failed");
    throw e instanceof Error ? e : new Error("mic unavailable");
  }
  // outCtx is now built BEFORE the mic is granted rather than after, so on a
  // platform that starts a context suspended outside a user gesture it could
  // sit silent. Granting the mic is the moment audio is unambiguously
  // allowed — nudge it then. A no-op on a context that is already running.
  outCtx.resume().catch(() => {});

  try {
    await opened;
  } catch (e) {
    teardown("failed");
    throw e;
  }

  return {
    stop: () => teardown("closed"),
    setMuted: (m: boolean) => {
      muted = m;
    },
    direct: (contextNote: string) => {
      // A clientContent turn with turnComplete:true is a hard turn commit: it
      // sets `interrupted` and guillotines her mid-word. Most callers of this
      // are screen-share wake-ups ("look at what just happened"), which is a
      // machine cutting her off inside a feature whose whole premise is
      // sitting next to someone. So while she is audibly speaking the note
      // waits for her to finish — capped, because a comment about a frame
      // that is two seconds gone is worse than no comment.
      const send = () => {
        if (dead || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            clientContent: {
              turns: [{ role: "user", parts: [{ text: contextNote }] }],
              turnComplete: true,
            },
          }),
        );
      };
      const wait = Math.min(1200, speakingUntil - Date.now());
      if (wait > 40) setTimeout(send, wait);
      else send();
    },
    sendFrame: (b64Jpeg: string) => {
      if (dead || !ready || !ws || ws.readyState !== WebSocket.OPEN) return false;
      // NOT sampled into the congestion signal: the reading we would take
      // here is the sawtooth we ourselves are about to create.
      //
      // A frame is no longer refused for backlog. It used to need a
      // near-drained socket, which meant that on the exact link where screen
      // share matters she stopped receiving frames, went blind, and then went
      // quiet — and being blind reads as lag just as much as being slow does.
      // Only two things can refuse a frame now: a pathological encode, and
      // the stall backstop (a socket that has taken nothing for ~9s).
      if (b64Jpeg.length > FRAME_MAX_B64) return false; // pathological encode
      // VIDEO YIELDS TO HER EARS. Not degradation — frames are never shrunk,
      // slowed or cheapened, they just don't enter a socket that still owes
      // her the words being spoken into it. Audio and video share ONE
      // bufferedAmount, so without this a ~50KB frame (≈16 mic ticks) races
      // the microphone toward the same backstop; with sharing on the offer is
      // ~143KB/s and the queue can pin at the ceiling, at which point the
      // thing being shed is her HEARING. A skipped frame is retried 600ms
      // later and can never wake her; a lost syllable is answered wrong.
      //
      // The reading is credited for a deliberate release burst still draining
      // (see burstBytes): the gate's job is to keep video out of a socket that
      // is behind on HER audio, and a barge-in burst is audio we have already
      // chosen to send, not a link that cannot keep up. Without the credit
      // every single barge-in blinded the screen share for ~2.2s.
      if (Math.max(0, ws.bufferedAmount - burstBytes) > VIDEO_GATE) return false;
      if (ws.bufferedAmount > STALL_CEILING) return false; // socket is dead, not slow
      ws.send(
        JSON.stringify({
          realtimeInput: { video: { data: b64Jpeg, mimeType: "image/jpeg" } },
        }),
      );
      return true;
    },
    congestion: () => congestionLevel,
    active: () => !dead,
  };
}
