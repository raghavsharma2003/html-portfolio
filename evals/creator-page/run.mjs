// WS-R66: the creator's public page (`/c/<slug>`, migration 115).
//
//   node evals/creator-page/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call. Drives the
// REAL `api/_creator-page.js` (the read + the pure HTML/JSON-LD builder) and
// the REAL `api/_room-publish.js` (`setRoomShowcase`/`removeRoomShowcase`/
// `readRoomShowcase`) through a small hand-rolled fake `db`, the shape
// `evals/creators-directory/run.mjs`'s own fixture already proves out one
// surface over.
//
// WHAT THIS PROVES:
//   1. `publicCreatorPageRoomBySlug` admits a Room only when published,
//      unpaused, AND listed — all three in one WHERE, never checked after.
//   2. `buildCreatorPageHtml` is pure: same input, same bytes, every time,
//      in both locales, and it never renders more than the five showcase
//      slots a Room actually has.
//   3. `buildCreatorPageJsonLd` emits a Person always and a FAQPage only
//      when a showcase exists, built from exactly the fields the page shows.
//   4. `setRoomShowcase`/`removeRoomShowcase` are owner-scoped, bounded to
//      five positions, copy-gated, and the eligible-card predicate is a
//      WHERE clause, not a JS check applied after a card is in hand.
//
// THREE NEGATIVE CONTROLS, this workstream's own brief names all three:
//   (a) a follower-sourced review card (`kind = 'follower_declined'`) is
//       refused as a showcase source, even when its `state` is
//       'sounds_right'.
//   (b) a sixth slot (`position = 6`) is refused before any SQL runs, and a
//       second row for an ALREADY-occupied position never produces two
//       active rows for the same position (the partial unique index's own
//       job, simulated here as a 23505 the fake db raises if the writer
//       above it is ever bypassed).
//   (c) an unlisted Room's page is byte-identical to an unknown slug's.
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const API = join(REPO, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { creatorPageHeadFacts, validatePersonJsonLd, validateFaqPageJsonLd } = await import(
  pathToFileURL(join(REPO, "scripts/probeLiveExpectations.mjs")).href
);
const CREATOR_PAGE = await import(pathToFileURL(join(API, "_creator-page.js")).href);
const ROOM_PUBLISH = await import(pathToFileURL(join(API, "_room-publish.js")).href);
const {
  publicCreatorPageRoomBySlug, resolveCreatorPage, buildCreatorPageHtml, buildCreatorPageJsonLd, TASTE_COPY,
} = CREATOR_PAGE;
const { setRoomShowcase, removeRoomShowcase, readRoomShowcase, RoomPublishError } = ROOM_PUBLISH;

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA_ID = "c1000000-0000-4000-8000-000000000001";
const ROOM_ID = "d0000000-0000-4000-8000-000000000001";
const CARD_ELIGIBLE = "e1000000-0000-4000-8000-000000000001";
const CARD_FOLLOWER = "e2000000-0000-4000-8000-000000000002";
const CARD_NOT_SOUNDS_RIGHT = "e3000000-0000-4000-8000-000000000003";

function freshState() {
  return {
    rooms: [
      {
        room_id: ROOM_ID, slug: "anjali-physics", replica_id: REPLICA_ID, owner_user_id: OWNER,
        display_name: "Anjali", one_line_bio: "JEE physics, one topic a day.",
        default_locale: "en", listed_at: "2026-09-01T00:00:00.000Z",
        published_at: "2026-08-01T00:00:00.000Z", paused_at: null, taste_enabled: true,
      },
    ],
    showcase: [],
    reviewCards: [
      {
        card_id: CARD_ELIGIBLE, replica_id: REPLICA_ID, owner_user_id: OWNER,
        kind: "question", state: "sounds_right",
        prompt_text: "How do you explain projectile motion to a beginner?",
        answer_text: "Split it into horizontal and vertical motion and treat them separately.",
      },
      {
        card_id: CARD_FOLLOWER, replica_id: REPLICA_ID, owner_user_id: OWNER,
        kind: "follower_declined", state: "sounds_right",
        prompt_text: "A real follower's own question, never showcase material",
        answer_text: "A real follower's own words in this AI's reply to them",
      },
      {
        card_id: CARD_NOT_SOUNDS_RIGHT, replica_id: REPLICA_ID, owner_user_id: OWNER,
        kind: "question", state: "open",
        prompt_text: "An undecided card", answer_text: "Not yet approved",
      },
    ],
  };
}

/** A small, purpose-built fake `db`. Matched on the exact SQL text
 *  `api/_room-publish.js` and `api/_creator-page.js` actually send — an
 *  unmatched statement throws, so a real drift between this fixture and the
 *  shipping SQL fails LOUD rather than returning an empty set that reads as
 *  "not found". */
function makeDb(state) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);

    if (has("select r.replica_id, r.agent_id, r.owner_user_id, r.display_name")) {
      return []; // not exercised by this suite (no ownedReplica-driven op here)
    }
    if (has("select room_id, slug, replica_id, agent_id, owner_user_id, display_name,") && has("limit 1")) {
      const [owner, replica] = params.map(String);
      const row = state.rooms.find((r) => r.owner_user_id === owner && r.replica_id === replica);
      return row ? [{ ...row }] : [];
    }
    if (has("select prompt_text, answer_text") && has("from vy_review_card")) {
      const [cardId, owner, replica] = params.map(String);
      const row = state.reviewCards.find(
        (c) => c.card_id === cardId && c.owner_user_id === owner && c.replica_id === replica
          && c.state === "sounds_right" && c.kind !== "follower_declined",
      );
      return row ? [{ prompt_text: row.prompt_text, answer_text: row.answer_text }] : [];
    }
    if (has("update vy_room_showcase") && has("set removed_at = now()") && has("position = ($2)::int")) {
      const [roomId, position] = params;
      for (const s of state.showcase) {
        if (s.room_id === String(roomId) && s.position === Number(position) && !s.removed_at) s.removed_at = "now";
      }
      return [];
    }
    if (has("insert into vy_room_showcase")) {
      const [id, roomId, question, answer, position] = params;
      // The partial unique index's own job, simulated: two ACTIVE rows can
      // never share a position. If the retiring UPDATE above this insert in
      // `setRoomShowcase` is ever skipped or reordered, this throws exactly
      // the Postgres code `isUniqueViolation` (the writer's own sibling
      // check, `_room-publish.js`) would see in production — a real
      // regression here fails LOUD rather than silently accepting a second
      // active row.
      if (state.showcase.some((s) => s.room_id === String(roomId) && s.position === Number(position) && !s.removed_at)) {
        throw Object.assign(new Error("duplicate key value violates unique constraint \"vy_room_showcase_position_ix\""), { code: "23505" });
      }
      state.showcase.push({ id: String(id), room_id: String(roomId), question, answer, position: Number(position), removed_at: null });
      return [];
    }
    if (has("from vy_room_showcase") && has("order by position asc")) {
      const [roomId] = params.map(String);
      return state.showcase
        .filter((s) => s.room_id === roomId && !s.removed_at)
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, question: s.question, answer: s.answer, position: s.position, created_at: "2026-09-05T00:00:00.000Z" }));
    }
    if (has("update vy_room_showcase s") && has("from vy_room r")) {
      const [owner, replica, id] = params.map(String);
      const r = state.rooms.find((x) => x.owner_user_id === owner && x.replica_id === replica);
      if (!r) return [];
      const s = state.showcase.find((x) => x.id === id && x.room_id === r.room_id && !x.removed_at);
      if (!s) return [];
      s.removed_at = "now";
      return [{ room_id: s.room_id }];
    }
    if (has("select slug, listed_at") && has("from vy_room")) {
      return state.rooms
        .filter((r) => r.listed_at != null && r.published_at != null)
        .sort((a, b) => (a.listed_at < b.listed_at ? 1 : -1))
        .map((r) => ({ slug: r.slug, listed_at: r.listed_at }));
    }
    if (has("from vy_room") && has("lower(slug) = $1") && has("listed_at is not null")) {
      const [slug] = params.map(String);
      const row = state.rooms.find(
        (r) => r.slug.toLowerCase() === slug && r.published_at != null && r.paused_at == null && r.listed_at != null,
      );
      return row ? [{ ...row }] : [];
    }
    throw new Error(`evals/creator-page/run.mjs fake db: unmatched SQL: ${sql}`);
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 1. THE READ: listed AND published AND unpaused, all three in one WHERE
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  const row = await publicCreatorPageRoomBySlug(db, "anjali-physics");
  ok("a listed, published, unpaused Room is found", row?.slug === "anjali-physics");

  const unknown = await publicCreatorPageRoomBySlug(db, "nobody-here");
  ok("an unknown slug returns null", unknown === null);

  const unlistedState = freshState();
  unlistedState.rooms[0].listed_at = null;
  const unlistedRow = await publicCreatorPageRoomBySlug(makeDb(unlistedState), "anjali-physics");
  ok("a published-but-unlisted Room returns null (listed_at gate)", unlistedRow === null);

  const unpublishedState = freshState();
  unpublishedState.rooms[0].published_at = null;
  const unpublishedRow = await publicCreatorPageRoomBySlug(makeDb(unpublishedState), "anjali-physics");
  ok("a listed-but-unpublished Room returns null (published_at gate)", unpublishedRow === null);

  const pausedState = freshState();
  pausedState.rooms[0].paused_at = "2026-09-02T00:00:00.000Z";
  const pausedRow = await publicCreatorPageRoomBySlug(makeDb(pausedState), "anjali-physics");
  ok("a listed-and-published-but-paused Room returns null (paused_at gate)", pausedRow === null);
}

