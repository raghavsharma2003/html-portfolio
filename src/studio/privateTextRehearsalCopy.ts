import type { StudioLocale } from "../creatorStudio/studioLocalePreference";

type Copy = {
  back: string;
  pageTitle: string;
  pageBody: string;
  profileFirstUse: { title: string; body: string; action: string; opening: string; sourceAction: string };
  stopped: { title: string; purging: string; unavailable: string; removalFailed: string; usage: string; removed: string; removing: string; remove: string };
  errors: {
    browserHandle: string; availability: string; savedMissing: string; savedUnreadable: string;
    actionUnconfirmed: string; answerUnconfirmed: string; clearHandle: string; draftChanged: string;
    draftUnavailable: string;
  };
  result: {
    aria: string; removedTitle: string; answerTitle: string; pendingTitle: string; closed: string;
    blocked: string; pending: string; source: string; profile: string; selectedSource: string;
    selectedDraft: string; adjustPersonality: string; usage: string; requestDetails: string;
    recoveryDetail: string; technicalDetail: string; checking: string; check: string; closing: string;
    cancel: string; remove: string; followUp: string; retrySameQuestion: string; another: string;
  };
  recovery: {
    checkingTitle: string; checkingBody: string; failedTitle: string; failedBody: string;
    loadFailedTitle: string; loadFailedBody: string; tryAgain: string;
  };
  material: {
    aria: string; title: string; subtitle: string; refresh: string; loading: string;
    personalProfile: string; teachingDraft: string; chooseDraft: string; unnamedDraft: string;
    extractedSource: string; chooseSource: string; unavailableSuffix: string; readingDraft: string;
    editDraft: string; createDraft: string; editSource: string; reviewSource: string; sourceText: string; sourceExcerpt: string;
    excerptSummary: (start: number, end: number, total: number) => string;
    subject: string;
  };
  editor: {
    successorTitle: string; detailsTitle: string; successorBody: string; name: string; identity: string;
    subject: string; chooseSubject: string; physics: string; chemistry: string; maths: string;
    incompleteHelp: string; saving: string; save: string; cancel: string;
  };
  question: {
    title: string; followUpContext: string; label: string; before: string; retention: string;
    asking: string; ask: string;
  };
  blocker: { waitingUs: string; needsInput: string; technicalDetail: string; fallbackOwner: string; fallbackPlatform: string };
};

