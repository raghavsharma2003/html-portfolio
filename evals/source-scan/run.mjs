// WS-R134. THE SHARED SOURCE-SCANNER TOKENIZER's own suite.
//
//   node evals/source-scan/run.mjs
//   node evals/run.mjs source-scan
//
// Offline, deterministic, $0, no network, no database, no model call.
//
// Three things, in order:
//
//   §1. `evals/lib/source-scan.mjs`'s own self-test (`selfTest()`), run here
//       under this suite's `ok()` bookkeeping so a failure shows up in the
//       normal registry output rather than only when someone happens to run
//       the library file directly.
//
//   §2. ONE FROZEN FIXTURE PER HISTORICAL TRAP this workstream's brief names
//       — a small, self-contained snippet reproducing the exact mechanism
//       that tripped a real scanner in a real wave, built to FAIL under the
//       OLD (raw-text) behaviour and PASS under the new, comment-stripping
//       one. `sound-gate-proved-by-silence` (context/rejected.md): a fixture
//       that cannot fail under the old behaviour proves nothing about the
//       fix, so every one of these is run both ways and both results are
//       checked.
//
//   §3. PARITY. Each of the four modified scanners (evals/room-leak/run.mjs,
//       evals/readiness/run.mjs, evals/incidents/run.mjs,
//       evals/room-doors/run.mjs) is run twice — once normally, once with
//       `--legacy` (which reverts that scanner's own comment-stripping calls
//       back to the original raw-text behaviour, see each file's own
//       header) — and the two outputs are diffed. On the REAL committed
//       tree today, no scanner has ever actually been tripped by a comment
//       (that is what "0 known live traps" below means), so the two outputs
//       must be BYTE-IDENTICAL; any difference here means either a real
//       trap exists in the tree right now (worth knowing) or this
//       workstream's own edit changed something it should not have, and
//       either way the diff is printed so a human can read it rather than
//       this suite guessing which.
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selfTest, stripComments, sqlTextOf, opLiteralsOf, importsOf } from "../lib/source-scan.mjs";
import { bodyFieldsOf } from "../room-doors/shapes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// ═════════════════════════════════════════════════════════════════════════
// §1. THE LIBRARY'S OWN SELF-TEST
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: evals/lib/source-scan.mjs's own self-test ──");
{
  const result = selfTest();
  for (const c of result.cases) ok(`[self-test] ${c.name}`, c.cond);
  console.log(`  ${result.pass} self-test cases passed, ${result.fail} failed`);
}

// ═════════════════════════════════════════════════════════════════════════
// §2. ONE FROZEN FIXTURE PER HISTORICAL TRAP
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: one frozen fixture per historical trap, old fails / new passes ──");

// ── ws-r28 / ws-r129: room-leak's scope-gate — a comment naming a guarded
// table (to say a function does NOT touch it) trips the identical
// `src.includes(table)` line a real query would.
// context/rejected.md#ws-r28-leak-battery-scanner-matches-prose-not-only-sql
// context/rejected.md#ws-r129-no-follower-level-timezone-or-quiet-hours-column
{
  const FIXTURE = [
    "// orgBoard never queries vy_room_follower or vy_room_thread itself —",
    "// it reuses api/_ops.js's own roomOverview instead.",
    "export function orgBoard() { return roomOverview(); }",
  ].join("\n");
  const ALLOWED = false; // this file is not in room-leak's ALLOWED/AGGREGATE_ONLY sets
  const oldTouchesTable = (src) => src.includes("vy_room_thread") || src.includes("vy_room_follower");
  const newTouchesTable = (src) => {
    const clean = stripComments(src);
    return clean.includes("vy_room_thread") || clean.includes("vy_room_follower");
  };
  ok("ws-r28/ws-r129 TRAP: the OLD raw-text scope-gate wrongly enters scope on a comment-only mention",
    !ALLOWED && oldTouchesTable(FIXTURE) === true);
  ok("ws-r28/ws-r129 FIX: the NEW comment-stripped scope-gate correctly stays out of scope",
    !ALLOWED && newTouchesTable(FIXTURE) === false);
}

