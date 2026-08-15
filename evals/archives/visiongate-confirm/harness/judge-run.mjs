// Confirmatory-run judge wrapper. Identical rubric/prompt to mf/judge.mjs
// (imports JUDGE_SYS/isSilent/mech from it directly — no reimplementation of
// the scoring rubric), extended only to log token usage per call.
import fs from "fs";
import path from "path";
import { chat, imgPart, pmap, S } from "../mf/az.mjs";
import { JUDGE_SYS, isSilent, mech } from "../mf/judge.mjs";

const OUT = path.join(S, "visiongate-confirm", "out");
const truth = JSON.parse(fs.readFileSync(path.join(S, "truth.json"), "utf8"));
const b64 = (id) => fs.readFileSync(path.join(S, "jpg", id + ".jpg")).toString("base64");

const genFile = process.argv[2]; // path to a .gen.json rows file
const outFile = process.argv[3]; // path to write .judged.json verdicts
if (!genFile || !outFile) {
  console.error("usage: node judge-run.mjs <rows.json> <out.judged.json>");
  process.exit(1);
}

const rows = JSON.parse(fs.readFileSync(genFile, "utf8"));
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
const key = (r) => `${r.dir}|${r.id}|${r.k}`;
const todo = rows.filter((r) => r.ok && !isSilent(r.text) && !mech(r.text).ack && r.text && !prev[key(r)]);
console.log(`judging ${todo.length} engaged replies (${rows.length} rows total)`);

let n = 0,
  tokIn = 0,
  tokOut = 0,
  calls = 0;
await pmap(todo, 3, async (r) => {
  const res = await chat(
    [
      { role: "system", content: JUDGE_SYS },
      {
        role: "user",
        content: [
          imgPart(b64(r.id)),
          {
            type: "text",
            text: `GROUND TRUTH for this screen:\n${truth[r.id].kind}\n${truth[r.id].gt}\n\nTHE LINE SHE SAID:\n${r.text}`,
          },
        ],
      },
    ],
    { maxTok: 900, temp: 0 },
  );
  calls++;
  if (res.usage) {
    tokIn += res.usage.prompt_tokens || 0;
    tokOut += res.usage.completion_tokens || 0;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(res.text.replace(/^```(json)?|```$/gm, "").trim());
  } catch {
    parsed = null;
  }
  prev[key(r)] = parsed || { parseFail: true, raw: res.text.slice(0, 300) };
  if (++n % 40 === 0) {
    console.log(`  ${n}/${todo.length}`);
    fs.writeFileSync(outFile, JSON.stringify(prev, null, 2));
  }
});
fs.writeFileSync(outFile, JSON.stringify(prev, null, 2));
console.log(`judge done: calls=${calls} tokIn=${tokIn} tokOut=${tokOut}`);
fs.appendFileSync(
  path.join(OUT, "spend.log"),
  JSON.stringify({ phase: "judge", file: outFile, calls, tokIn, tokOut, ts: new Date().toISOString() }) + "\n",
);
