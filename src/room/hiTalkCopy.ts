// The Hindi TALK chunk (WS-R139) — every section a follower reads on the way
// INTO a talk: the join/taste screens, the memory question, the conversation
// itself, the always-visible top bar (including the button LABELS that open
// the five secondary screens — `account.open`, `checkins.title`,
// `handoff.title`, `subscription.title`, `menu.title` — and the
// `settingsReminder` banner the talk screen itself can show), and the "what
// this AI knows about you" link (`about.linkLabel`) shown on the join screen
// before a follower ever signs in.
//
// Split out of `copy.ts`'s own single Hindi table (WS-R24 through WS-R130) so
// Vite emits it as its OWN chunk, loaded by `loadRoomTalkCopy`/`loadRoomCopy`
// (`copy.ts`) rather than shipped inside the Room's main bundle for every
// English follower who never reads a word of it —
// `context/decisions.md#ws-r139-room-secondary-screens-are-lazy-chunks` has
// the measurement this split is built against, `#studio-hindi-table-is-its-
// own-chunk`'s own reasoning restated for the Room.
//
// `hiCopy.ts`, this file's own sibling, carries the REST of the table: the
// sections read only INSIDE the five secondary screens once actually opened
// (`dormancy`, `referral`, `payReceipt`, `exportReadable`,
// `subscriptionMandate`, `referralReward`, `quietHours`) — never surfaced in
// the always-visible chrome this file covers.
//
// Same shape as `EN`'s own talk sections, in plain, functional Hindi
// (Devanagari): short sentences, digits for numbers, no Sanskritised
// register and no Latin-script Hinglish in the chrome — `copy.ts`'s own
// header states the full rule, restated once per Hindi file by
// `scripts/check-copy.mjs`'s own `COPY_FILES` convention (`hiTalkCopy.ts`
// ends in "Copy.ts").
import type { RoomTalkCopy } from "./copy";

