// The creator's PRINTABLE payout statement (WS-R138). WS-R36 built the
// statement as a number a creator can check against a bank line
// (`api/_payments.js#payoutStatement`, four numbers plus the Suite share,
// the follower subscription count and the TDS disclosure); WS-R108 then gave
// a FOLLOWER the same "JSON is not a document a human can read or hand to
// someone" treatment for their own export
// (`api/_room-export-readable.js`). A creator in India files taxes on this
// income, and a JSON blob is not a statement their accountant can work from
// either — this file is that other half, restated for money instead of a
// memory export.
//
// ── A PURE BUILDER, `_room-export-readable.js`'s OWN SHAPE ─────────────────
//
// `buildPayoutStatementReadableHtml` takes the object `payoutStatement()`
// already built (`api/_payments.js`) and a locale, and returns a string. No
// `db`, no `session`, no network — it cannot read a column `payoutStatement`
// did not already read, and it does not re-derive a single number:
// completeness and correctness of the FOUR NUMBERS, the Suite share and the
// referral-rewards line are `payoutStatement`'s own job
// (`evals/payouts/run.mjs`'s own release-gated suite proves them);
// `evals/payout-statement-readable/run.mjs`'s own parity battery proves this
// file's numbers equal the JSON statement's TO THE RUPEE over a generated
// set of periods, never a second implementation of the arithmetic.
// `api/payments.js`'s `payout_statement` op (WS-R36) already ran every
// owner-bearer check `evals/room-doors/run.mjs` proves for that op — the
// SAME already-authorized object this door hands back as JSON, by the time
// this file ever sees a byte — before this file's own `format: "html"`
// branch (this workstream) ever calls it, `roomReceipt`/`roomExport`'s own
// precedent restated for a payout statement instead of a follower record.
//
// ── THE GST LINE, REUSING `_receipt.js`'S OWN SPLIT — NOT A SECOND ONE ─────
//
// The platform's take (`take_inr`) is the platform's own fee for the
// service it renders a creator — a taxable supply exactly like a follower's
// membership payment is, so this file reuses `_receipt.js`'s `gstSplit`
// (the SAME function, the SAME `GST_RATE_BP`, imported rather than
// restated: a second implementation of tax arithmetic is the one thing this
// house's "a tiny pure helper is copied per module" convention does NOT
// license — `_room-export-readable.js`'s own header explains that
// convention for something as small as `escapeHtml`; GST math is the
// opposite of small) against `take_inr`, `unknown_state` mode (no
// creator billing state is collected any more than a follower's is — the
// SAME limitation `_receipt.js`'s own header states, restated one supply
// over). This is the platform operator's own understanding, unconfirmed by
// an accountant, exactly like `TDS_DISCLOSURE_SENTENCE` already says about
// TDS below — never presented as a settled tax opinion.
//
// ── THE TDS LINE, THE EXISTING CONSTANT VERBATIM, NEVER RE-TYPED ───────────
//
// `TDS_DISCLOSURE_SENTENCE` (`api/_payments.js`) names the section (194J)
// and the rate (0%) in one frozen English sentence. This file renders that
// sentence EXACTLY as `payoutStatement` handed it back (`statement.tds_note`
// — the same field the JSON response already carries), `lang="en"`
// regardless of the document's own locale, with only the SURROUNDING LABEL
// translated. Hand-translating "Section 194J" or "0%" into a second, Hindi
// sentence living in THIS file would create a second place either number
// could drift from the constant that is the one source of truth for both —
// the exact class of bug `context/rejected.md`'s no-fake-numbers law and
// this house's "restate a helper, never a constant" distinction both guard
// against. A creator reading the Hindi document still sees the same English
// legal sentence a follower's own receipt shows no equivalent of (a receipt
// has no TDS line at all — TDS is withheld from what the PLATFORM pays the
// CREATOR, never from what a follower pays), tagged so a screen reader in
// Hindi mode does not mispronounce it.
//
// ── NO SCRIPT, NO EXTERNAL RESOURCE ──────────────────────────────────────
//
// Exactly `_room-export-readable.js`'s own posture, restated: no
// `<script>`, no `<link>`, no web font, no image, and no print button —
// the workstream brief's own words. A browser's own Ctrl/Cmd+P prints this
// page exactly as it renders; the inline `@media print` block narrows it to
// A4.