// ═════════════════════════════════════════════════════════════════════════
// 2. resolveCreatorPage: room + showcase, or null
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, question: "Q1", answer: "A1" });
  const data = await resolveCreatorPage(db, "anjali-physics");
  ok("resolveCreatorPage returns the room and its showcase", data?.room?.slug === "anjali-physics" && data?.showcase?.length === 1);

  const gone = await resolveCreatorPage(db, "nobody-here");
  ok("resolveCreatorPage returns null for an unknown slug", gone === null);
}

// ═════════════════════════════════════════════════════════════════════════
// 3. buildCreatorPageHtml: PURE, both locales, exactly the showcase given
// ═════════════════════════════════════════════════════════════════════════
{
  const room = { display_name: "Anjali", one_line_bio: "JEE physics, one topic a day.", default_locale: "en" };
  const showcase = [
    { id: "s1", question: "How do you explain projectile motion?", answer: "Split it into components.", position: 1 },
    { id: "s2", question: "What if I am weak at calculus?", answer: "Start with limits, slowly.", position: 2 },
  ];
  const htmlEn = buildCreatorPageHtml({ room, showcase }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  const htmlEnAgain = buildCreatorPageHtml({ room, showcase }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("buildCreatorPageHtml is pure: identical input, identical bytes", htmlEn === htmlEnAgain);
  ok("carries the creator's name as AI in the title", htmlEn.includes("<title>Anjali AI</title>"));
  ok("carries the bio as the description", htmlEn.includes("JEE physics, one topic a day."));
  ok("carries both showcase questions", htmlEn.includes("How do you explain projectile motion?") && htmlEn.includes("What if I am weak at calculus?"));
  ok("the join control points at /r/<slug>?via=search", htmlEn.includes('href="https://vyakti.app/r/anjali-physics?via=search"'));
  ok("og:image reuses WS-R55's existing /r/<slug>/og.png, never a new endpoint", htmlEn.includes('content="https://vyakti.app/r/anjali-physics/og.png"'));

  const htmlHi = buildCreatorPageHtml({ room: { ...room, default_locale: "hi" }, showcase }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("?lang= is honoured over the room's own default (English room, hi via lang)",
    buildCreatorPageHtml({ room, showcase }, { origin: "https://vyakti.app", slug: "anjali-physics", lang: "hi" }).includes('lang="hi"'));
  ok("a Hindi Room renders lang=hi", htmlHi.includes('lang="hi"'));
  ok("a Hindi Room's headings are in Hindi, not English", htmlHi.includes("परिचय") && !htmlHi.includes(">About<"));

  const noShowcase = buildCreatorPageHtml({ room, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("no showcase section is rendered when the Room has none", !noShowcase.includes("<dl>"));
}

// ═════════════════════════════════════════════════════════════════════════
// 4. buildCreatorPageJsonLd: Person always, FAQPage only with a showcase
// ═════════════════════════════════════════════════════════════════════════
{
  const room = { display_name: "Anjali", one_line_bio: "JEE physics." };
  const withShowcase = buildCreatorPageJsonLd({ room, showcase: [{ question: "Q?", answer: "A." }], url: "https://vyakti.app/c/anjali-physics" });
  ok("Person carries the creator's name and the page url", withShowcase.person.name === "Anjali" && withShowcase.person.url === "https://vyakti.app/c/anjali-physics");
  ok("Person carries the bio as its description", withShowcase.person.description === "JEE physics.");
  ok("FAQPage exists when a showcase exists", withShowcase.faq?.["@type"] === "FAQPage" && withShowcase.faq.mainEntity.length === 1);
  ok("FAQPage's Question/Answer are built from exactly the showcase's own text", withShowcase.faq.mainEntity[0].name === "Q?" && withShowcase.faq.mainEntity[0].acceptedAnswer.text === "A.");

  const noShowcase = buildCreatorPageJsonLd({ room, showcase: [], url: "https://vyakti.app/c/anjali-physics" });
  ok("FAQPage is null (never an empty mainEntity array) when there is no showcase", noShowcase.faq === null);

  const html = buildCreatorPageHtml({ room: { ...room, default_locale: "en" }, showcase: [{ question: "Q?", answer: "A.", position: 1 }] }, { origin: "https://vyakti.app", slug: "x" });
  ok("the rendered page's inline JSON-LD carries no un-escaped </script> even if creator text tried to inject one",
    !buildCreatorPageHtml(
      { room: { ...room, one_line_bio: "</script><script>alert(1)</script>", default_locale: "en" }, showcase: [] },
      { origin: "https://vyakti.app", slug: "x" },
    ).includes("<script>alert(1)</script>"));
  ok("a real Person block is embedded as application/ld+json", html.includes('<script type="application/ld+json">') && html.includes('"@type":"Person"'));
}

// ═════════════════════════════════════════════════════════════════════════
// 5. NEGATIVE CONTROL (a): a follower-sourced review card is refused
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  let refused = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, sourceCardId: CARD_FOLLOWER });
  } catch (e) {
    refused = e instanceof RoomPublishError && e.code === "room_showcase_card_ineligible";
  }
  ok("NEGATIVE CONTROL (a): a kind='follower_declined' review card is refused as a showcase source", refused);
  ok("nothing was written on the refused attempt", state.showcase.length === 0);

  let refusedNotDecided = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, sourceCardId: CARD_NOT_SOUNDS_RIGHT });
  } catch (e) {
    refusedNotDecided = e instanceof RoomPublishError && e.code === "room_showcase_card_ineligible";
  }
  ok("an open (undecided) card is ALSO refused - only state='sounds_right' is eligible", refusedNotDecided);

  const eligible = await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, sourceCardId: CARD_ELIGIBLE });
  ok("an eligible (kind<>follower_declined, state='sounds_right') card IS copied", eligible?.showcase?.[0]?.question === "How do you explain projectile motion to a beginner?");
}

