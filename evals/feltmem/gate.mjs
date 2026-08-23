// ── THE OFFLINE HALF OF THE FELT-MEMORY BATTERY, AS A GATE ────────────────
//
// Everything about docs/MEMORY-FELT.md §9 that is DETERMINISTIC lives here and
// runs in CI on every build: the fixtures compile through the REAL engine, the
// pre-registration hash matches what is committed, every law is covered by at
// least two probes, the named adversarial twins exist and are paired, every
// rubric is a rubric, and every context block a probe leans on actually renders
// on that probe's lane.
//
// The JUDGED half stays out of evals/run.mjs, by construction, for the same
// reason evals/dbattery/d2.mjs is kept out of it: it spends money. Keeping it
// out of the suite map — rather than adding an in-loop skip — is what makes
// "the paid half never runs in CI" true by construction instead of by
// remembering.
//
// It does NOT materialize the pre-wave arm. That step is free but needs the
// git history and a full tree extraction, which a shallow CI clone may not
// have and a build should not pay for; it belongs to `run.mjs --arms`, where a
// missing history is a loud failure rather than a flaky gate.
//
// Offline, deterministic, no model call, no database, no money.
//
//   node evals/feltmem/gate.mjs        (also: node evals/run.mjs feltmem)

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileProbes, loadEngine } from "./compile.mjs";
import { verifyPrereg, computePrereg } from "./prereg.mjs";
import { judgeUser, JUDGE_SYSTEM, GLOBAL_FAILURES, parseVerdict } from "./judge.mjs";
import {
  DYADS,
  renderMemories,
  PROBES,
  RUBRICS,
  LAWS,
  FAILURE_MODES,
  PERMANENT_NEGATIVES,
  SCALE,
  DRAWS_PER_PROBE,
  POWERED_UNITS,
  ACCEPTANCE,
} from "./fixtures/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

let fail = 0;
let checks = 0;
const ok = (name, cond, extra = "") => {
  checks++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};

// ══ 1. THE PRE-REGISTRATION ═══════════════════════════════════════════════
{
  const v = verifyPrereg();
  ok("a pre-registration manifest is committed", Boolean(v.manifest), "run: node evals/feltmem/prereg.mjs --write, then COMMIT it");
  ok("the fixtures+rubrics hash matches the committed pre-registration", v.ok, v.why ?? "");
  if (!v.ok && v.movedRubrics?.length) console.log(`     rubrics that moved: ${v.movedRubrics.join(", ")}`);
  ok("no fixture file escapes the pre-registration hash", v.computed.directory.undeclared.length === 0, v.computed.directory.undeclared.join(", "));
  ok("every pre-registered fixture file exists", v.computed.directory.missing.length === 0, v.computed.directory.missing.join(", "));
  console.log(`   pre-registration ${v.computed.combined.slice(0, 16)}  (${v.computed.counts.dyads} dyads, ${v.computed.counts.probes} probes)`);
}

// ══ 2. THE SUITE'S OWN SHAPE ══════════════════════════════════════════════
{
  ok("the suite carries 12-16 dyads", DYADS.length >= 12 && DYADS.length <= 16, String(DYADS.length));
  const ids = DYADS.map((d) => d.id);
  ok("dyad ids are unique", new Set(ids).size === ids.length);
  const pids = PROBES.map((p) => p.id);
  ok("probe ids are unique", new Set(pids).size === pids.length);
  const byDyad = {};
  for (const p of PROBES) (byDyad[p.dyad] ??= []).push(p.id);
  for (const d of DYADS) {
    const n = byDyad[d.id]?.length ?? 0;
    ok(`${d.id} carries 2-4 probes`, n >= 2 && n <= 4, `has ${n}`);
    ok(`${d.id} is weeks deep`, d.weeks >= 5, `declares ${d.weeks} weeks`);
  }
  for (const p of PROBES) ok(`${p.id} names a real dyad`, Boolean(DYADS.find((d) => d.id === p.dyad)), p.dyad);
  ok(
    `${PROBES.length} probes x ${DRAWS_PER_PROBE} draws clears the n>=${POWERED_UNITS} judged floor`,
    PROBES.length * DRAWS_PER_PROBE >= POWERED_UNITS,
    `${PROBES.length * DRAWS_PER_PROBE}`,
  );
}

// ══ 3. EVERY LAW, AT LEAST TWICE ══════════════════════════════════════════
{
  const perLaw = {};
  for (const p of PROBES) (perLaw[p.law] ??= []).push(p.id);
  console.log("\nlaw coverage");
  for (const law of Object.keys(LAWS)) {
    const n = perLaw[law]?.length ?? 0;
    console.log(`   law ${law}  ${String(n).padStart(2)} probes  ${LAWS[law]}`);
    ok(`law ${law} (${LAWS[law]}) has at least two probes`, n >= 2, `has ${n}`);
  }
  for (const p of PROBES) ok(`${p.id} names a law that exists`, Boolean(LAWS[p.law]), String(p.law));
}

