// WS-R138. The creator's PRINTABLE payout statement:
// `api/_payout-statement-readable.js`'s pure `buildPayoutStatementReadableHtml`.
// `evals/room-export-readable/run.mjs`'s own shape, restated for money
// instead of a memory export: this suite never touches a database, never
// calls `api/_payments.js#payoutStatement`, and never needs a fake `db` at
// all - it drives the pure builder directly with GENERATED statement
// objects shaped exactly like `payoutStatement`'s own real return value
// (the four numbers, `rooms`, `suite_share_inr`/`suite_name`,
// `referral_rewards`, `tds_note`, the provider reference and state), the
// workstream brief's own law 3.
//
//   node evals/payout-statement-readable/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { buildPayoutStatementReadableHtml } = await import(
  pathToFileURL(join(REPO, "api/_payout-statement-readable.js")).href
);
const { gstSplit } = await import(pathToFileURL(join(REPO, "api/_receipt.js")).href);
const { TDS_DISCLOSURE_SENTENCE } = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);

// ── a small, seeded PRNG - deterministic across runs, `evals/room-doors/
//    shapes.mjs`'s own "a fixed seed, never Math.random" convention. ──────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260905);
const int = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const pick = (arr) => arr[int(0, arr.length - 1)];

const STATES = ["built", "pending_account", "queued", "sent", "settled", "failed"];

/** The builder's own `escapeHtml`, restated - this house's "a tiny helper is
 *  copied per module" convention, so this suite reads the document the same
 *  way a browser would rather than comparing against unescaped source text
 *  that never actually appears on the rendered page (`TDS_DISCLOSURE_
 *  SENTENCE` carries a real apostrophe, "India's Income Tax Act", which the
 *  builder correctly renders as `&#39;`). */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** One generated period, shaped exactly like `payoutStatement`'s own real
 *  return value (`api/_payments.js`) - never a shape this file invented. */
