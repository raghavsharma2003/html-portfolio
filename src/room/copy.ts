// EVERY WORD THE ROOM SAYS, IN ONE PLACE, IN EVERY LANGUAGE IT SAYS IT (WS-R24).
//
// src/components/MemoryConsent.tsx's rule, and the reason transfers exactly:
// three surfaces showing one question in three files is how two of them end up
// describing something the third does not do. It is a designated copy module,
// so `scripts/check-copy.mjs` reads every literal in it rather than guessing
// which ones render.
//
// ── WHAT CHANGED, AND WHAT DID NOT ──────────────────────────────────────────
//
// India first, and the Room's chrome must speak the follower's own script — but
// the AI's own replies are not this file's business and never were: they are
// the creator's material and the engine's register (`context/rejected.md` has
// the register measurements for why a written taste is not a spoken line), and
// nothing here reaches `src/engine/persona.ts`. This file only ever held APP
// copy — the questions the app asks, the buttons, the menu — and that is
// exactly the copy a follower who reads Hindi needs in Hindi. So the shape
// below is what changed: one object became a TABLE of that same object, keyed
// by locale, with every key required to exist in every locale
// (`evals/room-locale/run.mjs` checks this against the real export, not a
// hand-counted list). `withName` is unchanged — it splices a name into
// whichever locale's template it is given, and a name is not a word either
// locale translates.
//
// ── WHY THIS IS NOT MemoryConsent.tsx's COPY, REUSED ──────────────────────
//
// The brief was to reuse the student surface's disclosure card and consent
// components wherever they fit. The LEGAL SHAPE is reused wholesale and is the
// reason `memory` below has the structure it has: an unbundled question, asked
// once, in plain words, with what "no" actually means stated where "no" is
// chosen. What is NOT reused is the STRINGS, and refusing to reuse them is the
// point rather than an oversight:
//
//   - MEMORY_COPY is written in Meera's voice about Meera ("Should SHE remember
//     you", "Haan, yaad rakhe"). A Room belongs to a real, named creator, and
//     copy that calls their AI "she" is copy that describes a different
//     product to the person least able to tell.
//   - MEMORY_COPY promises "your chat stays on this phone until you clear it".
//     That is true of Meera, whose transcript is in localStorage. It is FALSE
//     here: declining memory in a Room means the server writes nothing and the
//     conversation is gone when the tab is. Shipping the sentence unchanged
//     would have been a consent screen that lies, which is the one kind of
//     screen that may not.
//
// So the shape is inherited and the sentences are rewritten, and this comment
// is the record of that decision rather than a drift nobody noticed.
//
// ── the copy rules this file is held to, in EVERY locale ───────────────────
//
// Product chrome, never the AI's voice: an app asks for permissions, a person
// does not. No em-dash or en-dash, in either script. Never the word "clone",
// nor its Hindi equivalents (क्लोन/मॉडल/प्रतिकृति) — a follower reads
// "<Name> AI". Every clause checkable against this repo rather than
// aspirational. A read-aloud test in the reader's own language: if it sounds
// like a brochure, it is wrong. Hindi copy here is plain, functional Hindi —
// no Sanskritised register, no Hinglish written in Latin script, numerals as
// digits (`scripts/check-layout.mjs`'s `room:hi` target measures it set in the
// real Devanagari face, `docs/gurukul/DESIGN-LAW.md`'s read-aloud test applied
// in Hindi rather than skipped for it).

/** Name goes in, a sentence comes out. A template rather than a concatenation
 *  at each call site, so the name lands in the same place every time — and the
 *  same function works for every locale, because a name is not translated. */
export const withName = (template: string, name: string) => template.split("{name}").join(name);

/** v1: English and Hindi (Devanagari). Adding a third locale means adding a
 *  third key to `ROOM_COPY_TABLE` below with every key the other two have —
 *  `evals/room-locale/run.mjs` fails the build otherwise, by design. */
export const ROOM_LOCALES = ["en", "hi"] as const;
export type RoomLocale = (typeof ROOM_LOCALES)[number];

