// WS-R39. THE FOLLOWER'S OWN PAGE — offline, deterministic, $0.
//
//   node evals/room-account/run.mjs
//
// `roomSettings`/`roomSettingsReviewed` (api/_room-surface.js, migration 101)
// exercised through `evals/room-account/fixtures.mjs`'s own wrapper of the
// shared `evals/room/fixtures.mjs` fake `db` — that file's own header names
// why a new wrapper rather than an edit to the shared one.
//
// §1 the composed read carries every section (disclosure, follower state,
//    all three channels, price, the open offer, `settings_reviewed_at`) for
//    a follower whose rows exist in all of them.
// §2 a TWO-FOLLOWER world: B's `roomSettings` carries none of A's channel
//    state, price and offer are shared room facts and DO appear for both
//    (never a leak, since neither is anything a follower said), and B's own
//    `offer` is null because only A has one recorded.
// §3 the reviewed write is session-scoped: A's write never touches B's row.
// §4 the cap-reached offer: `roomSettings.offer` is null before an offer is
//    recorded, `{reason:"cap_reached"}` once `recordOffer` (the real
//    function) writes one, and dismiss (`roomDismissOffer`, the real
//    function) clears it — writing the outcome ONCE, never twice.
// §5 a static proof that `RoomApp.tsx`'s cap-reached card is gated on BOTH
//    `capped` and `capOffer`, not either alone.
// §6 both locales carry every new key this workstream added.
// NEGATIVE CONTROLS: (a) a body-supplied follower id is ignored by
// `roomSettingsReviewed` (there is no such parameter to smuggle one through,
// proven by trying); (b) the composed read's own SQL never selects a message
// column — a static scan of `roomSettings`'s real source text, with the
// scanner proven to bite on a deliberately poisoned copy; (c) a string with
// "clone" or an em dash fails `scripts/check-copy.mjs`.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  SLUG, ROOM_ID, USER_A, USER_B, PERSON_A, PERSON_B,
  loadFixtureAgent,
} from "../room/fixtures.mjs";
import { freshAccountState, accountDb } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "a".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const surfacePath = join(REPO, "api/_room-surface.js");
const room = await import(pathToFileURL(surfacePath).href);
const { joinRoom, roomSettings, roomSettingsReviewed, roomDismissOffer, roomDisclosureCard } = room;
const pg = await import(pathToFileURL(join(REPO, "api/_phase-gate.js")).href);
const { recordOffer } = pg;

const { engine, loadAgent } = await loadFixtureAgent(REPO);
const reply = async () => "same idea, one step further out.";
const personTables = async () => [];
const tableApplied = async () => true;
const deps = (extra = {}) => ({
  loadAgent, engine, reply, personTables, tableApplied,
  env: { ...process.env, ROOM_WHATSAPP_TEMPLATE_APPROVED: "1" },
  ...extra,
});

