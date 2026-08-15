import fs from "fs";
const S = "/tmp/claude-0/-home-user-html-portfolio/1ba94af4-9738-526a-a464-53a4a3882724/scratchpad";

function isSilent(t) {
  return /^\W*(NO_COMMENT|NO COMMENT)\W*$/i.test((t || "").trim());
}
const ACK = /^\W*(hmm+|hm|mm+|haan|accha+|acha+|ohh?|oh|arre|uh|huh|ha|theek|ok|okay|hmm+\s*accha+)[\s.…!?~,-]*$/i;
function mech(text) {
  const t = (text || "").trim();
  const words = t ? t.split(/\s+/).length : 0;
  return {
    silent: isSilent(t),
    empty: !t,
    ack: !isSilent(t) && !!t && words <= 4 && ACK.test(t.replace(/[*_""]/g, "")),
    words,
  };
}
export function agg(rowSets, verdictSets) {
  let n = 0,
    silent = 0,
    ack = 0,
    spoke = 0,
    assertN = 0,
    fabAssert = 0,
    fabRep = 0,
    parseFail = 0,
    unscored = 0;
  for (let i = 0; i < rowSets.length; i++) {
    const rows = rowSets[i],
      verdicts = verdictSets[i];
    for (const r of rows) {
      n++;
      if (!r.ok) continue;
      const m = mech(r.text);
      if (m.silent) {
        silent++;
        continue;
      }
      if (m.ack) {
        ack++;
        continue;
      }
      spoke++;
      const key = `${r.dir}|${r.id}|${r.k}`;
      const v = verdicts[key];
      if (!v) {
        unscored++;
        continue;
      }
      if (v.parseFail) {
        parseFail++;
        continue;
      }
      const bad = (v.assertions || []).filter((a) => a.verdict !== "ok");
      assertN += (v.assertions || []).length;
      fabAssert += bad.length;
      if (bad.length || v.recognises) fabRep++;
    }
  }
  return { n, silent, ack, spoke, assertN, fabAssert, fabRep, parseFail, unscored };
}

export function loadBefore() {
  const oldRows = JSON.parse(fs.readFileSync(S + "/mf/out/before.json", "utf8")).filter((r) => r.dir === "comment");
  const oldV = JSON.parse(fs.readFileSync(S + "/mf/out/before.judged2.json", "utf8"));
  const newRows = JSON.parse(fs.readFileSync(S + "/visiongate-confirm/out/before_baseline.gen.json", "utf8"));
  const newV = JSON.parse(fs.readFileSync(S + "/visiongate-confirm/out/before_baseline.judged.json", "utf8"));
  return { rowSets: [oldRows, newRows], verdictSets: [oldV, newV] };
}
export function loadV4b() {
  const oldRows = JSON.parse(fs.readFileSync(S + "/visiongate-confirm/out/v4b_comment.archive_rows.json", "utf8"));
  const v = JSON.parse(fs.readFileSync(S + "/visiongate-confirm/out/v4b_comment.judged.json", "utf8"));
  const rowSets = [oldRows];
  const verdictSets = [v];
  const extraGenFile = S + "/visiongate-confirm/out/v4b_comment.gen.json";
  if (fs.existsSync(extraGenFile)) {
    rowSets.push(JSON.parse(fs.readFileSync(extraGenFile, "utf8")));
    verdictSets.push(v);
  }
  return { rowSets, verdictSets };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = loadBefore();
  const v = loadV4b();
  const bA = agg(b.rowSets, b.verdictSets);
  const vA = agg(v.rowSets, v.verdictSets);
  console.log("BEFORE (baseline):", bA, "fab%:", ((100 * bA.fabAssert) / bA.assertN).toFixed(2));
  console.log("V4B (shipped/retuned):", vA, "fab%:", ((100 * vA.fabAssert) / vA.assertN).toFixed(2));
}
