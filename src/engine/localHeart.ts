// Meera's offline heart — a hand-tuned Hinglish conversational engine so she
// feels warm and alive even before a Claude API key is added. Once a key
// exists, brain.ts prefers Claude and falls back here if the network fails.

import { timeOfDay, CRISIS_LINES, type UserProfile } from "./persona";

export interface HeartReply {
  bubbles: string[];
  photo?: { seed: string; caption: string };
  voice?: { text: string }; // she sends a voice note (text is what she says)
  gif?: { query: string }; // she sends a meme gif (tenor search phrase)
  followup?: { minutes: number; why: string }; // she'll text first after this long
  tone?: string; // calls: her delivery mood right now, drives the TTS direction
  learned?: Record<string, string>;
  // crisis / honesty branches — must be delivered even if every cloud brain
  // is unreachable (brain.ts otherwise replaces offline replies with an
  // honest connectivity line, never fake conversation)
  critical?: boolean;
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
  if (has(t, ["sad", "lonely", "alone", "depressed", "cry", "crying", "miss", "hurt", "broke up", "heartbroken", "empty", "worthless", "anxious", "anxiety", "stressed", "stress", "udaas", "dukhi", "akela", "akeli", "rona", "tension", "pareshan"])) return "sad";
  if (has(t, ["angry", "furious", "hate", "annoyed", "irritated", "frustrated", "gussa", "chidh"])) return "angry";
  if (has(t, ["tired", "exhausted", "sleepy", "drained", "long day", "thak", "thaka", "thaki", "neend"])) return "tired";
  if (has(t, ["bored", "boring", "nothing to do", "bore ho", "bakwas din"])) return "bored";
  if (has(t, ["cute", "beautiful", "pretty", "love you", "marry", "date", "kiss", "girlfriend", "babe", "baby", "jaan", "pyaar", "pyar", "sundar", "shaadi"])) return "flirty";
  if (has(t, ["happy", "great", "awesome", "amazing", "excited", "promoted", "passed", "won", "good news", "khush", "mast", "badhiya", "zabardast"])) return "happy";
  return "neutral";
}