// ── shared two-follower world ───────────────────────────────────────────────
async function twoFollowerWorld() {
  const state = freshAccountState();
  const db = accountDb(state);
  const a = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: true }, deps());
  const b = await joinRoom(db, { slug: SLUG, authUserId: USER_B, ageAttested: true, memoryConsent: false }, deps());
  const followerA = state.followers.find((f) => f.person_id === PERSON_A);
  const followerB = state.followers.find((f) => f.person_id === PERSON_B);
  return { state, db, a, b, followerA, followerB };
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: the composed read carries every section ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { state, db, a, followerA } = await twoFollowerWorld();
  state.pushSubs.push({ follower_id: followerA.follower_id, revoked_at: null });
  state.waSubs.push({ follower_id: followerA.follower_id, phone_e164: "+919876543210", state: "active" });
  state.channelMap.push({
    channel_map_id: "cm-a", room_id: ROOM_ID, person_id: PERSON_A, follower_id: followerA.follower_id,
    channel: "telegram", channel_ref: "tg-a", checkins_enabled: true, stopped_code: null,
  });
  state.prices.push({ room_id: ROOM_ID, follower_price_inr: 299, currency: "INR" });
  await recordOffer(db, { roomId: ROOM_ID, personId: PERSON_A, followerId: followerA.follower_id, reason: "cap_reached", now: Date.now() });

  const settings = await roomSettings(db, { session: a.session }, deps());
  ok("room facts present", settings.room.slug === SLUG && typeof settings.room.name === "string");
  ok("the disclosure sentence is repeated, byte for byte", settings.disclosure === roomDisclosureCard("Anjali", "en"));
  ok("locale present", settings.locale === "en");
  ok("follower state (memory consent) present", settings.follower.remembers === true);
  ok("settings_reviewed_at starts null", settings.settings_reviewed_at === null);
  ok("push channel: subscribed", settings.channels.push.subscribed === true);
  ok("whatsapp channel: subscribed, masked, never the raw number",
    settings.channels.whatsapp.available === true &&
    settings.channels.whatsapp.subscribed === true &&
    settings.channels.whatsapp.phone_masked === "+91 ••••••••10" &&
    !JSON.stringify(settings.channels.whatsapp).includes("9876543210"));
  ok("telegram channel: connected and enabled", settings.channels.telegram.connected === true && settings.channels.telegram.checkins_enabled === true);
  ok("price present", settings.price?.price_inr === 299 && settings.price?.currency === "INR");
  ok("the open cap-reached offer is surfaced", settings.offer?.reason === "cap_reached");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §2: a two-follower world — B carries none of A's own state ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { state, db, a, b, followerA } = await twoFollowerWorld();
  state.pushSubs.push({ follower_id: followerA.follower_id, revoked_at: null });
  state.waSubs.push({ follower_id: followerA.follower_id, phone_e164: "+919876543210", state: "active" });
  state.channelMap.push({
    channel_map_id: "cm-a2", room_id: ROOM_ID, person_id: PERSON_A, follower_id: followerA.follower_id,
    channel: "telegram", channel_ref: "tg-a2", checkins_enabled: true, stopped_code: null,
  });
  await recordOffer(db, { roomId: ROOM_ID, personId: PERSON_A, followerId: followerA.follower_id, reason: "cap_reached", now: Date.now() });

  const settingsB = await roomSettings(db, { session: b.session }, deps());
  ok("B's push is off, though A's is on", settingsB.channels.push.subscribed === false);
  ok("B's whatsapp carries no phone at all, masked or otherwise",
    settingsB.channels.whatsapp.subscribed === false && settingsB.channels.whatsapp.phone_masked === null);
  ok("B's telegram is not connected", settingsB.channels.telegram.connected === false);
  ok("B has no open offer, though A does", settingsB.offer === null);
  ok("B's own answer (declined memory) is B's own, not A's", settingsB.follower.remembers === false);
  ok("neither follower's payload names the other's follower id anywhere",
    !JSON.stringify(settingsB).includes(followerA.follower_id));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §3: the reviewed write is session-scoped ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { db, a, b, followerA, followerB } = await twoFollowerWorld();
  const before = await roomSettings(db, { session: a.session }, deps());
  ok("never reviewed yet", before.settings_reviewed_at === null);

  const written = await roomSettingsReviewed(db, { session: a.session }, deps());
  ok("the write returns a real timestamp", typeof written.settings_reviewed_at === "string" && written.settings_reviewed_at.length > 0);

  ok("A's own row carries the new timestamp", followerA.settings_reviewed_at === written.settings_reviewed_at);
  ok("B's row is untouched", followerB.settings_reviewed_at == null);

  const after = await roomSettings(db, { session: a.session }, deps());
  ok("a fresh roomSettings read for A reflects the write", after.settings_reviewed_at === written.settings_reviewed_at);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §4: the cap-reached offer, recorded, surfaced, dismissed once ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { db, a, followerA } = await twoFollowerWorld();
  const before = await roomSettings(db, { session: a.session }, deps());
  ok("no offer before one is recorded", before.offer === null);

  const recorded = await recordOffer(db, { roomId: ROOM_ID, personId: PERSON_A, followerId: followerA.follower_id, reason: "cap_reached", now: Date.now() });
  ok("the offer was actually inserted", recorded.inserted === true);

  const withOffer = await roomSettings(db, { session: a.session }, deps());
  ok("the open offer now surfaces", withOffer.offer?.reason === "cap_reached");

  const dismissed = await roomDismissOffer(db, { session: a.session }, deps());
  ok("dismiss writes the outcome", dismissed.dismissed === true);

  const afterDismiss = await roomSettings(db, { session: a.session }, deps());
  ok("the dismissed offer no longer surfaces", afterDismiss.offer === null);

  const secondDismiss = await roomDismissOffer(db, { session: a.session }, deps());
  ok("a second dismiss finds nothing OPEN left to mark — the outcome is written ONCE", secondDismiss.dismissed === false);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §5: RoomApp.tsx's cap-reached card is gated on BOTH conditions ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const roomAppSrc = readFileSync(join(REPO, "src/room/RoomApp.tsx"), "utf8");
  ok("the JSX guard is capped AND capOffer, not either alone",
    roomAppSrc.includes("{capped && capOffer && (") &&
    !roomAppSrc.includes("{capOffer && !capped"));
  ok("the existing capped screen's own sentence is untouched (still rendered by its own block)",
    roomAppSrc.includes("{copy.quota.capped.title}") && roomAppSrc.includes("{copy.quota.capped.body}"));
  ok("dismissing the cap-reached card calls the SAME dismissOffer op, never a second one",
    roomAppSrc.includes("const dismissCapOffer = useCallback(() => {") &&
    /dismissCapOffer[\s\S]{0,200}dismissOffer\(session\)/.test(roomAppSrc));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── §6: both locales carry every new key ──");
