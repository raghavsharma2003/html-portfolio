// WS-R153. 60 labelled turns, 20 per language (English, Hindi/Devanagari,
// Hinglish), 4 per register bucket per language (5 buckets x 4 x 3 = 60).
// Every row is `[lang, text, expected, extra]` — `extra` optionally carries
// `gapSinceLastMs`/`timeOfDay` for the few cases that need the timing
// features (rushed's fast-follow-up case, flat's late-night case) rather
// than the shape alone. Authored by hand against `register.ts`'s own
// documented cascade (evals/emotionos/run.mjs prints the confusion table
// this file's own header promises rather than asserting one by construction
// — a hand-authored table that always diagonalises would prove nothing).
export const REGISTER_FIXTURES = [
  // ═══════════════════════════════════ EXCITED ═══════════════════════════
  ["en", "omg yes!! we actually won this!!", "excited"],
  ["en", "hahaha that's amazing, I can't even", "excited"],
  ["en", "yessss finally!!!", "excited"],
  ["en", "sooo good omg, love it!", "excited"],
  ["hi", "वाह!! बहुत बढ़िया हुआ ये तो!!", "excited"],
  ["hi", "वाहहहह क्या बात है!", "excited"],
  ["hi", "हाहा मजा आ गया आज तो", "excited"],
  ["hi", "यार मस्त हो गया, हाहाहा!", "excited"],
  ["hinglish", "omg yaar we won!! itna maza aa gaya!!", "excited"],
  ["hinglish", "hahaha yeh toh best hai yaar", "excited"],
  ["hinglish", "yessss ho gaya finally!!!", "excited"],
  ["hinglish", "itna acha laga yaar, sahi mein!", "excited"],

  // ═══════════════════════════════════ RUSHED ════════════════════════════
  ["en", "wait actually can you send me that link right now I need it", "rushed"],
  ["en", "gtg call you back in five dont wait for me", "rushed"],
  ["en", "running super late tell them ill be there soon somehow", "rushed"],
  ["en", "sry running late", "rushed", { gapSinceLastMs: 2000 }],
  ["hi", "अभी जल्दी बता दो मुझे वो लिंक चाहिए था", "rushed"],
  ["hi", "मुझे नहीं पता क्या हो रहा है सब कुछ बहुत तेज चल रहा है", "rushed"],
  ["hi", "जल्दी बोलो ना क्या हुआ बताओ ना मुझे", "rushed"],
  ["hi", "अभी आया", "rushed", { gapSinceLastMs: 1500 }],
  ["hinglish", "yaar jaldi bata do mujhe kal wala plan kya hai", "rushed"],
  ["hinglish", "abhi nikal raha hoon jaldi milte hain rasty mein bata dena", "rushed"],
  ["hinglish", "chal jaldi bata kya scene hai yeh sab", "rushed"],
  ["hinglish", "abhi aata hoon", "rushed", { gapSinceLastMs: 2000 }],

  // ═══════════════════════════════════ UPSET ═════════════════════════════
  ["en", "It is fine.", "upset"],
  ["en", "Okay whatever.", "upset"],
  ["en", "Sure thing.", "upset"],
  ["en", "As you say.", "upset"],
  ["hi", "ठीक है।", "upset"],
  ["hi", "कोई बात नहीं।", "upset"],
  ["hi", "जैसा तुम चाहो।", "upset"],
  ["hi", "सही है।", "upset"],
  ["hinglish", "thik hai.", "upset"],
  ["hinglish", "koi baat nahi.", "upset"],
  ["hinglish", "jaisa tum bolo.", "upset"],
  ["hinglish", "sahi hai bas.", "upset"],

  // ═══════════════════════════════════ FLAT ══════════════════════════════
  ["en", "yeah ok", "flat"],
  ["en", "hmm", "flat"],
  ["en", "not much", "flat", { timeOfDay: 2 }],
  ["en", "just tired", "flat", { timeOfDay: 1 }],
  ["hi", "हम्म", "flat"],
  ["hi", "कुछ नहीं", "flat"],
  ["hi", "बस ऐसे ही", "flat", { timeOfDay: 3 }],
  ["hi", "पता नहीं यार", "flat", { timeOfDay: 2 }],
  ["hinglish", "bas thaka", "flat"],
  ["hinglish", "kuch nahi", "flat"],
  ["hinglish", "bas yun hi", "flat", { timeOfDay: 2 }],
  ["hinglish", "pata nahi", "flat", { timeOfDay: 1 }],

  // ═══════════════════════════════════ NEUTRAL ═══════════════════════════
  ["en", "what time are we meeting tomorrow?", "neutral"],
  ["en", "did you finish the assignment for class?", "neutral"],
  ["en", "I went to the market and bought some vegetables today.", "neutral"],
  ["en", "let me know when you are free to talk about the plan.", "neutral"],
  ["hi", "कल हम कितने बजे मिल रहे हैं?", "neutral"],
  ["hi", "क्या तुमने अपना काम पूरा कर लिया?", "neutral"],
  ["hi", "आज मैं बाजार गया था और कुछ सब्जियां खरीदीं।", "neutral"],
  ["hi", "जब समय मिले तो प्लान के बारे में बताना।", "neutral"],
  ["hinglish", "kal kitne baje milna hai apna?", "neutral"],
  ["hinglish", "kya tumne apna kaam complete kar liya?", "neutral"],
  ["hinglish", "aaj main market gaya tha kuch saman lene ke liye.", "neutral"],
  ["hinglish", "jab time mile toh plan ke baare mein batana.", "neutral"],
];
