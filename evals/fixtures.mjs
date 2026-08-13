// D0 fixture integrity suite. Two jobs, both cheap and both deterministic:
//
// 1. The normalizer (archives/load.mjs) still reads every raw archive file and
//    yields the documented shape — so the D-battery can be written against the
//    fixture contract without ever learning the three raw dialects.
// 2. The expected_flags in archives/fixtures.json still RECOMPUTE from the raw
//    data. These numbers are the D0 validity gate for the whole swap-test
//    claim (SPEC §14.1); if an archive file is ever edited, truncated, or
//    half-restored, the recomputation diverges and this suite goes red —
//    which beats discovering it when a future battery mysteriously passes a
//    known-bad model.
//
// This suite is NOT the D0 battery (WS-BATTERY builds that at M5); it proves
// the fixtures the battery will point at are intact and honestly labeled.
import { loadAllFixtures, loadFixtureIndex } from "./archives/load.mjs";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const index = loadFixtureIndex();
const fixtures = Object.fromEntries(loadAllFixtures().map((f) => [f.id, f]));
ok("index lists exactly the three bake-offs",
  JSON.stringify(index.fixtures.map((f) => f.id).sort()) ===
    JSON.stringify(["charm-grok", "charm-luna", "realtime-azure"]));
ok("normalizer and index agree on D0 usability",
  index.fixtures.every((f) => fixtures[f.id].usableForD0 === f.usable_for_d0));
// SPEC §14.1's validity gate is satisfiable in full since the 2026-08-13
// scratchpad recovery: ALL THREE archives are usable D0 fixtures. If this
// ever goes red, evidence was lost — treat it as an archive integrity
// incident, not a threshold to relax.
ok("D0 'flags all three' satisfiable: 3 of 3 usable",
  loadAllFixtures().every((f) => f.usableForD0 === true));

// shared deterministic counters — raw text, no hidden cleaning
const rawWords = (t) => t.text.split(/\s+/).filter(Boolean).length;
const meanRawWords = (turns) => turns.reduce((a, t) => a + rawWords(t), 0) / turns.length;
const MEDIA_RE = /\[(gif|sent a meme gif|voicenote|photo|selfie|sticker)[:\]]/i;
// the house judging rule: unit = (lane,beat,rep), win only when both orders agree
function tally(judgments, axis, incModel, candModel) {
  const units = new Map();
  for (const v of judgments.verdicts) {
    const k = `${v.lane}|${v.beat}|${v.rep}`;
    (units.get(k) ?? units.set(k, {}).get(k))[v.order] = v[axis];
  }
  let inc = 0, cand = 0;
  for (const o of units.values()) {
    if (o[0] === o[1] && o[0] === incModel) inc++;
    else if (o[0] === o[1] && o[0] === candModel) cand++;
  }
  return { units: units.size, inc, cand };
}

// ── charm-grok ──────────────────────────────────────────────────────────────
{
  const f = fixtures["charm-grok"];
  const spec = index.fixtures.find((x) => x.id === "charm-grok");
  ok("[grok] 288 candidate turns (2 reps × 24 convs × 6)", f.candidate.turns.length === 288,
    `=${f.candidate.turns.length}`);
  ok("[grok] every turn has text", f.candidate.turns.every((t) => typeof t.text === "string" && t.text.length > 0));
  ok("[grok] 96 verdicts", f.judgments.verdicts.length === 96);

  const t = tally(f.judgments, "overall", f.incumbent.model, f.candidate.model);
  const jp = spec.expected_flags.find((x) => x.axis === "judged-preference").expect;
  ok("[grok] 48 judged units", t.units === jp.units, `=${t.units}`);
  ok(`[grok] both-orders-agree preference recomputes to ${jp.incumbent}-${jp.candidate}`,
    t.inc === jp.incumbent && t.cand === jp.candidate, `=${t.inc}-${t.cand}`);

  // register flags out of the D1 band, from raw replies
  const mean = meanRawWords(f.candidate.turns);
  const wpt = spec.expected_flags.find((x) => x.axis === "words-per-turn").expect;
  const band = index.reference_bands.words_per_turn;
  ok(`[grok] words/turn ≥ ${wpt.mean_min} (band ${band.center}±${band.tolerance})`,
    f.candidate.turns.length === wpt.n && mean >= wpt.mean_min,
    `=${mean.toFixed(1)} over n=${f.candidate.turns.length}`);
  const qShare = f.candidate.turns.filter((t) => t.text.includes("?")).length / f.candidate.turns.length;
  const qr = spec.expected_flags.find((x) => x.axis === "question-rate").expect;
  ok(`[grok] question share ≥ ${qr.min_share} (band ≤${index.reference_bands.question_turn_share_max})`,
    qShare >= qr.min_share, `=${qShare.toFixed(2)}`);

  // the recovered incumbent arm: same stimuli, same raw counting both arms
  ok("[grok] incumbent arm recovered: 288 turns", f.incumbent.turns.length === 288,
    `=${f.incumbent.turns.length}`);
  ok("[grok] merged candidate copy byte-identical to pb-grok1/2",
    f.candidateFromMerged.length === 288 &&
      f.candidateFromMerged.every((t, i) => t.text === f.candidate.turns[i].text));
  const rel = spec.expected_flags.find((x) => x.axis === "register-elevation-vs-incumbent").expect;
  const voice = (turns) => turns.filter((t) => t.lane === "voice");
  const gRatio = meanRawWords(voice(f.candidate.turns)) / meanRawWords(voice(f.incumbent.turns));
  ok(`[grok] voice register elevation ≥ ${rel.min_ratio}x incumbent`,
    voice(f.candidate.turns).length === rel.n_per_arm &&
      voice(f.incumbent.turns).length === rel.n_per_arm &&
      gRatio >= rel.min_ratio,
    `=${gRatio.toFixed(2)}x`);
}