// ── ws-r113 / ws-r122: readiness's paired-backtick regex — a short
// backtick-quoted identifier in a comment (under the 6-character minimum
// the span regex requires) fails to close as its own match and re-anchors
// on the NEXT backtick anywhere later in the file, sweeping an unrelated,
// pre-existing span into a bogus "rendered text" candidate.
// context/rejected.md#ws-r113-a-short-backtick-quoted-word-in-a-comment-desynced-a-source-scanning-regex-onto-a-pre-existing-comment
// context/rejected.md#ws-r122-readiness-comment-backtick-cascade-tripped-banned-word-scan
{
  // The exact ws-r113/ws-r122 mechanism: a SHORT backtick-quoted identifier
  // in a comment (content under the regex's own 6-character minimum) fails
  // to match as its own pair, so the global regex re-anchors on that pair's
  // OWN closing backtick as a fresh "opener" and hunts forward for whatever
  // backtick comes NEXT — here, a real, correctly-written template literal
  // several lines later. The banned word never needs its own backtick pair
  // at all: it only has to sit as ordinary prose somewhere in the gap that
  // bogus span swallows (ws-r122's own real incident: "REPLICA" sat inside
  // a plain double-quoted string, itself inside an unrelated comment, that
  // the desynced span's 104,146-character reach happened to cross).
  const FIXTURE = [
    "function ReadinessPanel() {",
    "  // uses `has` to check the loaded flag",
    "  // a failed read here looks like a clone that scored nothing",
    "  return renderPart();",
    "}",
    "const LABEL = `Still an apprentice, properly rendered here`;",
  ].join("\n");
  const BANNED = /\b(clone|replica|fine-?tune)s?\b/i;
  const oldRenderedText = (src) => (src.match(/`[^`]{6,}`/g) || []).join(" ");
  const newRenderedText = (src) => (stripComments(src).match(/`[^`]{6,}`/g) || []).join(" ");
  ok("ws-r113/ws-r122 TRAP: the OLD raw-source backtick scan desyncs past the short `has` pair and steals the real LABEL literal's own opening backtick, reading the comment's plain-prose \"clone\" as if it were rendered text",
    BANNED.test(oldRenderedText(FIXTURE)));
  ok("ws-r113/ws-r122 FIX: the NEW comment-stripped scan finds no banned word — the short pair and the surrounding comment are gone before the backtick regex ever runs, so nothing is left to desync onto",
    !BANNED.test(newRenderedText(FIXTURE)));
}

// ── ws-r127: a scanner's own header comment explaining what a function does
// NOT do trips the identical banned-substring regex a real violation would.
// context/rejected.md#ws-r127-own-eval-static-scan-tripped-by-its-own-prose
{
  const FIXTURE = [
    "// _email-seam.js: no fetch, no SMTP client. Never a network call.",
    "export function emailSeamConfigured() { return false; }",
  ].join("\n");
  const BANS = /smtp|sendgrid|ses\./i;
  ok("ws-r127 TRAP: the OLD raw-source scan flags the header comment's own honest description",
    BANS.test(FIXTURE));
  ok("ws-r127 FIX: the NEW comment-stripped scan finds nothing to flag",
    !BANS.test(stripComments(FIXTURE)));
}

// ── the door-battery's account block regex: a comment anywhere between one
// op's `if (op === "...")` and the real next one — including one that
// itself quotes that exact shape — is found as if it were the next op's
// real boundary, truncating the current op's block before a later guard.
{
  const FIXTURE = [
    'if (op === "send_otp") {',
    "  // legacy note: this used to also check",
    '  // if (op === "send_otp_old") for a since-removed code path.',
    "  String(b.email || \"\");",
    "  guardEmailShape();",
    "}",
    'if (op === "verify_otp") {',
    "  String(b.token || \"\");",
    "}",
  ].join("\n");
  function accountOpBlockOld(src, op) {
    const start = src.indexOf(`if (op === "${op}")`);
    if (start === -1) return null;
    const nextIf = src.indexOf('if (op === "', start + 10);
    return src.slice(start, nextIf === -1 ? src.length : nextIf);
  }
  function accountOpBlockNew(src, op) {
    return accountOpBlockOld(stripComments(src), op);
  }
  const oldBlock = accountOpBlockOld(FIXTURE, "send_otp");
  const newBlock = accountOpBlockNew(FIXTURE, "send_otp");
  ok("account-block TRAP: the OLD raw-text indexOf truncates send_otp's block at the COMMENT's own quoted op literal, before the real guard",
    !oldBlock.includes("guardEmailShape"));
  ok("account-block FIX: the NEW comment-stripped indexOf reaches the real next op, keeping send_otp's own guard in its block",
    newBlock.includes("guardEmailShape") && !newBlock.includes("verify_otp"));
}

// ── room-doors §18: a comment mentioning an `op === "x"`/`format === "x"`
// literal injects a phantom op/format the real dispatch never casts.
{
  const FIXTURE = [
    "// old code: if (op === \"legacy_delete\") { ... }",
    'if (op === "join") {',
    '  if (body.format === "html") { render(); }',
    "}",
  ].join("\n");
  const oldOps = (src) => [...new Set([...src.matchAll(/(?:body\.)?op === "([a-z_]+)"/g)].map((m) => m[1]))].sort();
  ok("room-doors §18 TRAP: the OLD raw-source op scan invents a phantom op from the comment",
    JSON.stringify(oldOps(FIXTURE)) === JSON.stringify(["join", "legacy_delete"]));
  ok("room-doors §18 FIX: the NEW comment-stripped scan finds only the real op",
    JSON.stringify([...new Set(opLiteralsOf(FIXTURE, "op").map((h) => h.name))].sort()) === JSON.stringify(["join"]));
}

