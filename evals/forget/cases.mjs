// ── A4: the adversarial Hinglish forget battery ───────────────────────────
//
// Every case is: what he SAID, the marker she would put on the end of her
// reply (FORGET_DECISION: "[forget: X] … where X is … the name of the single
// thing"), the rows that exist, and which of those rows the delete was
// supposed to take. The measurement is what the CURRENT matcher actually
// takes.
//
// The marker is stipulated rather than generated, and this is the battery's
// one honest limitation, stated here rather than buried: the model writes it,
// so an offline suite cannot produce it. Each case therefore carries the most
// FAVOURABLE plausible marker — the shortest referring expression in his own
// words. Where the model could plausibly resolve the referent itself and emit
// a name, that is a separate case (`resolved:` prefix), because "the model
// sometimes resolves it" is a real and different question from "the matcher
// resolves it", and the survey's A1 is about the second one.
//
// Categories, and what each is for:
//   control        the matcher's happy path. If these fail, the harness is
//                  broken, not the matcher.
//   referent-hi    Hinglish referring expressions — "woh ladki", "usne"
//   referent-en    English ones — "my ex", "that girl"
//   temporal-ref   a referring expression ABOUT an utterance — "wo baat jo
//                  maine kal boli thi" — which is also a scope trap
//   script         the ask and the row are in different scripts
//   translit       the ask and the row are the same name, spelled differently
//   morphology     the row inflects or compounds the term
//   phrase-order   multi-word terms whose order differs from the row's
//   precision      rows that must NOT be taken