const EN: Copy = {
  back: "Back to your workspace",
  pageTitle: "Test your private draft.",
  pageBody: "Choose saved material, ask once, then review or correct the answer.",
  profileFirstUse: {
    title: "Start with who you are.",
    body: "Add your perspective, style and boundaries. Then return here to try an answer.",
    action: "Set up personality",
    opening: "Opening personality",
    sourceAction: "Add source material",
  },
  stopped: {
    title: "Private draft test is stopped.",
    purging: "Erasure is already underway for this AI.",
    unavailable: "This workspace must be available before a private answer can be requested or read.",
    removalFailed: "Removal could not be confirmed. Retry removing this saved test.",
    usage: "Removing a test does not cancel incurred usage.",
    removed: "This saved test's private payload has been removed.",
    removing: "Removing saved test",
    remove: "Remove saved test",
  },
  errors: {
    browserHandle: "This browser could not save the request handle. No question was sent.",
    availability: "We could not check the saved draft and source. Refresh availability to try the read again.",
    savedMissing: "No saved result was found. Cancel this request before starting a new question.",
    savedUnreadable: "The saved request could not be read. Check its result before asking another question.",
    actionUnconfirmed: "This action could not be confirmed.",
    answerUnconfirmed: "We could not confirm the answer. This request may have started. Check its saved result; no question will be sent again automatically.",
    clearHandle: "Could not clear the saved handle.",
    draftChanged: "The current editable draft changed. Refresh availability and choose it before editing.",
    draftUnavailable: "This saved sheet is unavailable for a private draft. Refresh availability before editing.",
  },
  result: {
    aria: "Saved private test",
    removedTitle: "Private test removed.",
    answerTitle: "Your private text answer",
    pendingTitle: "Check your private request.",
    closed: "This request is closed. Any saved question and answer have been removed.",
    blocked: "This answer is unavailable under the current draft or source permissions.",
    pending: "An answer is not confirmed yet. Checking the saved result does not send another question.",
    source: "Source",
    profile: "Profile",
    selectedSource: "Selected private source",
    selectedDraft: "Selected private draft",
    adjustPersonality: "Adjust personality",
    usage: "Removing a test does not cancel incurred usage.",
    requestDetails: "Request details",
    recoveryDetail: "Recovery detail",
    technicalDetail: "Technical detail",
    checking: "Checking result",
    check: "Check saved result",
    closing: "Closing private request",
    cancel: "Cancel this request",
    remove: "Remove this private test",
    followUp: "Ask a follow-up",
    retrySameQuestion: "Try this question again",
    another: "Prepare another question",
  },
  recovery: {
    checkingTitle: "Checking for your saved private test.",
    checkingBody: "No question will be sent while this check is running.",
    failedTitle: "We could not check for an earlier private test.",
    failedBody: "No new question can be sent until the saved request check succeeds.",
    loadFailedTitle: "We could not load your material.",
    loadFailedBody: "Your saved work has not changed.",
    tryAgain: "Try again",
  },
  material: {
    aria: "Selected material",
    title: "Choose what the answer uses.",
    subtitle: "One draft and one source.",
    refresh: "Refresh availability",
    loading: "Checking saved draft and source",
    personalProfile: "Personal profile",
    teachingDraft: "Teaching draft",
    chooseDraft: "Choose a saved draft",
    unnamedDraft: "Unnamed draft",
    extractedSource: "Extracted source",
    chooseSource: "Choose a saved text source",
    unavailableSuffix: " (unavailable)",
    readingDraft: "Reading draft",
    editDraft: "Edit draft details",
    createDraft: "Create a private draft",
    editSource: "Add or edit source material",
    reviewSource: "Review source",
    sourceText: "Source text",
    sourceExcerpt: "Source excerpt",
    excerptSummary: (start, end, total) => `Showing characters ${start + 1} to ${end} of ${total}. A question can use another matched excerpt from the full source.`,
    subject: "Subject",
  },
  editor: {
    successorTitle: "Create a private draft from this sheet",
    detailsTitle: "Private draft details",
    successorBody: "Saving creates a private draft for testing. It does not publish your changes.",
    name: "Your name",
    identity: "Who you are",
    subject: "Subject",
    chooseSubject: "Choose a subject",
    physics: "Physics",
    chemistry: "Chemistry",
    maths: "Maths",
    incompleteHelp: "You can save an incomplete draft. These three fields are required to ask a private question.",
    saving: "Saving draft",
    save: "Save private draft",
    cancel: "Cancel edit",
  },
  question: {
    title: "Question",
    followUpContext: "Your saved question and answer will be used only as context for this follow-up.",
    label: "Your question",
    before: "Before you ask",
    retention: "Permission lasts 30 days. Saved tests stay until you remove them.",
    asking: "Asking privately",
    ask: "Ask privately",
  },
  blocker: {
    waitingUs: "Waiting on us",
    needsInput: "Needs your input",
    technicalDetail: "Technical detail",
    fallbackOwner: "Review your draft and source, then refresh availability.",
    fallbackPlatform: "We cannot prepare this private test right now. Try again after the service recovers.",
  },
};