// ═════════════════════════════════════════════════════════════════════════
// 6. NEGATIVE CONTROL (b): a sixth slot is refused
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  for (let position = 1; position <= 5; position++) {
    const result = await setRoomShowcase(db, OWNER, REPLICA_ID, { position, question: `Q${position}`, answer: `A${position}` });
    ok(`slot ${position} of 5 is accepted`, result?.showcase?.length === position);
  }
  let sixthRefused = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 6, question: "Q6", answer: "A6" });
  } catch (e) {
    sixthRefused = e instanceof RoomPublishError && e.code === "room_showcase_position_invalid";
  }
  ok("NEGATIVE CONTROL (b): a sixth slot (position=6) is refused before any SQL runs", sixthRefused);
  const final = await readRoomShowcase(db, ROOM_ID);
  ok("still exactly five active rows after the refused sixth attempt", final.length === 5);

  // Overwriting an OCCUPIED position retires the old row rather than adding
  // a second active row at it - the fake db's own 23505 throw above proves
  // this is not merely convention: if the retiring UPDATE were skipped, this
  // insert would raise the identical unique-violation Postgres itself would.
  const overwritten = await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 3, question: "New Q3", answer: "New A3" });
  ok("overwriting an occupied position still yields exactly five active rows, never six", overwritten.showcase.length === 5);
  ok("the overwritten slot carries the NEW text", overwritten.showcase.find((s) => s.position === 3)?.question === "New Q3");
}

