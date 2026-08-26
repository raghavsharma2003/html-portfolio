// WS-V. earbench — the blind listening bench's MECHANICAL self-check.
//
// This suite does not listen to anything and it produces no bench result. It
// checks that the instrument is an instrument: that the blinding blinds, that
// the counterbalance balances, that the disclosure trim finds the pause it is
// supposed to find and refuses when there is none, that the local server cannot
// serve the answer key, and that the scorer tells "reliably distinguishable"
// from "indistinguishable from chance" from "under-powered" — three verdicts,
// not two, because collapsing the last two into "no significant difference" is
// exactly how a bench licenses a claim it never earned.
//
// Wired into evals/run.mjs (and therefore into verify-release's eval-suite
// gate) because it is offline, deterministic, $0, no network beyond loopback,
// no GPU — and because `dead-writers` applies hardest to a bench: an
// unblinding bug is silent, and the only thing that can see it is a test.
//
// It is NOT a gate on human input. Nothing in here waits for a person. The
// listening pass itself is deliberately unwired from CI: a gate that needs
// somebody to put headphones on would wedge every build until they did.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_POLICY, RATING_AXES, abxVerdict, binomialTwoSidedP, binomialOneSidedP, wilson,
  blindId, buildAbxTrials, buildRatingTrials, counterbalanceReport, listenerView,
  scoreBench, renderReport, summariseNumbers, trialsNeededForEquivalence, rng,
} from "./lib.mjs";
import {
  SAMPLE_RATE, wrapWav, wavPcm, toPcm, samples, normalise, rms, findDisclosureCut, treat,
  transcriptCarriesDisclosure,
} from "./audio.mjs";
import { serveBench } from "./server.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}
function near(name, actual, expected, tolerance) {
  ok(`${name} (${actual} ~= ${expected})`, Math.abs(actual - expected) <= tolerance);
}

// ══════════════════════════════════════════════════════════════════════════
// 1. statistics — checked against values that can be computed by hand
// ══════════════════════════════════════════════════════════════════════════
near("binomial p(10/10) = 2/1024", binomialTwoSidedP(10, 10), 2 / 1024, 1e-12);
near("binomial p(5/10) = 1", binomialTwoSidedP(5, 10), 1, 1e-12);
near("one-sided p(6/6) = 1/64", binomialOneSidedP(6, 6), 1 / 64, 1e-12);
near("one-sided p(0/6) = 1", binomialOneSidedP(0, 6), 1, 1e-12);
const w = wilson(8, 10);
ok("wilson interval brackets the point estimate", w.low < 0.8 && w.high > 0.8 && w.low > 0 && w.high < 1);
ok("wilson at n=0 is the whole line, not NaN", wilson(0, 0).low === 0 && wilson(0, 0).high === 1);

// The three verdicts, and the boundary between them.
const strong = abxVerdict(20, 20);
ok("20/20 is reliably distinguishable", strong.verdict === "distinguishable");
const chance = abxVerdict(50, 100);
ok("50/100 is indistinguishable from chance", chance.verdict === "indistinguishable");
const thin = abxVerdict(3, 6);
ok("3/6 is INCONCLUSIVE, not 'no difference'", thin.verdict === "inconclusive");
ok("an inconclusive verdict says how many trials would settle it", thin.trialsForEquivalence > 6);
ok("no answers at all is its own verdict", abxVerdict(0, 0).verdict === "no-data");
// The property that matters most: at chance rate, more trials must eventually
// convert INCONCLUSIVE into INDISTINGUISHABLE, and never into DISTINGUISHABLE.
const ladder = [8, 16, 32, 64, 128].map((n) => abxVerdict(Math.round(n / 2), n).verdict);
ok("power ladder never invents a difference at chance rate", !ladder.includes("distinguishable"));
ok("power ladder does reach equivalence with enough trials", ladder.at(-1) === "indistinguishable");
ok("a perfect score at tiny n is not yet significant", abxVerdict(4, 4).verdict !== "distinguishable");
near("trialsNeededForEquivalence at chance is finite", trialsNeededForEquivalence(0.5) > 0 ? 1 : 0, 1, 0);

const summary = summariseNumbers([4, 5, 3, 4]);
near("mean of a rating column", summary.mean, 4, 1e-12);
ok("n=1 carries no interval rather than a fake one", summariseNumbers([4]).ci === null);
ok("a t interval at n=3 is wider than the normal one", summariseNumbers([1, 3, 5]).ci[1] - summariseNumbers([1, 3, 5]).ci[0] > 2 * 1.96 * (2 / Math.sqrt(3)));