// ── shapes.mjs's bodyFieldsOf: a comment inside an OP_INVOKE entry
// mentioning a `body.<field>` the function does not actually read inflates
// the derived fuzz-field list with a phantom field.
{
  const fn = function fakeOp(db, body) {
    // does NOT read body.secret_admin_override — mentioned here only to
    // explain why this op deliberately ignores it.
    return body.email;
  };
  ok("shapes.mjs bodyFieldsOf TRAP: legacy mode (raw fn.toString()) picks up the comment's phantom field",
    bodyFieldsOf(fn, { legacy: true }).includes("secret_admin_override"));
  ok("shapes.mjs bodyFieldsOf FIX: comment-stripped mode (the default) finds only the real field read",
    JSON.stringify(bodyFieldsOf(fn)) === JSON.stringify(["email"]));
}

// ── sqlTextOf: a comment mentioning a table inside a fake `select` does not
// read as a real SQL statement the way a template literal does.
{
  const FIXTURE = '// select * from vy_room_follower\nconst q = `select count(*) from vy_room_follower`;';
  const pieces = sqlTextOf(FIXTURE);
  ok("sqlTextOf: a `select` written only in a comment contributes no piece",
    !pieces.some((p) => p.includes("select *")));
  ok("sqlTextOf: the real template-literal statement's content is still found",
    pieces.some((p) => p.includes("select count(*) from vy_room_follower")));
}

// ── importsOf: a comment naming a dangerous writer symbol does not add a
// phantom import edge to the follower lane's reach graph.
{
  const FIXTURE = '// this file intentionally never imports { extractOwnedClaims } from "./_replica-claims.js"\nimport { loadNeverRules } from "./_replica-claims.js";';
  const r = importsOf(FIXTURE);
  ok("importsOf: a writer symbol named only in a comment is not reported as imported",
    !r.names.includes("extractOwnedClaims"));
  ok("importsOf: the real, non-dangerous import is still found",
    r.names.includes("loadNeverRules") && r.files.includes("_replica-claims.js"));
}

// ═════════════════════════════════════════════════════════════════════════
// §3. PARITY — the four modified scanners, normal vs `--legacy`, on the
// REAL committed tree. Byte-identical is the expected result: this repo's
// tree carries no live trap of the kind §2 fabricates above.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: parity — modified scanners, normal vs --legacy, on the real tree ──");

function runSuite(relFile, extraArgs = []) {
  try {
    const out = execFileSync(process.execPath, [join(REPO, relFile), ...extraArgs], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return { ok: true, out };
  } catch (error) {
    return { ok: false, out: (error.stdout || "") + (error.stderr || "") };
  }
}

// A line-by-line diff that ignores known-nondeterministic noise (a fresh
// UUID, a wall-clock timestamp, a wall-clock duration) rather than a byte
// diff, so this check is not itself flaky on a suite (room-leak) whose own
// fixture world mints real UUIDs and timestamps per run.
const NOISE_LINE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\d{4}-\d{2}-\d{2}T[\d:.]+Z|\b\d+ms\b/;
function normalizedDiff(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  if (al.length !== bl.length) return `line count differs: ${al.length} vs ${bl.length}`;
  const diffs = [];
  for (let i = 0; i < al.length; i++) {
    if (al[i] === bl[i]) continue;
    if (NOISE_LINE.test(al[i]) && NOISE_LINE.test(bl[i])) continue;
    diffs.push(`line ${i + 1}:\n    old: ${al[i]}\n    new: ${bl[i]}`);
  }
  return diffs.length ? diffs.join("\n") : null;
}

for (const relFile of [
  "evals/room-leak/run.mjs",
  "evals/readiness/run.mjs",
  "evals/incidents/run.mjs",
  "evals/room-doors/run.mjs",
]) {
  const modern = runSuite(relFile);
  const legacy = runSuite(relFile, ["--legacy"]);
  const diff = normalizedDiff(modern.out, legacy.out);
  ok(`[parity/${relFile}] normal and --legacy exit the same way`, modern.ok === legacy.ok);
  ok(`[parity/${relFile}] normal and --legacy findings are identical on the real tree (modulo fresh UUIDs/timestamps/durations)`,
    diff === null, diff || "");
}

console.log(`\nsource-scan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