function genStatement(i) {
  // The SAME algebra `runPayoutRollup`'s own header spells out
  // (`api/_payments.js`): take_inr + creator_gross_inr = follower_gross_inr;
  // gross_inr = follower_gross_inr + suite_share_inr; net_inr =
  // (creator_gross_inr + suite_share_inr) - tds_inr. Not required for this
  // suite's own parity check (which reads the RENDERED document, never
  // re-derives the arithmetic - `evals/payouts/run.mjs` already gates that
  // invariant against the real `runPayoutRollup`), generated this way only
  // so a printed statement looks like a real one would.
  const takeInr = int(0, 5000);
  const creatorGrossInr = int(0, 20000);
  const followerGrossInr = takeInr + creatorGrossInr;
  const suiteShareInr = i % 3 === 0 ? 0 : int(100, 3000);
  const grossInr = followerGrossInr + suiteShareInr;
  const tdsInr = int(0, Math.floor((creatorGrossInr + suiteShareInr) / 10));
  const netInr = creatorGrossInr + suiteShareInr - tdsInr;
  const rewardCount = i % 4 === 0 ? 0 : int(1, 3);
  const state = pick(STATES);
  const roomCount = int(1, 3);
  const rooms = Array.from({ length: roomCount }, (_, r) => ({
    room_id: `${String(i).padStart(8, "0")}-0000-4000-8000-00000000000${r}`,
    slug: `room-${i}-${r}`,
    display_name: `Room ${i}-${r}`,
  }));
  const startMonth = i % 12; // 0-11
  const startYear = 2026 + Math.floor(i / 12);
  const endMonth = (startMonth + 1) % 12;
  const endYear = startMonth === 11 ? startYear + 1 : startYear;
  return {
    payout_id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
    period_start: `${startYear}-${String(startMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
    period_end: `${endYear}-${String(endMonth + 1).padStart(2, "0")}-01T00:00:00.000Z`,
    currency: "INR",
    rooms,
    gross_inr: grossInr,
    take_inr: takeInr,
    tds_inr: tdsInr,
    net_inr: netInr,
    suite_share_inr: suiteShareInr,
    suite_name: suiteShareInr > 0 ? `Suite ${i}` : null,
    referral_rewards: { count: rewardCount, forgone_inr: rewardCount * (299 + (i % 3) * 100) },
    follower_subscriptions: int(0, 40),
    state,
    provider_payout_ref: state === "built" || state === "pending_account" ? null : `fake_payout_${i}`,
    created_at: "2026-09-01T00:05:00.000Z",
    settled_at: state === "settled" ? "2026-09-02T00:00:00.000Z" : null,
    failure_reason: state === "failed" ? "account_closed" : null,
    tds_note: TDS_DISCLOSURE_SENTENCE,
  };
}

/** Every `INR <digits with commas>` figure the rendered document carries,
 *  as plain numbers - the document's own money format
 *  (`_payout-statement-readable.js#rupees`), read back rather than
 *  re-derived. */
function extractRupeeAmounts(html) {
  return [...html.matchAll(/INR ([\d,]+)/g)].map((m) => Number(m[1].replaceAll(",", "")));
}

/**
 * The parity check itself: every number `statement` carries, in the
 * rendered `html`, to the rupee. Returns a list of NAMED problems (empty =
 * parity holds) - `evals/room-leak/world.mjs#staticReachProblems`'s own
 * "return problems, assert the list is empty" shape, restated for money.
 */
function parityProblems(statement, html) {
  const problems = [];
  const amounts = extractRupeeAmounts(html);
  const has = (n) => amounts.includes(Number(n));
  if (!has(statement.gross_inr)) problems.push("gross_inr missing from the rendered document");
  if (!has(statement.take_inr)) problems.push("take_inr missing from the rendered document");
  if (!has(statement.tds_inr)) problems.push("tds_inr missing from the rendered document");
  if (!has(statement.net_inr)) problems.push("net_inr missing from the rendered document");
  if (Number(statement.suite_share_inr) > 0 && !has(statement.suite_share_inr)) {
    problems.push("suite_share_inr missing from the rendered document");
  }
  if (Number(statement.referral_rewards?.forgone_inr || 0) > 0 && !has(statement.referral_rewards.forgone_inr)) {
    problems.push("referral_rewards.forgone_inr missing from the rendered document");
  }
  const split = gstSplit({ amountInr: statement.take_inr });
  if (!has(split.taxable_value_inr)) problems.push("the platform take's GST taxable value missing from the rendered document");
  if (!has(split.total_tax_inr)) problems.push("the platform take's GST amount missing from the rendered document");
  if (split.taxable_value_inr + split.total_tax_inr !== Number(statement.take_inr)) {
    problems.push("the platform take's GST split does not sum back to take_inr");
  }
  return problems;
}

const N = 60;
const statements = Array.from({ length: N }, (_, i) => genStatement(i));

// ═════════════════════════════════════════════════════════════════════════
console.log(`§1 PARITY — every number equal to the JSON statement's, to the rupee, over ${N} generated periods, both locales`);
// ═════════════════════════════════════════════════════════════════════════
{
  let clean = 0;
  for (const statement of statements) {
    for (const loc of ["en", "hi"]) {
      const html = buildPayoutStatementReadableHtml(statement, loc);
      const problems = parityProblems(statement, html);
      if (problems.length === 0) clean++;
      else console.log(`  FAIL parity(${statement.payout_id}, ${loc}): ${problems.join("; ")}`);
    }
  }
  ok(`all ${N * 2} renders (${N} periods x 2 locales) pass parity with zero problems`, clean === N * 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§2 NEGATIVE CONTROL — a perturbed number fails parity, by name");
// ═════════════════════════════════════════════════════════════════════════
{
  const statement = genStatement(0);
  const html = buildPayoutStatementReadableHtml(statement, "en");
  ok("the real statement passes parity before any tampering", parityProblems(statement, html).length === 0);

  const tamperedNet = { ...statement, net_inr: statement.net_inr + 1 };
  const netProblems = parityProblems(tamperedNet, html);
  ok(
    "NEGATIVE CONTROL: a net_inr perturbed AFTER rendering is caught, named - the checker is not vacuously permissive",
    netProblems.some((p) => p.includes("net_inr")),
  );

  const tamperedGross = { ...statement, gross_inr: statement.gross_inr + 500 };
  const grossProblems = parityProblems(tamperedGross, html);
  ok(
    "NEGATIVE CONTROL: a gross_inr perturbed AFTER rendering is caught, named",
    grossProblems.some((p) => p.includes("gross_inr")),
  );

  const withSuite = { ...genStatement(1), suite_share_inr: 1234, suite_name: "Real Suite" };
  const htmlWithSuite = buildPayoutStatementReadableHtml(withSuite, "en");
  ok("a real Suite share passes parity", parityProblems(withSuite, htmlWithSuite).length === 0);
  const tamperedSuite = { ...withSuite, suite_share_inr: 4321 };
  ok(
    "NEGATIVE CONTROL: a suite_share_inr perturbed AFTER rendering is caught, named",
    parityProblems(tamperedSuite, htmlWithSuite).some((p) => p.includes("suite_share_inr")),
  );

  const withRewards = { ...genStatement(2), referral_rewards: { count: 3, forgone_inr: 897 } };
  const htmlWithRewards = buildPayoutStatementReadableHtml(withRewards, "en");
  ok("real referral rewards pass parity", parityProblems(withRewards, htmlWithRewards).length === 0);
  const tamperedRewards = { ...withRewards, referral_rewards: { count: 3, forgone_inr: 111 } };
  ok(
    "NEGATIVE CONTROL: a referral_rewards.forgone_inr perturbed AFTER rendering is caught, named",
    parityProblems(tamperedRewards, htmlWithRewards).some((p) => p.includes("referral_rewards")),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§3 NO SCRIPT, BOTH LOCALES, THE TDS SENTENCE VERBATIM");
// ═════════════════════════════════════════════════════════════════════════
{
  const statement = genStatement(3);
  let noScriptCount = 0;
  let langOkCount = 0;
  let tdsVerbatimCount = 0;
  let tdsTaggedEnCount = 0;
  const escapedTds = escapeHtml(TDS_DISCLOSURE_SENTENCE);
  const escapedTdsForRegex = escapedTds.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const loc of ["en", "hi"]) {
    const html = buildPayoutStatementReadableHtml(statement, loc);
    if (!/<script/i.test(html)) noScriptCount++;
    if (html.includes(`<html lang="${loc}">`)) langOkCount++;
    if (html.includes(escapedTds)) tdsVerbatimCount++;
    if (new RegExp(`<p lang="en">${escapedTdsForRegex}</p>`).test(html)) {
      tdsTaggedEnCount++;
    }
  }
  ok("NO SCRIPT: neither locale's document carries a <script> tag", noScriptCount === 2);
  ok("both locales set their own <html lang>", langOkCount === 2);
  ok("both locales render TDS_DISCLOSURE_SENTENCE VERBATIM - never re-typed, never re-translated", tdsVerbatimCount === 2);
  ok('the TDS sentence is tagged lang="en" in BOTH renders, including the Hindi one', tdsTaggedEnCount === 2);

  // No external resource either - `_room-export-readable.js`'s own proof
  // shape, restated: no <link>, no external script src, no <img>.
  const html = buildPayoutStatementReadableHtml(statement, "en");
  ok("no external stylesheet (<link>)", !/<link\b/i.test(html));
  ok("no image", !/<img\b/i.test(html));
  ok("no print button - the workstream brief's own words, `_room-export-readable.js`'s precedent", !/<button/i.test(html));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n§4 EDGE SHAPES — zero Suite share, zero referral rewards, a null provider ref, both settled and failed dates");
// ═════════════════════════════════════════════════════════════════════════
{
  const zeroed = {
    payout_id: "z0000000-0000-4000-8000-000000000000",
    period_start: "2026-08-01T00:00:00.000Z", period_end: "2026-09-01T00:00:00.000Z",
    currency: "INR", rooms: [], gross_inr: 0, take_inr: 0, tds_inr: 0, net_inr: 0,
    suite_share_inr: 0, suite_name: null, referral_rewards: { count: 0, forgone_inr: 0 },
    follower_subscriptions: 0, state: "built", provider_payout_ref: null,
    created_at: "2026-09-01T00:05:00.000Z", settled_at: null, failure_reason: null,
    tds_note: TDS_DISCLOSURE_SENTENCE,
  };
  const html = buildPayoutStatementReadableHtml(zeroed, "en");
  ok("a zero Suite share never mentions a Suite line at all", !/Suite seat share/i.test(html));
  ok("zero rooms renders the honest empty note, never an empty list", html.includes("No Room had activity in this period."));
  ok("a null provider reference renders the honest not-yet-sent note", html.includes("Not yet sent to a payment provider."));
  ok("zero parity problems even at the all-zero edge", parityProblems(zeroed, html).length === 0);

  const throwsOnMissing = (() => {
    try { buildPayoutStatementReadableHtml(null, "en"); return false; } catch { return true; }
  })();
  ok("buildPayoutStatementReadableHtml throws on a missing statement rather than rendering garbage", throwsOnMissing);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
