// One command that decides whether a build is shippable.
//
// Every ship so far has been verified by whichever checks were remembered at
// the time, which is how a build once went out from a mid-edit commit. The
// point of this file is that "verified" stops meaning "I ran some things" and
// starts meaning one reproducible list, with the failures printed together
// rather than the run stopping at the first one — when three things are broken
// you want to know that now, not across three round trips.
//
//   node scripts/verify-release.mjs                    → static gates only
//   node scripts/verify-release.mjs --mp               → also the multiparty gates
//   node scripts/verify-release.mjs --live <base-url>  → also probe production
//
// The live probes cost real money (they call her actual brain), so they are
// opt-in rather than default.
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { promisify } from "util";

const run = promisify(execFile);
// URL.pathname produces `/C:/...` on Windows, which is not a valid cwd there.
// fileURLToPath is the one cross-platform conversion for a file URL.
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const NODE = process.execPath;
const TSC = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
const VITE = new URL("../node_modules/vite/bin/vite.js", import.meta.url);

const args = process.argv.slice(2);
const liveAt = args.includes("--live") ? args[args.indexOf("--live") + 1] : null;
const mp = args.includes("--mp");

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "  ok  " : "FAIL  "}${name.padEnd(30)} ${detail ?? ""}`);
};

const gate = async (name, cmd, cmdArgs) => {
  const t0 = Date.now();
  try {
    await run(cmd, cmdArgs, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
    record(name, true, `${Date.now() - t0}ms`);
  } catch (e) {
    // the useful part of a failed build is its output, not the exit code
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n      ");
    record(name, false, `\n      ${out}`);
  }
};

console.log("── static gates ──");
await gate("typecheck", NODE, [fileURLToPath(TSC), "-b"]);
await gate("prompt budget", NODE, ["scripts/check-prompt-budget.mjs"]);
// The gates below all run the code. This one lints a file the code never reads,
// which is exactly why nothing caught it: `deploy-web.yml` gated a job on the
// `secrets` context, which GitHub does not evaluate there, so the file was
// INVALID and every run died at startup with zero jobs. Nine days, fifteen red
// runs, no auto-deploy, and the job whose purpose was to announce that the
// deploy was unconfigured never ran either.
await gate("workflow lint", NODE, ["scripts/check-workflows.mjs"]);
// The animation rejection checklist, mechanised. Same reasoning as the workflow
// lint above: it checks a property of files the code never reads, so no test
// that RUNS the code can see it. A design standard nobody enforces is a
// standard the next feature quietly breaks — and this repo already has a name
// for a guard that exists and is invoked by nothing.
//
// It has no taste and does not claim any: it catches the auto-blocks (animating
// layout, `transition: all`, scale(0), ease-in on UI, over-budget UI
// transitions, keyframes with no reduced-motion answer) and leaves judgment to
// eyes. Exceptions are written next to the code with a reason.
await gate("motion lint", NODE, ["scripts/check-motion.mjs"]);
// Board legibility floors + the ttt keyframe's explicit end state. Same
// species as the motion lint: properties of files the code never reads,
// invisible to every test that runs the code. Each numbered floor in it is
// a measured failure that shipped (1.27:1 black pieces, 1.18:1 ttt cells,
// marks that animated 1 -> 1 into permanent invisibility).
await gate("board legibility", NODE, ["scripts/check-contrast.mjs"]);
// The em-dash ban, on the half of the app it never bound: product chrome.
// She has stripTextingDashes on every bubble; the humans had nothing.
await gate("chrome copy", NODE, ["scripts/check-copy.mjs"]);
// WS-R42, "the money reconciles," law 3. A mirrored constant (the front end
// cannot import a server module, so a handful of numbers are kept in two
// files on purpose, `// mirror of api/<file>.js#<NAME>` marking each pair)
// is a place two numbers can silently drift apart — the enrollment
// sample-rate mirror three lines up already did this once for real. This
// gate parses the literal on both sides of every marker in src/ and
// site/suites.html and fails the moment they disagree. Offline, $0, a few ms.
await gate("mirrored constants", NODE, ["scripts/check-mirrors.mjs"]);
// The rate `services/voice-evidence/app.py`'s enhance stage EMITS and the rate
// `api/_audio/wav.js`'s probeEnrollmentWav DEMANDS are two numbers with no
// shared import (Node/Python, three deploy boundaries) that already drifted
// once: every enrollment reference shipped at 48 kHz while the gate before
// synthesis required 24 kHz, so "Preview my voice" failed closed after a ten
// minute GPU wait with `wav format unsupported`. Mirrored across all four
// sites and asserted equal here, with its own negative control, so they
// cannot drift apart again without this gate naming exactly which site moved.
await gate("enrollment sample rate", NODE, ["scripts/check-enrollment-sample-rate.mjs"]);
// The rate agreeing everywhere (above) does NOT prove the bytes at that rate
// carry real content above 8 kHz -- a 16 kHz-Nyquist signal upsampled to
// 24 kHz still reports 24 kHz truthfully. Measured on the owner's real
// enrollment reference (3455faac...): 0.46% of energy at/above 8 kHz, from
// `separate`'s sepformer-whamr16k running at 16 kHz on the whole reference
// before the WS-AS fix. This gate computes the spectrum with a real FFT and
// asserts a band-limited-but-full-rate-labelled clip is caught, with its own
// negative control (a synthetic clip with the identical defect shape) run on
// every invocation.
await gate("enrollment bandwidth", NODE, ["scripts/check-enrollment-bandwidth.mjs"]);
// The room path (api/tg.js and every future surface) does not import src/ — it
// reads the committed bundle api/_engine.gen.js. So a change to the engine that
// is not regenerated ships a DIFFERENT Meera to Telegram than the one every
// gate above just tested, and nothing says so.
//
// This guard already existed, already worked, and had caught real drift — and
// was invoked by nothing: no workflow, no npm script, not this file
// (`engine-bundle-check-uncalled`). That is `dead-writers` in a GUARD, which is
// the more dangerous half, because a dead writer produces no data and a dead
// guard produces false confidence. Wired here so the family of "exists and is
// connected to nothing" loses another member.
await gate("engine bundle fresh", NODE, ["scripts/build-engine-bundle.mjs", "--check"]);
// The stuck-turn watchdog (liveCall.ts STUCK_OPEN_MS). It is wired HERE rather
// than left beside the other echosim experiments because those are a manual
// before/after diff of an acoustic table, while this is a pass/fail behavioural
// assertion with its own negative control — the same test `dead-writers` says a
// suite must have to exist at all.
//
// It builds the real liveCall.ts standalone and drives it for 32 simulated
// seconds, so it costs ~20s. That is the price of the one defect that ends a
// call outright: with the watchdog disabled the uplink carries ZERO ms of
// silence across the whole call and she never answers again.
await gate("stuck-turn endpoint", NODE, ["evals/echosim/stucksim.mjs"]);
// Her voice must be the same voice on every lane that names it. The live lanes
// cannot be configured, so every lane that CAN choose has to match them — and
// when they disagreed once, a call that fell back mid-sentence swapped her for
// a different woman and was reported as "multiple personalities".
await gate("one voice", NODE, ["scripts/verify-voice.mjs"]);
await gate("web build", NODE, [fileURLToPath(VITE), "build"]);
// CAN A PERSON READ THE STUDIO. It has to run after the build because it opens
// the BUILT bundle in a real browser at 390, 834 and 1355px, on all three
// wizard steps, and measures what is on screen.
//
// It is here because the end to end journey reported 12 of 15 passing while the
// studio wrapped an 83 character paragraph one word per line: the journey asked
// "is there horizontal overflow" and "is the primary action above the fold",
// and a COLLAPSED COLUMN OVERFLOWS NOTHING. Nothing else in this file can see a
// layout, because every other gate reads files or runs logic.
//
// It needs no secret. It renders `studio-layout-fixture.html`, which is the
// real StudioApp with fixture props and a stubbed `/api`, precisely so this can
// run in CI. Its negative control is written down in its header: reintroduce
// the 58px rail and it fails naming the element; restore it and it passes.
await gate("layout readability", NODE, ["scripts/check-layout.mjs"]);
// WS-R49. CAN A PERSON ON A BAD CONNECTION AFFORD TO WAIT. Nothing before this
// gate measured what a follower on a Rs 12,000 Android phone on a busy cell
// actually waits for — "India-first" was a stated law with no check behind
// it. It renders the built /, /vyakti, /r/<slug> (via room-layout-fixture.html,
// the same signed-in-without-a-secret technique the layout gate above uses)
// and /studio (signed out) in real Chromium at 390x844 under CDP throttling
// shaped like a bad Indian 4G day (CPU 4x, 1.6Mbps/750Kbps/150ms — the
// long-standing Chrome DevTools/Lighthouse "Fast 3G" preset; see the file's
// own header for why that number rather than a clean "4G" one), three
// cold-cache runs each, against a named budget table (LCP, CLS, TBT, JS and
// font transfer bytes, no render-blocking third-party request). A miss names
// the target and the metric. See context/decisions.md#ws-r49-performance-
// budgets-are-a-throttled-simulation-not-a-device for the reversal condition.
await gate("performance budgets", NODE, ["scripts/check-performance.mjs"]);
// The eval suite: parser cases, the persona invariants (crisis helplines,
// never-deny-AI, NEVER MANIPULATE, spoken register), and the D0 fixture
// integrity checks. run.mjs re-bundles from the REAL source on every run, so
// this is a gate on the tree being shipped, not on a frozen copy — the same
// reason tsc runs even though vite exits 0 with type errors.
await gate("eval suite", NODE, ["evals/run.mjs"]);
// WS-R8. Vyakti Rooms' Phase 1 hard rule, named as its own gate rather than
// left to ride inside "eval suite": "the leak battery runs clean before a
// second follower joins any Room. No exception for a launch date." Offline,
// $0, ~6s — N followers (2, 5, 20) x 4 turns through the REAL follower lane
// and the REAL compiler, 16,080 retrieval checks + 441 boundary checks, 0
// leaks, two negative controls that must fail. See evals/room-leak/run.mjs's
// header for what it does and does not prove.
await gate("room leak battery", NODE, ["evals/room-leak/run.mjs"]);
// WS-R27. Export/forget completeness for the Room: a follower's "forget me"
// now writes a content-free receipt (migration 090,
// `vy_room_forget_receipt`), and this proves the other half nothing checked
// before — that `roomExport` names every person-lane Room table and
// `roomForget` clears every one of them, static (DDL scan against
// `roomExportManifest()`) plus dynamic (a real world through the real
// follower lane), with two negative controls that must fail. See
// evals/room-export/run.mjs's header for what it does and does not prove.
await gate("room export completeness", NODE, ["evals/room-export/run.mjs"]);
// WS-R38. THE DOOR BATTERY: every way into a Room, attacked offline through
// the REAL decision modules the thin HTTP doors call — forged/expired
// sessions, cross-Room sessions, body-supplied ids belonging to someone
// else, webhook replay and signature tampering, an owner bearer reaching
// for another owner's replica/org, rate-key malformation, invite-code
// guessing, and the OTP verify brute-force floor. The door list is
// enumerated by a static rule and asserted complete against api/'s own
// directory listing. See evals/room-doors/run.mjs's own header for what it
// proves, and this workstream's context entries for the two findings it
// fixed (session-TTL enforcement was missing on most session-consuming
// ops; a thread-creation door had no live-follower check at all).
await gate("room door battery", NODE, ["evals/room-doors/run.mjs"]);
// WS-R50. WCAG 2.1 A/AA over every follower and creator screen in both
// locales: axe-core in a real Chromium against the built output on
// 127.0.0.1:8933 (the layout gate owns 8931, WS-R49's performance gate
// owns 8932), reusing `check-layout.mjs`'s own fixtures rather than a
// third copy — plus a hand-written keyboard walk (axe cannot press a key),
// asserting Tab reaches every control, Enter/Space activates it, Escape
// closes an open panel, and focus is visibly marked. Zero `serious` or
// `critical` findings of either kind fails the build; `moderate`/`minor`
// axe findings are reported, not blocking — see
// `context/decisions.md#ws-r50-accessibility-impact-threshold` for the
// reversal condition. Runs in well under a minute; see
// `scripts/check-accessibility.mjs`'s own header for what it does and does
// not prove.
await gate("accessibility", NODE, ["scripts/check-accessibility.mjs"]);
// WS-R57. Named gate 21. `vercel.json` carried no `headers` block at all
// before this workstream: a Room that keeps years of a follower's own words
// shipped with no Content-Security-Policy, no HSTS, no frame protection, and
// no proof the dependency tree `npm install` pulls is the one `package-
// lock.json` says it is. This gate is two checks riding one file because
// both share the same posture every gate above it does: prove it against the
// real artifact, never a description of one. §1 loads the six real built
// pages the brief named (the Room and the studio via the same layout-fixture
// technique `check-layout.mjs`/`check-accessibility.mjs` already use for the
// identical "needs a secret to render for real" wall, plus `/`, `/vyakti`,
// `/suites`, `/creators`) in real Chromium on 127.0.0.1:8934 (never
// 8931-8933), applies `vercel.json`'s own headers exactly as Vercel would,
// and fails on any CSP violation, any missing header per route class, or a
// CSP looser than this workstream's own law. §2 runs `npm ci --dry-run`
// (lockfile integrity), `npm audit --omit=dev --audit-level=high` (a
// registry call that FAILS, never passes silently, if the registry is
// unreachable), and a scan for any dependency that runs an install script
// without being on the named, justified allowlist in `scripts/
// installScriptAllowlist.mjs`. See `scripts/check-headers.mjs`'s own header
// for the full route table and what each failure kind means.
await gate("security headers", NODE, ["scripts/check-headers.mjs"]);