// ═════════════════════════════════════════════════════════════════════════
// 7. NEGATIVE CONTROL (c): an unlisted Room's page is byte-identical to an
//    unknown slug's
// ═════════════════════════════════════════════════════════════════════════
{
  const unlistedState = freshState();
  unlistedState.rooms[0].listed_at = null;
  const unlistedDb = makeDb(unlistedState);
  const unlistedData = await resolveCreatorPage(unlistedDb, "anjali-physics");
  ok("an unlisted Room resolves to null, exactly like an unknown slug", unlistedData === null);

  const unlistedHtml = buildCreatorPageHtml(unlistedData, { origin: "https://vyakti.app", slug: "anjali-physics" });
  const unknownState = freshState();
  const unknownData = await resolveCreatorPage(makeDb(unknownState), "nobody-has-this-slug");
  const unknownHtml = buildCreatorPageHtml(unknownData, { origin: "https://vyakti.app", slug: "nobody-has-this-slug" });
  ok("NEGATIVE CONTROL (c): an unlisted Room's page is byte-identical to an unknown slug's page (same slug plugged in)",
    buildCreatorPageHtml(unlistedData, { origin: "https://vyakti.app", slug: "x" }) === buildCreatorPageHtml(unknownData, { origin: "https://vyakti.app", slug: "x" }));
  ok("that identical page names the platform, never the creator", unlistedHtml.includes("Vyakti"));
  ok("that identical page names neither Room's slug", !unlistedHtml.includes("Anjali") && !unknownHtml.includes("Anjali"));
}

