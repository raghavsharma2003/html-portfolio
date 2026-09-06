// The Hindi REST chunk (WS-R139): the sections read only INSIDE the Room's
// five secondary screens once actually opened — the account page's own
// dormancy note, "bring a friend" card, receipts list, readable-export
// button, mandate state and referral-reward line, plus the account page's
// read-only quiet-hours summary. None of these five sections carries a
// string the always-visible top bar or the talk screen itself ever reads —
// `hiTalkCopy.ts`'s own header names every section that DOES and stayed
// there instead.
//
// Split out of `copy.ts`'s own single Hindi table, `hiTalkCopy.ts`'s own
// sibling — see that file's header for the full split reasoning and
// `context/decisions.md#ws-r139-room-secondary-screens-are-lazy-chunks`.
//
// Same shape as `EN`'s own rest sections, in plain, functional Hindi.
import type { RoomRestCopy } from "./copy";

export const HI: RoomRestCopy = {
  dormancy: {
    note: "आपकी आख़िरी विज़िट के {duration} बाद तक रखा जाएगा।",
  },

  referral: {
    title: "किसी दोस्त को लाएं",
    note: "यह लिंक शेयर करें। अगर कोई दोस्त इससे जुड़ता है, तो क्रिएटर को सिर्फ इतना पता चलता है कि एक दोस्त आया - कभी यह नहीं कि कौन।",
    copy: "लिंक कॉपी करें",
    copied: "कॉपी हो गया",
  },

  payReceipt: {
    title: "रसीदें",
    empty: "अभी तक कोई भुगतान नहीं।",
    print: "प्रिंट करें",
    loadError: "आपकी रसीदें लोड नहीं हो सकीं। फिर से कोशिश करें।",
  },

  exportReadable: {
    open: "पढ़ने लायक कॉपी खोलें",
    openNote: "डाउनलोड जैसी ही जानकारी, पढ़ने और प्रिंट करने के लिए तैयार।",
  },

  // WS-R125 (migration 130). See EN's own `subscriptionMandate` block.
  subscriptionMandate: {
    pausedLabel: "आपका भुगतान रुका हुआ है।",
    pausedBody: "अपनी सदस्यता सक्रिय रखने के लिए इसे अपने UPI ऐप में फिर से शुरू करें।",
    haltedLabel: "आपके भुगतान मैनडेट पर ध्यान देना ज़रूरी है।",
    haltedBody: "कई कोशिशों के बाद भी इसे नवीनीकृत नहीं किया जा सका। जारी रखने के लिए अपने UPI ऐप से एक नया मैनडेट शुरू करें।",
    // WS-R132 (migration 135). EN's own comment names why this button now
    // exists.
    cancelledLabel: "आपकी सदस्यता रद्द कर दी गई थी।",
    startNewMandate: "नया मैनडेट शुरू करें",
  },
  referralReward: {
    progress: (n: number, threshold: number) => `अब तक ${threshold} में से ${n} दोस्त जुड़े और उन्होंने भुगतान किया।`,
    granted: (dateLabel: string) => `आपने ${dateLabel} को एक मुफ़्त महीना कमाया - दोस्तों को लाने के लिए धन्यवाद।`,
  },
  quietHours: {
    label: "शांत समय",
    summary: "{zone} में {from} से {to}",
    everyChannelNote: "यह हर उस चैनल पर लागू होता है जिससे यह AI आप तक पहुंच सकता है: पुश, व्हाट्सएप और टेलीग्राम।",
    none: "आपने अभी तक शांत समय नहीं चुना। इसे नीचे सेट करें, या अगली बार चेक-इन शुरू करते समय चुनें।",
    zoneLabel: "आपका टाइमज़ोन",
    fromLabel: "से",
    toLabel: "तक",
    save: "सेव करें",
    clear: "हटाएं",
    saveError: "आपका शांत समय सेव नहीं हो सका। फिर कोशिश करें।",
    windowInvalid: "ऐसा 'से' और 'तक' समय चुनें जो एक जैसे न हों।",
    timezoneInvalid: "यह असली टाइमज़ोन जैसा नहीं लगता।",
  },

  // WS-R137 (migration 136), moved here at the merge from copy.ts's Hindi table, which WS-R139 split into hiTalkCopy.ts and this file.
  monthNote: {
    heading: "आपका मासिक नोट",
    title: (monthLabel: string) => `आपका महीना, ${monthLabel}`,
    turns: (n: number, days: number) => `${days} दिनों में ${n} संदेश।`,
    streak: (n: number) => `${n} दिनों की लगातार श्रृंखला।`,
    threads: (n: number) => `${n} बातचीत जिन पर आप फिर लौटे।`,
    checkins: (n: number) => `${n} चेक-इन पूरे हुए।`,
    remembered: (n: number) => `${n} बातें जो आपने याद रखने को कहा।`,
    empty: "अभी तक कोई मासिक नोट नहीं - यहां अपने पहले पूरे महीने के बाद देखें।",
  },
};
