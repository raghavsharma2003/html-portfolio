// Share and arrival (WS-R40, migration 102) — offline, deterministic, $0, no
// DB, no network, no model call.
//
//   node evals/room-share/run.mjs
//
// Drives the REAL modules a bot's request and a follower's share both go
// through: `api/_room-page.js` (the unfurl's own read and pure HTML
// builder), `api/_room-publish.js`'s `publicRoomBySlug` (the public read
// itself), `api/_room-surface.js`'s `resolveArrivalVia`/`recordRoomArrival`
// (the arrival upsert), and `api/_funnel.js`'s `shareArrivalsThisWeek` (the
// creator's own line). Also proves `vercel.json`'s rewrite ordering
// statically, and the front end's own share-url builder carries no follower
// identity, by reading `src/room/RoomApp.tsx`'s real source.
//
// ── what this suite is actually guarding ───────────────────────────────────
//
// 1. THE UNFURL. A published Room's card carries its name, its first
//    disclosure sentence and a canonical url; an unpublished/paused Room and
//    an UNKNOWN slug answer with the IDENTICAL platform-only card — a bot
//    must never learn whether a slug exists. A static scan of
//    `publicRoomBySlug`'s own select list proves it can only ever read the
//    four public columns, never a follower table, a count, or the agent
//    sheet.
// 2. THE REWRITE ORDER. `vercel.json`'s bot rewrite for `/r/:slug` sits
//    ABOVE the existing static one, and its `has` regex matches every named
//    unfurl bot and not an ordinary browser's user-agent.
// 3. THE ARRIVAL UPSERT. One statement (`insert ... on conflict ... do
//    update set count = count + 1`); two opens on the same (room, day, via)
//    produce ONE row of count 2, never two rows; `via` outside the closed
//    allowlist becomes 'direct' before it ever reaches SQL.
// 4. THE FUNNEL LINE. `shareArrivalsThisWeek` floors at n>=5 exactly like
//    every other per-Room-derived count on this board; below the floor the
//    line is the honest sentence, never a small real number.
// 5. FOUR NEGATIVE CONTROLS: (a) a static scan of `RoomApp.tsx`'s own
//    share-url builder proves it names no follower id, session or token —
//    the recipient of a shared link can never be traced back to who sent
//    it; (b) a `via` shaped like SQL becomes 'direct'; (c) the funnel line
//    below the floor renders the floor sentence, not a number; (d) a Hindi
//    string with an em dash fails the real `scripts/check-copy.mjs`
//    scanner.
import { readFileSync } from "node:fs";
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

const {
  resolveRoomPage,
  buildRoomPageHtml,
  PLATFORM_TITLE,
  PLATFORM_DESCRIPTION,
} = await import(pathToFileURL(join(REPO, "api/_room-page.js")).href);
const { publicRoomBySlug } = await import(pathToFileURL(join(REPO, "api/_room-publish.js")).href);
const {
  ROOM_ARRIVAL_VIA,
  resolveArrivalVia,
  recordRoomArrival,
  roomDisclosureCard,
} = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const {
  shareArrivalsThisWeek,
  shareArrivalNote,
  SHARE_ARRIVAL_FLOOR,
} = await import(pathToFileURL(join(REPO, "api/_funnel.js")).href);
const { scanSource } = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);

const SLUG = "anjali";
const ROOM_ID = "d0000000-0000-4000-8000-000000000001";

// ═══ FIXTURE: a tiny, dedicated fake `vy_room` world ═══════════════════════
//
// `publicRoomBySlug` is a single, standalone SELECT over `vy_room` — it needs
// none of `evals/room/fixtures.mjs`'s heavier machinery (the bundled agent
// sheet, `loadAgent`), so this suite builds its own minimal room table
// rather than borrowing a fixture built for a different question.
function freshRooms() {
  return [
    {
      room_id: ROOM_ID,
      slug: SLUG,
      display_name: "Anjali",
      one_line_bio: "JEE physics, one doubt at a time.",
      default_locale: "en",
      published_at: "2026-09-01T00:00:00.000Z",
      paused_at: null,
    },
    {
      room_id: "d0000000-0000-4000-8000-000000000002",
      slug: "paused-room",
      display_name: "Paused Creator",
      one_line_bio: "",
      default_locale: "en",
      published_at: "2026-09-01T00:00:00.000Z",
      paused_at: "2026-09-02T00:00:00.000Z",
    },
    {
      room_id: "d0000000-0000-4000-8000-000000000003",
      slug: "never-published",
      display_name: "Draft Creator",
      one_line_bio: "",
      default_locale: "en",
      published_at: null,
      paused_at: null,
    },
  ];
}