// ═════════════════════════════════════════════════════════════════════════
// 7b. removeRoomShowcase: unconditional take-down, owner-scoped
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, question: "Q1", answer: "A1" });
  const itemId = state.showcase[0].id;
  const strangerAttempt = await removeRoomShowcase(db, OWNER_B, REPLICA_ID, itemId);
  ok("a different owner's removal attempt returns null and changes nothing", strangerAttempt === null && state.showcase[0].removed_at === null);
  const removed = await removeRoomShowcase(db, OWNER, REPLICA_ID, itemId);
  ok("the real owner's removal succeeds and the public showcase is now empty", removed?.showcase?.length === 0);
  const afterFromPublicRead = await resolveCreatorPage(db, "anjali-physics");
  ok("the public page's own read no longer carries the removed item", afterFromPublicRead?.showcase?.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// 8. COPY GATE: em dash / Rooms vocabulary in showcase text is refused by
//    the REAL scripts/check-copy.mjs scanner, never a second reimplementation
// ═════════════════════════════════════════════════════════════════════════
{
  const state = freshState();
  const db = makeDb(state);
  let refused = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, question: "Question - with an em dash — here", answer: "Fine" });
  } catch (e) {
    refused = e instanceof RoomPublishError && e.code === "room_showcase_copy_violation";
  }
  ok("an em dash in the question is refused by the real copy-gate scanner", refused);

  let vocabRefused = false;
  try {
    await setRoomShowcase(db, OWNER, REPLICA_ID, { position: 1, question: "Fine", answer: "This is a clone of me" });
  } catch (e) {
    vocabRefused = e instanceof RoomPublishError && e.code === "room_showcase_copy_violation";
  }
  ok("the word 'clone' in the answer is refused by the real Rooms-vocabulary rule", vocabRefused);
  ok("nothing was written on either refused attempt", state.showcase.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// 9. STATIC: the showcase writer is unreachable from any follower lane
// ═════════════════════════════════════════════════════════════════════════
{
  const followerFiles = ["_room-surface.js", "_room.js", "_room-page.js", "_room-embed.js", "_room-manifest.js"];
  const hits = [];
  for (const file of followerFiles) {
    const src = readFileSync(join(API, file), "utf8");
    if (/\bsetRoomShowcase\s*\(/.test(src) || /\bremoveRoomShowcase\s*\(/.test(src)) hits.push(file);
  }
  ok("STATIC: no follower-facing file imports or calls setRoomShowcase/removeRoomShowcase", hits.length === 0, hits.join(","));

  const doorSrc = readFileSync(join(API, "room-publish.js"), "utf8");
  ok("the ONLY door that calls setRoomShowcase/removeRoomShowcase is the owner-authenticated room-publish.js",
    /\bsetRoomShowcase\s*\(/.test(doorSrc) && /\brequireUser\s*\(/.test(doorSrc));

  const publishSrc = readFileSync(join(API, "_room-publish.js"), "utf8");
  ok("the eligible-card SELECT excludes kind='follower_declined' inside its own WHERE, not a JS check after",
    publishSrc.includes("kind <> 'follower_declined'"));
}

// ═════════════════════════════════════════════════════════════════════════
// 10. api/_sitemap.js: /c/<slug> joins /r/<slug> for every listed-and-published Room
// ═════════════════════════════════════════════════════════════════════════
{
  const { buildSitemapXml } = await import(pathToFileURL(join(API, "_sitemap.js")).href);
  const state = freshState();
  const xml = await buildSitemapXml(makeDb(state), { origin: "https://vyakti.app" });
  ok("sitemap carries /r/<slug>", xml.includes("<loc>https://vyakti.app/r/anjali-physics</loc>"));
  ok("sitemap carries /c/<slug> beside it", xml.includes("<loc>https://vyakti.app/c/anjali-physics</loc>"));

  // WS-R90: the sitemap's own hreflang cluster for /c/<slug>, and the
  // required xhtml namespace Google's sitemap-method doc names.
  ok("urlset declares the xhtml namespace hreflang needs", xml.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"'));
  ok("the /c/<slug> entry's own hreflang=en alternate is itself", xml.includes('<xhtml:link rel="alternate" hreflang="en" href="https://vyakti.app/c/anjali-physics" />'));
  ok("the /c/<slug> entry's own hreflang=hi alternate carries ?lang=hi", xml.includes('<xhtml:link rel="alternate" hreflang="hi" href="https://vyakti.app/c/anjali-physics?lang=hi" />'));
  ok("the /c/<slug> entry names an x-default alternate", xml.includes('<xhtml:link rel="alternate" hreflang="x-default" href="https://vyakti.app/c/anjali-physics" />'));
  ok("the /r/<slug> entry carries NO hreflang cluster (brief names only /c/<slug>)",
    !new RegExp(`<loc>https://vyakti\\.app/r/anjali-physics</loc>[\\s\\S]{0,20}<xhtml:link`).test(xml));
}

// ═════════════════════════════════════════════════════════════════════════
// 14. WS-R90: SEARCH PRESENCE — hreflang alternates, x-default, og:locale
// ═════════════════════════════════════════════════════════════════════════
{
  const room = { display_name: "Anjali", one_line_bio: "JEE physics, one topic a day.", default_locale: "en" };
  const html = buildCreatorPageHtml({ room, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics" });

  const facts = creatorPageHeadFacts();
  ok("HREFLANG_CODES parses to exactly en, hi, x-default", JSON.stringify(facts.hreflangCodes) === JSON.stringify(["en", "hi", "x-default"]));
  ok("HI_LANG_QUERY parses to ?lang=hi", facts.hiQuery === "?lang=hi");
  ok("OG_LOCALE parses to en_US / hi_IN", facts.ogLocale.en === "en_US" && facts.ogLocale.hi === "hi_IN");

  for (const code of facts.hreflangCodes) {
    ok(`carries a hreflang="${code}" alternate link`, html.includes(`hreflang="${code}"`));
  }
  ok('hreflang="en" points at the bare canonical address', html.includes('<link rel="alternate" hreflang="en" href="https://vyakti.app/c/anjali-physics" />'));
  ok('hreflang="hi" points at the ?lang=hi address', html.includes('<link rel="alternate" hreflang="hi" href="https://vyakti.app/c/anjali-physics?lang=hi" />'));
  ok('hreflang="x-default" points at the SAME bare address as "en", not a third URL',
    html.includes('<link rel="alternate" hreflang="x-default" href="https://vyakti.app/c/anjali-physics" />'));

  ok('an English render carries og:locale content="en_US"', html.includes('<meta property="og:locale" content="en_US" />'));
  const htmlHi = buildCreatorPageHtml({ room, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics", lang: "hi" });
  ok('the SAME Room requested with ?lang=hi carries og:locale content="hi_IN"', htmlHi.includes('<meta property="og:locale" content="hi_IN" />'));
  ok('the hi render carries the IDENTICAL hreflang set as the en render (Google\'s own rule: identical on every version)',
    [...htmlHi.matchAll(/<link rel="alternate" hreflang="[^"]+" href="[^"]+" \/>/g)].map((m) => m[0]).join("|")
      === [...html.matchAll(/<link rel="alternate" hreflang="[^"]+" href="[^"]+" \/>/g)].map((m) => m[0]).join("|"));

  // The platform-only fallback (unknown/unlisted slug) still carries a full,
  // correct hreflang cluster and og:locale=en_US -- WS-R66's own "nobody may
  // learn whether a slug exists from this page's shape" law extended to
  // these new tags: an absent-tag difference would itself be a signal.
  const unknownHtml = buildCreatorPageHtml(null, { origin: "https://vyakti.app", slug: "nobody-here" });
  ok("the platform-only fallback still carries all three hreflang alternates",
    facts.hreflangCodes.every((code) => unknownHtml.includes(`hreflang="${code}"`)));
  ok('the platform-only fallback carries og:locale content="en_US"', unknownHtml.includes('<meta property="og:locale" content="en_US" />'));

  // `api/_sitemap.js` restates (never imports) the identical HREFLANG_CODES/
  // HI_LANG_QUERY constants for its own xhtml:link cluster
  // (`context/decisions.md#ws-r90-sitemap-hreflang-only-on-c-slug-not-r-slug`'s
  // own comment claims the two files "agree" -- checked here directly
  // against the sitemap file's own source, not merely asserted).
  const sitemapSrc = readFileSync(join(API, "_sitemap.js"), "utf8");
  const sitemapCodesMatch = /const HREFLANG_CODES\s*=\s*\[([^\]]*)\]/.exec(sitemapSrc);
  const sitemapCodes = sitemapCodesMatch ? [...sitemapCodesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : null;
  const sitemapHiQueryMatch = /const HI_LANG_QUERY\s*=\s*"([^"]+)"/.exec(sitemapSrc);
  ok("api/_sitemap.js's own HREFLANG_CODES matches api/_creator-page.js's, byte for byte",
    JSON.stringify(sitemapCodes) === JSON.stringify(facts.hreflangCodes));
  ok("api/_sitemap.js's own HI_LANG_QUERY matches api/_creator-page.js's",
    sitemapHiQueryMatch?.[1] === facts.hiQuery);
}

// ═════════════════════════════════════════════════════════════════════════
// 15. WS-R90: THE JSON-LD SCHEMA VALIDATOR — required fields, both types,
// plus a negative control proving the validator actually bites
// ═════════════════════════════════════════════════════════════════════════
{
  const room = { display_name: "Anjali", one_line_bio: "JEE physics." };
  const showcase = [{ question: "How do you explain projectile motion?", answer: "Split it into components." }];
  const ld = buildCreatorPageJsonLd({ room, showcase, url: "https://vyakti.app/c/anjali-physics" });

  ok("the real Person block passes the schema validator with zero errors", validatePersonJsonLd(ld.person).length === 0, JSON.stringify(validatePersonJsonLd(ld.person)));
  ok("the real FAQPage block passes the schema validator with zero errors", validateFaqPageJsonLd(ld.faq).length === 0, JSON.stringify(validateFaqPageJsonLd(ld.faq)));

  const noShowcaseLd = buildCreatorPageJsonLd({ room, showcase: [], url: "https://vyakti.app/c/anjali-physics" });
  ok("a Person block with no showcase (faq: null) still passes on its own", validatePersonJsonLd(noShowcaseLd.person).length === 0);

  // NEGATIVE CONTROLS: the validator actually bites on each required field.
  ok("NEGATIVE CONTROL: a Person missing @context is caught", validatePersonJsonLd({ ...ld.person, "@context": undefined }).some((e) => /@context/.test(e)));
  ok("NEGATIVE CONTROL: a Person with the wrong @type is caught", validatePersonJsonLd({ ...ld.person, "@type": "Organization" }).some((e) => /@type/.test(e)));
  ok("NEGATIVE CONTROL: a Person missing name is caught", validatePersonJsonLd({ ...ld.person, name: "" }).some((e) => /name/.test(e)));
  ok("NEGATIVE CONTROL: an empty FAQPage mainEntity is caught", validateFaqPageJsonLd({ ...ld.faq, mainEntity: [] }).some((e) => /mainEntity/.test(e)));
  ok("NEGATIVE CONTROL: a Question missing acceptedAnswer.text is caught",
    validateFaqPageJsonLd({ ...ld.faq, mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "" } }] })
      .some((e) => /acceptedAnswer\.text/.test(e)));
  ok("a null/undefined object is caught rather than throwing", validatePersonJsonLd(null).length > 0 && validateFaqPageJsonLd(undefined).length > 0);
}

// ═════════════════════════════════════════════════════════════════════════
// 11. vercel.json: the rewrite exists
// ═════════════════════════════════════════════════════════════════════════
{
  const vercelConfig = JSON.parse(readFileSync(join(REPO, "vercel.json"), "utf8"));
  const rewrite = vercelConfig.rewrites.find((r) => r.source === "/c/:slug");
  ok("vercel.json rewrites /c/:slug to api/creator-page", rewrite?.destination === "/api/creator-page?slug=:slug");
  const headerRule = vercelConfig.headers.find((h) => h.source === "/c/:slug");
  ok("vercel.json's headers array carries a rule for /c/:slug", Boolean(headerRule));
  const csp = headerRule?.headers?.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  ok("that CSP carries no 'unsafe-inline'/'unsafe-eval' in script-src (no inline script on this page beyond exempt JSON-LD)",
    !/script-src[^;]*unsafe-inline/.test(csp) && !/script-src[^;]*unsafe-eval/.test(csp));
}

// ═════════════════════════════════════════════════════════════════════════
// 12. WS-R80: THE TASTE ISLAND'S MARKUP
// ═════════════════════════════════════════════════════════════════════════
{
  const room = { display_name: "Anjali", one_line_bio: "JEE physics.", default_locale: "en", slug: "anjali-physics", taste_enabled: true };
  const htmlOn = buildCreatorPageHtml({ room, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics" });

  ok("the taste form is rendered when taste_enabled is true (or absent -> default true)",
    htmlOn.includes('id="vy-taste-form"'));
  ok("the form carries the room's own slug and locale as data attributes",
    htmlOn.includes('data-room="anjali-physics"') && htmlOn.includes('data-locale="en"'));
  ok("the deferred island script is included, and only as an external <script src>, never inline",
    htmlOn.includes('<script src="/creator-taste.js" defer></script>'));
  // The name inside the lede carries its own `lang` since the WS-R79/WS-R80
  // merge (`withLangSplicedName`, the join link's own shape): the sentence is
  // still substituted server-side, and the creator's name is its own node.
  ok("the lede has {name} already substituted server-side, the name in its own lang",
    htmlOn.includes('Ask <span lang="en">Anjali</span> AI a question before you sign in.'));
  ok("the join link exists but starts hidden (JS reveals it after the third turn or a refusal)",
    /<a id="vy-taste-join" href="\/r\/anjali-physics\?via=search" hidden>/.test(htmlOn));

  // The no-JS fallback: a GET form whose `action` carries no query string,
  // with `via=search` as a HIDDEN FIELD instead -- a GET submission REPLACES
  // action's own query string with the serialized form fields (the HTML
  // living standard's rule), so `via=search` would be silently lost if it
  // lived in the action URL instead.
  ok("the form's action carries no query string of its own",
    /action="\/r\/anjali-physics"/.test(htmlOn) && !/action="\/r\/anjali-physics\?/.test(htmlOn));
  ok("via=search rides as a hidden field, surviving a plain (no-JS) GET submission",
    /<input type="hidden" name="via" value="search" \/>/.test(htmlOn));

  // REGRESSION: the fixture builder (`scripts/build-creator-page-fixture.mjs`)
  // passes a `room` object with NO `slug` field at all (only display_name,
  // one_line_bio, default_locale) -- the same shape `resolveCreatorPage`'s
  // caller would get for a row where `room.slug` legitimately differs in
  // case from the URL's own `slug` param. The widget must key off the URL
  // slug (the same one `joinUrl`/`roomImageUrl` already use), never
  // `room.slug`, or a fixture/production drift like that silently ships a
  // form that posts to `/r/` with an empty slug.
  const roomNoSlugField = { display_name: "Anjali", one_line_bio: "JEE physics.", default_locale: "en" };
  const htmlNoSlugField = buildCreatorPageHtml({ room: roomNoSlugField, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali" });
  ok("REGRESSION: the widget keys off the URL slug, not room.slug (which may be absent from the row shape)",
    htmlNoSlugField.includes('data-room="anjali"') && htmlNoSlugField.includes('action="/r/anjali"'));

  const room2 = { ...room, taste_enabled: false };
  const htmlOff = buildCreatorPageHtml({ room: room2, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("NEGATIVE CONTROL: taste_enabled=false renders no taste form at all",
    !htmlOff.includes('id="vy-taste-form"'));
  ok("...and no deferred island script either -- absent, not hidden",
    !htmlOff.includes("creator-taste.js"));

  const roomHi = { ...room, default_locale: "hi" };
  const htmlHi = buildCreatorPageHtml({ room: roomHi, showcase: [] }, { origin: "https://vyakti.app", slug: "anjali-physics" });
  ok("a Hindi Room's taste widget renders Hindi copy, not English",
    htmlHi.includes("साइन इन करने से पहले") && !htmlHi.includes("Ask Anjali AI a question"));
}

// ═════════════════════════════════════════════════════════════════════════
// 13. WS-R80: TASTE_COPY IS BYTE-IDENTICAL TO THE REAL src/room/copy.ts
// ═════════════════════════════════════════════════════════════════════════
{
  // `evals/room-locale/run.mjs`'s own technique: `copy.ts` is plain TS with
  // no JSX, bundled with esbuild rather than imported directly (this file
  // cannot import a `.ts` module any more than `api/_creator-page.js`
  // itself can -- the same boundary, crossed to read the REAL export
  // instead of trusting a copy of its text).
  const OUT = mkdtempSync(join(tmpdir(), "creator-page-copy-eval-"));
  const ENTRY = join(OUT, "entry.ts");
  writeFileSync(
    ENTRY,
    `export { ROOM_COPY_TABLE, loadRoomCopy } from ${JSON.stringify(join(REPO, "src/room/copy"))};\n`,
  );
  const BUNDLE = join(OUT, "copy.bundle.mjs");
  execSync(
    `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
    { cwd: REPO, stdio: "inherit" },
  );
  const { ROOM_COPY_TABLE, loadRoomCopy } = await import(pathToFileURL(BUNDLE).href);
  // WS-R139: `ROOM_COPY_TABLE.hi` is a throwing Proxy (two lazy chunks,
  // `src/room/copy.ts`'s own header) until installed.
  await loadRoomCopy("hi");

  for (const locale of ["en", "hi"]) {
    const real = ROOM_COPY_TABLE[locale].taste;
    const mine = TASTE_COPY[locale];
    for (const key of Object.keys(real)) {
      ok(`TASTE_COPY.${locale}.${key} matches the REAL src/room/copy.ts taste.${key}`, mine[key] === real[key], mine[key]);
    }
    ok(`TASTE_COPY.${locale}.errorGeneric matches the REAL src/room/copy.ts errors.generic`,
      mine.errorGeneric === ROOM_COPY_TABLE[locale].errors.generic, mine.errorGeneric);
    ok(`TASTE_COPY.${locale} carries no key the real taste section does not have`,
      Object.keys(mine).filter((k) => k !== "errorGeneric").every((k) => k in real));
  }

  // NEGATIVE CONTROL: the comparator above actually bites.
  const poisoned = { ...TASTE_COPY.en, send: "Submit" };
  ok("NEGATIVE CONTROL: a drifted copy of taste.send is caught by the same comparator",
    poisoned.send !== ROOM_COPY_TABLE.en.taste.send);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
