// WS-R168. Sixty lines across the three languages this product ships
// (English, Hindi/Devanagari, Hinglish/Hindi-in-Roman-script), used by
// `run.mjs` to measure `api/_voice/prosody.js`'s deterministic timing proxy
// (`estimateProsodyTimingMs`) across every rate band and register. Twenty
// per language, a mix of one-sentence and multi-sentence lines so the
// sentence-boundary pause term is exercised as well as the per-character
// rate term.
export const PROSODY_LINES = [
  // ── English (20) ──────────────────────────────────────────────────────
  { id: "en-01", lang: "en", text: "I am fine." },
  { id: "en-02", lang: "en", text: "I am fine. How are you?" },
  { id: "en-03", lang: "en", text: "Okay." },
  { id: "en-04", lang: "en", text: "Sure, let's do that." },
  { id: "en-05", lang: "en", text: "That's amazing! I can't believe it." },
  { id: "en-06", lang: "en", text: "Are you coming? Or should I go alone?" },
  { id: "en-07", lang: "en", text: "Wait, tell me everything from the start." },
  { id: "en-08", lang: "en", text: "We met at six. We talked for an hour. Then we left." },
  { id: "en-09", lang: "en", text: "Honestly, I don't know what to say." },
  { id: "en-10", lang: "en", text: "It's late, I should sleep." },
  { id: "en-11", lang: "en", text: "That is genuinely one of the funniest things I have heard all week." },
  { id: "en-12", lang: "en", text: "Not now." },
  { id: "en-13", lang: "en", text: "Congratulations! You actually did it." },
  { id: "en-14", lang: "en", text: "Take your time, there's no rush." },
  { id: "en-15", lang: "en", text: "So, what happened next?" },
  { id: "en-16", lang: "en", text: "I called. You didn't answer. I tried again." },
  { id: "en-17", lang: "en", text: "This is fine, don't worry about it." },
  { id: "en-18", lang: "en", text: "Yes! A thousand times yes." },
  { id: "en-19", lang: "en", text: "Fine." },
  { id: "en-20", lang: "en", text: "Let's plan it properly this time, with dates and everything." },

  // ── Hindi, Devanagari (20) ───────────────────────────────────────────
  { id: "hi-01", lang: "hi", text: "मैं ठीक हूँ।" },
  { id: "hi-02", lang: "hi", text: "मैं ठीक हूँ। तुम कैसे हो?" },
  { id: "hi-03", lang: "hi", text: "ठीक है।" },
  { id: "hi-04", lang: "hi", text: "हाँ, चलो करते हैं।" },
  { id: "hi-05", lang: "hi", text: "वाह! मुझे यकीन नहीं हो रहा।" },
  { id: "hi-06", lang: "hi", text: "तुम आ रहे हो? या मैं अकेला जाऊं?" },
  { id: "hi-07", lang: "hi", text: "रुको, मुझे पूरी बात बताओ।" },
  { id: "hi-08", lang: "hi", text: "हम छह बजे मिले। एक घंटे बात की। फिर चले गए।" },
  { id: "hi-09", lang: "hi", text: "सच में, मुझे कुछ समझ नहीं आ रहा।" },
  { id: "hi-10", lang: "hi", text: "देर हो गई है, अब सोना चाहिए।" },
  { id: "hi-11", lang: "hi", text: "यह वाकई इस हफ़्ते की सबसे मज़ेदार बात है जो मैंने सुनी है।" },
  { id: "hi-12", lang: "hi", text: "अभी नहीं।" },
  { id: "hi-13", lang: "hi", text: "बधाई हो! तुमने कर दिखाया।" },
  { id: "hi-14", lang: "hi", text: "आराम से, जल्दी कोई बात नहीं।" },
  { id: "hi-15", lang: "hi", text: "तो आगे क्या हुआ?" },
  { id: "hi-16", lang: "hi", text: "मैंने फ़ोन किया। तुमने उठाया नहीं। मैंने फिर कोशिश की।" },
  { id: "hi-17", lang: "hi", text: "सब ठीक है, चिंता मत करो।" },
  { id: "hi-18", lang: "hi", text: "हाँ! बिल्कुल हाँ।" },
  { id: "hi-19", lang: "hi", text: "ठीक।" },
  { id: "hi-20", lang: "hi", text: "इस बार सही से योजना बनाते हैं, तारीखों के साथ।" },

  // ── Hinglish, Hindi in Roman script (20) ─────────────────────────────
  { id: "hiL-01", lang: "hi-Latn", text: "Main theek hoon." },
  { id: "hiL-02", lang: "hi-Latn", text: "Main theek hoon. Tum kaise ho?" },
  { id: "hiL-03", lang: "hi-Latn", text: "Theek hai." },
  { id: "hiL-04", lang: "hi-Latn", text: "Haan, chalo karte hain." },
  { id: "hiL-05", lang: "hi-Latn", text: "Wah! Mujhe yakeen nahi ho raha." },
  { id: "hiL-06", lang: "hi-Latn", text: "Tum aa rahe ho? Ya main akela jaaun?" },
  { id: "hiL-07", lang: "hi-Latn", text: "Ruko, mujhe poori baat batao." },
  { id: "hiL-08", lang: "hi-Latn", text: "Hum chhah baje mile. Ek ghante baat ki. Phir chale gaye." },
  { id: "hiL-09", lang: "hi-Latn", text: "Sach mein, mujhe kuch samajh nahi aa raha." },
  { id: "hiL-10", lang: "hi-Latn", text: "Der ho gayi hai, ab sona chahiye." },
  { id: "hiL-11", lang: "hi-Latn", text: "Yeh waakai is hafte ki sabse mazedaar baat hai jo maine suni hai." },
  { id: "hiL-12", lang: "hi-Latn", text: "Abhi nahi." },
  { id: "hiL-13", lang: "hi-Latn", text: "Badhai ho! Tumne kar dikhaya." },
  { id: "hiL-14", lang: "hi-Latn", text: "Aaram se, jaldi koi baat nahi." },
  { id: "hiL-15", lang: "hi-Latn", text: "Toh aage kya hua?" },
  { id: "hiL-16", lang: "hi-Latn", text: "Maine phone kiya. Tumne uthaya nahi. Maine phir koshish ki." },
  { id: "hiL-17", lang: "hi-Latn", text: "Sab theek hai, chinta mat karo." },
  { id: "hiL-18", lang: "hi-Latn", text: "Haan! Bilkul haan." },
  { id: "hiL-19", lang: "hi-Latn", text: "Theek." },
  { id: "hiL-20", lang: "hi-Latn", text: "Is baar sahi se yojana banate hain, taarikhon ke saath." },
];