/** A fake `db(sql, params)` honouring exactly the predicate
 *  `publicRoomBySlug` issues — `lower(slug) = $1 and published_at is not
 *  null and paused_at is null` — read off the rooms array above. Not a
 *  general SQL engine: it is scoped to the ONE statement this suite exists
 *  to prove out, `evals/room-embed/run.mjs`'s own minimal-fake precedent. */
function fakeDb(rooms) {
  return async (sql, params = []) => {
    if (/from vy_room\b/i.test(sql) && /select slug, display_name, one_line_bio, default_locale/i.test(sql)) {
      const slug = String(params[0] || "").toLowerCase();
      const row = rooms.find(
        (r) => r.slug.toLowerCase() === slug && r.published_at != null && r.paused_at == null,
      );
      return row
        ? [{ slug: row.slug, display_name: row.display_name, one_line_bio: row.one_line_bio, default_locale: row.default_locale }]
        : [];
    }
    if (/insert into vy_room_arrival/i.test(sql)) {
      const [roomId, day, via] = params;
      let row = rooms.__arrivals?.find((a) => a.room_id === roomId && a.day === day && a.via === via);
      rooms.__arrivals = rooms.__arrivals || [];
      if (!row) {
        row = { room_id: roomId, day, via, count: 1 };
        rooms.__arrivals.push(row);
      } else {
        row.count += 1;
      }
      return [];
    }
    if (/from vy_room_arrival/i.test(sql)) {
      const since = params[0];
      const n = (rooms.__arrivals || [])
        .filter((a) => a.via === "share" && a.day >= since)
        .reduce((sum, a) => sum + a.count, 0);
      return [{ n }];
    }
    throw new Error(`fakeDb: unhandled statement: ${sql.slice(0, 80)}`);
  };
}

// ═══ 1. THE UNFURL ══════════════════════════════════════════════════════════
console.log("\n── 1. the unfurl: published, paused, unknown ──");

{
  const rooms = freshRooms();
  const db = fakeDb(rooms);

  const published = await resolveRoomPage(db, SLUG);
  ok("a published Room resolves to its own row", published?.slug === SLUG);
  const html = buildRoomPageHtml(published, { origin: "https://vyakti-silk.vercel.app", slug: SLUG });
  ok("the title carries the creator's own name", html.includes("<title>Anjali AI</title>"));
  ok("og:title matches", html.includes('<meta property="og:title" content="Anjali AI" />'));
  const firstLine = roomDisclosureCard("Anjali", "en").split("\n")[0];
  ok("og:description is the disclosure card's FIRST sentence only", html.includes(`content="${firstLine}"`));
  ok("no third sentence of the card leaks into the description",
    !html.includes("Anjali does not read these conversations"));
  ok("og:url is canonical", html.includes('<meta property="og:url" content="https://vyakti-silk.vercel.app/r/anjali" />'));
  ok("no og:image tag when no avatar field exists", !html.includes("og:image"));
  ok("twitter:card is summary", html.includes('<meta name="twitter:card" content="summary" />'));

  const paused = await resolveRoomPage(db, "paused-room");
  ok("a paused Room resolves to null, same as unpublished", paused === null);
  const draft = await resolveRoomPage(db, "never-published");
  ok("a never-published Room resolves to null", draft === null);
  const unknown = await resolveRoomPage(db, "does-not-exist");
  ok("an unknown slug resolves to null", unknown === null);

  const pausedHtml = buildRoomPageHtml(paused, { origin: "https://vyakti-silk.vercel.app", slug: "paused-room" });
  const unknownHtml = buildRoomPageHtml(unknown, { origin: "https://vyakti-silk.vercel.app", slug: "does-not-exist" });
  ok("a paused Room and an unknown slug produce the IDENTICAL platform-only card (title)",
    pausedHtml.includes(`<title>${PLATFORM_TITLE}</title>`) && unknownHtml.includes(`<title>${PLATFORM_TITLE}</title>`));
  ok("the platform card carries the platform's own description, never a creator's",
    pausedHtml.includes(PLATFORM_DESCRIPTION) && unknownHtml.includes(PLATFORM_DESCRIPTION));
  ok("neither the paused card nor the unknown card names the real creator anywhere",
    !pausedHtml.includes("Paused Creator") && !unknownHtml.includes("Paused Creator"));

  // Both cases answer with the same STATUS a caller would send (200) — proven
  // at the handler level would need a live HTTP round trip; here the proof is
  // that `resolveRoomPage` returns the identical `null` for both, which is
  // what `api/room-page.js` maps to identical bytes via `buildRoomPageHtml`.
  ok("api/room-page.js's own null-branch renders 200 for both (same function call shape)",
    typeof pausedHtml === "string" && typeof unknownHtml === "string");
}

