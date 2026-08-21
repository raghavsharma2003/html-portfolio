// The dilemma deck. Pure data — no logic, no talk, no persona.
//
// These strings are read BY HIM, on screen. That is the one thing that makes
// this file different from everywhere else prose lives in this repo: it is UI
// copy, not prompt text, so it is allowed to be full sentences. Nothing here
// is ever placed in a prompt or spoken by her — `wyrTalk.ts` is the seam that
// turns what happens with this deck into the telegraphic facts she is handed,
// and it never quotes `a`/`b` verbatim into a fact longer than the shapelint
// cap. See that file's header before wiring a fourth place this deck is read.
//
// `aShort`/`bShort` exist for a reason that is NOT cosmetic: they are what
// `wyrTalk.ts` puts in `nameable` (the honesty allowlist) and in facts, and a
// fact template built from the full `a`/`b` sentence would blow the 14-word
// shapelint cap the moment two option sentences are concatenated. Capped at
// two words each so `"he picked X Y, she picked X Y, that's a clash"` — the
// per-pick poke — stays inside its own three-clause budget with room to
// spare. Lowercase, no punctuation: they are identifier-shaped tokens, not
// prose.
//
// Content rule, stated once rather than re-litigated per card: nothing here
// crosses this repo's age gates, nothing sexual, nothing self-harm-adjacent.
// `evals/wyr.mjs` greps the whole deck against a banned-topic list as a
// negative control — this is the one file in the repo where a screening test
// runs over hand-written prose rather than model output, because the prose
// ships verbatim to the screen with no generation step to have gone wrong.

export type WyrTier = "everyday" | "absurd" | "food" | "relationships" | "deep";

/** Optional intensity note. Both values stay well inside the content rule
 *  above — "bold" marks a card that leans into trust/vulnerability, not one
 *  that crosses any line the mild cards don't already respect. */
export type WyrSpice = "mild" | "bold";

export interface WyrCard {
  readonly id: string;
  /** Full sentence, shown on the left panel. UI copy — never reaches a prompt. */
  readonly a: string;
  /** Full sentence, shown on the right panel. */
  readonly b: string;
  /** ≤2 words, lowercase, no punctuation. Identifier-shaped: feeds `nameable`. */
  readonly aShort: string;
  readonly bShort: string;
  readonly tier: WyrTier;
  readonly spice?: WyrSpice;
}

/** Length caps `evals/wyr.mjs` checks the whole deck against. */
export const MAX_OPTION_LEN = 100;
export const MAX_SHORT_LEN = 20;
export const MAX_SHORT_WORDS = 2;

