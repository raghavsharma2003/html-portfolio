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
  FIXTURE_E,
  FIXTURE_E_EXISTING,
  TR_GROUNDED,
  TR_FRIEND_BETRAYAL,
  TR_FABRICATED_CITES,
  TR_REPAIR_ONLY,
  TR_SILENT,
  PAT_GROUNDED,
  PAT_RECURRENCE,
  PAT_NO_NEW_EVIDENCE,
  PAT_PROSE,
  PAT_JUNK,
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

console.log("\n── G8  the judgment writers: trust/repair and patterns on realistic episodes ──");
{
  // WS-JUDGEWORK (#63). Everything above drives predicates over LOG ROWS.
  // These two writers read FINALIZED EPISODES, and until now the only pieces
  // of them anything drove were the two mirrored primitives — never the
  // composition that decides whether a row is written. `acceptTrustRepair`
  // and `acceptPatternProposals` are that composition, extracted pure for the
  // same reason `phraseCandidates` was: the fixtures must drive the SHIPPING
  // decision rather than a restatement of it.
  const E8 = FIXTURE_E.episodes;

  // ── 8a  trust/repair: the grounded arc, driven end to end ───────────────
  const d1 = C.acceptTrustRepair(TR_GROUNDED, E8, { trust: 0.3, ruptureOpen: false, repairState: "none" });
  assert(d1.ruptureRepair?.dim === "rupture" && d1.ruptureRepair.toV === "open",
    "G8.1 a cited conflict opens a rupture", JSON.stringify(d1.ruptureRepair));
  assert(
    JSON.stringify(d1.ruptureRepair?.citations) === JSON.stringify([FIXTURE_E.idAt(4)]),
    "G8.2 GROUNDING: the rupture cites the episode it was read off, by id",
    JSON.stringify(d1.ruptureRepair?.citations),
  );
  assert(d1.trust && d1.trust.direction === "advance", "G8.3 a cited trust signal moves trust");
  assert(
    Number(d1.trust.toV) - Number(d1.trust.fromV) <= 0.0500001,
    `G8.4 the first move spends the daily allowance and no more (${d1.trust.fromV} -> ${d1.trust.toV})`,
  );
  assert(d1.rejected.length === 0, "G8.5 nothing grounded is refused", JSON.stringify(d1.rejected));

  // …and the arc CONTINUES: repair begins, then closes. Five state-machine
  // branches exist and no fixture in this tree had ever walked past the first.
  const d2 = C.acceptTrustRepair(TR_GROUNDED, E8, { trust: 0.35, ruptureOpen: true, repairState: "open" }, {
    lastTrustMoveAt: E8[6].started_at,
    priorTrustCitations: [FIXTURE_E.idAt(6)],
  });
  assert(d2.ruptureRepair?.dim === "repair" && d2.ruptureRepair.toV === "repairing",
    "G8.6 his own explicit signal begins repair", JSON.stringify(d2.ruptureRepair));
  assert(
    JSON.stringify(d2.ruptureRepair?.citations) === JSON.stringify([FIXTURE_E.idAt(6)]),
    "G8.7 GROUNDING: the repair move cites HIS apology episode, not the fight",
  );
  const d3 = C.acceptTrustRepair(TR_REPAIR_ONLY, E8, { trust: 0.35, ruptureOpen: true, repairState: "repairing" });
  assert(d3.ruptureRepair?.repairState === "repaired" && d3.ruptureRepair.ruptureOpen === false,
    "G8.8 a sustained signal closes the rupture — the arc completes, it does not stick open",
    JSON.stringify(d3.ruptureRepair));
  // …and the priority order that made a separate fixture necessary: a fresh
  // conflict arriving mid-repair is never shadowed by the repair signal.
  const dRe = C.acceptTrustRepair(TR_GROUNDED, E8, { trust: 0.35, ruptureOpen: true, repairState: "repairing" }, {
    priorTrustCitations: [FIXTURE_E.idAt(6)],
  });
  assert(
    dRe.ruptureRepair?.direction === "regress" && dRe.ruptureRepair.toV === "open",
    "G8.8b a re-rupture during repair regresses FIRST — the repair signal in the same answer cannot shadow it",
    JSON.stringify(dRe.ruptureRepair),
  );
  assert(
    JSON.stringify(dRe.ruptureRepair?.citations) === JSON.stringify([FIXTURE_E.idAt(4)]),
    "G8.8c …and a regress cites the CONFLICT, not the apology it overrode",
  );

  // ── 8b  the same evidence may not move trust twice ──────────────────────
  // The live cadence is HOURLY, the episode lookback is 30 hours, so the same
  // batch reaches the same prompt repeatedly. clampTrustDelta bounds the
  // VALUE; nothing bounded the ROW COUNT.
  assert(
    d2.trust === null && d2.rejected.some((r) => /not new/.test(r.reason)),
    "G8.9 a re-derivation over already-counted episodes writes NO trust event",
    JSON.stringify(d2.rejected),
  );
  assert(
    C.trustEvidenceIsNew([9001, 9003], [9003, 9008]) === true &&
      C.trustEvidenceIsNew([9001, 9003], [9003]) === false &&
      C.trustEvidenceIsNew([], [9003]) === true,
    "G8.10 the rule is about EVIDENCE, not elapsed time — one new episode is enough, zero is not",
  );

  // ── 8c  the conservatism trap, and the writer window ────────────────────
  const dFriend = C.acceptTrustRepair(TR_FRIEND_BETRAYAL, E8, { trust: 0.3, ruptureOpen: false, repairState: "none" });
  assert(dFriend.trust === null, "G8.11 a hurt that is not about her moves no trust");
  assert(
    JSON.stringify(dFriend.ruptureRepair?.citations) === JSON.stringify([FIXTURE_E.idAt(3)]),
    "G8.12 …and whatever it does write is auditable to the one episode it came from",
  );

  const dFab = C.acceptTrustRepair(TR_FABRICATED_CITES, E8, { trust: 0.3, ruptureOpen: false, repairState: "none" });
  assert(
    dFab.ruptureRepair === null && dFab.trust === null,
    "G8.13 GROUNDING: every signal whose citations are invented is DROPPED, none written",
    JSON.stringify(dFab),
  );
  assert(
    dFab.rejected.length === 2 && dFab.rejected.every((r) => /writer window/.test(r.reason)),
    "G8.14 …and each refusal states its reason — a silent drop reads exactly like a quiet night",
    JSON.stringify(dFab.rejected),
  );

  const dSilent = C.acceptTrustRepair(TR_SILENT, E8, { trust: 0.3, ruptureOpen: false, repairState: "none" });
  assert(
    dSilent.ruptureRepair === null && dSilent.trust === null && dSilent.rejected.length === 0,
    "G8.15 the ordinary night: nothing proposed, nothing written, nothing refused",
  );

  // ── 8d  THE T4 DEFECT: a written pattern that can never be read ─────────
  // `vy_pattern.prompt_eligible` is GENERATED (support_count >= 3 and
  // distinct_days >= 2). The writer set neither counter and `reinforcePattern`
  // has no caller in api/, so every pattern ever written sat at 0/0 and T4
  // rendered zero bytes for everyone. The lane-parity gate cannot see this:
  // its fixture hands T4 an already-eligible row.
  const pg = C.acceptPatternProposals(PAT_GROUNDED, E8, []);
  assert(pg.writes.length === 1 && pg.rejected.length === 0, "G8.16 the real regularity is accepted", JSON.stringify(pg.rejected));
  const w = pg.writes[0];
  assert(
    JSON.stringify(w.citations) === JSON.stringify([FIXTURE_E.idAt(0), FIXTURE_E.idAt(2), FIXTURE_E.idAt(7)]),
    "G8.17 GROUNDING: the pattern cites the three episodes it was read off, by id",
  );
  assert(
    w.support_count === 3 && w.distinct_days === 3,
    `G8.18 support is COUNTED from the cited episodes, not left at the schema default (got ${w.support_count}/${w.distinct_days})`,
  );
  // The pre-fix row, for contrast — this is what production has been storing.
  const asRow = (o, extra = {}) => ({
    id: 1, person_id: PERSON, moment: o.moment, if_shape: o.if_shape, then_note: o.then_note,
    self_in_relation: o.self_in_relation ?? "", citations: o.citations,
    support_count: o.support_count ?? 0, distinct_days: o.distinct_days ?? 0,
    prompt_eligible: (o.support_count ?? 0) >= 3 && (o.distinct_days ?? 0) >= 2,
    times_contradicted: 0, t_invalid: null, last_used: null, ...extra,
  });
  const t4Live = E.renderDyadicActive([asRow(w)], "stress");
  assert(t4Live.text.length > 0, "G8.19 …and a row written that way RENDERS in T4 — the writer's output reaches a lane");
  assert(
    t4Live.text.includes(`${w.if_shape} -> ${w.then_note}`),
    "G8.20 T4 carries the derived strings verbatim — which is why they are linted at write time",
  );
  const t4Pre = E.renderDyadicActive([asRow({ ...w, support_count: 0, distinct_days: 0 })], "stress");
  assert(
    t4Pre.text.length === 0,
    "G8.21 NEGATIVE CONTROL: the pre-fix row (support 0 / days 0) renders ZERO bytes — the defect this gate closes is visible",
  );
  assert(t4Live.lint.clean, "G8.22 the accepted pattern is shape-lint clean at the render that ships it");

  // ── 8e  reinforcement is the ONLY path up the ladder ────────────────────
  const twoCite = C.patternSupport([FIXTURE_E.idAt(0), FIXTURE_E.idAt(2)], E8);
  assert(
    twoCite.support_count === 2 && twoCite.distinct_days === 2,
    "G8.23 the ordinary two-citation write is NOT promotable on its own (support 2 < 3)",
  );
  assert(
    E.renderDyadicActive([asRow({ ...w, ...twoCite })], "stress").text.length === 0,
    "G8.24 …confirmed at the render: it takes a later pass finding it again",
  );
  const pr = C.acceptPatternProposals(PAT_RECURRENCE, E8, FIXTURE_E_EXISTING);
  assert(
    pr.writes.length === 0 && pr.reinforcements.length === 1,
    "G8.25 a recurrence is a REINFORCEMENT, never a duplicate row",
    JSON.stringify(pr),
  );
  assert(
    JSON.stringify(pr.reinforcements[0].fresh) === JSON.stringify([FIXTURE_E.idAt(7)]),
    "G8.26 GROUNDING: exactly one unit of support, traced to the one episode not already cited",
    JSON.stringify(pr.reinforcements[0]),
  );
  assert(
    JSON.stringify(pr.reinforcements[0].merged) === JSON.stringify([9001, 9003, 9008]),
    "G8.27 the merged citation set is the union, sorted — support 3 / days 3, i.e. eligible",
  );
  assert(pr.deduped === 0, "G8.28 …and it is not counted as a dedupe, which is how it used to be lost");
  // Case-insensitive dedupe still holds: PAT_RECURRENCE's if_shape is
  // capitalised and must still match the stored row.
  assert(
    pr.reinforcements[0].if_shape.toLowerCase() === FIXTURE_E_EXISTING[0].if_shape.toLowerCase(),
    "G8.29 dedupe is normalized — a capitalised restatement is the same regularity",
  );

  const pn = C.acceptPatternProposals(PAT_NO_NEW_EVIDENCE, E8, FIXTURE_E_EXISTING);
  assert(
    pn.reinforcements.length === 0 && pn.writes.length === 0 && pn.deduped === 1,
    "G8.30 the same regularity on the SAME evidence bumps nothing — an hourly re-scan cannot promote a pattern by itself",
    JSON.stringify(pn),
  );
  assert(
    JSON.stringify(C.patternReinforcement({ id: 1, citations: [9001, 9003] }, [9003, 9008]).fresh) === JSON.stringify([9008]),
    "G8.31 the reinforcement predicate itself, driven directly",
  );

  // ── 8f  pattern text is prompt text ─────────────────────────────────────
  const pp = C.acceptPatternProposals(PAT_PROSE, E8, []);
  assert(
    pp.writes.length === 0 && pp.rejected.length === 1,
    "G8.32 prose is REFUSED, not truncated — a truncated regularity is a corrupted claim",
    JSON.stringify(pp),
  );
  assert(
    /too long|first-person/.test(pp.rejected[0].reason),
    "G8.33 …and the refusal names which rule and which field",
    JSON.stringify(pp.rejected),
  );
  // THE MIRROR CHECK. patternTextRejection mirrors shapelint.ts's lintLine.
  // Drive both over the same strings: a mirror nothing compares is a copy
  // waiting to drift (this file's own G4.12 rule, applied one layer down).
  {
    const probes = [
      "goes quiet, wants distraction not questions",
      "steady, undemanding, no follow-up questions",
      "Whenever he has had a genuinely difficult day at the office and the deadlines have piled up",
      "I should probably just send him something silly instead of asking",
      "main usse baat karti hoon",
      "work pressure builds",
    ];
    const drift = probes.filter((p) => {
      const mine = C.patternTextRejection(p) !== "";
      const real = E.lintLine(p).reasons.length > 0;
      return mine !== real;
    });
    assert(
      drift.length === 0,
      "G8.34 patternTextRejection agrees with the REAL shapelint.lintLine on every probe",
      drift.join(" | "),
    );
    assert(
      probes.some((p) => C.patternTextRejection(p) !== "") && probes.some((p) => C.patternTextRejection(p) === ""),
      "G8.35 …and the probe set contains both verdicts, so agreement is not vacuous",
    );
  }

  const pj = C.acceptPatternProposals(PAT_JUNK, E8, []);
  assert(
    pj.writes.length === 0 && pj.rejected.length === 2,
    "G8.36 a moment outside the closed set and a one-instance anecdote are both refused",
    JSON.stringify(pj),
  );
  assert(
    pj.rejected.some((r) => /closed set/.test(r.reason)) && pj.rejected.some((r) => /anecdote/.test(r.reason)),
    "G8.37 …each with its own reason",
    JSON.stringify(pj.rejected),
  );
  assert(
    C.acceptPatternProposals({ patterns: Array.from({ length: 6 }, () => PAT_GROUNDED.patterns[0]) }, E8, []).proposed === 2,
    "G8.38 the nightly cap holds however many the model volunteers — accumulation stays geological",
  );

  // ── 8g  the captured phrase's own render ────────────────────────────────
  // Deterministic capture stores the n-gram and no gloss (inventing one would
  // be fabrication), so EVERY phrase this pipeline writes rendered with a
  // dangling em-dash in the one block she speaks back from.
  const t6 = E.renderWeCallbacks([], [{ phrase: "chai pe scene set", gloss: "" }], false);
  assert(t6.text.includes('phrase: "chai pe scene set"'), "G8.39 a glossless captured phrase still renders");
  assert(
    !/—\s*$/m.test(t6.text) && !t6.text.includes('" — '),
    "G8.40 …without a dangling em-dash where the gloss would have been",
    JSON.stringify(t6.text),
  );
  const t6g = E.renderWeCallbacks([], [{ phrase: "monday face", gloss: "their word for sunday dread" }], false);
  assert(
    t6g.text.includes('phrase: "monday face" — their word for sunday dread'),
    "G8.41 BYTE-IDENTICAL when a gloss IS present — this is a fix for the absent case only",
  );

  // ── 8h  why the rel-event note is not linted, stated rather than assumed ─
  // The trust/rupture note is model free text. It is safe unlinted for one
  // reason only: nothing renders it. That is a property of OTHER files, so it
  // is asserted here rather than believed.
  {
    const SRC_MEMORY = readFileSync(join(ROOT, "api/memory.js"), "utf8");
    const SRC_RELSTATE = readFileSync(join(ROOT, "src/engine/relstate.ts"), "utf8");
    // Every SELECT against vy_rel_event, and what it projects.
    const selects = [...SRC_MEMORY.matchAll(/select\s+([\s\S]{0,200}?)\s+from vy_rel_event/g)].map((m) => m[1]);
    assert(
      selects.length >= 2 && selects.every((s) => !/\bnote\b/.test(s)),
      `G8.42 no vy_rel_event read in api/memory.js projects \`note\` (${selects.length} reads checked)`,
      selects.join(" | "),
    );
    // The one place it IS read is the forget cascade's delete predicate —
    // which is the right direction: an unlinted note is still reachable BY
    // A FORGET, it is just never reachable by the prompt.
    assert(
      /delete from vy_rel_event[\s\S]{0,200}note ~\* /.test(SRC_MEMORY),
      "G8.43 …and forget still scans the note, so audit text is erasable even though it is unrenderable",
    );
    // And nothing in relstate.ts's render half touches it: RelState, which is
    // what T2 renders from, has no note field at all.
    // Comments stripped first — G1.8's lesson one layer down: a scanner that
    // cannot tell prose from code produces a failure nobody can act on.
    const renderHalf = SRC_RELSTATE.slice(SRC_RELSTATE.indexOf("RENDER FUNCTIONS"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/then_note/g, "");
    assert(
      !/\bnote\b/.test(renderHalf),
      "G8.44 …and no render function in relstate.ts reads a rel-event note — hence write-time lint is not the gate it is for a pattern",
    );
  }
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