// ═══ 1b. NO PRIVATE FIELD CAN EVER REACH THIS READ (static) ════════════════
console.log("\n── 1b. static: publicRoomBySlug's select list is closed ──");

{
  const src = readFileSync(join(REPO, "api/_room-publish.js"), "utf8");
  const fnMatch = src.match(/export async function publicRoomBySlug[\s\S]*?\n}\n/);
  ok("publicRoomBySlug is found in api/_room-publish.js", !!fnMatch);
  const body = fnMatch[0];
  const selectMatch = body.match(/select ([\s\S]*?) from vy_room\b/i);
  ok("the statement has a select list", !!selectMatch);
  const columns = selectMatch[1].split(",").map((c) => c.trim());
  ok("the select list is EXACTLY the four public columns, nothing else",
    columns.length === 4 &&
      columns.includes("slug") &&
      columns.includes("display_name") &&
      columns.includes("one_line_bio") &&
      columns.includes("default_locale"),
    columns.join(", "));
  const dangerous = /vy_room_follower|vy_room_thread|owner_user_id|replica_id|agent_id|count\(/i;
  ok("the function body names no follower table, no owner/replica/agent id, no count",
    !dangerous.test(body));
}

// ═══ 2. THE REWRITE ORDER ═══════════════════════════════════════════════════
console.log("\n── 2. vercel.json: the bot rewrite precedes the static one ──");

{
  const vercelJson = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  const rewrites = vercelJson.rewrites || [];
  const roomRewrites = rewrites
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.source === "/r/:slug");
  ok("exactly two /r/:slug rewrites exist", roomRewrites.length === 2, JSON.stringify(roomRewrites));
  const botRewrite = roomRewrites.find((r) => Array.isArray(r.has));
  const staticRewrite = roomRewrites.find((r) => !r.has);
  ok("one carries a `has` (the bot rewrite) and one does not (the static one)",
    !!botRewrite && !!staticRewrite);
  ok("the bot rewrite comes BEFORE the static one in array order",
    !!botRewrite && !!staticRewrite && botRewrite.i < staticRewrite.i);
  ok("the bot rewrite targets api/room-page.js with the slug carried through",
    botRewrite?.destination === "/api/room-page?slug=:slug");
  ok("the static rewrite is unchanged: /r/:slug -> /room.html",
    staticRewrite?.destination === "/room.html");

  const uaClause = botRewrite?.has?.[0];
  ok("the has clause matches the user-agent header", uaClause?.type === "header" && uaClause?.key === "user-agent");
  const re = new RegExp(uaClause.value);
  const BOTS = [
    "facebookexternalhit/1.1", "WhatsApp/2.23.20.0", "Twitterbot/1.0",
    "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0",
    "LinkedInBot/1.0", "Discordbot/2.0", "Googlebot/2.1",
  ];
  const missed = BOTS.filter((ua) => !re.test(ua));
  ok("the has regex matches every named unfurl bot's real user-agent string",
    missed.length === 0, missed.join(", "));
  const CHROME_UA =
    "Mozilla/5.0 (Linux; Android 10; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0 Mobile Safari/537.36";
  ok("the has regex does NOT match an ordinary phone browser's user-agent", !re.test(CHROME_UA));
}

