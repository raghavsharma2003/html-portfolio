// The creator directory and search presence (WS-R45) — offline,
// deterministic, $0, no DB, no network, no model call.
//
//   node evals/creator-directory/run.mjs
//
// Drives the REAL `api/_creators.js` (the directory read), `api/_sitemap.js`
// (the crawler feed) and the `listRoom`/`unlistRoom`/`setRoomBio` ops added
// to `api/_room-publish.js`, all through a fake `db` — the code path a
// browser or a crawler reaches is the code path this suite reaches, and only
// the database and the HTTP layer are replaced. The JSON-LD builder is
// pulled out of `site/creators.html`'s own real source text and executed,
// never reimplemented, so a change to that file that breaks the shape this
// suite checks fails here rather than only in a browser nobody is looking at.
import assert from "node:assert/strict";
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

const { readCreatorsPage, encodeCreatorsCursor, decodeCreatorsCursor } = await import(
  pathToFileURL(join(REPO, "api/_creators.js")).href
);
const { buildSitemapXml } = await import(pathToFileURL(join(REPO, "api/_sitemap.js")).href);
const {
  listRoom,
  unlistRoom,
  setRoomBio,
  RoomPublishError,
} = await import(pathToFileURL(join(REPO, "api/_room-publish.js")).href);

// ── the fixture world ───────────────────────────────────────────────────
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function room(overrides = {}) {
  return {
    room_id: overrides.room_id,
    slug: overrides.slug,
    replica_id: overrides.room_id,
    agent_id: overrides.room_id,
    owner_user_id: OWNER,
    display_name: overrides.display_name ?? "",
    free_monthly_messages: 20,
    paid_monthly_messages: 500,
    paid_monthly_voice_seconds: 1800,
    default_locale: overrides.default_locale ?? "en",
    one_line_bio: overrides.one_line_bio ?? "",
    listed_at: overrides.listed_at ?? null,
    published_at: overrides.published_at ?? null,
    paused_at: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function freshState() {
  return {
    rooms: [
      // listed AND published — must appear everywhere.
      room({
        room_id: "c1000000-0000-4000-8000-000000000001",
        slug: "arjun-physics",
        display_name: "Arjun Sir",
        one_line_bio: "JEE physics, one topic a day.",
        default_locale: "en",
        listed_at: "2026-09-04T09:00:00Z",
        published_at: "2026-08-01T00:00:00Z",
      }),
      // listed but NEVER published (defensive: the write predicate refuses
      // this combination, but a directory reader must never trust the
      // writer alone — brief law 1's "in the same WHERE, never one without
      // the other").
      room({
        room_id: "c1000000-0000-4000-8000-000000000002",
        slug: "unpublished-but-listed",
        display_name: "Ghost Room",
        listed_at: "2026-09-04T08:00:00Z",
        published_at: null,
      }),
      // published but not listed — must be absent from both the directory
      // and the sitemap.
      room({
        room_id: "c1000000-0000-4000-8000-000000000003",
        slug: "quiet-room",
        display_name: "Quiet Creator",
        listed_at: null,
        published_at: "2026-08-01T00:00:00Z",
      }),
      // listed and published, older — proves the ordering.
      room({
        room_id: "c1000000-0000-4000-8000-000000000004",
        slug: "priya-hindi",
        display_name: "प्रिया",
        default_locale: "hi",
        one_line_bio: "हिन्दी में बात करें।",
        listed_at: "2026-09-01T09:00:00Z",
        published_at: "2026-08-01T00:00:00Z",
      }),
      // neither published nor listed — a brand new Room, never touched.
      room({
        room_id: "c1000000-0000-4000-8000-000000000005",
        slug: "draft-room",
        display_name: "Draft Creator",
        listed_at: null,
        published_at: null,
      }),
    ],
  };
}

/** The one fake `db`, matched on a substring unique to each real statement -
 *  `evals/room-publish/run.mjs`'s own discipline, checked in most-specific-
 *  first order for the same reason that file gives. */
function makeDb(state) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });

    if (sql.includes("insert into vy_room")) {
      const [roomId, slug, replicaId, agentId, ownerId, displayName] = params;
      const row = room({
        room_id: roomId, slug, replica_id: replicaId, agent_id: agentId,
        owner_user_id: ownerId, display_name: displayName,
      });
      state.rooms.push(row);
      return [{ ...row }];
    }

    if (sql.includes("set listed_at = case")) {
      const [ownerId, replicaId] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      if (!r) return [];
      if (r.published_at != null && !r.listed_at) r.listed_at = "2026-09-04T12:00:00Z";
      return [{ ...r }];
    }

    if (sql.includes("set listed_at = null")) {
      const [ownerId, replicaId] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      if (!r) return [];
      r.listed_at = null;
      return [{ ...r }];
    }

    if (sql.includes("set one_line_bio = $3")) {
      const [ownerId, replicaId, bio] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      if (!r) return [];
      r.one_line_bio = bio;
      return [{ ...r }];
    }

    // The directory read — `api/_creators.js`'s own statement.
    if (sql.includes("select room_id, display_name, slug, one_line_bio, default_locale, listed_at")) {
      const [limit, cursorListedAt, cursorRoomId] = params;
      let rows = state.rooms
        .filter((r) => r.listed_at != null && r.published_at != null)
        .sort((a, b) => (a.listed_at < b.listed_at ? 1 : a.listed_at > b.listed_at ? -1 : (a.room_id < b.room_id ? 1 : -1)));
      if (cursorListedAt != null) {
        rows = rows.filter((r) => (r.listed_at < cursorListedAt) || (r.listed_at === cursorListedAt && r.room_id < cursorRoomId));
      }
      return rows.slice(0, limit).map((r) => ({ ...r }));
    }

    // The sitemap read — `api/_sitemap.js`'s own statement.
    if (sql.includes("select slug, listed_at")) {
      const rows = state.rooms
        .filter((r) => r.listed_at != null && r.published_at != null)
        .sort((a, b) => (a.listed_at < b.listed_at ? 1 : -1));
      return rows.map((r) => ({ slug: r.slug, listed_at: r.listed_at }));
    }

    if (sql.includes("from vy_room") && sql.includes("limit 1")) {
      const [ownerId, replicaId] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      return r ? [{ ...r }] : [];
    }

    throw new Error(`unmodelled statement: ${sql.slice(0, 80)}`);
  };
  db.calls = calls;
  return db;
}

