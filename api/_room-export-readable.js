// The follower's READABLE export (WS-R108). "Take everything out" (WS-R1/
// WS-R27, `roomExport` in `api/_room-surface.js`) already gives a follower a
// complete JSON archive, proven complete by `evals/room-export`. A parent, a
// lawyer or the follower themselves cannot READ it — DPDP's right to access
// is a right to UNDERSTAND what is held, not merely to receive it. This file
// is the other half: one printable HTML document, in the follower's own
// locale, built from `roomExport`'s OWN return value and nothing else.
//
// ── A PURE BUILDER, LIKE `api/_receipt.js` BEFORE IT ────────────────────────
//
// `buildRoomExportReadableHtml` takes the object `roomExport()` already
// built and a locale, and returns a string. No `db`, no `session`, no
// network — it cannot read a table `roomExport` did not already read, which
// is the whole safety property this file rests on: completeness and scope
// are `roomExport`'s job (`evals/room-export`'s own release gate proves
// them), and this file's only job is turning what it was HANDED into
// something a human can read and print. `api/room.js`'s `format: "html"`
// branch (the receipt's own precedent, WS-R100) is the one caller: it
// already ran `roomExport` before deciding whether to hand the JSON back or
// build this page from it, so every session/bearer check `evals/room-doors`
// proves for `export` already ran by the time this file ever sees a byte.
//
// ── THE COPY TABLE, AND WHY A MISSING ENTRY THROWS RATHER THAN SKIPS ───────
//
// `TABLE_COPY` below names, in both locales, what every table `roomExport`
// can ever put in its `tables` object actually holds, in one plain sentence
// each — no jargon, no table name, written for the parent/lawyer/follower
// this workstream's brief names, never for someone who already knows what a
// `vy_rel_state` is. Completeness is INHERITED, never restated:
// `roomExportManifest()` (`api/_room-surface.js`) is the one list of every
// table `roomExport` can reach, and `evals/room-export-readable/run.mjs`
// asserts every name on it has an entry here, so a table added to that
// manifest and forgotten here fails the gate by name rather than rendering a
// document silently missing a section. `tableSection` below enforces the
// same rule at RUNTIME, not only in the eval: a table present in the export
// this file was actually handed but ABSENT from `TABLE_COPY` throws, naming
// the table, rather than quietly dropping the section — the negative
// control the workstream brief's law 4 asks for is this exact throw, fired
// by removing one entry from a COPY of this table, never the real one.
//
// ── NO SCRIPT, NO EXTERNAL RESOURCE ──────────────────────────────────────
//
// `api/_receipt.js`'s printable page carries one `<button onclick=
// "window.print()">` — small, but still a script, and this document may
// carry none (the workstream brief's own words). There is no print button
// here; a browser's own Ctrl/Cmd+P prints this page exactly as it renders,
// and the inline `@media print` block below narrows it to A4 with no
// further help needed. Every byte other than the follower's own data is
// inline: one `<style>` block, no `<link>`, no `<script>`, no web font, no
// image. Note also: this builder takes `exportResult.room` directly (already
// the follower-facing slug `roomExport` itself resolved, `api/_room-
// surface.js`) rather than importing anything from that file to re-derive a
// display name - a pure function with no imports back into the module that
// calls it, so the two can never disagree about load order.

/** RFC 4648-adjacent escaping for HTML text content — `api/_receipt.js`'s
 *  own `escapeHtml`, restated rather than imported: this house's standing
 *  convention (`ROOM_EXPORT_EXTRA`'s own comment in `_room-surface.js` names
 *  it) is that a tiny pure helper is copied per module rather than pulled
 *  across a module boundary for one function, so no two decision modules'
 *  load order can ever matter for a helper this small. */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** `created_at` -> `Created at`. Sentence case, spaces for underscores,
 *  nothing cleverer: this is a generic column-name humanizer for whatever
 *  columns a `select *` happened to return, never a per-column dictionary
 *  that could drift the day a table gains a column — the exact same
 *  "generic over the manifest, never restated per table" property
 *  `roomExport`'s own `select *` already rests on, one layer up. */
