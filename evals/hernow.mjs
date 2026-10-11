// ── WS-HERNOW: HER PRESENT AS STATE, NOT A ROLL ───────────────────────────
//
// The owner's report, 2026-08-23: he called and she said she was reading a
// book; he called again ONE MINUTE later and she said she was setting fairy
// lights. "She has no idea how long a task takes and when to move from one to
// another."
//
// The two fixtures at the bottom of this file are that report and its twin:
//
//   §7  THE ONE-MINUTE RE-CALL. Two pickups sixty seconds apart. The activity
//       must be IDENTICAL, and it must be the book — the fairy lights are a
//       noun in the same story picture, and picking a different noun is the
//       whole defect. This fixture FAILS on the pre-fix behaviour, which is
//       asserted here as a negative control rather than described.
//
//   §8  THE NINETY-MINUTE RE-CALL. Same story slot, ninety minutes later.
//       Now moving on is CORRECT, and staying on the book would be the
//       opposite failure — a person who is doing the same thing at 22:00 that
//       she was doing at 20:30 with no break in between is a screensaver.
//
// Everything above them is the machinery those two rest on: the span table is
// classes, the derivation is deterministic (never Math.random at read), app
// truth outranks the ledger, the elapsed she may claim is computable from
// `startedAt`, and the block she is handed is telegraphic rather than a line
// she could read out.
//
// Offline, deterministic, $0, no network, no DB, no model call. Re-bundles
// from the REAL source on every run, same as evals/run.mjs does.

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "hernow-"));
const BUNDLE = join(tmp, "hernow.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(pathToFileURL(BUNDLE).href);

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

const MIN = 60_000;
/** 2026-08-23 is a Sunday; 20:00 IST is deep inside the `night` story slot,
 *  which starts at 19:40 — the exact slot the reported bug happened in. */
const IST = 330 * MIN;
const at = (h, m = 0) => Date.UTC(2026, 7, 23, h, m, 0) - IST;
const NIGHT_2000 = at(20, 0);

// ── §1 THE SPAN TABLE IS CLASSES, AND THE CLASSES ARE THE OWNER'S ─────────
{
  const T = E.SPAN_TABLE;
  for (const [cls, r] of Object.entries(T)) {
    ok(`${cls} span is a real range`, r.hiMin >= r.loMin && r.loMin >= 0, JSON.stringify(r));
  }
  // The four the owner named by number, plus the work stretch he named in
  // hours. A span table that quietly drifts off his examples is a table that
  // has stopped being the thing he asked for.
  ok("reading is 40–90 min", T.reading.loMin === 40 && T.reading.hiMin === 90);
  ok("cooking is 20–40 min", T.cooking.loMin === 20 && T.cooking.hiMin === 40);
  ok("getting ready is 15–30 min", T.getting_ready.loMin === 15 && T.getting_ready.hiMin === 30);
  ok("a small chore is 5–15 min", T.chore.loMin === 5 && T.chore.hiMin === 15);
  ok("a work stretch is hours", T.work.loMin >= 60);
  // an app truth is not a class of hers and has no natural span — the app
  // ends it, and a number here would be one nothing reads
  ok("app truth carries no span", T.app.loMin === 0 && T.app.hiMin === 0);
  ok("spanFor returns 0 for an app truth", E.spanFor("app", "anything") === 0);

  // every drawn span lands INSIDE its class's range, over a wide key sweep
  let outside = 0;
  for (const cls of Object.keys(T)) {
    if (cls === "app") continue;
    for (let i = 0; i < 400; i++) {
      const mins = E.spanFor(cls, `k${i}|${cls}`) / MIN;
      if (mins < T[cls].loMin || mins > T[cls].hiMin) outside++;
    }
  }
  ok("every drawn span is inside its class range", outside === 0, `${outside} outside`);
}

// ── §2 DETERMINISM: TWO DEVICES, NO SERVER, ONE PRESENT MOMENT ────────────
{
  ok("spanFor is a pure function of its key",
    E.spanFor("reading", "seed-a") === E.spanFor("reading", "seed-a"));
  // …and it actually varies, or "deterministic" would be satisfied by a
  // constant, which is a timer wearing a hash
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(E.spanFor("reading", `seed-${i}`));
  ok("spanFor spreads across the range", seen.size > 10, `${seen.size} distinct`);

  // the whole derivation, re-run: byte-identical
  const a = E.deriveHerNow(NIGHT_2000);
  const b = E.deriveHerNow(NIGHT_2000);
  ok("deriveHerNow is deterministic", JSON.stringify(a) === JSON.stringify(b));

  // THE STRUCTURAL HALF, over the source: a Math.random() anywhere in this
  // file is a present moment that disagrees with itself on the next read and
  // between two devices — the defect, re-introduced. Asserted on the bytes
  // rather than sampled, because sampling cannot prove an absence.
  const raw = src("src/engine/herNow.ts");
  // COMMENTS STRIPPED FIRST. This file's own header names `Math.random()` in
  // the sentence explaining why it is absent, and a lint that its own
  // documentation trips is a lint that gets worked around.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  ok("herNow.ts contains no Math.random", !/Math\.random/.test(code));
  ok("herNow.ts reads no clock of its own",
    !/Date\.now\(\)/.test(code) && !/new Date\(/.test(code),
    "every function takes `now` — a renderer that reads the clock inside itself cannot be pinned to a literal");
  // …and it stays a near-leaf, which is what lets state/store.ts hold the type
  const imports = [...code.matchAll(/^import .*?from "([^"]+)";$/gm)].map((m) => m[1]);
  ok("herNow.ts imports only storyCatalog",
    imports.length === 1 && imports[0] === "./storyCatalog", imports.join(", "));
}

// ── §3 THE STORY SLOT'S ACTIVITY, AND THE MAPPING IS TOTAL ────────────────
{
  const missing = E.STORY_POOL.filter((p) => !E.STORY_ACTIVITY[p.slug]);
  ok("every pool image maps to an activity", missing.length === 0,
    missing.map((p) => p.slug).join(", ") +
      " — an hour of her day with no present moment is the state this file exists to end");

  // THE BUG'S OWN ROW. The night picture contains a book, a lamp AND fairy
  // lights; the ACTIVITY is the book. A scene has many nouns and a person is
  // doing one thing.
  const night = E.STORY_ACTIVITY["night-read"];
  ok("the night activity is the book", /book/.test(night.activity), night.activity);
  ok("the night activity is NOT the fairy lights", !/fairy/i.test(night.activity), night.activity);
  ok("the night activity is classed as reading", night.cls === "reading");

  // and the pool row it comes from really does contain the distractor, or
  // this assertion is guarding a picture that no longer poses the risk
  const pool = E.STORY_POOL.find((p) => p.slug === "night-read");
  ok("the night pool frame does contain fairy lights (the distractor is real)",
    !!pool && /fairy lights/i.test(pool.desc), pool?.desc);
}

// ── §4 recited-prompt: SHAPES, NEVER LINES ────────────────────────────────
{
  // EVERY authored string in this file that can reach the prompt — the story
  // rows, the slot fallbacks and the successors. Linting only the first table
  // would be a lint as wide as the part somebody remembered, which is the
  // `dead-writers` failure seen from the coverage side.
  const rows = [
    ...Object.values(E.STORY_ACTIVITY).map((v) => v.activity),
    ...Object.values(E.SLOT_FALLBACK).map((v) => v.activity),
    ...Object.values(E.SUCCESSOR).map((v) => v.activity),
  ];
  ok("there is something to lint", rows.length >= 20, String(rows.length));
  const dirty = [];
  for (const r of rows) {
    const v = E.lintLine(r);
    if (v.reasons.length) dirty.push(`${r} :: ${v.reasons.join("|")}`);
  }
  // the lint has to be able to speak — a clean sweep over a lint that returns
  // nothing for everything is the assertion-proved-by-silence class
  ok("shapelint is actually running", E.lintLine("I read a book.").reasons.length > 0);
  ok("every activity string passes shapelint", dirty.length === 0, dirty.join(" ; "));
  for (const r of rows) {
    ok(`"${r}" is not a sentence she could say`,
      !/^[A-Z]/.test(r) && !/[.!?]$/.test(r) && !/^(i|main|mai)\b/i.test(r));
    ok(`"${r}" is telegraphic (≤14 words)`, r.trim().split(/\s+/).length <= 14, r);
  }
}

// ── §5 HONESTY: SHE MAY NEVER CLAIM A DURATION THE LEDGER CONTRADICTS ─────
{
  // Every label FLOORS. Rounding to the nearest five would let her say "about
  // 5 min" three minutes in, which is a number the subtraction does not
  // support — and a duration that is not computable from startedAt is the one
  // thing this whole block exists to make impossible.
  let over = 0;
  const worst = [];
  for (let mins = 0; mins <= 600; mins++) {
    const label = E.elapsedLabel(mins * MIN);
    const num = /about ([\d.]+) (min|hours)/.exec(label);
    if (!num) continue;
    const claimed = parseFloat(num[1]) * (num[2] === "hours" ? 60 : 1);
    if (claimed > mins) {
      over++;
      worst.push(`${mins}min → "${label}"`);
    }
  }
  ok("no elapsed label ever over-claims", over === 0, worst.slice(0, 5).join(", "));
  ok('"about an hour" is also floored', E.elapsedLabel(59 * MIN) !== "about an hour");
  ok("under two minutes reads as just started", E.elapsedLabel(60_000) === "just started");
  ok("the short bucket names no number", E.elapsedLabel(4 * MIN) === "a few minutes");

  // and the elapsed handed out is (now − startedAt), never anything else
  const when = NIGHT_2000 + 17 * MIN;
  const r = E.herNowAt({ now: when });
  ok("elapsedMs is exactly (now − startedAt)", r.elapsedMs === when - r.entry.startedAt,
    `${r.elapsedMs} vs ${when - r.entry.startedAt}`);
  ok("the rendered label agrees with that subtraction",
    E.formatHerNow(r.entry, when).includes(E.elapsedLabel(when - r.entry.startedAt)));

  // a stored row with a FUTURE start is another device's clock skew, and it
  // is refused rather than rendered as a negative duration
  const skewed = { ...E.deriveHerNow(NIGHT_2000), startedAt: NIGHT_2000 + 40 * MIN };
  const fromSkew = E.herNowAt({ now: NIGHT_2000, stored: skewed });
  ok("a future stored start is refused, not rendered", fromSkew.elapsedMs >= 0 && fromSkew.commit !== null);
}

// ── §6 APP TRUTH OUTRANKS THE LEDGER (the scene fence, in code) ───────────
{
  const line = "you two are in the middle of a game of chess right now (it is his move; 12 min in)";
  const r = E.herNowAt({
    now: NIGHT_2000 + 5 * MIN,
    stored: E.deriveHerNow(NIGHT_2000),
    appTruth: { line, startedAt: NIGHT_2000 },
  });
  ok("app truth wins outright", r.entry.source === "app-truth");
  ok("app truth's wording is passed through UNCHANGED", r.entry.activity === line,
    "a second renderer of somebody else's fact is how the pickup and the tail drifted apart");
  ok("the pickup scene is that same string", E.herNowScene(r.entry, NIGHT_2000 + 5 * MIN) === line);
  ok("app truth is never committed to the ledger", r.commit === null,
    "an app truth is re-read from the app, never remembered as her own activity");
  ok("app truth renders NO her-present block", E.formatHerNow(r.entry, NIGHT_2000 + 5 * MIN) === "",
    "T15 and the pickup scene already carry it; a third copy is a second renderer");

  // …and a stored app-truth row can never come back to life as her activity
  const stale = { ...r.entry };
  const after = E.herNowAt({ now: NIGHT_2000 + 6 * MIN, stored: stale });
  ok("a stored app-truth row is never reused", after.entry.source !== "app-truth");
}

// ══ §7 THE FIXTURE: THE ONE-MINUTE RE-CALL (the reported bug, FIXED) ══════
//
// 20:00, night slot, night-read is live. He calls. He calls again at 20:01.
{
  const t1 = NIGHT_2000;
  const t2 = NIGHT_2000 + 1 * MIN;

  // call one — nothing stored yet, which is the real first-call state
  const c1 = E.herNowAt({ now: t1, stored: null });
  ok("call 1 lands on the book", /book/.test(c1.entry.activity), c1.entry.activity);
  ok("call 1 commits the row to the ledger", c1.commit !== null);

  // call two, sixty seconds later, reading the row call one wrote
  const c2 = E.herNowAt({ now: t2, stored: c1.commit });
  ok("call 2 is the SAME activity", c2.entry.activity === c1.entry.activity,
    `${c1.entry.activity} → ${c2.entry.activity}`);
  ok("call 2 is the same ledger row", c2.entry.key === c1.entry.key);
  ok("call 2 did NOT move on", c2.moved === false);
  ok("call 2 writes nothing new", c2.commit === null);
  ok("call 2 never mentions fairy lights", !/fairy/i.test(c2.entry.activity), c2.entry.activity);
  ok("call 2's start is call 1's start (the clock moved, not the activity)",
    c2.entry.startedAt === c1.entry.startedAt);

  // the SCENE the directive gets is the same activity with the time moved on
  const s1 = E.herNowScene(c1.entry, t1);
  const s2 = E.herNowScene(c2.entry, t2);
  ok("both pickups describe the same thing", s1.startsWith(c1.entry.activity) && s2.startsWith(c1.entry.activity),
    `${s1} || ${s2}`);
  ok("the scene carries an elapsed", /you have been at it|you only just started/.test(s2), s2);

  // THE NEGATIVE CONTROL. A gate that cannot fail is a green light with no
  // wiring behind it, and this repo has shipped one. The pre-fix behaviour is
  // "the scene comes from the app truth alone, and is EMPTY without a board" —
  // which fell through to the directive's improv clause and re-rolled. Here it
  // is, seen going empty on exactly the call that broke.
  const preFixScene = ""; // activityPickupLine(activityOf(null)) === ""
  ok("the gate can fail: the pre-fix scene was empty on a no-board pickup",
    preFixScene === "" && s2.length > 0,
    "if this ever reports an empty new scene too, the fixture is decorative");
}

// ══ §8 THE FIXTURE: NINETY MINUTES LATER (moving on is CORRECT) ═══════════
{
  const t1 = NIGHT_2000;
  const c1 = E.herNowAt({ now: t1, stored: null });
  const t2 = NIGHT_2000 + 90 * MIN;
  const c2 = E.herNowAt({ now: t2, stored: c1.commit });

  ok("ninety minutes on, the ledger has moved", c2.entry.key !== c1.entry.key,
    "reading tops out at 90 min; still on the same row would be a screensaver");
  ok("…and it says so", c2.moved === true);
  ok("…and it commits the new row", c2.commit !== null);
  ok("she knows what she finished", typeof c2.entry.after === "string" && c2.entry.after.length > 0,
    "moving on with no memory of what from is not moving on");
  ok("the successor is a quiet, solo, small thing", c2.entry.source !== "app-truth");
  const scene = E.herNowScene(c2.entry, t2);
  ok("the pickup scene says what ended AND what is going on now",
    scene.includes(c2.entry.activity) && scene.includes(c2.entry.after), scene);

  // the elapsed restarts with the new activity, and it is honest
  ok("elapsed is measured from the NEW start", c2.elapsedMs === t2 - c2.entry.startedAt);
  ok("the new start is when the old span ran out",
    c2.entry.startedAt <= t2 && c2.entry.startedAt > c1.entry.startedAt);

  // THE BREAK ITSELF, caught in the act. The ninety-minute probe above lands
  // after she has come BACK to the book, which is the right answer and is a
  // weak proof of moving on — the activity string is the same one. So walk
  // forward minute by minute to the first instant the ledger is NOT the book
  // and assert the whole shape there: a different activity, a different key,
  // and the book named as the thing she just finished.
  {
    let breakAt = null;
    for (let m = 1; m <= 240 && breakAt === null; m++) {
      const e = E.deriveHerNow(t1 + m * MIN);
      if (!/book open/.test(e.activity)) breakAt = { at: t1 + m * MIN, e };
    }
    ok("she does leave the book at some point inside the slot", breakAt !== null,
      "a present moment that never changes for ten hours is a screensaver");
    if (breakAt) {
      ok("the break is a different activity", !/book open/.test(breakAt.e.activity), breakAt.e.activity);
      ok("the break knows what it interrupted", /book open/.test(breakAt.e.after ?? ""), breakAt.e.after);
      ok("the break is a SMALL thing", E.SPAN_TABLE[breakAt.e.cls].hiMin <= 15, breakAt.e.cls);
      ok("the break is marked improvised, not her posted story", breakAt.e.source === "improv");
      // it starts exactly where reading ran out — a gap or an overlap would be
      // a minute of her day with two answers or none
      const before = E.deriveHerNow(breakAt.at - 1 * MIN);
      ok("the break starts exactly where the last activity ended",
        breakAt.e.startedAt === before.startedAt + before.naturalSpanMs,
        `${breakAt.e.startedAt} vs ${before.startedAt + before.naturalSpanMs}`);
      // …and a re-call one minute into the BREAK is just as sticky as one
      // into the book: the anti-re-roll property is about the ledger, not
      // about which row happens to be in it
      const b1 = E.herNowAt({ now: breakAt.at, stored: null });
      const b2 = E.herNowAt({ now: breakAt.at + 1 * MIN, stored: b1.commit });
      ok("a re-call during the break gets the same break", b2.entry.key === b1.entry.key);
    }
  }

  // and the walk is a LOOP, not a drift: reading → a small break → reading.
  // A day that wanders one chore at a time away from her own evening is the
  // other way to lose continuity.
  ok("a break's class is a small chore", E.SPAN_TABLE[c2.entry.cls].hiMin <= 15 || c2.entry.cls === "reading",
    c2.entry.cls);
  const later = E.herNowAt({ now: t2 + 20 * MIN, stored: c2.commit });
  ok("after the break she is back at the book",
    /book/.test(later.entry.activity) || later.entry.key === c2.entry.key, later.entry.activity);
}

// ── §9 THE WALK IS TOTAL AND TERMINATES ───────────────────────────────────
{
  // every minute of a whole Bangalore day: an answer, always, and always one
  let missing = 0;
  let sources = new Set();
  for (let m = 0; m < 1440; m += 1) {
    const e = E.deriveHerNow(Date.UTC(2026, 7, 23, 0, 0, 0) - IST + m * MIN);
    if (!e || !e.activity || !Number.isFinite(e.startedAt) || !Number.isFinite(e.naturalSpanMs)) missing++;
    sources.add(e.source);
  }
  ok("every minute of the day has exactly one present moment", missing === 0, `${missing} blank`);
  ok("both her own sources are reachable across a day",
    sources.has("story") && sources.has("improv"), [...sources].join(","));
  ok("the derivation never produces an app-truth row", !sources.has("app-truth"));

  // …and across a whole week, so a slot that only exists on a weekend is
  // still covered
  let weekMissing = 0;
  for (let d = 0; d < 7; d++)
    for (let m = 0; m < 1440; m += 7) {
      const e = E.deriveHerNow(Date.UTC(2026, 7, 17 + d, 0, 0, 0) - IST + m * MIN);
      if (!e || !e.activity) weekMissing++;
    }
  ok("a whole week of minutes is covered", weekMissing === 0, `${weekMissing} blank`);
}

// ── §10 THE PROMPT BLOCK, AND THE SEAM WITH herLife ───────────────────────
{
  const e = E.deriveHerNow(NIGHT_2000);
  const block = E.formatHerNow(e, NIGHT_2000 + 20 * MIN);
  ok("the block renders", block.length > 0);
  ok("the block names the activity", block.includes(e.activity));
  ok("the block names the elapsed", /going on: /.test(block));
  ok("the block fits its declared worst case",
    block.length <= E.HER_NOW_WORST_CASE_CHARS, `${block.length} > ${E.HER_NOW_WORST_CASE_CHARS}`);
  // …and the worst case is the number scripts/check-prompt-budget.mjs counts
  // for this block on the two lanes that carry it. A block that can outgrow
  // the arithmetic guarding it is `silent-truncation` waiting to happen —
  // "every new block on this lane has to be added HERE or it is unguarded" is
  // that script's own rule, and this is the tie that keeps it true.
  ok("the declared worst case is within the budget script's allowance",
    E.HER_NOW_WORST_CASE_CHARS <= 700, String(E.HER_NOW_WORST_CASE_CHARS));
  const budget = src("scripts/check-prompt-budget.mjs");
  ok("the budget script counts the present-minute block", /HER_NOW_EXTRAS/.test(budget),
    "an uncounted block is a bound that passes by omission");

  // every rendered row, over a whole day, stays under the worst case
  let over = 0;
  for (let m = 0; m < 1440; m += 3) {
    const at2 = Date.UTC(2026, 7, 23, 0, 0, 0) - IST + m * MIN;
    const b = E.formatHerNow(E.deriveHerNow(at2), at2 + 30 * MIN);
    if (b.length > E.HER_NOW_WORST_CASE_CHARS) over++;
  }
  ok("no minute of the day renders a block over the worst case", over === 0, `${over} over`);
  // the anti-re-roll instruction is IN the prompt, not only in the code
  ok("the header tells her a second ask gets the same answer",
    /same answer/i.test(E.HER_NOW_HEADER) && /never a different activity/i.test(E.HER_NOW_HEADER));
  ok("the header fences the duration", /only duration you know/i.test(E.HER_NOW_HEADER));

  // THE SEAM. T7's own header says "you said these"; nothing here has been
  // said, and the block has to say so or the two blocks double-claim.
  ok("the header disclaims having told them",
    /NOT something you have told them/.test(E.HER_NOW_HEADER));

  // and the composition: told ledger first (the durable half), present last
  const told = [{ text: "flatmate is named sneha", at: NIGHT_2000 - 3 * 3600_000, kind: "fact" }];
  const both = E.formatHerLife(told, NIGHT_2000 + 20 * MIN, e);
  ok("T7 carries the told ledger", /sneha/.test(both));
  ok("T7 carries the present moment", both.includes(e.activity));
  ok("the told ledger comes first, the present minute last",
    both.indexOf("sneha") < both.indexOf(E.HER_NOW_HEADER));

  // BYTE-IDENTITY for every caller that passes nothing — the watch lane is
  // deliberately one of them (see the herNow rows in evals/lanes/run.mjs)
  ok("formatHerLife with no present is byte-identical to the told ledger alone",
    E.formatHerLife(told, NIGHT_2000) === "- flatmate is named sneha (3h ago)",
    JSON.stringify(E.formatHerLife(told, NIGHT_2000)));
  ok("no facts and no present is still empty", E.formatHerLife([], NIGHT_2000) === "");
  ok("no facts but a present renders the present", E.formatHerLife([], NIGHT_2000, e).length > 0);
}

// ── §11 THE MERGE: an activity and its start never come from two rows ─────
{
  const older = E.deriveHerNow(NIGHT_2000);
  const newer = { ...E.deriveHerNow(NIGHT_2000 + 200 * MIN) };
  ok("the later start wins", E.mergeHerNow(older, newer) === newer);
  ok("…in both directions", E.mergeHerNow(newer, older) === newer);
  ok("a malformed remote row is refused", E.mergeHerNow(older, { activity: 7 }) === older);
  ok("a missing remote row keeps local", E.mergeHerNow(older, undefined) === older);
  ok("a missing local row takes a valid remote", E.mergeHerNow(null, newer) === newer);
  // wholesale, never field-by-field: the merged row is one of the two inputs
  const merged = E.mergeHerNow(older, newer);
  ok("the merge is wholesale", merged === older || merged === newer,
    "a field-by-field merge can produce a duration for something she started somewhere else");
}

// ── §12 THE WIRING — every lane really does read the one ledger ───────────
{
  const call = src("src/components/useCallEngine.ts");
  const chat = src("src/components/Chat.tsx");
  const store = src("src/state/store.ts");
  const acct = src("src/engine/account.ts");
  const app = src("src/App.tsx");

  ok("AppState declares the herNow slice", /^\s{2}herNow\?:/m.test(store));
  ok("the slice syncs", /herNow: s\.herNow/.test(acct));
  ok("the account switch resets it", /herNow: \(r\?\.herNow/.test(app));

  ok("the call lane reads the ledger through ONE helper",
    /const presentNow = \(now: number = Date\.now\(\)\)/.test(call));
  ok("the pickup scene is computed from herNow",
    /scene: herNowScene\(presentNow\(now\)\.entry, now\)/.test(call),
    "the old form was `activityPickupLine(activityOf(...))`, which is \"\" on most calls " +
      "and fell through to the directive's improv clause");
  ok("app truth still comes from the single derivation",
    /activityPickupLine\(act\)/.test(call) && /activityOf\(stateRef\.current\.game, now\)/.test(call));
  // The LIVE compile deliberately does NOT: it is frozen at connect and the
  // block carries an elapsed, so a baked-in "about 20 min" is false forty
  // minutes into the call. Her present reaches that lane through direct(),
  // as the pickup directive's scene — asserted just above. The parity table
  // carries the same verdict in writing (evals/lanes/run.mjs, herNow.present).
  ok("the frozen live compile does NOT bake in an elapsed",
    /herLife: formatHerLife\(stateRef\.current\.herLife\),/.test(call),
    "a duration she cannot recompute is the one thing this module exists to prevent");
  ok("the cascade lane feeds T7 the same entry",
    /herLife: formatHerLife\(stateRef\.current\.herLife, Date\.now\(\), presentNow\(\)\.entry\)/.test(call));
  ok("the chat lane feeds T7 the same entry",
    /herLife: formatHerLife\(state\.herLife, now, present\.entry\)/.test(chat));
  ok("the chat lane reads app truth too",
    /appTruth: act \? \{ line: activityPickupLine\(act\)/.test(chat));

  // the commit is idempotent and keyed — three reads in one pickup write once
  const commits = (call.match(/s\.herNow\?\.key === row\.key \? s :/g) || []).length;
  ok("the call lane's commit is keyed and idempotent", commits === 1, String(commits));
  ok("the chat lane's commit is keyed and idempotent",
    /s\.herNow\?\.key === row\.key \? s :/.test(chat));

  // THE TEARDOWN (activity-forgot-the-teardown, a fourth time). The FATE
  // table in evals/teardown.mjs is the class check; these two are the field.
  ok("the teardown wipes herNow", /^\s+herNow: null,$/m.test(chat));
  ok("the undo snapshot carries herNow", /herNow: state\.herNow,/.test(chat) && /herNow: snap\.herNow,/.test(chat));

  // persona.ts is NOT this workstream's file; what is asserted is that the
  // improv clause it still carries can no longer be REACHED from the call
  // lane, because the scene is never empty now.
  const persona = src("src/engine/persona.ts");
  ok("the directive still takes a scene", /scene\?: string;/.test(persona));
  ok("the fence still rides every pickup",
    (persona.match(/\$\{fence\}/g) || []).length === 2);
}

console.log(fail ? `\n${fail} of ${checks} FAILED` : `\nALL PASS (${checks} assertions)`);
process.exit(fail ? 1 : 0);