const HI: Copy = {
  back: "अपनी जगह पर लौटें",
  pageTitle: "अपने निजी जवाब को आज़माएँ।",
  pageBody: "सेव की हुई सामग्री चुनें, एक सवाल पूछें, फिर जवाब देखें या सुधारें।",
  profileFirstUse: {
    title: "पहले बताएँ कि आप कौन हैं।",
    body: "अपना नज़रिया, अंदाज़ और सीमाएँ जोड़ें। फिर यहाँ लौटकर जवाब आज़माएँ।",
    action: "व्यक्तित्व जोड़ें",
    opening: "व्यक्तित्व खुल रहा है",
    sourceAction: "सामग्री जोड़ें",
  },
  stopped: {
    title: "निजी ड्राफ़्ट टेस्ट रुका हुआ है।",
    purging: "इस AI को मिटाने की प्रक्रिया पहले से चल रही है।",
    unavailable: "निजी जवाब माँगने या पढ़ने से पहले यह वर्कस्पेस उपलब्ध होना चाहिए।",
    removalFailed: "हटाने की पुष्टि नहीं हुई। इस सेव किए गए टेस्ट को फिर हटाएँ।",
    usage: "टेस्ट हटाने से पहले हो चुका उपयोग रद्द नहीं होता।",
    removed: "इस सेव किए गए टेस्ट का निजी डेटा हटा दिया गया है।",
    removing: "सेव किया गया टेस्ट हट रहा है",
    remove: "सेव किया गया टेस्ट हटाएँ",
  },
  errors: {
    browserHandle: "यह ब्राउज़र अनुरोध की पहचान सेव नहीं कर सका। कोई सवाल नहीं भेजा गया।",
    availability: "सेव किए गए ड्राफ़्ट और स्रोत की जाँच नहीं हो सकी। दोबारा पढ़ने के लिए उपलब्धता रीफ़्रेश करें।",
    savedMissing: "सेव किया गया नतीजा नहीं मिला। नया सवाल शुरू करने से पहले यह अनुरोध रद्द करें।",
    savedUnreadable: "सेव किया गया अनुरोध पढ़ा नहीं जा सका। दूसरा सवाल पूछने से पहले इसका नतीजा जाँचें।",
    actionUnconfirmed: "इस कार्रवाई की पुष्टि नहीं हो सकी।",
    answerUnconfirmed: "जवाब की पुष्टि नहीं हो सकी। हो सकता है अनुरोध शुरू हो गया हो। सेव किया गया नतीजा जाँचें। कोई सवाल अपने आप दोबारा नहीं भेजा जाएगा।",
    clearHandle: "सेव किए गए अनुरोध की पहचान हटाई नहीं जा सकी।",
    draftChanged: "मौजूदा ड्राफ़्ट बदल गया है। उपलब्धता रीफ़्रेश करें और उसे दोबारा चुनें।",
    draftUnavailable: "यह सेव की हुई शीट निजी ड्राफ़्ट के लिए उपलब्ध नहीं है। बदलाव करने से पहले उपलब्धता रीफ़्रेश करें।",
  },
  result: {
    aria: "सेव किया गया निजी टेस्ट",
    removedTitle: "निजी टेस्ट हटा दिया गया।",
    answerTitle: "आपका निजी टेक्स्ट जवाब",
    pendingTitle: "अपना निजी अनुरोध जाँचें।",
    closed: "यह अनुरोध बंद है। सेव किया गया सवाल और जवाब हटा दिए गए हैं।",
    blocked: "मौजूदा ड्राफ़्ट या स्रोत की अनुमति के साथ यह जवाब उपलब्ध नहीं है।",
    pending: "अभी जवाब की पुष्टि नहीं हुई है। सेव किया गया नतीजा जाँचने से सवाल दोबारा नहीं भेजा जाता।",
    source: "स्रोत",
    profile: "प्रोफ़ाइल",
    selectedSource: "चुना हुआ निजी स्रोत",
    selectedDraft: "चुना हुआ निजी ड्राफ़्ट",
    adjustPersonality: "व्यक्तित्व बदलें",
    usage: "टेस्ट हटाने से पहले हो चुका उपयोग रद्द नहीं होता।",
    requestDetails: "अनुरोध की जानकारी",
    recoveryDetail: "आगे क्या करें",
    technicalDetail: "तकनीकी जानकारी",
    checking: "नतीजा जाँचा जा रहा है",
    check: "सेव किया गया नतीजा जाँचें",
    closing: "निजी अनुरोध बंद हो रहा है",
    cancel: "यह अनुरोध रद्द करें",
    remove: "यह निजी टेस्ट हटाएँ",
    followUp: "अगला सवाल पूछें",
    retrySameQuestion: "यही सवाल फिर पूछें",
    another: "दूसरा सवाल तैयार करें",
  },
  recovery: {
    checkingTitle: "आपका सेव किया हुआ निजी टेस्ट जाँचा जा रहा है।",
    checkingBody: "जाँच पूरी होने तक कोई सवाल नहीं भेजा जाएगा।",
    failedTitle: "पहले के निजी टेस्ट की जाँच नहीं हो सकी।",
    failedBody: "सेव किए गए अनुरोध की जाँच सफल होने तक नया सवाल नहीं भेजा जा सकता।",
    loadFailedTitle: "आपकी सामग्री लोड नहीं हो सकी।",
    loadFailedBody: "आपके सेव किए हुए काम में कोई बदलाव नहीं हुआ है।",
    tryAgain: "फिर कोशिश करें",
  },
  material: {
    aria: "चुनी हुई सामग्री",
    title: "जवाब के लिए सामग्री चुनें।",
    subtitle: "एक ड्राफ़्ट और एक स्रोत।",
    refresh: "उपलब्धता रीफ़्रेश करें",
    loading: "सेव किया गया ड्राफ़्ट और स्रोत जाँचा जा रहा है",
    personalProfile: "निजी प्रोफ़ाइल",
    teachingDraft: "पढ़ाने का ड्राफ़्ट",
    chooseDraft: "सेव किया गया ड्राफ़्ट चुनें",
    unnamedDraft: "बिना नाम का ड्राफ़्ट",
    extractedSource: "निकाला गया स्रोत",
    chooseSource: "सेव किया गया टेक्स्ट स्रोत चुनें",
    unavailableSuffix: " (उपलब्ध नहीं)",
    readingDraft: "ड्राफ़्ट पढ़ा जा रहा है",
    editDraft: "ड्राफ़्ट की जानकारी बदलें",
    createDraft: "निजी ड्राफ़्ट बनाएँ",
    editSource: "स्रोत सामग्री जोड़ें या बदलें",
    reviewSource: "स्रोत देखें",
    sourceText: "स्रोत का टेक्स्ट",
    sourceExcerpt: "स्रोत का अंश",
    excerptSummary: (start, end, total) => `${total} में से ${start + 1} से ${end} तक के अक्षर दिख रहे हैं। सवाल के अनुसार पूरे स्रोत से कोई दूसरा मिलता हुआ अंश इस्तेमाल हो सकता है।`,
    subject: "विषय",
  },
  editor: {
    successorTitle: "इस शीट से निजी ड्राफ़्ट बनाएँ",
    detailsTitle: "निजी ड्राफ़्ट की जानकारी",
    successorBody: "सेव करने पर टेस्ट के लिए निजी ड्राफ़्ट बनेगा। आपके बदलाव प्रकाशित नहीं होंगे।",
    name: "आपका नाम",
    identity: "आप कौन हैं",
    subject: "विषय",
    chooseSubject: "विषय चुनें",
    physics: "भौतिकी",
    chemistry: "रसायन विज्ञान",
    maths: "गणित",
    incompleteHelp: "आप अधूरा ड्राफ़्ट सेव कर सकते हैं। निजी सवाल पूछने के लिए ये तीनों जानकारी ज़रूरी हैं।",
    saving: "ड्राफ़्ट सेव हो रहा है",
    save: "निजी ड्राफ़्ट सेव करें",
    cancel: "बदलाव रद्द करें",
  },
  question: {
    title: "सवाल",
    followUpContext: "इस अगले सवाल के संदर्भ के लिए केवल आपका सेव किया हुआ सवाल और जवाब इस्तेमाल होगा।",
    label: "आपका सवाल",
    before: "सवाल पूछने से पहले",
    retention: "अनुमति 30 दिनों तक रहती है। सेव किए गए टेस्ट आपके हटाने तक रहते हैं।",
    asking: "निजी तौर पर पूछा जा रहा है",
    ask: "निजी तौर पर पूछें",
  },
  blocker: {
    waitingUs: "हमारी तरफ़ से रुका है",
    needsInput: "आपकी जानकारी चाहिए",
    technicalDetail: "तकनीकी जानकारी",
    fallbackOwner: "अपना ड्राफ़्ट और स्रोत देखें, फिर उपलब्धता रीफ़्रेश करें।",
    fallbackPlatform: "अभी निजी टेस्ट तैयार नहीं हो सकता। सेवा ठीक होने के बाद फिर कोशिश करें।",
  },
};

