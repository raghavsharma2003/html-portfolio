// humanOsCopy.ts — WS-R151. HumanOS's own copy table, English and Hindi, in
// the same inline `{en, hi}` shape `TeacherSheetPublication.tsx` (this
// directory) already uses for its own screen — the lightest registry pattern
// already live in the personal studio, reused rather than a second one
// invented for one new screen. `ws-common.md`'s own words: "the personal
// studio's strings are inline English today, and a brief that adds a screen
// there adds its Hindi through the same registry pattern it names."
//
// Every string here is plain, functional, and survives a read-aloud test —
// no em dash, no en dash (`scripts/check-copy.mjs`); never "clone",
// "replica", "model", "fine-tune"/"train", "weights", "embedding", "LoRA" or
// "genome" (the Rooms vocabulary rule) — "HumanOS" is the one product name
// the owner chose and may appear as a section name.
export type HumanOsLocale = "en" | "hi";

export interface HumanOsCopy {
  eyebrow: string;
  title: string;
  intro: string;
  teacherKindBlock: string;
  loadUnavailable: string;
  saved: string;
  saveUnavailable: string;
  identityHeading: string;
  name: string;
  oneLine: string;
  oneLineNote: string;
  tooLong: string;
  bannedDash: string;
  materialHeading: string;
  materialNote: string;
  who: string;
  whoPlaceholder: string;
  life: string;
  lifePlaceholder: string;
  texture: string;
  texturePlaceholder: string;
  taste: string;
  tastePlaceholder: string;
  curiosity: string;
  curiosityPlaceholder: string;
  valuesHeading: string;
  valuesNote: string;
  valuesPlaceholder: string;
  neverSayHeading: string;
  neverSayNote: string;
  neverSayNone: string;
  neverSayPlaceholder: string;
  talkHeading: string;
  register: string;
  registerFormal: string;
  registerMixed: string;
  registerCasual: string;
  script: string;
  scriptRoman: string;
  scriptDevanagari: string;
  scriptEnglish: string;
  codeSwitch: string;
  savingNote: string;
  saveButton: string;
  savingButton: string;
  add: string;
  remove: string;

  // WS-R178. "Draft it from what I gave" — its own closed block, appended
  // rather than interleaved into the fields above.
  draftHeading: string;
  draftIntro: string;
  draftButton: string;
  draftingButton: string;
  draftError: string;
  draftFromLabel: string;
  draftUseButton: string;
  draftUsedLabel: string;
  draftNothingYet: string;
  draftGapsIntro: string;
}

const EN: HumanOsCopy = {
  eyebrow: "HumanOS",
  title: "Who you are",
  intro: "This is what makes your AI sound like you rather than a generic assistant. Save when you are ready, publish separately when it is complete.",
  teacherKindBlock: "This clone already has a teaching sheet saved from a different setup. Editing here would replace it, so this screen is read only until that is resolved.",
  loadUnavailable: "The saved sheet could not be loaded. Your current edits remain here.",
  saved: "Saved.",
  saveUnavailable: "Saving could not be confirmed. Your edits remain here. Reload to check.",
  identityHeading: "Identity",
  name: "Display name",
  oneLine: "One line about you",
  oneLineNote: "Shown to anyone before they talk to your AI.",
  tooLong: "too long",
  bannedDash: "remove the dash",
  materialHeading: "The five things that make you, you",
  materialNote: "Shapes and notes, never full lines your AI would say out loud.",
  who: "Who you are",
  whoPlaceholder: "a few words on who you are, not a biography",
  life: "Your life, in short",
  lifePlaceholder: "what your days look like, telegraphically",
  texture: "Everyday texture",
  texturePlaceholder: "small habits, routines, the ordinary detail",
  taste: "What you like",
  tastePlaceholder: "topics, interests, taste, as fragments",
  curiosity: "What you are curious about",
  curiosityPlaceholder: "what you would chase down given time",
  valuesHeading: "Your values",
  valuesNote: "Three to seven short items.",
  valuesPlaceholder: "add a value",
  neverSayHeading: "What your AI never says",
  neverSayNote: "At least three, or say there is nothing to add.",
  neverSayNone: "There is nothing I want to rule out",
  neverSayPlaceholder: "add a never-say rule",
  talkHeading: "How you talk",
  register: "Register",
  registerFormal: "Formal",
  registerMixed: "Mixed",
  registerCasual: "Casual",
  script: "Script baseline",
  scriptRoman: "Roman Hinglish",
  scriptDevanagari: "Devanagari",
  scriptEnglish: "English",
  codeSwitch: "How you switch between languages",
  savingNote: "Saving here never publishes your AI. Publish runs the full check separately.",
  saveButton: "Save",
  savingButton: "Saving",
  add: "Add",
  remove: "Remove",

  draftHeading: "Draft it from what I gave",
  draftIntro: "Turn what you already gave your AI, files, links, describe me, the interview, into a first pass at this sheet. Every line shows where it came from. Review before it is saved.",
  draftButton: "Draft from what I gave",
  draftingButton: "Drafting",
  draftError: "Could not draft from your sources. Try again.",
  draftFromLabel: "From what you gave:",
  draftUseButton: "Use this",
  draftUsedLabel: "Added",
  draftNothingYet: "Nothing to draft yet. Give your AI more, a file, a link, describe me, or answer the interview, then try again.",
  draftGapsIntro: "Still needs your own words:",
};