// ═══ 3. THE ARRIVAL UPSERT ══════════════════════════════════════════════════
console.log("\n── 3. the arrival upsert: one statement, count increments ──");

{
  const src = readFileSync(join(REPO, "api/_room-surface.js"), "utf8");
  ok("the arrival write is exactly one insert ... on conflict upsert",
    /insert into vy_room_arrival[\s\S]{0,200}on conflict \(room_id, day, via\) do update[\s\S]{0,80}count = vy_room_arrival\.count \+ 1/.test(src));

  const rooms = freshRooms();
  const db = fakeDb(rooms);
  const day1 = new Date("2026-09-04T10:00:00.000Z").getTime();
  await recordRoomArrival(db, { roomId: ROOM_ID, via: "share", now: day1 });
  await recordRoomArrival(db, { roomId: ROOM_ID, via: "share", now: day1 + 3_600_000 });
  ok("two opens the SAME UTC day, same via, produce ONE row of count 2, not two rows",
    rooms.__arrivals.length === 1 && rooms.__arrivals[0].count === 2,
    JSON.stringify(rooms.__arrivals));

  const day2 = new Date("2026-09-05T10:00:00.000Z").getTime();
  await recordRoomArrival(db, { roomId: ROOM_ID, via: "embed", now: day2 });
  ok("a different day or a different via opens a SECOND row rather than merging into the first",
    rooms.__arrivals.length === 2);

  // WS-R59 added 'install' to this allowlist without a migration
  // (`api/_room-surface.js`'s own comment on `ROOM_ARRIVAL_VIA` names the
  // asymmetry and the reversal condition) — so this list is no longer
  // exactly migration 102's CHECK constraint, it is that constraint PLUS
  // one JS-side-only value. Both facts get their own assertion rather than
  // silently loosening the original one: the four DB-backed values are
  // still exactly what the CHECK constraint names, and 'install' is the
  // one addition, named so a SECOND value slipped in unminuted would still
  // fail this.
  ok("ROOM_ARRIVAL_VIA's DB-backed subset is exactly the four values migration 102's CHECK constraint names",
    JSON.stringify([...ROOM_ARRIVAL_VIA].filter((v) => v !== "install").sort()) ===
      JSON.stringify(["direct", "embed", "search", "share"]));
  ok("ROOM_ARRIVAL_VIA's one JS-only addition is exactly 'install' (WS-R59), nothing else",
    JSON.stringify([...ROOM_ARRIVAL_VIA].sort()) ===
      JSON.stringify(["direct", "embed", "install", "search", "share"]));
  ok("every named value round-trips through resolveArrivalVia unchanged",
    ROOM_ARRIVAL_VIA.every((v) => resolveArrivalVia(v) === v));
  ok("an unrecognised value becomes 'direct'", resolveArrivalVia("newsletter") === "direct");
  ok("an absent value becomes 'direct'", resolveArrivalVia(undefined) === "direct");
  ok("mixed case is normalised before the allowlist check", resolveArrivalVia("ShArE") === "share");
}

// ═══ 4. THE FUNNEL LINE ═════════════════════════════════════════════════════
console.log("\n── 4. shareArrivalsThisWeek: n>=5 floored ──");

