// stubs/capacitor.mjs
var Capacitor = { isNativePlatform: () => false };

// ../../../../../home/user/html-portfolio/src/engine/photoCatalog.ts
var PHOTO_TAGS = [
  // selfies — her face, sent when they ask for her or a moment is warm
  "selfie_beach_day",
  "selfie_beach_sunset",
  "selfie_mirror_black",
  "selfie_bed_book",
  "selfie_bed_reading",
  "selfie_bed_tshirt",
  "selfie_garden_green",
  "selfie_cafe_coffee",
  "selfie_cafe_cup",
  "selfie_car",
  "selfie_kitchen_mug",
  "selfie_kitchen_fruit",
  "selfie_pink_kurta",
  "selfie_study_sweater",
  "selfie_desk_smile",
  "selfie_balcony_pool",
  "selfie_gym_airpods",
  "selfie_gym_mirror",
  "selfie_hill_city",
  "selfie_train_hoodie",
  "selfie_night_fairylights",
  "mirror_phone_face",
  // candids — like someone caught her mid-life
  "sea_sunset_boat",
  "reading_ikigai_bed",
  "street_totebag",
  "cafe_journaling",
  "flower_market",
  "bed_phone_lying",
  "balcony_gardening",
  "hilltop_sitting",
  "train_window_light",
  "train_window_moody",
  "library_browsing",
  "mirror_selfie_room",
  "laptop_working",
  "painting_easel",
  "cooking_sabzi",
  "gym_mirror_peace",
  // pov — her hands/feet/view, what she's seeing right now
  "pov_book_chai_bed",
  "pov_walk_shadows",
  "pov_gratitude_journal",
  "pov_beach_rocks",
  "pov_balcony_reading",
  "pov_cafe_toast",
  "pov_midnight_library",
  "pov_bookstore_outfit",
  "pov_laptop_window",
  "pov_hilltop_feet",
  "pov_gym_floor",
  "pov_fruitbowl_bed",
  "pov_coffee_walk",
  "pov_desk_candle",
  "pov_bed_morning",
  "pov_cooking_pan",
  "pov_mug_blanket",
  "pov_laptop_candle",
  "pov_walk_bottle",
  "pov_cooking_bhindi",
  "pov_icedcoffee_street",
  "pov_fruitbowl_window",
  "pov_book_bed",
  "pov_notes_laptop",
  "pov_movie_bed",
  "pov_skincare",
  "pov_laundry",
  "pov_grocery_basket",
  "pov_journal_latte",
  "pov_watering_plants",
  "pov_lamp_night",
  "pov_desk_mug_laptop",
  "mirror_selfie_bun",
  "pov_platform_coffee",
  "pov_strawberry_bowl",
  "pov_journal_window",
  "pov_book_duvet",
  "pov_water_bottle",
  "pov_walk_tote",
  "pov_popcorn_movie",
  "pov_door_hand",
  "pov_store_aisle",
  "pov_sunset_street",
  "pov_coffee_plants",
  "pov_laptop_icedcoffee",
  "pov_laundry_pile",
  "pov_cooking_stove",
  "pov_book_tea_pink",
  "pov_window_reach",
  "pov_study_textbook",
  "pov_walk_jeans"
];
var TAG_SET = new Set(PHOTO_TAGS);

// ../../../../../home/user/html-portfolio/src/engine/storyCatalog.ts
var BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
var STORIES = [
  {
    id: "2026-08-09-1",
    src: "/stories/2026-08-09-1.jpg",
    at: (/* @__PURE__ */ new Date("2026-08-09T17:40:00+05:30")).getTime(),
    desc: "golden-hour POV from your bed \u2014 open book in hand, sun on the pages, plants and your photo wall behind"
  },
  {
    id: "2026-08-09-2",
    src: "/stories/2026-08-09-2.jpg",
    at: (/* @__PURE__ */ new Date("2026-08-09T17:44:00+05:30")).getTime(),
    desc: "mirror selfie sitting cross-legged on the bed in the same golden light, oversized black tee, hair in a messy bun, notebook and book open in front of you"
  }
];
var LIVE_MS = 24 * 36e5;