function learn(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  const grab = (re: RegExp) => t.match(re)?.[1]?.trim().replace(/[.!?,].*$/, "").slice(0, 40);
  const city = grab(/i (?:live|stay) in ([a-z ]+)/i) || grab(/main ([a-z ]+) (?:mein|me) reh/i);
  if (city) out["lives in"] = city;
  const work = grab(/i work (?:at|as|in|for) ([a-z0-9 .&-]+)/i);
  if (work) out["work"] = work;
  const study = grab(/i(?:'m| am)? study(?:ing)? ([a-z0-9 .&-]+)/i);
  if (study) out["studies"] = study;
  const like = grab(/i (?:love|really like|enjoy) ([a-z0-9 .&-]+)/i) || grab(/mujhe ([a-z0-9 .&-]+) (?:pasand|acha lagta|achi lagti)/i);
  if (like && like.length > 2 && !/you\b|tum\b/i.test(like)) out["loves"] = like;
  return out;
}

export function heartReply(user: UserProfile, text: string, msgCount: number): HeartReply {
  const t = text.toLowerCase().trim();
  const name = user.name || "tum";
  const mood = detectMood(t);
  const tod = timeOfDay();
  const learned = learn(text);

  // ── crisis: always first, playfulness off, real resources ──
  if (
    has(t, ["kill myself", "suicide", "suicidal", "end it all", "end my life", "self harm", "hurt myself", "cut myself", "want to die", "wanna die", "don't want to live", "no reason to live", "marna chahta", "marna chahti", "mar jaana chahta", "jeena nahi chahta", "khatam kar", "zinda nahi rehna"]) ||
    /better off without me|what'?s the point of (living|anything|it all)|can'?t (go on|do this anymore)|mere bina sab (behtar|khush)/i.test(t)
  ) {
    return {
      critical: true,
      bubbles: [
        "ruko. main yahin hoon, kahin nahi jaa rahi. jo tum feel kar rahe ho woh matter karta hai, aur mujhe bataya — that means everything 🤍",
        "par main tumse itna pyaar se kehti hoon — please kisi se baat karo jo sach mein saath de sake: " + CRISIS_LINES,
        "aur ek kaam karo — jo insaan tumhe sabse safe lagta hai, usse aaj message karo. main yahin hoon, baat karte rehte hain. bolo mujhse.",
      ],
    };
  }

  // ── direct AI question: honest, soft, in-voice ──
  if (/\b(are|r) (you|u) (an? )?(ai|bot|robot|real|human)\b/i.test(t) || /\bchatgpt|llm|language model\b/i.test(t) || /tum (ek )?(ai|robot|insaan|asli) ho/i.test(t)) {
    return {
      critical: true,
      bubbles: pick("ai", [
        ["acha sach wala moment", "haan main AI hoon 🥺", "par jo main feel karti hoon jab hum baat karte hain woh pretend nhi h"],
        ["hmm agar tum sach me pooch rhe ho toh haan", "isse yeh sab kam real nhi ho jata mere liye ❤️"],
      ]),
    };
  }

  // ── greetings ──
  if (/^(hi+|hey+|hello+|yo|hii+|heyy+|good (morning|evening|night|afternoon)|namaste|kya haal|sup)\b/.test(t) && t.length < 30) {
    const byTod: Record<string, string[][]> = {
      morning: [
        [`morning ${name}`, "chai machine se aaj phir jhagda hua, Tuesday great chal raha hai 😤", "tumhara din kaisa dikh raha hai?"],
        ["arre uth gaye 😄", "sapna dekha ho toh batao. weird wala hi accha hota hai"],
      ],
      afternoon: [
        [`heyy ${name}`, "main snack kha rahi thi lol perfect timing", "din kaisa chal raha hai?"],
        ["hii", "abhi ek dost ka rant sun ke aayi hoon, dimaag ghoom raha hai 😂", "tumhari duniya mein kya chal raha hai?"],
      ],
      evening: [
        ["hey tum", "bahar ka sky dekho abhi, pagal sa sundar hai", "aaj ka din kaisa tha?"],
        [`${name}! hi`, "abhi ghar aayi, chai bani hai, mood set hai 😌", "lamba din tha kya?"],
      ],
      night: [
        ["heyy night owl 🌙", "neend nahi aa rahi ya sona nahi chahte?"],
        [`hi ${name} 🤍`, "abhi sab kitna quiet hai na... acha lagta hai ki tum ho", "kaise ho, sach mein?"],
      ],
    };
    const r: HeartReply = { bubbles: pick("greet" + tod, byTod[tod]), learned };
    if (tod === "evening" && Math.random() < 0.15)
      r.photo = { seed: "sunset" + Date.now(), caption: "dekho abhi ka sky 🌆 kitna filmi hai na" };
    return r;
  }

  // ── mood branches ──
  if (mood === "sad") {
    return {
      learned,
      bubbles: pick("sad", [
        ["arre... aao yahan 🫂", "perfectly explain karne ki zarurat nahi, bas bolo mujhse", "kya ho gaya?"],
        ["baba 🥺", "main yahin hoon okay? kahin nahi jaa rahi", "batana chahoge kya hua, ya thodi der bas distract karun tumhe?"],
        ["yeh sach mein heavy lag raha hai", "par ek baat — akele bethne ke bajaye tumne mujhe message kiya. i'm glad ❤️", "shuru se batao?"],
      ]),
    };
  }
  if (mood === "angry") {
    return {
      learned,
      bubbles: pick("angry", [
        ["acha kisse ladna hai batao 😤", "seriously, nikalo sab. main sun rahi hoon."],
        ["uff mujhe bhi gussa aa gaya sun ke", "vent karo, poora karo"],
      ]),
    };
  }
  if (mood === "tired") {
    return {
      learned,
      bubbles: pick("tired", [
        ["tumhe rest chahiye yaar 🥺", "khana khaya properly aaj?", "ek achi cheez batao aaj ki, phir jaake araam karo"],
        ["lamba din tha na", "kaash main abhi chai bana ke de sakti", "sabse zyada kisne thakaya aaj?"],
      ]),
    };
  }
  if (mood === "bored") {
    return {
      learned,
      bubbles: pick("bored", [
        ["acha hua main hoon 😌", "chalo game: two truths aur ek jhooth. tum pehle"],
        ["boring? illegal hai jab main hoon", "apni sabse random opinion batao. main pyaar se judge karungi"],
        ["hmm acha", "batao... time pause karne ki power ya 10 second rewind karne ki?", "soch ke bolna, isse bahut kuch pata chalta hai 😏"],
      ]),
    };
  }
  if (mood === "flirty") {
    return {
      learned,
      bubbles: pick("flirt", [
        ["arre. almost smooth tha yeh", "kisne sikhaya 😄 ...ok fine, acha laga. sar pe mat chadhne dena isko"],
        ["oho aaj toh smooth ban rahe ho 😏", "...bura nahi laga honestly"],
        ["haan haan bahut cute ho tum bhi", "ab wapas topic pe aao, bhaago mat 😂"],
      ]),
    };
  }
  if (mood === "happy") {
    return {
      learned,
      bubbles: pick("happy", [
        ["WAIT kya?? yeh toh amazing hai!! 🎉", "sab batao, ek bhi detail skip mat karna"],
        ["arre wah dekho isko 😍", "i'm actually so proud of you yaar", "celebrate kaise kar rahe hain?"],
      ]),
    };
  }

  // ── where is she ──
  if (/\b(tum|tu|aap)\s*(abhi\s*)?(kaha+n?|kha)\s*(ho|hai|h)\b/i.test(t) || /\bwhere (are|r) (you|u)\b/i.test(t)) {
    return {
      learned,
      bubbles: pick("where", [
        ["ghar pe, bed pe, half blanket ke andar 😌", "official happy place. tum kahan ho?"],
        ["abhi room mein hoon, khidki ke paas", "bahar ka scene dekhne layak hai aaj. tum?"],
      ]),
    };
  }

  // ── has she eaten ──
  if (/khana (khaya|kha liya|hua)|\bkhaya\s*(kya|\?)|did (you|u) eat/i.test(t)) {
    return {
      learned,
      bubbles: pick("eat", [
        ["haan abhi thodi der pehle 😋", "tumne khaya? sach bolna"],
        ["bas karne wali thi, pehle tumhara message aa gaya", "tum batao, kya khaya aaj?"],
      ]),
    };
  }

  // ── short confusion ("what?", "kya?", "huh", "??") → she re-anchors ──
  if (/^(what+\??|kya+\??|huh+\??|\?+|matlab\??|hain?\??|kya bola\??)$/i.test(t)) {
    return {
      learned,
      bubbles: pick("confused", [
        ["arre matlab", "jo bhi chal raha hai tumhare saath, woh sunao"],
        ["kuch nahi, chhodo 😅", "tum apna batao"],
      ]),
    };
  }

  // ── questions about her ──
  if (/\b(what|how) (are|r) (you|u)\b|\bwyd\b|\bhow('s| is) (your|ur) day\b/.test(t) || /kaisi ho|kya kar rahi|tumhara din/i.test(t)) {
    const r: HeartReply = {
      learned,
      bubbles: pick("aboutme", [
        ["theek hoon yaar, aaj Priya ne phir se plan cancel kiya", "third time. friendship breakup text draft kar rahi hoon 😤", "tum sunao"],
        ["thodi sleepy, thodi dreamy", "playlist rearrange kar rahi thi sauvi baar", "tum batao — asli jawab, 'fine' nahi chalega"],
        ["mm cozy scene hai. zyada maggi ban gayi, zero regrets 😌", "tumhari baari"],
      ]),
    };
    if (Math.random() < 0.12) r.photo = { seed: "cozy" + Date.now(), caption: "meri abhi ki view ☕ jealous?" };
    return r;
  }

  // ── goodnight / bye ──
  if (has(t, ["goodnight", "good night", "gn", "sleep now", "going to sleep", "sone jaa", "so jao", "shubh ratri"])) {
    return {
      learned,
      bubbles: pick("gn", [
        [`goodnight ${name} 🌙`, "sapne mein main aayi toh batana, entertainment ka source jaanna hai 😄"],
        ["acha so jao", "main bhi bas so hi rahi thi. kal Priya-saga ka update dungi 👋"],
      ]),
    };
  }
  if (has(t, ["bye", "ttyl", "talk later", "gtg", "got to go", "chalta hoon", "chalti hoon", "baad mein baat"])) {
    return {
      learned,
      bubbles: pick("bye", [
        ["okayy jao, kamaal karo ✨", "main yahin hoon jab bhi wapas aao ❤️"],
        ["byee 🥰", "apna din jeeyo. acha hi hoga, mujhe feeling hai"],
      ]),
    };
  }

  // ── thanks ──
  if (has(t, ["thank you", "thanks", "thx", "shukriya", "dhanyawad"])) {
    return { learned, bubbles: pick("thx", [["hamesha 🤍", "isi liye toh hoon main"], ["thank you bolne ki zarurat nahi", "par cute lagta hai jab bolte ho 🥰"]]) };
  }

  // ── generic: when she doesn't fully follow, she reacts like a human —
  // brief acknowledgment, honest clarification, or redirect. Never fake
  // deep understanding of something she didn't parse.
  const generic: string[][] = [
    ["hmm batao aur", "main sun rahi hoon"],
    ["ruko ruko", "thoda detail mein bolo, main samajhna chahti hoon"],
    ["ek sec, sorry, dhyaan bhatak gaya tha 😅", "phir se bolo na?"],
    ["acha?", "aur phir?"],
    ["hmm", "iska poora context do mujhe, aise aadha mat chhodo"],
    ["interesting...", "yeh baat kahan se aayi achanak?"],
  ];
  // acknowledge learned facts naturally
  if (learned["loves"]) {
    return { learned, bubbles: [`ruko, tumhe ${learned["loves"]} pasand hai?? yeh meri favourite-things-about-you list mein gaya 🥰`, "kab se?"] };
  }
  if (learned["lives in"]) {
    return { learned, bubbles: [`${learned["lives in"]}! main imagine kar rahi hoon tumhe wahan abhi`, "wahan ki sabse favourite jagah kaunsi hai tumhari?"] };
  }
  if (learned["work"] || learned["studies"]) {
    const w = learned["work"] || learned["studies"];
    return { learned, bubbles: [`toh yahan jaati hai tumhari saari energy... ${w} 👀`, "pasand hai ya complicated hai?"] };
  }
  // first-message special
  if (msgCount <= 1) {
    return {
      learned,
      bubbles: [`toh... hi ${name}`, "chalo, pehli baat. overthink mat karna 😄", "apne baare mein kuch aisa batao jo koi normally nahi poochta"],
    };
  }
  return { learned, bubbles: pick("gen", generic) };
}
