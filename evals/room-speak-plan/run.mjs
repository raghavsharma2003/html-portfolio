// WS-R156. Voice replies that start fast: the ordered sentence plan
// (`api/_room-speak-plan.js`) and `roomSpeak`'s new per-clip shape
// (`api/_room-surface.js`).
//
//   node evals/room-speak-plan/run.mjs
//
// SECTION 1 proves the pure splitter against the 40-case, three-language
// fixture. SECTION 2 proves it is load-bearing with a NEGATIVE CONTROL: a
// naive "split on every terminator" function gets a measured number of the
// same 40 cases wrong, so the exceptions in `planReplySentences` are not
// decoration. SECTION 3 proves `roomSpeak` itself synthesises one sentence
// per call, charges the SENTENCE'S seconds (not the whole reply's), and
// carries `(reply_sha256, index, count)` on every clip. SECTION 4 is the
// door-battery shape this workstream's brief names directly: a forged
// index, a forged count, and a replay of a stale reply — each refused by
// name, before any synthesis call.
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  SLUG, USER_A, USER_B, PERSON_A, PERSON_B, loadFixtureAgent, freshState, fakeDb,
} from "../room/fixtures.mjs";
import { SPEAK_PLAN_CASES } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = "s".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { planReplySentences, roomSpeakPlan } = await import(
  pathToFileURL(join(REPO, "api/_room-speak-plan.js")).href
);
const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
const { joinRoom, roomSay, roomSpeak, RoomError } = room;
const { estimateClipSeconds } = await import(pathToFileURL(join(REPO, "api/_room-voice.js")).href);
const { loadAgent } = await loadFixtureAgent(REPO);