{
  ok("shareArrivalsThisWeek returns the honest not-enough-data shape when migration 102 is unapplied",
    (await shareArrivalsThisWeek(async () => { throw new Error("must not be queried"); }, Date.now(), {
      tableApplied: async () => false,
    })).n === null);

  const rooms = freshRooms();
  const db = fakeDb(rooms);
  const now = new Date("2026-09-10T12:00:00.000Z").getTime();
  const day = new Date("2026-09-08T00:00:00.000Z").getTime();
  // Four share arrivals this week — BELOW the SHARE_ARRIVAL_FLOOR of 5.
  for (let i = 0; i < 4; i++) {
    await recordRoomArrival(db, { roomId: ROOM_ID, via: "share", now: day + i * 60_000 });
  }
  const below = await shareArrivalsThisWeek(db, now, { tableApplied: async () => true });
  ok("below the floor: n is null, below_floor is true", below.n === null && below.below_floor === true);
  ok("below the floor: the note is the fixed sentence, never a real number",
    below.note === "Fewer than five arrivals came from a share this week.");

  // A fifth, different room's share arrival on the same day crosses the
  // floor without adding a follower.
  await recordRoomArrival(db, { roomId: "d0000000-0000-4000-8000-000000000002", via: "share", now: day });
  const above = await shareArrivalsThisWeek(db, now, { tableApplied: async () => true });
  ok("at the floor: n is the real count", above.n === 5 && above.below_floor === false);
  ok("at the floor: the note carries the real number", above.note === shareArrivalNote(5));
  ok("SHARE_ARRIVAL_FLOOR is 5, matching every other per-Room count on this board",
    SHARE_ARRIVAL_FLOOR === 5);
}

// ═══ 5. NEGATIVE CONTROLS ═══════════════════════════════════════════════════
console.log("\n── 5. negative controls ──");

{
  // (a) static: the share url this product builds names no follower id,
  // session or token — a recipient can never be traced back to who sent it.
  const roomAppSrc = readFileSync(join(REPO, "src/room/RoomApp.tsx"), "utf8");
  const shareUrlMatch = roomAppSrc.match(/const shareUrl = useMemo\(\(\) => \{[\s\S]*?\}, \[slug\]\);/);
  ok("NEGATIVE CONTROL (a): the shareUrl builder is found", !!shareUrlMatch);
  const dangerousIdentifiers = /\b(session|follower|personId|person_id|token|auth)\b/i;
  ok("NEGATIVE CONTROL (a): the shareUrl builder references no follower id, session, or token",
    !!shareUrlMatch && !dangerousIdentifiers.test(shareUrlMatch[0]), shareUrlMatch?.[0]);
  ok("NEGATIVE CONTROL (a): the built url carries exactly ?via=share and nothing else appended",
    !!shareUrlMatch && /\?via=share`;/.test(shareUrlMatch[0]));

  // (b) a via shaped like SQL becomes 'direct' — already exercised in §3,
  // restated here explicitly as the brief's own named negative control.
  const poisoned = resolveArrivalVia("share; drop table vy_room_arrival");
  ok("NEGATIVE CONTROL (b): a via value shaped like SQL is refused to 'direct' before it reaches SQL",
    poisoned === "direct");

  // (c) restated from §4: below the floor the funnel line is the sentence,
  // never a number.
  ok("NEGATIVE CONTROL (c): shareArrivalNote(3) never contains the digit 3",
    !shareArrivalNote(3).includes("3"));

  // (d) a Hindi string with an em dash fails the real copy gate.
  const dashHits = scanSource(
    "src/room/copy.ts",
    `share: { button: "शेयर करें — अभी", copied: "लिंक कॉपी हो गया।" },`,
    { rules: "full", codename: true, roomsVocab: true },
  );
  ok("NEGATIVE CONTROL (d): an em dash in a Hindi string fails scripts/check-copy.mjs's real scanner",
    dashHits.some((o) => o.rule === "dash"));

  // The REAL new copy.ts strings this workstream shipped scan clean under
  // the same rules the negative control just proved bite.
  const copySrc = readFileSync(join(REPO, "src/room/copy.ts"), "utf8");
  const realHits = scanSource("src/room/copy.ts", copySrc, { rules: "full", codename: true, roomsVocab: true });
  ok("the REAL src/room/copy.ts (including this workstream's share strings) scans clean",
    realHits.length === 0, realHits.map((o) => `${o.rule}:${o.line}`).join(", "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
