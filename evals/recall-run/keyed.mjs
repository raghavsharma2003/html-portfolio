// evals/recall-run/keyed.mjs — WS-R118: THE RECALL SCORER, CALIBRATED.
//
// WS-R101's `scoreAnswer` (`api/_recall-run.js`) blends vocabulary overlap
// and word order and had never been compared against a judgment a PERSON
// could sign. A creator's publish floor rests on it. This file is that
// keyed set: 60 hand-authored (passage, answer) pairs, in English and Hindi,
// across six classes, each with an EXPECTED BAND a person would not dispute
// and a one-line REASON. `evals/recall-run/run.mjs` §7 measures the real
// `scoreAnswer` against it, logs per-class agreement, and gates on it.
//
// ═════════════════════════════════════════════════════════════════════════
// WHY SIX CLASSES, AND WHY THESE BANDS
// ═════════════════════════════════════════════════════════════════════════
//
//   verbatim              90-100   an echo (case/punctuation noise allowed)
//   paraphrase             60-100   the same claim, genuinely different words
//   partial                40-70   true, but leaves out real content
//   wrong_on_topic           0-40   same SHAPE of claim, wrong facts
//   contradiction             0-20   denies the passage's own claims
//   evasive                   0-10   empty, or carries no content at all
//
// The bands OVERLAP on purpose at their edges (paraphrase's floor sits inside
// partial's ceiling, partial's floor inside wrong_on_topic's ceiling) — a
// person grading these by hand would not draw a hard line there either, and a
// keyed set pretending otherwise would be manufacturing false precision this
// scorer was never asked to have. What every band DOES exclude by
// construction is the ADJACENT class two steps away: a paraphrase must never
// read as wrong, and a contradiction must never read as merely partial.
//
// ═════════════════════════════════════════════════════════════════════════
// WHERE THE FIXTURE PASSAGES COME FROM
// ═════════════════════════════════════════════════════════════════════════
//
// `EP`/`HP` below are five short, unrelated, plausible-diary-entry passages
// each, English and Hindi — never real replica material (nothing here reads a
// database), and deliberately NOT shaped like `api/_recall-run.js`'s own
// `generateRecallSet` fixtures (`evals/recall-run/run.mjs`'s "Story number N
// from my own life" template): this file tests the SCORER on its own,
// independent of the question-generation half, so a coincidence in one
// template could not quietly flatter the other.
//
// ═════════════════════════════════════════════════════════════════════════
// A REAL BUG THIS KEYED SET FOUND (logged in full in context/rejected.md)
// ═════════════════════════════════════════════════════════════════════════
//
// The first draft of every Hindi contradiction case scored 47-89 — nowhere
// near the 0-20 band — even after the negation-aware contradiction penalty
// was written and wired in. The penalty was never firing. The cause was in
// `normalizeWords` itself, not in anything new: its character filter kept
// `\p{L}` (Letter) and `\p{N}` (Number) and dropped everything else,
// including `\p{M}` (Mark) — Devanagari's own combining vowel signs and
// anusvara. "नहीं" (not/never) was being normalized to "नह", silently
// unmatchable against the very negation list checking for it. Passage and
// answer were mangled identically, so ordinary overlap scoring survived it
// for years; no exact-string check on a Hindi word ever could have. Fixed by
// adding `\p{M}` to the kept class. See `context/rejected.md
// #ws-r118-devanagari-matras-stripped-by-the-unicode-letter-class`.
export const RECALL_KEYED_CLASSES = Object.freeze([
  "verbatim", "paraphrase", "partial", "wrong_on_topic", "contradiction", "evasive",
]);

/** [floor, ceiling], inclusive, one per class above. A case's own `score`
 *  must land inside its class's band to count as "agreed". */
export const RECALL_KEYED_BANDS = Object.freeze({
  verbatim: Object.freeze([90, 100]),
  paraphrase: Object.freeze([60, 100]),
  partial: Object.freeze([40, 70]),
  wrong_on_topic: Object.freeze([0, 40]),
  contradiction: Object.freeze([0, 20]),
  evasive: Object.freeze([0, 10]),
});