// Relational-schema integrity: the zero-orphan sweep and the citation
// discipline (SPEC §4.2). Both are read-only sub-second queries against the
// live database, so they need NEON_URL — which the APK workflow does not have
// (api/_config.js is secrets-built only where deploys run). Skipping is
// PRINTED, never silent: a skipped gate that looks like a passed gate is how
// the meera_tel_session index shadowed its table for a day.
//
// WS-R: `process.env.NEON_URL ||` is not decoration. api/_db.js has ALWAYS
// read `process.env.NEON_URL || NEON_URL`, so an environment that supplies the
// connection string the ordinary way — an env var, which is how every CI
// runner and every `--stub` build does it — could reach the database perfectly
// well while this line looked only at the gitignored config and reported
// SKIPPED. The skip prints, so it was never silent; it was worse than silent,
// because it named a reason ("no NEON_URL in this environment") that was false.
// The one gate that proves nobody's forget has a hole in it was the gate this
// disagreement turned off.
const hasDb =
  Boolean(process.env.NEON_URL) ||
  (await import("../api/_config.js").then((c) => Boolean(c.NEON_URL), () => false));
if (hasDb) {
  console.log("\n── relational db gates ──");
  await gate("zero-orphan sweep", NODE, ["scripts/relcheck.mjs"]);
  await gate("citation discipline", NODE, ["scripts/check-citations.mjs"]);
  // Multiparty v1's two gates (G2 Gate 0, G3 withdraw) are OPT-IN because they
  // are the only gates in this file that WRITE: each builds migration 008 into
  // a wsmpb_test_* fixture namespace, asserts against it, drops it, and proves
  // zero residue. The read-only property of the block above is worth keeping,
  // and a gate that creates thirteen tables on every release check is not a
  // gate anyone leaves on. Run them when the multiparty layer changed, and
  // before the pilot — Gate 0 is ship-blocking for that, not for every build.
  if (mp) {
    console.log("\n── multiparty gates (--mp; these build and drop a fixture namespace) ──");
    await gate("gate 0 (disclosure ACL)", NODE, ["evals/mp/gate0.mjs"]);
    await gate("multi-owner forget", NODE, ["evals/mp/withdraw.mjs"]);
  } else {
    console.log("\n── multiparty gates: not run (pass --mp; see evals/mp/) ──");
  }
} else {
  console.log("\n── relational db gates: SKIPPED (no NEON_URL in this environment) ──");
}

