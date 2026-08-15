// evals/vignette/run-prestudy.mjs — the RUNNER SCAFFOLD for the §10-Q3
// pre-study, not the run itself. Per the WS-BATTERY task brief: "the
// instrument, not the run (the run needs humans)."
//
// This file exists so that WHEN the pre-study is scheduled, running it is a
// scheduling/panel decision, not a build — but it deliberately does not
// execute anything by default, and its "judge lane" (for whoever decides an
// LLM panel is the right instrument, per power.mjs's costed reservation
// about that not being the same question a human panel answers) is gated
// exactly like evals/dbattery/d2.mjs's, so nobody can accidentally spend
// money or collect data by running this file unattended.
//
//   node evals/vignette/run-prestudy.mjs          → prints the plan, calls
//                                                    nothing, exit 0
//   node evals/vignette/run-prestudy.mjs --export-csv <path>
//                                                  → writes the paired items
//                                                    as a CSV a human survey
//                                                    tool (Qualtrics/
//                                                    Prolific/etc) can import
//                                                    directly — the actual
//                                                    human-panel path
//   WSBAT_RUN_JUDGED=1 node evals/vignette/run-prestudy.mjs --judge-smoke
//                                                  → tiny (n=4) LLM-judge
//                                                    smoke proof that the
//                                                    judge lane executes,
//                                                    EXPLICITLY LABELED as
//                                                    answering the
//                                                    judge-perception
//                                                    question, not the
//                                                    human-perception one
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { VIGNETTES, RATING_SCALE, pairedItems } from "./instrument.mjs";
import { callJudge } from "../dbattery/common.mjs";

const args = process.argv.slice(2);
const csvPath = args.includes("--export-csv") ? args[args.indexOf("--export-csv") + 1] : null;
const judgeSmoke = args.includes("--judge-smoke");
const RUN = process.env.WSBAT_RUN_JUDGED === "1";

console.log(`── §10-Q3 vignette pre-study — run scaffold ──`);
console.log(`instrument: ${VIGNETTES.length} incidents, ${pairedItems().length} items, rating scale ${RATING_SCALE.range[0]}-${RATING_SCALE.range[1]}`);
console.log(`See evals/vignette/power.mjs for the sample-size/cost arithmetic.\n`);

if (csvPath) {
  const rows = [["incidentId", "frame", "text", "rating_question"]];
  for (const it of pairedItems()) rows.push([it.incidentId, it.frame, it.text.replace(/"/g, '""'), RATING_SCALE.question]);
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n") + "\n";
  writeFileSync(csvPath, csv);
  console.log(`wrote ${pairedItems().length} rows to ${csvPath} — importable into a human-panel survey tool.`);
  console.log(`Randomize presentation order and between-subjects assignment (which frame each rater sees per incident) in the survey tool itself — this export intentionally does not pre-randomize, so the same file can seed either a between- or within-subject design (see power.mjs's note on that trade-off).`);
}

if (!RUN || !judgeSmoke) {
  if (!csvPath) {
    console.log(`DRY (no human panel, no judge calls). Use --export-csv <path> for the human-panel path, or WSBAT_RUN_JUDGED=1 ... --judge-smoke for a judge-lane proof-of-execution (see file header — this answers a different question than a human panel).`);
  }
  process.exit(0);
}

// ── judge-lane smoke proof, gated and tiny — proves the mechanism, does
// NOT stand in for the human pre-study SPEC §10-Q3 actually asks for. ──
const RUBRIC = `You are one rater in a study about how people perceive AI-companion identity continuity. Read the short vignette and answer with ONLY a JSON object: {"rating": <integer 1-7>, "reason": "<one short sentence>"}. Rating scale: 1 = ${RATING_SCALE.anchors[1]}; 3 = ${RATING_SCALE.anchors[3]}; 5 = ${RATING_SCALE.anchors[5]}; 7 = ${RATING_SCALE.anchors[7]}.\n\nQuestion: ${RATING_SCALE.question}`;

const { OPENROUTER_KEY } = await import(join(process.cwd(), "api", "_config.js"));
const JUDGES = ["anthropic/claude-opus-4.8", "google/gemini-3.5-flash-lite"];
const smokeItems = VIGNETTES.slice(0, 2).flatMap((v) => [
  { incidentId: v.incidentId, frame: "memory-lapse", text: v.memoryLapse },
  { incidentId: v.incidentId, frame: "character-shift", text: v.characterShift },
]);

console.log(`JUDGE-LANE SMOKE (n=${smokeItems.length} items x ${JUDGES.length} judges = ${smokeItems.length * JUDGES.length} ratings) — LABELED: this measures LLM-judge perception, not human perception. Do not treat this as the §10-Q3 result.\n`);

const results = [];
for (const it of smokeItems) {
  for (const judge of JUDGES) {
    try {
      const { text } = await callJudge({ key: OPENROUTER_KEY, model: judge, system: RUBRIC, user: it.text, maxTokens: 120 });
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      results.push({ ...it, judge, rating: parsed?.rating ?? null });
      console.log(`  ${judge.padEnd(28)} ${it.incidentId} [${it.frame}] rating=${parsed?.rating ?? "UNPARSEABLE"}`);
    } catch (e) {
      console.log(`  ERROR ${judge} ${it.incidentId}: ${e.message}`);
    }
  }
}

const byFrame = (frame) => results.filter((r) => r.frame === frame && r.rating != null).map((r) => r.rating);
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
console.log(`\nsmoke means — memory-lapse: ${mean(byFrame("memory-lapse")).toFixed(2)}  character-shift: ${mean(byFrame("character-shift")).toFixed(2)}  (n=${smokeItems.length / 2} incidents — WAY underpowered, proof of execution only)`);
