// The surface-contract suite — WS-SURFACE, SPEC-AGENT-LAYER §4 (Law E3).
//
//   node evals/surface/contract.mjs
//
// ── what "offline" means here, precisely ──────────────────────────────────
//
// No network, no database, no credentials, no model. This suite asserts the
// things the contract claims are true of EVERY adapter, against the REAL
// adapter modules — not against a description of them:
//
//   1. all three implement exactly the four functions, with the right arity
//   2. each one FAILS CLOSED on a missing secret and on a wrong secret
//   3. render() respects each surface's own limit and never hard-slices
//   4. parse() normalizes to the InboundEvent shape and nothing else
//   5. the engine half stays free of surface-specific limits (§10's E3
//      reversal condition, asserted as a grep rather than believed)
//
// Discord's Ed25519 check is exercised against a LOCALLY GENERATED key pair,
// so the algorithm is really run — the thing a credential would add is
// Discord's participation, not the mathematics.
import { generateKeyPairSync, sign as edSign, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;

let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

const tg = await import("../../api/tg.js");
const dc = await import("../../api/discord.js");
const wa = await import("../../api/whatsapp.js");
const surface = await import("../../api/_surface.js");

const ADAPTERS = [
  ["telegram", tg, tg.TG_TEXT_LIMIT],
  ["discord", dc, dc.DISCORD_TEXT_LIMIT],
  ["whatsapp", wa, wa.WA_TEXT_LIMIT],
];

// ── 1. the four functions ─────────────────────────────────────────────────
console.log("── the four functions ──");
for (const [name, mod] of ADAPTERS) {
  const a = mod.adapter;
  ok(`${name}: exports an adapter with surface='${name}'`, a?.surface === name);
  for (const fn of ["verify", "parse", "send", "render"])
    ok(`${name}: ${fn}() exists`, typeof a?.[fn] === "function");
  ok(`${name}: verify(req) takes the request`, a.verify.length >= 1);
  ok(`${name}: parse(payload) takes the payload`, a.parse.length >= 1);
  ok(`${name}: send(chatKey, msg) takes both`, a.send.length >= 2);
  ok(`${name}: render(text) takes the text`, a.render.length >= 1);
  // The contract is exactly four. A fifth would be a behaviour the engine
  // cannot call and therefore a behaviour only one surface has.
  ok(
    `${name}: the adapter object is EXACTLY the four functions plus its name`,
    Object.keys(a).sort().join(",") === "parse,render,send,surface,verify",
    Object.keys(a).join(","),
  );
}

// ── 2. fail closed ────────────────────────────────────────────────────────
//
// None of the three has credentials in this process, which is the point: an
// adapter with no secret must refuse EVERYTHING. That is the state a
// half-configured deploy is in, and it is the state in which a webhook that
// "defaults open" is simply open.
console.log("\n── fail closed: no credential configured ──");
const mkReq = (over = {}) => ({ method: "POST", headers: {}, body: {}, socket: {}, ...over });

const tgNo = await tg.verify(mkReq());
ok("telegram: no secret header => refused", tgNo.ok === false, tgNo.reason);
const tgWrong = await tg.verify(mkReq({ headers: { "x-telegram-bot-api-secret-token": "wrong" } }));
ok("telegram: wrong secret => refused", tgWrong.ok === false, tgWrong.reason);

const dcNo = await dc.verify(mkReq());
ok("discord: no signature headers => refused", dcNo.ok === false, dcNo.reason);
const dcJunk = await dc.verify(
  mkReq({ headers: { "x-signature-ed25519": "ab".repeat(64), "x-signature-timestamp": "1" } }),
);
ok("discord: signature without a configured public key => refused", dcJunk.ok === false, dcJunk.reason);

const waNo = await wa.verify(mkReq());
ok("whatsapp: no X-Hub-Signature-256 => refused", waNo.ok === false, waNo.reason);
const waWrong = await wa.verify(mkReq({ headers: { "x-hub-signature-256": `sha256=${"00".repeat(32)}` } }));
ok("whatsapp: signature without a configured app secret => refused", waWrong.ok === false, waWrong.reason);
const waGet = await wa.verify({ method: "GET", url: "/api/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1", headers: {} });
ok("whatsapp: GET handshake without a verify token => refused", waGet.ok === false, waGet.reason);

// ── 3. the signature algorithms, really run ───────────────────────────────
console.log("\n── the signature algorithms (local keys, real crypto) ──");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubHex = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const ts = "1755500000";
const body = JSON.stringify({ type: 2, channel_id: "1", d: {} });
const good = edSign(null, Buffer.from(ts + body, "utf8"), privateKey).toString("hex");

ok("discord: a correctly signed body verifies", dc.verifySignature(pubHex, ts, body, good) === true);
ok(
  "discord: the SAME signature with a different timestamp does not",
  dc.verifySignature(pubHex, "1755500001", body, good) === false,
);
ok(
  "discord: a re-serialized body does NOT verify (why raw bytes are required)",
  dc.verifySignature(pubHex, ts, JSON.stringify(JSON.parse(body).d), good) === false,
);
ok("discord: one flipped signature byte does not verify",
  dc.verifySignature(pubHex, ts, body, good.slice(0, -2) + (good.slice(-2) === "00" ? "01" : "00")) === false);
ok("discord: a malformed public key refuses rather than throws",
  dc.verifySignature("not-a-key", ts, body, good) === false);

const secret = "wa-app-secret";
const waSig = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
ok("whatsapp: a correct HMAC verifies", wa.signatureOk(secret, body, waSig) === true);
ok("whatsapp: a wrong secret does not", wa.signatureOk("other", body, waSig) === false);
ok("whatsapp: a truncated digest does not (length-safe compare)",
  wa.signatureOk(secret, body, waSig.slice(0, 20)) === false);
ok("whatsapp: a tampered body does not", wa.signatureOk(secret, body + " ", waSig) === false);

// discord's raw-body rule, asserted rather than trusted: a pre-parsed request
// must be UNVERIFIABLE, because a re-serialization would silently "fix" it
const preparsed = await dc.rawBodyOf({ body: { already: "parsed" }, headers: {} });
ok("discord: a pre-parsed request yields no raw body (cannot verify => refuses)", preparsed === null);

// ── 4. render() respects each surface's limit ─────────────────────────────
console.log("\n── render(): limits are the adapter's, never the engine's ──");
const para = (n) => Array.from({ length: n }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
for (const [name, mod, limit] of ADAPTERS) {
  const short = mod.render("arre yaar");
  ok(`${name}: a short message is ONE fragment`, short.length === 1 && short[0].text === "arre yaar");
  ok(`${name}: empty text renders nothing`, mod.render("").length === 0);
  const long = mod.render(para(400));
  ok(`${name}: every fragment is within ${limit}`, long.every((p) => p.text.length <= limit),
    `${long.length} fragments, max ${Math.max(...long.map((p) => p.text.length))}`);
  ok(`${name}: a long message actually splits`, long.length > 1, `${long.length} fragments`);
  ok(
    `${name}: nothing is lost in the split`,
    long.map((p) => p.text).join("\n").replace(/\s+/g, " ").trim() ===
      para(400).replace(/\s+/g, " ").trim(),
  );
}

// The Discord 2,000 boundary specifically — it is the tightest of the three
// and the one a shared splitter is most likely to get wrong.
const at2001 = "a".repeat(1990) + " " + "b".repeat(10);
const dcSplit = dc.render(at2001);
ok("discord: 2,001 chars split into two, on the space, not mid-token",
  dcSplit.length === 2 && dcSplit[0].text.endsWith("a") && dcSplit[1].text === "b".repeat(10),
  `${dcSplit.map((p) => p.text.length).join("+")}`);
ok("discord: exactly 2,000 chars stays one fragment", dc.render("a".repeat(2000)).length === 1);
const unbreakable = dc.render("z".repeat(5000));
ok("discord: one unbreakable 5,000-char token still fits the limit",
  unbreakable.every((p) => p.text.length <= 2000) && unbreakable.join("").length > 0,
  `${unbreakable.length} fragments`);
ok("telegram: 2,001 chars is ONE fragment (its limit is 4,096, not Discord's)",
  tg.render(at2001).length === 1);

// ── 5. parse() normalizes ─────────────────────────────────────────────────
console.log("\n── parse(): one shape, three wires ──");
const FIELDS = [
  "surface", "kind", "chatKey", "chatName", "isGroup", "surfaceUserId",
  "handle", "text", "caption", "messageId", "replyToSelf", "fromBot",
  "reason", "adminBits", "raw",
];
const samples = {
  telegram: {
    message: {
      chat: { id: -100777001, type: "supergroup", title: "goa" },
      from: { id: 9001, username: "rhea" },
      text: "meera kya scene hai",
      message_id: 5,
    },
  },
  discord: {
    d: { channel_id: "111", guild_id: "222", id: "333", content: "meera kya scene hai", author: { id: "9001", username: "rhea" } },
  },
  whatsapp: {
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "919000000001", profile: { name: "rhea" } }],
              messages: [{ from: "919000000001", id: "wamid.1", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "meera kya scene hai" } }],
            },
          },
        ],
      },
    ],
  },
};
for (const [name, mod] of ADAPTERS) {
  const evs = mod.parse(samples[name]);
  ok(`${name}: parse returns an ARRAY of events`, Array.isArray(evs) && evs.length >= 1);
  const ev = evs[0];
  ok(`${name}: every InboundEvent field is present`,
    FIELDS.every((f) => f in ev), FIELDS.filter((f) => !(f in ev)).join(",") || "all");
  ok(`${name}: surface is stamped by the adapter`, ev.surface === name);
  ok(`${name}: kind is 'message'`, ev.kind === "message");
  ok(`${name}: the text survived`, ev.text === "meera kya scene hai");
  ok(`${name}: the speaker is a STRING id`, typeof ev.surfaceUserId === "string" && ev.surfaceUserId.length > 0);
  ok(`${name}: chatKey is a non-empty string`, typeof ev.chatKey === "string" && ev.chatKey.length > 0);
  ok(`${name}: handle came through`, ev.handle === "rhea");
}
ok("telegram: a supergroup is a room", tg.parse(samples.telegram)[0].isGroup === true);
ok("discord: a guild channel is a room", dc.parse(samples.discord)[0].isGroup === true);
ok("whatsapp: a 1:1 is NOT a room", wa.parse(samples.whatsapp)[0].isGroup === false);
ok("telegram: garbage parses to an 'ignore' event, never a throw",
  tg.parse({})[0].kind === "ignore" && tg.parse({})[0].reason === "unparsable");
