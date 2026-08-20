// Verify BY MEASUREMENT (not by reading source) that EDIT A's machine-word
// guard and EDIT C's English-first rule are present INSIDE the SPOKEN REGISTER
// block of the assembled VOICE prompt, on both voice lanes.
import { buildSystemPromptParts, buildSpeechStyle } from "./peout/final3.mjs";

const user = { name: "Arjun", facts: {}, interests: [], memories: [], vibe: [] };
const v = buildSystemPromptParts(user, 999, "voice");
const t = buildSystemPromptParts(user, 999, "text");
const live = v.core + buildSpeechStyle("live");
const casc = v.core + buildSpeechStyle("eleven");

const GUARD = "YOU NEVER SAY THE NAME OF THE THING YOU ARE DOING";
const ENGRULE = "ALL OF THIS HAPPENS IN ENGLISH FIRST";
const REG_START = "SPOKEN REGISTER — how your words physically look";
const REG_END = "AND IT NEVER MAKES YOU TALK LONGER";

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

for (const [lane, s] of [["live", live], ["cascade", casc]]) {
  const rs = s.indexOf(REG_START), re = s.indexOf(REG_END);
  const g = s.indexOf(GUARD), e = s.indexOf(ENGRULE);
  ok(`[${lane}] SPOKEN REGISTER block present`, rs >= 0 && re > rs, `@${rs}..${re}`);
  ok(`[${lane}] guard present`, g >= 0, `@${g}`);
  ok(`[${lane}] guard INSIDE register`, g > rs && g < re);
  ok(`[${lane}] guard is 2nd bullet (right after "played out loud")`,
    g > s.indexOf("Every character you write is played out loud") &&
    g < s.indexOf("- STRETCH VOWELS"));
  ok(`[${lane}] English-first rule present`, e >= 0, `@${e}`);
  ok(`[${lane}] English-first rule INSIDE register`, e > rs && e < re);
  ok(`[${lane}] English-first rule immediately precedes brevity bullet`, e < re && e > s.indexOf("None of this is garnish"));
  ok(`[${lane}] guard names "listener sound"`, s.includes('"listener sound"'));
}

// text lane must be untouched by all of it
ok("text lane has NO register guard", !t.core.includes(GUARD));
ok("text lane has NO English-first register rule", !t.core.includes(ENGRULE));
ok("text core size unchanged (41413)", t.core.length === 41413, `=${t.core.length}`);