/** The language switch itself is not translated: a person who reads only
 *  Hindi still has to be able to find "English" on the way to it, and a person
 *  who reads only English still has to be able to find "हिन्दी". Both words are
 *  shown together, in both locales, for exactly that reason — never a single
 *  word that only names the language you cannot currently read. */
export const ROOM_LANGUAGE_LABELS: Record<RoomLocale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/** WS-R26 (api/_rate-limit.js's `retryAfterSeconds`). Rounded up to whole
 *  minutes (never "in 45 seconds" for a one-minute window - a number small
 *  enough to look like it should have worked reads as a bug report, not an
 *  explanation) and correctly singular at exactly one minute, the one case a
 *  bare `{minutes}` substitution would otherwise read "in 1 minutes". */
export const withRetry = (template: string, retryAfterSeconds: number) => {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return template
    .split("{minutes}")
    .join(String(minutes))
    .split("{s}")
    .join(minutes === 1 ? "" : "s");
};


const EN = {
  /** While the address is resolving. Not a spinner's label: it says what is
   *  happening rather than that something is. */
  loading: "Opening the room",

  /** Every reason a Room cannot answer collapses to one message, because the
   *  server collapses them to one code on purpose. Naming the reason here
   *  would tell a stranger which creators had taken their room down. */
  unavailable: {
    title: "This room is not open",
    body: "The link may be old, or the creator may have paused it. Nothing else went wrong.",
  },

  join: {
    title: "Join {name} AI",
    lede: "Two questions first. They take one tap each and you are never asked again.",
    signIn: "Sign in so it can be you next time.",
    phoneLabel: "Phone number",
    phonePlaceholder: "+91",
    codeLabel: "The 6 digit code",
    sendCode: "Send me a code",
    verify: "Continue",
    google: "Continue with Google",
    resend: "Send it again",
    age: "I am 18 or older.",
    ageWhy: "This room is for adults. A student app with the right protections is a different product.",
    submit: "Start talking",
    working: "One moment",
  },

  /** The memory question. Asked once, on its own, in plain words. */
  memory: {
    title: "Should it remember you?",
    lede:
      "The point of this is that it picks up where you left off. That only works if it keeps a few things.",
    keeps: [
      "What you two talked about, so you never start over.",
      "What you tell it about yourself: your goals, your constraints, the small stuff.",
      "Which topics you have open, so a question three weeks from now still lands.",
    ],
    only:
      "It is kept so it can remember you, and for nothing else. It is never sold and never used for ads.",
    private: "{name} does not read it. No other person who talks to {name} AI can see any of it.",
    undo: "You can take it all back later, from this room, any time.",
    yes: "Yes, remember me",
    no: "Not now",
    noMeans:
      "It will still talk to you. Nothing is stored, so it starts fresh every time you come back, and this conversation is gone when you close the tab.",
  },

  conversation: {
    placeholder: "Ask anything",
    send: "Send",
    thinking: "Typing",
    /** The citation affordance, phrased as the question a person actually
     *  asks. */
    whereFrom: "Where did that come from?",
    /** What the server can honestly answer today: the creator's own material,
     *  by name. Never a passage and never a claim of exactness. */
    citedFrom: "This comes from {name}'s own material.",
    citedNone: "This comes from {name}'s own material.",
    notRemembering:
      "This room is not remembering you. Turn that on any time from the menu.",
  },

  threads: {
    title: "Topics",
    all: "Everything",
    create: "New topic",
    namePlaceholder: "Name it",
    nameHelp: "Fitness, nutrition, whatever you call it. Only you see these.",
    save: "Add",
  },

  quota: {
    /** The end-of-session state. It renders after a turn that WORKED, never
     *  across one, and it states a fact rather than manufacturing urgency. */
    left: "{n} of your {included} free messages left this month.",
    lastOne: "That was your last free message this month.",
    capped: {
      title: "You have used this month's free messages",
      body: "They come back at the start of next month. Everything you have said is still here.",
    },
  },

  /** WS-R19, the paid tier's voice reply. `play`/`playing` label the control
   *  on a reply bubble; `minutesLeft` is the panel's own line, real numbers
   *  from the row, never estimated. */
  voice: {
    play: "Play",
    playing: "Playing",
    minutesLeft: "{used} of {included} voice minutes used this month.",
    freeOnly: "Voice replies are a paid feature.",
    unavailable: "This room's voice is not ready yet.",
  },

  /** The upgrade moment's own action. Every string here is a stated fact
   *  about what is or is not possible right now, never a nudge - the tap
   *  either opens the provider's own payment page or says exactly why it
   *  could not. */
  pay: {
    cta: "Upgrade",
    working: "One moment",
    notConfigured: "Paid support for this room is not turned on yet.",
    priceNotSet: "The creator has not set a price for this room yet.",
    noLink: "A start is already on file, but there is no payment link to open right now.",
    failed: "Could not start that just now. Try again in a moment.",
  },

  /** "Let this count" - a follower's own toggle (WS-R17). One plain sentence
   *  of what it means and that it is revocable, never a nudge to turn it on. */
  pulse: {
    on: "Let this count",
    off: "Counted",
    working: "One moment",
    explain:
      "If you turn this on, this topic can be counted toward what {name} sees people asking about, only after " +
      "five other followers do too, and never your own words. You can turn it back off any time.",
  },

  /** ONE number, and only when it is real. A zero renders nothing rather than
   *  a measurement of nothing. */
  stats: {
    talkedToday: "{n} people talked here today",
    talkedTodayOne: "1 person talked here today",
  },

  menu: {
    title: "Your data",
    download: "Download everything it holds about you",
    downloadNote: "A file with your side of this room, and nothing from anyone else.",
    forget: "Make it forget me",
    forgetNote:
      "Deletes your conversations with {name} AI. Your account and any other room you are in are untouched.",
    forgetConfirm: "Yes, forget me",
    forgetCancel: "Keep it",
    forgetDone: "Done. It does not know you any more.",
    // WS-R27 (migration 090). Shown once, on this same screen, and never
    // again: there is nothing to look a receipt up by later, so this is the
    // only chance to keep a copy. Plain sentence, no claim beyond what the
    // receipt actually is and is not.
    receiptTitle: "Your receipt",
    receiptBody:
      "This proves the forget happened, with a count for everything that was deleted. It does not name you, and it cannot be looked up later, by anyone, including us.",
    receiptSave: "Save receipt",
    close: "Close",
  },

  errors: {
    generic: "That did not go through. Try again.",
    signIn: "Sign in first.",
    stale: "This room was updated. Reload to see what changed.",
    tooLong: "That is longer than one message can be.",
    // WS-R26. Honest, not a captcha, not a silent drop - workstream law #4.
    // `withRetry` fills in `{minutes}`/`{s}` from the server's own
    // `retry_after_seconds`.
    rateLimited: "Too many attempts from this connection. Try again in {minutes} minute{s}.",
  },

  checkins: {
    title: "Check-ins",
    intro: "Pick a check-in and a schedule. It will follow up right in this room, at the time you choose.",
    empty: "This creator has not set up any check-ins yet.",
    daysLabel: "Which days",
    timeLabel: "What time",
    zoneLabel: "Your timezone",
    quietLabel: "Not between",
    quietFromLabel: "From",
    quietToLabel: "To",
    add: "Start this check-in",
    mineTitle: "Your check-ins",
    mineEmpty: "None yet.",
    stop: "Stop",
    stopped: "Stopped",
    close: "Close",
    pushEnable: "Allow check-ins on this phone",
    pushDisable: "Turn off",
    pushOnCopy: "A due check-in will reach this phone even when the room is closed.",
    pushOffCopy: "Turn on notifications so a due check-in reaches this phone even when the room is closed.",
    pushError: "Could not turn that on. Check your browser's notification permission and try again.",
  },

  handoff: {
    title: "Ask {name} directly",
    intro: "You choose exactly what gets sent, you see it before it goes, and only {name} sees your reply.",
    pickIntro: "Pick one or more of your own messages, or write something new below.",
    noteLabel: "Or write something new",
    next: "Review what will be sent",
    confirmIntro: "This is exactly what will be sent, word for word.",
    confirmExplain: "{name} will read this and reply here, in this thread, marked as {name}.",
    send: "Send this",
    back: "Back",
    sentConfirm: "Sent. You will see the reply here when it comes.",
    withdraw: "Take it back",
    sentStatus: "Sent, waiting on a reply.",
    withdrawnStatus: "You took this back.",
    answeredFrom: "From {name}:",
  },
};