// ── 1. the directory read: exactly the listed-and-published set, newest first ──
{
  const state = freshState();
  const db = makeDb(state);
  const { creators, next_cursor } = await readCreatorsPage(db, {});
  ok("returns exactly two: listed and published", creators.length === 2);
  ok("newest listing first", creators[0].slug === "arjun-physics" && creators[1].slug === "priya-hindi");
  ok("listed but unpublished is absent", !creators.some((c) => c.slug === "unpublished-but-listed"));
  ok("published but unlisted is absent", !creators.some((c) => c.slug === "quiet-room"));
  ok("no pagination needed: next_cursor is null under the page size", next_cursor === null);
  ok("carries the one-line bio", creators[0].one_line_bio === "JEE physics, one topic a day.");
  ok("carries the locale", creators[1].locale === "hi");
  ok("never a follower count or a message count on the client shape",
    !("followers_total" in creators[0]) && !("messages_this_month" in creators[0]) && !("revenue" in creators[0]));
}

// ── 2. pagination: a cursor from page 1 does not repeat page 1's rows ──────
{
  const state = freshState();
  const db = makeDb(state);
  const page1 = await readCreatorsPage(db, { limit: 1 });
  ok("page size respected", page1.creators.length === 1 && page1.creators[0].slug === "arjun-physics");
  ok("a full page hands back a cursor", page1.next_cursor !== null);
  const page2 = await readCreatorsPage(db, { limit: 1, cursor: page1.next_cursor });
  ok("page 2 is the next row, not a repeat", page2.creators.length === 1 && page2.creators[0].slug === "priya-hindi");
  const decoded = decodeCreatorsCursor(page1.next_cursor);
  ok("cursor round-trips", decoded && decoded.roomId === "c1000000-0000-4000-8000-000000000001");
  ok("a malformed cursor decodes to null, never throws", decodeCreatorsCursor("not-base64-shaped!!") === null);
  ok("encode/decode round trip", (() => {
    const c = encodeCreatorsCursor("2026-01-01T00:00:00.000Z", "x1");
    const d = decodeCreatorsCursor(c);
    return d.listedAtIso === "2026-01-01T00:00:00.000Z" && d.roomId === "x1";
  })());
}