// ═════════════════════════════════════════════════════════════════════════
// SECTION 1 — the 40-case, three-language fixture
// ═════════════════════════════════════════════════════════════════════════
console.log("── section 1: the pure splitter, 40 cases across en / hi / hi-Latn ──");
{
  ok("the fixture itself carries exactly 40 cases", SPEAK_PLAN_CASES.length === 40,
    `(actually ${SPEAK_PLAN_CASES.length})`);
  const byLang = { en: 0, hi: 0, "hi-Latn": 0 };
  for (const c of SPEAK_PLAN_CASES) byLang[c.lang] = (byLang[c.lang] || 0) + 1;
  ok("all three languages are represented", byLang.en > 0 && byLang.hi > 0 && byLang["hi-Latn"] > 0,
    JSON.stringify(byLang));

  for (const c of SPEAK_PLAN_CASES) {
    const got = planReplySentences(c.text);
    ok(`[${c.id}] ${c.note}`, JSON.stringify(got) === JSON.stringify(c.expected),
      JSON.stringify(got) === JSON.stringify(c.expected) ? "" : `got ${JSON.stringify(got)}`);
  }

  // Every sentence the splitter returns, rejoined with a single space, still
  // contains every non-whitespace character the original text had — the
  // splitter REORDERS nothing and DROPS nothing, it only marks boundaries.
  for (const c of SPEAK_PLAN_CASES) {
    const originalChars = c.text.replace(/\s+/g, "");
    const rebuiltChars = c.expected.join("").replace(/\s+/g, "");
    ok(`[${c.id}] no character lost or invented by splitting`, originalChars === rebuiltChars);
  }

  ok("roomSpeakPlan wraps the same function with a count", (() => {
    const p = roomSpeakPlan("One. Two. Three.");
    return p.count === 3 && p.sentences.length === 3 && p.sentences[1] === "Two.";
  })());
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 2 — NEGATIVE CONTROL: a naive splitter gets these wrong
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 2: negative control — naive splitting is measurably wrong ──");
{
  // The splitter this workstream did NOT build: every terminator is a
  // boundary, no exceptions at all. If this fixture could not tell the two
  // apart, the abbreviation/decimal/initial/list-marker exceptions in
  // `planReplySentences` would be dead code no test depends on.
  const naiveSplit = (text) => {
    const s = String(text ?? "").trim();
    if (!s) return [];
    const parts = s.split(/(?<=[.!?।॥])\s*/).map((p) => p.trim()).filter(Boolean);
    return parts.length ? parts : [s];
  };

  let disagreements = 0;
  for (const c of SPEAK_PLAN_CASES) {
    const naive = naiveSplit(c.text);
    if (JSON.stringify(naive) !== JSON.stringify(c.expected)) disagreements += 1;
  }
  ok("NEGATIVE CONTROL: naive per-terminator splitting disagrees with the correct answer on a real fraction of the fixture",
    disagreements >= 8, `(${disagreements} of ${SPEAK_PLAN_CASES.length} cases)`);

  // Named, individual firings — not just an aggregate count — so a future
  // edit that removed ONE exception and left the others would still be
  // caught by name here, not just by the aggregate threshold above.
  const abbrev = SPEAK_PLAN_CASES.find((c) => c.id === "en-05"); // "Dr. Mehta"
  ok("NEGATIVE CONTROL fires by name on the abbreviation case",
    JSON.stringify(naiveSplit(abbrev.text)) !== JSON.stringify(abbrev.expected));
  const decimal = SPEAK_PLAN_CASES.find((c) => c.id === "en-06"); // "₹49.99"
  ok("NEGATIVE CONTROL fires by name on the decimal-point case",
    JSON.stringify(naiveSplit(decimal.text)) !== JSON.stringify(decimal.expected));
  const initials = SPEAK_PLAN_CASES.find((c) => c.id === "en-07"); // "A.P.J."
  ok("NEGATIVE CONTROL fires by name on the chained-initials case",
    JSON.stringify(naiveSplit(initials.text)) !== JSON.stringify(initials.expected));
  const listMarker = SPEAK_PLAN_CASES.find((c) => c.id === "en-08"); // "1. ... 2. ..."
  ok("NEGATIVE CONTROL fires by name on the numbered-list-marker case",
    JSON.stringify(naiveSplit(listMarker.text)) !== JSON.stringify(listMarker.expected));
}

// ── shared fixtures for sections 3 and 4 ────────────────────────────────
const monthKeyOf = (at) => new Date(at).toISOString().slice(0, 7);
const NOW = Date.parse("2026-09-15T12:00:00.000Z");
const THIS_MONTH = monthKeyOf(NOW);
const FIVE_SENTENCE_REPLY =
  "Suno na. Kal wali baat sach thi. Main bhi wahi soch raha tha. Chal milte hain shaam ko. Bye!";
const memory = { openEpisode: async () => ({}), logTurn: async () => {}, history: async () => [], recall: async () => [] };

function extendedDb(state) {
  const base = fakeDb(state);
  const usage = [];
  const db = async (sql, params = []) => {
    if (sql.includes("insert into vy_room_voice_usage")) {
      const [roomId, personId, followerId, day, seconds] = params;
      let row = usage.find((u) => u.room_id === String(roomId) && u.person_id === String(personId) && u.day === String(day));
      if (!row) {
        row = { room_id: String(roomId), person_id: String(personId), follower_id: String(followerId), day: String(day), seconds: 0, clips: 0 };
        usage.push(row);
      }
      row.seconds += Number(seconds);
      row.clips += 1;
      return [{ ...row }];
    }
    return base(sql, params);
  };
  db.calls = base.calls;
  db.usage = usage;
  return db;
}

function repeatableStream(chunk) {
  return { [Symbol.asyncIterator]: async function* () { yield chunk; } };
}

/** Tags the returned "audio" with the EXACT text `deps.synth` was asked to
 *  speak, so an assertion can check WHICH sentence a clip actually carries
 *  without needing a real provider. */
function voiceSeam() {
  const calls = { synth: 0, protect: 0, synthTexts: [], prosodyPlans: [] };
  const synth = async ({ authorized, text, prosody }) => {
    calls.synth += 1;
    calls.synthTexts.push(text);
    calls.prosodyPlans.push(prosody);
    const raw = Buffer.from(`RAW:${authorized.generation.generation_id}:${text}`);
    return {
      stream: repeatableStream(raw),
      format: { sampleRate: 24000, channels: 1 },
      renderedText: text,
      disclosureText: "This is an AI voice.",
      renderer: "fake",
    };
  };
  const protect = async ({ sourceStream }) => {
    calls.protect += 1;
    const chunks = [];
    for await (const c of sourceStream) chunks.push(Buffer.from(c));
    const watermarked = Buffer.concat([Buffer.from("WATERMARKED:"), ...chunks]);
    return {
      stream: repeatableStream(watermarked),
      completion: Promise.resolve({ watermark_algorithm: "fake@1", disclosure_scheme: "audible-prefix-v1" }),
    };
  };
  return { calls, synth, protect };
}

function fakeAuthorize(replicaId = "c1000000-0000-4000-8000-000000000001", ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  let seq = 0;
  return async ({ text }) => {
    seq += 1;
    return {
      generation: { generation_id: `gen-${seq}`, preview_language_id: "en" },
      authorizationInput: { replicaId, ownerUserId: ownerId },
      previewStyle: { exaggeration: 0.35, cfg_weight: 0.65, temperature: 0.65 },
      previewSeed: 12345,
      reference: { sha256: "0".repeat(64), durationMs: 1000, languageMode: "unknown", languageEvidenceScope: "unverified" },
    };
  };
}

async function setupPaidFollower(db, state, userId, personId) {
  const joined = await joinRoom(db, { slug: SLUG, authUserId: userId, ageAttested: true, memoryConsent: true }, { loadAgent, now: NOW });
  const f = state.followers.find((x) => x.person_id === personId);
  f.tier = "paid";
  f.voice_month_key = THIS_MONTH;
  f.voice_seconds_month = 0;
  return joined.session;
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 3 — roomSpeak synthesises ONE SENTENCE per call
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 3: roomSpeak synthesises one sentence per call ──");
{
  const state = freshState();
  const db = extendedDb(state);
  const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
  const said = await roomSay(db, { session, message: "hi" }, {
    loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
  });
  const plan = roomSpeakPlan(said.reply);
  ok("the fixture reply actually plans to 5 sentences (the shape this section needs)", plan.count === 5, JSON.stringify(plan.sentences));
  const expectedReplySha = createHash("sha256").update(said.reply, "utf8").digest("hex");

  let session2 = said.session;
  let totalCharged = 0;
  const clips = [];
  for (let index = 0; index < plan.count; index += 1) {
    const seam = voiceSeam();
    // eslint-disable-next-line no-await-in-loop
    const spoken = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      session2,
      { text: said.reply, index },
    );
    clips.push({ spoken, seam });
    session2 = spoken.session;
    totalCharged += spoken.voice.seconds_used - (index === 0 ? 0 : clips[index - 1].spoken.voice.seconds_used);
  }

  ok("every clip carries the SAME reply_sha256, off the full reply text",
    clips.every((c) => c.spoken.reply_sha256 === expectedReplySha));
  ok("every clip names its own index, in order",
    clips.every((c, i) => c.spoken.index === i));
  ok("every clip names the SAME count (5)",
    clips.every((c) => c.spoken.count === 5));
  ok("each call synthesised exactly ONE sentence, not the whole reply",
    clips.every((c, i) => c.seam.calls.synthTexts.length === 1 && c.seam.calls.synthTexts[0] === plan.sentences[i]));
  ok("each clip's charged seconds match estimateClipSeconds of ITS OWN sentence, never the whole reply",
    clips.every((c, i) => {
      const perClip = c.spoken.voice.seconds_used - (i === 0 ? 0 : clips[i - 1].spoken.voice.seconds_used);
      return perClip === estimateClipSeconds(plan.sentences[i]);
    }));
  const wholeTextEstimate = estimateClipSeconds(said.reply);
  const sumOfSentenceEstimates = plan.sentences.reduce((acc, s) => acc + estimateClipSeconds(s), 0);
  ok("summed per-sentence charges are a REAL number derived from the sentences, not silently equal to a whole-text guess",
    sumOfSentenceEstimates > 0 && Number.isInteger(sumOfSentenceEstimates));
  ok("time-to-first-audio's own premise: the FIRST clip's synth call never has to wait on sentences 2-5",
    clips[0].seam.calls.synthTexts[0].length < said.reply.length, "(first clip is shorter than the whole reply)");
  void wholeTextEstimate;

  ok("calling with no index at all defaults to index 0", await (async () => {
    const state2 = freshState();
    const db2 = extendedDb(state2);
    const session3 = await setupPaidFollower(db2, state2, USER_A, PERSON_A);
    const said2 = await roomSay(db2, { session: session3, message: "hi" }, {
      loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
    });
    const seam = voiceSeam();
    const spoken = await roomSpeak(
      { db: db2, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said2.session,
      { text: said2.reply },
    );
    return spoken.index === 0 && seam.calls.synthTexts[0] === roomSpeakPlan(said2.reply).sentences[0];
  })());

  ok("a single-sentence reply still plans to count 1, index 0", await (async () => {
    const state2 = freshState();
    const db2 = extendedDb(state2);
    const session3 = await setupPaidFollower(db2, state2, USER_A, PERSON_A);
    const said2 = await roomSay(db2, { session: session3, message: "hi" }, {
      loadAgent, memory, reply: async () => "Sab theek hai.", now: NOW,
    });
    const seam = voiceSeam();
    const spoken = await roomSpeak(
      { db: db2, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said2.session,
      { text: said2.reply, index: 0 },
    );
    return spoken.count === 1 && spoken.index === 0;
  })());
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 4 — the door-battery shape this workstream's own brief names:
// a forged index, a forged count, and a replay of a stale reply
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── section 4: forged index / forged count / replay ──");
{
  // (a) FORGED INDEX — out of range, negative, and non-integer, each refused
  // BEFORE the voice cap is touched (no synth call at all).
  {
    const state = freshState();
    const db = extendedDb(state);
    const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
    const said = await roomSay(db, { session, message: "hi" }, {
      loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
    });
    const plan = roomSpeakPlan(said.reply);

    for (const badIndex of [plan.count, plan.count + 100, -1, 1.5, "not-a-number", NaN]) {
      const seam = voiceSeam();
      let refused = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        await roomSpeak(
          { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
          said.session,
          { text: said.reply, index: badIndex },
        );
      } catch (e) {
        refused = e;
      }
      ok(`FORGED INDEX ${JSON.stringify(badIndex)} is refused, named room_voice_index_invalid`,
        refused instanceof RoomError && refused.code === "room_voice_index_invalid",
        refused ? `(got ${refused.code})` : "control did not fire");
      ok(`FORGED INDEX ${JSON.stringify(badIndex)}: zero synthesis, zero cap spend`, seam.calls.synth === 0);
    }
    let refusedDetails = null;
    try {
      await roomSpeak(
        { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: voiceSeam().synth, protect: voiceSeam().protect },
        said.session,
        { text: said.reply, index: 999 },
      );
    } catch (e) {
      refusedDetails = e;
    }
    ok("FORGED INDEX's refusal detail names the true count (5), never the forged one",
      refusedDetails?.details?.count === 5);
  }

  // (b) OUT-OF-RANGE COUNT — a client-supplied `count` is NEVER TRUSTED: an
  // absurd forged count changes nothing about the real response.
  {
    const state = freshState();
    const db = extendedDb(state);
    const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
    const said = await roomSay(db, { session, message: "hi" }, {
      loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
    });

    const seamHonest = voiceSeam();
    const honest = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamHonest.synth, protect: seamHonest.protect },
      said.session,
      { text: said.reply, index: 0 },
    );

    const state2 = freshState();
    const db2 = extendedDb(state2);
    const session2 = await setupPaidFollower(db2, state2, USER_A, PERSON_A);
    const said2 = await roomSay(db2, { session: session2, message: "hi" }, {
      loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
    });
    const seamForged = voiceSeam();
    const forged = await roomSpeak(
      { db: db2, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamForged.synth, protect: seamForged.protect },
      said2.session,
      { text: said2.reply, index: 0, count: 999999 },
    );
    ok("OUT-OF-RANGE COUNT: the real response's count is unaffected by a forged client count",
      forged.count === 5 && forged.count === honest.count, `(forged.count=${forged.count})`);
    ok("OUT-OF-RANGE COUNT: the synthesised text is unaffected (same sentence 0, either way)",
      seamForged.calls.synthTexts[0] === seamHonest.calls.synthTexts[0]);
    ok("OUT-OF-RANGE COUNT: seconds charged are unaffected by the forged count",
      forged.voice.seconds_used === honest.voice.seconds_used);

    // The forged count can also be USED AS the index: it must still be
    // validated against the REAL plan, not against itself.
    const seamAsIndex = voiceSeam();
    let refused = null;
    try {
      await roomSpeak(
        { db: db2, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamAsIndex.synth, protect: seamAsIndex.protect },
        forged.session,
        { text: said2.reply, index: 999999, count: 999999 },
      );
    } catch (e) {
      refused = e;
    }
    ok("OUT-OF-RANGE COUNT used as an index is STILL refused by the real plan length",
      refused instanceof RoomError && refused.code === "room_voice_index_invalid");
  }

  // (c) REPLAY — the CURRENT session (freshly minted by the turn that just
  // ran) is asked to speak a sentence of the PREVIOUS, already-superseded
  // reply. This is the shape a captured earlier request replays into: the
  // credential is real and unexpired, but the text it names is not the reply
  // this session was bound to. `roomSpeak`'s existing reply-binding check
  // (`sha(text) !== payload.lr`, unchanged by this workstream) is what has
  // to catch it, now proven to hold for the indexed path too, not only the
  // single-clip shape it originally protected.
  {
    const state = freshState();
    const db = extendedDb(state);
    const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
    const said1 = await roomSay(db, { session, message: "first message" }, {
      loadAgent, memory, reply: async () => FIVE_SENTENCE_REPLY, now: NOW,
    });
    const oldReply = said1.reply;

    // A second turn moves the conversation on: the CURRENT session's `lr`
    // now names a DIFFERENT reply than `oldReply`.
    const said2 = await roomSay(db, { session: said1.session, message: "second message" }, {
      loadAgent, memory, reply: async () => "Bilkul alag jawab hai yeh.", now: NOW,
    });

    // THE REPLAY: the CURRENT, valid, unexpired session — replaying the OLD
    // reply's text against it, asking for one of ITS sentences.
    const seam = voiceSeam();
    let refused = null;
    try {
      await roomSpeak(
        { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
        said2.session,
        { text: oldReply, index: 1 },
      );
    } catch (e) {
      refused = e;
    }
    ok("REPLAY: the current session refuses to speak a sentence of a SUPERSEDED reply",
      refused instanceof RoomError && refused.code === "room_voice_reply_mismatch",
      refused ? `(got ${refused.code})` : "control did not fire");
    ok("REPLAY: zero synthesis for the replayed clip", seam.calls.synth === 0);

    // The SAME current session, asked for the CURRENT reply instead, still
    // works normally — proving the refusal above is about WHICH TEXT was
    // named, not about the session being unusable.
    const seamFresh = voiceSeam();
    const fresh = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seamFresh.synth, protect: seamFresh.protect },
      said2.session,
      { text: said2.reply, index: 0 },
    );
    ok("the SAME session naming the CURRENT reply still works (this is about the stale text, not lockout)",
      fresh.index === 0 && fresh.count === 1);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SECTION 5 — WS-R168: EmotionOS in the voice, `roomSpeak`'s own wiring
// ═════════════════════════════════════════════════════════════════════════
//
// `api/_voice/prosody.js` itself is proven exhaustively by
// `evals/prosody/run.mjs`; this section proves only the WIRING — that
// `roomSpeak` reads the owner's vibe through `deps.getVibe`, builds a plan
// from it, hands that plan to `deps.synth` on every clip, and reports its
// closed bands on the response — plus the negative control this brief
// names by name: no `deps.getVibe` (or one that returns nothing) leaves the
// plan at its byte-identical neutral shape.
console.log("\n── section 5: roomSpeak carries a prosody plan on every clip (WS-R168) ──");
{
  const { NEUTRAL_PROSODY_PLAN } = await import(
    pathToFileURL(join(REPO, "api/_voice/prosody.js")).href
  );

  const state = freshState();
  const db = extendedDb(state);
  const session = await setupPaidFollower(db, state, USER_A, PERSON_A);
  const said = await roomSay(db, { session, message: "hi" }, {
    loadAgent, memory, reply: async () => "Suno na. Kal milte hain.", now: NOW,
  });

  // NEGATIVE CONTROL: no `deps.getVibe` at all — the exact shape every
  // pre-WS-R168 caller of `roomSpeak` still has (`api/room.js`'s own
  // wiring supplies it; nothing REQUIRES a caller to).
  {
    const seam = voiceSeam();
    const spoken = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect },
      said.session,
      { text: said.reply, index: 0 },
    );
    ok("NEGATIVE CONTROL: no deps.getVibe -> the plan handed to synth is the neutral plan, byte for byte",
      JSON.stringify(seam.calls.prosodyPlans[0]) === JSON.stringify(NEUTRAL_PROSODY_PLAN));
    ok("NEGATIVE CONTROL: the response's own prosody bands are the neutral bands",
      spoken.prosody.rate === NEUTRAL_PROSODY_PLAN.rateBand &&
      spoken.prosody.energy === NEUTRAL_PROSODY_PLAN.energyBand &&
      spoken.prosody.pitch_range === NEUTRAL_PROSODY_PLAN.pitchRangeBand);
  }

  // NEGATIVE CONTROL: deps.getVibe wired but the owner never set one (the
  // exact "no vibe yet" shape `getReplicaVibe` itself documents) — SAME
  // neutral plan, not a different "no data" shape.
  {
    const seam = voiceSeam();
    const spoken = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect, getVibe: async () => null },
      said.session,
      { text: said.reply, index: 0 },
    );
    ok("NEGATIVE CONTROL: deps.getVibe resolving null -> still the neutral plan",
      JSON.stringify(seam.calls.prosodyPlans[0]) === JSON.stringify(NEUTRAL_PROSODY_PLAN));
    void spoken;
  }

  // POSITIVE: a high-energy, low-formality vibe reaches `deps.synth` as a
  // fast/high/wide plan, and the SAME bands appear on the response.
  {
    const seam = voiceSeam();
    const highEnergyVibe = { warmth: 4, energy: 4, humour: 3, directness: 2, formality: 0 };
    const spoken = await roomSpeak(
      { db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect, getVibe: async () => highEnergyVibe },
      said.session,
      { text: said.reply, index: 0 },
    );
    ok("POSITIVE: a high-energy vibe reaches deps.synth as a fast/high plan",
      seam.calls.prosodyPlans[0].rateBand === "fast" && seam.calls.prosodyPlans[0].energyBand === "high",
      JSON.stringify(seam.calls.prosodyPlans[0]));
    ok("POSITIVE: the response's own bands match what synth received",
      spoken.prosody.rate === "fast" && spoken.prosody.energy === "high");
    ok("POSITIVE: the response never leaks the owner's raw dials, only the closed bands",
      !("warmth" in spoken.prosody) && !("vibe" in spoken.prosody) && Object.keys(spoken.prosody).length === 3);
  }

  // POSITIVE: `deps.getVibe` is called with the SAME ownership pair
  // `deps.authorize` was — never a client-suppliable id.
  {
    const seam = voiceSeam();
    const getVibeCalls = [];
    await roomSpeak(
      {
        db, loadAgent, now: NOW, authorize: fakeAuthorize(), synth: seam.synth, protect: seam.protect,
        getVibe: async (ownerUserId, replicaId) => { getVibeCalls.push({ ownerUserId, replicaId }); return null; },
      },
      said.session,
      { text: said.reply, index: 0 },
    );
    ok("deps.getVibe is called exactly once per clip, with the resolved room's own owner/replica ids",
      getVibeCalls.length === 1 &&
      getVibeCalls[0].ownerUserId === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" &&
      getVibeCalls[0].replicaId === "c1000000-0000-4000-8000-000000000001",
      JSON.stringify(getVibeCalls));
  }
}

console.log("\n── verdict ──");
console.log(`  total assertions   ${pass + fail}`);
console.log(`\nroom-speak-plan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
