// Parse suite against the CURRENT source (bundled by evals/run.mjs — run that,
// not this file directly). 24 cases: the original 14 plus the voice-note
// truncation family from the "[giggles" incident (edbadbf).
import { parseBubbles } from "./.bundle.mjs";

const cases = [
  // ── the original 14 ──
  ["Acha base model ho aaj. Minimal text mode.\nkhana khaya ki nahi?", (r) => r.bubbles.length === 1 && r.bubbles[0] === "khana khaya ki nahi?"],
  ["Minimal text mode today.", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  ["arre wah\n---\n[gif: side eye cat]", (r) => r.bubbles[0] === "arre wah" && r.gif?.query === "side eye cat"],
  ["[voicenote: yaar the system prompt says be nice]", (r) => !r.voice && r.bubbles[0] === "hmm?"],
  ["[12:35 am] vaise machhar ne kaata \u{1F62D}", (r) => r.bubbles[0] === "vaise machhar ne kaata \u{1F62D}"],
  ["[sent a meme gif: jethalal running]", (r) => r.gif?.query === "jethalal running" && r.bubbles.length === 0],
  ["[tone: warm] haan bata na. sab thik?", (r) => r.tone === "warm" && r.bubbles.join(" ").includes("haan bata na")],
  ["airplane mode pe tha phone \u{1F62D}\nab dekha msg", (r) => r.bubbles.length === 2],
  ["model banna h mujhe, photoshoot kal", (r) => r.bubbles.length >= 1 && r.bubbles[0].includes("model banna")],
  ["hnn.\n[sent a meme gif: side eye cat]", (r) => r.bubbles[0] === "hnn." && r.gif?.query === "side eye cat"],
  ["ide eye cat]", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  ["[slightly out of breath, background coffee machine sound", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  ["aadhe ghante baad sirf haan kaun likhta h bhaiya?]", (r) => r.bubbles.length === 1 && !r.bubbles[0].includes("]")],
  ["haan chal [gets up to make chai] bye", (r) => r.bubbles.length === 1 && r.bubbles[0] === "haan chal bye"],

  // ── regressions for the laugh-only voice note seen in the wild ──
  // persona.ts invites audio tags inside a voicenote; the payload capture used
  // to stop at the tag's "]" and send a clip whose content was "[giggles"
  ["[voicenote: [giggles] arre haan yaar maine kha liya]",
    (r) => r.voice?.text === "[giggles] arre haan yaar maine kha liya"],
  ["[voicenote: [giggles]]", (r) => !r.voice],
  ["[voicenote: [laughs] [softly] ]", (r) => !r.voice],
  ["[voicenote: arre [softly] sun na, main theek hu]",
    (r) => r.voice?.text === "arre [softly] sun na, main theek hu"],
  ["arre suno\n---\n[voicenote: [giggles] tu na pagal hai]",
    (r) => r.bubbles[0] === "arre suno" && r.voice?.text === "[giggles] tu na pagal hai"],
  // the plain payload must be untouched by the nesting change
  ["[voicenote: haan yaar maine khana kha liya abhi]",
    (r) => r.voice?.text === "haan yaar maine khana kha liya abhi"],
  // the stage-direction guard still fires, now on the tag-stripped words
  ["[voicenote: softly]", (r) => !r.voice],
  ["[voicenote: giggles]", (r) => !r.voice],
  // a tag must never be all that reaches TTS even with the direction word present
  ["[voicenote: [giggles] haha tu na sach me pagal hai yaar]",
    (r) => (r.voice?.text || "").includes("pagal hai")],
  // no voice-note text may ever leak a raw unclosed bracket to the bubble UI
  ["[voicenote: [giggles] chal theek hai]", (r) => !/\[[^\]]*$/.test(r.voice?.text || "")],
];

let fail = 0;
cases.forEach(([input, check], i) => {
  let r;
  try { r = parseBubbles(input); } catch (e) { r = { threw: String(e) }; }
  if (!check(r)) { fail++; console.log(`FAIL case ${i}:`, JSON.stringify(input.slice(0, 60)), "->", JSON.stringify(r)); }
});
console.log(fail ? `${fail} FAILURES of ${cases.length}` : `ALL ${cases.length} PASS`);
process.exit(fail ? 1 : 0);