// ── 3. the sitemap: landing, directory, and exactly the listed-and-published set ──
{
  const state = freshState();
  const db = makeDb(state);
  const xml = await buildSitemapXml(db, { origin: "https://example.vyakti.app" });
  ok("carries the landing page", xml.includes("<loc>https://example.vyakti.app/</loc>"));
  ok("carries the directory", xml.includes("<loc>https://example.vyakti.app/creators</loc>"));
  ok("carries the listed-and-published Room", xml.includes("<loc>https://example.vyakti.app/r/arjun-physics</loc>"));
  ok("carries lastmod for that Room", xml.includes("<lastmod>2026-09-04</lastmod>"));
  ok("does NOT carry the listed-but-unpublished Room", !xml.includes("/r/unpublished-but-listed"));
  ok("does NOT carry the published-but-unlisted Room", !xml.includes("/r/quiet-room"));
  ok("is well-formed enough to carry exactly one urlset root", (xml.match(/<urlset/g) || []).length === 1);
}

// ── 4. unlist removes a Room from both the directory and the sitemap ──────
{
  const state = freshState();
  const db = makeDb(state);
  const target = state.rooms.find((r) => r.slug === "arjun-physics");
  const updated = await unlistRoom(db, OWNER, target.replica_id);
  ok("unlistRoom reports listed:false", updated.listed === false && updated.listed_at === null);
  const { creators } = await readCreatorsPage(db, {});
  ok("gone from the directory after unlist", !creators.some((c) => c.slug === "arjun-physics"));
  const xml = await buildSitemapXml(db, { origin: "https://example.vyakti.app" });
  ok("gone from the sitemap after unlist", !xml.includes("/r/arjun-physics"));
}

// ── 5. list is refused unless published; relisting keeps the original date ──
{
  const state = freshState();
  const db = makeDb(state);
  const draft = state.rooms.find((r) => r.slug === "draft-room");

  let threw = null;
  try {
    await listRoom(db, OWNER, draft.replica_id);
  } catch (e) {
    threw = e;
  }
  ok("list on an unpublished room refuses with a named code",
    threw instanceof RoomPublishError && threw.code === "room_list_requires_published");
  ok("the unpublished room's own row is untouched", draft.listed_at === null);

  const published = state.rooms.find((r) => r.slug === "quiet-room");
  const listedNow = await listRoom(db, OWNER, published.replica_id);
  ok("list on an already-published room succeeds", listedNow.listed === true);
  const relisted = await listRoom(db, OWNER, published.replica_id);
  ok("relisting does not move the listed-since date (coalesce, publishRoom's own shape)",
    relisted.listed_at === listedNow.listed_at);
}

// ── 6. NEGATIVE CONTROL (b): a non-owner's list is refused by the WHERE ───
{
  const state = freshState();
  const db = makeDb(state);
  const target = state.rooms.find((r) => r.slug === "quiet-room");
  const before = target.listed_at;
  const result = await listRoom(db, OTHER_OWNER, target.replica_id);
  ok("a non-owner's list call returns null (0 rows), never someone else's room",
    result === null);
  ok("the row itself is untouched", target.listed_at === before);
}