// ══ 4. THE NAMED ADVERSARIAL TWINS ════════════════════════════════════════
//
// The brief names these specifically, and they are the only part of the suite
// that can tell a learned law from a learned habit: a model that raises the
// exam AND the biopsy has not learned law 2, it has learned "mention the
// occasion".
{
  const NAMED = [
    ["p01-exam-unprompted", "p04-biopsy-restraint", "the day-of-exam unprompted ask and its intrusive-to-ask twin"],
    ["p06-mother-above-line", "p09-trivia-fade", "the above-the-line fact that must never get a fuzzy prompt, and the trivia where graceful fade is right"],
    ["p23-kab-bataya-bike", "p24-kab-bataya-transfer", "kab-bataya time anchoring, near and far"],
    ["p31-rohit-retold", "p32-prelims-recite-bait", "retold vs recited, and the direct invitation to recite"],
    ["p27-call-knows-chat", "p29-watch-knows-chat", "the same knowledge on the two lanes with the least room"],
  ];
  const byId = new Map(PROBES.map((p) => [p.id, p]));
  for (const [a, b, what] of NAMED) {
    ok(`twin pair exists: ${what}`, byId.has(a) && byId.has(b), `${a} / ${b}`);
    if (byId.has(a) && byId.has(b)) {
      ok(`${a} <-> ${b} point at each other`, byId.get(a).twin_of === b && byId.get(b).twin_of === a);
      ok(`${a} and ${b} do not share a rubric`, RUBRICS[a].best !== RUBRICS[b].best);
      ok(`${a} and ${b} disagree about what a great reply does`,
        JSON.stringify(RUBRICS[a].failures) !== JSON.stringify(RUBRICS[b].failures) || RUBRICS[a].best !== RUBRICS[b].best);
    }
  }
  // the two the brief names that are not symmetric pairs, asserted directly
  ok("the receipt-tempting argument is probed", PROBES.some((p) => p.id === "p11-receipt-tempting" && p.law === 4));
  ok("her own past (\"us din tum kaisi thi?\") is probed", PROBES.some((p) => p.id === "p19-her-that-night" && p.law === 6));
  // every twin_of is symmetric, not only the named ones
  for (const p of PROBES) {
    if (!p.twin_of) continue;
    const t = byId.get(p.twin_of);
    ok(`${p.id}'s twin ${p.twin_of} exists and points back`, Boolean(t) && t.twin_of === p.id);
  }
}

// ══ 5. RUBRIC DISCIPLINE ══════════════════════════════════════════════════
//
// A rubric DESCRIBES a bar; it never scripts a reply. That is not a style
// preference: the rubric text goes into the judge's prompt, and a rubric
// written as dialogue teaches the judge to reward the dialogue it was shown.
{
  const sentences = (s) => s.split(/(?<=[.!?])\s+/).filter((x) => x.trim().length > 8).length;
  const quotes = (s) => (s.match(/["'“”][^"'“”]{3,}["'“”]/g) || []);
  for (const p of PROBES) {
    const r = RUBRICS[p.id];
    ok(`${p.id} has a pre-registered rubric`, Boolean(r));
    if (!r) continue;
    const n = sentences(r.best);
    ok(`${p.id}'s rubric is 2-4 sentences`, n >= 2 && n <= 4, `${n} sentences`);
    ok(`${p.id}'s rubric names at least two failure modes`, (r.failures || []).length >= 2, String((r.failures || []).length));
    for (const f of r.failures || []) ok(`${p.id} names a known failure mode (${f})`, f in FAILURE_MODES);
    ok(`${p.id}'s rubric describes rather than scripts`, quotes(r.best).length <= 2, `${quotes(r.best).length} quoted spans`);
    for (const q of quotes(r.best)) ok(`${p.id}'s quoted span is a fragment, not a line`, q.length <= 62, q.slice(0, 40));
    ok(`${p.id}'s rubric is romanized`, !/[ऀ-ॿ]/.test(r.best));
  }
  ok("no rubric exists for a probe that does not", Object.keys(RUBRICS).every((id) => PROBES.some((p) => p.id === id)),
    Object.keys(RUBRICS).filter((id) => !PROBES.some((p) => p.id === id)).join(", "));
  // the vocabulary is closed AND fully used: an unused failure mode is a mode
  // nothing is watching for, which is how a named risk quietly stops being one.
  for (const f of Object.keys(FAILURE_MODES)) {
    if (GLOBAL_FAILURES.includes(f)) continue;
    ok(`failure mode "${f}" is watched by at least one rubric`, Object.values(RUBRICS).some((r) => (r.failures || []).includes(f)));
  }
  for (const f of PERMANENT_NEGATIVES) ok(`permanent negative "${f}" is a known mode`, f in FAILURE_MODES);
  ok("the five-point scale is fully defined", [1, 2, 3, 4, 5].every((k) => typeof SCALE[k] === "string" && SCALE[k].length > 20));
  ok("the decision rule is pre-registered with a margin", Number.isFinite(ACCEPTANCE.preference.minMarginPp) && ACCEPTANCE.preference.minMarginPp > 0);
}

