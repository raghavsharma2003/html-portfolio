// A model-written [forget] marker deletes only if THEY asked. `node evals/forget/intent.mjs`
//
// Origin: 2026-10-03. A caller read out "998185"; the reply carried
// [forget: call]; 44 rows of a seven-minute call were deleted and could not be
// recovered. This pins the check that makes that impossible, and pins its
// lean: it errs toward NOT deleting, because the two errors differ in size.
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "fi-"));
const entry = join(tmp, "entry.ts");
writeFileSync(entry, `export { userAskedToForget, claimsDeletion } from ${JSON.stringify(join(ROOT, "src/engine/memory"))};`);
const out = join(tmp, "b.mjs");
execSync(
  `npx esbuild ${entry} --bundle --format=esm --platform=node --outfile=${out} --log-level=error ` +
    `--alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { userAskedToForget, claimsDeletion } = await import(out);

let fail = 0;
let n = 0;
const ok = (name, cond) => {
  n++;
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}`);
  }
};
const NOW = 1_800_000_000_000;
const me = (text, ago = 1000) => ({ id: "m" + ago, from: "me", kind: "text", text, at: NOW - ago });
const her = (text, ago = 1000) => ({ id: "h" + ago, from: "her", kind: "text", text, at: NOW - ago });

// ── the incident, verbatim ────────────────────────────────────────────────
ok("digits read aloud are not a delete", !userAskedToForget("998185", [], NOW));
ok("...nor the second burst of digits", !userAskedToForget("998185185355", [me("998185", 3000), her("arre")], NOW));
ok("silence/greeting is not a delete", !userAskedToForget("hello", [], NOW));
ok("empty is not a delete", !userAskedToForget("", [], NOW));

// ── real asks, in the ways people actually say them ────────────────────────
for (const t of [
  "bhool ja ye call", "isko bhool jao", "yeh baat bhul ja", "forget it", "please forget that",
  "delete kar do", "ye hata do", "hata de isko", "mita do", "erase this", "remove that from memory",
  "wipe it", "yaad mat rakh isko", "save mat karna ye", "don't save this", "dont save it",
  "इसे भूल जा", "ये हटा दो", "मिटा दो", "डिलीट कर दो", "Bhool Ja", "BHOOL JA",
]) ok(`asks: "${t}"`, userAskedToForget(t, [], NOW));

// ── the burst: the ask was the message before the last one ─────────────────
ok("ask one message back, inside 90s", userAskedToForget("ok", [me("bhool ja isko", 20_000), me("haan", 5_000)], NOW));
ok("ask older than 90s does not count", !userAskedToForget("ok", [me("bhool ja isko", 120_000)], NOW));
ok("her reply ends the burst (an old ask before her turn does not count)", !userAskedToForget("ok", [me("bhool ja", 30_000), her("kya?", 20_000)], NOW));
ok("her words never count as his ask", !userAskedToForget("ok", [her("main bhool jaungi", 5_000)], NOW));

// ── ordinary talk must not unlock a delete ─────────────────────────────────
for (const t of ["kal office jana hai", "chai peeni hai", "mera naam aryan hai", "7 saal ka beta hai", "tum kaise ho", "sawasdee kaa"])
  ok(`not an ask: "${t}"`, !userAskedToForget(t, [], NOW));

// ── a refused delete may not leave a deletion CLAIM standing ───────────────
ok("'main save nahi kar rahi' is a claim", claimsDeletion(["Arre, number gina rahe ho? Main save nahi kar rahi!"]));
ok("'hata diya' is a claim", claimsDeletion(["haan hata diya"]));
ok("'forgot' is a claim", claimsDeletion(["done, forgot it"]));
ok("ordinary chat is not a claim", !claimsDeletion(["kya chal raha hai", "chai pi li?"]));

// ── wired in, and before the delete runs ───────────────────────────────────
const BRAIN = readFileSync(join(ROOT, "src/engine/brain.ts"), "utf8");
const check = BRAIN.indexOf("!userAskedToForget(latest, history)");
const del = BRAIN.indexOf("const target = resolveForget(parsed.forget, history)");
ok("brain.ts checks intent", check > 0);
ok("...and the check precedes the resolve/delete", check > 0 && del > check);
ok("a rejected marker is cleared so the delete block cannot see it", /forget_rejected[\s\S]{0,900}parsed\.forget = undefined;/.test(BRAIN));
ok("only the class of a rejected marker is logged, never its text", !/forget_rejected[\s\S]{0,200}parsed\.forget,\s*$/m.test(BRAIN) && /scope: \/\\b\(call/.test(BRAIN));

console.log(fail ? `\n${fail} of ${n} forget-intent checks FAILED` : `\nall ${n} forget-intent checks passed`);
process.exit(fail ? 1 : 0);
