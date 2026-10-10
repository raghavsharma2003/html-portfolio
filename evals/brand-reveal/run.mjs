import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BRAND_REVEAL_DURATION_MS,
  BRAND_REVEAL_MUTE_KEY,
  BRAND_REVEAL_SCORE,
  createBrandRevealSoundSession,
  persistBrandRevealMuted,
  readBrandRevealMuted,
  shouldPlayBrandRevealSound,
} from "../../src/studio/brandRevealSound.ts";

class FakeParam {
  value = 1;
  events = [];
  setValueAtTime(value, at) { this.value = value; this.events.push(["set", value, at]); }
  exponentialRampToValueAtTime(value, at) { this.value = value; this.events.push(["ramp", value, at]); }
  cancelScheduledValues(at) { this.events.push(["cancel", at]); }
}

class FakeNode {
  disconnected = 0;
  connect(next) { this.next = next; return next; }
  disconnect() { this.disconnected += 1; }
}

class FakeGain extends FakeNode { gain = new FakeParam(); }

class FakeOscillator extends FakeNode {
  frequency = new FakeParam();
  type = "sine";
  starts = [];
  stops = [];
  start(at) { this.starts.push(at); }
  stop(at) { this.stops.push(at); }
}

class FakeAudioContext {
  currentTime = 10;
  state = "suspended";
  destination = new FakeNode();
  gains = [];
  oscillators = [];
  resumeCount = 0;
  closeCount = 0;
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createOscillator() { const node = new FakeOscillator(); this.oscillators.push(node); return node; }
  async resume() { this.resumeCount += 1; this.state = "running"; }
  async close() { this.closeCount += 1; this.state = "closed"; }
}

const storageValues = new Map();
const storage = {
  getItem(key) { return storageValues.get(key) ?? null; },
  setItem(key, value) { storageValues.set(key, value); },
};

assert.equal(BRAND_REVEAL_DURATION_MS, 420);
assert.ok(BRAND_REVEAL_DURATION_MS >= 300 && BRAND_REVEAL_DURATION_MS <= 500);
assert.equal(BRAND_REVEAL_SCORE.length, 3);
assert.ok(BRAND_REVEAL_SCORE.every((note) => note.offsetMs + note.durationMs <= BRAND_REVEAL_DURATION_MS));
assert.equal(shouldPlayBrandRevealSound({ muted: false, reduceMotion: false }), true);
assert.equal(shouldPlayBrandRevealSound({ muted: true, reduceMotion: false }), false);
assert.equal(shouldPlayBrandRevealSound({ muted: false, reduceMotion: true }), false);

assert.equal(readBrandRevealMuted(storage), false);
persistBrandRevealMuted(true, storage);
assert.equal(storageValues.get(BRAND_REVEAL_MUTE_KEY), "1");
assert.equal(readBrandRevealMuted(storage), true);
persistBrandRevealMuted(false, storage);
assert.equal(readBrandRevealMuted(storage), false);

let contextCalls = 0;
assert.equal(createBrandRevealSoundSession({ muted: true, reduceMotion: false, contextFactory: () => { contextCalls += 1; return new FakeAudioContext(); } }), null);
assert.equal(createBrandRevealSoundSession({ muted: false, reduceMotion: true, contextFactory: () => { contextCalls += 1; return new FakeAudioContext(); } }), null);
assert.equal(contextCalls, 0, "muted and reduced-motion paths must not create Web Audio");

const context = new FakeAudioContext();
const session = createBrandRevealSoundSession({ muted: false, reduceMotion: false, contextFactory: () => { contextCalls += 1; return context; } });
assert.ok(session);
assert.equal(contextCalls, 1);
assert.equal(context.resumeCount, 1);
assert.equal(session.play(), true);
assert.equal(session.play(), false, "one reveal cannot schedule twice");
assert.equal(context.oscillators.length, BRAND_REVEAL_SCORE.length);
const scheduledSeconds = Math.max(...context.oscillators.flatMap((node) => node.stops)) - Math.min(...context.oscillators.flatMap((node) => node.starts));
assert.ok(Math.abs(scheduledSeconds - BRAND_REVEAL_DURATION_MS / 1000) < Number.EPSILON * 8);
session.stop();
session.stop();
await Promise.resolve();
assert.equal(context.closeCount, 1, "cleanup must be idempotent");
assert.ok(context.oscillators.every((node) => node.disconnected === 1));

assert.equal(createBrandRevealSoundSession({ muted: false, reduceMotion: false, contextFactory: () => null }), null, "missing Web Audio must be a no-op");

const componentSource = readFileSync(fileURLToPath(new URL("../../src/studio/CloneExperience.tsx", import.meta.url)), "utf8");
const agreeHandler = componentSource.slice(componentSource.indexOf("async function continueAgreement()"), componentSource.indexOf("const submitRecording"));
assert.doesNotMatch(componentSource, /from "\.\/brandRevealSound"/u, "the consent path must not load the retired reveal sound");
assert.doesNotMatch(componentSource, /function BrandReveal|key="reveal"|REVEAL_KEY/u, "the persisted agreement must not open a blocking reveal scene");
assert.doesNotMatch(agreeHandler, /sessionStorage|setTimeout|setReveal|createBrandRevealSoundSession/u);
assert.ok(agreeHandler.indexOf('setEnrichView("files")') > agreeHandler.indexOf("await onBeginClone"));
assert.ok(agreeHandler.indexOf('setRoom("enrich")') > agreeHandler.indexOf("await onBeginClone"));

const soundSource = readFileSync(fileURLToPath(new URL("../../src/studio/brandRevealSound.ts", import.meta.url)), "utf8");
assert.doesNotMatch(soundSource, /\bfetch\s*\(|new Audio\s*\(|setTimeout\s*\(/u, "the sonic mark cannot fetch an asset or retry later");

console.log("post-consent entry and retired brand reveal: deterministic checks passed");