export const HI_TALK: RoomTalkCopy = {
  loading: "रूम खुल रहा है",

  unavailable: {
    title: "यह रूम अभी उपलब्ध नहीं है",
    body: "लिंक पुराना हो सकता है, या क्रिएटर ने इसे रोक दिया हो। और कुछ गलत नहीं हुआ।",
  },

  offline: {
    title: "आप ऑफ़लाइन हैं",
    body: "बात करने के लिए इस रूम को इंटरनेट चाहिए। दोबारा जुड़ते ही यह वहीं से शुरू होगा जहां आपने छोड़ा था।",
    retry: "फिर कोशिश करें",
  },

  install: {
    title: "{name} AI को अपनी होम स्क्रीन पर जोड़ें",
    body: "इसे सीधे ऐप की तरह खोलें, अपने फ़ोन से। दोबारा टैब ढूंढने की ज़रूरत नहीं।",
    cta: "होम स्क्रीन पर जोड़ें",
    dismiss: "अभी नहीं",
    iosTitle: "{name} AI को अपनी होम स्क्रीन पर जोड़ें",
    iosBody: "शेयर आइकन दबाएं, फिर \"होम स्क्रीन पर जोड़ें\" चुनें।",
    iosDismiss: "ठीक है",
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

  taste: {
    lede: "साइन इन करने से पहले {name} AI से एक सवाल पूछें। यहां कही बात रखी नहीं जाती।",
    placeholder: "कुछ पूछें",
    send: "भेजें",
    thinking: "लिख रहे हैं",
    join: "बात जारी रखने के लिए जुड़ें",
    turnsLeftOne: "जुड़ने से पहले एक और सवाल बचा है।",
    turnsLeft: "जुड़ने से पहले {n} और सवाल बचे हैं।",
    spent: "आज के लिए तीन सवाल हो गए। बात जारी रखने के लिए जुड़ें।",
    rateLimited: "इस कनेक्शन से आज के लिए इतने सवाल काफ़ी हैं। बात जारी रखने के लिए जुड़ें।",
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

  flag: {
    buttonLabel: "फ़्लैग करें",
    sheetTitle: "इस जवाब में क्या गलत है?",
    reasons: {
      wrong: "यह गलत है",
      harmful: "यह हानिकारक है",
      not_them: "यह उनकी तरह नहीं लगता",
      other: "कुछ और",
    },
    cancel: "रद्द करें",
    submitting: "फ़्लैग किया जा रहा है...",
    done: "फ़्लैग हो गया। क्रिएटर की समीक्षा में भेज दिया गया है।",
    alreadyFlagged: "आपने यह जवाब पहले ही फ़्लैग कर दिया है।",
    error: "फ़्लैग भेजा नहीं जा सका। दोबारा कोशिश करें।",
    withdraw: "यह फ़्लैग वापस लें",
    withdrawing: "वापस लिया जा रहा है...",
    withdrawn: "फ़्लैग वापस ले लिया गया।",
    accountTitle: "आपने क्या फ़्लैग किया है",
    accountEmpty: "आपने इस रूम में कुछ भी फ़्लैग नहीं किया है।",
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
    mandateNote:
      "इससे {price} महीने का UPI Autopay मैनडेट शुरू होता है। पहला भुगतान आज होता है, उसके बाद हर महीने वही राशि " +
      "अपने आप कट जाती है। आप इसे कभी भी अपने UPI ऐप से रोक सकते हैं, और अपने UPI ऐप से या यहां से रद्द कर सकते हैं।",
    mandateNoteNoPrice:
      "इससे एक UPI Autopay मैनडेट शुरू होता है। पहला भुगतान आज होता है, उसके बाद हर महीने वही राशि अपने आप कट जाती है। " +
      "आप इसे कभी भी अपने UPI ऐप से रोक सकते हैं, और अपने UPI ऐप से या यहां से रद्द कर सकते हैं।",
  },

  subscription: {
    title: "आपकी सदस्यता",
    open: "मैनेज करें",
    tierFree: "आप मुफ़्त प्लान पर हैं।",
    tierPaid: "आप एक पेड फॉलोअर हैं।",
    renewsOn: "{date} को {price} में नवीनीकृत होगी।",
    renewsOnNoPrice: "{date} को नवीनीकृत होगी।",
    willNotRenew: "{date} के बाद नवीनीकृत नहीं होगी। तब तक बात जारी रख सकते हैं।",
    cancel: "रद्द करें",
    cancelConfirm: "नवीनीकरण रोकें? ऊपर दी गई तारीख तक बात जारी रख सकते हैं।",
    cancelYes: "हां, रोक दें",
    cancelNo: "रहने दें",
    cancelWorking: "एक पल",
    cancelDone: "हो गया। यह नवीनीकृत नहीं होगी।",
    cancelFailed: "अभी नहीं हो सका। एक पल बाद फिर कोशिश करें।",
    close: "बंद करें",
  },

  offer: {
    title: "यह एक असली बातचीत जैसा लगा",
    body: "{name} AI से पेड फॉलोअर के तौर पर बात जारी रखें, {price} प्रति महीना।",
    bodyNoPrice: "{name} AI से पेड फॉलोअर के तौर पर बात जारी रखें।",
    continueFree: "मुफ़्त जारी रखें",
    subscribe: "सब्सक्राइब करें",
  },

  capOffer: {
    title: "इंतज़ार छोड़ें",
    body: "सब्सक्राइब करें और अभी {name} AI से बात जारी रखें, {price} प्रति महीना।",
    bodyNoPrice: "सब्सक्राइब करें और अभी {name} AI से बात जारी रखें।",
    continue: "अगले महीने जारी रखें",
    subscribe: "सब्सक्राइब करें",
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

  share: {
    button: "शेयर करें",
    copied: "लिंक कॉपी हो गया।",
  },

  menu: {
    title: "आपका डेटा",
    download: "इसके पास आपके बारे में जो कुछ है वह डाउनलोड करें",
    downloadNote: "एक फ़ाइल जिसमें इस रूम में आपका हिस्सा है, किसी और का कुछ नहीं।",
    forget: "इसे मुझे भुला दें",
    forgetNote: "{name} AI के साथ आपकी बातचीत मिटा देता है। आपका अकाउंट और आप जिस किसी और रूम में हैं वह अछूता रहता है।",
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
    rateLimited: "इस कनेक्शन से बहुत ज़्यादा कोशिशें हुईं। {minutes} मिनट बाद फिर कोशिश करें।",
  },

  account: {
    open: "आपकी सेटिंग्स",
    title: "आपकी सेटिंग्स",
    disclosureTitle: "यह रूम क्या है",
    memoryTitle: "याददाश्त",
    memoryOn: "यह आपको याद रखता है।",
    memoryOff: "यह आपको याद नहीं रखता।",
    memoryEnable: "मुझे याद रखें",
    memoryDisable: "मुझे याद रखना बंद करें",
    localeTitle: "भाषा",
    channelsTitle: "चेक-इन",
    channelsNote: "बकाया चेक-इन आप तक कहां पहुंच सकता है।",
    subscriptionTitle: "सब्सक्रिप्शन",
    subscriptionFree: "आप मुफ़्त प्लान पर हैं।",
    subscriptionPrice: "{price} प्रति महीना।",
    subscriptionRenews: "{date} को नवीनीकरण होगा।",
    subscriptionNoCancel: "यहां से रद्द करना अभी उपलब्ध नहीं है। रद्द करने के लिए क्रिएटर से संपर्क करें।",
    subscriptionStates: {
      created: "आपका सब्सक्रिप्शन अभी पुष्ट नहीं हुआ है।",
      authenticated: "आपका सब्सक्रिप्शन सेट हो रहा है।",
      active: "आप एक पेड फॉलोअर हैं।",
      paused: "आपका सब्सक्रिप्शन रोका गया है। अगर आपने इसे अपने UPI ऐप से रोका है, तो पेड फॉलोअर बने रहने के लिए वहीं से इसे फिर शुरू करें।",
      halted: "आपका पिछला भुगतान नहीं हो पाया। अपना UPI ऐप जांचें, या अगर यह बार-बार हो रहा है तो क्रिएटर से संपर्क करें।",
      cancelled: "आपका सब्सक्रिप्शन खत्म हो गया है।",
      expired: "आपका सब्सक्रिप्शन खत्म हो गया है।",
    },
    dataTitle: "आपका डेटा",
    close: "बंद करें",
  },

  settingsReminder: {
    note: "आपने {date} से अपनी सेटिंग्स नहीं देखीं।",
    review: "अपनी सेटिंग्स देखें",
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
    waTitle: "व्हाट्सएप पर चेक-इन",
    waPhoneLabel: "व्हाट्सएप नंबर",
    waPhonePlaceholder: "+91XXXXXXXXXX",
    waSave: "सहेजें",
    waDisable: "बंद करें",
    waOnCopy: "चेक-इन व्हाट्सएप पर {phone} को जाते हैं।",
    waOffCopy: "एक नंबर जोड़ें, बकाया चेक-इन व्हाट्सएप पर भी पहुंचेगा।",
    waError: "वह नहीं भेजा जा सका। नंबर जांचें और फिर कोशिश करें।",
    waPhoneInvalid: "देश कोड सहित नंबर डालें, जैसे +91XXXXXXXXXX।",
    tgTitle: "टेलीग्राम पर चेक-इन",
    tgOnCopy: "चेक-इन टेलीग्राम पर वहीं पहुंचते हैं जहां आप पहले से बात करते हैं।",
    tgOffCopy: "इसे चालू करें, बकाया चेक-इन टेलीग्राम पर भी पहुंचेगा।",
    tgStoppedCopy: "टेलीग्राम ने इस बॉट से संदेश लेना बंद कर दिया। ठीक होने पर इसे फिर चालू करें।",
    tgEnable: "चालू करें",
    tgDisable: "बंद करें",
    tgError: "वह नहीं भेजा जा सका। फिर कोशिश करें।",
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

  about: {
    linkLabel: "यह AI आपके बारे में क्या जानता है",
  },
};
