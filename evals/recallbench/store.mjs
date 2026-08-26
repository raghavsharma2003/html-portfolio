// The fixture-backed query router — the half of this benchmark that is NOT
// the shipping code, kept in one file so the line between them is visible.
//
// ═════════════════════════════════════════════════════════════════════════
// WHAT THIS IS, AND WHAT IT IS NOT
// ═════════════════════════════════════════════════════════════════════════
//
// `route(sql, params)` answers each statement api/memory.js's opRecall issues,
// out of a per-dyad fixture. It is an EMULATION of what Postgres would return,
// and every emulated predicate is a thing this benchmark does NOT test. The
// split, stated once here and repeated in run.mjs's header:
//
//   REAL (the shipping code, running unmodified):
//     the Hinglish tokenizer, the leg fan-out and its concurrency, the
//     activity leg's fallback, the watch leg's two statements, the
//     co-citation SEEDING (which rows become seeds, which ids are excluded),
//     RRF fusion, the name-dedup across blocks, the stale-fact note, block
//     ORDER, the block headings and their fences, and the T5 whole-block
//     budget drop.
//
//   EMULATED (this file — a JavaScript reading of the SQL, not the SQL):
//     the word-boundary `~*` match, the background leg's RANK expression and
//     its reserved slot, the co-citation `citations &&` intersection and its
//     `shared desc` ordering, and every LIMIT.
//
//   ABSENT (exercised by nothing here, by construction):
//     the semantic/halfvec leg (see stubs/embed.mjs), the LLM extractor that
//     produces these rows in production (see run.mjs §0), and the forget
//     cascade's DELETEs (evals/recall/run.mjs's FATE walk owns that).
//
// THE UNROUTED-QUERY RULE is what keeps the emulation honest. Every statement
// is either routed, or listed in EXPECTED_EMPTY with a written reason, or it
// is recorded as UNROUTED and the run FAILS. A router that silently returned
// [] for a statement it did not recognise would turn a dead leg into a
// perfect-looking zero, which is the `realtime-recall-never` failure exactly.

let FIXTURE = null;
const unrouted = [];
const routedCounts = new Map();

export function loadFixture(f) {
  FIXTURE = f;
  unrouted.length = 0;
  routedCounts.clear();
  deriveFixtureValidity(f);
}
export function unroutedQueries() {
  return unrouted.slice();
}
export function routeCounts() {
  return Object.fromEntries(routedCounts);
}

const bump = (id) => routedCounts.set(id, (routedCounts.get(id) || 0) + 1);

/** The surface-switch leg's negative control — see the branch that reads it. */
let crossSurfaceOn = true;
export function setCrossSurface(on) {
  crossSurfaceOn = Boolean(on);
}

// ── DEVICE SCOPE, honoured (WS-O) ────────────────────────────────────────
//
// The legacy graph store (`meera_nodes`, `meera_edges`) is DEVICE-keyed; the
// vy_ store is PERSON-keyed. This router used to ignore the distinction and
// serve fixture rows to any caller, which made it blind to the single largest
// cross-surface property there is: a person who moves from the web app to
// WhatsApp resolves to the SAME person_id and a DIFFERENT device_id, so the
// person-keyed legs follow them and the device-keyed legs do not.
//
// A mock that OVER-RETURNS is the more dangerous kind: it makes a real gap
// invisible while every assertion stays green. So the device-keyed branches now
// check the bound device against the fixture's, exactly as the database would.
// `params[0]` is the device in every legacy-lane statement in api/memory.js —
// asserted, not assumed, by `deviceOf` returning undefined for anything else.
//
// Single-device fixtures are unaffected: every existing call binds the
// fixture's own deviceId, so every existing assertion sees exactly the rows it
// saw before.
function deviceOf(params) {
  const p = params && params[0];
  if (typeof p === "string") return p;
  if (Array.isArray(p) && p.every((x) => typeof x === "string")) return p;
  return undefined;
}

/** Does this statement's bound device belong to the fixture's legacy store? */
function deviceMatches(params) {
  const d = deviceOf(params);
  if (d === undefined) return true; // not a device-bound statement
  return Array.isArray(d) ? d.includes(FIXTURE.deviceId) : d === FIXTURE.deviceId;
}

/** Statements that legitimately return nothing for every fixture here, each
 *  with the reason it is empty rather than broken. Matched by substring. */