const BLOCKERS: Record<string, { en: string; hi: string }> = {
  rehearsal_stopped: { en: "Make this workspace available before asking a private question.", hi: "निजी सवाल पूछने से पहले यह वर्कस्पेस उपलब्ध करें।" },
  rehearsal_encryption_unavailable: { en: "Private storage is temporarily unavailable. Try again after the service recovers.", hi: "निजी स्टोरेज अभी उपलब्ध नहीं है। सेवा ठीक होने के बाद फिर कोशिश करें।" },
  private_text_key_unavailable: { en: "Private storage is temporarily unavailable. Try again after the service recovers.", hi: "निजी स्टोरेज अभी उपलब्ध नहीं है। सेवा ठीक होने के बाद फिर कोशिश करें।" },
  rehearsal_select_draft_and_context: { en: "Choose one draft and one text source.", hi: "एक ड्राफ़्ट और एक टेक्स्ट स्रोत चुनें।" },
  rehearsal_selection_required: { en: "Choose one draft and one text source.", hi: "एक ड्राफ़्ट और एक टेक्स्ट स्रोत चुनें।" },
  rehearsal_saved_draft_required: { en: "Choose an available saved draft.", hi: "उपलब्ध सेव किया गया ड्राफ़्ट चुनें।" },
  rehearsal_draft_name_required: { en: "Add your name to the private draft.", hi: "निजी ड्राफ़्ट में अपना नाम जोड़ें।" },
  rehearsal_draft_identityWho_required: { en: "Describe who you are in the private draft.", hi: "निजी ड्राफ़्ट में बताएँ कि आप कौन हैं।" },
  draft_required_fields_missing: { en: "Complete the required private draft details.", hi: "निजी ड्राफ़्ट की ज़रूरी जानकारी पूरी करें।" },
  rehearsal_draft_subjectDomain_required: { en: "Choose a subject for the teaching draft.", hi: "पढ़ाने के ड्राफ़्ट के लिए विषय चुनें।" },
  rehearsal_draft_domain_unsupported: { en: "Choose a supported subject for this teaching draft.", hi: "इस पढ़ाने के ड्राफ़्ट के लिए उपलब्ध विषय चुनें।" },
  rehearsal_owner_text_context_required: { en: "Choose text you own from your Context Locker.", hi: "अपने Context Locker से ऐसा टेक्स्ट चुनें जिसका अधिकार आपके पास है।" },
  rehearsal_context_too_large: { en: "Choose a shorter text source for this private test.", hi: "इस निजी टेस्ट के लिए छोटा टेक्स्ट स्रोत चुनें।" },
  rehearsal_source_unavailable: { en: "The selected source is still processing or is no longer available. Choose another source or refresh.", hi: "चुना हुआ स्रोत अभी तैयार हो रहा है या उपलब्ध नहीं है। दूसरा स्रोत चुनें या रीफ़्रेश करें।" },
  rehearsal_canonical_text_unavailable: { en: "The selected text could not be read. Choose another source or refresh.", hi: "चुना हुआ टेक्स्ट पढ़ा नहीं जा सका। दूसरा स्रोत चुनें या रीफ़्रेश करें।" },
  rehearsal_account_attestation_required: { en: "Complete the account ownership confirmation before using this material.", hi: "यह सामग्री इस्तेमाल करने से पहले खाते के अधिकार की पुष्टि पूरी करें।" },
  rehearsal_permission_unavailable: { en: "The permission for this test is no longer valid. Start a new private question.", hi: "इस टेस्ट की अनुमति अब मान्य नहीं है। नया निजी सवाल शुरू करें।" },
  rehearsal_inputs_changed: { en: "The draft or source changed after this answer was created. Review the current material before asking again.", hi: "यह जवाब बनने के बाद ड्राफ़्ट या स्रोत बदल गया। दोबारा पूछने से पहले मौजूदा सामग्री देखें।" },
  rehearsal_parent_unavailable: { en: "The earlier question can no longer be used for a follow-up. Start a new private question.", hi: "पहला सवाल अब अगले सवाल के संदर्भ में इस्तेमाल नहीं हो सकता। नया निजी सवाल शुरू करें।" },
  rehearsal_authority_unavailable: { en: "Your current material permissions could not be confirmed. Refresh availability.", hi: "मौजूदा सामग्री की अनुमति की पुष्टि नहीं हो सकी। उपलब्धता रीफ़्रेश करें।" },
  rehearsal_read_unavailable: { en: "We could not read the selected material. Refresh availability and try again.", hi: "चुनी हुई सामग्री पढ़ी नहीं जा सकी। उपलब्धता रीफ़्रेश करके फिर कोशिश करें।" },
  rehearsal_engine_unavailable: { en: "The private answer service is temporarily unavailable. Try again later.", hi: "निजी जवाब की सेवा अभी उपलब्ध नहीं है। बाद में फिर कोशिश करें।" },
  rehearsal_azure_unavailable: { en: "The private answer service is temporarily unavailable. Try again later.", hi: "निजी जवाब की सेवा अभी उपलब्ध नहीं है। बाद में फिर कोशिश करें।" },
  rehearsal_budget_unavailable: { en: "Private answers are temporarily paused while usage availability is checked.", hi: "उपयोग की उपलब्धता जाँचते समय निजी जवाब कुछ समय के लिए रुके हैं।" },
  rehearsal_answer_withheld: { en: "The answer did not pass the private response checks. Revise the question or material and try again.", hi: "जवाब निजी प्रतिक्रिया की जाँच में पास नहीं हुआ। सवाल या सामग्री बदलकर फिर कोशिश करें।" },
};

export function privateTextRehearsalCopy(locale: StudioLocale): Copy {
  return locale === "hi" ? HI : EN;
}

export function privateTextBlockerMessage(code: string, responsibility: "owner" | "platform", locale: StudioLocale) {
  return BLOCKERS[code]?.[locale] || (responsibility === "platform" ? privateTextRehearsalCopy(locale).blocker.fallbackPlatform : privateTextRehearsalCopy(locale).blocker.fallbackOwner);
}

export function privateTextFailureMessage(code: string | undefined, locale: StudioLocale) {
  if (!code) return privateTextRehearsalCopy(locale).result.blocked;
  return BLOCKERS[code]?.[locale] || privateTextRehearsalCopy(locale).result.blocked;
}