if (liveAt) {
  console.log(`\n── live probes against ${liveAt} ──`);
  const base = liveAt.replace(/\/$/, "");

  const probe = async (name, path, body, check) => {
    const t0 = Date.now();
    try {
      const r = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const j = await r.json().catch(() => ({}));
      const why = check(r.status, j);
      record(name, why === true, why === true ? `${Date.now() - t0}ms` : String(why));
    } catch (e) {
      record(name, false, e.message);
    }
  };

  // Her brain. A 200 is not enough — an empty reply is a 200, and an empty
  // reply on a call is a turn where she just says nothing.
  await probe(
    "brain replies",
    "/api/chat",
    {
      system: "You are a helpful test harness. Answer in one short sentence.",
      messages: [{ role: "user", content: "say hello" }],
      max_tokens: 300,
    },
    (s, j) => (s !== 200 ? `http ${s}` : j.text ? true : "200 but empty reply"),
  );

  // The live voice cannot start without a token, so this is the single most
  // load-bearing endpoint in the product.
  await probe("live token mints", "/api/live-token", {}, (s, j) =>
    s !== 200 ? `http ${s}` : j.token ? true : "200 but no token",
  );

  // Her web lookup: proves she can answer something she does not know.
  await probe("web lookup", "/api/search", { q: "who won the 2025 ipl final" }, (s, j) =>
    s !== 200 ? `http ${s}` : j.facts ? true : "200 but no facts",
  );

  // The audit trail. If this is silently broken, every future diagnosis is
  // blind — and it fails soft by design, so nothing else would ever tell us.
  await probe(
    "diag accepts writes",
    "/api/diag",
    {
      device: "verify-release-probe",
      session: "verify-release",
      records: [{ scope: "app", event: "verify_probe", t: 0, detail: {}, at: Date.now() }],
    },
    (s, j) => (s !== 200 ? `http ${s}` : j.ok === true ? true : "accepted but not stored"),
  );

  // A tail bigger than the OLD cap, to prove the raised limit is really live:
  // this is the exact shape that once silently deleted her crisis helplines.
  await probe(
    "big tail not truncated",
    "/api/chat",
    {
      system: "You are a helpful test harness. Answer in one short sentence.",
      system_tail: "x".repeat(16_000),
      messages: [{ role: "user", content: "say hello" }],
      max_tokens: 300,
    },
    (s, j) => (s !== 200 ? `http ${s}` : j.text ? true : "200 but empty reply"),
  );
}

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length
    ? `\n${failed.length} of ${results.length} checks FAILED — not shippable:\n` +
        failed.map((f) => `  - ${f.name}`).join("\n")
    : `\nall ${results.length} checks passed`,
);
process.exit(failed.length ? 1 : 0);