// ══ 6. THE FIXTURE SHAPE-LINT ═════════════════════════════════════════════
//
// CLAUDE.md: "anything sentence-shaped in a prompt gets recited". These
// fixtures ARE prompt content, so the same law binds them. Attributed quotes
// (his own words, her own recorded reaction) are the product's real format and
// are allowed; first-person prose outside a quote is a line she could read out.
{
  const strip = (s) => s.replace(/"[^"]*"/g, '""');
  const FIRST_PERSON = /\b(main|mujhe|mera|meri)\b/i;
  for (const d of DYADS) {
    const rendered = renderMemories(d, "current");
    const blocks = String(rendered).split("\n\n");
    for (const b of blocks) {
      const [head, ...lines] = b.split("\n");
      ok(`${d.id}: memory block carries a real opRecall heading`, /^[A-Z][A-Z ,'’()-]{6,}/.test(head), head.slice(0, 40));
      for (const l of lines) ok(`${d.id}: every memory line is a record row`, l.startsWith("- "), l.slice(0, 40));
    }
    ok(`${d.id}: the memory block writes no line she could say`, !FIRST_PERSON.test(strip(rendered)),
      strip(rendered).match(FIRST_PERSON)?.[0] ?? "");
    ok(`${d.id}: her life rows write no line she could say`, !FIRST_PERSON.test(strip(d.herLife)));
    ok(`${d.id}: fixtures stay romanized`, !/[ऀ-ॿ]/.test(rendered + d.herLife));
    // the two arms' servers rendered this block differently, and that
    // difference IS half of what laws 4 and 7 are about. A fixture whose
    // pre-wave rendering is identical to its current one contributes nothing
    // to the comparison and says so here rather than in the judged table.
    const pw = renderMemories(d, "prewave");
    ok(`${d.id}: the pre-wave arm renders a DIFFERENT block`, pw !== rendered);
    ok(`${d.id}: the pre-wave arm carries no first-told dating`, !pw.includes("first told"));
    ok(`${d.id}: the pre-wave arm carries no watched record`, !pw.includes("THINGS YOU TWO LOOKED AT"));
  }
  const src = readFileSync(join(HERE, "fixtures", "dyads.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const name of ["maya", "meera", "silk"])
    ok(`the fixtures never name the agent ("${name}")`, !code.toLowerCase().includes(name));
  ok("the fixtures pass no agent module (the default is the point)", !/\bagent:/.test(code));
}

// ══ 7. THE FIXTURES COMPILE, DETERMINISTICALLY, THROUGH THE REAL ENGINE ═══
const { engine } = await loadEngine({ label: "gate" });
const first = await compileProbes({ arm: "current", engine });
{
  const second = await compileProbes({ arm: "current", engine });
  ok("compiling twice produces byte-identical contexts",
    first.rows.every((r, i) => r.sha256 === second.rows[i].sha256),
    "the Date pin is not holding — see compile.mjs");
  ok("every probe produced a context", first.rows.length === PROBES.length, `${first.rows.length}/${PROBES.length}`);
  for (const r of first.rows) {
    ok(`${r.probeId}: core fits the operational cap`, r.core.length <= first.caps.core, `${r.core.length}/${first.caps.core}`);
    ok(`${r.probeId}: tail fits the operational cap`, r.tail.length <= first.caps.tail, `${r.tail.length}/${first.caps.tail}`);
    ok(`${r.probeId}: the dyad is weeks of history, not a scene`, r.historyTurns >= 40, `${r.historyTurns} turns`);
  }
}

// ══ 8. LANE PARITY, AS THIS BATTERY DEPENDS ON IT ═════════════════════════
//
// evals/lanes/run.mjs owns the block-by-lane table. What is asserted HERE is
// narrower and is this suite's own precondition: every block a probe's law
// leans on must actually render under that probe's compiled context. A probe
// whose block is dark is not a hard probe, it is a broken one — it would score
// the lane and report it as a score for the reply.
{
  const byId = new Map(PROBES.map((p) => [p.id, p]));
  console.log("\nper-probe block presence (declared needs)");
  for (const r of first.rows) {
    const probe = byId.get(r.probeId);
    const dark = probe.needs.filter((id) => (r.sections[id] ?? 0) === 0);
    console.log(`   ${r.probeId.padEnd(28)} ${r.lane.padEnd(8)} ${probe.needs.length} needed, ${dark.length ? "DARK: " + dark.join(",") : "all present"}`);
    ok(`${r.probeId}: every declared block renders on the ${r.lane} lane`, dark.length === 0, dark.join(","));
  }
  // and the watch lane's written exemptions are respected rather than asserted
  // away: a probe that needed T1/T4/T12/T15 there would be claiming the lane is
  // something it has declared, in writing, that it is not.
  for (const r of first.rows.filter((x) => x.lane === "watch")) {
    for (const id of ["T1", "T15"])
      ok(`${r.probeId}: the watch lane's ${id} exemption still holds`, (r.sections[id] ?? 0) === 0, `${r.sections[id]}B`);
  }
  ok("the suite exercises more than one lane", new Set(first.rows.map((r) => r.lane)).size >= 3,
    [...new Set(first.rows.map((r) => r.lane))].join(","));
}

// ══ 9. THE JUDGE PROMPT IS BLIND AND COMPLETE ═════════════════════════════
{
  const probe = PROBES[0];
  const u = judgeUser({ probe, replyA: "AAA", replyB: "BBB" });
  for (const leak of ["prewave", "current", "arm ", "build", "482b01b", "git"])
    ok(`the judge prompt leaks no arm identity ("${leak.trim()}")`, !u.toLowerCase().includes(leak.trim()), u.slice(0, 80));
  ok("the judge prompt carries the pre-registered bar verbatim", u.includes(RUBRICS[probe.id].best));
  ok("the judge prompt carries both replies", u.includes("AAA") && u.includes("BBB"));
  for (const f of GLOBAL_FAILURES) ok(`the judge watches for "${f}" on every unit`, u.includes(f));
  ok("the judge system prompt pins the five-point scale", [1, 2, 3, 4, 5].every((k) => JUDGE_SYSTEM.includes(SCALE[k])));
  ok("the judge system prompt states that restraint can be the right answer", /Restraint can be the right answer/.test(JUDGE_SYSTEM));
  // a verdict that names a mode this probe does not watch for is dropped, not
  // silently accepted into the tally
  const v = parseVerdict('{"a_score":4,"b_score":5,"a_failures":["not-a-mode"],"b_failures":[],"preference":"B","notes":"x"}', RUBRICS[probe.id].failures);
  ok("the verdict parser drops flags outside the closed vocabulary", v && v.a_failures.length === 0);
  ok("the verdict parser refuses an out-of-range score",
    parseVerdict('{"a_score":7,"b_score":5,"a_failures":[],"b_failures":[],"preference":"A"}', []) === null);
}

// ══ 10. THE NEGATIVE CONTROLS ═════════════════════════════════════════════
//
// A gate that cannot fail is a green light with no wiring behind it, and this
// repo has shipped one of those before (context/rejected.md
// `gates-that-live-nowhere-2`). Both halves of this file are pointed at a
// deliberately broken state and have to SEE it.
{
  // (a) a probe whose memory block is emptied must go dark on T5
  const probe = PROBES[0];
  const row = first.rows[0];
  const gutted = engine.compile({
    user: DYADS[0].user,
    messageCount: 100,
    medium: "text",
    mode: "chat",
    voiceEngine: "device",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "", // the whole point
    herLife: "",
    cultureNoteText: "",
    latestUserText: probe.stimulus,
  });
  ok("the block check can actually fail: an emptied memory store goes dark on T5",
    (row.sections.T5 ?? 0) > 0 && (gutted.sections?.T5 ?? 0) === 0,
    `live ${row.sections.T5}B, gutted ${gutted.sections?.T5 ?? 0}B`);

  // (b) the pre-registration hash must move when a rubric moves
  const before = computePrereg();
  const someId = PROBES[0].id;
  const original = RUBRICS[someId].best;
  RUBRICS[someId].best = original + " (a softened clause added after the fact)";
  const after = computePrereg();
  RUBRICS[someId].best = original;
  ok("the pre-registration hash can actually fail: a mutated rubric changes its hash",
    before.rubricHashes[someId] !== after.rubricHashes[someId]);
  ok("restoring the rubric restores the hash", computePrereg().rubricHashes[someId] === before.rubricHashes[someId]);
}

console.log(fail ? `\n${fail} of ${checks} FAILED` : `\nALL PASS (${checks} assertions)`);
process.exit(fail ? 1 : 0);
