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


/** WS-R30. `offer.body`'s `{price}` placeholder - the same `.split().join()`
 *  shape as `withName`, composable with it since neither cares what order it
 *  runs in. `priceLabel` is already formatted ("₹299") by the caller. */
export const withPrice = (template: string, priceLabel: string) => template.split("{price}").join(priceLabel);

/** WS-R37. `subscription.renewsOn`'s `{date}` placeholder - `withPrice`'s own
 *  shape, composable with it and with `withName`. `dateLabel` is already
 *  formatted ("12 Sep 2026") by the caller. */
export const withDate = (template: string, dateLabel: string) => template.split("{date}").join(dateLabel);

/** WS-R75 (migration 119). `dormancy.note`'s `{duration}` placeholder,
 *  `withDate`'s own shape. `durationLabel` is already formatted by
 *  `dormancyDurationLabel` below. */
export const withDuration = (template: string, durationLabel: string) =>
  template.split("{duration}").join(durationLabel);

/**
 * A whole number of days, rendered as whole years or whole months where
 * the number divides evenly, and as days otherwise - never the raw number
 * of days when a rounder word says the same thing ("a year", never "365
 * days"). `days` is always >= 180 here (migration 119's own floor) or the
 * caller does not render this sentence at all.
 */
export function dormancyDurationLabel(days: number, locale: RoomLocale): string {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n % 365 === 0) {
    const years = n / 365;
    if (locale === "hi") return years === 1 ? "एक साल" : `${years} साल`;
    return years === 1 ? "a year" : `${years} years`;
  }
  if (n % 30 === 0) {
    const months = n / 30;
    if (locale === "hi") return `${months} महीने`;
    return `${months} months`;
  }
  return locale === "hi" ? `${n} दिन` : `${n} days`;
}

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

  /** WS-R59. Distinct from `unavailable` above on purpose: that message is
   *  deliberately vague so a stranger can never learn which creators took
   *  their room down (`unavailable`'s own comment), but that same vagueness
   *  would be actively misleading here — telling a follower "the link may be
   *  old" when their own connection just dropped is a false diagnosis, not a
   *  careful one. Shown only when the initial open fails AND the browser
   *  itself reports no connection (`RoomApp.tsx`'s own check), never for any
   *  other kind of failure. */
  offline: {
    title: "You are offline",
    body: "This room needs the internet to talk. Reconnect and it will pick up right where you left it.",
    retry: "Try again",
  },

  /** WS-R59. The install card, shown from the SECOND visit on
   *  (`installPrompt.ts`'s own rule) — never a nag, and dismissed once means
   *  quiet for 30 days. `ios*` renders as plain instructions rather than a
   *  button, because Safari never fires the event this card's real button
   *  needs (`installPrompt.ts`'s own comment on why). */
  install: {
    title: "Add {name} AI to your home screen",
    body: "Open it like an app, straight from your phone. No browser tab to find again.",
    cta: "Add to home screen",
    dismiss: "Not now",
    iosTitle: "Add {name} AI to your home screen",
    iosBody: "Tap the share icon, then \"Add to Home Screen\".",
    iosDismiss: "Got it",
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

  /** WS-R53. The taste: three questions, answered by the creator's AI, from
   *  their own material alone, before the sign-in wall - `join` above is
   *  what a stranger reaches once these run out or they tap `join` early.
   *  Never a promise of what happens after joining (that promise is
   *  `join.lede`'s own job) - these words describe only what THIS screen
   *  is. */
  taste: {
    lede: "Ask {name} AI a question before you sign in. Nothing you say here is kept.",
    placeholder: "Ask something",
    send: "Send",
    thinking: "Typing",
    join: "Join to keep talking",
    turnsLeftOne: "One more question before you join.",
    turnsLeft: "{n} more questions before you join.",
    spent: "That is three for today. Join to keep talking.",
    rateLimited: "That is enough taste questions from this connection for today. Join to keep talking.",
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

  // WS-R67 (migration 116). "Flag this" - a follower's own way to say a
  // reply was wrong or hurtful, without leaving. Never asks WHY beyond a
  // closed reason: `flag.reasons`'s four keys are api/_room-surface.js's
  // `FLAG_REASONS`, verbatim.
  flag: {
    buttonLabel: "Flag this",
    sheetTitle: "What's wrong with this reply?",
    reasons: {
      wrong: "It's wrong",
      harmful: "It's harmful",
      not_them: "Doesn't sound like them",
      other: "Something else",
    },
    cancel: "Cancel",
    submitting: "Flagging...",
    done: "Flagged. Sent to the creator's review.",
    alreadyFlagged: "You already flagged this reply.",
    error: "That flag could not be sent. Try again.",
    withdraw: "Withdraw this flag",
    withdrawing: "Withdrawing...",
    withdrawn: "Flag withdrawn.",
    accountTitle: "What you have flagged",
    accountEmpty: "You have not flagged anything in this room.",
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
    // WS-R69. What tapping the subscribe button actually starts, before it
    // starts it: a UPI Autopay mandate, the amount, when the first payment
    // happens, and how to stop it, in a person's own words. `{price}` is
    // filled in with `withPrice` wherever a price is already on hand
    // (`capOffer`/`offer`'s own cards); `mandateNoteNoPrice` is the honest
    // fallback used everywhere a price was never wired to the render point.
    mandateNote:
      "This starts a UPI Autopay mandate for {price} a month. The first payment happens today, then the same amount " +
      "is taken automatically each month after. You can pause it from your UPI app any time, and cancel it from your " +
      "UPI app or from here.",
    mandateNoteNoPrice:
      "This starts a UPI Autopay mandate. The first payment happens today, then the same amount is taken " +
      "automatically each month after. You can pause it from your UPI app any time, and cancel it from your UPI app " +
      "or from here.",
  },

  /** WS-R37 (migration 099). The subscription panel: what the state is, one
   *  control. `renewsOn`/`renewsOnNoPrice` fill `{date}`/`{price}` with
   *  `withDate`/`withPrice` - one stated fact, never a countdown or a
   *  discount (`docs/gurukul/DESIGN-LAW.md`). `willNotRenew` is shown
   *  instead the moment `cancel_at_period_end` is true - access continues
   *  until `{date}`, so this is a fact about what happens NEXT, not a
   *  warning. */
  subscription: {
    title: "Your subscription",
    open: "Manage",
    tierFree: "You are on the free plan.",
    tierPaid: "You are a paid follower.",
    renewsOn: "Renews on {date} for {price}.",
    renewsOnNoPrice: "Renews on {date}.",
    willNotRenew: "Will not renew after {date}. You can keep talking until then.",
    cancel: "Cancel",
    cancelConfirm: "Stop the renewal? You can keep talking until the date above.",
    cancelYes: "Yes, stop it",
    cancelNo: "Keep it",
    cancelWorking: "One moment",
    cancelDone: "Done. It will not renew.",
    cancelFailed: "Could not do that just now. Try again in a moment.",
    close: "Close",
  },

  /** WS-R30 (migration 093). Shown under the last reply of a session that
   *  worked, never across one - `quota.left`'s own placement one block up.
   *  `price` is filled in only when the creator has set one; `bodyNoPrice`
   *  is the honest fallback. No countdown, no scarcity - a stated fact about
   *  what the room can do, exactly `pay`'s own rule above. */
  offer: {
    title: "That felt like a real conversation",
    body: "Keep talking to {name} AI as a paid follower, {price} a month.",
    bodyNoPrice: "Keep talking to {name} AI as a paid follower.",
    continueFree: "Continue free",
    subscribe: "Subscribe",
  },

  /** WS-R30 (migration 093), the OTHER moment the offer belongs: under the
   *  existing capped screen, never replacing its sentence. Same facts as
   *  `offer` above, different button because the state is different: a
   *  capped follower is not choosing to keep a conversation going, they are
   *  choosing whether to wait for next month or not. No countdown, no
   *  scarcity - `offer`'s own rule above, restated for this moment. */
  capOffer: {
    title: "Skip the wait",
    body: "Subscribe and keep talking to {name} AI right now, {price} a month.",
    bodyNoPrice: "Subscribe and keep talking to {name} AI right now.",
    continue: "Continue next month",
    subscribe: "Subscribe",
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

  /** WS-R40. `navigator.share` where the browser has it; a copy-to-clipboard
   *  confirmation otherwise (`RoomApp.tsx`'s own fallback). Neither string
   *  names the mechanism — a follower reads what happened, not which API ran. */
  share: {
    button: "Share",
    copied: "Link copied.",
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

  /** WS-R39 (migration 101). One screen: everything a follower can decide
   *  about themselves. Every string here describes something this file's
   *  siblings already do (memory consent is `join`'s own answer, changed
   *  again; channels are the same three controls `checkins` above already
   *  names; the receipt sentence is `menu`'s own, not repeated here). */
  account: {
    open: "Your settings",
    title: "Your settings",
    disclosureTitle: "What this room is",
    memoryTitle: "Memory",
    memoryOn: "It remembers you.",
    memoryOff: "It does not remember you.",
    memoryEnable: "Remember me",
    memoryDisable: "Stop remembering me",
    localeTitle: "Language",
    channelsTitle: "Check-ins",
    channelsNote: "Where a due check-in can reach you.",
    subscriptionTitle: "Subscription",
    subscriptionFree: "You are on the free plan.",
    subscriptionPrice: "{price} a month.",
    subscriptionRenews: "Renews {date}.",
    // WS-R37's cancel op is not always in this tree. Shown only when there is
    // no way to act on the subscription from here - never a claim that one is
    // coming.
    subscriptionNoCancel: "Cancelling from here is not available yet. Contact the creator to cancel.",
    // WS-R69. `paused` and `halted` are the SAME stored database value
    // (Razorpay's own mandate can be paused by the follower's own UPI app,
    // or halted when an auto-charge's retries run out - `api/_payments.js`'s
    // `pausedOrHalted` tells them apart from the ledger, never the column),
    // so this is the one place the honest difference has to live in words.
    subscriptionStates: {
      created: "Your subscription has not been confirmed yet.",
      authenticated: "Your subscription is being set up.",
      active: "You are a paid follower.",
      paused: "Your subscription is paused. If you paused it from your UPI app, resume it there to keep talking as a paid follower.",
      halted: "Your last payment did not go through. Check your UPI app, or contact the creator if it keeps failing.",
      cancelled: "Your subscription has ended.",
      expired: "Your subscription has ended.",
    },
    dataTitle: "Your data",
    close: "Close",
  },

  /** WS-R39: the Room's own quarterly nudge - a plain sentence, never a nag,
   *  shown only once `{date}` is 90 days old or more (`AccountPage.tsx`'s own
   *  pure function decides when, this file only holds the words). */
  settingsReminder: {
    note: "You have not looked at your settings since {date}.",
    review: "Review your settings",
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
    // WS-R29 (migration 092). `waOnCopy` carries `{phone}`, the masked number
    // the server already returned — never the raw digits, and never
    // constructed client side.
    waTitle: "Check-ins on WhatsApp",
    waPhoneLabel: "WhatsApp number",
    waPhonePlaceholder: "+91XXXXXXXXXX",
    waSave: "Save",
    waDisable: "Turn off",
    waOnCopy: "Check-ins go to {phone} on WhatsApp.",
    waOffCopy: "Add a number and a due check-in reaches you on WhatsApp too.",
    waError: "That did not go through. Check the number and try again.",
    waPhoneInvalid: "Enter the number with a country code, like +91XXXXXXXXXX.",
    // WS-R34 (migration 096). Shown only when the panel already knows this
    // follower joined via Telegram — there is no destination to type in,
    // only a toggle.
    tgTitle: "Check-ins on Telegram",
    tgOnCopy: "Check-ins reach you on Telegram, right where you already talk.",
    tgOffCopy: "Turn this on and a due check-in reaches you on Telegram too.",
    tgStoppedCopy: "Telegram stopped accepting messages from this bot. Turn it back on once that is fixed.",
    tgEnable: "Turn on",
    tgDisable: "Turn off",
    tgError: "That did not go through. Try again.",
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

  /** WS-R75 (migration 119). One sentence, only when the Room has a policy
   *  set (`AccountPage.tsx` renders nothing when `dormancy_days` is null).
   *  `{duration}` is filled by `dormancyDurationLabel` below, never a raw
   *  day count - "a year", never "365 days". */
  dormancy: {
    note: "Kept until {duration} after your last visit.",
  },

  /** WS-R86 (migration 123). "Bring a friend" - the account page's own
   *  referral card, rendered right under the disclosure (this workstream's
   *  own law 3). `url` itself is never copy - it is server data
   *  (`roomReferralLink`, api/_room-surface.js's own op), read at render
   *  time, never a template string this file could drift from the real
   *  hash shape. A failed load or copy falls back to `errors.generic`
   *  above, this file's own existing honest-failure sentence, never a new
   *  one this workstream would have to keep in sync with it. */
  referral: {
    title: "Bring a friend",
    note: "Share this link. If a friend joins through it, the creator only sees that a friend was brought in - never who.",
    copy: "Copy link",
    copied: "Copied",
  },

  /** WS-R100 (migration 126). The follower's own receipts, on the account
   *  page's subscription panel - a list of past payments, each one printable.
   *  The rendered receipt itself (the number, the GST lines, the platform's
   *  legal identity) is server text, api/_receipt.js's own header, never
   *  duplicated here - this section is only the app CHROME around it: the
   *  heading, the empty state, the print action. */
  payReceipt: {
    title: "Receipts",
    empty: "No payments yet.",
    print: "Print",
    loadError: "Could not load your receipts. Try again.",
  },

  /** WS-R97. The link out to `/r/<slug>/about`, the follower's transparency
   *  page - `api/_room-about.js`'s own server rendered page, never fetched
   *  or embedded here. This is the ONLY thing this file says about that
   *  page: a label for the link, on the account page and the join screen -
   *  the page's own words live server side (two runtimes, no shared
   *  boundary to cross, this file's own header explains why). */
  about: {
    linkLabel: "What this AI knows about you",
  },

  /** WS-R108. The account page's second export control, next to
   *  `menu.download`: the same data, laid out to read rather than to
   *  parse - `api/_room-export-readable.js` builds the page server side,
   *  this file only ever names the button. Busy state reuses `pay.working`
   *  (`menu.download`'s own precedent) rather than a new key. */
  exportReadable: {
    open: "Open a readable copy",
    openNote: "The same information as the download, laid out to read and print.",
  },

  /** WS-R125 (migration 130). The mandate's own state, shown inside
   *  `subscription` above the moment `state` is `'paused'` (which stays the
   *  SAME stored value for both a customer's own UPI-app pause and a bank's
   *  retry ladder giving up - `pausedOrHalted`'s own header, api/_payments.js
   *  - so `mandate_state` on the client's own subscription object is what
   *  picks the sentence, `roomPayApi.ts`'s own `RoomSubscriptionState.state`
   *  already carrying the identical 'halted' overlay). A NEW top-level
   *  section, never spliced into `subscription` above, per this wave's own
   *  append-only rule for copy files. Only `paused` names a working action
   *  (resume it yourself, in your own UPI app - Razorpay's own FAQ, fetched
   *  2026-09-05: "For UPI Subscriptions, you cannot resume a Subscription
   *  paused by your customer. If your customer pauses a Subscription, only
   *  they can resume it."). `halted`/`cancelled` DO name a working action as
   *  of WS-R132 (migration 135, see `cancelledLabel`/`startNewMandate`
   *  below): `startSubscription` now closes the dead row and starts a
   *  genuinely fresh one, closing the gap named in
   *  (`context/rejected.md#ws-r125-halted-mandate-start-new-button-would-
   *  have-been-a-silent-no-op`). */
  subscriptionMandate: {
    pausedLabel: "Your payment is paused.",
    pausedBody: "Resume it in your UPI app to keep your subscription active.",
    haltedLabel: "Your payment mandate needs attention.",
    haltedBody: "It could not be renewed after several attempts. Set up a new mandate from your UPI app to continue.",
    // WS-R132 (migration 135). `startFollowerSubscription` now closes a
    // halted or cancelled mandate's own row and starts a fresh one, so
    // `haltedBody`/`cancelledLabel` above are followed by a WORKING button
    // rather than only naming the UPI app as the one place to act - see
    // `context/rejected.md#ws-r125-halted-mandate-start-new-button-would-
    // have-been-a-silent-no-op` for why that button did not exist before
    // this migration.
    cancelledLabel: "Your subscription was cancelled.",
    startNewMandate: "Start a new mandate",
  },

  /** WS-R130 (migration 133). The referral reward's own progress line, on
   *  the "Bring a friend" card `referral` above already renders - a NEW,
   *  closed section rather than a key added inside `referral` itself
   *  (this workstream's own append-only rule), fed by
   *  `roomReferralLink`'s widened response (`RoomReferralProgress`,
   *  `src/room/roomApi.ts`). Never a friend's identity, never a friend's
   *  own row - `progress(n, threshold)` names a COUNT, `granted` a DATE
   *  already on the reward row, nothing else. */
  referralReward: {
    progress: (n: number, threshold: number) => `${n} of ${threshold} friends have joined and paid so far.`,
    granted: (dateLabel: string) => `You earned a free month on ${dateLabel} - thank you for bringing friends.`,
  },

  /** WS-R129 ("quiet hours on every channel"), widened by WS-R131 (migration
   *  134): `summary`/`everyChannelNote`/`none` are the EFFECTIVE read-back
   *  (the follower's own account row when set, else whichever check-in
   *  schedule set one — `checkins.quietFromLabel`/`quietToLabel` above,
   *  unchanged by this workstream); `zoneLabel`/`fromLabel`/`toLabel`/`save`/
   *  `clear`/`saveError`/`windowInvalid`/`timezoneInvalid` belong to the NEW
   *  "set once" control this workstream adds, which writes ONLY to the
   *  follower's own account row, never to a check-in. */
  quietHours: {
    label: "Quiet hours",
    summary: "{from} to {to}, {zone}",
    everyChannelNote: "This applies on every channel this AI can reach you on: push, WhatsApp and Telegram.",
    none: "You have not set quiet hours yet. Set them below, or the next time you start a check-in.",
    zoneLabel: "Your timezone",
    fromLabel: "From",
    toLabel: "To",
    save: "Save",
    clear: "Clear",
    saveError: "Could not save your quiet hours. Try again.",
    windowInvalid: "Pick a from time and a to time that are not the same.",
    timezoneInvalid: "That does not look like a real timezone.",
  },

  monthNote: {
    /** WS-R137 (migration 136). The account page's own small "last note"
     *  card: what this Room has been for THIS follower, once a month,
     *  recomputed fresh from their own rows every time it renders - never a
     *  stored count, `api/_room-month-note.js`'s own header. `title` takes
     *  the note's own month label, already formatted by the caller
     *  (`formatDate`'s own precedent one file over) rather than a raw
     *  "YYYY-MM" key. */
    heading: "Your monthly note",
    title: (monthLabel: string) => `Your month, ${monthLabel}`,
    turns: (n: number, days: number) => `${n} message${n === 1 ? "" : "s"} across ${days} day${days === 1 ? "" : "s"}.`,
    streak: (n: number) => `A ${n}-day streak.`,
    threads: (n: number) => `${n} conversation${n === 1 ? "" : "s"} you came back to.`,
    checkins: (n: number) => `${n} check-in${n === 1 ? "" : "s"} kept.`,
    remembered: (n: number) => `${n} thing${n === 1 ? "" : "s"} you asked to be remembered.`,
    empty: "No monthly note yet - check back after your first full month here.",
  },
};

export type RoomCopy = typeof EN;

// ── the copy table: English now, Hindi as TWO independently-lazy chunks
//    (WS-R139) ─────────────────────────────────────────────────────────────
// The Hindi entry is one Proxy over TWO sections that install
// independently: `hiTalkCopy.ts` — every section the Room's own component
// tree reads on the way INTO a talk (the join/taste screens, the
// conversation itself, the always-visible top bar, including the button
// LABELS that open the five secondary screens below) — and `hiCopy.ts`, the
// remainder: sections read only inside those secondary screens once
// actually opened (`dormancy`, `referral`, `payReceipt`, `exportReadable`,
// `subscriptionMandate`, `referralReward`, `quietHours` — all five of
// AccountPage.tsx's/SubscriptionPanel.tsx's own detail, never surfaced
// anywhere in the always-visible chrome). `RoomApp.tsx`'s own header on why
// `account`/`checkins`/`handoff`/`subscription`/`menu`/`settingsReminder`
// stayed in the TALK half despite belonging to a "secondary screen": each
// carries at least one string the always-visible top bar (or, for
// `settingsReminder`, a banner on the talk screen itself) reads before any
// dialog ever opens, so splitting them at the FIELD level would need a
// second prop-threading pass this workstream's measured savings did not
// justify — the split is by SECTION, `hiAuthCopy.ts`/`hiCopy.ts`'s own
// precedent in `src/studio/copy.ts`, restated here.
//
// Reading a key from a section not yet installed THROWS, never falls back
// to English silently: `room_copy_hi_talk_not_loaded` for a TALK-section
// key, `room_copy_hi_not_loaded` for a REST one, so a stack trace says
// which chunk is missing and which loader installs it. `RoomApp.tsx`
// renders nothing (`if (!talkReady) return null`, placed after every hook
// so the hook count never changes between renders) until
// `roomTalkCopyReady(locale)` is true — only the TALK section needs to be
// ready for the screen every follower reaches first. `loadRoomCopy`
// installs BOTH sections, used by `evals/room-locale`'s key-parity check,
// `layoutFixture.tsx`'s glyph pass, and anywhere else the WHOLE table is
// read at once.
const TALK_KEYS = [
  "loading", "unavailable", "offline", "install", "join", "taste", "memory",
  "conversation", "flag", "threads", "quota", "voice", "pay", "subscription",
  "offer", "capOffer", "pulse", "stats", "share", "menu", "errors", "account",
  "settingsReminder", "checkins", "handoff", "about",
] as const;

export type RoomTalkCopy = Pick<RoomCopy, (typeof TALK_KEYS)[number]>;
export type RoomRestCopy = Omit<RoomCopy, (typeof TALK_KEYS)[number]>;

const TALK_SECTIONS = new Set<string>(TALK_KEYS);

const hiInstalled: Partial<RoomCopy> = {};

/** Every leaf `RoomApp.tsx`/`AccountPage.tsx`/etc. read off `ROOM_COPY_TABLE.hi`
 *  before this split read off ONE eager object; this Proxy is that same
 *  object's drop-in replacement, filled in by whichever loader below has run.
 *  The `ownKeys`/`getOwnPropertyDescriptor`/`has` traps mirror `hiInstalled`'s
 *  REAL keys (never the empty target's), so `Object.keys`/`for...in` —
 *  `evals/room-locale`'s own key-parity walk, `layoutFixture.tsx`'s
 *  `flattenHiStrings` — see the real, currently-installed keys rather than
 *  zero forever. Every reported key is `configurable: true`, which is what
 *  keeps this a spec-legal Proxy despite `ownKeys` naming properties the
 *  target itself never has. */
const HI_NOT_LOADED: RoomCopy = new Proxy({} as RoomCopy, {
  get(_target, key) {
    if (key === "then" || typeof key === "symbol") return undefined;
    if (Object.prototype.hasOwnProperty.call(hiInstalled, key)) {
      return (hiInstalled as Record<string, unknown>)[key as string];
    }
    const isTalk = TALK_SECTIONS.has(String(key));
    throw new Error(
      `room_copy_hi_${isTalk ? "talk_" : ""}not_loaded: read of ${String(key)} before ` +
        (isTalk ? `loadRoomTalkCopy("hi")` : `loadRoomCopy("hi")`),
    );
  },
  has(_target, key) {
    return Object.prototype.hasOwnProperty.call(hiInstalled, key);
  },
  ownKeys(_target) {
    return Reflect.ownKeys(hiInstalled);
  },
  getOwnPropertyDescriptor(_target, key) {
    if (!Object.prototype.hasOwnProperty.call(hiInstalled, key)) return undefined;
    return { enumerable: true, configurable: true, value: (hiInstalled as Record<string | symbol, unknown>)[key] };
  },
});

/** The one export components read from. `evals/room-locale/run.mjs` asserts
 *  `Object.keys(ROOM_COPY_TABLE.en)` deep-equals `Object.keys(ROOM_COPY_TABLE.hi)`
 *  at every level, against this REAL export — not a hand-maintained list that
 *  could drift the moment a key is added to one locale and not the other. */
export const ROOM_COPY_TABLE: Record<RoomLocale, RoomCopy> = { en: EN, hi: HI_NOT_LOADED };

const TALK_LOADED: Record<RoomLocale, boolean> = { en: true, hi: false };
const REST_LOADED: Record<RoomLocale, boolean> = { en: true, hi: false };
let hiTalkLoading: Promise<RoomTalkCopy> | null = null;
let hiRestLoading: Promise<RoomRestCopy> | null = null;

function pickTalk(table: RoomCopy): RoomTalkCopy {
  const {
    loading, unavailable, offline, install, join, taste, memory, conversation,
    flag, threads, quota, voice, pay, subscription, offer, capOffer, pulse,
    stats, share, menu, errors, account, settingsReminder, checkins, handoff, about,
  } = table;
  return {
    loading, unavailable, offline, install, join, taste, memory, conversation,
    flag, threads, quota, voice, pay, subscription, offer, capOffer, pulse,
    stats, share, menu, errors, account, settingsReminder, checkins, handoff, about,
  };
}

/** True once the TALK section is installed for `locale` — the gate
 *  `RoomApp.tsx` waits on before rendering anything. Ready immediately for
 *  English; for Hindi, ready once `hiTalkCopy.ts` has landed, well before
 *  the (smaller, but not needed on the way in) rest of the table. */
export function roomTalkCopyReady(locale: RoomLocale): boolean {
  return TALK_LOADED[normalizeLocale(locale)];
}

/** True once `ROOM_COPY_TABLE[locale]` is the WHOLE real table — both
 *  sections installed. */
export function roomCopyReady(locale: RoomLocale): boolean {
  const safe = normalizeLocale(locale);
  return TALK_LOADED[safe] && REST_LOADED[safe];
}

/** Installs ONLY the TALK section, from its own chunk (`hiTalkCopy.ts` for
 *  Hindi; already real for English). Idempotent; concurrent callers share
 *  one in-flight import. This is the loader `RoomApp.tsx` awaits before
 *  rendering anything, and `main.tsx`'s own early call for a Hindi Room
 *  request (`vite.config.ts`'s `roomHindiPreloadPlugin` preloads this exact
 *  chunk). */
export function loadRoomTalkCopy(locale: RoomLocale): Promise<RoomTalkCopy> {
  const safe = normalizeLocale(locale);
  if (TALK_LOADED[safe]) {
    return Promise.resolve(pickTalk(ROOM_COPY_TABLE[safe]));
  }
  if (!hiTalkLoading) {
    hiTalkLoading = import("./hiTalkCopy").then((mod) => {
      Object.assign(hiInstalled, mod.HI_TALK);
      TALK_LOADED.hi = true;
      return mod.HI_TALK;
    });
  }
  return hiTalkLoading;
}

/** Installs the WHOLE table for `locale`: the TALK section (if not already
 *  installed) and the rest, from its own chunk (`hiCopy.ts`). Every caller
 *  from before this split (`evals/room-locale`, `layoutFixture.tsx`) keeps
 *  working unchanged — this function now installs two chunks instead of
 *  one, never fewer keys than it used to. */
export function loadRoomCopy(locale: RoomLocale): Promise<RoomCopy> {
  const safe = normalizeLocale(locale);
  const talkPromise = loadRoomTalkCopy(safe);
  if (REST_LOADED[safe]) {
    return talkPromise.then(() => ROOM_COPY_TABLE[safe]);
  }
  if (!hiRestLoading) {
    hiRestLoading = import("./hiCopy").then((mod) => {
      Object.assign(hiInstalled, mod.HI);
      REST_LOADED.hi = true;
      return mod.HI;
    });
  }
  return Promise.all([talkPromise, hiRestLoading]).then(() => ROOM_COPY_TABLE[safe]);
}

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

// ── WS-R79: language tagging for screen readers ─────────────────────────
//
// `document.documentElement.lang`/`<main lang={locale}>` (`RoomApp.tsx`'s
// own effect and JSX) name ONE thing: the follower's own chosen chrome
// language. Four kinds of text on this surface are not guaranteed to be IN
// that language, and nothing checked it before this workstream:
//
//   - the disclosure sentence. `roomDisclosureCard` is rendered in the
//     locale it was FETCHED in, never re-picked client side (this file's own
//     `RoomOpen.locale` comment) - but `switchLocale` (`RoomApp.tsx`) mints a
//     fresh SESSION on a locale change and updates `document.documentElement.
//     lang` immediately, without ever re-fetching the disclosure text itself.
//     A follower who switches language mid-conversation now has a document
//     tagged in the NEW locale wrapping a disclosure card still written in
//     the OLD one, until their next message. Tagging the document was never
//     going to catch this - only the node can.
//   - the creator's own name (`room.name`/`display_name`) and the room's own
//     "AI" heading. A name is not translated (`withName`'s own comment,
//     restated) and is not guaranteed to be written in the SAME script the
//     follower reads the rest of the room in either - a creator can write
//     their own name in Devanagari and a follower can still read the room's
//     chrome in English, or the reverse.
//   - any other creator-authored text (the one-line bio, a showcase question
//     or answer on `/c/<slug>`) - written once, in the Room's own default
//     locale, read by a follower who chose the OTHER one.
//
// `detectRoomTextLang` answers the one question that actually decides
// pronunciation - what SCRIPT a piece of text is actually IN - from the
// text's own characters, never from `room.locale`/`document.documentElement.
// lang`, which name a different question entirely (the follower's own
// chosen chrome language, not what any one sentence happens to be written
// in). See `context/decisions.md#ws-r79-tag-at-the-node-not-the-document`.
//
// The Devanagari block is U+0900-U+097F - the same range
// `scripts/check-layout.mjs`'s own glyph probe already tests strings against
// (that file's `devanagariCount`), restated here rather than imported: this
// module ships to the browser and that one runs only in the release gate,
// two different runtimes with no shared boundary to cross (the same reason
// `api/_creator-page.js` restates it a third time rather than importing
// from either).
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;

/** Detects which of `ROOM_LOCALES` a piece of TEXT is actually written in,
 *  from its own characters. English is the default for anything with no
 *  Devanagari codepoint at all - digits, punctuation, a Latin-script name,
 *  an untranslated loanword like "AI" - exactly the same default
 *  `normalizeLocale` above already applies to a browser or Telegram hint
 *  that names no language it recognises. */
export function detectRoomTextLang(text: string): RoomLocale {
  return DEVANAGARI_RANGE.test(String(text || "")) ? "hi" : "en";
}
