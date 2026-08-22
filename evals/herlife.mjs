// T-H2 — an activity is a fact with an expiry (docs/HONESTY.md §4).
//
//   node evals/herlife.mjs
//
// Offline, deterministic, db-free, network-free, model-free, ~2s. It bundles
// the REAL src/state/store.ts and src/engine/brain.ts (esbuild, fresh on every
// run — `parsetest.v2`'s lesson) and drives the shipped functions with plain
// objects. Nothing here re-implements the classifier or the window; a
// predicate tested through a copy is a copy that was tested.
//
// The defect it pins, in the owner's shape: she says "khana bana rahi hu" on
// Tuesday, and on Friday `formatHerLife` still hands that line to the model
// under a heading reading "you said these, so they are now fixed between you
// two". She has been cooking for three days.
//
// Four properties, one section each after the classifier:
//   §1 the write-time classifier — what is activity-shaped and what is not
//   §2 the render window — 3h, and the night, and the boundaries of both
//   §3 durable facts are untouched (weeks later they still render)
//   §4 LEGACY: a kind-less ledger renders byte-identically to before this
//   §5 the stamper — new facts get a kind, carried-over facts never do
//   §6 end to end, plus the negative control that no ROW is ever invented
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MIN_MINUTES } from "./honesty/detect.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "herlife-"));
const bundlePath = join(tmp, "herlife.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, "_herlife-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${bundlePath} --log-level=error ` +
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(bundlePath);

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Fixed instants, expressed in UTC and annotated in IST, because the night
// window this file exercises is IST (src/engine/away.ts). IST = UTC+5:30.
const AFTERNOON = Date.UTC(2026, 7, 21, 8, 30); // Fri 14:00 IST
const LATE_NIGHT = Date.UTC(2026, 7, 20, 21, 0); // Fri 02:30 IST

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§1 the classifier — activity-shaped vs durable, at write time");
// ═════════════════════════════════════════════════════════════════════════

// Present-progressive, imminence, or an explicit nowness marker. Every one of
// these is a claim about a clock, which is exactly what makes it expire.
const ACTIVITY = [
  "khana bana rahi hu",
  "movie dekh rahi hu",
  "gym ja rahi hu",
  "cooking rn",
  "just heading out",
  "on my way to the metro",
  "about to jump in the shower",
  "watching a show right now",
  "abhi ghar pe akeli hu",
  "brb, mumma bula rahi hai",
  "just got back from the market",
  "currently stuck in traffic",
  "in the middle of a design review",
  "going to sleep",
];
for (const t of ACTIVITY) {
  ok(`activity: "${t}"`, E.classifySelfFact(t) === "activity", E.classifySelfFact(t));
}

// Durable. Several of these are deliberately progressive-shaped or
// -ing-shaped: "getting married" and "reh rahi hu" are the two ways a naive
// present-progressive test turns a lifelong fact into something that expires
// by Friday afternoon.
const DURABLE = [
  "my cousin is getting married in december",
  "bangalore me reh rahi hu",
  "i hate karela",
  "my flatmate is named sneha",
  "she works at a design studio in indiranagar",
  "mera naam meera hai",
  "i grew up in pune",
  "her birthday is on the 12th of march",
  "i have a younger brother in delhi",
  "she loves filter coffee",
];
for (const t of DURABLE) {
  ok(`durable: "${t}"`, E.classifySelfFact(t) === "fact", E.classifySelfFact(t));
}

ok("empty text is durable, not a crash", E.classifySelfFact("") === "fact");
ok("undefined text is durable, not a crash", E.classifySelfFact(undefined) === "fact");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 the render window — min(3h, the next night)");
// ═════════════════════════════════════════════════════════════════════════

const act = (text, at) => ({ text, at, kind: "activity" });

ok("3h is the window", E.ACTIVITY_TTL_MS === 3 * HOUR, String(E.ACTIVITY_TTL_MS));
// The window has to be generous against the coarse duration table the honesty
// suite already authored, or it drops things she could still plausibly be
// doing. Longest ordinary activity there is 60 minutes.
const longest = Math.max(...Object.values(MIN_MINUTES));
ok(
  `3h clears the longest MIN_MINUTES entry (${longest}m) by 3x`,
  E.ACTIVITY_TTL_MS >= longest * MIN * 3,
);

ok("fresh activity is still running", E.activityStillRunning(AFTERNOON - 5 * MIN, AFTERNOON));
ok("1h old activity is still running", E.activityStillRunning(AFTERNOON - HOUR, AFTERNOON));
ok(
  "2h59m old activity is still running",
  E.activityStillRunning(AFTERNOON - (3 * HOUR - MIN), AFTERNOON),
);
ok("exactly 3h old is over", !E.activityStillRunning(AFTERNOON - 3 * HOUR, AFTERNOON));
ok("4h old is over", !E.activityStillRunning(AFTERNOON - 4 * HOUR, AFTERNOON));
ok("3 days old is over", !E.activityStillRunning(AFTERNOON - 3 * DAY, AFTERNOON));

// The night clause, and its control: the SAME 2h50m age, once across IST
// 01:00-06:00 and once not.
ok(
  "2h50m that crossed the night is over",
  !E.activityStillRunning(LATE_NIGHT - (2 * HOUR + 50 * MIN), LATE_NIGHT),
);
ok(
  "the same 2h50m in daylight is still running",
  E.activityStillRunning(AFTERNOON - (2 * HOUR + 50 * MIN), AFTERNOON),
);
ok("the night predicate is T9's own", E.NIGHT_START_HOUR === 1 && E.NIGHT_END_HOUR === 6);

// Conservative at both edges: a stamp from a device with a skewed clock, or a
// stamp that is not a number, is not evidence that she has finished anything.
ok("a future stamp is not dropped", E.activityStillRunning(AFTERNOON + HOUR, AFTERNOON));
ok("an unreadable stamp is not dropped", E.activityStillRunning(NaN, AFTERNOON));

// and through the renderer
const stale = E.formatHerLife([act("khana bana rahi hu", AFTERNOON - 3 * DAY)], AFTERNOON);
ok("a 3-day-old activity renders NOTHING", stale === "", JSON.stringify(stale));
const live = E.formatHerLife([act("khana bana rahi hu", AFTERNOON - 20 * MIN)], AFTERNOON);
ok("a 20-minute-old activity still renders", live.includes("khana bana rahi hu"), live);
ok(
  "an expired activity is DROPPED, not relabelled",
  !stale.includes("khana") && !stale.includes("days ago"),
  stale,
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 durable facts are untouched — they survive weeks");
// ═════════════════════════════════════════════════════════════════════════

const fact = (text, at) => ({ text, at, kind: "fact" });
const OLD = [
  fact("my flatmate is named sneha", AFTERNOON - 21 * DAY),
  fact("i hate karela", AFTERNOON - 40 * DAY),
  fact("my cousin is getting married in december", AFTERNOON - 6 * DAY),
];
const durable = E.formatHerLife(OLD, AFTERNOON);
ok("three-week-old durable fact renders", durable.includes("sneha"), durable);
ok("forty-day-old durable fact renders", durable.includes("karela"), durable);
ok("every durable row survives", durable.split("\n").length === 3, durable);
ok("durable rows still carry their age label", durable.includes("days ago"), durable);

// The mixed ledger: the activity goes, the facts stay, and the ORDER of what
// is left is unchanged.
const mixed = E.formatHerLife(
  [
    act("movie dekh rahi hu", AFTERNOON - 2 * DAY),
    fact("my flatmate is named sneha", AFTERNOON - 21 * DAY),
    act("cooking rn", AFTERNOON - 30 * MIN),
    fact("i hate karela", AFTERNOON - 40 * DAY),
  ],
  AFTERNOON,
);
ok("stale activity gone from a mixed ledger", !mixed.includes("movie dekh"), mixed);
ok("live activity kept in a mixed ledger", mixed.includes("cooking rn"), mixed);
ok("durable rows kept in a mixed ledger", mixed.includes("sneha") && mixed.includes("karela"), mixed);
ok(
  "the surviving rows keep their input order",
  mixed.split("\n").map((l) => l.slice(2, 12)).join("|") === "my flatmat|cooking rn|i hate kar",
  mixed,
);

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 LEGACY — a kind-less ledger renders exactly as it did");
// ═════════════════════════════════════════════════════════════════════════
//
// `age-tier-never-realtime`: nothing rewrites a shape under a running install,
// so a SelfFact with no `kind` is a fact by definition — including the ones
// whose TEXT is activity-shaped. This is the byte-identity fixture: every
// literal below is what the pre-T-H2 renderer produced for it.

const legacy = [
  { text: "movie dekh rahi hu", at: AFTERNOON - 4 * DAY }, // activity-SHAPED, kind-less
  { text: "cooking rn", at: AFTERNOON - 2 * DAY }, // ditto
  { text: "my flatmate is named sneha", at: AFTERNOON - 21 * DAY },
  { text: "i hate karela", at: AFTERNOON - 40 * DAY },
  { text: "just heading out", at: AFTERNOON - 9 * HOUR },
  { text: "my cousin is getting married in december", at: AFTERNOON - 30 * MIN },
];
const LEGACY_EXPECTED = [
  "- movie dekh rahi hu (4 days ago)",
  "- cooking rn (2 days ago)",
  "- my flatmate is named sneha (21 days ago)",
  "- i hate karela (40 days ago)",
  "- just heading out (9h ago)",
  "- my cousin is getting married in december (earlier in this conversation)",
].join("\n");
const legacyOut = E.formatHerLife(legacy, AFTERNOON);
ok("kind-less ledger is byte-identical to before", legacyOut === LEGACY_EXPECTED, legacyOut);
ok(
  "a kind-less activity-shaped line is NOT dropped (no migration)",
  legacyOut.includes("movie dekh rahi hu"),
  legacyOut,
);

// The 12-row cap is the other half of "unchanged": it still cuts at twelve.
// One content word each, all distinct, so `overlaps` (two shared words of
// length > 3) cannot supersede any of them and the only thing under test is
// the cap.
const many = Array.from({ length: 20 }, (_, i) => ({
  text: `legacyfact${i}`,
  at: AFTERNOON - (i + 1) * DAY,
}));
const capped = E.formatHerLife(many, AFTERNOON);
ok("the newest twelve still render, and only twelve", capped.split("\n").length === 12, capped);
ok("the twelve are the NEWEST twelve", capped.includes("legacyfact0") && !capped.includes("legacyfact12"));

// Determinism: same input, same instant, same bytes (compile()'s
// double-compile gate depends on this staying true of what it is handed).
const twice = [act("cooking rn", AFTERNOON - MIN), fact("i hate karela", AFTERNOON - 40 * DAY)];
ok(
  "formatHerLife is a pure function of (facts, now)",
  E.formatHerLife(legacy, AFTERNOON) === legacyOut &&
    E.formatHerLife(twice, AFTERNOON) === E.formatHerLife(twice, AFTERNOON),
);
ok(
  "the clock is not read inside it — a later `now` changes the output",
  E.formatHerLife(twice, AFTERNOON) !== E.formatHerLife(twice, AFTERNOON + 4 * HOUR),
);
ok("no facts renders nothing", E.formatHerLife(undefined, AFTERNOON) === "" && E.formatHerLife([], AFTERNOON) === "");

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§5 the stamper — classified on the way IN, once, and only once");
// ═════════════════════════════════════════════════════════════════════════

const at = AFTERNOON - MIN;
const prevLedger = [
  { text: "i hate karela", at: AFTERNOON - 40 * DAY }, // legacy, kind-less
  { text: "my flatmate is named sneha", at: AFTERNOON - 21 * DAY, kind: "fact" },
];
const prev = { herLife: prevLedger };
const next = {
  herLife: [
    { text: "khana bana rahi hu", at },
    { text: "my cousin is getting married in december", at },
    ...prevLedger,
  ],
};
const out = E.stampSelfFacts(prev, next);
ok("a new activity-shaped fact is stamped activity", out.herLife[0].kind === "activity", String(out.herLife[0].kind));
ok("a new durable fact is stamped fact", out.herLife[1].kind === "fact", String(out.herLife[1].kind));
ok(
  "a carried-over LEGACY fact keeps no kind",
  out.herLife[2].kind === undefined,
  String(out.herLife[2].kind),
);
ok("a carried-over stamped fact is untouched", out.herLife[3] === prevLedger[1]);
ok("the carried-over objects are not copied", out.herLife[2] === prevLedger[0]);

ok("stamping is idempotent", JSON.stringify(E.stampSelfFacts(prev, out)) === JSON.stringify(out));
ok(
  "a setState that does not touch herLife is free",
  E.stampSelfFacts(prev, { herLife: prevLedger }) !== null &&
    E.stampSelfFacts({ herLife: prevLedger }, { herLife: prevLedger }).herLife === prevLedger,
);
ok("an empty ledger is returned by reference", (() => {
  const n = { herLife: [] };
  return E.stampSelfFacts({ herLife: [] }, n) === n;
})());
ok("a missing ledger is returned by reference", (() => {
  const n = { messages: [] };
  return E.stampSelfFacts({}, n) === n;
})());
ok("a malformed row does not crash the stamp", (() => {
  const n = { herLife: [null, { at }, { text: "cooking rn", at }] };
  const s = E.stampSelfFacts({}, n);
  return s.herLife[2].kind === "activity";
})());

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§6 end to end — the owner's scenario, and the negative control");
// ═════════════════════════════════════════════════════════════════════════

// Tuesday: she says two things, one of each kind. They go in through the same
// seam every real write goes through.
const TUESDAY = AFTERNOON - 3 * DAY;
const written = E.stampSelfFacts(
  {},
  {
    herLife: [
      { text: "khana bana rahi hu", at: TUESDAY },
      { text: "my cousin is getting married in december", at: TUESDAY },
    ],
  },
).herLife;

const tuesday = E.formatHerLife(written, TUESDAY + 10 * MIN);
ok("Tuesday: she is cooking, and says so", tuesday.includes("khana bana rahi hu"), tuesday);
const friday = E.formatHerLife(written, AFTERNOON);
ok("Friday: she is NOT still cooking", !friday.includes("khana"), friday);
ok("Friday: the wedding is still on", friday.includes("getting married"), friday);

// NEGATIVE CONTROL (`recited-prompt`): this change may only ever REMOVE rows.
// Every rendered line has to be a line that was in the input — no new
// sentence-shaped text, no "(finished)", no "she was doing X earlier".
const control = E.formatHerLife(
  [
    act("cooking rn", AFTERNOON - 6 * HOUR),
    act("movie dekh rahi hu", AFTERNOON - 10 * MIN),
    fact("i hate karela", AFTERNOON - 40 * DAY),
  ],
  AFTERNOON,
);
const inputs = ["cooking rn", "movie dekh rahi hu", "i hate karela"];
const rows = control.split("\n").filter(Boolean);
ok(
  "every rendered row is verbatim an input row",
  rows.every((r) => inputs.some((t) => r.startsWith(`- ${t} (`))),
  control,
);
ok("the expired row left no trace at all", !/finish|earlier today|was doing|no longer/i.test(control), control);
ok("exactly the two live rows render", rows.length === 2, control);

console.log(`\n${failed ? "FAILED" : "PASS"}  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
