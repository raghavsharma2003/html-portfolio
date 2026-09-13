// WS-R160 ("the Room and the landing for any person") — offline,
// deterministic, $0, no DB, no network, no model call, no GPU.
//
//   node evals/site-landing/run.mjs
//
// `site/vyakti.html` used to sell "an AI version of a creator to their
// followers". The owner's intent is broader: any person builds an AI
// version of themselves. This suite proves the REAL, shipping file (never a
// re-typed excerpt) tells that story: three screens (build it, test and
// tweak it, deploy it), the three named systems (HumanOS, EmotionOS,
// RelationOS) as section promises, the honest "apprentice" line, no
// "creator" anywhere, and all of it in both English and Hindi. Four
// sections:
//
//   §1 STRUCTURE, PER LOCALE. Each of `#loc-en`/`#loc-hi` carries exactly
//      three named screens (`build-title`/`test-title`/`deploy-title` and
//      their `-hi` twins), each naming its own OS exactly once, the
//      apprentice line present, and the consent/provenance strip
//      (`#boundary`/`#boundary-hi`) present.
//   §2 VOCABULARY. The real `scripts/check-copy.mjs` scanner run against
//      the REAL file source finds nothing (the same gate `verify-release`
//      runs), plus this suite's own narrower "creator" check the copy
//      gate does not enforce by name.
//   §3 NEGATIVE CONTROLS: (a) a locale block with one OS name deleted is
//      caught by §1's own finder; (b) a copy of the file with "creator"
//      reintroduced is caught by §2's own finder; (c) the real copy gate
//      DOES fire on a planted em dash in this exact file's own text, so a
//      clean pass above is not merely "the gate is not looking here".
//   §4 THE BILINGUAL MECHANISM ITSELF: the toggle buttons exist, target
//      each other's locale, and the Hindi block starts `hidden` (English
//      first paint, matching `site/suites.html`'s own precedent).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PAGE_PATH = join(REPO, "site", "vyakti.html");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const SOURCE = readFileSync(PAGE_PATH, "utf8");

/** Extracts the byte range of `<div class="locale" id="${id}" ...> ... </div>`
 *  by simple brace-free nesting count over `<div`/`</div>`, `site/suites.
 *  html`'s own structural shape restated for a static text scan rather than
 *  a DOM parser (no dependency this repo does not already carry). */
function extractLocaleBlock(source, id) {
  const startMatch = source.match(new RegExp(`<div class="locale" id="${id}"[^>]*>`));
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  let depth = 1;
  let i = start;
  const tagRe = /<(\/?)div\b[^>]*>/g;
  tagRe.lastIndex = start;
  let m;
  while ((m = tagRe.exec(source))) {
    if (m[1] === "/") depth--;
    else depth++;
    if (depth === 0) { i = m.index; break; }
  }
  return source.slice(start, i);
}

/** The checks §1 runs, parameterised by locale so English and Hindi are
 *  held to the identical structural bar rather than two hand-written,
 *  possibly-drifting sets of assertions. Returns the list of finding
 *  strings (empty = clean) so §3's negative control can call it against a
 *  deliberately broken block and assert the list is non-empty. */
function structuralFindings(rawBlock, { suffix, apprentice, boundaryId }) {
  // HTML comments are exempt from every copy rule (`scripts/check-copy.mjs`'s
  // own doctrine, restated here): a per-section marker comment naming its
  // own OS (`<!-- ... build it: HumanOS ... -->`) must not double-count
  // against the ONE user-visible mention this check actually cares about.
  const block = rawBlock.replace(/<!--[\s\S]*?-->/g, "");
  const findings = [];
  const need = (name, cond) => { if (!cond) findings.push(name); };
  need(`build-title${suffix} present`, block.includes(`id="build-title${suffix}"`));
  need(`test-title${suffix} present`, block.includes(`id="test-title${suffix}"`));
  need(`deploy-title${suffix} present`, block.includes(`id="deploy-title${suffix}"`));
  need("HumanOS named exactly once", (block.match(/HumanOS/g) || []).length === 1);
  need("EmotionOS named exactly once", (block.match(/EmotionOS/g) || []).length === 1);
  need("RelationOS named exactly once", (block.match(/RelationOS/g) || []).length === 1);
  need("the apprentice line is present verbatim", block.includes(apprentice));
  need(`the boundary/consent section (${boundaryId}) is present`, block.includes(`id="${boundaryId}"`));
  need("no banned word \"creator\" (case-insensitive)", !/creator/i.test(block));
  need("no banned word \"क्रिएटर\"", !block.includes("क्रिएटर"));
  // "no fake numbers" (DESIGN-LAW §1): a percentage or a suspiciously
  // rounder-than-real adoption figure never appears on this page.
  need("no fabricated percentage figure", !/\b\d{1,3}(\.\d+)?%/.test(block));
  return findings;
}

const enBlock = extractLocaleBlock(SOURCE, "loc-en");
const hiBlock = extractLocaleBlock(SOURCE, "loc-hi");