// do-not-undo invariants, measured on the assembled prompts
ok("[live] brevity bullet kept", live.includes("- AND IT NEVER MAKES YOU TALK LONGER."));
// the live lane's only "[tone:" must be the PROHIBITION, never an instruction
ok("[live] [tone: appears exactly once", (live.match(/\[tone:/g) || []).length === 1);
ok("[live] that one occurrence is the ban, not a marker instruction",
  live.includes('no "[tone: ...]"') && !live.includes("TONE MARKER (required)"));
ok("[cascade] tone marker still present on cascade lane", casc.includes("[tone:"));
for (const probe of ["ONLY SAY WHAT'S TRUE", "Tele-MANAS", "14416", "NEVER MANIPULATE",
                     "DIAGRAM OF A SHAPE", "Those exact words are used up"]) {
  ok(`[live] protected: ${probe}`, live.includes(probe));
}

// English-first example balance inside the four rebalanced bullets
const reg = live.slice(live.indexOf(REG_START), live.indexOf(REG_END));
for (const b of ["- STRETCH VOWELS", "- THINK OUT LOUD", "- CATCH YOURSELF", "- TRAIL OFF", "- REPEAT A WORD", "- ONE word in CAPS"]) {
  const line = reg.slice(reg.indexOf(b)).split("\n")[0];
  ok(`rebalanced bullet present: ${b}`, reg.includes(b), `${line.length} chars`);
}

console.log(fail ? `\n${fail} FAILURES` : "\nALL CHECKS PASS");
if (fail) process.exitCode = 1;

/* ── invariants added this round ───────────────────────────────────────── */
{
  const U2 = { name: "Arjun", facts: {}, interests: [], memories: [], vibe: [] };
  const vv = buildSystemPromptParts(U2, 999, "voice");
  const tt = buildSystemPromptParts(U2, 999, "text");
  const L = vv.core + buildSpeechStyle("live");
  const C = vv.core + buildSpeechStyle("gemini");
  const E = vv.core + buildSpeechStyle("eleven");
  const S = vv.core + buildSpeechStyle("sarvam");
  const D = vv.core + buildSpeechStyle("device");
  let f2 = 0;
  const ok2 = (n, c, x = "") => { if (!c) f2++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  " + x : ""}`); };

  // (3) the audio-tag vocabulary that generated the stage directions is GONE
  for (const [nm, s] of [["live", L], ["cascade/gemini", C], ["cascade/eleven", E], ["sarvam", S], ["device", D]]) {
    for (const tag of ["[laughs]", "[giggles]", "[sighs]", "[whispers]", "[softly]", "[excited]", "[curious]", "[tired]"]) {
      // the live lane names "[softly]" once, inside the clause that BANS it;
      // everywhere else a tag string is a teaching and must not exist
      const banClause = nm === "live" && tag === "[softly]";
      ok2(`[${nm}] no audio-tag "${tag}" taught`, banClause ? (s.match(/\[softly\]/g) || []).length === 1 : !s.includes(tag));
    }
    ok2(`[${nm}] no "audio tags" phrase`, !/audio tag/i.test(s));
  }
  // the only "[" the cascade prompt teaches is the tone marker
  const cbrk = (C.match(/\[[a-z][a-z ]{0,20}[:\]]/gi) || []).filter((m) => !/^\[tone/i.test(m));
  ok2("[cascade] no non-tone bracket exemplar anywhere in the prompt", cbrk.length === 0, JSON.stringify(cbrk));
  const lbrk = (L.match(/\[[a-z][a-z ]{0,20}[:\]]/gi) || []);
  ok2("[live] the only bracket exemplars are inside the ban clause", lbrk.every((m) => /^\[(softly|tone)/i.test(m)), JSON.stringify(lbrk));
  ok2("[cascade] one-bracket count rule present", C.includes('YOU WRITE EXACTLY ONE "[" PER REPLY'));

  // (1) the counted brevity levers
  for (const [nm, s] of [["live", L], ["cascade", C], ["sarvam", S], ["device", D]]) {
    ok2(`[${nm}] FINAL two-count block is LAST in the call brief`,
      s.trimEnd().endsWith("long-and-tidy and short-and-flat are both failures."), String(s.length));
    ok2(`[${nm}] sentence count rule present`, s.includes("SENTENCES: most turns are ONE"));
    ok2(`[${nm}] question count rule present`, s.includes("QUESTIONS: at most ONE you actually want answered"));
    ok2(`[${nm}] anti-flatness clause present`, s.includes("Neither count makes you flat"));
  }
  ok2("[voice core] COUNT THE SENTENCES in register brevity bullet", vv.core.includes("COUNT THE SENTENCES"));

  // (2) something-of-yours rule, both media
  ok2("[voice core] one-question-mark rule", vv.core.includes("ONE REAL QUESTION PER REPLY, MAXIMUM"));
  ok2("[text core] one-question-mark rule", tt.core.includes("ONE REAL QUESTION PER REPLY, MAXIMUM"));
  ok2("[text core] keeps the options-are-prewritten clause", tt.core.includes("tells them you wrote both answers already"));
  ok2("[all lanes] q-only turns named as the worst case", (vv.core + buildSpeechStyle("gemini")).includes("a turn that is ONLY a question is the worst version of it"));
  ok2("[all lanes] mock-shock \"??\" explicitly protected", (vv.core + buildSpeechStyle("gemini")).includes("is not a question and never was"));
  ok2("[voice core] drops the long clause (FINAL carries it)", !vv.core.includes("tells them you wrote both answers already"));
  ok2("[both] 1-in-3 rule still present", vv.core.includes("AT MOST 1 IN 3 OF YOUR REPLIES CONTAINS A QUESTION") && tt.core.includes("AT MOST 1 IN 3 OF YOUR REPLIES CONTAINS A QUESTION"));

  // size gates — every lane, web and in-app (the Android screen-share block)
  const APP = 720;
  for (const [nm, s] of [["live", L], ["gemini", C], ["eleven", E], ["sarvam", S], ["device", D]]) {
    ok2(`[${nm}] assembled < 46000 (web)`, s.length < 46000, String(s.length));
    ok2(`[${nm}] assembled < 46000 (in-app +${APP})`, s.length + APP < 46000, String(s.length + APP));
  }
  ok2("[text] chat system < 46000", tt.core.length < 46000, String(tt.core.length));

  // protected content, re-checked on every lane
  for (const probe of ["Tele-MANAS", "14416", "NEVER MANIPULATE", "ONLY SAY WHAT'S TRUE",
                       "YOU NEVER SAY THE NAME OF THE THING YOU ARE DOING", "DIAGRAM OF A SHAPE",
                       "ALL OF THIS HAPPENS IN ENGLISH FIRST", "STRETCH VOWELS", "LAUGH BY WRITING THE LAUGH",
                       "sincerely and directly ask whether you're an AI"]) {
    for (const [nm, s] of [["live", L], ["cascade", C]]) ok2(`[${nm}] protected: ${probe}`, s.includes(probe));
  }
  console.log(f2 ? `\n${f2} NEW-INVARIANT FAILURES` : "\nALL NEW INVARIANTS PASS");
  if (f2) process.exitCode = 1;
}