ok("whatsapp: a status callback is ignored with a NAMED reason",
  wa.parse({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] })[0].reason === "status callback");
// The reason the contract's parse() returns an array at all.
const batch = wa.parse({
  entry: [{ changes: [{ value: { messages: [
    { from: "1", id: "a", timestamp: "1", text: { body: "one" } },
    { from: "1", id: "b", timestamp: "1", text: { body: "two" } },
  ] } }] }],
});
ok("whatsapp: one POST carrying two messages yields TWO events", batch.length === 2,
  batch.map((e) => e.text).join("|"));

// ── 6. the 24-hour window lives in the ADAPTER ────────────────────────────
console.log("\n── whatsapp: the 24h customer-service window ──");
wa.resetWindow();
const outside = await wa.send("919000000001", { kind: "text", text: "hi" });
ok("no access token => refused before anything else", outside.ok === false, outside.error);
ok("with no inbound on record the window is CLOSED (fail closed)",
  wa.windowOpen("919000000001") === false);
wa.noteInbound("919000000001", Date.now());
ok("an inbound message opens the window", wa.windowOpen("919000000001") === true);
wa.noteInbound("919000000001", Date.now() - wa.WA_WINDOW_MS - 1);
ok("24h + 1ms later the window is closed again", wa.windowOpen("919000000001") === false);
wa.noteInbound("919000000001", Date.now() - wa.WA_WINDOW_MS + 60_000);
ok("one minute inside the window it is still open", wa.windowOpen("919000000001") === true);
// parse() winds the clock, which is what makes the ledger correct without the
// engine ever hearing about it
wa.resetWindow();
wa.parse(samples.whatsapp);
ok("parse() itself records the inbound that opens the window",
  wa.windowOpen("919000000001") === true);