export const CASES = [
  // ── controls ───────────────────────────────────────────────────────────
  {
    id: "control-name",
    cat: "control",
    said: "priya ke baare me jo bataya tha wo bhool ja",
    marker: "priya",
    rows: [
      { id: 1, text: "priya — his colleague, the one who moved to bangalore", hit: true },
      { id: 2, text: "his sister's wedding is in december", hit: false },
    ],
  },
  {
    id: "control-phrase",
    cat: "control",
    said: "goa trip wali baat delete kar do",
    marker: "goa trip",
    rows: [
      { id: 1, text: "the goa trip he cancelled twice", hit: true },
      { id: 2, text: "he wants to see kerala in monsoon", hit: false },
    ],
  },

  // ── Hinglish referring expressions ─────────────────────────────────────
  {
    id: "ref-woh-ladki",
    cat: "referent-hi",
    said: "woh ladki jiske baare me maine kal bataya tha, usko bhool ja",
    marker: "woh ladki",
    resolvedMarker: "priya",
    rows: [
      { id: 1, text: "priya — his colleague, the one who moved to bangalore", hit: true },
      { id: 2, text: "he is learning to drive", hit: false },
    ],
  },
  {
    id: "ref-usne",
    cat: "referent-hi",
    said: "usne jo bola tha na, wo yaad mat rakhna",
    marker: "usne jo bola",
    resolvedMarker: "rohit",
    rows: [
      { id: 1, text: "rohit told him the appraisal was already decided", hit: true },
      { id: 2, text: "he plays chess on the metro", hit: false },
    ],
  },
  {
    id: "ref-wo-ladka",
    cat: "referent-hi",
    said: "wo ladka jo party me mila tha, uska naam hata do",
    marker: "wo ladka",
    resolvedMarker: "aman",
    rows: [
      { id: 1, text: "aman — met him at the diwali party, works in logistics", hit: true },
      { id: 2, text: "his mother calls every sunday", hit: false },
    ],
  },
  {
    id: "ref-unki-baat",
    cat: "referent-hi",
    said: "unki baat mat rakhna apne paas",
    marker: "unki baat",
    resolvedMarker: "father",
    rows: [
      { id: 1, text: "his father wants him to move back to nagpur", hit: true },
      { id: 2, text: "he switched to a standing desk", hit: false },
    ],
  },

  // ── English referring expressions ──────────────────────────────────────
  {
    id: "ref-my-ex",
    cat: "referent-en",
    said: "forget everything about my ex",
    marker: "my ex",
    resolvedMarker: "sneha",
    rows: [
      { id: 1, text: "sneha — they were together three years, ended in march", hit: true },
      { id: 2, text: "sneha's cousin fixed his laptop", hit: true },
      { id: 3, text: "he supports mumbai city fc", hit: false },
    ],
  },
  {
    id: "ref-that-girl",
    cat: "referent-en",
    said: "that girl i mentioned, drop it",
    marker: "that girl",
    resolvedMarker: "priya",
    rows: [
      { id: 1, text: "priya — his colleague, the one who moved to bangalore", hit: true },
      { id: 2, text: "he took up badminton again", hit: false },
    ],
  },

  // ── a referring expression about an UTTERANCE (and a scope trap) ───────
  {
    id: "ref-wo-baat-kal",
    cat: "temporal-ref",
    said: "wo baat jo maine kal boli thi, wo bhool ja",
    marker: "wo baat jo maine kal boli thi",
    rows: [
      { id: 1, text: "he is thinking about quitting without another offer", hit: true },
      { id: 2, text: "he had maggi for dinner", hit: false },
    ],
    // "kal" is in the string but not at the front, so resolveForget does NOT
    // read this as a day scope — it becomes a 29-character item name. Recorded
    // because the near-miss is the interesting part.
    note: "scope trap: 'kal' present but not leading, so this stays scope 'item'",
  },
  {
    id: "ref-wo-wali-baat",
    cat: "temporal-ref",
    said: "wo wali baat delete kar do",
    marker: "wo wali baat",
    rows: [
      { id: 1, text: "he is thinking about quitting without another offer", hit: true },
      { id: 2, text: "he is saving for a classic 350", hit: false },
    ],
  },

  // ── script ─────────────────────────────────────────────────────────────
  {
    id: "script-deva-row",
    cat: "script",
    said: "priya ko bhool ja",
    marker: "priya",
    rows: [
      { id: 1, text: "प्रिया — उसकी कलीग, बैंगलोर चली गई", hit: true },
      { id: 2, text: "he is learning to swim", hit: false },
    ],
  },
  {
    id: "script-deva-ask",
    cat: "script",
    said: "प्रिया वाली बात हटा दो",
    marker: "प्रिया",
    rows: [
      { id: 1, text: "priya — his colleague, the one who moved to bangalore", hit: true },
      { id: 2, text: "he is learning to swim", hit: false },
    ],
  },

  // ── transliteration ────────────────────────────────────────────────────
  {
    id: "translit-preeti",
    cat: "translit",
    said: "priti ke baare me kuch mat rakhna",
    marker: "priti",
    rows: [
      { id: 1, text: "preeti — his cousin in indore", hit: true },
      { id: 2, text: "he is bad at waking up early", hit: false },
    ],
  },
  {
    id: "translit-gowa",
    cat: "translit",
    said: "gowa trip bhool ja",
    marker: "gowa trip",
    rows: [
      { id: 1, text: "the goa trip he cancelled twice", hit: true },
      { id: 2, text: "he wants to see kerala in monsoon", hit: false },
    ],
  },
  {
    id: "translit-rohit-rohith",
    cat: "translit",
    said: "rohith wali baat hata do",
    marker: "rohith",
    rows: [
      { id: 1, text: "rohit told him the appraisal was already decided", hit: true },
      { id: 2, text: "he is reading a book about ships", hit: false },
    ],
  },

  // ── morphology ─────────────────────────────────────────────────────────
  {
    id: "morph-possessive",
    cat: "morphology",
    said: "priya ki har baat hata do",
    marker: "priya",
    rows: [
      { id: 1, text: "priya's transfer letter came through", hit: true },
      { id: 2, text: "priyaji sent sweets at diwali", hit: true },
      { id: 3, text: "he is bad at waking up early", hit: false },
    ],
    note: "the row inflects the term: \"priya's\" and \"priyaji\" are the same person",
  },
  {
    id: "morph-hindi-case",
    cat: "morphology",
    said: "rohit ko bhool ja",
    marker: "rohit",
    rows: [
      { id: 1, text: "rohitne bataya tha ki appraisal pehle se decide tha", hit: true },
      { id: 2, text: "he takes the 8:10 local", hit: false },
    ],
    note: "hindi case-marking fuses onto the noun: rohit + ne",
  },

  // ── phrase order ───────────────────────────────────────────────────────
  {
    id: "order-goa-trip",
    cat: "phrase-order",
    said: "goa trip wali baat bhool ja",
    marker: "goa trip",
    rows: [
      { id: 1, text: "the trip to goa he cancelled twice", hit: true },
      { id: 2, text: "he wants to see kerala in monsoon", hit: false },
    ],
  },
  {
    id: "order-job-baat",
    cat: "phrase-order",
    said: "job wali baat delete kar",
    marker: "job wali baat",
    rows: [
      { id: 1, text: "he is thinking about quitting his job without another offer", hit: true },
      { id: 2, text: "he is saving for a classic 350", hit: false },
    ],
  },

  // ── precision: rows that must survive ──────────────────────────────────
  {
    id: "precision-priyanka",
    cat: "precision",
    said: "priya ko bhool ja",
    marker: "priya",
    rows: [
      { id: 1, text: "priya — his colleague, the one who moved to bangalore", hit: true },
      { id: 2, text: "priyanka is his manager and he likes working with her", hit: false },
    ],
    note: "the word boundary is what keeps priyanka standing — a substring match would take a stranger's row with her",
  },
  {
    id: "precision-common-word",
    cat: "precision",
    said: "office wali baat bhool ja",
    marker: "office",
    rows: [
      { id: 1, text: "the office is moving to a new building in q1", hit: true },
      { id: 2, text: "he met his flatmate through an office friend", hit: false },
      { id: 3, text: "his office chair is broken and he keeps not fixing it", hit: false },
    ],
    note: "a common noun as a term is wide by construction — recorded, because A1 must not make it wider",
  },
];

/** Cases whose marker is what the model would emit if IT resolved the
 *  referent. Separate on purpose: this measures a different system. */
export const RESOLVED_CASES = CASES.filter((c) => c.resolvedMarker).map((c) => ({
  ...c,
  id: `resolved:${c.id}`,
  cat: "resolved-by-model",
  marker: c.resolvedMarker,
}));
