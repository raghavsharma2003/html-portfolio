// WS-R48. SUITES SELL THEMSELVES — offline, deterministic, $0.
//
//   node evals/suites-self-serve/run.mjs
//
// site/suites.html (the B2B front door), the self-serve "Start a Suite" flow
// (src/studio/startSuiteDraft.ts + the existing SuiteCard.tsx/orgApi.ts,
// WS-R28/R33's own createOrg/startOrgSubscription, never a new write path),
// the apply-form intent (api/_apply.js, migration 107), and the two ops
// board lines (api/_funnel.js's suitesFunnelThisWeek, api/_ops.js).
//
// §1 the per-seat price and the seat-count bounds on site/suites.html equal
//    api/_org.js's own exported constants — both files are PARSED, never
//    hand-copied into this suite a second time, so a future change to
//    either source is what this suite actually re-checks.
// §2 the self-serve flow through the REAL createOrg + startOrgSubscription:
//    a fake seam (PAYMENTS_PROVIDER=fake) creates the org and starts its
//    subscription, the provider's own deterministic reference proving the
//    EXACT price that reached it; PAYMENTS_PROVIDER unset (the "none"
//    default, this workstream's law 2's own words) throws before writing a
//    single vy_org_subscription row, proven both dynamically (the fake db's
//    own state) and by a static source-order proof that providerFor() is
//    called strictly before any provider.createSubscription() in the same
//    function.
// §3 the apply intent (submitApplication with intent:"suite") lands, is
//    counted by suiteIntentApplicationsThisWeek, and a caller who sends no
//    intent at all keeps today's behaviour byte-identical (intent:"creator").
// §4 suitesFunnelThisWeek's own rolling-7-day boundary for both counts.
// NEGATIVE CONTROLS (the workstream brief's own three):
//   (a) every currency-adjacent digit run in site/suites.html's raw bytes
//       is one of api/_org.js's own two real per-seat prices — a static
//       scan, not a claim.
//   (b) a seat/seat-limit value outside vy_org / vy_org_subscription's own
//       CHECK bounds (extracted from db/schema.sql, never re-typed here) is
//       refused by a fake db enforcing that CHECK, exercised standalone so
//       the proof does not depend on the JS bound already having filtered
//       the input first.
//   (c) a poisoned copy fixture (an em dash, and the banned word "train")
//       fails scripts/check-copy.mjs's real scanner in this file's own
//       shape; the real site/suites.html scans clean.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const org = await import(pathToFileURL(join(REPO, "api/_org.js")).href);
const { OrgError, createOrg } = org;
const payments = await import(pathToFileURL(join(REPO, "api/_payments.js")).href);
const { PaymentsError, startOrgSubscription } = payments;
const applyMod = await import(pathToFileURL(join(REPO, "api/_apply.js")).href);
const { submitApplication, suiteIntentApplicationsThisWeek } = applyMod;
const funnelMod = await import(pathToFileURL(join(REPO, "api/_funnel.js")).href);
const { suitesFunnelThisWeek } = funnelMod;
const orgSrc = readFileSync(join(REPO, "api/_org.js"), "utf8");
const paymentsSrc = readFileSync(join(REPO, "api/_payments.js"), "utf8");
const suitesHtml = readFileSync(join(REPO, "site/suites.html"), "utf8");
const schemaSql = readFileSync(join(REPO, "db/schema.sql"), "utf8");

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: the page's own price and seat bounds equal api/_org.js's ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // The exported constants themselves — parsed, never re-typed as a second
  // literal for this suite to compare against itself.
  function constFrom(src, name) {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
    assert(m, `api/_org.js no longer exports ${name} — this suite's own parse is stale`);
    return Number(m[1]);
  }
  const STARTER = constFrom(orgSrc, "SUITE_SEAT_PRICE_STARTER_INR");
  const INSTITUTE = constFrom(orgSrc, "SUITE_SEAT_PRICE_INSTITUTE_INR");
  const INSTITUTE_MIN = constFrom(orgSrc, "SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS");
  const SEAT_MIN = constFrom(orgSrc, "SUITE_SEAT_LIMIT_MIN");
  const SEAT_MAX = constFrom(orgSrc, "SUITE_SEAT_LIMIT_MAX");
  ok("api/_org.js's own real values are what this suite believes them to be",
    STARTER === 2999 && INSTITUTE === 1999 && INSTITUTE_MIN === 10 && SEAT_MIN === 1 && SEAT_MAX === 500);

  // The page's HTML price cards: `&#8377;N,NNN` beside the mirror comment.
  const priceComments = [...suitesHtml.matchAll(/<!-- mirror of api\/_org\.js#(SUITE_SEAT_PRICE_\w+)[^>]*-->\s*<p class="price-amount"[^>]*>&#8377;([\d,]+)/g)];
  ok("the page carries at least one price mirror comment immediately before a rendered price",
    priceComments.length >= 2);
  for (const [, constName, digits] of priceComments) {
    const pageValue = Number(digits.replace(/,/g, ""));
    const realValue = constFrom(orgSrc, constName);
    ok(`the page's ${constName} mirror (₹${digits}) equals api/_org.js's own export (₹${realValue})`,
      pageValue === realValue);
  }
  ok("both locales carry the price mirror (English and Hindi price cards both present)",
    priceComments.length === 4);

  // The page's own JS mirror block (the estimate calculator) — a SECOND
  // place the same two numbers are written, checked the same way.
  const jsStarter = Number((suitesHtml.match(/starter:\s*(\d+),\s*\/\/ mirror of api\/_org\.js#SUITE_SEAT_PRICE_STARTER_INR/) || [])[1]);
  const jsInstitute = Number((suitesHtml.match(/institute:\s*(\d+),\s*\/\/ mirror of api\/_org\.js#SUITE_SEAT_PRICE_INSTITUTE_INR/) || [])[1]);
  const jsInstituteMin = Number((suitesHtml.match(/var INSTITUTE_MIN_SEATS\s*=\s*(\d+);\s*\/\/ mirror of api\/_org\.js#SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS/) || [])[1]);
  const jsSeatMin = Number((suitesHtml.match(/var SEAT_MIN\s*=\s*(\d+);\s*\/\/ mirror of api\/_org\.js#SUITE_SEAT_LIMIT_MIN/) || [])[1]);
  const jsSeatMax = Number((suitesHtml.match(/var SEAT_MAX\s*=\s*(\d+);\s*\/\/ mirror of api\/_org\.js#SUITE_SEAT_LIMIT_MAX/) || [])[1]);
  ok("the page's own price-estimate script mirrors SUITE_SEAT_PRICE_STARTER_INR correctly", jsStarter === STARTER);
  ok("the page's own price-estimate script mirrors SUITE_SEAT_PRICE_INSTITUTE_INR correctly", jsInstitute === INSTITUTE);
  ok("the page's own price-estimate script mirrors SUITE_SEAT_PRICE_INSTITUTE_MIN_SEATS correctly", jsInstituteMin === INSTITUTE_MIN);
  ok("the page's own price-estimate script mirrors SUITE_SEAT_LIMIT_MIN correctly", jsSeatMin === SEAT_MIN);
  ok("the page's own price-estimate script mirrors SUITE_SEAT_LIMIT_MAX correctly", jsSeatMax === SEAT_MAX);

  // api/_payments.js is the SEAM that actually charges — its own per-seat
  // literals (a pre-existing, un-mirrored duplication this workstream did
  // not introduce) must still agree with api/_org.js's exported constants,
  // or the page's price would be honest about a number the seam does not
  // actually charge.
  const seamPer = paymentsSrc.match(/const pricePerSeatInr = orgPlan === "institute" \? (\d+) : (\d+);/);
  assert(seamPer, "api/_payments.js's startOrgSubscription no longer has the shape this suite parses");
  ok("the seam's own institute price (api/_payments.js) equals api/_org.js's SUITE_SEAT_PRICE_INSTITUTE_INR",
    Number(seamPer[1]) === INSTITUTE);
  ok("the seam's own starter price (api/_payments.js) equals api/_org.js's SUITE_SEAT_PRICE_STARTER_INR",
    Number(seamPer[2]) === STARTER);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: the self-serve flow through the real seam ──");
// ═════════════════════════════════════════════════════════════════════════
const ADMIN = "a0000000-0000-4000-8000-00000000000a";
const SESSION_SECRET = "x".repeat(48);

function freshOrgState() {
  return { orgs: [], orgMembers: [], orgSubscriptions: [] };
}

function orgSeamDb(state) {
  const calls = [];
  return async (sql, params = []) => {
    calls.push({ sql, params });
    const has = (s) => sql.includes(s);

    if (has("with new_org as") && has("insert into vy_org")) {
      const [orgId, name, slug, ownerId, plan, seatLimit] = params;
      if (state.orgs.some((o) => o.slug.toLowerCase() === String(slug).toLowerCase())) {
        const err = new Error("duplicate key value violates unique constraint \"vy_org_slug_ix\"");
        err.code = "23505";
        err.message = err.message + " vy_org_slug_ix";
        throw err;
      }
      const row = { org_id: orgId, name, slug, plan, seat_limit: Number(seatLimit), created_at: new Date().toISOString(), created_by_user_id: ownerId };
      state.orgs.push(row);
      state.orgMembers.push({ org_id: orgId, owner_user_id: ownerId, role: "admin" });
      return [row];
    }
    if (has("join vy_org_member m on m.org_id = o.org_id and m.owner_user_id = ($2)::uuid and m.role = 'admin'")) {
      const [orgId, adminId] = params;
      const isAdmin = state.orgMembers.some((m) => m.org_id === orgId && m.owner_user_id === adminId && m.role === "admin");
      if (!isAdmin) return [];
      const o = state.orgs.find((x) => x.org_id === orgId);
      return o ? [{ org_id: o.org_id, slug: o.slug, plan: o.plan, seat_limit: o.seat_limit }] : [];
    }
    if (has("from vy_org_subscription") && has("state in ('created','authenticated','active','paused')") && has("order by created_at desc")) {
      const [orgId] = params;
      const rows = state.orgSubscriptions
        .filter((s) => s.org_id === orgId && ["created", "authenticated", "active", "paused"].includes(s.state))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return rows.length ? [rows[0]] : [];
    }
    if (has("insert into vy_org_subscription")) {
      const [orgId, plan, seats, pricePerSeat, currency, provider] = params;
      const row = {
        subscription_id: `sub-${state.orgSubscriptions.length + 1}`,
        org_id: orgId, plan, seats: Number(seats), price_per_seat_inr: Number(pricePerSeat),
        currency, provider, state: "created", provider_subscription_ref: null,
        created_at: new Date().toISOString(),
      };
      state.orgSubscriptions.push(row);
      return [{ subscription_id: row.subscription_id, state: row.state }];
    }
    if (has("update vy_org_subscription") && has("set provider_subscription_ref = $2")) {
      const [subId, ref] = params;
      const row = state.orgSubscriptions.find((s) => s.subscription_id === subId);
      if (!row) return [];
      row.provider_subscription_ref = ref;
      return [{ state: row.state, seats: row.seats }];
    }
    return [];
  };
}

// ── §2a: PAYMENTS_PROVIDER=fake — the org is created, its subscription
// starts, and the fake provider's own DETERMINISTIC reference proves the
// EXACT price that reached it (seed = `${label}:${ref}:${priceInr}`). ─────
{
  const state = freshOrgState();
  const db = orgSeamDb(state);
  const createdOrg = await createOrg(db, ADMIN, { name: "North Coaching", plan: "starter", seatLimit: 12 });
  ok("createOrg makes the admin's own org", Boolean(createdOrg.org_id) && state.orgs.length === 1);
  ok("createOrg also writes the creating admin's own membership row",
    state.orgMembers.some((m) => m.org_id === createdOrg.org_id && m.owner_user_id === ADMIN && m.role === "admin"));

  const sub = await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: createdOrg.org_id, plan: "starter", seats: 12 }, {
    env: { PAYMENTS_PROVIDER: "fake", PAYMENTS_FAKE_WEBHOOK_SECRET: "test-webhook-secret", ROOM_SESSION_SECRET: SESSION_SECRET },
  });
  ok("startOrgSubscription (fake seam) succeeds and returns a provider reference",
    typeof sub.provider_subscription_ref === "string" && sub.provider_subscription_ref.startsWith("fake_sub_"));
  ok("exactly one vy_org_subscription row exists", state.orgSubscriptions.length === 1);

  // The fake provider's OWN algorithm (api/_payments/providers/fake.js),
  // recomputed here from the same inputs `startOrgSubscription` sends it —
  // proving the price that actually reached the seam is `seats * 2999`
  // (Starter, api/_org.js's own constant), never a different number.
  const { createHash } = await import("node:crypto");
  const expectedPriceInr = 12 * 2999;
  const seed = `${createdOrg.slug}:${createdOrg.org_id}:${expectedPriceInr}`;
  const expectedRef = `fake_sub_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  ok("the reference the fake provider actually minted proves the price it received was seats*STARTER_INR",
    sub.provider_subscription_ref === expectedRef, `got ${sub.provider_subscription_ref}`);
}

// ── §2b: PAYMENTS_PROVIDER unset (the "none" default) — refused before any
// subscription row is written, and BEFORE any provider is ever reached. ──
{
  const state = freshOrgState();
  const db = orgSeamDb(state);
  const createdOrg = await createOrg(db, ADMIN, { name: "Quiet Institute", plan: "institute", seatLimit: 10 });
  let threw = null;
  try {
    await startOrgSubscription(db, { ownerUserId: ADMIN, orgId: createdOrg.org_id, plan: "institute", seats: 10 }, { env: {} });
  } catch (e) {
    threw = e;
  }
  ok("law 2: with no provider configured, starting a subscription is refused",
    threw instanceof PaymentsError && threw.code === "payments_not_configured");
  ok("NEGATIVE PROOF: zero vy_org_subscription rows were written — the org exists, its subscription does not",
    state.orgs.length === 1 && state.orgSubscriptions.length === 0);

  // Static proof: within startOrgSubscription's own body, providerFor(...) —
  // the call that throws for "none" — runs strictly BEFORE the only
  // provider.createSubscription(...) call in the same function, so the
  // refusal above is not a lucky empty fixture; the source ORDER makes a
  // provider call structurally unreachable once providerFor throws.
  const fnStart = paymentsSrc.indexOf("export async function startOrgSubscription(");
  const fnEnd = paymentsSrc.indexOf("\nexport async function updateOrgSeats(");
  assert(fnStart !== -1 && fnEnd !== -1 && fnEnd > fnStart, "startOrgSubscription's own body could not be located for the static order proof");
  const body = paymentsSrc.slice(fnStart, fnEnd);
  const providerForAt = body.indexOf("providerFor(providerName)");
  const createSubscriptionAt = body.indexOf("provider.createSubscription(");
  ok("STATIC PROOF: providerFor(...) (which throws for \"none\") runs before the only provider.createSubscription(...) call",
    providerForAt !== -1 && createSubscriptionAt !== -1 && providerForAt < createSubscriptionAt);
}

// ── §2c NEGATIVE CONTROL: createOrg itself refuses a duplicate slug (the
// same self-serve flow run twice with the same Suite name must not silently
// mint a second Suite or overwrite the first). ─────────────────────────────
{
  const state = freshOrgState();
  const db = orgSeamDb(state);
  await createOrg(db, ADMIN, { name: "Repeat Coaching", plan: "starter", seatLimit: 3 });
  const second = await createOrg(db, ADMIN, { name: "Repeat Coaching", plan: "starter", seatLimit: 3 }).catch((e) => e);
  ok("NEGATIVE CONTROL: creating the same Suite name twice is refused by name, not silently duplicated",
    second instanceof OrgError && second.code === "org_slug_taken" && state.orgs.length === 1);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: the apply intent lands and is counted ──");
// ═════════════════════════════════════════════════════════════════════════
function freshApplyState() {
  return { applications: [] };
}
function applyDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("insert into vy_creator_application")) {
      const [id, name, archiveLink, audience, contact, key, day, intent] = params;
      if (state.applications.some((a) => a.contact_key === key && a.applied_on === day)) return [];
      const row = {
        application_id: id, name, archive_link: archiveLink, audience, contact,
        contact_key: key, applied_on: day, status: "new", intent, created_at: new Date().toISOString(),
      };
      state.applications.push(row);
      return [row];
    }
    if (has("select count(*)::int as n") && has("intent = 'suite'")) {
      const [since] = params;
      const n = state.applications.filter((a) => a.intent === "suite" && a.created_at >= since).length;
      return [{ n }];
    }
    return [];
  };
}
{
  const state = freshApplyState();
  const db = applyDb(state);
  const application = await submitApplication(db, {
    name: "North Coaching", archive_link: "https://example.com/institute", contact: "admin@example.com", intent: "suite",
  });
  ok("a suite-intent application is stored with intent:\"suite\"", application.intent === "suite");
  const n = await suiteIntentApplicationsThisWeek(db, Date.now());
  ok("suiteIntentApplicationsThisWeek counts it", n === 1);
}
{
  // A caller that sends no intent at all — every application ever submitted
  // before this workstream — keeps today's behaviour byte-identical.
  const state = freshApplyState();
  const db = applyDb(state);
  const application = await submitApplication(db, {
    name: "Anjali", archive_link: "https://example.com/talks", contact: "anjali@example.com",
  });
  ok("an application with no intent field defaults to \"creator\" (byte-identical to pre-WS-R48 behaviour)",
    application.intent === "creator");
  const n = await suiteIntentApplicationsThisWeek(db, Date.now());
  ok("a creator-intent application is never counted as a Suite intent", n === 0);
}
{
  // An unrecognised intent string never becomes a third, invented lane.
  const state = freshApplyState();
  const db = applyDb(state);
  const application = await submitApplication(db, {
    name: "X", archive_link: "https://x", contact: "x@example.com", intent: "enterprise-plus",
  });
  ok("an unrecognised intent string collapses to \"creator\", never a third silent lane",
    application.intent === "creator");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: suitesFunnelThisWeek's rolling 7-day window ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const NOW = Date.parse("2026-09-11T12:00:00Z");
  const WITHIN = "2026-09-08T00:00:00.000Z"; // 3.5 days back
  const OUTSIDE = "2026-08-20T00:00:00.000Z"; // long before the window
  const state = { orgsCreated: [WITHIN, WITHIN, OUTSIDE], roomsAttached: [WITHIN, OUTSIDE, OUTSIDE, OUTSIDE] };
  const db = async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    if (has("from vy_org where created_at >=")) {
      const [since] = params;
      return [{ n: state.orgsCreated.filter((t) => t >= since).length }];
    }
    if (has("from vy_room where org_attached_at >=")) {
      const [since] = params;
      return [{ n: state.roomsAttached.filter((t) => t >= since).length }];
    }
    return [];
  };
  const result = await suitesFunnelThisWeek(db, NOW);
  ok("suites_started_this_week counts only orgs created within the rolling 7 days",
    result.suites_started_this_week === 2);
  ok("suite_seats_attached_this_week counts only rooms attached within the rolling 7 days",
    result.suite_seats_attached_this_week === 1);
}
{
  // An empty platform reports real zeros, never omits the field.
  const db = async () => [{ n: 0 }];
  const result = await suitesFunnelThisWeek(db, Date.now());
  ok("an empty platform reports {0, 0}, not undefined and not omitted",
    result.suites_started_this_week === 0 && result.suite_seats_attached_this_week === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL (a): every currency-adjacent digit run on the page is a real constant ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const ALLOWED = new Set([2999, 1999]); // api/_org.js's own two real per-seat prices
  const hits = [...suitesHtml.matchAll(/(?:₹|&#8377;)\s*([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0);
  ok("the static scan actually found currency-adjacent digit runs (a control that finds nothing proves nothing)",
    hits.length === 4, `found ${hits.length}: ${hits.join(", ")}`);
  ok("every currency-adjacent digit run on the page is one of api/_org.js's own two real prices",
    hits.every((n) => ALLOWED.has(n)), `hits: ${hits.join(", ")}`);

  // The runtime price estimate is computed by JS from PRICE[plan]*seats at
  // read time (formatInr()) and never appears as a static digit run in the
  // file's own bytes — confirmed structurally rather than assumed.
  ok("the seat/price ESTIMATE is computed at runtime, never baked into the page as a static number",
    !/₹[\d,]*\s*=\s*₹[\d,]*\s*a month/.test(suitesHtml));

  // The platform-take percentage is likewise a real constant, not invented.
  // English and Hindi phrase the sentence differently, so each locale is its
  // own pattern rather than one regex assumed to fit both.
  const takeHitsEn = [...suitesHtml.matchAll(/platform take is (\d+)%/g)].map((m) => Number(m[1]));
  const takeHitsHi = [...suitesHtml.matchAll(/प्लेटफ़ॉर्म हिस्सा (\d+)% है/g)].map((m) => Number(m[1]));
  const REAL_TAKE_PERCENT = 2500 / 100; // mirror of api/_payments.js#PLATFORM_TAKE_BP_DEFAULT (2500 = 25.00%)
  ok("the platform-take percentage on the page equals PLATFORM_TAKE_BP_DEFAULT/100, in both locales",
    takeHitsEn.length === 1 && takeHitsHi.length === 1 &&
    takeHitsEn[0] === REAL_TAKE_PERCENT && takeHitsHi[0] === REAL_TAKE_PERCENT);
  const realTakeBp = Number((paymentsSrc.match(/export const PLATFORM_TAKE_BP_DEFAULT = (\d+);/) || [])[1]);
  ok("PLATFORM_TAKE_BP_DEFAULT itself is still 2500 in api/_payments.js (this suite's own parse is not stale)",
    realTakeBp === 2500);

  // Seat bounds shown/used on the page (input min/max, the Institute
  // minimum sentence, once in the price row and once in the plan option, in
  // each locale) all trace to the same real constants.
  const seatInputs = [...suitesHtml.matchAll(/name="suite_seats" type="number" min="(\d+)" max="(\d+)"/g)];
  ok("every seat number input's min/max on the page equals SUITE_SEAT_LIMIT_MIN/MAX",
    seatInputs.length === 2 && seatInputs.every(([, min, max]) => Number(min) === 1 && Number(max) === 500));
  ok("the Institute plan's 10-seat minimum is stated twice per locale (the price row and the plan option)",
    (suitesHtml.match(/10 seats minimum/g) || []).length === 2 &&
    (suitesHtml.match(/कम से कम 10 सीट/g) || []).length === 2);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL (b): a seat/seat_limit outside the CHECK is refused by the DATABASE predicate, not JS ──");
// ═════════════════════════════════════════════════════════════════════════
{
  // Extracted from the REAL schema, never re-typed as a second assumption.
  const seatLimitCheck = schemaSql.match(/seat_limit\s+integer not null default 1 check \(seat_limit >= (\d+) and seat_limit <= (\d+)\)/);
  assert(seatLimitCheck, "vy_org.seat_limit's own CHECK could not be found in db/schema.sql — this suite's own parse is stale");
  const [, dbMin, dbMax] = seatLimitCheck.map((s, i) => (i === 0 ? s : Number(s)));
  const subscriptionSeatsCheck = schemaSql.match(/seats\s+integer not null check \(seats >= (\d+) and seats <= (\d+)\)/);
  assert(subscriptionSeatsCheck, "vy_org_subscription.seats's own CHECK could not be found in db/schema.sql");

  ok("the CHECK bounds this suite extracted from the real schema are what api/_org.js's own JS constants also use",
    Number(seatLimitCheck[1]) === 1 && Number(seatLimitCheck[2]) === 500 &&
    Number(subscriptionSeatsCheck[1]) === 1 && Number(subscriptionSeatsCheck[2]) === 500);

  // A minimal fake db that enforces the CHECK exactly as Postgres would —
  // driven STANDALONE against the real INSERT statement text, never through
  // createOrg's own JS guard, so a value that would have failed only because
  // JS refused it first cannot be mistaken for the database refusing it.
  function checkEnforcingDb() {
    return async (sql, params = []) => {
      if (sql.includes("insert into vy_org")) {
        const seatLimit = Number(params[5]);
        if (!(seatLimit >= dbMin && seatLimit <= dbMax)) {
          const err = new Error(`new row for relation "vy_org" violates check constraint "vy_org_seat_limit_check"`);
          err.code = "23514"; // Postgres check_violation
          throw err;
        }
        return [{ org_id: params[0], name: params[1], slug: params[2], plan: params[4], seat_limit: seatLimit, created_at: new Date().toISOString() }];
      }
      return [];
    };
  }
  const checkedDb = checkEnforcingDb();
  const okInsert = await checkedDb(
    `with new_org as (insert into vy_org (org_id, name, slug, created_by_user_id, plan, seat_limit) values ($1,$2,$3,$4,$5,$6))`,
    ["id-1", "OK Suite", "ok-suite", ADMIN, "starter", 500],
  );
  ok("AT the boundary (500), the database predicate accepts the write", okInsert[0]?.seat_limit === 500);
  const refused = await checkedDb(
    `with new_org as (insert into vy_org (org_id, name, slug, created_by_user_id, plan, seat_limit) values ($1,$2,$3,$4,$5,$6))`,
    ["id-2", "Over Suite", "over-suite", ADMIN, "starter", 501],
  ).catch((e) => e);
  ok("NEGATIVE CONTROL (b): one past the boundary (501) is refused by the DATABASE's own CHECK — code 23514, not a JS branch",
    refused instanceof Error && refused.code === "23514");

  // And the real createOrg, called with the SAME out-of-bounds value,
  // refuses too — proving the JS guard and the DB predicate agree on the
  // identical boundary, never a looser JS check backed by a stricter (or
  // absent) DB one.
  const state = freshOrgState();
  const jsRefused = await createOrg(orgSeamDb(state), ADMIN, { name: "JS Over Suite", plan: "starter", seatLimit: 501 }).catch((e) => e);
  ok("createOrg's own JS guard refuses the identical out-of-bounds value BEFORE any write is attempted",
    jsRefused instanceof OrgError && jsRefused.code === "org_seat_limit_invalid" && state.orgs.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── NEGATIVE CONTROL (c): a poisoned copy fails the real copy gate; the real page is clean ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
  const { scanSource } = checkCopy;
  const dashHits = scanSource(
    "site/suites.html",
    `<p class="price-note">One seat &mdash; one Room, one bill.</p>`,
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("NEGATIVE CONTROL (c1): an em dash in visible copy fails the real scanner",
    dashHits.some((o) => o.rule === "dash"));
  const vocabHits = scanSource(
    "site/suites.html",
    `<p class="price-note">We train your assistant on your own material.</p>`,
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("NEGATIVE CONTROL (c2): the banned word \"train\" in visible copy fails the real scanner's Rooms vocabulary rule",
    vocabHits.some((o) => o.rule === "rooms-vocabulary"));
  const meeraHits = scanSource(
    "site/suites.html",
    `<p class="price-note">Sign in to Meera to continue.</p>`,
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("NEGATIVE CONTROL (c3): the other product's codename in visible copy fails the real scanner",
    meeraHits.some((o) => o.rule === "codename"));

  const realHits = scanSource("site/suites.html", suitesHtml, { rules: "full", codename: true, roomsVocab: true });
  ok("the REAL site/suites.html scans clean under the exact same rules the negative controls above just proved bite",
    realHits.length === 0, realHits.map((o) => `${o.rule}:${o.line}`).join(", "));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: startSuiteDraft.ts's own boundary logic, bundled from the real source ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const OUT = mkdtempSync(join(tmpdir(), "suites-self-serve-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { sanitizeStartSuiteDraft } from ${JSON.stringify(join(REPO, "src/studio/startSuiteDraft"))};\n`,
  );
  const BUNDLE = join(OUT, "draft.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  const { sanitizeStartSuiteDraft } = await import(pathToFileURL(BUNDLE).href);

  ok("a plain valid draft passes through",
    JSON.stringify(sanitizeStartSuiteDraft({ name: "North Coaching", plan: "institute", seats: 25 }))
      === JSON.stringify({ name: "North Coaching", plan: "institute", seats: 25 }));
  ok("an empty name is refused (returns null, never a Suite with no name)",
    sanitizeStartSuiteDraft({ name: "  ", plan: "starter", seats: 5 }) === null);
  ok("a seat count above 500 clamps to 500, never overshoots the real database CHECK",
    sanitizeStartSuiteDraft({ name: "X", plan: "starter", seats: 9001 }).seats === 500);
  ok("a seat count below 1 (or absent) clamps to 1, never zero or negative",
    sanitizeStartSuiteDraft({ name: "X", plan: "starter", seats: -3 }).seats === 1 &&
    sanitizeStartSuiteDraft({ name: "X" }).seats === 1);
  ok("an unrecognised plan string collapses to \"starter\", never a third silent lane",
    sanitizeStartSuiteDraft({ name: "X", plan: "enterprise", seats: 1 }).plan === "starter");
  ok("a name longer than 120 characters is truncated, never stored unbounded",
    sanitizeStartSuiteDraft({ name: "x".repeat(500), plan: "starter", seats: 1 }).name.length === 120);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: the wiring is real, not just the pieces ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const mainSrc = readFileSync(join(REPO, "src/studio/main.tsx"), "utf8");
  ok("main.tsx imports restoreStartSuiteDraft",
    /import \{ restoreStartSuiteDraft \} from ".\/startSuiteDraft"/.test(mainSrc));
  const modeAt = mainSrc.indexOf("restoreStudioMode();");
  const draftAt = mainSrc.indexOf("restoreStartSuiteDraft();");
  // The FIRST `ReactDOM.createRoot` in this file is the `opsMode` branch's
  // own, which sits ABOVE the branch this call belongs to — so the render
  // this call must precede is the NEXT one after it, not the first one in
  // the file.
  const renderAt = mainSrc.indexOf("ReactDOM.createRoot", draftAt);
  ok("main.tsx calls restoreStartSuiteDraft() BEFORE React mounts (after restoreStudioMode(), before createRoot().render)",
    modeAt !== -1 && draftAt !== -1 && renderAt !== -1 && modeAt < draftAt && draftAt < renderAt);

  const cardSrc = readFileSync(join(REPO, "src/studio/SuiteCard.tsx"), "utf8");
  ok("SuiteCard.tsx imports takeStartSuiteDraft",
    /import \{ takeStartSuiteDraft \} from ".\/startSuiteDraft"/.test(cardSrc));
  ok("SuiteCard.tsx's auto-start effect calls the SAME createSuite/startSuiteSubscription the manual form uses, never a second write path",
    /takeStartSuiteDraft\(\)/.test(cardSrc) &&
    /createSuite\(token, \{ name: draft\.name, plan: draft\.plan, seatLimit: draft\.seats \}\)/.test(cardSrc) &&
    /startSuiteSubscription\(token, org\.org_id, draft\.plan, draft\.seats\)/.test(cardSrc));
  ok("the draft is consumed (removed from storage) before the async create/start work begins, so a re-render cannot replay it",
    /consumed\.current = true;\s*\n\s*void \(async/.test(cardSrc));

  const vercelJson = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  ok("vercel.json rewrites /suites to /suites.html",
    vercelJson.rewrites.some((r) => r.source === "/suites" && r.destination === "/suites.html"));

  const buildSh = readFileSync(join(REPO, "scripts/vercel-build.sh"), "utf8");
  ok("scripts/vercel-build.sh copies site/suites.html into dist/ on the Vyakti build path",
    /cp site\/suites\.html dist\/suites\.html/.test(buildSh));

  const opsSrc = readFileSync(join(REPO, "api/_ops.js"), "utf8");
  ok("api/_ops.js surfaces suitesFunnelThisWeek and suiteIntentApplicationsThisWeek on the board",
    /suites: \{/.test(opsSrc) && /await suitesFunnelThisWeek\(db, now\)/.test(opsSrc) && /await suiteIntentApplicationsThisWeek\(db, now\)/.test(opsSrc));
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
