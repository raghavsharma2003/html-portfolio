// The Hindi SIGN-IN chunk (WS-R113). Split out of `hiCopy.ts` (the WS-R71
// merge, `context/decisions.md#studio-hindi-table-is-its-own-chunk`) because
// that whole-table chunk, loaded through one `import()`, gated the studio's
// signed-out first Hindi paint on every OTHER panel's Hindi too --
// `creatorPath`, `roomStudio`, the whole enrollment wizard -- none of which a
// visitor who has not signed in yet can ever reach. Measured at 808-918ms
// against an 800ms budget even after WS-R107's `modulepreload`
// (`context/decisions.md#ws-r107-first-hindi-paint-budget-left-at-1000-under-session-contention`);
// the preload made the WHOLE table arrive sooner, but "the whole table" was
// always more than `AuthGate.tsx` needed.
//
// SCOPE: exactly the two sections the signed-out render path reads --
// `authGate` (every string `AuthGate.tsx` renders) and the shell section
// (small on its own; carries `languageGroupLabel`, the `aria-label` the
// sign-in screen's own language switch reads, `AuthGate.tsx`'s only reach
// into a section besides its own). Verified by grep, not assumed: `grep -n "t\\.\\|authCopy\\."
// src/studio/AuthGate.tsx` finds nothing outside `t.authGate.*` and
// `t.shell.languageGroupLabel`. The shell section is carried WHOLE rather
// than split field-by-field -- it is small (11 leaves) and a signed-in Hindi creator
// reads the REST of it (`tabTitle`, `tabPromise`, the Feed/Meet/Share chrome)
// within one render of signing in anyway, so splitting one interface across
// two files for a handful of bytes was not worth the ongoing risk of a field
// added to `ShellCopy` landing in the wrong chunk.
//
// `STUDIO_COPY_TABLE.hi.authGate` and `.shell` THROW, named
// `studio_copy_hi_auth_not_loaded`, until `loadStudioCopyAuth("hi")` (or the
// strictly larger `loadStudioCopy("hi")`) installs this file -- `copy.ts`'s
// own "never English in its place" law, restated per section rather than for
// the whole table. Every OTHER key throws `studio_copy_hi_not_loaded` until
// `hiCopy.ts` (the rest of the table) is ALSO installed; the two throws are
// named differently so a stack trace says which chunk is missing.
//
// Named `hiAuthCopy.ts`, not `hiCopyAuth.ts`: `scripts/check-copy.mjs`'s
// `COPY_FILES` pattern (`/(errorCopy|copy|strings|messages|labels)\.tsx?$/i`)
// treats a file as a whole-file copy table by matching its BASENAME against
// that suffix -- "hiCopyAuth.ts" ends in "Auth.ts" and would silently fall
// out of that rule (every literal here would then be scanned by the
// visible-prop heuristic instead, the wrong one for a data file with no
// JSX), while "hiAuthCopy.ts" ends in "Copy.ts" and is caught by the exact
// same rule `hiCopy.ts` already relies on. No change to
// `scripts/check-copy.mjs` needed or made.
import type { StudioAuthCopy } from "./copy";