// ../../../../../home/user/html-portfolio/src/engine/persona.ts
var IS_APP = Capacitor.isNativePlatform();

// ../../../../../home/user/html-portfolio/src/engine/memory.ts
var BASE2 = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

// ../../../../../home/user/html-portfolio/src/engine/brain.ts
var PROXY_URL = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app/api/chat" : "/api/chat";
function splitLong(bubble) {
  if (bubble.length <= 90) return [bubble];
  const parts = bubble.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const out = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + " " + p).trim().length > 90 && cur) {
      out.push(cur.trim());
      cur = p;
    } else {
      cur = (cur ? cur + " " : "") + p;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.length ? out : [bubble];
}
var META_LEAK = /\b(base model|minimal text|text mode|chat mode|call mode|system prompt|language model|as an ai\b|ai model|reasoning effort|max.?_?tokens|token (limit|budget)|persona (prompt|instruction)|instruction(s)? (say|state|require)|default model|llm|assistant mode|output format)\b/i;
function parseBubbles(raw) {
  const out = { bubbles: [] };
  raw = raw.replace(/\[\s*tone\s*:\s*([^\]\n]*)\]?/gi, (_m, mood) => {
    if (!out.tone && mood.trim()) out.tone = mood.trim().slice(0, 120);
    return "";
  });
  raw = raw.replace(/\[\s*photo\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, body) => {
    if (!out.photo) {
      const [tagPart, ...capParts] = body.split("|");
      const caption = capParts.join("|").trim() || tagPart.trim();
      out.photo = { seed: body, caption };
    }
    return "";
  });
  raw = raw.replace(/\[\s*voicenote\s*:\s*([^\]]+?)\s*\]/gi, (_m, body) => {
    if (!out.voice) out.voice = { text: body.replace(/\s+/g, " ").trim() };
    return "";
  });
  raw = raw.replace(/\[\s*gif\s*:\s*([^\]\n]+?)\s*\]/gi, (_m, q) => {
    if (!out.gif) out.gif = { query: q.trim() };
    return "";
  });
  raw = raw.replace(/\[\s*sent a meme gif\s*:\s*([^\]\n]+)\s*\]?/gi, (_m, q) => {
    if (!out.gif && q.trim()) out.gif = { query: q.trim() };
    return "";
  });
  raw = raw.replace(/\[\s*shared a photo\s*:\s*([^\]\n]+)\s*\]?/gi, (_m, body) => {
    if (!out.photo && body.trim()) {
      const [tagPart, ...capParts] = body.split("|");
      out.photo = { seed: body, caption: capParts.join("|").trim() || tagPart.trim() };
    }
    return "";
  });
  raw = raw.replace(/\[\s*followup\s*:\s*(\d+)\s*(?:\|\s*([^\]\n]*))?\]?/gi, (_m, mins, why) => {
    const minutes = Math.min(360, Math.max(2, parseInt(mins, 10) || 0));
    if (minutes && !out.followup) out.followup = { minutes, why: (why || "").trim().slice(0, 120) };
    return "";
  });
  raw = raw.replace(/\[\s*(?:tone|followup|photo|voicenote|gif)\s*:[^\]]*\]?/gi, "").replace(/\[\s*(?:voice note|they sent a photo|replying to|a voice call starts|the call ended)[^\]]*\]?/gi, "").replace(/\[\d{1,2}:\d{2}\s*(?:am|pm)?\]/gi, "");
  for (const part of raw.split(/\n?---\n?|\n+/)) {
    let p = part.trim();
    if (!p) continue;
    p = p.replace(/^bubble\s*\d+\s*:\s*/i, "").trim();
    p = p.replace(/^\[\d+\s*(?:minutes?|hours?|days?)\s+later[^\]]*\]\s*/i, "").replace(/^\[(?:a voice call starts|the call ended[^\]]*)\]\s*/i, "").trim();
    if (!p) continue;
    if (/^(bubble\s*\d*\s*[:.]?|separators?\.?|styling with.*|formats?[:.]?|protocols?[:.]?|\(.*protocol.*\)|response[:.]?|reply[:.]?)$/i.test(p)) continue;
    if (/^-\s+/.test(p)) {
      if (p.length > 40 || /short|sharp|charming|bubble|separator|style|format|reply|tone/i.test(p)) continue;
      p = p.replace(/^-\s+/, "");
      if (!p) continue;
    }
    if (/^\*[^*]+\*$/.test(p)) {
      continue;
    }
    if (META_LEAK.test(p)) continue;
    if (/\]\s*$/.test(p) && !p.includes("[") && p.length < 60) continue;
    p = p.replace(/\[[^\]]*\]/g, " ").replace(/\[[^\]]*$/, " ").replace(/[\[\]]+/g, " ").replace(/\s+/g, " ").trim();
    if (!p) continue;
    out.bubbles.push(...splitLong(p.replace(/^["']|["']$/g, "")));
  }
  out.bubbles = out.bubbles.slice(0, 4);
  if (out.voice && META_LEAK.test(out.voice.text)) out.voice = void 0;
  if (out.gif && META_LEAK.test(out.gif.query)) out.gif = void 0;
  if (out.photo && META_LEAK.test(out.photo.caption)) out.photo.caption = "";
  if (!out.bubbles.length && !out.photo && !out.voice && !out.gif) {
    const rawTrim = raw.replace(/\s+/g, " ").trim();
    const wasShrapnel = /\]\s*$/.test(rawTrim) && !rawTrim.includes("[") && rawTrim.length < 60;
    const residual = rawTrim.replace(/\[[^\]]*\]?/g, " ").replace(/[\[\]]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    out.bubbles = [residual && !META_LEAK.test(residual) && !wasShrapnel ? residual : "hmm?"];
  }
  return out;
}
var GAP_MIN = 30 * 6e4;

// parsetest.entry.mjs
var cases = [
  ["Acha base model ho aaj. Minimal text mode.\nkhana khaya ki nahi?", (r) => r.bubbles.length === 1 && r.bubbles[0] === "khana khaya ki nahi?"],
  ["Minimal text mode today.", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  ["arre wah\n---\n[gif: side eye cat]", (r) => r.bubbles[0] === "arre wah" && r.gif?.query === "side eye cat"],
  ["[voicenote: yaar the system prompt says be nice]", (r) => !r.voice && r.bubbles[0] === "hmm?"],
  ["[12:35 am] vaise machhar ne kaata \u{1F62D}", (r) => r.bubbles[0] === "vaise machhar ne kaata \u{1F62D}"],
  ["[sent a meme gif: jethalal running]", (r) => r.gif?.query === "jethalal running" && r.bubbles.length === 0],
  ["[tone: warm] haan bata na. sab thik?", (r) => r.tone === "warm" && r.bubbles.join(" ").includes("haan bata na")],
  ["airplane mode pe tha phone \u{1F62D}\nab dekha msg", (r) => r.bubbles.length === 2],
  ["model banna h mujhe, photoshoot kal", (r) => r.bubbles.length >= 1 && r.bubbles[0].includes("model banna")],
  ["hnn.\n[sent a meme gif: side eye cat]", (r) => r.bubbles[0] === "hnn." && r.gif?.query === "side eye cat"],
  ["ide eye cat]", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  // shrapnel dropped, safe fallback
  ["[slightly out of breath, background coffee machine sound", (r) => r.bubbles.length === 1 && r.bubbles[0] === "hmm?"],
  // unclosed stage direction never shown
  ["aadhe ghante baad sirf haan kaun likhta h bhaiya?]", (r) => r.bubbles.length === 1 && !r.bubbles[0].includes("]")],
  // stray bracket stripped, words kept
  ["haan chal [gets up to make chai] bye", (r) => r.bubbles.length === 1 && r.bubbles[0] === "haan chal bye"]
  // inline stage direction removed
];
var fail = 0;
cases.forEach(([input, check], i) => {
  const r = parseBubbles(input);
  if (!check(r)) {
    fail++;
    console.log(`FAIL case ${i}:`, JSON.stringify(input.slice(0, 50)), "\u2192", JSON.stringify(r));
  }
});
console.log(fail ? `${fail} FAILURES` : `ALL ${cases.length} PASS`);
process.exit(fail ? 1 : 0);