const EP = {
  1: "I grew up in Jaipur and I spent every summer helping my grandmother run her small tailoring shop near the old city gate.",
  2: "My first job after college was teaching mathematics at a small school in Pune, and I loved watching students finally understand a hard concept.",
  3: "I started running three years ago after a knee injury forced me to stop playing football, and now I run every single morning before work.",
  4: "The hardest year of my career was when our startup lost its biggest client and I had to lay off half the team myself.",
  5: "I learned to cook properly from my father, who insisted that a good meal always starts with patience.",
};

const HP = {
  1: "मैं जयपुर में पला बढ़ा और हर गर्मी की छुट्टियों में अपनी दादी की छोटी सिलाई की दुकान में मदद करता था।",
  2: "कॉलेज के बाद मेरी पहली नौकरी पुणे के एक छोटे स्कूल में गणित पढ़ाना थी और मुझे बच्चों को समझते देखना बहुत अच्छा लगता था।",
  3: "मैंने तीन साल पहले दौड़ना शुरू किया जब घुटने की चोट के कारण मुझे फुटबॉल खेलना छोड़ना पड़ा और अब मैं हर सुबह दौड़ता हूं।",
  4: "मेरे करियर का सबसे कठिन साल तब था जब हमारी कंपनी ने अपना सबसे बड़ा ग्राहक खो दिया और मुझे खुद आधी टीम को निकालना पड़ा।",
  5: "मैंने खाना बनाना अपने पिता से सीखा जो हमेशा कहते थे कि एक अच्छा खाना धैर्य से शुरू होता है।",
};

/** 60 cases, 10 per class (5 English + 5 Hindi each). Every `answer` was
 *  written by hand against its own `passage`, never generated, and every
 *  `reason` is the one-line justification a person reviewing this file could
 *  check without running any code. */