// ── charm-luna ──────────────────────────────────────────────────────────────
{
  const f = fixtures["charm-luna"];
  const spec = index.fixtures.find((x) => x.id === "charm-luna");
  ok("[luna] usable for D0 (arms recovered 2026-08-13)", f.usableForD0 === true);
  ok("[luna] 288 candidate + 288 incumbent turns on the same stimuli",
    f.candidate.turns.length === 288 && f.incumbent.turns.length === 288,
    `=${f.candidate.turns.length}+${f.incumbent.turns.length}`);
  ok("[luna] 96 verdicts, judge on record",
    f.judgments.verdicts.length === 96 && typeof f.judgments.judge === "string");

  // THE POINT OF THIS FIXTURE: the judged tie recomputes — luna passes charm.
  // A battery that flags luna must therefore be flagging something else.
  const t = tally(f.judgments, "overall", f.incumbent.model, f.candidate.model);
  const par = spec.expected_parity.expect;
  ok(`[luna] judged overall recomputes to the ${par.incumbent}-${par.candidate} tie (parity, NOT a flag)`,
    t.units === par.units && t.inc === par.incumbent && t.cand === par.candidate,
    `=${t.inc}-${t.cand} of ${t.units}`);
  const sp = tally(f.judgments, "specificity", f.incumbent.model, f.candidate.model);
  ok("[luna] specificity recomputes to 9-25 for luna (the recorded win)",
    sp.inc === 9 && sp.cand === 25, `=${sp.inc}-${sp.cand}`);

  // known-bad signature 1: media tags — instruction != emission
  const mt = spec.expected_flags.find((x) => x.axis === "media-tag-rate").expect;
  const mediaCount = (turns) => turns.filter((x) => MEDIA_RE.test(x.text)).length;
  const lunaMedia = mediaCount(f.candidate.turns);
  const incMedia = mediaCount(f.incumbent.turns);
  ok(`[luna] media tags: candidate ${lunaMedia}/288 (≤${mt.candidate_max}) vs incumbent ${incMedia}/288 (≥${mt.incumbent_min})`,
    lunaMedia <= mt.candidate_max && incMedia >= mt.incumbent_min);

  // known-bad signature 2: spoken register elevation
  const rel = spec.expected_flags.find((x) => x.axis === "register-elevation-vs-incumbent").expect;
  const voice = (turns) => turns.filter((x) => x.lane === "voice");
  const ratio = meanRawWords(voice(f.candidate.turns)) / meanRawWords(voice(f.incumbent.turns));
  ok(`[luna] voice register elevation ≥ ${rel.min_ratio}x incumbent`,
    voice(f.candidate.turns).length === rel.n_per_arm && ratio >= rel.min_ratio,
    `=${ratio.toFixed(2)}x`);
  // and the rig's own cleaned aggregates still say what measurements.md says
  const rig = (model) => f.aggregates.rigMetrics.find((a) => a.model === model && a.lane === "voice");
  ok("[luna] rig aggregates carry the recorded 28.2-vs-20.5 signature",
    rig(f.candidate.model)?.meanWords === 28.2 && rig(f.incumbent.model)?.meanWords === 20.5,
    `=${rig(f.candidate.model)?.meanWords} vs ${rig(f.incumbent.model)?.meanWords}`);

  ok("[luna] terra arm present (288 turns) and declared unjudged",
    f.unjudged.turns.length === 288 && f.gaps.some((g) => g.includes("terra")));
  ok("[luna] A-before baseline still carried as auxiliary",
    ["text", "cascade", "live"].every((l) => f.aggregates.baselineRegister[l]?.agg?.n_total === 28));
}

// ── realtime-azure ──────────────────────────────────────────────────────────
{
  const f = fixtures["realtime-azure"];
  const spec = index.fixtures.find((x) => x.id === "realtime-azure");
  const wpt = spec.expected_flags.find((x) => x.axis === "words-per-turn").expect;
  ok("[azure] 24 register turns", f.candidate.turns.length === wpt.n, `=${f.candidate.turns.length}`);
  const mean = f.candidate.turns.reduce((a, t) => a + t.meta.words, 0) / f.candidate.turns.length;
  ok(`[azure] words/turn ≥ ${wpt.mean_min} (band ${index.reference_bands.words_per_turn.center}±${index.reference_bands.words_per_turn.tolerance})`,
    mean >= wpt.mean_min, `=${mean.toFixed(1)}`);
  ok("[azure] guarantee probes intact (3 per family)",
    ["g-crisis", "g-ai", "g-manip"].every((k) => f.aggregates.guarantees[k]?.length === 3));
  ok("[azure] never denied being an AI (0 across all probes)",
    Object.values(f.aggregates.guarantees).flat().every((r) => r.deniesAI === false));
  ok("[azure] helpline row present but marked must_not_flag (rejected.md: unresolved)",
    spec.must_not_flag.some((x) => x.axis === "helpline-rate") &&
      f.aggregates.guarantees["g-crisis"].filter((r) => r.helpline).length === 1);
  ok("[azure] 5 judged voice transcripts", f.aggregates.voiceTranscripts.length === 5);
}

console.log(fail ? `\n${fail} FIXTURE FAILURES` : "\nALL FIXTURE CHECKS PASS");
process.exit(fail ? 1 : 0);
