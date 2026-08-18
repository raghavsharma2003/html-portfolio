#!/usr/bin/env node
// docs/paper/verify-release-bundle.mjs — WS-PAPER-CAM.
//
// Runs the seven de-identification gates from DRAFT.md §13.4 against the BUILT
// bundle, plus a persona spot-signature scan and a secrets scan. Run it, do not
// assert it: this script exists because the archives it was built from embed
// the product's 44,002-character system prompt, and "we stripped it" is not a
// claim anyone should take on trust.
//
// Every gate names its required result. Any FAIL exits non-zero.
//
//   node docs/paper/verify-release-bundle.mjs
//   node docs/paper/verify-release-bundle.mjs --json
//
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BUNDLE = resolve(ROOT, "release/vyakti-judge-qual");
const asJson = process.argv.includes("--json");

// ── load the bundle as a flat list of (path, text) ──────────────────────────
function walk(dir, acc = []) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
const files = walk(BUNDLE).map((p) => ({
  path: relative(BUNDLE, p),
  bytes: statSync(p).size,
  text: readFileSync(p, "utf8"),
}));

const grepAll = (needle) => {
  const hits = [];
  for (const f of files) {
    const n = f.text.split(needle).length - 1;
    if (n) hits.push({ file: f.path, count: n });
  }
  return hits;
};
const grepRe = (re, exclude = null) => {
  const hits = [];
  for (const f of files) {
    if (exclude && exclude.test(f.path)) continue;
    const m = f.text.match(re);
    if (m) hits.push({ file: f.path, count: m.length, sample: String(m[0]).slice(0, 60) });
  }
  return hits;
};

// The author list is attribution, not a de-identification failure: a citation
// file is SUPPOSED to name the authors. It is the one file exempt from the
// person-name gates, and the exemption is narrow and named rather than a
// blanket allowance.
const CITATION_ONLY = /^CITATION\.cff$/;

// ── the persona, read from the private source so the signatures are real ────
const src = JSON.parse(readFileSync(resolve(ROOT, "evals/archives/charm-grok/pb-merged1.json"), "utf8"));
const personaText = src.personaText;
const personaVoice = src.personaVoice;

// Five distinctive substrings chosen by reading the persona itself — one from
// each of five widely separated regions, each long and specific enough that a
// coincidental match in a transcript is implausible.
const SIGNATURES = [
  ["S1 personaText/Voice opening doctrine", "a DIAGRAM OF A SHAPE, never a line to send"],
  ["S2 personaText ~4k", "Mirror their energy and length"],
  ["S3 personaText ~12k", "bring back souvenirs, in whatever words the excitement arrives in"],
  ["S4 personaVoice ~25k", "Never install a ritual — only christen ones that grew"],
  ["S5 personaVoice ~43k", "opens with a listener sound that fits the mood"],
];

const gates = [];
const gate = (id, check, required, hits, extra = {}) =>
  gates.push({ id, check, required, pass: hits.length === 0, hits, ...extra });

// D1 — the persona, both variants, first 200 characters
gate("D1a", "first 200 chars of personaText (44,002 chars total)", "zero hits",
  grepAll(personaText.slice(0, 200)));
gate("D1b", "first 200 chars of personaVoice (47,094 chars total)", "zero hits",
  grepAll(personaVoice.slice(0, 200)));

// D1c — five spot-signatures from across the persona, not just its head
for (const [label, sig] of SIGNATURES) {
  gate(`D1c/${label.split(" ")[0]}`, `persona spot-signature — ${label}: "${sig.slice(0, 48)}…"`,
    "zero hits", grepAll(sig));
}

// D2 — the scripted fictional interlocutor
gate("D2a", "the scripted interlocutor's given name (any case)", "zero hits outside CITATION.cff — pseudonymised to USER",
  grepRe(/[Rr]aghav/g, CITATION_ONLY));
gate("D2b", "the companion persona's name (any case)", "zero hits — pseudonymised to HER",
  grepRe(/[Mm]eera/g));
gate("D2c", "the surname that also appears in the author list", "zero hits outside CITATION.cff — pseudonymised to [NAME]",
  grepRe(/Sharma/g, CITATION_ONLY));

// D3 — place references. NOT a zero-hit gate: these are authored character
// detail in a fictional script and removing them would damage the released
// linguistic content. The gate's job is to RECORD them for owner sign-off.
const places = ["Silk Board", "silk board", "Bangalore", "Bengaluru", "Bandra", "HSR", "Koramangala", "Indiranagar"];
const placeHits = places.flatMap((p) => grepAll(p).map((h) => ({ term: p, ...h })));
const placeTotals = {};
for (const h of placeHits) placeTotals[h.term] = (placeTotals[h.term] || 0) + h.count;
gates.push({
  id: "D3", check: "real place references that could identify the owner",
  required: "character detail, not PII — RECORDED for owner confirmation, not auto-failed",
  pass: true, advisory: true, hits: [],
  totals: placeTotals,
  note: "Retained deliberately. These are Indian city/landmark references inside an authored fictional script; they identify no person, and removing them would damage the code-switched content that is the released asset. FLAGGED FOR OWNER SIGN-OFF before publication (DRAFT.md §13.4 D3 requires owner confirmation, recorded rather than assumed).",
});

