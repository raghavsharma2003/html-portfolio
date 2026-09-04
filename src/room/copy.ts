// EVERY WORD THE ROOM SAYS, IN ONE PLACE.
//
// src/components/MemoryConsent.tsx's rule, and the reason transfers exactly:
// three surfaces showing one question in three files is how two of them end up
// describing something the third does not do. It is a designated copy module,
// so `scripts/check-copy.mjs` reads every literal in it rather than guessing
// which ones render.
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
// ── the copy rules this file is held to ───────────────────────────────────
//
// Product chrome, never the AI's voice: an app asks for permissions, a person
// does not. No em-dash or en-dash. Never the word "clone": a follower reads
// "<Name> AI". Every clause checkable against this repo rather than
// aspirational. A read-aloud test: if it sounds like a brochure, it is wrong.

/** Name goes in, a sentence comes out. A template rather than a concatenation
 *  at each call site, so the name lands in the same place every time. */
export const withName = (template: string, name: string) => template.split("{name}").join(name);

export const ROOM_COPY = {
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
    close: "Close",
  },

  errors: {
    generic: "That did not go through. Try again.",
    signIn: "Sign in first.",
    stale: "This room was updated. Reload to see what changed.",
    tooLong: "That is longer than one message can be.",
  },

  checkins: {
    title: "Check-ins",
    intro: "Pick a check-in and a schedule. It will follow up right in this room, at the time you choose.",
    empty: "This creator has not set up any check-ins yet.",
    daysLabel: "Which days",
    timeLabel: "What time",
    zoneLabel: "Your timezone",
    add: "Start this check-in",
    mineTitle: "Your check-ins",
    mineEmpty: "None yet.",
    stop: "Stop",
    stopped: "Stopped",
    close: "Close",
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
} as const;