const EXPECTED_EMPTY = [
  // The rel bundle. These fixtures carry NO consolidated relationship state:
  // `fetchRelBundle` returns null the moment vy_rel_state is empty, which is
  // the real early-relationship path and is what keeps this benchmark about
  // RECALL rather than about the whole T2/T3/T4/T6 render stack.
  ["from vy_rel_state", "no consolidated rel-state in these fixtures (fetchRelBundle returns null)"],
  // The self bundle's three readers, reached through api/_engine.gen.js with
  // `q` injected. Same reason: not what is being measured.
  ["from vy_rel_texture", "self layer not under test"],
  ["from vy_self_arc", "self layer not under test"],
  ["from vy_agent_life", "self layer not under test (life.untold's reader)"],
  ["from vy_observation", "observation matcher not under test"],
  // The embedding join is unreachable with the embedder off (stubs/embed.mjs),
  // and is listed so that its APPEARING here would be caught rather than
  // quietly satisfied.
  ["from vy_embedding", "semantic leg off — see stubs/embed.mjs"],
  // Writes. `last_recalled` is touched on every recall; a benchmark that let
  // it mutate the fixture would score question 2 against a store question 1
  // had already changed.
  ["update meera_nodes", "write: deliberately inert so questions stay independent"],
];

// ─────────────────────────────────────────────────────────────────────────
// The emulated predicates. Each one names the SQL it stands in for.
// ─────────────────────────────────────────────────────────────────────────

/** opRecall builds `name ~* $n or summary ~* $n` with `\m<word>\M` params.
 *  This is that predicate: whole-word, case-insensitive. Emulated. */
const wordsFromParams = (params) =>
  params
    .filter((p) => typeof p === "string" && p.startsWith("\\m") && p.endsWith("\\M"))
    .map((p) => p.slice(2, -2));

const matchesWord = (text, word) => new RegExp(`\\b${word}\\b`, "i").test(String(text || ""));

/** The RANK expression, transcribed:
 *    salience * RECENCY * (1 + 0.35*ln(1+mentions)) * SPACED
 *  with RECENCY 1.0 for the identity kinds and a 60-day linear fade floored
 *  at 0.25 otherwise, and SPACED 0.6 / 1.0 / 1.25 by last_recalled age.
 *  Emulated — a benchmark that scored the ORDER of these rows would be
 *  scoring this function, so the fixtures are built so that membership never
 *  turns on it (see run.mjs §0). */
const IDENTITY_KINDS = new Set(["person", "place", "preference", "fact", "phrase"]);
const DAY = 86_400_000;
function rankOf(n, now) {
  const recency = IDENTITY_KINDS.has(n.kind)
    ? 1.0
    : Math.max(0.25, 1.0 - (now - new Date(n.updated_at).getTime()) / (DAY * 60));
  const spaced = !n.last_recalled
    ? 1.0
    : now - new Date(n.last_recalled).getTime() < 20 * 3_600_000
      ? 0.6
      : now - new Date(n.last_recalled).getTime() > 21 * DAY
        ? 1.25
        : 1.0;
  return (n.salience ?? 1) * recency * (1 + 0.35 * Math.log(1 + (n.mentions ?? 0))) * spaced;
}

// ── BI-TEMPORAL FACT EDGES (migration 056, WS-O) ────────────────────────
//
// The fixture files author STORE STATE, not conversation, so a row's
// valid_from/valid_to are whatever the WRITER would have put there. Rather
// than hand-typing two timestamps per row — which would make the fixture the
// authority on what "november" means, and would keep passing after the deriver
// broke — the store derives them here with the REAL deriver
// (src/engine/validity.ts, via api/_engine.gen.js), anchored on the row's own
// `created_at`, which is exactly what api/memory.js's node writer does with
// `Date.now()` on the turn the thing was said.
//
// A fixture may still pin `valid_from`/`valid_to` explicitly and that wins —
// the escape hatch for a row whose stored interval is the thing under test.
//
// If the bundle is missing, every row derives null and this harness behaves
// exactly as it did before 056, which is also what the product does.
// Top-level await: `loadFixture` is synchronous and is called from eight
// places, so the module is resolved once here rather than turning every call
// site async for a 300 KB import that never changes between fixtures.
const _vmod = await import("../../api/_engine.gen.js")
  .then((m) => (typeof m?.deriveFactValidity === "function" ? m : null))
  .catch(() => null);

/** Derived once per loadFixture, keyed by node id. */
let DERIVED = new Map();

export function deriveFixtureValidity(fixture) {
  DERIVED = new Map();
  const m = _vmod;
  if (!m) return DERIVED;
  for (const n of fixture.nodes || []) {
    if (n.valid_from !== undefined || n.valid_to !== undefined) continue;
    const saidAt = Date.parse(n.created_at);
    if (!Number.isFinite(saidAt)) continue;
    try {
      const v = m.deriveFactValidity({ id: String(n.id), name: n.name, kind: n.kind, summary: n.summary, saidAt });
      if (v) DERIVED.set(n.id, v);
    } catch {
      /* an unreadable date is a null column, never a lost row */
    }
  }
  return DERIVED;
}