const HI: HumanOsCopy = {
  eyebrow: "ह्यूमनओएस",
  title: "आप कौन हैं",
  intro: "यही आपके AI को आप जैसा बनाता है, एक सामान्य सहायक जैसा नहीं। तैयार होने पर सहेजें, पूरा होने पर अलग से प्रकाशित करें।",
  teacherKindBlock: "इस क्लोन की एक शिक्षण शीट पहले से किसी और सेटअप से सहेजी हुई है। यहां संपादन करने से वह बदल जाएगी, इसलिए यह हल होने तक यह स्क्रीन केवल पढ़ने के लिए है।",
  loadUnavailable: "सहेजी हुई शीट लोड नहीं हो सकी। आपके मौजूदा बदलाव यहां बने हुए हैं।",
  saved: "सहेजा गया।",
  saveUnavailable: "सहेजना पक्का नहीं हो सका। आपके बदलाव यहां बने हुए हैं। जांचने के लिए फिर से लोड करें।",
  identityHeading: "पहचान",
  name: "दिखने वाला नाम",
  oneLine: "आपके बारे में एक पंक्ति",
  oneLineNote: "आपके AI से बात करने से पहले सबको दिखेगी।",
  tooLong: "बहुत लंबी",
  bannedDash: "डैश हटाएं",
  materialHeading: "पांच बातें जो आपको आप बनाती हैं",
  materialNote: "रूपरेखा और नोट, कभी भी पूरी पंक्तियां नहीं जो आपका AI बोले।",
  who: "आप कौन हैं",
  whoPlaceholder: "आप कौन हैं इस पर कुछ शब्द, जीवनी नहीं",
  life: "आपका जीवन, संक्षेप में",
  lifePlaceholder: "आपके दिन कैसे दिखते हैं, संक्षेप में",
  texture: "रोज़मर्रा की बनावट",
  texturePlaceholder: "छोटी आदतें, दिनचर्या, सामान्य विवरण",
  taste: "आपको क्या पसंद है",
  tastePlaceholder: "विषय, रुचियां, पसंद, टुकड़ों में",
  curiosity: "आप किस बारे में जिज्ञासु हैं",
  curiosityPlaceholder: "समय मिलने पर आप क्या खोजते",
  valuesHeading: "आपके मूल्य",
  valuesNote: "तीन से सात छोटी बातें।",
  valuesPlaceholder: "एक मूल्य जोड़ें",
  neverSayHeading: "आपका AI कभी क्या नहीं कहेगा",
  neverSayNote: "कम से कम तीन, या बताएं कि जोड़ने के लिए कुछ नहीं है।",
  neverSayNone: "मैं कुछ भी बाहर नहीं रखना चाहता",
  neverSayPlaceholder: "एक नियम जोड़ें",
  talkHeading: "आप कैसे बात करते हैं",
  register: "लहजा",
  registerFormal: "औपचारिक",
  registerMixed: "मिश्रित",
  registerCasual: "अनौपचारिक",
  script: "लिपि",
  scriptRoman: "रोमन हिंग्लिश",
  scriptDevanagari: "देवनागरी",
  scriptEnglish: "अंग्रेज़ी",
  codeSwitch: "आप भाषाओं के बीच कैसे बदलते हैं",
  savingNote: "यहां सहेजने से आपका AI प्रकाशित नहीं होता। प्रकाशन की पूरी जांच अलग से होती है।",
  saveButton: "सहेजें",
  savingButton: "सहेजा जा रहा है",
  add: "जोड़ें",
  remove: "हटाएं",

  draftHeading: "जो आपने दिया उससे रूपरेखा बनाएं",
  draftIntro: "आपने अपने AI को जो पहले ही दिया है, फाइलें, लिंक, अपने बारे में बताना, इंटरव्यू, उसे इस शीट के पहले मसौदे में बदलें। हर पंक्ति दिखाती है कि वह कहां से आई है। सहेजे जाने से पहले जांच लें।",
  draftButton: "जो दिया उससे रूपरेखा बनाएं",
  draftingButton: "रूपरेखा बनाई जा रही है",
  draftError: "आपके स्रोतों से रूपरेखा नहीं बन सकी। फिर से कोशिश करें।",
  draftFromLabel: "आपने जो दिया उससे:",
  draftUseButton: "इसे इस्तेमाल करें",
  draftUsedLabel: "जोड़ा गया",
  draftNothingYet: "अभी रूपरेखा बनाने के लिए कुछ नहीं है। अपने AI को और दें, एक फाइल, एक लिंक, अपने बारे में बताएं, या इंटरव्यू का जवाब दें, फिर दोबारा कोशिश करें।",
  draftGapsIntro: "अभी भी आपके अपने शब्दों की ज़रूरत है:",
};

export const HUMANOS_COPY: Record<HumanOsLocale, HumanOsCopy> = { en: EN, hi: HI };
