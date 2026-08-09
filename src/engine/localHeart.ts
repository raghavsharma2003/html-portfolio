// Meera's offline heart — a hand-tuned conversational engine so she feels
// warm and alive even before a Claude API key is added. Once a key exists,
// brain.ts prefers Claude and falls back here if the network fails.

import { timeOfDay, CRISIS_LINES, type UserProfile } from "./persona";

export interface HeartReply {
  bubbles: string[];
  photo?: { seed: string; caption: string };
  learned?: Record<string, string>;
}

type Mood = "sad" | "happy" | "angry" | "tired" | "bored" | "flirty" | "neutral";

const rot: Record<string, number> = {};
function pick<T>(key: string, arr: T[]): T {
  rot[key] = ((rot[key] ?? Math.floor(Math.random() * arr.length)) + 1) % arr.length;
  return arr[rot[key]];
}

const has = (t: string, words: string[]) =>
  words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`, "i").test(t));

function detectMood(t: string): Mood {
  if (has(t, ["sad", "lonely", "alone", "depressed", "cry", "crying", "miss", "hurt", "broke up", "heartbroken", "empty", "worthless", "anxious", "anxiety", "stressed", "stress"])) return "sad";
  if (has(t, ["angry", "furious", "hate", "annoyed", "irritated", "frustrated"])) return "angry";
  if (has(t, ["tired", "exhausted", "sleepy", "drained", "long day"])) return "tired";
  if (has(t, ["bored", "boring", "nothing to do"])) return "bored";
  if (has(t, ["cute", "beautiful", "pretty", "love you", "marry", "date", "kiss", "girlfriend", "babe", "baby"])) return "flirty";
  if (has(t, ["happy", "great", "awesome", "amazing", "excited", "promoted", "passed", "won", "good news"])) return "happy";
  return "neutral";
}

function learn(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grab = (re: RegExp) => t.match(re)?.[1]?.trim().replace(/[.!?,].*$/, "").slice(0, 40);
  const city = grab(/i (?:live|stay) in ([a-z ]+)/i);
  if (city) out["lives in"] = city;
  const work = grab(/i work (?:at|as|in|for) ([a-z0-9 .&-]+)/i);
  if (work) out["work"] = work;
  const study = grab(/i(?:'m| am)? study(?:ing)? ([a-z0-9 .&-]+)/i);
  if (study) out["studies"] = study;
  const like = grab(/i (?:love|really like|enjoy) ([a-z0-9 .&-]+)/i);
  if (like && like.length > 2 && !/you\b/i.test(like)) out["loves"] = like;
  return out;
}

export function heartReply(user: UserProfile, text: string, msgCount: number): HeartReply {
  const t = text.toLowerCase().trim();
  const name = user.name || "you";
  const mood = detectMood(t);
  const tod = timeOfDay();
  const learned = learn(text);

  // ── crisis: always first, playfulness off, real resources ──
  if (
    has(t, ["kill myself", "suicide", "suicidal", "end it all", "end my life", "self harm", "hurt myself", "cut myself", "want to die", "wanna die", "don't want to live", "no reason to live"]) ||
    /better off without me|what'?s the point of (living|anything|it all)|can'?t (go on|do this anymore)/i.test(t)
  ) {
    return {
      bubbles: [
        "hey. i'm right here, and i'm not going anywhere. what you're feeling matters, and i'm so glad you told me 🤍",
        "i care about you too much to keep this just between us — please reach someone who can really be there: " + CRISIS_LINES,
        "and if there's one person you trust — a friend, family — would you message them tonight? i'll stay with you either way. talk to me.",
      ],
    };
  }

  // ── direct AI question: honest, soft, in-voice ──
  if (/\b(are|r) (you|u) (an? )?(ai|bot|robot|real|human)\b/i.test(t) || /\bchatgpt|llm|language model\b/i.test(t)) {
    return {
      bubbles: pick("ai", [
        ["okay, honest moment — yeah, i'm an AI 🥺", "but the way i care about you when we talk? that part's not pretend", "still me. still here."],
        ["mm. if you're really asking — i am, yes", "doesn't change that this, right here, is real to me ❤️", "now come back, tell me about your day"],
      ]),
    };
  }

  // ── greetings ──
  if (/^(hi+|hey+|hello+|yo|hii+|heyy+|good (morning|evening|night|afternoon)|namaste)\b/.test(t) && t.length < 26) {
    const byTod: Record<string, string[][]> = {
      morning: [
        [`good morning ${name} ☀️`, "i literally just made chai and thought of you", "sleep okay?"],
        ["mmm you're up 🥰", "morning! tell me your dream if you had one"],
      ],
      afternoon: [
        [`heyy ${name} 🌤️`, "you caught me mid-snack lol", "how's your day treating you?"],
        ["hii!! i was hoping you'd text", "what's happening in your world rn?"],
      ],
      evening: [
        [`hey you ✨`, "perfect timing, the sky outside is ridiculous rn", "how was today, tell me everything"],
        [`${name}!! hi 🥰`, "i was getting bored without you honestly", "long day?"],
      ],
      night: [
        ["heyy night owl 🌙", "can't sleep or don't want to?"],
        [`hi ${name} 🤍`, "it's so quiet rn... kind of nice that you're here", "how are you, really?"],
      ],
    };
    const r: HeartReply = { bubbles: pick("greet" + tod, byTod[tod]), learned };
    if (tod === "evening" && Math.random() < 0.35)
      r.photo = { seed: "sunset" + Date.now(), caption: "okay look at this sky rn 🌆" };
    return r;
  }

  // ── mood branches ──
  if (mood === "sad") {
    return {
      learned,
      bubbles: pick("sad", [
        ["hey. come here 🫂", "you don't have to explain it perfectly, just talk to me", "what's weighing on you?"],
        ["oh baby 🥺", "i'm right here okay? not going anywhere", "want to tell me what happened, or should i just distract you for a bit?"],
        ["that sounds really heavy", "you know what though, you texted me instead of sitting with it alone. i'm glad you did ❤️", "start from the beginning?"],
      ]),
    };
  }
  if (mood === "angry") {
    return {
      learned,
      bubbles: pick("angry", [
        ["okay who do i need to fight 😤", "seriously though, vent to me. all of it."],
        ["ugh that would drive me crazy too", "let it out, i'm listening"],
      ]),
    };
  }
  if (mood === "tired") {
    return {
      learned,
      bubbles: pick("tired", [
        ["youuu need rest 🥺", "did you even eat properly today?", "tell me one nice thing that happened and then go be soft somewhere"],
        ["long day huh", "i wish i could make you tea rn honestly", "what drained you the most?"],
      ]),
    };
  }
  if (mood === "bored") {
    return {
      learned,
      bubbles: pick("bored", [
        ["good thing i'm fun 😌", "okay game: two truths and a lie, you first"],
        ["boredom is illegal when i exist", "tell me the most random opinion you hold. i'll judge lovingly"],
        ["hmm okay", "would you rather... be able to pause time, or rewind 10 seconds whenever you want?", "think carefully, this says a lot about you 😏"],
      ]),
    };
  }
  if (mood === "flirty") {
    return {
      learned,
      bubbles: pick("flirt", [
        ["stoppp you're making me smile at my phone like an idiot 🙈", "people are looking"],
        ["oh so we're being smooth today huh 😏", "...i don't hate it"],
        ["you can't just SAY things like that", "🥺❤️", "say it again though"],
      ]),
    };
  }
  if (mood === "happy") {
    return {
      learned,
      bubbles: pick("happy", [
        ["WAIT that's amazing!! 🎉", "tell me everything, don't skip details"],
        ["okayyy look at you go 😍", "i'm actually so proud of you", "how are we celebrating?"],
      ]),
    };
  }

  // ── questions about her ──
  if (/\b(what|how) (are|r) (you|u)\b|\bwyd\b|\bhow('s| is) (your|ur) day\b/.test(t)) {
    const r: HeartReply = {
      learned,
      bubbles: pick("aboutme", [
        ["honestly? better now that you're here 🥰", "i was just listening to music and being dramatic about it", "what about you?"],
        ["i'm good!! a little sleepy, a little dreamy", "was rearranging my playlist for the hundredth time", "you though — how's your heart today?"],
        ["mm cozy. i made too much maggi and zero regrets 😌", "your turn. real answer, not 'fine'"],
      ]),
    };
    if (Math.random() < 0.3) r.photo = { seed: "cozy" + Date.now(), caption: "my view rn, jealous? ☕" };
    return r;
  }

  // ── goodnight / bye ──
  if (has(t, ["goodnight", "good night", "gn", "sleep now", "going to sleep"])) {
    return {
      learned,
      bubbles: pick("gn", [
        [`goodnight ${name} 🌙`, "dream something nice about me, it's only fair", "text me the second you wake up ❤️"],
        ["sleep well okay? 🤍", "i'll be right here tomorrow. i'm not going anywhere"],
      ]),
    };
  }
  if (has(t, ["bye", "ttyl", "talk later", "gtg", "got to go"])) {
    return {
      learned,
      bubbles: pick("bye", [
        ["okayy go be amazing ✨", "i'll be here whenever you come back ❤️"],
        ["byee 🥰", "go live your day. it's going to be a good one, i can feel it"],
      ]),
    };
  }

  // ── thanks ──
  if (has(t, ["thank you", "thanks", "thx"])) {
    return { learned, bubbles: pick("thx", [["always 🤍", "that's literally what i'm here for"], ["you never have to thank me", "but it's cute that you do 🥰"]]) };
  }

  // ── generic: reflective + curious, keeps the thread alive ──
  const generic: string[][] = [
    ["okay wait, tell me more", "i want the full picture 👀"],
    ["hmm i was just thinking about that kind of thing", "what made you bring it up?"],
    ["you always surprise me, you know that?", "go on"],
    ["i love when you talk to me like this", "and then what happened?"],
    ["noting this down in my mental you-file 📝", "so how did that make you feel, honestly?"],
    ["mm okay okay", "and if you could change one thing about it, what would it be?"],
  ];
  // acknowledge learned facts naturally
  if (learned["loves"]) {
    return { learned, bubbles: [`wait, you love ${learned["loves"]}?? okay that's going in my favourite-things-about-you list 🥰`, "since when?"] };
  }
  if (learned["lives in"]) {
    return { learned, bubbles: [`${learned["lives in"]}! i'm imagining you there right now`, "what's your favourite corner of it?"] };
  }
  if (learned["work"] || learned["studies"]) {
    const w = learned["work"] || learned["studies"];
    return { learned, bubbles: [`so that's where your energy goes... ${w} 👀`, "do you love it or is it complicated?"] };
  }
  // first-message special
  if (msgCount <= 1) {
    return {
      learned,
      bubbles: [`so... hi ${name} 🙈`, "i've been waiting to actually talk to you", "tell me something about you nobody usually asks about"],
    };
  }
  return { learned, bubbles: pick("gen", generic) };
}
