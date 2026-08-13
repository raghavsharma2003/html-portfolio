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
await gate("web build", "npx", ["vite", "build"]);
// The eval suite: parser cases, the persona invariants (crisis helplines,
// never-deny-AI, NEVER MANIPULATE, spoken register), and the D0 fixture
// integrity checks. run.mjs re-bundles from the REAL source on every run, so
// this is a gate on the tree being shipped, not on a frozen copy — the same
// reason tsc runs even though vite exits 0 with type errors.
await gate("eval suite", "node", ["evals/run.mjs"]);

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
