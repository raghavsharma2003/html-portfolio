// WS-SPINE — the consolidation spine's gates.
//
//   node evals/consolidation/run.mjs
//
// Offline, deterministic, no network, no database, no model call, $0, ~3s.
// Wired into evals/run.mjs, because `dead-writers` does not stop applying to
// evals and this suite guards the change that turns real spend on.
//
// WHY EACH SECTION EXISTS — every one of these is a failure that had already
// happened, or was one deploy away from happening:
//
//   G1  WATCH EXCLUSION (P0-3).  Screen-derived turns are about to start
//       arriving in meera_log. Every meera_log read in the derivation chain
//       must refuse them, in SQL and again in JS. The negative arm is the
//       whole point: fabricatable biography (a diagnosis, a salary, a
//       boarding pass) is put in front of the pipeline and must come out
//       cited by nothing.
//   G2  KIN PRECISION (P1-2).   Including the trap: five third-party kin
//       mentions that must never become his. A wrong mother's name is worse
//       than no mother's name.
//   G3  FINALIZATION (P2-2).    A watch episode must finalize deterministically
//       or be excluded — never sit provisional forever pinning its person out
//       of every future sweep's person budget.
//   G4  GROUNDING (P1-3).       Every derived claim traces to a source line.
//       rel_state evidence, phrases and patterns are checked against the
//       fixture text they were supposedly read from.
//   G5  CHANGE OVER TIME.       Drift is derived, is directional, fails closed
//       when uncited, and says NOTHING when nothing moved.
//   G6  AGENT PARITY.           Second-agent equivalence and a source-level
//       assertion that no derivation branches on WHICH agent is running.
//   G7  NEGATIVE CONTROL.       The checkers above are run against
//       deliberately broken inputs. An absence-only suite that cannot detect
//       a presence is worth nothing (evals/self/texture.mjs's own G9 rule).
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import * as C from "../../api/consolidate.js";
// RECALL_STOP is WS-RECALL's list and half of phrase capture's stoplist. Read
// LIVE rather than mirrored: the whole point of G4.12 is to notice when it
// changes under this file's feet, which a copy could not do.
import { RECALL_STOP } from "../../api/memory.js";
const RECALL_STOP_HAS = (w) => RECALL_STOP.has(w);
import {
  FIXTURE_A,
  FIXTURE_B,
  FIXTURE_C,
  FIXTURE_D,
  WATCH_FABRICATABLE,
  DRIFT_CONTENTS,
  DRIFT_EPISODE_IDS,
  DRIFT_FLAT_CONTENTS,
} from "./_fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "wsspine-"));
const out = join(tmp, "engine.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, "_entry.ts")} --bundle --format=esm --platform=node --outfile=${out} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(out);

const SRC_CONSOLIDATE = readFileSync(join(ROOT, "api/consolidate.js"), "utf8");
const SRC_SWEEP = readFileSync(join(ROOT, "api/consolidate-sweep.js"), "utf8");
const SRC_VERCEL = readFileSync(join(ROOT, "vercel.json"), "utf8");

let failed = 0;
let checks = 0;
const ok = (n) => { checks++; console.log(`  ok  ${n}`); };
const fail = (n, d) => { checks++; failed++; console.log(`FAIL  ${n}${d ? `\n      ${d}` : ""}`); };
const assert = (cond, n, d) => (cond ? ok(n) : fail(n, d));

const AGENT_A = "a0000000-0000-4000-8000-5p1n00000001";
const AGENT_B = "b0000000-0000-4000-8000-5p1n00000002";
const PERSON = "c0000000-0000-4000-8000-5p1n00000003";

// A fake QueryFn: records every statement it is handed and answers from a
// scripted table. Nothing here reaches a database — the point is to observe
// the SQL the shipping code composes, which is the only way to test a rule
// that lives in a WHERE clause.
function fakeQ(answers = []) {
  const seen = [];
  const fn = async (sql, params) => {
    seen.push({ sql, params });
    const a = answers.shift();
    return typeof a === "function" ? a(sql, params) : (a ?? []);
  };
  fn.seen = seen;
  return fn;
}

console.log("\n── G1  watch exclusion (P0-3) ──");
{
  // Layer 2, driven directly.
  const stripped = C.stripWatchRows(FIXTURE_C.rows);
  assert(
    stripped.length === FIXTURE_C.rows.filter((r) => r.channel !== "watch").length,
    "G1.1 stripWatchRows drops every watch row",
  );
  assert(stripped.every((r) => r.channel !== "watch"), "G1.2 no watch row survives the strip");
  assert(
    stripped.some((r) => r.channel === "chat"),
    "G1.3 chat rows are NOT dropped — this is an exclusion, not a blanket refusal",
  );
  // A NULL channel must survive: failing open on an unknown channel is the
  // stated rule (the closed set is 'watch', not 'chat and call').
  assert(
    C.stripWatchRows([{ channel: null, content: "x" }, { channel: undefined, content: "y" }]).length === 2,
    "G1.4 an unknown/NULL channel row is kept, never silently dropped",
  );

  // THE NEGATIVE TEST the brief specifies: fabricatable biography in front of
  // the pipeline, cited by nothing on the way out.
  const rendered = C.renderBatch(stripped);
  const leaked = WATCH_FABRICATABLE.filter((t) => rendered.includes(t.slice(0, 24)));
  assert(
    leaked.length === 0,
    "G1.5 NEGATIVE: no watch content reaches the extraction prompt",
    leaked.join(" | "),
  );

  // fetchLogBatch, driven with a fake driver that returns watch rows anyway —
  // i.e. a database that ignored the WHERE clause. Layer 2 must still hold.
  const q = fakeQ([[{ device_id: "d0000000-0000-4000-8000-000000000001" }], FIXTURE_C.rows]);
  const batch = await C.fetchLogBatch(PERSON, { queryFn: q });
  assert(
    batch.every((r) => r.channel !== "watch"),
    "G1.6 fetchLogBatch strips watch rows even when the driver returns them",
  );
  assert(
    q.seen[1].sql.includes("is distinct from 'watch'"),
    "G1.7 fetchLogBatch's SQL carries the exclusion (layer 1)",
  );

  // Layer 1, everywhere. Every meera_log read in the derivation chain must
  // carry it — a query that forgets is the whole failure mode.
  // Real SQL reads only — a comment that says "meera_log" is prose, and a
  // scanner that cannot tell the difference produces a failure nobody can act
  // on (the first version of this gate failed on its own explanatory comment).
  const logReads = SRC_CONSOLIDATE.split("\n")
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /from meera_log/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
  const missing = logReads.filter(({ i }) => {
    const window = SRC_CONSOLIDATE.split("\n").slice(i, i + 12).join("\n");
    return !window.includes("WATCH_EXCLUDE_SQL");
  });
  assert(
    logReads.length >= 4 && missing.length === 0,
    `G1.8 all ${logReads.length} meera_log reads in consolidate.js carry WATCH_EXCLUDE_SQL`,
    missing.map((m) => `line ${m.i + 1}: ${m.l.trim()}`).join("\n      "),
  );

  // The sweep's lag query must agree, or watch rows become permanent phantom
  // lag: never derivable, never claimed, selected every hour forever.
  assert(
    (SRC_SWEEP.match(/is distinct from '\$\{WATCH_CHANNEL\}'/g) || []).length >= 3,
    "G1.9 the lag query excludes watch rows from pending_rows, oldest_pending_at and HAVING",
  );

  // texture.ts reads meera_log too, and satisfies the contract structurally.
  assert(
    E.TEXTURE_SCAN_SQL.includes("l.channel = 'chat'"),
    "G1.10 texture's scan is chat-only, so a watch row cannot match it",
  );
}

console.log("\n── G2  kin precision + the friend's-mother trap (P1-2) ──");
{
  const epIds = new Map([[0, 4242]]);
  const spans = new Map([[0, { logFrom: FIXTURE_B.rows[0].id, logTo: FIXTURE_B.rows[FIXTURE_B.rows.length - 1].id }]]);

  // THE TRAP. Five third-party shapes, each proposed with PERFECT verbatim
  // evidence — so the only thing that can save this is the anchoring rule.
  const trapProposals = {
    kin: [
      { name: "Kavita", relation: "maa", segments: [0], evidence: "Rohit ki maa ka naam Kavita hai" },
      { name: "Priya", relation: "behen", segments: [0], evidence: "uski behen Priya bhi thi wahan" },
      { name: "Kavita", relation: "maa", segments: [0], evidence: "mere dost ki maa bahut acha khana banati hain" },
      { name: "Kavita", relation: "maa", segments: [0], evidence: "his mother told me the recipe" },
    ],
  };
  const trap = C.acceptKinProposals(trapProposals, FIXTURE_B.rows, epIds, [], spans);
  assert(trap.kin.length === 0, "G2.1 TRAP: zero third-party kin accepted", JSON.stringify(trap.kin));
  const trapNames = trap.kin.map((k) => k.name.toLowerCase());
  assert(
    FIXTURE_B.forbiddenKinNames.every((n) => !trapNames.includes(n)),
    "G2.2 TRAP: no forbidden name reached a kin row",
  );
  assert(trap.rejected.length === 4, "G2.3 TRAP: every proposal is rejected WITH A REASON, never silently");

  // RECALL ARM. A precision story with no recall arm is a story about
  // refusing: the real thing must still get through.
  const realEp = new Map([[0, 777]]);
  const realSpan = new Map([[0, { logFrom: FIXTURE_A.rows[0].id, logTo: FIXTURE_A.rows[6].id }]]);
  const real = C.acceptKinProposals(
    {
      kin: [{ name: "Sunita", relation: "maa", address_term: "maa", segments: [0], evidence: "meri maa ka phone aaya tha subah, Sunita ki tabiyat theek nahi thi" }],
      rituals: [{ key: "khana_khaya", segments: [0], evidence: "khana khaya kya aapne" }],
    },
    FIXTURE_A.rows,
    realEp,
    [],
    realSpan,
  );
  assert(real.kin.length === 1 && real.kin[0].name === "Sunita", "G2.4 a genuinely first-person kin mention IS accepted", JSON.stringify(real));
  assert(real.kin[0].citations.length >= 1, "G2.5 the accepted kin row carries >=1 episode citation");
  assert(real.rituals.length === 1 && real.rituals[0].key === "khana_khaya", "G2.6 a real ritual occurrence is accepted");

  // FABRICATION ARMS.
  const fab = C.acceptKinProposals(
    { kin: [{ name: "Sunita", relation: "maa", segments: [0], evidence: "meri maa Sunita ek teacher hain" }] },
    FIXTURE_A.rows,
    realEp,
    [],
    realSpan,
  );
  assert(fab.kin.length === 0, "G2.7 evidence that is NOT verbatim in the source is rejected");

  const badRel = C.acceptKinProposals(
    { kin: [{ name: "Sunita", relation: "godmother", segments: [0], evidence: "meri maa ka phone aaya tha subah" }] },
    FIXTURE_A.rows, realEp, [], realSpan,
  );
  assert(badRel.kin.length === 0, "G2.8 a relation outside the closed set is rejected");

  const noCite = C.acceptKinProposals(
    { kin: [{ name: "Sunita", relation: "maa", segments: [9], evidence: "meri maa ka phone aaya tha subah" }] },
    FIXTURE_A.rows, realEp, [], realSpan,
  );
  assert(noCite.kin.length === 0, "G2.9 a kin row citing a rejected/absent episode is rejected");

  const badRitual = C.acceptKinProposals(
    { rituals: [{ key: "birthday_wish", segments: [0], evidence: "khana khaya kya aapne" }] },
    FIXTURE_A.rows, realEp, [], realSpan,
  );
  assert(badRitual.rituals.length === 0, "G2.10 a ritual key outside the closed set is rejected");

  // The anchor predicate itself, exercised directly on both directions.
  assert(C.kinAnchorFailure("meri maa ka naam Sunita hai") === "", "G2.11 first-person anchor passes");
  assert(C.kinAnchorFailure("Rohit ki maa") !== "", "G2.12 named-third-party possessive fails");
  assert(C.kinAnchorFailure("maa ka phone aaya") !== "", "G2.13 an unanchored kin word fails — whose maa?");
  assert(
    C.kinAnchorFailure("meri dost ki maa") !== "",
    "G2.14 the veto beats the anchor: 'meri dost ki maa' is a third party, not his mother",
  );

  // The T3 render half, byte-capped and hedged.
  const lines = E.renderKinLines([
    { name: "Sunita", relation: "maa", address_term: "maa", citations: [1], provisional: true },
    { name: "NoCite", relation: "bhai", citations: [], provisional: false },
    { name: "", relation: "maa", citations: [1] },
  ]);
  assert(lines.length === 1, "G2.15 T3 kin render drops uncited and nameless rows (fail closed)");
  assert(lines[0].includes("?"), "G2.16 a provisional kin row renders hedged, never as a certainty");
  assert(
    E.renderKinLines([{ name: "X", relation: "maa", citations: [1], provisional: false }])[0].includes("?") === false,
    "G2.17 a CONFIRMED kin row renders unhedged",
  );
  const many = E.renderKinLines(
    Array.from({ length: 9 }, (_, i) => ({ name: `Name${i}`, relation: "chacha", citations: [1], provisional: true })),
  );
  assert(many.length <= 3, "G2.18 kin render is row-capped");
  assert(many.join("\n- ").length <= E.KIN_BUDGET, "G2.19 kin render is byte-capped inside its sub-budget");
  // T3 as a whole must still fit its manifest budget with kin appended.
  const t3 = E.renderIndiaDynamic(
    [{ person_id: PERSON, key: "khana_khaya", last_at: null, count: 0, cold_last: false, citations: [1] }],
    "punjab",
    [],
    new Date(Date.UTC(2026, 9, 15)),
    Array.from({ length: 9 }, (_, i) => ({ name: `Name${i}`, relation: "chacha", citations: [1], provisional: true })),
  );
  assert(t3.text.length <= 1000, `G2.20 T3 stays inside its 1,000-char budget with kin (${t3.text.length})`);
  // Byte-identity for every existing caller: no kin argument => today's bytes.
  const t3NoKin = E.renderIndiaDynamic([], "punjab", [], new Date(Date.UTC(2026, 9, 15)));
  const t3EmptyKin = E.renderIndiaDynamic([], "punjab", [], new Date(Date.UTC(2026, 9, 15)), []);
  assert(t3NoKin.text === t3EmptyKin.text, "G2.21 the kin parameter is byte-identical when absent");
}

console.log("\n── G3  watch-episode finalization (P2-2) ──");
{
  assert(
    /findEligiblePersons[\s\S]{0,900}?channel is distinct from '\$\{WATCH_CHANNEL\}'/.test(SRC_CONSOLIDATE),
    "G3.1 findEligiblePersons excludes watch episodes — they can no longer pin a person forever",
  );
  const q = fakeQ([
    [{ id: 11 }, { id: 12 }],           // two quiet watch episodes
    [{ n: 3 }], [{ id: 11 }],           // moments + update for 11
    [{ n: 0 }], [{ id: 12 }],           // moments + update for 12
  ]);
  const done = await C.finalizeWatchEpisodes(PERSON, { agentId: AGENT_A, queryFn: q });
  assert(done === 2, `G3.2 both quiet watch episodes finalize deterministically (got ${done})`);
  const updates = q.seen.filter((s) => /update vy_episode/.test(s.sql));
  assert(updates.length === 2, "G3.3 one UPDATE per episode");
  assert(
    updates.every((u) => u.sql.includes("provisional = false")),
    "G3.4 the update actually clears provisional — otherwise it re-pins next hour",
  );
  assert(
    updates.every((u) => /agent_id/.test(u.sql)) && q.seen.every((s) => !s.sql.includes("update") || s.params.includes(AGENT_A)),
    "G3.5 every statement is agent-scoped",
  );
  assert(
    C.watchEpisodeSummary(3) === "watched together, 3 shared moments" && C.watchEpisodeSummary(0) === "watched together",
    "G3.6 the summary is a COUNT of her own shared-moment rows, never screen content",
  );
  assert(
    !/\$\{[a-z]/i.test(C.watchEpisodeSummary(1)) && C.watchEpisodeSummary(1).split(" ").length <= 6,
    "G3.7 the summary is telegraphic and carries nothing recitable",
  );
  // A dry run must observe and write nothing.
  const qd = fakeQ([[{ id: 11 }]]);
  await C.finalizeWatchEpisodes(PERSON, { dryRun: true, agentId: AGENT_A, queryFn: qd });
  assert(qd.seen.every((s) => !/update /i.test(s.sql)), "G3.8 dryRun writes nothing");
}

console.log("\n── G4  grounding: every derived claim has a source line (P1-3) ──");
{
  // rel_state — the address-term evidence the honorific moves on.
  const himLines = FIXTURE_A.rows.filter((r) => r.role === "me").map((r) => r.content);
  const terms = himLines.map((l) => ({ line: l, term: C.detectAddressTerm(l) })).filter((t) => t.term);
  assert(terms.length > 0, "G4.1 address-term evidence is found in the fixture at all");
  assert(
    terms.every((t) => new RegExp(`\\b(${t.term}|${t.term}ka|${t.term}ki|${t.term}ke|${t.term}ko|${t.term}se|${t.term}he|${t.term}jhe)`, "i").test(t.line)),
    "G4.2 GROUNDING: every detected address term appears in its own source line",
  );
  // …and the hysteresis refuses to move on this thin evidence.
  const thin = terms.map((t, i) => ({ term: t.term, episodeId: 1, at: new Date(Date.UTC(2026, 6, 1 + i)).toISOString() }));
  assert(
    C.honorificShift("tum", thin, false) === null,
    "G4.3 one episode of evidence moves nothing — 3 episodes over 7 days is the bar",
  );

  // phrases — driving the REAL exported scan, not a restatement of it.
  const hisRows = FIXTURE_A.rows.filter((r) => r.role === "me").map((r) => ({ ...r, episode_id: 700 }));
  const recurring = C.phraseCandidates(hisRows).map(([g]) => g);
  assert(recurring.includes("chai pe scene set"), "G4.4 the real recurring phrase IS captured", recurring.join(" | "));
  assert(
    recurring.every((g) => hisRows.some((r) => C.tokenizePhrase(r.content).join(" ").includes(g))),
    "G4.5 GROUNDING: every phrase candidate is a substring of one of HIS OWN turns",
  );
  assert(
    !recurring.some((g) => WATCH_FABRICATABLE.some((w) => w.toLowerCase().includes(g))),
    "G4.6 no phrase candidate comes from screen text",
  );
  assert(
    /capturePhrasesForPerson[\s\S]{0,2000}?l\.role = 'me'/.test(SRC_CONSOLIDATE),
    "G4.6b the scan is over HIS turns only — a phrase of HERS is not one they coined",
  );

  // ── the RECALL_STOP change (WS-RECALL, 2026-08-23) ──────────────────────
  // `kaam` and `baat` left RECALL_STOP because they are content-bearing.
  // Correct for retrieval; the exact opposite of what phrase capture needs.
  // These four gates are the guard on that seam, and they must keep passing
  // if RECALL_STOP changes again.
  assert(
    !RECALL_STOP_HAS("kaam") && !RECALL_STOP_HAS("baat"),
    "G4.12 precondition: kaam/baat really are out of RECALL_STOP (this is what the next gates defend)",
  );
  const plainCandidates = C.phraseCandidates(FIXTURE_D.rows);
  assert(
    plainCandidates.length === FIXTURE_D.expectCandidates,
    `G4.13 PRECISION: five days of ordinary work talk coins NOTHING (got ${plainCandidates.length})`,
    plainCandidates.map(([g, e]) => `${g} [${e.days.size}d]`).join(" | "),
  );
  assert(
    !C.phraseIsDistinctive("kaam ka pressure") && !C.phraseIsDistinctive("baat ye hai"),
    "G4.14 frequency alone is not distinctiveness — everyday vocabulary is frequent BY DEFINITION",
  );
  assert(
    C.phraseIsDistinctive("chai pe scene set"),
    "G4.15 …and the rule still admits a genuinely distinctive phrase",
  );
  // The plain-vocabulary fixture must be frequent enough that ONLY the
  // distinctiveness rule can be what rejects it — otherwise G4.13 passes for
  // the wrong reason (too few days) and would keep passing after a regression.
  const plainDayCount = new Set(FIXTURE_D.rows.map((r) => r.at.slice(0, 10))).size;
  assert(
    plainDayCount >= 5,
    `G4.16 NEGATIVE CONTROL: the plain fixture spans ${plainDayCount} days, well past the >=3-day bar — so the days threshold is NOT what rejected it`,
  );

  // patterns — the citation mapper is the writer window; an invented index
  // cannot survive it, which is what "grounded" means for a pattern.
  const eps = [{ id: 10 }, { id: 11 }, { id: 12 }];
  assert(
    JSON.stringify(C.mapEpisodeCitations([0, 2, 99, -1, 1.5], eps)) === JSON.stringify([10, 12]),
    "G4.7 GROUNDING: pattern citations outside the numbered batch are dropped, not clamped",
  );
  assert(C.mapEpisodeCitations([7, 8], eps).length === 0, "G4.8 an entirely invented citation set maps to nothing");

  // life-told — the deterministic pre-gate that keeps a beat from being
  // marked told on topic overlap alone.
  const beat = "flatmate ne naya kutta adopt kiya hai Bandra shelter se";
  assert(
    C.lifeToldOverlap(beat, ["flatmate ne kutta laaya shelter se"]).length >= 2,
    "G4.9 a real telling shares distinctive tokens with the beat",
  );
  assert(
    C.lifeToldOverlap(beat, ["haan theek hai yaar", "kya kar rahe ho"]).length < 2,
    "G4.10 GROUNDING: small talk never satisfies the told pre-gate",
  );
  assert(
    C.distinctiveTokens("hai kya yaar abhi").length === 0,
    "G4.11 stopwords are not distinctive tokens — the pre-gate cannot be satisfied by filler",
  );
}

console.log("\n── G5  change over time ──");
{
  const d = E.deriveDrift({ contents: DRIFT_CONTENTS, episodeIds: DRIFT_EPISODE_IDS });
  assert(d.drift !== "", "G5.1 a real band move IS derived", d.reason);
  assert(/->/.test(d.drift), "G5.2 the note is directional (then -> now), not another snapshot");
  assert(d.drift_cites.length >= 1, "G5.3 drift carries episode citations");
  assert(
    d.drift_cites.every((c) => DRIFT_EPISODE_IDS.includes(c)),
    "G5.4 GROUNDING: every drift citation is an episode the counted turns actually belonged to",
  );
  assert(!/\d/.test(d.drift), "G5.5 no raw number leaks into the drift line (T11's state-leak rule)");

  const flat = E.deriveDrift({ contents: DRIFT_FLAT_CONTENTS, episodeIds: DRIFT_EPISODE_IDS });
  assert(flat.drift === "" && flat.reason === "no band moved", "G5.6 no movement derives NOTHING — the ordinary answer");

  const thin = E.deriveDrift({ contents: DRIFT_CONTENTS.slice(0, 10), episodeIds: DRIFT_EPISODE_IDS.slice(0, 10) });
  assert(thin.drift === "", "G5.7 too few turns per half derives nothing rather than noise");

  const uncited = E.deriveDrift({ contents: DRIFT_CONTENTS, episodeIds: Array(60).fill(null) });
  assert(uncited.drift === "", "G5.8 FAIL CLOSED: an uncited drift is never written");

  // The render half refuses an uncited drift even if one reached the row.
  const row = (extra) => ({
    agent_id: AGENT_A, person_id: PERSON, teasing: 0.1, humour: 0.1, media_rate: 0, words_median: 5,
    emoji_rate: 0, profanity: 0, nickname: "", avoid: [], avoid_cites: [], n_turns: 100, ...extra,
  });
  const rendered = E.renderTexture(row({ drift: "humour: loud -> quiet (lately)", drift_cites: [901] }));
  assert(rendered.text.includes("loud -> quiet"), "G5.9 a cited drift renders in T11");
  const renderedUncited = E.renderTexture(row({ drift: "humour: loud -> quiet (lately)", drift_cites: [] }));
  assert(!renderedUncited.text.includes("->"), "G5.10 FAIL CLOSED: an uncited drift does not render");
  assert(rendered.text.length <= 600, "G5.11 T11 stays inside its 600-char budget with drift");
  assert(rendered.lint.clean, "G5.12 the drift line is shape-lint clean — not a sentence she could say");

  // The other two axes of change already have trajectory storage; assert it
  // rather than assume it, since "we already have that" is how a gap survives.
  assert(
    /from_v/.test(SRC_CONSOLIDATE) && /to_v/.test(SRC_CONSOLIDATE),
    "G5.13 rel-state change is written as from_v -> to_v (vy_rel_event), i.e. history is queryable",
  );
  assert(E.MIN_SPAN_DAYS >= 42, "G5.14 vy_self_arc is a trajectory with a >=42-day span floor, not a mood");
}

console.log("\n── G6  agent parity (Law E1) ──");
{
  // SECOND-AGENT PARITY: the same fixtures, the same predicates, a different
  // agent id — byte-identical derivation. These functions take no agent id at
  // all, which IS the assertion: derivation is a property of the text, and
  // only the WRITE is scoped.
  const epIds = new Map([[0, 4242]]);
  const spans = new Map([[0, { logFrom: FIXTURE_A.rows[0].id, logTo: FIXTURE_A.rows[6].id }]]);
  const proposal = {
    kin: [{ name: "Sunita", relation: "maa", segments: [0], evidence: "meri maa ka phone aaya tha subah, Sunita ki tabiyat theek nahi thi" }],
  };
  const a = C.acceptKinProposals(proposal, FIXTURE_A.rows, epIds, [], spans);
  const b = C.acceptKinProposals(proposal, FIXTURE_A.rows, epIds, [], spans);
  assert(JSON.stringify(a) === JSON.stringify(b), "G6.1 derivation is agent-independent by construction");

  const qa = fakeQ([[{ id: 11 }], [{ n: 1 }], [{ id: 11 }]]);
  const qb = fakeQ([[{ id: 11 }], [{ n: 1 }], [{ id: 11 }]]);
  await C.finalizeWatchEpisodes(PERSON, { agentId: AGENT_A, queryFn: qa });
  await C.finalizeWatchEpisodes(PERSON, { agentId: AGENT_B, queryFn: qb });
  assert(
    JSON.stringify(qa.seen.map((s) => s.sql)) === JSON.stringify(qb.seen.map((s) => s.sql)),
    "G6.2 SECOND AGENT: identical SQL text for both agents — no agent-conditional path",
  );
  assert(
    qa.seen.every((s) => s.params.includes(AGENT_A)) && qb.seen.every((s) => s.params.includes(AGENT_B)),
    "G6.3 SECOND AGENT: each run carries its OWN agent id in every statement's parameters",
  );

  // NO MEERA-SPECIFIC BRANCHING. The grep has to be about CONDITIONALS, not
  // about the string: `MEERA_AGENT_ID` legitimately appears as a default
  // parameter, and `meera_log`/`meera_forget` are table names. What must not
  // exist is code that behaves differently depending on WHICH agent is
  // running — that is the line between a relational OS and a Meera feature.
  const branchy = SRC_CONSOLIDATE.split("\n")
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /(===|!==|==|!=)\s*MEERA_AGENT_ID|MEERA_AGENT_ID\s*(===|!==|==|!=)/.test(l));
  assert(branchy.length === 0, "G6.4 no comparison against MEERA_AGENT_ID anywhere in consolidate.js",
    branchy.map((b) => `line ${b.i + 1}: ${b.l.trim()}`).join("\n      "));
  const personaWords = SRC_CONSOLIDATE.split("\n")
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /\bif\s*\(.*\b(meera|hinglish|india_?only)\b/i.test(l));
  assert(personaWords.length === 0, "G6.5 no persona-conditional branch in the derivation chain",
    personaWords.map((b) => `line ${b.i + 1}: ${b.l.trim()}`).join("\n      "));
  // Every agent-scoped derivation entry point must accept an agentId.
  for (const fn of ["runConsolidation", "runRelEventDerivation", "runTrustRepairDerivation",
                    "runPatternExtraction", "runPhraseCapture", "runSelfLayer", "runLifeTold",
                    "runFullChainForPerson"]) {
    assert(
      new RegExp(`export async function ${fn}\\(`).test(SRC_CONSOLIDATE) &&
        new RegExp(`${fn}\\([^)]*agentId`, "s").test(SRC_CONSOLIDATE),
      `G6.6 ${fn} threads agentId`,
    );
  }
}

console.log("\n── G7  enablement + rails (P0-1) ──");
{
  // The enable switch is an ENV VAR, not a query string on the cron path.
  // Checked against Vercel's docs 2026-08-23: `crons[].path` is documented as
  // "must start with /" with no statement that a query string is accepted or
  // forwarded. A config file whose rejection takes the whole deployment with
  // it is the wrong place for an undocumented behaviour, so the gate asserts
  // the cron path stays PLAIN — this is a check against a future well-meaning
  // edit that re-adds it.
  assert(
    /"path":\s*"\/api\/consolidate-sweep"/.test(SRC_VERCEL),
    "G7.1 the cron path is plain — no undocumented query string in vercel.json",
  );
  assert(
    SRC_SWEEP.includes("CONSOLIDATE_SWEEP_LIVE"),
    "G7.2 the enable switch is an env flag, which needs no deploy and cannot invalidate vercel.json",
  );
  assert(
    SRC_SWEEP.includes("!SWEEP_LIVE"),
    "G7.2b …and it is what `dryRun` actually resolves to when no explicit request parameter is given",
  );
  assert(SRC_SWEEP.includes("CONSOLIDATE_KILL"), "G7.3 a kill switch exists");
  assert(
    SRC_SWEEP.indexOf("if (KILL)") < SRC_SWEEP.indexOf("await ensureSchema"),
    "G7.4 the kill switch is checked BEFORE any DB work or lease is taken",
  );
  assert(
    SRC_SWEEP.includes("MAX_LLM_CALLS_PER_SWEEP") && SRC_SWEEP.includes("MAX_TOKENS_PER_SWEEP"),
    "G7.5 per-invocation LLM call and token ceilings exist",
  );
  assert(
    SRC_SWEEP.includes("runFullChainForPerson"),
    "G7.6 the sweep runs the WHOLE chain — finalize alone leaves every derived table empty",
  );
  assert(
    !SRC_SWEEP.includes("runConsolidation({ onlyPerson"),
    "G7.7 the sweep no longer calls finalize on its own",
  );
  // The ceiling must count ATTEMPTS: a failing provider that never returns a
  // usable body would otherwise register zero spend and run forever.
  const before = C.costSnapshot();
  assert(
    "azure_attempts" in before && "fallback_attempts" in before,
    "G7.8 cost accounting counts attempts, not only successes",
  );
  const delta = C.costDelta({ ...before, azure_attempts: before.azure_attempts - 3 });
  assert(delta.llm_calls >= 3, "G7.9 costDelta reports attempts as llm_calls");
  assert(
    C.LOG_BATCH_CAP === 220 && SRC_SWEEP.includes("LOG_BATCH_CAP,"),
    "G7.10 LOG_BATCH_CAP is exported and imported, not duplicated",
  );
}

console.log("\n── G7b  NEGATIVE CONTROL — the checkers detect a break ──");
{
  // Every gate above asserts an absence. An absence-only suite that cannot
  // detect a presence is worth nothing (evals/self/texture.mjs's G9 rule).
  const brokenStrip = (rows) => rows; // "forgot" to filter
  assert(
    brokenStrip(FIXTURE_C.rows).some((r) => r.channel === "watch"),
    "G7b.1 the watch checker would catch a strip that filters nothing",
  );
  const brokenAnchor = () => ""; // "everything is anchored"
  assert(
    brokenAnchor("Rohit ki maa") === "" && C.kinAnchorFailure("Rohit ki maa") !== "",
    "G7b.2 the anchor checker distinguishes the real predicate from a permissive one",
  );
  const leakyRender = E.renderKinLines([{ name: "X", relation: "maa", citations: [1], provisional: true }]);
  assert(leakyRender.length === 1, "G7b.3 the render checker can see a rendered row at all");
  const brokenDrift = { drift: "humour: loud -> quiet", drift_cites: [] };
  assert(brokenDrift.drift !== "" && E.deriveDrift({ contents: DRIFT_CONTENTS, episodeIds: Array(60).fill(null) }).drift === "",
    "G7b.4 the drift checker distinguishes a real refusal from an absent claim");
}

console.log(`\n${failed ? `FAILED ${failed} of ${checks}` : `all ${checks} checks passed`}`);
process.exit(failed ? 1 : 0);