const NODE_COLS = (n) => {
  const d = DERIVED.get(n.id);
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    summary: n.summary,
    feel: n.feel ?? null,
    updated_at: n.updated_at,
    created_at: n.created_at,
    mentions: n.mentions ?? 0,
    last_recalled: n.last_recalled ?? null,
    valid_from:
      n.valid_from !== undefined ? n.valid_from : d ? new Date(d.validFrom).toISOString() : null,
    valid_to:
      n.valid_to !== undefined
        ? n.valid_to
        : d && d.validTo != null
          ? new Date(d.validTo).toISOString()
          : null,
  };
};

const FACT_COLS = (f) => ({
  id: f.id,
  kind: f.kind,
  name: f.name,
  body: f.body,
  feel: f.feel ?? null,
  created_at: f.created_at,
  citations: f.citations ?? [],
});

// ─────────────────────────────────────────────────────────────────────────
export function route(sql, params) {
  if (!FIXTURE) throw new Error("recallbench: route() called with no fixture loaded");
  const s = String(sql);
  const now = FIXTURE.now;

  for (const [needle, _why] of EXPECTED_EMPTY) {
    if (s.includes(needle)) {
      bump(`empty:${needle}`);
      return [];
    }
  }

  // vy_person_device — personIdFor.
  //
  // The predicate is `select person_id from` and not a bare table match, and
  // that is a bug this router already made once: WS-O's surface-switch leg
  // names `vy_person_device` in a SUBQUERY, so a bare table match swallowed it
  // whole and served it a person row. The leg then contributed nothing, every
  // assertion stayed green, and the only visible symptom was a route count.
  // A router branch must match the STATEMENT, never a table that appears in it.
  if (s.includes("select person_id from vy_person_device")) {
    bump("person");
    return [{ person_id: FIXTURE.personId }];
  }

  // THE BACKGROUND LEG: 5 ranked (slot 0) + 1 reserved oldest-high-salience
  // (slot 1). The `union all` shape is reproduced including the slot column,
  // because opRecall re-sorts on it and a router that returned them already
  // ordered would hide a bug in that re-sort.
  if (s.includes("with scored as")) {
    if (!deviceMatches(params)) { bump("background:other-device"); return []; }
    bump("background");
    const scored = FIXTURE.nodes.map((n) => ({ ...NODE_COLS(n), salience: n.salience ?? 1, r: rankOf(n, now) }));
    const ranked = scored.slice().sort((a, b) => b.r - a.r || new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 5);
    const rankedIds = new Set(ranked.map((r) => r.id));
    const reserved = scored
      .filter((x) => (x.salience ?? 0) >= 2.0 && !rankedIds.has(x.id))
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .slice(0, 1);
    return [...ranked.map((r) => ({ ...r, slot: 0 })), ...reserved.map((r) => ({ ...r, slot: 1 }))];
  }

  // ── THE SURFACE-SWITCH LEG (WS-O) ────────────────────────────────────
  //
  // MUST BE TESTED BEFORE THE KEYWORD LEG: both statements select `${COLS}`
  // from `meera_nodes n`, so a router that checked the keyword branch first
  // would serve home rows to the cross-surface query and this leg would be
  // untestable — the same trap the watch branches' ordering note describes.
  // The discriminator is the one thing only this statement has:
  // `n.device_id <> $1`.
  //
  // THE MODEL. A fixture's rows live on ONE device (`FIXTURE.deviceId`), and
  // the mock resolves any device to the fixture's person, exactly as
  // `vy_surface_identity` does for a person on two surfaces. So:
  //   caller IS the home device  -> the person's OTHER devices hold nothing.
  //   caller is ANOTHER device   -> this query is how the home device's rows
  //                                 reach them, which is the whole feature.
  if (s.includes("from meera_nodes n") && s.includes("n.device_id <> $1")) {
    // THE NEGATIVE CONTROL. `setCrossSurface(false)` makes both halves of the
    // leg fail exactly the way a real SQL error would — by throwing, which
    // `api/memory.js`'s `.catch` turns into the `null` that drops the whole
    // contribution. It is how §3c measures the pre-fix state without keeping a
    // second copy of opRecall, and it is how the fail-safe degrade path is
    // proved rather than asserted: with this off, recall must be EXACTLY what
    // it was before the leg existed.
    if (!crossSurfaceOn) throw new Error("recallbench: cross-surface leg disabled (negative control)");
    const caller = deviceOf(params);
    if (caller === FIXTURE.deviceId) {
      bump("cross-surface:home");
      return [];
    }
    bump("cross-surface:away");
    const words = wordsFromParams(params);
    const rows = words.length
      ? FIXTURE.nodes.filter((n) => words.some((w) => matchesWord(n.name, w) || matchesWord(n.summary, w)))
      : FIXTURE.nodes;
    return rows
      .map((n) => ({ ...NODE_COLS(n), salience: n.salience ?? 1 }))
      .sort((a, b) => rankOf(b, now) - rankOf(a, now))
      .slice(0, 6);
  }

  // The forget terms the surface-switch leg reads across the person's devices.
  // `FIXTURE.forgetTerms` is the escape hatch a consent case sets; every dyad
  // leaves it absent, which is the real state of a person who never asked her
  // to forget anything.
  if (s.includes("from meera_forget f")) {
    if (!crossSurfaceOn) throw new Error("recallbench: cross-surface leg disabled (negative control)");
    bump("cross-surface:terms");
    return (FIXTURE.forgetTerms || []).map((term) => ({ term }));
  }

  // THE KEYWORD LEG over meera_nodes
  if (s.includes("from meera_nodes n") && s.includes("id, name, kind, summary")) {
    if (!deviceMatches(params)) { bump("keyword:other-device"); return []; }
    bump("keyword");
    const words = wordsFromParams(params);
    if (!words.length) return [];
    return FIXTURE.nodes
      .filter((n) => words.some((w) => matchesWord(n.name, w) || matchesWord(n.summary, w)))
      .map((n) => ({ ...NODE_COLS(n), salience: n.salience ?? 1 }))
      .sort((a, b) => rankOf(b, now) - rankOf(a, now))
      .slice(0, 8);
  }

  // neighbour-name resolution for edges pointing outside the recalled set
  if (s.includes("select id, name from meera_nodes")) {
    if (!deviceMatches(params)) { bump("names:other-device"); return []; }
    bump("names");
    const ids = new Set((params[1] || []).map(Number));
    return FIXTURE.nodes.filter((n) => ids.has(n.id)).map((n) => ({ id: n.id, name: n.name }));
  }

  // meera_edges
  if (s.includes("from meera_edges e")) {
    if (!deviceMatches(params)) { bump("edges:other-device"); return []; }
    bump("edges");
    const ids = new Set((params[1] || []).map(Number));
    return (FIXTURE.edges || []).filter((e) => ids.has(e.src) || ids.has(e.dst)).slice(0, 30);
  }

  // THE ACTIVITY LEG — `f.name like 'activity:%'`, word-matched on body when
  // there are query words, most-recent-few when there are not.
  if (s.includes("f.name like 'activity:%'")) {
    bump("activity");
    const words = wordsFromParams(params);
    const rows = (FIXTURE.facts || []).filter((f) => String(f.name).startsWith("activity:"));
    const hit = words.length ? rows.filter((f) => words.some((w) => matchesWord(f.body, w))) : rows;
    return hit
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 4)
      .map(FACT_COLS);
  }

  // THE CO-CITATION HOP — `f.citations && $2`, excluding the seed ids, never
  // an activity row, ordered by the size of the shared-citation intersection.
  if (s.includes("f.citations &&")) {
    bump("cocite");
    const seedCites = new Set((params[1] || []).map(Number));
    const excluded = new Set((params[2] || []).map(Number));
    return (FIXTURE.facts || [])
      .filter((f) => !String(f.name).startsWith("activity:"))
      .filter((f) => !excluded.has(Number(f.id)))
      .map((f) => ({ ...FACT_COLS(f), shared: (f.citations || []).filter((c) => seedCites.has(Number(c))).length }))
      .filter((f) => f.shared > 0)
      .sort((a, b) => b.shared - a.shared || new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 4);
  }

  // THE WATCH LEG — assertions-with-no-moment FIRST, then moments.
  //
  // The order matters and the reason is a trap worth leaving written down: the
  // PHOTOS statement contains `not exists (select 1 from vy_shared_moment m
  // where m.assertion_id = a.id)`, so a router that tested for
  // "from vy_shared_moment m" first would serve moments to the photo query and
  // the photo leg would read as permanently empty — a dead leg that looks like
  // an empty store, which is the exact `realtime-recall-never` shape this
  // router's unrouted rule exists to prevent.
  if (s.includes("from vy_visual_assertion a") && s.includes("not exists")) {
    bump("watch.photos");
    const words = wordsFromParams(params);
    const rows = (FIXTURE.photos || []).filter((p) =>
      words.length ? words.some((w) => matchesWord(p.claim, w)) : true,
    );
    return rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 4);
  }
  if (s.includes("from vy_shared_moment m")) {
    bump("watch.moments");
    const words = wordsFromParams(params);
    const rows = (FIXTURE.moments || []).filter((m) =>
      words.length ? words.some((w) => matchesWord(m.reaction, w) || matchesWord(m.claim, w)) : true,
    );
    return rows.slice().sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 4);
  }
  unrouted.push(s.replace(/\s+/g, " ").slice(0, 160));
  return [];
}
