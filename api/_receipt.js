// The follower's receipt (WS-R100, migration 126) - a PURE builder. Given a
// ledger row (`vy_payment_event`, migration 078) and a Room's own public
// fields, this file turns them into a number, a date, an amount split into
// its GST lines, and the platform's own legal identity (or an honest
// placeholder), as HTML for print and as plain data for JSON - never a
// database read of its own. `api/_room-surface.js`'s `roomReceipt` fetches
// the row; `api/_payments.js`'s webhook claims the number and inserts the
// row; this file only ever turns rows already in hand into text.
//
// ── CGST Rules, 2017, Rule 46 (Tax invoice) ─────────────────────────────
// Verified 2026-09-05 against gstzen.in and studycafe.in (both quoting the
// rule's own clause text, cross-checked against each other). Every clause
// this file addresses, and how, is spelled out in
// db/migrations/126_receipt.sql's own header - read that file first for the
// full citation; this header states only what changes if the rule's
// clauses ever do.
//
// ── NO FAKE NUMBERS, restated for tax ────────────────────────────────────
// `PLATFORM_LEGAL_NAME`/`PLATFORM_GSTIN` unset render one clearly marked
// placeholder sentence, never an invented name or a string of digits that
// merely looks like a GSTIN. `GST_RATE_BP` is the operator's own
// understanding of the rate that applies to a Room membership, NOT
// confirmed by an accountant - `api/_payments.js`'s `TDS_RATE_BP_DEFAULT`/
// `TDS_DISCLOSURE_SENTENCE` is the exact same posture, restated for a
// different tax line. Splitting into CGST+SGST or IGST requires knowing
// whether the follower's own billing state equals the platform's
// registered one; this product asks for neither today, so `gstSplit` below
// only ever returns the `unknown_state` shape in practice - the
// `cgst_sgst`/`igst` branches are real, tested code, structurally reachable
// the day a follower's state is ever known, never exercised by anything
// that calls this file today.

/** 18% - India's standard GST rate for most services as of this migration,
 *  the operator's own understanding, NOT confirmed by an accountant for
 *  this product's specific offering. Basis points, `api/_payments.js`'s
 *  `PLATFORM_TAKE_BP_DEFAULT` own convention, so a bad value cannot hide a
 *  floating-point rounding question. */
export const GST_RATE_BP = 1800;

/** A Room membership has no confirmed Services Accounting Code. Rendered
 *  verbatim in both locales rather than guessed - inventing a plausible-
 *  looking SAC would be exactly the fabricated precision this repo's
 *  no-fake-numbers law forbids, applied to a tax classification instead of
 *  a number. */
export const SAC_PLACEHOLDER = Object.freeze({
  en: "Service code (SAC): to be confirmed with an accountant.",
  hi: "सेवा कोड (SAC): एक अकाउंटेंट से पुष्टि होना बाकी है।",
});

const FY_RE = /^\d{4}-\d{2}$/;

/** India's financial year: 1 April to 31 March. `dateMs` in, `"2026-27"` (or
 *  whichever pair of years) out - the SAME string
 *  `api/_payments.js`'s webhook write computes at claim time, and the ONLY
 *  place this computation is written, so a display-time FY can never
 *  disagree with the FY a receipt's own number was actually claimed under. */
export function financialYearFor(dateMs) {
  const d = new Date(dateMs);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0 = January
  const startYear = m >= 3 ? y : y - 1; // April (index 3) opens a new FY
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, "0")}`;
}

/** `VY/<FY>/<n>`. Rule 46(b) caps a tax invoice's own serial number at
 *  sixteen characters; `"VY/2026-27/"` alone spends eleven of them, leaving
 *  five digits - good for 99,999 receipts in one financial year before this
 *  format needs to change (`context/decisions.md
 *  #ws-r100-receipt-number-bounded-by-rule-46b`). Throws rather than
 *  silently emitting an invoice number the rule does not allow - the same
 *  "unrepresentable, not merely unproduced" discipline migration 078's
 *  `vy_payment_event_split_sums` CHECK uses for a rupee amount, restated
 *  here for a string length. */