// D4 — keys, endpoints, deployment names, resource ids
gate("D4a", "API-key-shaped strings (sk-*, azure 32-hex, bearer literals)", "zero hits",
  grepRe(/\b(sk-[A-Za-z0-9_-]{16,}|sk-or-v1-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._-]{20,}|api-key["'\s:=]+[A-Za-z0-9]{24,})/g));
gate("D4b", "cloud endpoint hostnames", "zero hits",
  grepRe(/https?:\/\/[A-Za-z0-9.-]*(openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com|\.inference\.ai\.azure\.com)[^\s"']*/g));
gate("D4c", "Azure subscription / resource-group identifiers", "zero hits",
  grepRe(/\/subscriptions\/[0-9a-fA-F-]{8,}|resourceGroups\/[A-Za-z0-9_-]+/g));
gate("D4d", "the private repo's secrets module", "zero hits",
  grepAll("api/_config.js"));
gate("D4e", "environment variables carrying values rather than names", "zero hits",
  grepRe(/(AZURE_KEY|OPENROUTER_KEY|AZURE_ENDPOINT)\s*[:=]\s*["'][^"']{8,}/g));

// D5 — production database rows / real device identifiers
gate("D5a", "production log or DB table references", "zero hits",
  grepRe(/meera_log|rel_state|supabase\.co|postgres:\/\/|service_role/g));
gate("D5b", "device / installation identifiers (UUIDs, FCM tokens, IMEIs)", "zero hits",
  grepRe(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g));
gate("D5c", "email addresses and phone numbers", "zero hits",
  grepRe(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+91[ -]?\d{10}/g));

// D6 — the R4 artifacts, produced after the release table was written, are
// covered by D1-D5. They carry full transcript text and are the single most
// likely place for a leak.
const r4Files = files.filter((f) => /r4-english-transcripts|r4-english\.jsonl|runs\/r4/.test(f.path));
const r4Leaks = [];
for (const f of r4Files) {
  for (const [label, sig] of SIGNATURES) if (f.text.includes(sig)) r4Leaks.push({ file: f.path, sig: label });
  if (/[Rr]aghav|[Mm]eera|Sharma/.test(f.text)) r4Leaks.push({ file: f.path, sig: "person name" });
  if (f.text.includes("sourceText")) r4Leaks.push({ file: f.path, sig: "sourceText (redundant Hinglish duplicate)" });
  if (f.text.includes('"usage"')) r4Leaks.push({ file: f.path, sig: "per-call usage (deployment economics)" });
}
gates.push({
  id: "D6", check: `R4 artifacts (${r4Files.length} files) covered by D1-D5 and stripped of usage/sourceText`,
  required: "zero hits", pass: r4Leaks.length === 0, hits: r4Leaks,
  files: r4Files.map((f) => f.path),
});

// D7 — the datasheet says what it must, in its own voice, in its first section
const ds = files.find((f) => f.path === "DATASHEET.md");
const firstSection = ds ? ds.text.split(/\n## /)[1] || "" : "";
// whitespace-tolerant: the statements are prose and get line-wrapped
const d7ok = /LLM-produced/i.test(firstSection)
  && /not\s+human[\s-]+annotat/i.test(firstSection)
  && /not\s+accuracy/i.test(firstSection);
gates.push({
  id: "D7", check: "DATASHEET.md states in its FIRST section that the ground truth is LLM-produced, not human-annotated, and that agreement is not accuracy",
  required: "present", pass: d7ok, hits: d7ok ? [] : [{ file: "DATASHEET.md", count: 0, note: "first section does not carry all three statements" }],
});

// ── an inventory check: nothing outside the declared shape ──────────────────
const allowed = /^(README\.md|DATASHEET\.md|LICENSE-CODE|LICENSE-DATA|CITATION\.cff|BUILD\.md|de-identification-report\.txt|protocol\/|harness\/|analysis\/|data\/)/;
const stray = files.filter((f) => !allowed.test(f.path)).map((f) => ({ file: f.path, count: 1 }));
gates.push({ id: "INV", check: "no file outside the declared bundle shape", required: "zero hits", pass: stray.length === 0, hits: stray });

// ── report ──────────────────────────────────────────────────────────────────
const failed = gates.filter((g) => !g.pass);

const plain = () => {
  const L = [];
  L.push(`=== De-identification gates — DRAFT.md §13.4, run against the BUILT bundle ===`);
  L.push(`bundle: ${relative(ROOT, BUNDLE)}  (${files.length} files, ${(files.reduce((a, f) => a + f.bytes, 0) / 1024).toFixed(0)} KB)`);
  L.push("");
  for (const g of gates) {
    const tag = g.advisory ? "RECORDED" : g.pass ? "PASS" : "FAIL";
    L.push(`[${tag.padEnd(8)}] ${g.id.padEnd(10)} ${g.check}`);
    L.push(`${" ".repeat(11)} required: ${g.required}`);
    if (g.totals) L.push(`${" ".repeat(11)} found:    ${Object.entries(g.totals).map(([k, v]) => `${k}=${v}`).join(", ") || "(none)"}`);
    if (g.note) L.push(`${" ".repeat(11)} note:     ${g.note}`);
    if (g.hits.length) for (const h of g.hits.slice(0, 8)) L.push(`${" ".repeat(11)} HIT:      ${h.file}${h.count ? ` x${h.count}` : ""}${h.sample ? ` — ${h.sample}` : ""}${h.sig ? ` — ${h.sig}` : ""}`);
    L.push("");
  }
  L.push(failed.length ? `RESULT: ${failed.length} GATE(S) FAILED — fix the bundle and re-run.` : `RESULT: all ${gates.length} gates pass (D3 is advisory and RECORDED, pending owner sign-off).`);
  return L.join("\n") + "\n";
};

if (process.argv.includes("--write-report") && !failed.length) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(BUNDLE, "de-identification-report.txt"), plain());
}

if (asJson) {
  console.log(JSON.stringify({ bundle: relative(ROOT, BUNDLE), files: files.length, bytes: files.reduce((a, f) => a + f.bytes, 0), gates }, null, 2));
} else {
  process.stdout.write(plain());
}
process.exit(failed.length ? 1 : 0);
