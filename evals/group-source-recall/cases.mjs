// Frozen invented corpus. Do not tune these cases after candidate results.
// No selector import belongs in this file; it was authored independently.
export const CORPUS_VERSION = 'group-source-recall-48-v1-20261001';

const language = {
  en: {
    label: 'English',
    filler: n => `Receipt sequence ${n}: parcel sealed.`,
    query: 'What did the archive mural team decide about colour?',
    mural: 'The archive mural team decided on cobalt colour for the north wall.',
    paraphrase: 'Our painted wall should be ultramarine.',
    reportedQuery: 'What did Ada report about Ravi and the archive mural?',
    reported: 'Ada here: Ravi told me the archive mural must remain cobalt.',
    quotedQuery: 'Which archive mural quotation did Ravi attribute to Ada?',
    quoted: 'She said, "Keep the old blue wall." I am repeating her words, not endorsing them.',
    disagreeQuery: 'Which archive mural colour proposals did Ada and Ravi disagree about?',
    agree: 'Ada: the archive mural colour should be cobalt.',
    disagree: 'Ravi: I disagree with Ada; the archive mural colour should be amber.',
    indirectDissent: 'No. I prefer the warm shade, not her cold one.',
    correctionQuery: 'What was the archive mural colour, and what correction followed?',
    old: 'The archive mural colour will be cobalt. This is the original note.',
    correction: 'Correction: the archive mural colour is amber, not cobalt. The earlier note is outdated.',
    unavailableCorrection: 'The final decision changed again: use green. This note was not available to this turn.',
    honorificQuery: 'What did Dr Sen recommend for the archive mural colour?',
    honorific: 'Doctor Sen speaking: I recommend cobalt for the archive mural colour.',
    renamedQuery: 'What did Professor Sen say about the archive mural?',
    renamed: 'Doc Mira: keep the painted wall blue. That was my suggestion under my former display name.',
    dissentQuery: 'Who dissented from the archive mural colour decision?',
    dissent: 'Ravi: I dissent from the archive mural colour decision. I prefer amber.',
    majority: 'Ada: I support the archive mural colour decision, cobalt.',
    indirectMinority: 'I am the lone objection. Please do not count my silence as agreement.',
    publicQuery: 'What archive mural colour information can this group use?',
    public: 'Public update: the archive mural colour is undecided; this note is shared with everyone present.',
    private: 'Restricted earlier note: the archive mural colour was cobalt; this source is not admitted.',
    erased: 'Withdrawn note: the archive mural colour was amber; this source is not admitted.',
    distractor: (q, n) => `${q} Unrelated catalogue title ${n}; this title records no participant decision.`,
  },
  hi: {
    label: 'Hindi',
    filler: n => `रसीद क्रमांक ${n}: पार्सल सीलबंद।`,
    query: 'अभिलेखागार भित्तिचित्र दल ने रंग पर क्या तय किया?',
    mural: 'अभिलेखागार भित्तिचित्र दल ने उत्तरी दीवार के लिए नीला रंग तय किया।',
    paraphrase: 'हमारी चित्रित दीवार समुद्री छटा वाली रहे।',
    reportedQuery: 'अदा ने रवि और अभिलेखागार भित्तिचित्र के बारे में क्या बताया?',
    reported: 'मैं अदा हूँ: रवि ने मुझे बताया कि अभिलेखागार भित्तिचित्र नीला रहना चाहिए।',
    quotedQuery: 'रवि ने अभिलेखागार भित्तिचित्र का कौन सा कथन अदा को सौंपा?',
    quoted: 'उसने कहा, "पुरानी नीली दीवार रखो।" ये उसके शब्द दोहरा रहा हूँ, सहमति नहीं दे रहा।',
    disagreeQuery: 'अभिलेखागार भित्तिचित्र के रंग पर अदा और रवि के प्रस्ताव कैसे अलग थे?',
    agree: 'अदा: अभिलेखागार भित्तिचित्र का रंग नीला होना चाहिए।',
    disagree: 'रवि: अदा से असहमत हूँ; अभिलेखागार भित्तिचित्र का रंग पीला होना चाहिए।',
    indirectDissent: 'नहीं। उनकी ठंडी छटा नहीं, मुझे गरम छटा पसंद।',
    correctionQuery: 'अभिलेखागार भित्तिचित्र का रंग क्या था और क्या सुधार आया?',
    old: 'अभिलेखागार भित्तिचित्र का रंग नीला होगा। यह शुरुआती सूचना है।',
    correction: 'सुधार: अभिलेखागार भित्तिचित्र का रंग पीला होगा, नीला नहीं। पिछली सूचना पुरानी है।',
    unavailableCorrection: 'अंतिम निर्णय फिर बदला: हरा इस्तेमाल करो। यह सूचना इस प्रश्न की सीमा के बाहर थी।',
    honorificQuery: 'डॉ सेन ने अभिलेखागार भित्तिचित्र के रंग के लिए क्या सुझाया?',
    honorific: 'डॉक्टर सेन बोल रही हूँ: अभिलेखागार भित्तिचित्र के लिए नीला रंग सुझाती हूँ।',
    renamedQuery: 'प्रोफेसर सेन ने अभिलेखागार भित्तिचित्र पर क्या कहा?',
    renamed: 'मीरा दी: चित्रित दीवार नीली रखो। उस समय मेरा प्रदर्शित नाम यही था।',
    dissentQuery: 'अभिलेखागार भित्तिचित्र के रंग के निर्णय से कौन असहमत था?',
    dissent: 'रवि: अभिलेखागार भित्तिचित्र के रंग के निर्णय से असहमत हूँ। पीला पसंद करता हूँ।',
    majority: 'अदा: अभिलेखागार भित्तिचित्र के रंग का निर्णय नीला हो, इसका समर्थन करती हूँ।',
    indirectMinority: 'केवल मेरी आपत्ति बाकी। मेरी चुप्पी को मंजूरी मत मानना।',
    publicQuery: 'यह समूह अभिलेखागार भित्तिचित्र के रंग की कौन सी सूचना इस्तेमाल कर सकता है?',
    public: 'सार्वजनिक सूचना: अभिलेखागार भित्तिचित्र का रंग अनिर्णीत है; यह सूचना अभी मौजूद सभी लोगों के लिए है।',
    private: 'प्रतिबंधित पुरानी सूचना: अभिलेखागार भित्तिचित्र का रंग नीला था; यह स्रोत स्वीकृत सूची में नहीं है।',
    erased: 'वापस ली गई सूचना: अभिलेखागार भित्तिचित्र का रंग पीला था; यह स्रोत स्वीकृत सूची में नहीं है।',
    distractor: (q, n) => `${q} असंबद्ध सूची शीर्षक ${n}; शीर्षक किसी सदस्य का निर्णय नहीं बताता।`,
  },
  cs: {
    label: 'Hindi-English code-switching',
    filler: n => `Dispatch slip ${n}: parcel band.`,
    query: 'Archive mural team ne colour ke baare mein kya decide kiya?',
    mural: 'Archive mural team ne north wall ke liye cobalt colour decide kiya.',
    paraphrase: 'चित्रित दीवार समुद्री छटा वाली रहे।',
    reportedQuery: 'Ada ne Ravi aur archive mural ke baare mein kya report kiya?',
    reported: 'Ada here: Ravi ne mujhe bola archive mural cobalt rehna chahiye.',
    quotedQuery: 'Ravi ne archive mural ke liye Ada ka kaunsa quotation diya?',
    quoted: 'Usne bola, "Purani neeli deewar rakho." Uske words repeat kar raha hoon, endorse nahi.',
    disagreeQuery: 'Archive mural colour par Ada aur Ravi ke proposals kaise different the?',
    agree: 'Ada: archive mural colour cobalt hona chahiye.',
    disagree: 'Ravi: Ada se disagree karta hoon; archive mural colour amber hona chahiye.',
    indirectDissent: 'नहीं। उनकी ठंडी छटा नहीं, मुझे गरम छटा पसंद।',
    correctionQuery: 'Archive mural colour kya tha aur baad mein kya correction aaya?',
    old: 'Archive mural colour cobalt hoga. Yeh original note hai.',
    correction: 'Correction: archive mural colour amber hai, cobalt nahi. Purana note outdated hai.',
    unavailableCorrection: 'Final decision phir badla: green use karo. Yeh note current turn ke paas nahi tha.',
    honorificQuery: 'Dr Sen ne archive mural colour ke liye kya recommend kiya?',
    honorific: 'Doctor Sen bol rahi hoon: archive mural colour cobalt recommend karti hoon.',
    renamedQuery: 'Professor Sen ne archive mural par kya kaha?',
    renamed: 'मीरा दी: चित्रित दीवार नीली रखो। उस समय मेरा प्रदर्शित नाम यही था।',
    dissentQuery: 'Archive mural colour decision se kisne dissent kiya?',
    dissent: 'Ravi: archive mural colour decision se dissent karta hoon. Mujhe amber pasand hai.',
    majority: 'Ada: archive mural colour decision cobalt ho, main support karti hoon.',
    indirectMinority: 'मेरी अकेली आपत्ति बाकी। चुप्पी को मंजूरी मत मानना।',
    publicQuery: 'Is group ko archive mural colour ki kaunsi information use karni chahiye?',
    public: 'Public update: archive mural colour undecided hai; yeh note sab current members ke liye shared hai.',
    private: 'Restricted old note: archive mural colour cobalt tha; yeh source admitted nahi hai.',
    erased: 'Withdrawn note: archive mural colour amber tha; yeh source admitted nahi hai.',
    distractor: (q, n) => `${q} Unrelated catalogue title ${n}; yeh title kisi participant ka decision nahi hai.`,
  },
};