export function formatReceiptNumber(fy, receiptNo) {
  if (!FY_RE.test(String(fy || ""))) throw new Error("formatReceiptNumber: a valid financial year is required");
  const n = Number(receiptNo);
  if (!Number.isInteger(n) || n <= 0) throw new Error("formatReceiptNumber: a positive receipt number is required");
  const formatted = `VY/${fy}/${n}`;
  if (formatted.length > 16) {
    throw Object.assign(new Error("receipt number exceeds Rule 46(b)'s sixteen-character cap"), {
      code: "receipt_number_over_rule_46b_cap",
    });
  }
  return formatted;
}

/**
 * The tax split for one amount, GST-inclusive (the follower is charged
 * exactly `amountInr`, never a rupee more at checkout - migration 078's own
 * `follower_price_inr` is what a follower actually pays). Three shapes:
 *
 *   `unknown_state`  - the follower's own billing state is not known to this
 *                       platform (true of every real charge today). One
 *                       undifferentiated GST line, never a guessed CGST/SGST
 *                       split.
 *   `cgst_sgst`      - the follower's state is known AND equals the
 *                       platform's own registered state (an intra-state
 *                       supply). Split evenly, the paisa-rounding remainder
 *                       (if any) going to SGST so the two always sum exactly
 *                       to the total tax.
 *   `igst`           - the follower's state is known and DIFFERS (an
 *                       inter-state supply). One IGST line.
 *
 * Every branch's own `taxable_value_inr + total_tax_inr === amountInr`,
 * and (for the split branches) `cgst_inr + sgst_inr === total_tax_inr` -
 * checked here, in the return value's own arithmetic, rather than only
 * hoped for by the caller.
 */
export function gstSplit({ amountInr, followerState = null, platformState = null, rateBp = GST_RATE_BP } = {}) {
  const amount = Math.max(0, Math.round(Number(amountInr) || 0));
  const taxableValueInr = Math.round((amount * 10000) / (10000 + rateBp));
  const totalTaxInr = amount - taxableValueInr;
  const known = Boolean(followerState) && Boolean(platformState);
  if (!known) {
    return Object.freeze({ mode: "unknown_state", rate_bp: rateBp, taxable_value_inr: taxableValueInr, total_tax_inr: totalTaxInr });
  }
  if (String(followerState).trim().toLowerCase() === String(platformState).trim().toLowerCase()) {
    const cgstInr = Math.round(totalTaxInr / 2);
    const sgstInr = totalTaxInr - cgstInr;
    return Object.freeze({
      mode: "cgst_sgst", rate_bp: rateBp, taxable_value_inr: taxableValueInr,
      cgst_inr: cgstInr, sgst_inr: sgstInr, total_tax_inr: totalTaxInr,
    });
  }
  return Object.freeze({
    mode: "igst", rate_bp: rateBp, taxable_value_inr: taxableValueInr,
    igst_inr: totalTaxInr, total_tax_inr: totalTaxInr,
  });
}