export const HI_AUTH: StudioAuthCopy = {
  shell: {
    languageGroupLabel: "हिन्दी / English",
    tabsAriaLabel: "आपका AI, तीन टैब में",
    tabTitle: { feed: "फ़ीड", meet: "मीट", share: "शेयर" },
    tabPromise: {
      feed: "अपनी सामग्री लाएं।",
      meet: "अपने AI से मिलें: सुनें, ठीक करें, देखें यह कितना तैयार है।",
      share: "अपना रूम पब्लिश करें और तय करें कि इसे कहां पहुंचाया जा सकता है।",
    },
    allPanelsLink: "सभी पैनल (पूरी बेंच)",
    oneVideoTitle: "एक वीडियो, लिंक से",
    oneVideoBlurb: "अभी बन रहा प्रवेश का चौथा तरीका।",
    stillLockedTitle: "मीट पर अभी भी लॉक",
    forYou: "{n} आप पर",
    onUsCount: "{n} हम पर",
  },

  // WS-R91: the sign-in screen, read before a session exists.
  authGate: {
    vyaktiHomeAriaLabel: "Vyakti होम",
    safeguardsAriaLabel: "स्टूडियो सुरक्षा उपाय",
    safeguardSelfReplication: "सिर्फ़ खुद का AI",
    safeguardNoPublicVoiceLibrary: "कोई पब्लिक आवाज़ लाइब्रेरी नहीं",
    safeguardAuditableDeletion: "जांचने लायक मिटाना",
    variant: {
      generic: {
        brandTag: "निजी AI लैब",
        eyebrow: "बनावट से ही निजी",
        title: "एक AI जो आपकी अनुमति से शुरू होता है।",
        body: "अपनी सहमति से जांचे गए AI को बनाएं और नियंत्रित करें। हर सोर्स निजी रहता है, हर क्षमता अलग से मंज़ूर होती है, और रद्द करने से आगे का इस्तेमाल रुक जाता है।",
      },
      teacher: {
        brandTag: "गुरुकुल टीचर स्टूडियो",
        eyebrow: "जांचा गया, सहमति वाला, बताया गया",
        title: "एक टीचिंग AI जो आपकी अनुमति से शुरू होता है, और हर छात्र को बताया जाता है।",
        body: "अपनी सहमति से जांचे गए टीचिंग AI को बनाएं और नियंत्रित करें। हर सोर्स निजी रहता है, हर क्षमता अलग से मंज़ूर होती है, रद्द करने से आगे का इस्तेमाल रुक जाता है, और हर सेशन से पहले छात्रों को बताया जाता है कि वे AI से बात कर रहे हैं, आपसे नहीं।",
      },
      test: {
        brandTag: "इंटरनल टेस्ट स्टूडियो",
        title: "अपने सोर्स जोड़ें। फिर अपने AI को टेस्ट करें।",
        body: "अपनी आवाज़, लेखन, वीडियो और संदर्भ के काम के उदाहरण अपलोड करें। फिर ड्राफ़्ट सुनें, उससे बात करें, और उसे ठीक करें।",
      },
    },
    protectedWorkspace: "सुरक्षित वर्कस्पेस",
    signInTitle: "अपना स्टूडियो खोलें",
    checkInboxTitle: "अपना इनबॉक्स देखें",
    emailStepBody: "जिस ईमेल से आप अपना AI मैनेज करना चाहते हैं, उससे साइन इन करें। अगर आप इस डिवाइस पर पहले से साइन इन हैं, तो हम आपको पहचान लेंगे।",
    codeStepBodyTemplate: "हमने {label} पर 6 अंकों का कोड भेजा है।",
    continueWithGoogle: "Google से जारी रखें",
    orUseEmail: "या ईमेल इस्तेमाल करें",
    emailLabel: "ईमेल पता",
    emailPlaceholder: "you@example.com",
    sendingCodeAriaLabel: "साइन-इन कोड भेजा जा रहा है",
    sendingCode: "कोड भेजा जा रहा है",
    continueSecurely: "सुरक्षित रूप से जारी रखें",
    codeLabel: "6 अंकों का कोड",
    verifyingAriaLabel: "कोड जांचा जा रहा है",
    verifying: "जांच हो रही है",
    verifyAndEnter: "जांचें और अंदर जाएं",
    useDifferentEmail: "दूसरा ईमेल इस्तेमाल करें",
    googleUnavailableError: "Google साइन-इन उपलब्ध नहीं है। इसकी जगह अपना ईमेल इस्तेमाल करें।",
    codeMismatchError: "यह कोड मेल नहीं खाया। जांचें और फिर कोशिश करें।",
    genericSendError: "कोड नहीं भेजा जा सका",
    legalNotice: "पहुंच मिलने का मतलब यह नहीं कि आपका AI बनाने की अनुमति मिल गई। किसी भी बायोमेट्रिक प्रोसेसिंग से पहले अलग से रिकॉर्ड की गई सहमति ज़रूरी है।",
  },
};