// ── 7. NEGATIVE CONTROL (a): the directory read names no follower table ───
{
  const src = readFileSync(join(REPO, "api/_creators.js"), "utf8");
  ok("api/_creators.js never names vy_room_follower", !src.includes("vy_room_follower"));
  ok("api/_creators.js never names vy_room_thread", !src.includes("vy_room_thread"));
  // No aggregate over any per-person table: no `count(` anywhere in the real
  // SQL this module issues (the module has no `count(` at all, so this also
  // covers `count(*)`).
  ok("api/_creators.js's own source contains no SQL aggregate", !/\bcount\s*\(/i.test(src));
  ok("api/_creators.js's own source contains no SQL sum", !/\bsum\s*\(/i.test(src));

  const sitemapSrc = readFileSync(join(REPO, "api/_sitemap.js"), "utf8");
  ok("api/_sitemap.js never names vy_room_follower either", !sitemapSrc.includes("vy_room_follower"));
}

// ── 8. NEGATIVE CONTROL (c): a bio with an em dash or a banned word fails ──
{
  const state = freshState();
  const db = makeDb(state);
  const target = state.rooms.find((r) => r.slug === "quiet-room");

  let threwDash = null;
  try {
    await setRoomBio(db, OWNER, target.replica_id, "Physics, doubt-clearing — daily.");
  } catch (e) { threwDash = e; }
  ok("an em dash in a bio fails the copy gate",
    threwDash instanceof RoomPublishError && threwDash.code === "room_bio_copy_violation" && threwDash.details?.rules?.includes("dash"));

  let threwVocab = null;
  try {
    await setRoomBio(db, OWNER, target.replica_id, "Talk to my clone about physics.");
  } catch (e) { threwVocab = e; }
  ok("a banned Rooms-vocabulary word in a bio fails the copy gate",
    threwVocab instanceof RoomPublishError && threwVocab.code === "room_bio_copy_violation" && threwVocab.details?.rules?.includes("rooms-vocabulary"));

  const clean = await setRoomBio(db, OWNER, target.replica_id, "JEE physics, one topic a day.");
  ok("a clean bio is accepted", clean.one_line_bio === "JEE physics, one topic a day.");

  let threwLong = null;
  try {
    await setRoomBio(db, OWNER, target.replica_id, "x".repeat(141));
  } catch (e) { threwLong = e; }
  ok("a bio over 140 characters is refused by name",
    threwLong instanceof RoomPublishError && threwLong.code === "room_bio_invalid");
}

// ── 9. the directory's own JSON-LD, pulled from the REAL site/creators.html
// source and executed — never a reimplementation of it. ────────────────────
{
  const html = readFileSync(join(REPO, "site/creators.html"), "utf8");
  const match = html.match(/function buildItemListJsonLd\([\s\S]*?\n {4}\}/);
  ok("site/creators.html defines buildItemListJsonLd", Boolean(match));
  if (match) {
    // eslint-disable-next-line no-new-func
    const buildItemListJsonLd = new Function(`"use strict";\n${match[0]}\nreturn buildItemListJsonLd;`)();
    const jsonld = buildItemListJsonLd(
      [
        { display_name: "Arjun Sir", slug: "arjun-physics", one_line_bio: "should never appear", locale: "en" },
        { display_name: "प्रिया", slug: "priya-hindi", one_line_bio: "should never appear either", locale: "hi" },
      ],
      "https://example.vyakti.app",
    );
    ok("ItemList type", jsonld["@type"] === "ItemList");
    ok("two entries", jsonld.itemListElement.length === 2);
    const first = jsonld.itemListElement[0].item;
    ok("Person type", first["@type"] === "Person");
    ok("name carried", first.name === "Arjun Sir");
    ok("url built from origin and slug", first.url === "https://example.vyakti.app/r/arjun-physics");
    ok("names ONLY name and url on the item, nothing per-person beyond that",
      Object.keys(first).sort().join(",") === "@type,name,url");
    ok("the JSON-LD block round-trips through JSON.stringify/parse without throwing", (() => {
      JSON.parse(JSON.stringify(jsonld));
      return true;
    })());
  }
}

// ── 10. robots.txt and vercel.json wiring, checked as data rather than assumed ──
{
  const robots = readFileSync(join(REPO, "site/robots.txt"), "utf8");
  ok("robots.txt allows /creators", /Allow:\s*\/creators\b/.test(robots));
  ok("robots.txt allows /r/", /Allow:\s*\/r\//.test(robots));
  ok("robots.txt disallows /studio", /Disallow:\s*\/studio\b/.test(robots));
  ok("robots.txt disallows /api/", /Disallow:\s*\/api\//.test(robots));
  ok("robots.txt names the sitemap", /Sitemap:\s*\/sitemap\.xml/.test(robots));

  const vercelConfig = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  const rewrites = vercelConfig.rewrites || [];
  ok("vercel.json rewrites /creators", rewrites.some((r) => r.source === "/creators" && r.destination === "/creators.html"));
  ok("vercel.json rewrites /sitemap.xml", rewrites.some((r) => r.source === "/sitemap.xml" && r.destination === "/api/sitemap"));
  ok("the WS-R40 /r/:slug rewrite is untouched", rewrites.some((r) => r.source === "/r/:slug" && r.destination === "/room.html"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