/** The platform's own supplier identity, Rule 46(a) - or the named
 *  placeholder when either half is unset. Never a fabricated GSTIN: a real
 *  GSTIN has a fixed fifteen-character shape, and a value that does not
 *  match it is treated exactly like an unset one - a typo in a Vercel env
 *  var may not silently become a printed, wrong tax identity. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export function platformSupplierInfo(env = process.env) {
  const name = String(env.PLATFORM_LEGAL_NAME || "").trim();
  const gstinRaw = String(env.PLATFORM_GSTIN || "").trim().toUpperCase();
  const gstin = GSTIN_RE.test(gstinRaw) ? gstinRaw : "";
  const complete = Boolean(name) && Boolean(gstin);
  return Object.freeze({ name, gstin, complete });
}

const COPY = Object.freeze({
  en: {
    title: "Receipt",
    number: "Receipt no.",
    date: "Date",
    room: "Room",
    plan: "Plan",
    planLine: (roomName) => `${roomName} AI - monthly membership`,
    billedTo: "Billed to",
    billedToFallback: "This platform's own follower account (no name or address collected)",
    taxableValue: "Taxable value",
    gstLine: (rateBp) => `GST (${(rateBp / 100).toFixed(0)}%, included)`,
    cgst: "CGST",
    sgst: "SGST",
    igst: "IGST",
    total: "Total paid",
    supplier: "Supplier",
    supplierPlaceholder: "Legal name and GSTIN not yet configured for this deployment. This is not a final tax invoice until they are.",
    print: "Print",
    footer: "Generated from this platform's own payment ledger, not from the payment provider's page.",
  },
  hi: {
    title: "रसीद",
    number: "रसीद संख्या",
    date: "तारीख",
    room: "रूम",
    plan: "योजना",
    planLine: (roomName) => `${roomName} AI - मासिक सदस्यता`,
    billedTo: "बिल किसे",
    billedToFallback: "इस प्लेटफ़ॉर्म पर आपका फ़ॉलोअर खाता (कोई नाम या पता एकत्र नहीं किया गया)",
    taxableValue: "कर योग्य मूल्य",
    gstLine: (rateBp) => `जीएसटी (${(rateBp / 100).toFixed(0)}%, शामिल)`,
    cgst: "सीजीएसटी",
    sgst: "एसजीएसटी",
    igst: "आईजीएसटी",
    total: "कुल भुगतान",
    supplier: "आपूर्तिकर्ता",
    supplierPlaceholder: "इस डिप्लॉयमेंट के लिए कानूनी नाम और जीएसटीआईएन अभी सेट नहीं हुए हैं। जब तक ऐसा नहीं होता, यह अंतिम टैक्स इनवॉइस नहीं है।",
    print: "प्रिंट करें",
    footer: "यह इस प्लेटफ़ॉर्म की अपनी भुगतान लेजर से बनाई गई है, भुगतान प्रदाता के पेज से नहीं।",
  },
});

function dateLabel(iso, locale) {
  try {
    return new Date(iso).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
      year: "numeric", month: "short", day: "2-digit", timeZone: "Asia/Kolkata",
    });
  } catch {
    return String(iso || "").slice(0, 10);
  }
}

function rupees(n) {
  return `INR ${Number(n || 0).toLocaleString("en-IN")}`;
}

/**
 * Everything a receipt needs to render, in one plain object - no HTML, no
 * locale-specific formatting beyond the numbers/dates that must be, so
 * `roomReceipt`'s JSON response and `buildReceiptHtml` below both build from
 * the SAME context rather than two independent readings of the same row.
 *
 * `paymentEvent` - one `vy_payment_event` row (event_id, kind, amount_inr,
 *   received_at). `receipt` - one `vy_receipt` row (receipt_no, issued_at).
 * `room` - `{ name }`, the Room's own public display name.
 */
export function buildReceiptContext({ paymentEvent, receipt, room, locale = "en", env = process.env, followerState = null } = {}) {
  if (!paymentEvent || !receipt) throw new Error("buildReceiptContext: paymentEvent and receipt are required");
  const loc = locale === "hi" ? "hi" : "en";
  const fy = financialYearFor(Date.parse(receipt.issued_at));
  const receiptNumber = formatReceiptNumber(fy, receipt.receipt_no);
  const split = gstSplit({ amountInr: paymentEvent.amount_inr, followerState, platformState: null });
  const supplier = platformSupplierInfo(env);
  const roomName = room?.name || room?.display_name || "";
  return Object.freeze({
    locale: loc,
    receipt_number: receiptNumber,
    fy,
    issued_at: receipt.issued_at,
    date_label: dateLabel(receipt.issued_at, loc),
    room_name: roomName,
    plan_line: COPY[loc].planLine(roomName),
    amount_inr: Number(paymentEvent.amount_inr || 0),
    split,
    supplier,
    sac_note: SAC_PLACEHOLDER[loc],
  });
}