import { gstSplit, GST_RATE_BP } from "./_receipt.js";

/** `_room-export-readable.js`'s own `escapeHtml`, restated rather than
 *  imported — this house's standing convention for a helper this small. */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

/** `_receipt.js`'s own `rupees`, restated — one tiny formatter, the same
 *  "INR, en-IN grouping" shape in both locales (`buildReceiptHtml`'s own
 *  Hindi copy already renders amounts through this exact same, unbranched
 *  function, so a printed rupee figure never differs in shape by locale). */
function rupees(n) {
  return `INR ${Number(n || 0).toLocaleString("en-IN")}`;
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

/** A half-open `[start, end)` period as one human range — "1 August 2026 to
 *  31 August 2026" rather than the ISO instants a `vy_creator_payout` row
 *  actually carries, `dateLabel`'s own per-field formatting restated for a
 *  span. The period's own END instant is exclusive (`runPayoutRollup`'s own
 *  `< $2` — a calendar month's first midnight), so the LABEL shows the
 *  previous calendar day rather than a range that visually starts and ends
 *  on the same date the next month also starts on. */
function periodLabel(startIso, endIso, loc) {
  const endExclusive = new Date(endIso);
  // `dateLabel` below already falls back to a raw ISO slice on an invalid
  // Date (its own try/catch) - passed a DATE OBJECT rather than calling
  // `.toISOString()` on it first, since `.toISOString()` itself throws on
  // an invalid Date before `dateLabel` ever gets a chance to catch anything.
  const endInclusive = Number.isNaN(endExclusive.getTime())
    ? endExclusive
    : new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  return `${dateLabel(startIso, loc)} - ${dateLabel(endInclusive, loc)}`;
}

const STATE_LABEL = Object.freeze({
  en: {
    built: "Built (not yet sent)", pending_account: "Waiting on your payout account",
    queued: "Queued with the payment provider", sent: "Sent", settled: "Settled", failed: "Failed",
  },
  hi: {
    built: "तैयार (अभी भेजा नहीं गया)", pending_account: "आपके पेआउट खाते का इंतज़ार",
    queued: "भुगतान प्रदाता के पास कतार में", sent: "भेजा गया", settled: "पूरा हुआ", failed: "विफल",
  },
});

const PAGE_COPY = Object.freeze({
  en: {
    docTitle: "Payout statement",
    heading: "Your payout statement",
    numbers: "The numbers",
    generatedOn: "Generated on",
    period: "Period",
    rooms: "Room(s) this statement covers",
    noRooms: "No Room had activity in this period.",
    gross: "Gross revenue",
    platformTake: "Platform's take",
    takeTaxableValue: "of which, taxable value",
    takeGst: (rateBp) => `of which, GST (${(rateBp / 100).toFixed(0)}%, included, estimated)`,
    suiteShare: (suiteName) => `Suite seat share (${suiteName})`,
    suiteShareNoName: "Suite seat share",
    referralRewards: "Referral rewards you funded this period",
    referralRewardsLine: (count, forgone) => `${count} free month${count === 1 ? "" : "s"} earned by your followers' referrals, ${rupees(forgone)} in follower revenue this platform did not collect because of them`,
    referralRewardsNone: "None this period.",
    tds: "TDS withheld",
    net: "Net payout to you",
    followerSubscriptions: (n) => `${n} paying follower subscription${n === 1 ? "" : "s"} this period.`,
    state: "Payout state",
    providerRef: "Payment provider reference",
    noProviderRef: "Not yet sent to a payment provider.",
    settledOn: "Settled on",
    failureReason: "Failure reason",
    gstCaveat: "The platform's GST split above is this platform operator's own understanding of the tax treatment of its own fee, not confirmed by an accountant, and is for your reference only - it is not a GST invoice.",
    printNote: "This page has no button of its own - your browser's own print (Ctrl or Cmd P) turns it into a PDF or a paper copy.",
  },
  hi: {
    docTitle: "पेआउट स्टेटमेंट",
    heading: "आपका पेआउट स्टेटमेंट",
    numbers: "आंकड़े",
    generatedOn: "बनाया गया",
    period: "अवधि",
    rooms: "यह स्टेटमेंट जिन रूम को कवर करता है",
    noRooms: "इस अवधि में किसी रूम में कोई गतिविधि नहीं हुई।",
    gross: "कुल आय",
    platformTake: "प्लेटफ़ॉर्म का हिस्सा",
    takeTaxableValue: "जिसमें से, कर योग्य मूल्य",
    takeGst: (rateBp) => `जिसमें से, जीएसटी (${(rateBp / 100).toFixed(0)}%, शामिल, अनुमानित)`,
    suiteShare: (suiteName) => `सुइट सीट हिस्सा (${suiteName})`,
    suiteShareNoName: "सुइट सीट हिस्सा",
    referralRewards: "इस अवधि में आपने जो रेफ़रल इनाम दिए",
    referralRewardsLine: (count, forgone) => `आपके फ़ॉलोअर्स के रेफ़रल से मिले ${count} मुफ़्त महीने, जिनकी वजह से इस प्लेटफ़ॉर्म ने ${rupees(forgone)} की फ़ॉलोअर आय नहीं ली`,
    referralRewardsNone: "इस अवधि में कोई नहीं।",
    tds: "रोकी गई टीडीएस राशि",
    net: "आपको मिलने वाला शुद्ध भुगतान",
    followerSubscriptions: (n) => `इस अवधि में ${n} भुगतान करने वाली फ़ॉलोअर सदस्यताएं।`,
    state: "पेआउट की स्थिति",
    providerRef: "भुगतान प्रदाता संदर्भ",
    noProviderRef: "अभी तक किसी भुगतान प्रदाता को नहीं भेजा गया।",
    settledOn: "पूरा हुआ",
    failureReason: "विफलता का कारण",
    gstCaveat: "ऊपर दिया गया प्लेटफ़ॉर्म का जीएसटी विभाजन इस प्लेटफ़ॉर्म ऑपरेटर की अपनी फ़ीस पर टैक्स के बारे में अपनी समझ है, किसी अकाउंटेंट से पुष्टि नहीं हुई है, और केवल आपकी जानकारी के लिए है - यह जीएसटी इनवॉइस नहीं है।",
    printNote: "इस पेज पर अपना कोई बटन नहीं है - आपके ब्राउज़र का अपना प्रिंट (Ctrl या Cmd P) इसे PDF या कागज़ की कॉपी बना देता है।",
  },
});

/** One `<tr>`, a label and a value, both already escaped by the caller
 *  where the value carries markup (`th` is always plain text here, no data
 *  cell risk `_room-export-readable.js`'s own per-cell `lang` tagging deals
 *  with — every value on this page is either a rupee figure or a translated
 *  word this file itself wrote, never a follower's or creator's own typed
 *  text). */
function row(label, value, rowClass = "") {
  const cls = rowClass ? ` class="${rowClass}"` : "";
  return `<tr${cls}><th>${escapeHtml(label)}</th><td>${value}</td></tr>`;
}

/**
 * The printable page. `statement` is `payoutStatement`'s OWN return value
 * (`api/_payments.js`) - never re-read, never re-queried, so the numbers on
 * this page and in the JSON response of the SAME op are, by construction,
 * the same object rendered two ways. `locale` mirrors
 * `buildRoomExportReadableHtml`'s own fallback: an omitted or unrecognised
 * locale renders English.
 */
export function buildPayoutStatementReadableHtml(statement, locale = "en") {
  if (!statement || typeof statement !== "object") {
    throw new Error("buildPayoutStatementReadableHtml: statement is required");
  }
  const loc = locale === "hi" ? "hi" : "en";
  const c = PAGE_COPY[loc];
  const stateLabels = STATE_LABEL[loc];

  const take = gstSplit({ amountInr: statement.take_inr });

  const roomsList = Array.isArray(statement.rooms) ? statement.rooms : [];
  const roomsBlock = roomsList.length
    ? `<ul>${roomsList.map((r) => `<li>${escapeHtml(r.display_name || r.slug || "")}</li>`).join("")}</ul>`
    : `<p class="empty">${escapeHtml(c.noRooms)}</p>`;

  const suiteShareInr = Number(statement.suite_share_inr || 0);
  const suiteRow = suiteShareInr > 0
    ? row(statement.suite_name ? c.suiteShare(statement.suite_name) : c.suiteShareNoName, rupees(suiteShareInr))
    : "";
  const takeTaxableRow = row(c.takeTaxableValue, rupees(take.taxable_value_inr), "sub");
  const takeGstRow = row(c.takeGst(GST_RATE_BP), rupees(take.total_tax_inr), "sub");
  const netRow = row(c.net, rupees(statement.net_inr), "total");

  const rewards = statement.referral_rewards || { count: 0, forgone_inr: 0 };
  const rewardsBody = Number(rewards.count) > 0
    ? escapeHtml(c.referralRewardsLine(Number(rewards.count), Number(rewards.forgone_inr || 0)))
    : escapeHtml(c.referralRewardsNone);

  const providerRefBody = statement.provider_payout_ref
    ? `<span lang="en">${escapeHtml(statement.provider_payout_ref)}</span>`
    : escapeHtml(c.noProviderRef);

  const stateBody = escapeHtml(stateLabels[statement.state] || String(statement.state || ""));
  const settledRow = statement.settled_at
    ? row(c.settledOn, escapeHtml(dateLabel(statement.settled_at, loc)))
    : "";
  const failureRow = statement.failure_reason
    ? row(c.failureReason, `<span lang="en">${escapeHtml(String(statement.failure_reason))}</span>`)
    : "";

  return `<!doctype html><html lang="${loc}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(c.docTitle)}</title>` +
    `<style>
      body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
      h1{font-size:1.25rem;margin-bottom:.25rem}
      h2{font-size:1rem;margin:1.75rem 0 .5rem;border-top:1px solid #ddd;padding-top:1rem}
      p{line-height:1.5}
      p.empty{color:#666;font-style:italic}
      p.caveat{color:#555;font-size:.85rem}
      ul{margin:.25rem 0 1rem;padding-left:1.25rem}
      table{width:100%;border-collapse:collapse;margin:.5rem 0 1rem}
      th,td{padding:.4rem .5rem;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
      th{font-weight:600;width:55%}
      tr.sub th,tr.sub td{color:#555;font-size:.9rem;padding-left:1.5rem}
      tr.total th,tr.total td{font-weight:700;border-top:2px solid #111}
      .meta{color:#555;font-size:.9rem}
      .fine{color:#555;font-size:.8rem;margin-top:.5rem}
      @page{size:A4;margin:16mm}
      @media print{
        body{margin:0;max-width:none}
        h2{break-inside:avoid-page}
        table{break-inside:avoid-page}
      }
    </style></head><body>` +
    `<h1>${escapeHtml(c.heading)}</h1>` +
    `<p class="meta">${escapeHtml(c.generatedOn)}: ${escapeHtml(dateLabel(statement.created_at, loc))}</p>` +
    `<h2>${escapeHtml(c.period)}</h2>` +
    `<p>${escapeHtml(periodLabel(statement.period_start, statement.period_end, loc))}</p>` +
    `<h2>${escapeHtml(c.rooms)}</h2>` +
    roomsBlock +
    `<h2>${escapeHtml(c.numbers)}</h2>` +
    `<table><tbody>` +
    row(c.gross, rupees(statement.gross_inr)) +
    row(c.platformTake, rupees(statement.take_inr)) +
    takeTaxableRow +
    takeGstRow +
    suiteRow +
    row(c.tds, rupees(statement.tds_inr)) +
    netRow +
    `</tbody></table>` +
    `<p class="fine">${escapeHtml(c.followerSubscriptions(Number(statement.follower_subscriptions || 0)))}</p>` +
    `<h2>${escapeHtml(c.referralRewards)}</h2>` +
    `<p>${rewardsBody}</p>` +
    `<h2>${escapeHtml(c.tds)}</h2>` +
    `<p lang="en">${escapeHtml(String(statement.tds_note || ""))}</p>` +
    `<h2>${escapeHtml(c.state)}</h2>` +
    `<table><tbody>` +
    row(c.state, stateBody) +
    row(c.providerRef, providerRefBody) +
    settledRow +
    failureRow +
    `</tbody></table>` +
    `<p class="caveat">${escapeHtml(c.gstCaveat)}</p>` +
    `<p class="fine">${escapeHtml(c.printNote)}</p>` +
    `</body></html>`;
}