// ══════════════════════════════════════════════════════════════════════════
// 2. the design — blinding and counterbalance
// ══════════════════════════════════════════════════════════════════════════
const arms = ["real", "clone-full", "clone-short"];
const items = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8"];
const runSecret = "a".repeat(64);
const stimuli = arms.flatMap((arm) => items.map((itemId) => ({ id: blindId(runSecret, arm, itemId), arm, itemId })));
ok("every stimulus id is distinct", new Set(stimuli.map((s) => s.id)).size === stimuli.length);
ok("a stimulus id is opaque hex", stimuli.every((s) => /^[0-9a-f]{16}$/.test(s.id)));
ok("no stimulus id contains its arm or item", stimuli.every((s) => !s.id.includes(s.arm) && !s.id.includes(s.itemId)));
ok("a different run secret gives different ids", blindId("b".repeat(64), "real", "i1") !== blindId(runSecret, "real", "i1"));

const abx = buildAbxTrials({ stimuli, arms, items, runSecret, seed: 12345 });
const balance = counterbalanceReport(abx);
ok("one ABX trial per arm pair per item", balance.trials === items.length * 3);
ok("the correct answer is on side A as often as side B", balance.positionBalanced);
ok("X is drawn from each arm equally often", balance.xArmBalanced);
ok("catch trials exist", balance.catchTrials >= 2);
ok("X is never the same item as the pair under test", abx.filter((t) => !t.isCatch).every((t) => t.xItemId !== t.itemId));
ok("the matching side really is the arm X came from", abx.filter((t) => !t.isCatch).every((t) => (t.correct === "A" ? t.armA : t.armB) === t.xArm));
ok("A and B are always different clips", abx.every((t) => t.aId !== t.bId));
ok("a catch trial puts X itself on one side", abx.filter((t) => t.isCatch).every((t) => t.xId === (t.correct === "A" ? t.aId : t.bId)));
// Order must not be arm-major, or the first half of the session is one arm.
const firstHalf = abx.slice(0, Math.floor(abx.length / 2)).filter((t) => !t.isCatch);
ok("trial order is shuffled, not grouped by arm pair", new Set(firstHalf.map((t) => `${t.armA}${t.armB}`)).size > 1);
// Determinism: the same secret and seed must rebuild the same design, or a lost
// answer sheet can never be re-scored.
const again = buildAbxTrials({ stimuli, arms, items, runSecret, seed: 12345 });
ok("the design is reproducible from the key", JSON.stringify(again) === JSON.stringify(abx));

const ratings = buildRatingTrials({ stimuli, runSecret, seed: 999, referenceId: "ffffffffffffffff" });
ok("one rating screen per stimulus", ratings.length === stimuli.length);
ok("accent is a first-class rating axis", RATING_AXES.some((a) => a.id === "accent"));
ok("similarity and naturalness are separate axes", RATING_AXES.some((a) => a.id === "similarity") && RATING_AXES.some((a) => a.id === "naturalness"));

const view = listenerView({ runId: "r", createdAt: "now", abx, ratings, notes: "" });
const viewText = JSON.stringify(view);
ok("the listener view names no arm", !arms.some((arm) => viewText.includes(arm)));
// `"correct":` and not `correct` — the accent axis's own label contains the
// word ("not just correct pronunciation"), and a substring check that cannot
// tell a field name from prose fails on the text it is supposed to protect.
ok("the listener view carries no correct answer", !viewText.includes("\"correct\""));
ok("the listener view carries no item id", !viewText.includes("\"i1\""));
ok("the listener view carries no catch flag", !viewText.includes("isCatch"));