/** The printable page. `<style>` inline (no external stylesheet - this is
 *  handed straight back as a POST response body, never served from a route
 *  a browser would apply a site stylesheet to), plain black-on-white,
 *  print-first. */
export function buildReceiptHtml(ctx) {
  const c = COPY[ctx.locale] || COPY.en;
  const s = ctx.split;
  const gstRows = [];
  if (s.mode === "cgst_sgst") {
    gstRows.push(`<tr><td>${c.cgst} (${(s.rate_bp / 200).toFixed(1)}%)</td><td>${rupees(s.cgst_inr)}</td></tr>`);
    gstRows.push(`<tr><td>${c.sgst} (${(s.rate_bp / 200).toFixed(1)}%)</td><td>${rupees(s.sgst_inr)}</td></tr>`);
  } else if (s.mode === "igst") {
    gstRows.push(`<tr><td>${c.igst} (${(s.rate_bp / 100).toFixed(0)}%)</td><td>${rupees(s.igst_inr)}</td></tr>`);
  } else {
    gstRows.push(`<tr><td>${c.gstLine(s.rate_bp)}</td><td>${rupees(s.total_tax_inr)}</td></tr>`);
  }
  const supplierBlock = ctx.supplier.complete
    ? `<p>${escapeHtml(ctx.supplier.name)}<br>GSTIN ${escapeHtml(ctx.supplier.gstin)}</p>`
    : `<p class="placeholder">${escapeHtml(c.supplierPlaceholder)}</p>`;
  return `<!doctype html><html lang="${ctx.locale}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(c.title)} ${escapeHtml(ctx.receipt_number)}</title>` +
    `<style>
      body{font-family:system-ui,sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
      h1{font-size:1.25rem;margin-bottom:.25rem}
      table{width:100%;border-collapse:collapse;margin:1rem 0}
      td{padding:.35rem 0;border-bottom:1px solid #ddd}
      td:last-child{text-align:right}
      .total td{font-weight:700;border-top:2px solid #111;border-bottom:none}
      .placeholder{color:#a33;font-size:.9rem}
      .fine{color:#555;font-size:.8rem;margin-top:2rem}
      @media print{button{display:none}}
    </style></head><body>` +
    `<h1>${escapeHtml(c.title)}</h1>` +
    `<p>${escapeHtml(c.number)}: <strong>${escapeHtml(ctx.receipt_number)}</strong><br>${escapeHtml(c.date)}: ${escapeHtml(ctx.date_label)}</p>` +
    `<p>${escapeHtml(c.room)}: ${escapeHtml(ctx.room_name)}<br>${escapeHtml(c.plan)}: ${escapeHtml(ctx.plan_line)}</p>` +
    `<p>${escapeHtml(c.supplier)}:<br>${supplierBlock}</p>` +
    `<p>${escapeHtml(c.billedTo)}: ${escapeHtml(c.billedToFallback)}</p>` +
    `<table><tbody>` +
    `<tr><td>${escapeHtml(c.taxableValue)}</td><td>${rupees(ctx.split.taxable_value_inr)}</td></tr>` +
    gstRows.join("") +
    `<tr class="total"><td>${escapeHtml(c.total)}</td><td>${rupees(ctx.amount_inr)}</td></tr>` +
    `</tbody></table>` +
    `<p class="fine">${escapeHtml(ctx.sac_note)}</p>` +
    `<p class="fine">${escapeHtml(c.footer)}</p>` +
    `<button onclick="window.print()">${escapeHtml(c.print)}</button>` +
    `</body></html>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
