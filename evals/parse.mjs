// Parse suite against the CURRENT source (bundled by evals/run.mjs — run that,
// not this file directly). 24 cases: the original 14 plus the voice-note
// truncation family from the "[giggles" incident (edbadbf), plus the texting
// dash family from the owner's "sending '— ' should never happen" report.
import { parseBubbles, stripTextingDashes } from "./.bundle.mjs";

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

  // ── [react: X] — she taps ONE emoji onto his last message ────────────────
  // A reaction is a glance, not a bubble. The marker must never survive as
  // text (that would read as her SAYING "[react: heart]"), and a word must
  // never be accepted as an emoji: a model writing [react: laughing] has to
  // stick nothing rather than the string "laughing".
  ["[react: \u{1F602}]\nhaha kya scene tha",
    (r) => r.react === "\u{1F602}" && r.bubbles.join(" ").includes("kya scene") && !r.bubbles.join(" ").includes("react")],
  ["[react: \u2764\uFE0F]", (r) => r.react === "\u2764" && r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  ["[react: laughing] arre wah", (r) => !r.react && !r.bubbles.join(" ").toLowerCase().includes("react")],
  // only the FIRST is honoured — one reply is one glance, never a stack
  ["[react: \u{1F602}][react: \u2764\uFE0F] acha", (r) => r.react === "\u{1F602}"],
  ["kya kar rha hai", (r) => !r.react],
];

// ── the texting dash family ────────────────────────────────────────────────
// The em-dash is the clearest AI tell in a chat bubble and persona.ts:148
// already bans it in prose, so this is the predicate that makes the ban true
// (`honesty-by-instruction`, `gate0-structural`).
//
// The last three are the ones that matter and they are NEGATIVE controls, in
// the shape `device-seam-closed` established: over-stripping is silent in
// exactly the way under-stripping is loud, so a rule that deletes her words
// scores full marks on any "is the dash gone" assertion. The helpline case is
// the same string a greedy /-+/ rule already destroyed once.
const dashCases = [
  ["yeh — sach mein hua", "yeh sach mein hua"],
  ["acha--toh kya scene h", "acha toh kya scene h"],
  ["arre – ruk ek sec", "arre ruk ek sec"],
  ["— haan", "haan"],
  ["kal milte h —", "kal milte h"],
  // no dash: byte-identical, because a transform that touches clean text is a
  // transform nobody can reason about
  ["kya kar rha", "kya kar rha"],
  // NEGATIVE CONTROLS — her own words must survive
  ["call 1800-599-0019 pe", "call 1800-599-0019 pe"],
  ["meera-silk.vercel.app/chat pe hai", "meera-silk.vercel.app/chat pe hai"],
  ["e-mail kar dena", "e-mail kar dena"],
];

let fail = 0;
cases.forEach(([input, check], i) => {
  let r;
  try { r = parseBubbles(input); } catch (e) { r = { threw: String(e) }; }
  if (!check(r)) { fail++; console.log(`FAIL case ${i}:`, JSON.stringify(input.slice(0, 60)), "->", JSON.stringify(r)); }
});
dashCases.forEach(([input, want], i) => {
  let got;
  try { got = stripTextingDashes(input); } catch (e) { got = String(e); }
  if (got !== want) {
    fail++;
    console.log(`FAIL dash case ${i}:`, JSON.stringify(input), "->", JSON.stringify(got), "want", JSON.stringify(want));
  }
});
const total = cases.length + dashCases.length;
console.log(fail ? `${fail} FAILURES of ${total}` : `ALL ${total} PASS`);
process.exit(fail ? 1 : 0);