// ══════════════════════════════════════════════════════════════════════════
// 3. audio treatment — the disclosure trim and the size/loudness equalisation
// ══════════════════════════════════════════════════════════════════════════
function tone({ seconds, f0, seed = 3 }) {
  const random = rng(seed);
  const out = new Float32Array(Math.floor(seconds * SAMPLE_RATE));
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SAMPLE_RATE;
    out[i] = 0.4 * Math.sin(2 * Math.PI * f0 * t) + 0.02 * (random() * 2 - 1);
  }
  return out;
}
function concat(...parts) {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
const silence = (seconds) => new Float32Array(Math.floor(seconds * SAMPLE_RATE));

const withDisclosure = toPcm(concat(tone({ seconds: 1.9, f0: 240 }), silence(0.26), tone({ seconds: 3.1, f0: 190 })));
const cut = findDisclosureCut(samples(withDisclosure));
ok("the trimmer finds the pause after the disclosure", cut !== null);
near("the cut lands at the end of the pause", cut.cutMs, 2_100, 200);
ok("the trimmer refuses a clip with no pause at all", findDisclosureCut(samples(toPcm(tone({ seconds: 5, f0: 200 })))) === null);
ok("the trimmer refuses a pause outside the disclosure window",
  findDisclosureCut(samples(toPcm(concat(tone({ seconds: 8, f0: 200 }), silence(0.3), tone({ seconds: 2, f0: 200 })))) ) === null);

const trimmed = treat(withDisclosure, { trim: true, text: "x".repeat(40), window: { minMs: 1_100, maxMs: 6_000 } });
ok("a trimmed clip keeps roughly the content half", trimmed.ok && Math.abs(trimmed.durationMs - 3_100) < 250);
ok("the removed prefix is kept for the verify-trim pass", trimmed.prefixPcm && trimmed.prefixPcm.length > 0);
// FAIL CLOSED: a text far too long for what is left means the trim ate speech.
const overTrimmed = treat(withDisclosure, { trim: true, text: "x".repeat(4_000), window: { minMs: 1_100, maxMs: 6_000 } });
ok("an implausible chars-per-second is refused, not shipped", !overTrimmed.ok);
ok("the refusal says why", overTrimmed.reason.includes("chars/s"));

const quiet = normalise(tone({ seconds: 1, f0: 200 }).map((v) => v * 0.05));
const loud = normalise(tone({ seconds: 1, f0: 200 }).map((v) => v * 0.9));
near("loudness is equalised across arms", rms(quiet.values), rms(loud.values), 0.005);

const shortWav = wrapWav(toPcm(tone({ seconds: 1, f0: 200 })), { padToBytes: 400_000 });
const longWav = wrapWav(toPcm(tone({ seconds: 3, f0: 200 })), { padToBytes: 400_000 });
ok("padding makes two different clips the same file size", shortWav.length === longWav.length && shortWav.length === 400_000);
ok("padding does not change the audio", wavPcm(shortWav).length === Math.floor(1 * SAMPLE_RATE) * 2);
ok("a padded file is still a valid RIFF", shortWav.toString("ascii", 0, 4) === "RIFF" && shortWav.readUInt32LE(4) === shortWav.length - 8);

ok("the disclosure sentence is detected in a transcript", transcriptCarriesDisclosure("This is an AI generated voice replica. Chaliye."));
ok("an ordinary Hinglish line is not", !transcriptCarriesDisclosure("Chaliye aaj hum ek concept dekhte hain."));

// ══════════════════════════════════════════════════════════════════════════
// 4. the scorer — on a synthetic answer key, both directions
// ══════════════════════════════════════════════════════════════════════════
const key = {
  runId: "fixture", selfTest: true, contentMatched: true, blindingVerified: true,
  policy: DEFAULT_POLICY, stimuli, trials: abx, ratings,
};
const sheetFrom = (listener, right, catchRight) => ({
  listener,
  abx: Object.fromEntries(abx.map((t, index) => {
    const correct = t.isCatch ? catchRight : right(index);
    return [t.trialId, { choice: correct ? t.correct : (t.correct === "A" ? "B" : "A") }];
  })),
  ratings: Object.fromEntries(ratings.map((r) => [r.ratingId, {
    similarity: r.arm === "real" ? 5 : 3, naturalness: r.arm === "real" ? 5 : 3, accent: r.arm === "real" ? 5 : 2,
  }])),
});

const empty = scoreBench({ key, sheets: [] });
ok("with no answers the report says nobody listened", empty.listened === false);
ok("the printed report says so too", renderReport(empty).includes("NO HUMAN HAS LISTENED"));

const oracleReport = scoreBench({ key, sheets: [sheetFrom("oracle", () => true, true)] });
ok("a perfect listener reads as distinguishable on every pair",
  oracleReport.abx.length === 3 && oracleReport.abx.every((a) => a.verdict === "distinguishable"));
ok("the ratings carry the accent axis per arm", oracleReport.ratings.some((r) => r.axis === "accent" && r.arm === "clone-full"));
ok("the paired comparison sees the real-vs-clone accent gap",
  oracleReport.paired.some((p) => p.axis === "accent" && p.pair.startsWith("real minus") && p.verdict === "gap"));

const coin = rng(4);
const coinReport = scoreBench({ key, sheets: [sheetFrom("coinflip", () => coin() < 0.5, true)] });
ok("a guessing listener is never reported as distinguishable",
  coinReport.abx.every((a) => a.verdict !== "distinguishable"));

const sloppy = scoreBench({ key, sheets: [sheetFrom("sloppy", () => true, false)] });
ok("a listener who fails the catch trials is marked INVALID", sloppy.listeners[0].valid === false);
ok("an invalid sheet contributes to no number", sloppy.abx.length === 0);
ok("but it is still reported, not hidden", renderReport(sloppy).includes("INVALID"));

const mixed = scoreBench({ key, sheets: [sheetFrom("good", () => true, true), sheetFrom("bad", () => true, false)] });
ok("one bad sheet does not discard the good one", mixed.abx.every((a) => a.verdict === "distinguishable"));
ok("both listeners appear in the report", mixed.listeners.length === 2);

const unmatchedKey = { ...key, contentMatched: false, blindingVerified: false };
const caveats = renderReport(scoreBench({ key: unmatchedKey, sheets: [sheetFrom("x", () => true, true)] }));
ok("an unmatched-content run says so in its own report", caveats.includes("content is a cue"));
ok("an ASR-unverified run says so in its own report", caveats.includes("arithmetic only"));
ok("a self-test run is stamped in its own report", caveats.includes("NOT A BENCH RESULT"));

// ══════════════════════════════════════════════════════════════════════════
// 5. end to end: the real CLI, in a temporary home, plus the local server
// ══════════════════════════════════════════════════════════════════════════
const home = mkdtempSync(join(tmpdir(), "earbench-"));
try {
  const out = execFileSync("node", [join(ROOT, "scripts/earbench.mjs"), "selftest", "--items", "6"], {
    cwd: ROOT, env: { ...process.env, EARBENCH_HOME: home }, encoding: "utf8",
  });
  ok("the CLI self-test passes end to end", out.includes("SELF-TEST PASSED"));
  ok("the self-test never claims a bench result", out.includes("no human has listened to anything"));

  const runId = readdirSync(join(home, "runs"))[0];
  const paths = {
    runId,
    served: join(home, "runs", runId),
    stimuli: join(home, "runs", runId, "stimuli"),
    answers: join(home, "answers", runId),
    key: join(home, "keys", `${runId}.key.json`),
  };
  ok("the key is written outside the served directory", existsSync(paths.key) && !existsSync(join(paths.served, "key.json")));
  const files = readdirSync(paths.stimuli);
  const sizes = new Set(files.map((f) => readFileSync(join(paths.stimuli, f)).length));
  ok("every stimulus file on disk is the same size", sizes.size === 1);
  ok("every stimulus filename is an opaque id", files.every((f) => /^[0-9a-f]{16}\.wav$/.test(f)));

  const server = await serveBench(paths, 0);
  const port = server.address().port;
  const get = (path) => fetch(`http://127.0.0.1:${port}${path}`);
  try {
    ok("the page is served", (await get("/")).status === 200);
    const manifest = await (await get("/manifest.json")).json();
    ok("the manifest names no arm", !JSON.stringify(manifest).includes("clone-full"));
    const trials = await (await get("/trials.json")).json();
    ok("the served trial list is the listener view", trials.abx.length > 0 && !JSON.stringify(trials).includes("\"correct\""));
    ok("a stimulus is served by its blind id", (await get(`/stimuli/${trials.abx[0].xId}.wav`)).status === 200);
    ok("the key is not reachable by path", (await get(`/keys/${runId}.key.json`)).status === 404);
    ok("the key is not reachable by traversal", (await get(`/stimuli/../../keys/${runId}.key.json`)).status === 404);
    // fetch() normalises `..` before it leaves the process, so the check above
    // alone would pass against a server that had no defence at all. This one
    // reaches the router with the traversal still in the path.
    ok("the key is not reachable by an encoded traversal",
      (await get(`/stimuli/%2e%2e%2f%2e%2e%2fkeys%2f${runId}.key.json`)).status === 404);
    ok("the answers directory is not browsable", (await get("/answers")).status === 404);
    ok("an arbitrary file is not served", (await get("/../../package.json")).status === 404);

    const posted = await fetch(`http://127.0.0.1:${port}/answers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listener: "probe", abx: {}, ratings: {} }),
    });
    ok("an answer sheet can be posted", posted.status === 200);
    ok("the answer sheet lands on disk", existsSync(join(paths.answers, "probe.json")));
    // Content-Length is the last size channel: two different clips must not be
    // two different responses on the wire either.
    const lengths = await Promise.all(trials.abx.slice(0, 3).flatMap((t) => [t.aId, t.bId, t.xId])
      .map(async (id) => Number((await get(`/stimuli/${id}.wav`)).headers.get("content-length"))));
    ok("every stimulus response is the same length on the wire", new Set(lengths).size === 1);
  } finally {
    server.close();
  }

  const scored = execFileSync("node", [join(ROOT, "scripts/earbench.mjs"), "score", "--run", runId], {
    cwd: ROOT, env: { ...process.env, EARBENCH_HOME: home }, encoding: "utf8",
  });
  ok("the scorer runs against a real run directory", scored.includes("earbench report"));
} finally {
  rmSync(home, { recursive: true, force: true });
}

console.log(`\n1..${checks}`);
console.log("earbench: the instrument works. NO HUMAN HAS LISTENED TO ANY CLONED VOICE THROUGH IT YET,");
console.log("and nothing in this suite is evidence about how any clone sounds.");