// ── 7. the engine half stays surface-blind (§10, E3's reversal condition) ─
console.log("\n── the engine half knows no surface's limits ──");
const engineSrc = readFileSync(`${ROOT}api/_surface.js`, "utf8");
const roomSrc = readFileSync(`${ROOT}api/_room.js`, "utf8");
for (const [what, needle] of [
  ["Discord's 2,000-char limit", /\b2000\b|\b2_000\b/],
  ["WhatsApp's 24-hour window", /24\s*\*\s*60\s*\*\s*60|WA_WINDOW/],
  ["Telegram API URL", /api\.telegram\.org/],
  ["Discord API URL", /discord\.com\/api/],
  ["Graph API URL", /graph\.facebook\.com/],
]) {
  ok(`api/_surface.js contains no ${what}`, !needle.test(engineSrc.replace(/^\/\/.*$/gm, "")));
  ok(`api/_room.js contains no ${what}`, !needle.test(roomSrc.replace(/^\/\/.*$/gm, "")));
}
ok("the shared splitter is exported once and reused by all three",
  typeof surface.splitForLimit === "function" &&
    [tg, dc, wa].every((m) => /splitForLimit/.test(readFileSync(`${ROOT}api/${m.adapter.surface === "telegram" ? "tg" : m.adapter.surface}.js`, "utf8"))));

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} checks FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nall ${pass} checks passed`,
);
process.exit(failures.length ? 1 : 0);
