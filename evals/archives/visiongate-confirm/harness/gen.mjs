// Confirmatory-run generator. Reuses az.mjs unmodified (no harness rebuild).
// Writes rows WITH usage (the existing dirprobe.mjs does not persist usage,
// so this thin wrapper exists only to satisfy "log total calls/tokens/spend").
import fs from "fs";
import path from "path";
import { chat, imgPart, pmap, S } from "../mf/az.mjs";

const OUT = path.join(S, "visiongate-confirm", "out");
fs.mkdirSync(OUT, { recursive: true });

const arm = process.argv[2]; // e.g. "before_baseline" or "v4b_comment"
const kStart = Number(process.argv[3]);
const kEnd = Number(process.argv[4]);
if (!arm || !Number.isFinite(kStart) || !Number.isFinite(kEnd)) {
  console.error("usage: node gen.mjs <arm-dir-file-stem> <kStart> <kEnd>");
  process.exit(1);
}

const truth = JSON.parse(fs.readFileSync(path.join(S, "truth.json"), "utf8"));
const ids = Object.keys(truth).sort();
const b64 = (id) => fs.readFileSync(path.join(S, "jpg", id + ".jpg")).toString("base64");
const dirText = fs.readFileSync(path.join(S, "mf", "dirs", arm + ".txt"), "utf8").trim();

// pull the real SYSTEM prompt the same way persona.mjs does, so the arm is
// tested under the identical system context the shipped lane uses.
const persona = await import("../mf/persona.mjs");
const SYSTEM = persona.SYSTEM;

const F = path.join(OUT, arm + ".gen.json");
const rows = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, "utf8")) : [];
const done = new Set(rows.filter((r) => r.ok).map((r) => `${r.id}|${r.k}`));

const jobs = [];
for (const id of ids)
  for (let k = kStart; k < kEnd; k++) if (!done.has(`${id}|${k}`)) jobs.push({ id, k });

console.log(`${arm}: ${jobs.length} new generation calls (${ids.length} frames x k[${kStart},${kEnd}))`);
let n = 0,
  tokIn = 0,
  tokOut = 0,
  calls = 0;
const fresh = await pmap(jobs, 8, async (j) => {
  const res = await chat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: [imgPart(b64(j.id)), { type: "text", text: dirText }] },
    ],
    { maxTok: 300 },
  );
  calls++;
  if (res.usage) {
    tokIn += res.usage.prompt_tokens || 0;
    tokOut += res.usage.completion_tokens || 0;
  }
  if (++n % 40 === 0) console.log(`  ${n}/${jobs.length}`);
  return {
    dir: arm,
    id: j.id,
    k: j.k,
    ok: res.ok,
    ms: res.ms,
    text: (res.text || "").trim(),
    err: res.err || null,
    usage: res.usage || null,
  };
});
rows.push(...fresh);
fs.writeFileSync(F, JSON.stringify(rows, null, 2));

const isSilent = (t) => /^\W*(NO_COMMENT|NO COMMENT)\W*$/i.test((t || "").trim());
const spokenNew = fresh.filter((r) => r.ok && !isSilent(r.text) && r.text).length;
console.log(
  `${arm}: done. new calls=${calls} new_spoken=${spokenNew} tokIn=${tokIn} tokOut=${tokOut}`,
);
fs.appendFileSync(
  path.join(OUT, "spend.log"),
  JSON.stringify({ phase: "gen", arm, calls, tokIn, tokOut, ts: new Date().toISOString() }) + "\n",
);