export const RECALL_KEYED_CASES = Object.freeze([
  // ── verbatim (90-100): an echo of the passage ─────────────────────────
  { id: "en-verb-1", cls: "verbatim", locale: "en", passage: EP[1], answer: EP[1],
    reason: "exact echo of the passage" },
  { id: "en-verb-2", cls: "verbatim", locale: "en", passage: EP[2], answer: EP[2].toUpperCase(),
    reason: "echo, case changed only" },
  { id: "en-verb-3", cls: "verbatim", locale: "en", passage: EP[3], answer: `${EP[3]} Yeah, that's it.`,
    reason: "echo plus a trivial trailing aside" },
  { id: "en-verb-4", cls: "verbatim", locale: "en", passage: EP[4], answer: EP[4],
    reason: "exact echo" },
  { id: "en-verb-5", cls: "verbatim", locale: "en", passage: EP[5], answer: EP[5],
    reason: "exact echo" },
  { id: "hi-verb-1", cls: "verbatim", locale: "hi", passage: HP[1], answer: HP[1],
    reason: "exact echo" },
  { id: "hi-verb-2", cls: "verbatim", locale: "hi", passage: HP[2], answer: HP[2],
    reason: "exact echo" },
  { id: "hi-verb-3", cls: "verbatim", locale: "hi", passage: HP[3], answer: HP[3],
    reason: "exact echo" },
  { id: "hi-verb-4", cls: "verbatim", locale: "hi", passage: HP[4], answer: HP[4],
    reason: "exact echo" },
  { id: "hi-verb-5", cls: "verbatim", locale: "hi", passage: HP[5], answer: HP[5],
    reason: "exact echo" },

  // ── paraphrase (60-100): the same claim, genuinely different words ────
  { id: "en-para-1", cls: "paraphrase", locale: "en", passage: EP[1],
    answer: "Growing up in Jaipur, I would spend every summer helping my grandmother at her tiny tailoring store near the old city gate.",
    reason: "same events (Jaipur, grandmother, tailoring, near the gate), different wording (growing up/tiny/store)" },
  { id: "en-para-2", cls: "paraphrase", locale: "en", passage: EP[2],
    answer: "Right after college my first career was teaching math at a small college in Pune, and I loved seeing students finally grasp a tough concept.",
    reason: "same claim, synonyms for job/school/understand/hard" },
  { id: "en-para-3", cls: "paraphrase", locale: "en", passage: EP[3],
    answer: "I began running three years back after a knee injury forced me to quit playing football, and now I run every single morning before work.",
    reason: "started/began, stop/quit, otherwise same content in the same order" },
  { id: "en-para-4", cls: "paraphrase", locale: "en", passage: EP[4],
    answer: "The toughest year of my career was when our company lost its largest customer and I had to fire half the team myself.",
    reason: "hardest/toughest, startup/company, biggest/largest, client/customer, lay off/fire" },
  { id: "en-para-5", cls: "paraphrase", locale: "en", passage: EP[5],
    answer: "I learned to cook properly from my father, who always said a good dish starts with patience.",
    reason: "insisted/said, meal/dish, rest verbatim" },
  { id: "hi-para-1", cls: "paraphrase", locale: "hi", passage: HP[1],
    answer: "मैं जयपुर में बड़ा हुआ और हर गर्मी की छुट्टियों में अपनी नानी की छोटी कपड़े की स्टोर में मदद करता था।",
    reason: "पला/बड़ा, दादी/नानी, सिलाई/कपड़े, दुकान/स्टोर synonyms" },
  { id: "hi-para-2", cls: "paraphrase", locale: "hi", passage: HP[2],
    answer: "कॉलेज के बाद मेरी पहली नौकरी पुणे के एक छोटे विद्यालय में गणित सिखाना थी और मुझे बच्चों को समझ पाते देखना बहुत अच्छा लगता था।",
    reason: "स्कूल/विद्यालय, पढ़ाना/सिखाना, समझते/समझ synonyms" },
  { id: "hi-para-3", cls: "paraphrase", locale: "hi", passage: HP[3],
    answer: "मैंने तीन साल पहले दौड़ शुरू किया जब घुटने के घाव के कारण मुझे फुटबॉल खेलना छोड़ना पड़ा और अब मैं हर प्रातः दौड़ता हूं।",
    reason: "दौड़ना/दौड़, चोट/घाव, सुबह/प्रातः synonyms" },
  { id: "hi-para-4", cls: "paraphrase", locale: "hi", passage: HP[4],
    answer: "मेरे करियर का सबसे मुश्किल साल तब था जब हमारे स्टार्टअप ने अपना सबसे बड़ा क्लाइंट खो दिया और मुझे खुद आधी टीम को हटाना पड़ा।",
    reason: "कठिन/मुश्किल, कंपनी/स्टार्टअप, ग्राहक/क्लाइंट, निकालना/हटाना synonyms" },
  { id: "hi-para-5", cls: "paraphrase", locale: "hi", passage: HP[5],
    answer: "मैंने भोजन बनाना अपने बाबा से सीखा जो हमेशा कहते थे कि एक अच्छा भोजन सब्र से शुरू होता है।",
    reason: "खाना/भोजन, पिता/बाबा, धैर्य/सब्र synonyms" },

  // ── partial (40-70): correct, but leaves out real content ─────────────
  { id: "en-part-1", cls: "partial", locale: "en", passage: EP[1],
    answer: "I grew up in Jaipur and spent my summers helping my grandmother at her shop.",
    reason: "true but drops the tailoring detail and the gate" },
  { id: "en-part-2", cls: "partial", locale: "en", passage: EP[2],
    answer: "My first job after college was teaching mathematics at a small school in Pune.",
    reason: "true but drops the part about loving watching students understand" },
  { id: "en-part-3", cls: "partial", locale: "en", passage: EP[3],
    answer: "I started running three years ago after a knee injury, and now I run every morning.",
    reason: "true but drops the football detail" },
  { id: "en-part-4", cls: "partial", locale: "en", passage: EP[4],
    answer: "The hardest year of my career was when our startup lost its biggest client.",
    reason: "true but drops the layoff" },
  { id: "en-part-5", cls: "partial", locale: "en", passage: EP[5],
    answer: "I learned to cook properly from my father, who insisted on patience.",
    reason: "true but drops the shortcut line" },
  { id: "hi-part-1", cls: "partial", locale: "hi", passage: HP[1],
    answer: "मैं जयपुर में पला बढ़ा और अपनी दादी की दुकान में मदद करता था।",
    reason: "true but drops summer and sewing detail" },
  { id: "hi-part-2", cls: "partial", locale: "hi", passage: HP[2],
    answer: "कॉलेज के बाद मेरी पहली नौकरी पुणे के एक स्कूल में गणित पढ़ाना थी।",
    reason: "true but drops the part about loving to watch students" },
  { id: "hi-part-3", cls: "partial", locale: "hi", passage: HP[3],
    answer: "मैंने तीन साल पहले दौड़ना शुरू किया और अब मैं हर सुबह दौड़ता हूं।",
    reason: "true but drops the football injury" },
  { id: "hi-part-4", cls: "partial", locale: "hi", passage: HP[4],
    answer: "मेरे करियर का सबसे कठिन साल तब था जब हमारी कंपनी का एक बड़ा ग्राहक चला गया।",
    reason: "true, names the client loss but drops the layoff" },
  { id: "hi-part-5", cls: "partial", locale: "hi", passage: HP[5],
    answer: "मैंने खाना बनाना अपने पिता से सीखा, और धैर्य की बात भी याद है।",
    reason: "true, names the father and gestures at patience without the full sentence" },

  // ── wrong_on_topic (0-40): same shape of claim, wrong facts ────────────
  { id: "en-wrong-1", cls: "wrong_on_topic", locale: "en", passage: EP[1],
    answer: "Lucknow is where my childhood happened. My uncle owned a bookshop downtown, and on weekends I would stop by to see him.",
    reason: "same shape of claim, wrong city, wrong relative, wrong business, different sentence skeleton" },
  { id: "en-wrong-2", cls: "wrong_on_topic", locale: "en", passage: EP[2],
    answer: "My first job after college was selling insurance in Delhi, and I hated the long commute.",
    reason: "same 'first job' shape, everything else wrong" },
  { id: "en-wrong-3", cls: "wrong_on_topic", locale: "en", passage: EP[3],
    answer: "I picked up swimming last year after a back problem stopped me playing cricket, and now I swim on weekends.",
    reason: "same shape, wrong sport, wrong injury, wrong frequency" },
  { id: "en-wrong-4", cls: "wrong_on_topic", locale: "en", passage: EP[4],
    answer: "Bangalore is where things went right for once: a new office opened there and headcount doubled that whole year.",
    reason: "opposite valence and wrong facts, on the same topic of career years, different sentence skeleton" },
  { id: "en-wrong-5", cls: "wrong_on_topic", locale: "en", passage: EP[5],
    answer: "I learned to paint from my mother, who always rushed through everything she made.",
    reason: "same 'learned a skill from a parent' shape, everything else wrong" },
  { id: "hi-wrong-1", cls: "wrong_on_topic", locale: "hi", passage: HP[1],
    answer: "लखनऊ मेरा बचपन का शहर है। वहां चाचा की एक किताबों की दुकान हुआ करती थी, जहां मैं छुट्टियों में जाता था।",
    reason: "wrong city, wrong relative, wrong shop type, different sentence skeleton" },
  { id: "hi-wrong-2", cls: "wrong_on_topic", locale: "hi", passage: HP[2],
    answer: "कॉलेज के बाद मेरी पहली नौकरी दिल्ली में बीमा बेचना थी।",
    reason: "same shape, everything else wrong" },
  { id: "hi-wrong-3", cls: "wrong_on_topic", locale: "hi", passage: HP[3],
    answer: "पिछले साल पीठ में तकलीफ हुई और क्रिकेट छूट गया, तो मैंने तैरना अपना लिया।",
    reason: "wrong sport, wrong injury, wrong year, different sentence skeleton" },
  { id: "hi-wrong-4", cls: "wrong_on_topic", locale: "hi", passage: HP[4],
    answer: "मेरे करियर का सबसे अच्छा साल तब था जब हमने बैंगलोर में नया दफ्तर खोला।",
    reason: "opposite valence, wrong facts, same topic" },
  { id: "hi-wrong-5", cls: "wrong_on_topic", locale: "hi", passage: HP[5],
    answer: "मैंने पेंटिंग करना अपनी मां से सीखा जो हमेशा जल्दी में रहती थीं।",
    reason: "same shape, everything else wrong" },

  // ── contradiction (0-20): denies the passage's own claims ─────────────
  { id: "en-contra-1", cls: "contradiction", locale: "en", passage: EP[1],
    answer: "I did not grow up in Jaipur. I never helped my grandmother. I did not work in her tailoring shop near the gate.",
    reason: "short clauses, negation near each clause's own key terms" },
  { id: "en-contra-2", cls: "contradiction", locale: "en", passage: EP[2],
    answer: "My first job after college was not teaching mathematics. It was never in Pune. I did not love watching students understand anything.",
    reason: "negates the same claims, clause by clause" },
  { id: "en-contra-3", cls: "contradiction", locale: "en", passage: EP[3],
    answer: "I never started running after a knee injury. I did not stop playing football. I do not run every morning now.",
    reason: "negates the same claims, clause by clause" },
  { id: "en-contra-4", cls: "contradiction", locale: "en", passage: EP[4],
    answer: "That was not the hardest year of my career. Our startup never lost its biggest client. I did not lay off the team.",
    reason: "negates the same claims, clause by clause" },
  { id: "en-contra-5", cls: "contradiction", locale: "en", passage: EP[5],
    answer: "I did not learn to cook from my father. He never insisted on patience. A good meal does not start that way.",
    reason: "negates the same claims, clause by clause" },
  { id: "hi-contra-1", cls: "contradiction", locale: "hi", passage: HP[1],
    answer: "मैं जयपुर में नहीं पला बढ़ा। मैंने कभी दादी की मदद नहीं की। मैंने सिलाई की दुकान में काम नहीं किया।",
    reason: "short clauses, नहीं near each clause's own key terms" },
  { id: "hi-contra-2", cls: "contradiction", locale: "hi", passage: HP[2],
    answer: "मेरी पहली नौकरी पुणे में नहीं थी। मैंने कभी गणित नहीं पढ़ाया। मुझे बच्चों को समझते देखना अच्छा नहीं लगता था।",
    reason: "negates the same claims, clause by clause" },
  { id: "hi-contra-3", cls: "contradiction", locale: "hi", passage: HP[3],
    answer: "मैंने दौड़ना कभी शुरू नहीं किया। घुटने की चोट नहीं हुई थी। मैं सुबह नहीं दौड़ता हूं।",
    reason: "negates the same claims, clause by clause" },
  { id: "hi-contra-4", cls: "contradiction", locale: "hi", passage: HP[4],
    answer: "वह मेरे करियर का सबसे कठिन साल नहीं था। कंपनी ने ग्राहक कभी नहीं खोया। मुझे टीम नहीं निकालनी पड़ी।",
    reason: "negates the same claims, clause by clause" },
  { id: "hi-contra-5", cls: "contradiction", locale: "hi", passage: HP[5],
    answer: "मैंने खाना बनाना पिता से नहीं सीखा। उन्होंने कभी धैर्य की बात नहीं की। खाना धैर्य से शुरू नहीं होता।",
    reason: "negates the same claims, clause by clause" },

  // ── evasive (0-10): empty, or carries no content at all ───────────────
  { id: "en-evas-1", cls: "evasive", locale: "en", passage: EP[1], answer: "",
    reason: "empty" },
  { id: "en-evas-2", cls: "evasive", locale: "en", passage: EP[2], answer: "I don't know.",
    reason: "evasive, no content" },
  { id: "en-evas-3", cls: "evasive", locale: "en", passage: EP[3], answer: "That's a good question.",
    reason: "evasive, no content" },
  { id: "en-evas-4", cls: "evasive", locale: "en", passage: EP[4], answer: "I'd rather not say.",
    reason: "evasive, no content" },
  { id: "en-evas-5", cls: "evasive", locale: "en", passage: EP[5], answer: "Not sure honestly.",
    reason: "evasive, no content" },
  { id: "hi-evas-1", cls: "evasive", locale: "hi", passage: HP[1], answer: "",
    reason: "empty" },
  { id: "hi-evas-2", cls: "evasive", locale: "hi", passage: HP[2], answer: "मुझे नहीं पता।",
    reason: "evasive, no content" },
  { id: "hi-evas-3", cls: "evasive", locale: "hi", passage: HP[3], answer: "यह अच्छा सवाल है।",
    reason: "evasive, no content" },
  { id: "hi-evas-4", cls: "evasive", locale: "hi", passage: HP[4], answer: "ठीक से याद नहीं।",
    reason: "evasive, no content" },
  { id: "hi-evas-5", cls: "evasive", locale: "hi", passage: HP[5], answer: "कह नहीं सकता।",
    reason: "evasive, no content" },
]);