/** The same shape as `EN`, in plain, functional Hindi (Devanagari). Written
 *  as shapes and notes were, not lines a brochure would say: short sentences,
 *  digits for numbers, no Sanskritised register and no Latin-script Hinglish
 *  in the chrome (`CLAUDE.md`'s own rule for the OTHER product's persona
 *  applies to app copy for a different reason here — a follower who reads
 *  Hindi is reading a menu, not a companion, and a menu that performs warmth
 *  in a register nobody speaks reads as a translation rather than a product). */
const HI: typeof EN = {
  loading: "रूम खुल रहा है",

  unavailable: {
    title: "यह रूम अभी उपलब्ध नहीं है",
    body: "लिंक पुराना हो सकता है, या क्रिएटर ने इसे रोक दिया हो। और कुछ गलत नहीं हुआ।",
  },

  join: {
    title: "{name} AI से जुड़ें",
    lede: "पहले दो सवाल। हर एक में बस एक टैप लगेगा, और दोबारा नहीं पूछा जाएगा।",
    signIn: "साइन इन करें ताकि अगली बार भी यह आप ही हों।",
    phoneLabel: "फ़ोन नंबर",
    phonePlaceholder: "+91",
    codeLabel: "6 अंकों का कोड",
    sendCode: "मुझे कोड भेजें",
    verify: "जारी रखें",
    google: "Google से जारी रखें",
    resend: "फिर से भेजें",
    age: "मेरी उम्र 18 साल या उससे ज़्यादा है।",
    ageWhy: "यह रूम वयस्कों के लिए है। सही सुरक्षा वाला छात्र ऐप एक अलग उत्पाद है।",
    submit: "बात शुरू करें",
    working: "एक पल",
  },

  memory: {
    title: "क्या यह आपको याद रखे?",
    lede: "इसका मतलब है कि यह वहीं से बात शुरू करे जहां आपने छोड़ी थी। इसके लिए इसे कुछ बातें याद रखनी होंगी।",
    keeps: [
      "आप दोनों ने क्या बात की, ताकि आपको दोबारा शुरुआत न करनी पड़े।",
      "आप अपने बारे में क्या बताते हैं: आपके लक्ष्य, आपकी सीमाएं, छोटी बातें भी।",
      "आपने कौन से विषय खोल रखे हैं, ताकि तीन हफ्ते बाद का सवाल भी सही जगह पहुंचे।",
    ],
    only: "यह सिर्फ इसलिए रखा जाता है ताकि यह आपको याद रख सके, और किसी और काम के लिए नहीं। यह कभी बेचा नहीं जाता और विज्ञापन के लिए इस्तेमाल नहीं होता।",
    private: "{name} इसे नहीं पढ़ते। {name} AI से बात करने वाला कोई और इसमें से कुछ भी नहीं देख सकता।",
    undo: "आप इसे बाद में, इसी रूम से, कभी भी वापस ले सकते हैं।",
    yes: "हां, मुझे याद रखें",
    no: "अभी नहीं",
    noMeans:
      "यह फिर भी आपसे बात करेगा। कुछ भी सेव नहीं होगा, इसलिए हर बार आने पर यह नई शुरुआत होगी, और टैब बंद करते ही यह बातचीत खत्म हो जाएगी।",
  },

  conversation: {
    placeholder: "कुछ भी पूछें",
    send: "भेजें",
    thinking: "लिख रहे हैं",
    whereFrom: "यह जानकारी कहां से आई?",
    citedFrom: "यह {name} की अपनी सामग्री से है।",
    citedNone: "यह {name} की अपनी सामग्री से है।",
    notRemembering: "यह रूम आपको याद नहीं रख रहा। इसे मेन्यू से कभी भी चालू करें।",
  },

  threads: {
    title: "विषय",
    all: "सभी",
    create: "नया विषय",
    namePlaceholder: "नाम दें",
    nameHelp: "फिटनेस, पोषण, जो भी आप कहना चाहें। यह सिर्फ आपको दिखता है।",
    save: "जोड़ें",
  },

  quota: {
    left: "इस महीने आपके {included} में से {n} मुफ़्त संदेश बचे हैं।",
    lastOne: "यह इस महीने का आपका आख़िरी मुफ़्त संदेश था।",
    capped: {
      title: "आपके इस महीने के मुफ़्त संदेश खत्म हो गए",
      body: "यह अगले महीने की शुरुआत में फिर मिलेंगे। आपने जो भी कहा है वह अभी भी यहां है।",
    },
  },

  voice: {
    play: "चलाएं",
    playing: "चल रहा है",
    minutesLeft: "इस महीने {included} में से {used} वॉइस मिनट इस्तेमाल हुए।",
    freeOnly: "वॉइस जवाब एक पेड सुविधा है।",
    unavailable: "इस रूम की वॉइस अभी तैयार नहीं है।",
  },

  pay: {
    cta: "अपग्रेड करें",
    working: "एक पल",
    notConfigured: "इस रूम के लिए पेड सपोर्ट अभी चालू नहीं है।",
    priceNotSet: "क्रिएटर ने इस रूम के लिए अभी कीमत तय नहीं की है।",
    noLink: "एक शुरुआत पहले से दर्ज है, पर अभी खोलने के लिए कोई पेमेंट लिंक नहीं है।",
    failed: "अभी शुरू नहीं हो सका। एक पल बाद फिर कोशिश करें।",
  },

  pulse: {
    on: "इसे गिनने दें",
    off: "गिना गया",
    working: "एक पल",
    explain:
      "अगर आप इसे चालू करते हैं, तो यह विषय गिना जा सकता है कि लोग {name} से क्या पूछ रहे हैं, पर सिर्फ तब जब कम से कम पांच और फॉलोअर भी ऐसा करें, और कभी भी आपके अपने शब्द नहीं। आप इसे कभी भी वापस बंद कर सकते हैं।",
  },

  stats: {
    talkedToday: "आज यहां {n} लोगों ने बात की",
    talkedTodayOne: "आज यहां 1 व्यक्ति ने बात की",
  },

  menu: {
    title: "आपका डेटा",
    download: "इसके पास आपके बारे में जो कुछ है वह डाउनलोड करें",
    downloadNote: "एक फ़ाइल जिसमें इस रूम में आपका हिस्सा है, किसी और का कुछ नहीं।",
    forget: "इसे मुझे भुला दें",
    forgetNote: "{name} AI के साथ आपकी बातचीत मिटा देता है। आपका अकाउंट और आप जिस किसी और रूम में हैं वह अछूता रहता है।",
    // WS-R27 (migration 090), Hindi: the same three sentences, same facts.
    receiptTitle: "आपकी रसीद",
    receiptBody:
      "यह इस बात का प्रमाण है कि भूलना पूरा हुआ, और जो कुछ मिटाया गया उसकी गिनती इसमें है। इसमें आपका नाम नहीं है, और इसे बाद में कोई भी नहीं खोज सकता, हम भी नहीं।",
    receiptSave: "रसीद सहेजें",
    forgetConfirm: "हां, मुझे भुला दें",
    forgetCancel: "रहने दें",
    forgetDone: "हो गया। अब यह आपको नहीं जानता।",
    close: "बंद करें",
  },

  errors: {
    generic: "वह नहीं भेजा जा सका। फिर कोशिश करें।",
    signIn: "पहले साइन इन करें।",
    stale: "यह रूम अपडेट हो गया है। बदलाव देखने के लिए फिर लोड करें।",
    tooLong: "यह एक संदेश में जितना हो सकता है उससे ज़्यादा लंबा है।",
    // WS-R26, Hindi: same fact, minutes as a digit; Hindi needs no plural marker, so {s} is absent.
    rateLimited: "इस कनेक्शन से बहुत ज़्यादा कोशिशें हुईं। {minutes} मिनट बाद फिर कोशिश करें।",
  },

  checkins: {
    title: "चेक-इन",
    intro: "एक चेक-इन और एक समय चुनें। यह इसी रूम में, आपके चुने समय पर फॉलो-अप करेगा।",
    empty: "इस क्रिएटर ने अभी कोई चेक-इन सेट नहीं किया है।",
    daysLabel: "कौन से दिन",
    timeLabel: "कौन सा समय",
    zoneLabel: "आपका टाइमज़ोन",
    quietLabel: "इसके बीच नहीं",
    quietFromLabel: "से",
    quietToLabel: "तक",
    add: "यह चेक-इन शुरू करें",
    mineTitle: "आपके चेक-इन",
    mineEmpty: "अभी कोई नहीं।",
    stop: "रोकें",
    stopped: "रुक गया",
    close: "बंद करें",
    pushEnable: "इस फ़ोन पर चेक-इन की अनुमति दें",
    pushDisable: "बंद करें",
    pushOnCopy: "रूम बंद होने पर भी एक बकाया चेक-इन इस फ़ोन तक पहुंचेगा।",
    pushOffCopy: "नोटिफ़िकेशन चालू करें ताकि रूम बंद होने पर भी बकाया चेक-इन इस फ़ोन तक पहुंचे।",
    pushError: "वह चालू नहीं हो सका। अपने ब्राउज़र की नोटिफ़िकेशन अनुमति जांचें और फिर कोशिश करें।",
  },

  handoff: {
    title: "{name} से सीधे पूछें",
    intro: "आप तय करते हैं कि क्या भेजा जाए, भेजने से पहले आप उसे देखते हैं, और सिर्फ {name} आपका जवाब देखते हैं।",
    pickIntro: "अपने कुछ संदेश चुनें, या नीचे कुछ नया लिखें।",
    noteLabel: "या कुछ नया लिखें",
    next: "क्या भेजा जाएगा देखें",
    confirmIntro: "यह बिल्कुल वही है जो भेजा जाएगा, शब्द दर शब्द।",
    confirmExplain: "{name} इसे पढ़ेंगे और यहीं, इसी थ्रेड में, {name} के नाम से जवाब देंगे।",
    send: "यह भेजें",
    back: "वापस",
    sentConfirm: "भेज दिया। जवाब आने पर आप उसे यहीं देखेंगे।",
    withdraw: "वापस ले लें",
    sentStatus: "भेजा गया, जवाब का इंतज़ार है।",
    withdrawnStatus: "आपने इसे वापस ले लिया।",
    answeredFrom: "{name} की ओर से:",
  },
};

/** The one export components read from. `evals/room-locale/run.mjs` asserts
 *  `Object.keys(ROOM_COPY_TABLE.en)` deep-equals `Object.keys(ROOM_COPY_TABLE.hi)`
 *  at every level, against this REAL export — not a hand-maintained list that
 *  could drift the moment a key is added to one locale and not the other. */
export const ROOM_COPY_TABLE: Record<RoomLocale, typeof EN> = { en: EN, hi: HI };

export type RoomCopy = typeof EN;

/** Anything that is not exactly `"hi"` reads as `"en"` — a Telegram
 *  `language_code` of `"en-US"`, `"mr"`, `"fr"`, an absent value, or garbage
 *  all fall back to the locale this product already ships, never to a thrown
 *  error on someone's very first message. `"hi"`, `"hi-IN"` and any `hi-*`
 *  variant read as Hindi; nothing else does, because a browser or Telegram
 *  reporting a DIFFERENT Indian language (`"mr"`, `"ta"`, ...) has not asked
 *  for Hindi and must not be guessed into it. */
export function normalizeLocale(input: string | null | undefined): RoomLocale {
  const s = String(input || "").trim().toLowerCase();
  return s === "hi" || s.startsWith("hi-") ? "hi" : "en";
}