export const DECK: readonly WyrCard[] = [
  // ── everyday, India-flavoured ────────────────────────────────────────────
  {
    id: "ev-chai-coffee",
    a: "Chai forever, never coffee again",
    b: "Coffee forever, never chai again",
    aShort: "chai forever",
    bShort: "coffee forever",
    tier: "everyday",
  },
  {
    id: "ev-local-delhi-summer",
    a: "Ride the Mumbai local at rush hour, every single day",
    b: "Live through a Delhi summer with the AC broken, every year",
    aShort: "mumbai local",
    bShort: "delhi summer",
    tier: "everyday",
  },
  {
    id: "ev-powercut-wifi",
    a: "A power cut every evening at 7pm, no warning, forever",
    b: "Wifi that drops the second it starts raining, forever",
    aShort: "daily powercut",
    bShort: "rain wifi",
    tier: "everyday",
  },
  {
    id: "ev-auto-ola",
    a: "Haggle with an auto driver for every single ride",
    b: "Wait twenty minutes for an Ola that always cancels",
    aShort: "haggle autos",
    bShort: "cancelled olas",
    tier: "everyday",
  },
  {
    id: "ev-wedding-guest-host",
    a: "Be the guest who has to dance at every wedding",
    b: "Be the host who has to manage the caterer at every wedding",
    aShort: "wedding guest",
    bShort: "wedding host",
    tier: "everyday",
  },
  {
    id: "ev-metro-traffic",
    a: "Squeeze into a packed metro coach, every single day",
    b: "Sit in traffic for two hours, every single day",
    aShort: "packed metro",
    bShort: "daily traffic",
    tier: "everyday",
  },
  {
    id: "ev-society-wifi-parking",
    a: "Fight the building WhatsApp group about parking, forever",
    b: "Fight the building WhatsApp group about the lift, forever",
    aShort: "parking fight",
    bShort: "lift fight",
    tier: "everyday",
  },
  {
    id: "ev-diwali-clean-relatives",
    a: "Do the full Diwali deep clean, every single year",
    b: "Host every relative who drops by during Diwali, every year",
    aShort: "diwali cleaning",
    bShort: "diwali guests",
    tier: "everyday",
  },
  {
    id: "ev-result-day-first-day",
    a: "Relive board exam result day nerves, once a year",
    b: "Relive the first day of a new job, once a year",
    aShort: "result nerves",
    bShort: "first day",
    tier: "everyday",
  },
  {
    id: "ev-train-flight",
    a: "Every train you take runs four hours late",
    b: "Every flight you take gets gate-changed last minute",
    aShort: "late trains",
    bShort: "gate changes",
    tier: "everyday",
  },
  {
    id: "ev-tapri-bakery-queue",
    a: "Wait in the chai tapri queue, every single morning",
    b: "Wait in the bakery queue for bread, every single morning",
    aShort: "chai queue",
    bShort: "bread queue",
    tier: "everyday",
  },
  {
    id: "ev-joint-family-alone",
    a: "Live with the whole joint family, zero privacy, forever",
    b: "Live completely alone, no family nearby, forever",
    aShort: "joint family",
    bShort: "living alone",
    tier: "everyday",
  },
  {
    id: "ev-nani-camp",
    a: "Spend every summer at your nani's house, no choice",
    b: "Spend every summer at a strict summer camp, no choice",
    aShort: "nani's house",
    bShort: "summer camp",
    tier: "everyday",
  },
  {
    id: "ev-meter-route",
    a: "An auto driver who always argues about the meter",
    b: "A cab driver who always takes the long route",
    aShort: "meter fights",
    bShort: "long routes",
    tier: "everyday",
  },
  {
    id: "ev-match-vs-function",
    a: "Miss the India match for a family function, every year",
    b: "Sit through the family function with zero cricket updates, every year",
    aShort: "miss match",
    bShort: "no updates",
    tier: "everyday",
  },
  {
    id: "ev-saree-suit-shopping",
    a: "Go saree shopping with your massi for six hours",
    b: "Go suit shopping with your chacha for six hours",
    aShort: "saree shopping",
    bShort: "suit shopping",
    tier: "everyday",
  },

  // ── absurd ────────────────────────────────────────────────────────────────
  {
    id: "ab-elephant-mouse",
    a: "Have a pet elephant the size of a cat",
    b: "Have a pet mouse the size of an elephant",
    aShort: "tiny elephant",
    bShort: "giant mouse",
    tier: "absurd",
  },
  {
    id: "ab-whisper-shout",
    a: "Only ever be able to whisper, for the rest of your life",
    b: "Only ever be able to shout, for the rest of your life",
    aShort: "only whisper",
    bShort: "only shout",
    tier: "absurd",
  },
  {
    id: "ab-spicy-sweet",
    a: "Only ever taste spicy food again",
    b: "Only ever taste sweet food again",
    aShort: "only spicy",
    bShort: "only sweet",
    tier: "absurd",
  },
  {
    id: "ab-mind-time",
    a: "Read minds, but never be able to turn it off",
    b: "Time travel, but only ever into the past",
    aShort: "read minds",
    bShort: "time travel",
    tier: "absurd",
  },
  {
    id: "ab-fly-teleport",
    a: "Fly, but only as fast as a bicycle",
    b: "Teleport, but land somewhere random within a kilometre",
    aShort: "slow flying",
    bShort: "blind teleport",
    tier: "absurd",
  },
  {
    id: "ab-rewind-pause",
    a: "Rewind any five seconds, once a day",
    b: "Pause everyone else for five minutes, once a day",
    aShort: "rewind power",
    bShort: "pause power",
    tier: "absurd",
  },
  {
    id: "ab-late-early",
    a: "Always be exactly ten minutes late, no matter what",
    b: "Always be exactly ten minutes early, no matter what",
    aShort: "always late",
    bShort: "always early",
    tier: "absurd",
  },
  {
    id: "ab-animals-plants",
    a: "Talk to animals, who never stop complaining",
    b: "Talk to plants, who never say anything interesting",
    aShort: "talk animals",
    bShort: "talk plants",
    tier: "absurd",
  },
  {
    id: "ab-shrink-grow",
    a: "Shrink to six inches tall whenever you sneeze",
    b: "Grow to twenty feet tall whenever you laugh",
    aShort: "sneeze shrink",
    bShort: "laugh grow",
    tier: "absurd",
  },
  {
    id: "ab-thumbs-elbows",
    a: "Lose your thumbs, permanently",
    b: "Lose your elbows, permanently",
    aShort: "no thumbs",
    bShort: "no elbows",
    tier: "absurd",
  },
  {
    id: "ab-loop-silence",
    a: "Hear one song on loop for the rest of your life",
    b: "Hear total silence for the rest of your life",
    aShort: "one song",
    bShort: "total silence",
    tier: "absurd",
  },
  {
    id: "ab-truth-liedetect",
    a: "Never be able to lie again, about anything",
    b: "Always know instantly when someone else is lying",
    aShort: "cant lie",
    bShort: "spot lies",
    tier: "absurd",
  },
  {
    id: "ab-synesthesia",
    a: "Taste colours instead of food",
    b: "Hear smells instead of sounds",
    aShort: "taste colours",
    bShort: "hear smells",
    tier: "absurd",
  },
  {
    id: "ab-warm-cold-touch",
    a: "Everything you touch turns slightly warm",
    b: "Everything you touch turns slightly cold",
    aShort: "warm touch",
    bShort: "cold touch",
    tier: "absurd",
  },
  {
    id: "ab-confetti-bubbles",
    a: "Sneeze confetti, every single time",
    b: "Hiccup bubbles, every single time",
    aShort: "confetti sneeze",
    bShort: "bubble hiccup",
    tier: "absurd",
  },
  {
    id: "ab-gravity",
    a: "Live with half the normal gravity, forever",
    b: "Live with double the normal gravity, forever",
    aShort: "half gravity",
    bShort: "double gravity",
    tier: "absurd",
  },

  // ── food ──────────────────────────────────────────────────────────────────
  {
    id: "fo-dessert-fried",
    a: "Never eat dessert again",
    b: "Never eat fried food again",
    aShort: "no dessert",
    bShort: "no fried",
    tier: "food",
  },
  {
    id: "fo-north-south",
    a: "Only eat North Indian food, for the rest of your life",
    b: "Only eat South Indian food, for the rest of your life",
    aShort: "only north",
    bShort: "only south",
    tier: "food",
  },
  {
    id: "fo-street-finedine",
    a: "Eat only street food, forever",
    b: "Eat only fine dining, forever",
    aShort: "street food",
    bShort: "fine dining",
    tier: "food",
  },
  {
    id: "fo-spicy-bland",
    a: "Every meal is extremely spicy, forever",
    b: "Every meal is completely bland, forever",
    aShort: "always spicy",
    bShort: "always bland",
    tier: "food",
  },
  {
    id: "fo-biryani-butterchicken",
    a: "Only ever eat biryani again",
    b: "Only ever eat butter chicken again",
    aShort: "only biryani",
    bShort: "only chicken",
    tier: "food",
  },
  {
    id: "fo-mango-winter",
    a: "Eat mangoes all year, but winter never comes",
    b: "Have winter treats all year, but mango season never comes",
    aShort: "mango always",
    bShort: "winter treats",
    tier: "food",
  },
  {
    id: "fo-cold-hot",
    a: "Every meal arrives stone cold",
    b: "Every meal arrives painfully hot",
    aShort: "cold meals",
    bShort: "too hot",
    tier: "food",
  },
  {
    id: "fo-onecuisine-anything",
    a: "Eat only one cuisine, forever, but always fresh",
    b: "Eat anything you want, but it's always slightly cold",
    aShort: "one cuisine",
    bShort: "always cold",
    tier: "food",
  },
  {
    id: "fo-chai-chocolate",
    a: "Give up chai forever",
    b: "Give up chocolate forever",
    aShort: "no chai",
    bShort: "no chocolate",
    tier: "food",
  },
  {
    id: "fo-leftovers-forcedfresh",
    a: "Eat leftovers for every single meal, forever",
    b: "Cook a fresh meal from scratch, every single time",
    aShort: "always leftovers",
    bShort: "always cooking",
    tier: "food",
  },
  {
    id: "fo-buffet-thali",
    a: "Eat at a buffet for every single meal",
    b: "Eat a fixed thali for every single meal",
    aShort: "always buffet",
    bShort: "always thali",
    tier: "food",
  },
  {
    id: "fo-sugar-salt",
    a: "Never eat sugar again",
    b: "Never eat salt again",
    aShort: "no sugar",
    bShort: "no salt",
    tier: "food",
  },
  {
    id: "fo-hands-cutlery",
    a: "Eat every meal with your hands, even soup",
    b: "Eat every meal with cutlery, even golgappa",
    aShort: "only hands",
    bShort: "only cutlery",
    tier: "food",
  },
  {
    id: "fo-jalebi-gulabjamun",
    a: "Only ever eat jalebi again",
    b: "Only ever eat gulab jamun again",
    aShort: "only jalebi",
    bShort: "only gulab",
    tier: "food",
  },
  {
    id: "fo-maggi-parathas",
    a: "Only ever eat Maggi again",
    b: "Only ever eat parathas again",
    aShort: "only maggi",
    bShort: "only parathas",
    tier: "food",
  },
  {
    id: "fo-skip-breakfast-dinner",
    a: "Skip breakfast, every single day, forever",
    b: "Skip dinner, every single day, forever",
    aShort: "skip breakfast",
    bShort: "skip dinner",
    tier: "food",
  },

  // ── relationships, lite ──────────────────────────────────────────────────
  {
    id: "re-late-cancel",
    a: "Date someone who's always late",
    b: "Date someone who always cancels last minute",
    aShort: "always late",
    bShort: "always cancels",
    tier: "relationships",
  },
  {
    id: "re-read-texts",
    a: "Your partner can read every text you've ever sent",
    b: "You can read every text your partner has ever sent",
    aShort: "they read",
    bShort: "you read",
    tier: "relationships",
    spice: "bold",
  },
  {
    id: "re-meet-parents-friends",
    a: "Meet the parents in the first month",
    b: "Meet the whole friend group in the first month",
    aShort: "meet parents",
    bShort: "meet friends",
    tier: "relationships",
  },
  {
    id: "re-arranged-love",
    a: "Let the family arrange it",
    b: "Find it yourself, and hope the family approves later",
    aShort: "arranged first",
    bShort: "love first",
    tier: "relationships",
  },
  {
    id: "re-ex-wedding-neighbour",
    a: "Your ex shows up at your wedding, uninvited",
    b: "Your ex becomes your next-door neighbour",
    aShort: "ex arrives",
    bShort: "ex neighbour",
    tier: "relationships",
  },
  {
    id: "re-longdistance-tooclose",
    a: "Long distance, forever, but it never once breaks you",
    b: "Move in together after two weeks, and make it work",
    aShort: "long distance",
    bShort: "moving fast",
    tier: "relationships",
  },
  {
    id: "re-overshare-noshare",
    a: "A partner who overshares everything, to everyone",
    b: "A partner who shares nothing, with anyone",
    aShort: "overshares",
    bShort: "shares nothing",
    tier: "relationships",
  },
  {
    id: "re-jealous-toochill",
    a: "A partner who gets jealous over everything",
    b: "A partner who never reacts to anything",
    aShort: "too jealous",
    bShort: "too chill",
    tier: "relationships",
  },
  {
    id: "re-publicfight-silence",
    a: "Have every fight in public, loudly",
    b: "Get the silent treatment for a week, every fight",
    aShort: "public fights",
    bShort: "silent treatment",
    tier: "relationships",
  },
  {
    id: "re-forget-remember-anniversary",
    a: "A partner who forgets your anniversary, every year",
    b: "A partner who remembers every detail, and brings it up during fights",
    aShort: "forgets dates",
    bShort: "remembers everything",
    tier: "relationships",
  },
  {
    id: "re-inlaws-upstairs-weekend",
    a: "In-laws living in the flat upstairs",
    b: "In-laws visiting every single weekend",
    aShort: "inlaws upstairs",
    bShort: "inlaws weekly",
    tier: "relationships",
  },
  {
    id: "re-proposal-viral-private",
    a: "A proposal that goes viral online",
    b: "A proposal nobody ever finds out about",
    aShort: "viral proposal",
    bShort: "secret proposal",
    tier: "relationships",
  },
  {
    id: "re-know-secrets-noneknown",
    a: "Know every secret your partner has",
    b: "Have your partner know none of yours",
    aShort: "know all",
    bShort: "reveal nothing",
    tier: "relationships",
    spice: "bold",
  },
  {
    id: "re-breakup-text-longtalk",
    a: "Get broken up with over text",
    b: "Sit through a three hour breakup conversation",
    aShort: "text breakup",
    bShort: "long breakup",
    tier: "relationships",
  },
  {
    id: "re-crush-hints",
    a: "Have a crush who never notices you",
    b: "Have a friend who won't stop hinting they like you",
    aShort: "unnoticed crush",
    bShort: "constant hints",
    tier: "relationships",
  },
  {
    id: "re-alwaysright",
    a: "Your partner is always right, in every argument",
    b: "You are always right, in every argument",
    aShort: "they're right",
    bShort: "you're right",
    tier: "relationships",
  },

  // ── deep-ish ──────────────────────────────────────────────────────────────
  {
    id: "de-opinions-thoughts",
    a: "Know exactly what everyone really thinks of you",
    b: "Never know what anyone actually thinks of you",
    aShort: "know all",
    bShort: "know nothing",
    tier: "deep",
  },
  {
    id: "de-famous-unknown",
    a: "Be famous, but never truly known by anyone",
    b: "Be truly known, but never famous",
    aShort: "famous unknown",
    bShort: "known unfamous",
    tier: "deep",
  },
  {
    id: "de-neverlied-neverlie",
    a: "Never be lied to again, by anyone",
    b: "Never be able to lie again, to anyone",
    aShort: "never lied",
    bShort: "never lie",
    tier: "deep",
  },
  {
    id: "de-oneanswer-oneundo",
    a: "Get one true answer to any question, just once",
    b: "Get to undo one choice you've made, just once",
    aShort: "one answer",
    bShort: "one undo",
    tier: "deep",
  },
  {
    id: "de-forgetstruggle-remember",
    a: "Live your ideal life, but forget it was ever hard",
    b: "Remember every struggle that made you who you are",
    aShort: "forget hard",
    bShort: "keep hard",
    tier: "deep",
  },
  {
    id: "de-time-noone-people-notime",
    a: "Have unlimited time, but no one to share it with",
    b: "Have very little time, with everyone you love around",
    aShort: "time alone",
    bShort: "little time",
    tier: "deep",
  },
  {
    id: "de-keepmemory-losepain",
    a: "Keep every memory, even the painful ones",
    b: "Forget the painful ones, but lose some good ones too",
    aShort: "keep all",
    bShort: "forget some",
    tier: "deep",
  },
  {
    id: "de-rightalone-wrongtogether",
    a: "Be right every time, but always alone in it",
    b: "Be wrong sometimes, but never alone",
    aShort: "right alone",
    bShort: "wrong together",
    tier: "deep",
  },
  {
    id: "de-closure-hope",
    a: "Get closure on everything left unresolved",
    b: "Leave a little unresolved, and keep hoping",
    aShort: "get closure",
    bShort: "keep hoping",
    tier: "deep",
  },
  {
    id: "de-bestbehind-bestahead",
    a: "Know your best moment already happened",
    b: "Never know if your best moment is still ahead",
    aShort: "best past",
    bShort: "best unknown",
    tier: "deep",
  },
  {
    id: "de-changepast-knowoutcome",
    a: "Change one decision from your past",
    b: "Know exactly how it would have turned out, without changing it",
    aShort: "change it",
    bShort: "just know",
    tier: "deep",
  },
  {
    id: "de-forgiveall-beforgiven",
    a: "Be forgiven for everything, by everyone",
    b: "Forgive everyone, whether they ask for it or not",
    aShort: "be forgiven",
    bShort: "forgive first",
    tier: "deep",
  },
  {
    id: "de-saythething-hearthething",
    a: "Say the one thing you never got to say",
    b: "Hear the one thing you always wanted to hear",
    aShort: "say it",
    bShort: "hear it",
    tier: "deep",
  },
  {
    id: "de-allanswers-allquestions",
    a: "Have all the answers, with no one to tell",
    b: "Have all the questions, with someone to ask them beside you",
    aShort: "all answers",
    bShort: "all questions",
    tier: "deep",
  },
  {
    id: "de-neveroutoftime-neveroutofwords",
    a: "Never run out of time with the people you love",
    b: "Never run out of things to say to them",
    aShort: "more time",
    bShort: "more words",
    tier: "deep",
  },
  {
    id: "de-onemoreday-fiftyyears",
    a: "Get one more day with someone you lost",
    b: "Get fifty years with someone new",
    aShort: "one more",
    bShort: "fifty years",
    tier: "deep",
  },
];

export const DECK_IDS: readonly string[] = DECK.map((c) => c.id);

const BY_ID: ReadonlyMap<string, WyrCard> = new Map(DECK.map((c) => [c.id, c]));

export function cardById(id: string): WyrCard | undefined {
  return BY_ID.get(id);
}
