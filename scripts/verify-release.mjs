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
import { promisify } from "util";

const run = promisify(execFile);
const ROOT = new URL("..", import.meta.url).pathname;

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
await gate("typecheck", "npx", ["tsc", "-b"]);
await gate("prompt budget", "node", ["scripts/check-prompt-budget.mjs"]);
// The gates below all run the code. This one lints a file the code never reads,
// which is exactly why nothing caught it: `deploy-web.yml` gated a job on the
// `secrets` context, which GitHub does not evaluate there, so the file was
// INVALID and every run died at startup with zero jobs. Nine days, fifteen red
// runs, no auto-deploy, and the job whose purpose was to announce that the
// deploy was unconfigured never ran either.
await gate("workflow lint", "node", ["scripts/check-workflows.mjs"]);
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
await gate("motion lint", "node", ["scripts/check-motion.mjs"]);
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
await gate("engine bundle fresh", "node", ["scripts/build-engine-bundle.mjs", "--check"]);
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
await gate("stuck-turn endpoint", "node", ["evals/echosim/stucksim.mjs"]);
// Her voice must be the same voice on every lane that names it. The live lanes
// cannot be configured, so every lane that CAN choose has to match them — and
// when they disagreed once, a call that fell back mid-sentence swapped her for
// a different woman and was reported as "multiple personalities".
await gate("one voice", "node", ["scripts/verify-voice.mjs"]);
await gate("web build", "npx", ["vite", "build"]);
// The eval suite: parser cases, the persona invariants (crisis helplines,
// never-deny-AI, NEVER MANIPULATE, spoken register), and the D0 fixture
// integrity checks. run.mjs re-bundles from the REAL source on every run, so
// this is a gate on the tree being shipped, not on a frozen copy — the same
// reason tsc runs even though vite exits 0 with type errors.
await gate("eval suite", "node", ["evals/run.mjs"]);

// Relational-schema integrity: the zero-orphan sweep and the citation
// discipline (SPEC §4.2). Both are read-only sub-second queries against the
// live database, so they need NEON_URL — which the APK workflow does not have
// (api/_config.js is secrets-built only where deploys run). Skipping is
// PRINTED, never silent: a skipped gate that looks like a passed gate is how
// the meera_tel_session index shadowed its table for a day.
const hasDb = await import("../api/_config.js").then((c) => Boolean(c.NEON_URL), () => false);
if (hasDb) {
  console.log("\n── relational db gates ──");
  await gate("zero-orphan sweep", "node", ["scripts/relcheck.mjs"]);
  await gate("citation discipline", "node", ["scripts/check-citations.mjs"]);
  // Multiparty v1's two gates (G2 Gate 0, G3 withdraw) are OPT-IN because they
  // are the only gates in this file that WRITE: each builds migration 008 into
  // a wsmpb_test_* fixture namespace, asserts against it, drops it, and proves
  // zero residue. The read-only property of the block above is worth keeping,
  // and a gate that creates thirteen tables on every release check is not a
  // gate anyone leaves on. Run them when the multiparty layer changed, and
  // before the pilot — Gate 0 is ship-blocking for that, not for every build.
  if (mp) {
    console.log("\n── multiparty gates (--mp; these build and drop a fixture namespace) ──");
    await gate("gate 0 (disclosure ACL)", "node", ["evals/mp/gate0.mjs"]);
    await gate("multi-owner forget", "node", ["evals/mp/withdraw.mjs"]);
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