// ═════════════════════════════════════════════════════════════════════════
{
  async function loadRoomCopy() {
    const OUT = mkdtempSync(join(tmpdir(), "room-account-eval-"));
    const ENTRY = join(OUT, "entry.ts");
    writeFileSync(
      ENTRY,
      `export { ROOM_COPY_TABLE } from ${JSON.stringify(join(REPO, "src/room/copy"))};\n`,
    );
    const BUNDLE = join(OUT, "copy.bundle.mjs");
    execSync(
      `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
      { cwd: REPO, stdio: "inherit" },
    );
    return import(pathToFileURL(BUNDLE).href);
  }
  const { ROOM_COPY_TABLE } = await loadRoomCopy();

  function paths(obj, prefix = "") {
    const out = [];
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (Array.isArray(v)) out.push(`${p}[${v.length}]`);
      else if (v && typeof v === "object") out.push(...paths(v, p));
      else out.push(p);
    }
    return out.sort();
  }

  for (const key of ["account", "capOffer", "settingsReminder"]) {
    const enPaths = paths(ROOM_COPY_TABLE.en[key]);
    const hiPaths = paths(ROOM_COPY_TABLE.hi[key]);
    ok(`copy.${key}: en and hi carry the exact same key set`,
      JSON.stringify(enPaths) === JSON.stringify(hiPaths),
      JSON.stringify(enPaths) !== JSON.stringify(hiPaths) ? `en=${enPaths.join(",")} hi=${hiPaths.join(",")}` : "");
    ok(`copy.${key}: neither locale is empty`, enPaths.length > 0);
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── NEGATIVE CONTROL (a): a body-supplied follower id is ignored ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const { db, a, followerA, followerB } = await twoFollowerWorld();
  // `roomSettingsReviewed`'s destructured parameter is `{ session }` alone —
  // there is no `followerId`/`follower_id` field it could read even if a
  // caller supplied one. Proven by actually supplying one naming the OTHER
  // follower and confirming the row that changes is still A's own.
  const result = await roomSettingsReviewed(
    db, { session: a.session, followerId: followerB.follower_id, follower_id: followerB.follower_id }, deps(),
  );
  ok("the write still lands on the session's own follower (A)", followerA.settings_reviewed_at === result.settings_reviewed_at);
  ok("B's row was never touched by the smuggled id", followerB.settings_reviewed_at == null);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── NEGATIVE CONTROL (b): the composed read's SQL never selects a message column ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const surfaceSrc = readFileSync(surfacePath, "utf8");
  const start = surfaceSrc.indexOf("export async function roomSettings(");
  const end = surfaceSrc.indexOf("export async function roomSettingsReviewed(");
  if (start < 0 || end < 0 || end <= start) {
    fail++;
    console.log("FAIL  could not isolate roomSettings's own source text");
  } else {
    const body = surfaceSrc.slice(start, end);
    const messageShaped = /select\s+\*|(\bcontent\b|\bbody\b|\bmessage\b)\s*(,|\bfrom\b)|from\s+meera_log|from\s+vy_room_thread\b/i;
    ok("the real roomSettings body never selects a message-shaped column", !messageShaped.test(body));

    // The scanner must actually BITE — proven against a deliberately
    // poisoned copy, `evals/pulse/run.mjs`'s own "hand-run the parser
    // before the real battery does" discipline restated for this suite's
    // own static check.
    const poisoned = body + "\n  await db(`select content from vy_room_thread where 1=1`, []);\n";
    ok("the SAME scanner catches a poisoned copy carrying a real message select", messageShaped.test(poisoned));
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("── NEGATIVE CONTROL (c): the copy gate bites ──");
// ═════════════════════════════════════════════════════════════════════════
{
  const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
  const { scanSource } = checkCopy;
  const cloneHit = scanSource(
    "src/room/copy.ts",
    'export const X = "talk to your clone anytime";',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("a string naming the banned word fails the copy gate", cloneHit.length > 0);
  const dashHit = scanSource(
    "src/room/copy.ts",
    'export const X = "your settings — always here";',
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("an em dash fails the copy gate", dashHit.length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