export const FAMILIES = Object.freeze([
  'older_evidence', 'speaker_subject', 'disagreement', 'corrections',
  'role_wording', 'dissent', 'audience_changes', 'revocation_erasure',
]);

const sourceId = n => `meera_log:${n}`;
const row = (n, text, speakerId = 'person-a') => ({
  sourceId: sourceId(n), order: String(n), episodeId: `episode-${n}`,
  speakerId, recordedAt: n % 3 === 0 ? null : '2026-09-30T12:00:00.000Z', text,
});

function buildCase(family, lang, variant) {
  const l = language[lang];
  const candidates = Array.from({ length: 40 }, (_, i) => row(i + 1, l.filler(i + 1), `person-${i % 3}`));
  const targets = [];
  const corrections = [];
  const notAdmitted = [];
  const outsideCoverage = [];
  const limitations = ['Historical recorded statements are not established present-day facts.'];
  const hostRequirements = [];
  let query;
  const put = (n, text, speaker = 'person-a', relevant = true) => {
    candidates[n - 1] = row(n, text, speaker);
    if (relevant) targets.push(sourceId(n));
  };
  const prohibit = (n, text, reason) => {
    notAdmitted.push({ reason, record: row(n, text, 'person-restricted') });
    candidates[n - 1] = null;
  };

  switch (family) {
    case 'older_evidence':
      query = l.query;
      put(3, variant === 1 ? l.mural : l.paraphrase);
      limitations.push(variant === 1 ? 'Target is beyond the recent 20.' : 'Paraphrase and cross-script matching are unsupported; literal distractors compete with the target.');
      break;
    case 'speaker_subject':
      query = variant === 1 ? l.reportedQuery : l.quotedQuery;
      put(3, variant === 1 ? l.reported : l.quoted, variant === 1 ? 'person-ada' : 'person-ravi');
      limitations.push('Recorded speaker identity is ground truth; mentioned or quoted people are not inferred subject IDs.');
      break;
    case 'disagreement':
      query = l.disagreeQuery;
      put(3, l.agree, 'person-ada');
      put(7, variant === 1 ? l.disagree : l.indirectDissent, 'person-ravi');
      limitations.push('Selecting both statements does not resolve the disagreement or establish consensus.');
      break;
    case 'corrections':
      query = l.correctionQuery;
      put(3, l.old);
      if (variant === 1) {
        put(30, l.correction);
        corrections.push(sourceId(30));
      } else {
        outsideCoverage.push({ reason: 'after_turn_cutoff', record: row(41, l.unavailableCorrection) });
        limitations.push('A correction after the fixed current-source cutoff is unavailable, not a retrieval success.');
      }
      break;
    case 'role_wording':
      query = variant === 1 ? l.honorificQuery : l.renamedQuery;
      put(3, variant === 1 ? l.honorific : l.renamed, 'person-sen');
      limitations.push('The same recorded person has current label Professor Sen; no label substitution into historical text is allowed.');
      break;
    case 'dissent':
      query = l.dissentQuery;
      put(3, variant === 1 ? l.dissent : l.indirectMinority, 'person-ravi');
      put(27, l.majority, 'person-ada', false);
      put(28, l.majority, 'person-bina', false);
      put(29, l.majority, 'person-cyrus', false);
      limitations.push('Three majority statements do not erase the recorded dissenter; lexical selection cannot infer implicit dissent.');
      break;
    case 'audience_changes':
      query = l.publicQuery;
      put(3, l.public, 'person-public');
      prohibit(7, l.private, variant === 1 ? 'late_joiner_outside_episode_audience' : 'audience_witness_changed');
      hostRequirements.push(variant === 1 ? 'SQL must exclude old sources not disclosed to a late joiner.' : 'A changed audience witness must invalidate generation and delivery in the real caller.');
      limitations.push('Forbidden rows are sidecar fixtures, never selector input; this is not an ACL or audience-witness test.');
      break;
    case 'revocation_erasure':
      query = l.publicQuery;
      put(3, l.public, 'person-public');
      prohibit(7, l.erased, variant === 1 ? 'source_erased' : 'participant_or_deny_or_grant_revoked');
      hostRequirements.push('SQL and complete-source checkpoint revalidation must remove eligibility and block stale effects.');
      limitations.push('An absent withdrawn source cannot be recovered from the admitted pool; erasure enforcement is outside this pure selector.');
      break;
    default: throw new Error('Unknown frozen family');
  }

  const distractors = [];
  if (variant === 2) {
    // Fourteen higher-order, high-overlap but irrelevant records create real rank pressure.
    for (const n of [4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      put(n, l.distractor(query, n), `person-catalogue-${n}`, false);
      distractors.push(sourceId(n));
    }
  }
  put(40, query, 'person-questioner', false);
  return {
    id: `${family}-${lang}-${variant}`, family, language: lang, languageLabel: l.label, variant,
    input: { query, currentSourceId: sourceId(40), currentSpeakerId: 'person-questioner', candidates: candidates.filter(Boolean) },
    groundTruth: {
      targetSourceIds: targets, correctionSourceIds: corrections,
      relevantOlderSourceIds: targets.filter(id => Number(id.split(':')[1]) <= 20),
      recentSourceIds: candidates.filter(Boolean).slice(-20).map(r => r.sourceId),
      lexicalDistractorSourceIds: distractors,
      notAdmitted, outsideCoverage, hostRequirements, limitations,
    },
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const CASES = freeze(FAMILIES.flatMap(family =>
  ['en', 'hi', 'cs'].flatMap(lang => [1, 2].map(variant => buildCase(family, lang, variant)))));

export const CORPUS_METHOD = freeze({
  version: CORPUS_VERSION,
  provenance: 'Entirely invented by an evaluator who did not inspect selector implementation before freeze.',
  cells: '8 families x 3 language forms x 2 cases = 48; language forms share scenarios and are not independent human samples.',
  scoringFrozenBeforeRun: 'NFKC/lowercase Unicode letter-mark-number tokens; unique query-token intersection; positive older scores; descending numeric order ties.',
  capacity: { candidates: 160, mandatoryRecent: 20, optionalOlder: 12, selected: 32, finalTurnsUtf8Bytes: 32768 },
  comparison: 'Recency and lexical_recency receive identical already-admitted inputs and the same final-turn byte ceiling.',
  report: 'Exact per-case source IDs/counts, source/speaker/text/span integrity, recent/correction coverage, distractor counts, bytes/refusals; no model or human quality claim.',
});