function humanizeColumn(name) {
  const words = String(name || "").split("_").filter(Boolean);
  if (words.length === 0) return String(name || "");
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** WS-R79's own law (`src/room/copy.ts`'s `detectRoomTextLang`, `api/
 *  _creator-page.js`'s restatement): the DOCUMENT's own `lang` names the
 *  follower's chosen chrome language, never what one particular piece of
 *  TEXT happens to be written in, so any node whose own script does not
 *  obviously match needs its own tag. Two kinds of node on this page are not
 *  guaranteed to match `loc`: a column name (`humanizeColumn`'s own output
 *  is always Latin-script, a raw DB identifier, never translated - `lang=
 *  "en"` on every `<th>`, unconditionally) and a DATA CELL, which can be
 *  anything a follower or a creator actually typed (a handoff message, a
 *  channel name, a state enum) regardless of which locale this document was
 *  requested in - detected from the cell's own characters, this file's own
 *  restatement of the same Devanagari range `src/room/copy.ts` and `api/
 *  _creator-page.js` already restate rather than import (two runtimes, no
 *  shared boundary to cross, `src/room/copy.ts`'s own header explains why a
 *  third/fourth copy is the correct move rather than a shared import). */
const DEVANAGARI_RANGE = /[ऀ-ॿ]/;
function detectTextLang(text) {
  return DEVANAGARI_RANGE.test(String(text || "")) ? "hi" : "en";
}

/** One table cell, as text. Arrays/objects (a `jsonb` column, a `bigint[]`
 *  citation list) render as compact JSON rather than `[object Object]`;
 *  `null`/`undefined`/empty string render as a plain hyphen, never an em
 *  dash or en dash (the same dash law `scripts/check-copy.mjs` enforces on
 *  every user-visible string this product ships, restated here even though
 *  `api/` is outside that gate's own scan scope — a follower reading a
 *  printed page should never see two different punctuation marks that look
 *  almost the same for the same "nothing here" idea depending which door
 *  they exported through). */
function cellText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Every table `roomExportManifest()` (`api/_room-surface.js`) can ever name,
 * in both locales, one plain sentence each. An ARRAY of `{ table, en, hi }`
 * entries — `ROOM_EXPORT_EXTRA`'s own shape in `_room-surface.js`, one
 * indirection wider — rather than an object keyed by table name, and that is
 * a real, load-bearing choice, not a style preference: `evals/room-leak/
 * run.mjs`/`world.mjs`'s static reach layer scans every `api/*.js` file for
 * any line naming a Room-scoped table and requires it to match a short list
 * of KNOWN-SAFE shapes, one of which is exactly `table:\s*"vy_` — the same
 * pattern `ROOM_EXPORT_EXTRA`'s own entries already satisfy. A plain object
 * key (`vy_room_checkin: {`) matches none of those shapes and fails that
 * gate as an "unsafe line" naming a guarded table with no recognisable
 * excuse, discovered by actually running the release gate rather than
 * guessed (`context/rejected.md#ws-r108-table-copy-as-a-keyed-object-failed-the-leak-batterys-static-reach-layer`).
 * Grouped by where the row comes from in THIS file's own comments only — the
 * document itself renders every section in the same order `roomExport`'s
 * own object carries them in (`roomScopedTables` first, `ROOM_EXPORT_EXTRA`
 * next, the referral count last), never re-sorted, so this file never has to
 * agree with itself twice about ordering.
 *
 * Plain language, no product jargon, no table name repeated inside its own
 * sentence — the DPDP standard this workstream's brief names: a parent, a
 * lawyer or the follower themselves has to understand what is held from the
 * sentence alone. Never "clone"/"replica"/"model"/"genome"/"weights"/
 * "embedding"/"fine-tune"/"train"/"LoRA" — `scripts/check-copy.mjs`'s Rooms
 * vocabulary rule does not scan `api/`, but this product's own voice does
 * not stop at the edge of a gate's scan list.
 */
export const TABLE_COPY = Object.freeze([
  // ── the legacy conversation engine (meera_*, agent-scoped by device) ─────
  { table: "meera_log",
    en: "The individual messages exchanged with this room's AI.",
    hi: "इस रूम की AI के साथ हुए अलग-अलग संदेश।",
  },
  { table: "meera_nodes",
    en: "People, places and things this AI has noted from talking with you.",
    hi: "लोग, जगहें और चीज़ें, जो इस AI ने आपकी बातचीत से नोट की हैं।",
  },
  { table: "meera_edges",
    en: "How those people, places and things connect to each other, as this AI understands it.",
    hi: "वे लोग, जगहें और चीज़ें आपस में कैसे जुड़ी हैं, जैसा यह AI समझता है।",
  },
  { table: "meera_forget",
    en: "Words you already asked this AI to forget, kept only so it does not learn them again.",
    hi: "वे शब्द जो आपने पहले इस AI को भुलाने को कहा था, सिर्फ इसलिए रखे गए हैं ताकि यह उन्हें दोबारा न सीखे।",
  },
  // ── the relationship graph (vy_*, agent-scoped by person) ────────────────
  { table: "vy_episode",
    en: "A summary of one conversation or call with this AI, broken into a natural section.",
    hi: "इस AI के साथ हुई किसी एक बातचीत या कॉल का सारांश, एक स्वाभाविक हिस्से में बंटा हुआ।",
  },
  { table: "vy_taste_candidate",
    en: "A pattern this AI noticed and set aside for the creator to review before using it.",
    hi: "एक पैटर्न जो इस AI ने नोटिस किया और इस्तेमाल करने से पहले क्रिएटर की समीक्षा के लिए अलग रखा।",
  },
  { table: "vy_visual_assertion",
    en: "Something this AI noted from a photo or video you shared during a call.",
    hi: "कोई बात जो इस AI ने कॉल के दौरान आपकी दिखाई फ़ोटो या वीडियो से नोट की।",
  },
  { table: "vy_shared_moment",
    en: "A reaction this AI had, in the moment, to something you showed it.",
    hi: "इस AI की उस पल की प्रतिक्रिया, जब आपने इसे कुछ दिखाया।",
  },
  { table: "vy_fact",
    en: "A fact this AI has stored about you, your world, or your relationship with it.",
    hi: "एक तथ्य जो इस AI ने आपके बारे में, आपकी दुनिया के बारे में, या आपके रिश्ते के बारे में सहेजा है।",
  },
  { table: "vy_rel_event",
    en: "A recorded shift in how this AI relates to you, for example when it started being more familiar.",
    hi: "यह AI आपसे कैसे जुड़ता है, इसमें दर्ज बदलाव, जैसे जब यह ज़्यादा अपनापन दिखाने लगा।",
  },
  { table: "vy_rel_state",
    en: "This AI's current read on your relationship, for example how familiar it is with you.",
    hi: "आपके रिश्ते के बारे में इस AI की मौजूदा समझ, जैसे यह आपसे कितना अपनापन रखता है।",
  },
  { table: "vy_pattern",
    en: "A repeating pattern this AI has noticed in how the two of you interact.",
    hi: "आप दोनों की बातचीत में इस AI ने जो दोहराया जाने वाला पैटर्न नोटिस किया है।",
  },
  { table: "vy_phrase",
    en: "A word or phrase the two of you have used together that this AI remembers.",
    hi: "आप दोनों का साथ में इस्तेमाल किया कोई शब्द या वाक्यांश, जो इस AI को याद है।",
  },
  { table: "vy_kin",
    en: "A family member or friend of yours that this AI knows about.",
    hi: "आपके परिवार का कोई सदस्य या दोस्त, जिसके बारे में इस AI को पता है।",
  },
  { table: "vy_ritual",
    en: "A small repeating thing between you and this AI, for example a regular good-morning.",
    hi: "आपके और इस AI के बीच की एक छोटी दोहराई जाने वाली बात, जैसे रोज़ की सुप्रभात।",
  },
  { table: "vy_currency",
    en: "A topic the two of you keep returning to, for example a team or a place, and how often it comes up.",
    hi: "एक विषय जिस पर आप दोनों बार-बार लौटते हैं, जैसे कोई टीम या जगह, और यह कितनी बार आता है।",
  },
  { table: "vy_india_profile",
    en: "Personal details, such as your mother tongue or home region, that you separately agreed this AI could hold.",
    hi: "व्यक्तिगत जानकारी, जैसे आपकी मातृभाषा या गृहनगर, जिसे रखने के लिए आपने अलग से सहमति दी थी।",
  },
  { table: "vy_rel_texture",
    en: "How this AI has learned to talk with you specifically, for example how much it teases or how long its replies run.",
    hi: "इस AI ने आपसे बात करने का तरीका कैसे सीखा है, जैसे यह कितना छेड़ता है या इसके जवाब कितने लंबे होते हैं।",
  },
  { table: "vy_observation",
    en: "Something this AI noticed about you that has not yet become a settled pattern.",
    hi: "आपके बारे में कोई बात जो इस AI ने नोटिस की है, पर अभी एक तय पैटर्न नहीं बनी है।",
  },
  { table: "vy_agent_life_told",
    en: "A record of which of this AI's own stories it has already told you, so it does not repeat itself.",
    hi: "यह दर्ज कि इस AI ने अपनी कौन सी बातें आपको पहले ही बता दी हैं, ताकि यह दोहराए नहीं।",
  },
  { table: "vy_embedding",
    en: "A technical index this AI uses to find your own memories again. It holds no readable content of its own.",
    hi: "एक तकनीकी सूची जिसका उपयोग यह AI आपकी यादें दोबारा ढूंढने के लिए करता है। इसमें अपनी कोई पढ़ने लायक जानकारी नहीं होती।",
  },
  { table: "vy_derivation",
    en: "A record of when this AI last processed your conversations into the memories above, kept for audit.",
    hi: "यह दर्ज कि इस AI ने आपकी बातचीत को ऊपर दी गई यादों में आख़िरी बार कब बदला, ऑडिट के लिए रखा गया।",
  },
  { table: "vy_session",
    en: "A record of one continuous conversation window with this AI.",
    hi: "इस AI के साथ एक लगातार बातचीत के दौर का रिकॉर्ड।",
  },
  { table: "vy_group_member",
    en: "Your own membership in a group conversation with this AI, if you are in one.",
    hi: "इस AI के साथ किसी समूह बातचीत में आपकी अपनी सदस्यता, अगर आप उसमें हैं।",
  },
  { table: "vy_disclosure_grant",
    en: "A permission you gave for something you said to be shared with someone else in a group conversation.",
    hi: "आपकी दी हुई अनुमति कि आपकी कही कोई बात समूह बातचीत में किसी और के साथ साझा हो।",
  },
  { table: "vy_push_token",
    en: "Your device's own registration to receive notifications from this AI.",
    hi: "आपके डिवाइस का इस AI से सूचनाएं पाने के लिए पंजीकरण।",
  },
  { table: "vy_replica_dialogue_turn",
    en: "One turn of a voice call with this creator's AI, kept for quality and safety.",
    hi: "इस क्रिएटर की AI के साथ हुई वॉइस कॉल का एक हिस्सा, गुणवत्ता और सुरक्षा के लिए रखा गया।",
  },
  { table: "vy_replica_runtime_session",
    en: "One voice call session you had with this creator's AI.",
    hi: "इस क्रिएटर की AI के साथ आपकी एक वॉइस कॉल का सेशन।",
  },
  { table: "vy_replica_runtime_capability",
    en: "The voice-call setup this AI uses to speak with you.",
    hi: "इस AI का वह सेटअप जिससे यह आपसे वॉइस कॉल पर बात करता है।",
  },
  { table: "vy_room_thread",
    en: "One of your conversation threads in this room.",
    hi: "इस रूम में आपकी एक बातचीत की थ्रेड।",
  },
  { table: "vy_room_follower",
    en: "Your own membership record in this room, including your tier and your message counts.",
    hi: "इस रूम में आपकी अपनी सदस्यता का रिकॉर्ड, जिसमें आपका स्तर और आपके संदेशों की गिनती शामिल है।",
  },
  // ── the eleven Room-specific extras (WS-R27/WS-R29/WS-R30/WS-R37/WS-R67/
  //    WS-R100, `ROOM_EXPORT_EXTRA` in `api/_room-surface.js`) ─────────────
  { table: "vy_room_checkin",
    en: "Your check-in schedule: which days, what time, and your timezone.",
    hi: "आपका चेक-इन शेड्यूल: कौन से दिन, कौन सा समय, और आपका टाइमज़ोन।",
  },
  { table: "vy_room_subscription",
    en: "Your subscription record for this room.",
    hi: "इस रूम के लिए आपकी सदस्यता का रिकॉर्ड।",
  },
  { table: "vy_room_pulse_optin",
    en: "Your choice to let one of your conversations count toward this creator's own privacy-safe totals.",
    hi: "आपकी यह पसंद कि आपकी एक बातचीत क्रिएटर के गोपनीयता-सुरक्षित कुल आंकड़ों में गिनी जाए।",
  },
  { table: "vy_room_follower_channel",
    en: "Your Telegram connection to this room.",
    hi: "इस रूम से आपका Telegram कनेक्शन।",
  },
  { table: "vy_room_push_subscription",
    en: "Your browser's registration to receive push notifications from this room.",
    hi: "इस रूम से पुश सूचनाएं पाने के लिए आपके ब्राउज़र का पंजीकरण।",
  },
  { table: "vy_room_handoff",
    en: "A message you asked to be passed to the creator directly, and their reply.",
    hi: "एक संदेश जो आपने क्रिएटर तक सीधे पहुंचाने को कहा था, और उनका जवाब।",
  },
  { table: "vy_room_upgrade_offer",
    en: "A record of when you were offered a paid upgrade and what you did about it.",
    hi: "यह दर्ज कि आपको कब एक भुगतान वाला अपग्रेड दिखाया गया और आपने क्या किया।",
  },
  { table: "vy_room_follower_day",
    en: "How many messages you sent, counted by day.",
    hi: "आपने कितने संदेश भेजे, दिन के हिसाब से गिने गए।",
  },
  { table: "vy_room_checkin_delivery",
    en: "How many scheduled check-ins were sent to you, counted by outcome.",
    hi: "आपको कितने तय चेक-इन भेजे गए, नतीजे के हिसाब से गिने गए।",
  },
  { table: "vy_room_voice_usage",
    en: "How many seconds of voice you used, counted by day.",
    hi: "आपने कितने सेकंड की वॉइस इस्तेमाल की, दिन के हिसाब से गिनी गई।",
  },
  { table: "vy_room_follower_whatsapp",
    en: "Your WhatsApp connection to this room, with most of your number hidden.",
    hi: "इस रूम से आपका WhatsApp कनेक्शन, जिसमें आपके नंबर का ज़्यादातर हिस्सा छिपाया गया है।",
  },
  // WS-R104 (migration 128), added at the wave-sixteen merge: the pointer
  // that says which room your WhatsApp number talks to. The export carries
  // its state and dates only; the number itself is never stored, only a
  // one-way hash the export does not hand back.
  { table: "vy_room_follower_whatsapp_chat",
    en: "Which room your WhatsApp chats reach, when you joined it there, and whether you stopped.",
    hi: "आपकी WhatsApp चैट किस रूम तक पहुंचती है, आप वहां कब जुड़े, और क्या आपने रोक दिया।",
  },
  { table: "vy_renewal_reminder",
    en: "How many renewal reminders this room sent you.",
    hi: "इस रूम ने आपको कितनी नवीनीकरण याद-दिलाने वाली सूचनाएं भेजीं।",
  },
  { table: "vy_room_follower_reply_flag",
    en: "A reply from this AI that you flagged, and why.",
    hi: "इस AI का एक जवाब जिसे आपने चिह्नित किया, और क्यों।",
  },
  { table: "vy_receipt",
    en: "One of your payment receipts for this room.",
    hi: "इस रूम के लिए आपकी एक भुगतान रसीद।",
  },
  { table: "vy_room_referral",
    en: "How many people joined this room using your own invite link.",
    hi: "आपके अपने आमंत्रण लिंक से कितने लोग इस रूम में शामिल हुए।",
  },
]);

/** `TABLE_COPY`'s own name -> entry index, built once. Kept separate from
 *  `TABLE_COPY` itself (an array, `ROOM_EXPORT_EXTRA`'s own shape one line
 *  up's own header explains why) so a lookup here costs one Map read rather
 *  than a linear scan per table, without changing what `TABLE_COPY` itself
 *  exports or how `evals/room-export-readable/run.mjs` iterates it. */
const TABLE_COPY_BY_NAME = new Map(TABLE_COPY.map((entry) => [entry.table, entry]));
function tableCopyFor(table) {
  return TABLE_COPY_BY_NAME.get(table);
}

/** The page's own chrome — heading, dates, the closing note. Never the
 *  per-table sentences above, which are looked up by table name instead so
 *  a new table's copy lands in exactly one place. */
const PAGE_COPY = Object.freeze({
  en: {
    docTitle: (room) => `Your data - ${room} AI`,
    heading: (room) => `Everything ${room} AI holds about you`,
    generatedOn: "Generated on",
    scopeNote:
      "This page covers only your relationship with this creator's AI. Your " +
      "account, your device links and your conversations with other creators " +
      "are not in here because this creator's AI does not hold them.",
    emptySection: "Nothing recorded here yet.",
    countLabel: (n) => `${n} record${n === 1 ? "" : "s"}.`,
    stateLabel: "State",
    numberLabel: "Number",
    forgetHeading: "Asking to be forgotten",
    forgetBody:
      "You can ask this room's AI to forget you at any time, from your own " +
      "settings page. It deletes everything above that is scoped to this room, " +
      "and gives you back one receipt: a count for everything that was " +
      "deleted, with nothing on it that names you, and nothing that can be " +
      "looked up later by anyone, including us. Your account and any other " +
      "room you are in are untouched.",
    printNote: "This page has no button of its own - your browser's own print (Ctrl or Cmd P) turns it into a PDF or a paper copy.",
  },
  hi: {
    docTitle: (room) => `आपका डेटा - ${room} AI`,
    heading: (room) => `${room} AI के पास आपके बारे में जो कुछ है`,
    generatedOn: "बनाया गया",
    scopeNote:
      "यह पेज सिर्फ इस क्रिएटर की AI के साथ आपके रिश्ते को दिखाता है। आपका खाता, " +
      "आपके डिवाइस के लिंक, और दूसरे क्रिएटर के साथ आपकी बातचीत यहां नहीं है, " +
      "क्योंकि इस क्रिएटर की AI के पास वे हैं ही नहीं।",
    emptySection: "अभी तक यहां कुछ दर्ज नहीं है।",
    countLabel: (n) => `${n} रिकॉर्ड।`,
    stateLabel: "स्थिति",
    numberLabel: "नंबर",
    forgetHeading: "भुला देने के लिए कहना",
    forgetBody:
      "आप कभी भी, अपने सेटिंग्स पेज से, इस रूम की AI को खुद को भुला देने के लिए कह " +
      "सकते हैं। इससे ऊपर की हर वह चीज़ मिट जाती है जो इस रूम तक सीमित है, और आपको " +
      "एक रसीद मिलती है: हर मिटाई गई चीज़ की गिनती, जिस पर आपका नाम कहीं नहीं होता, " +
      "और जिसे बाद में कोई भी, हम भी नहीं, दोबारा खोज सकता। आपका खाता और कोई भी " +
      "दूसरा रूम जिसमें आप हैं, अनछुआ रहता है।",
    printNote: "इस पेज पर अपना कोई बटन नहीं है - आपके ब्राउज़र का अपना प्रिंट (Ctrl या Cmd P) इसे PDF या कागज़ की कॉपी बना देता है।",
  },
});

/** One table's own section: a heading (the table's human name, taken from
 *  its own first sentence so it never has to be written twice), the plain
 *  sentence, and either a data table (rows shape) or a short line (count/
 *  masked_phone shape, `roomExport`'s own two non-row shapes,
 *  `ROOM_EXPORT_EXTRA` in `api/_room-surface.js`). Throws by NAME when
 *  `TABLE_COPY` carries no entry for a table this file was actually handed -
 *  the negative control the workstream brief's law 4 names, and the runtime
 *  twin of `evals/room-export-readable/run.mjs`'s own static completeness
 *  check against `roomExportManifest()`. */
function tableSection(table, value, loc) {
  const meta = tableCopyFor(table);
  if (!meta) {
    throw Object.assign(
      new Error(`buildRoomExportReadableHtml: no readable explanation on file for table "${table}"`),
      { code: "room_export_readable_missing_copy", table },
    );
  }
  const sentence = meta[loc] || meta.en;
  const c = PAGE_COPY[loc];
  const heading = humanizeColumn(table.replace(/^vy_|^meera_/, ""));
  let body;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      body = `<p class="empty">${escapeHtml(c.emptySection)}</p>`;
    } else {
      const columns = Object.keys(value[0]);
      // `lang="en"` unconditionally: a column name is a raw DB identifier,
      // never translated, `humanizeColumn`'s own comment restated.
      const head = columns.map((col) => `<th lang="en">${escapeHtml(humanizeColumn(col))}</th>`).join("");
      const rows = value
        .map((row) => `<tr>${columns
          .map((col) => {
            const text = cellText(row[col]);
            return `<td lang="${detectTextLang(text)}">${escapeHtml(text)}</td>`;
          })
          .join("")}</tr>`)
        .join("");
      body = `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
    }
  } else if (value && typeof value === "object" && "phone_masked" in value) {
    // masked_phone shape (`vy_room_follower_whatsapp`): a count, a state,
    // and the number with its middle digits already replaced by
    // `maskPhoneForExport` - rendered exactly as received, never re-derived.
    // `state` is a closed enum (never a word the follower typed) but still
    // Latin-script data on a page that may be Hindi, so it gets the same
    // per-node tag a data cell would.
    body =
      `<p>${escapeHtml(c.stateLabel)}: <span lang="${detectTextLang(cellText(value.state))}">${escapeHtml(cellText(value.state))}</span>` +
      `<br>${escapeHtml(c.numberLabel)}: <span lang="en">${escapeHtml(cellText(value.phone_masked))}</span></p>`;
  } else if (value && typeof value === "object" && "count" in value) {
    body = `<p>${escapeHtml(c.countLabel(Number(value.count) || 0))}</p>`;
  } else {
    // Structurally unreachable against the real `roomExport` (every entry is
    // one of the three shapes above), kept as an honest fallback rather than
    // a silent drop should a future shape land here before this file does.
    body = `<p>${escapeHtml(cellText(value))}</p>`;
  }
  return `<section><h2>${escapeHtml(heading)}</h2><p class="explain">${escapeHtml(sentence)}</p>${body}</section>`;
}

function dateLabel(iso, loc) {
  try {
    return new Date(iso).toLocaleDateString(loc === "hi" ? "hi-IN" : "en-IN", {
      year: "numeric", month: "long", day: "2-digit", timeZone: "Asia/Kolkata",
    });
  } catch {
    return String(iso || "").slice(0, 10);
  }
}

/**
 * The printable page. `exportResult` is `roomExport`'s OWN return value
 * (`api/_room-surface.js`) - never re-read, never re-queried. `locale` is
 * `exportResult.locale` in every real caller (`api/room.js`'s `format:
 * "html"` branch passes it straight through); a caller that omits it gets
 * English, `roomDisclosureCard`'s own fallback restated.
 *
 * Sections render in the SAME order `exportResult.tables`'s own keys carry
 * (JS preserves string-key insertion order, and `roomExport` builds that
 * object in one fixed sequence: `roomScopedTables` first, `ROOM_EXPORT_EXTRA`
 * next, the referral count last) - never re-sorted, so a reader comparing
 * this page against the JSON download sees the same tables in the same
 * order in both.
 */
export function buildRoomExportReadableHtml(exportResult, locale = "en") {
  if (!exportResult || typeof exportResult !== "object") {
    throw new Error("buildRoomExportReadableHtml: exportResult is required");
  }
  const loc = locale === "hi" ? "hi" : "en";
  const c = PAGE_COPY[loc];
  const roomLabel = String(exportResult.room || "");
  const generatedAt = exportResult.exported_at || new Date().toISOString();
  const tables = exportResult.tables && typeof exportResult.tables === "object" ? exportResult.tables : {};
  const sections = Object.entries(tables)
    .map(([table, value]) => tableSection(table, value, loc))
    .join("");
  const noSections = Object.keys(tables).length === 0
    ? `<p class="empty">${escapeHtml(c.emptySection)}</p>`
    : "";
  return `<!doctype html><html lang="${loc}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(c.docTitle(roomLabel))}</title>` +
    `<style>
      body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
      h1{font-size:1.25rem;margin-bottom:.25rem}
      h2{font-size:1rem;margin:1.75rem 0 .25rem;border-top:1px solid #ddd;padding-top:1rem}
      p{line-height:1.5}
      p.explain{color:#333;margin:.25rem 0 .75rem}
      p.empty{color:#666;font-style:italic}
      table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem;font-size:.85rem}
      th,td{padding:.35rem .5rem;border-bottom:1px solid #ddd;text-align:left;word-break:break-word}
      th{background:#f4f4f4;font-weight:600}
      .fine{color:#555;font-size:.8rem;margin-top:.5rem}
      .meta{color:#555;font-size:.9rem}
      @page{size:A4;margin:16mm}
      @media print{
        body{margin:0;max-width:none}
        h2{break-inside:avoid-page}
        table{break-inside:avoid-page}
      }
    </style></head><body>` +
    `<h1>${escapeHtml(c.heading(roomLabel))}</h1>` +
    `<p class="meta">${escapeHtml(c.generatedOn)}: ${escapeHtml(dateLabel(generatedAt, loc))}</p>` +
    `<p>${escapeHtml(c.scopeNote)}</p>` +
    sections +
    noSections +
    `<section><h2>${escapeHtml(c.forgetHeading)}</h2><p>${escapeHtml(c.forgetBody)}</p></section>` +
    `<p class="fine">${escapeHtml(c.printNote)}</p>` +
    `</body></html>`;
}