console.log("── §1: structure, per locale ──");
{
  ok("loc-en block extracted", enBlock !== null && enBlock.length > 500, String(enBlock?.length));
  ok("loc-hi block extracted", hiBlock !== null && hiBlock.length > 500, String(hiBlock?.length));

  const enFindings = structuralFindings(enBlock, {
    suffix: "",
    apprentice: "An unfinished AI is an apprentice, not broken.",
    boundaryId: "boundary",
  });
  ok("English locale: every structural requirement holds", enFindings.length === 0, JSON.stringify(enFindings));

  const hiFindings = structuralFindings(hiBlock, {
    suffix: "-hi",
    apprentice: "अधूरा AI एक शागिर्द है, टूटा हुआ नहीं।",
    boundaryId: "boundary-hi",
  });
  ok("Hindi locale: every structural requirement holds", hiFindings.length === 0, JSON.stringify(hiFindings));
}

console.log("\n── §2: vocabulary (the real gate, plus this suite's own narrower check) ──");
{
  const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
  const { scanScopedSource } = checkCopy;
  const rel = "site/vyakti.html";
  const hits = await scanScopedSource(rel, SOURCE, { rules: "full", codename: false });
  ok("the real check-copy.mjs scanner finds nothing in the shipping file", hits.length === 0, JSON.stringify(hits.slice(0, 5)));
  // Comments are house prose (this file's own header explains why its
  // WS-R10/WS-R160 changelog comments may say "creator" while narrating
  // history) - stripped before this narrower, "creator" is what THE COPY
  // GATE DOES NOT NAME BY WORD check, so it inspects the same user-visible
  // surface §1 already does, at the whole-file level.
  const bodyOnly = SOURCE.replace(/<!--[\s\S]*?-->/g, "");
  ok("no \"creator\" anywhere in the RENDERED page (both locale blocks, comments excluded)",
    !/creator/i.test(bodyOnly) && !bodyOnly.includes("क्रिएटर"));
}

console.log("\n── §3: negative controls ──");
{
  // (a) §1's own finder catches a deleted OS name.
  const brokenBlock = enBlock.replace(/HumanOS/g, "SomethingElseOS");
  const brokenFindings = structuralFindings(brokenBlock, {
    suffix: "", apprentice: "An unfinished AI is an apprentice, not broken.", boundaryId: "boundary",
  });
  ok("NEGATIVE CONTROL (a): removing HumanOS is caught", brokenFindings.includes("HumanOS named exactly once"));

  // (a again) a doubled OS name (a future accidental second mention) is
  // caught too — "exactly once", never merely "at least once".
  const doubledBlock = enBlock.replace(
    "Deploy it: a private, continuing relationship with everyone who talks to it.",
    "Deploy it: a private, continuing relationship with everyone who talks to it. HumanOS again.",
  );
  const doubledFindings = structuralFindings(doubledBlock, {
    suffix: "", apprentice: "An unfinished AI is an apprentice, not broken.", boundaryId: "boundary",
  });
  ok("NEGATIVE CONTROL (a again): a doubled HumanOS mention is caught",
    doubledFindings.includes("HumanOS named exactly once"));

  // (b) §2's own narrower, comment-stripped check catches "creator"
  // reintroduced into the BODY. Asserted against the comment-stripped text
  // (never raw `SOURCE`, whose own changelog comments already say
  // "creator" while narrating this workstream's history - testing against
  // that would pass even without the mutation below, an always-true
  // negative control that proves nothing).
  const poisonedBody = SOURCE.replace(/<!--[\s\S]*?-->/g, "").replace(
    "Build the AI version of",
    "Build the AI version of your creator's",
  );
  ok("NEGATIVE CONTROL (b): a reintroduced \"creator\" IS caught", /creator/i.test(poisonedBody));

  // (c) the real copy gate DOES fire on a planted em dash in this file's
  // own text — proving §2's clean pass is a real absence, not a scanner
  // that never looks at site/vyakti.html at all.
  const checkCopy = await import(pathToFileURL(join(REPO, "scripts/check-copy.mjs")).href);
  const { scanScopedSource } = checkCopy;
  const dashPoisoned = SOURCE.replace(
    "Test it, tweak it, and deploy it",
    "Test it — tweak it, and deploy it",
  );
  const dashHits = await scanScopedSource("site/vyakti.html", dashPoisoned, { rules: "full", codename: false });
  ok("NEGATIVE CONTROL (c): a planted em dash in this exact file IS caught",
    dashHits.some((h) => h.rule === "dash"));
}

console.log("\n── §4: the bilingual mechanism ──");
{
  ok("the Hindi block starts hidden (English is the first paint)",
    /<div class="locale" id="loc-hi"[^>]*\bhidden\b/.test(SOURCE));
  ok("the English toggle points at Hindi", /data-set-lang="hi"/.test(enBlock));
  ok("the Hindi toggle points back at English", /data-set-lang="en"/.test(hiBlock));
  ok("the toggle script wires both buttons via [data-set-lang]", SOURCE.includes('querySelectorAll("[data-set-lang]")'));
  ok("the Devanagari toggle LABEL is itself tagged lang=\"hi\" (a11y: it sits inside an en-tagged ancestor)",
    /<span lang="hi">हिन्दी<\/span>/.test(enBlock));
}

console.log(`\nsite-landing: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
