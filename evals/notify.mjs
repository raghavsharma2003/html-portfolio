// WS-NOTIFY — the notification lane, asserted where it is decidable.
//
// Three kinds of check, and the split is deliberate:
//
//  1. THE POLICY, run. `notifyCopy`, `shouldExplain` and `nextStoryChange` are
//     pure, so they are driven with plain objects and a simulated clock. This
//     is the half that decides what a lock screen says and whether a person is
//     ever asked twice.
//
//  2. THE PLUMBING, run against a RECORDER. `src/notify/local.ts` takes the
//     Capacitor plugin through a seam (`configureNotifier`), so the exact
//     schedule payload — ids, channel, the Date, the absence of any repeat — is
//     observable in node with no device and no emulator. A battery that needed
//     a real Android to see this is a battery nobody runs.
//
//  3. THE PROPERTIES OF FILES NOBODY EXECUTES. docs/PRODUCT-SUPERIORITY.md §5
//     fails-if (c) asks for "a lint asserting no notification call site takes a
//     delay/interval argument — a rule stated in a doc will be broken by the
//     third agent who touches this file". That is a source scan, and it lives
//     here with the rest so there is one suite to run rather than a script
//     nothing invokes (`engine-bundle-check-uncalled`).
//
// Offline, deterministic, no model, no network, no DB, $0, ~2s.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");
const NPX_COMMAND = process.platform === "win32" ? process.execPath : "npx";
const NPX_ARGS = process.platform === "win32"
  ? [join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js")]
  : [];
const modulePath = (path) => path.replaceAll("\\", "/");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${extra ? "\n      " + extra : ""}`);
  }
};

// ── the real modules, bundled fresh (never a frozen copy) ─────────────────
const tmp = mkdtempSync(join(tmpdir(), "notify-"));
const ENTRY = join(tmp, "entry.ts");
const BUNDLE = join(tmp, "bundle.mjs");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(modulePath(join(ROOT, "src/notify/copy")))};
export * from ${JSON.stringify(modulePath(join(ROOT, "src/notify/story")))};
export { configureNotifier, NOTIFY_ID, post, postAt, cancel, cancelAll, notifyAvailable, permissionState } from ${JSON.stringify(modulePath(join(ROOT, "src/notify/local")))};
export { shouldExplain, postReply, postMissedCall, scheduleStory, clearReachability } from ${JSON.stringify(modulePath(join(ROOT, "src/notify/index")))};
export { pushConfigured } from ${JSON.stringify(modulePath(join(ROOT, "src/notify/config")))};
export { registerForPush, submitPushToken } from ${JSON.stringify(modulePath(join(ROOT, "src/notify/push")))};
export { slotForStory, slotStartedAt, activeStories } from ${JSON.stringify(modulePath(join(ROOT, "src/engine/storyCatalog")))};
export { HER_NAME } from ${JSON.stringify(modulePath(join(ROOT, "src/engine/persona")))};
`,
);
execFileSync(
  NPX_COMMAND,
  [
    ...NPX_ARGS, "esbuild", ENTRY, "--bundle", "--format=esm", "--platform=node",
    `--outfile=${BUNDLE}`, "--log-level=error",
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
    `--alias:@capacitor/local-notifications=${join(HERE, "stubs/local-notifications.mjs")}`,
  ],
  { stdio: "inherit", cwd: ROOT },
);
const M = await import(pathToFileURL(BUNDLE).href);

// ══ 1. HER VOICE — what a lock screen is allowed to say ═══════════════════
{
  const her = (text, kind = "text", at = 1000) => ({ from: "her", kind, text, at });
  const him = (text) => ({ from: "me", kind: "text", text, at: 900 });

  ok("her name is the title", M.notifyCopy([her("kya kar rahe ho")], M.HER_NAME)?.title === M.HER_NAME);
  ok(
    "the body is HER TEXT, verbatim",
    M.notifyCopy([her("kya kar rahe ho")], M.HER_NAME)?.body === "kya kar rahe ho",
  );

  // THE CLASS THIS SUITE EXISTS FOR. Not "is the body non-empty" — that passes
  // for "You have a new message" too. The assertion is that there is NO
  // constructor in the module that produces a body without a line she sent, so
  // a caller with nothing of hers gets null and cannot post at all.
  ok("a gif alone yields NOTHING", M.notifyCopy([her("excited dog", "gif")], M.HER_NAME) === null);
  ok(
    "a call record alone yields NOTHING",
    M.notifyCopy([her("Voice call · 4:12", "callmark")], M.HER_NAME) === null,
  );
  ok("HIS message yields nothing", M.notifyCopy([him("hey")], M.HER_NAME) === null);
  ok("an empty burst yields nothing", M.notifyCopy([], M.HER_NAME) === null);
  ok(
    "a caption-less photo yields nothing",
    M.notifyCopy([her("", "photo")], M.HER_NAME) === null,
  );
  ok(
    "a whitespace-only line yields nothing",
    M.notifyCopy([her("   \n  ")], M.HER_NAME) === null,
  );

  // …and the half that must NOT over-refuse: a voice note's `text` IS her clean
  // spoken words (Chat.tsx writes `spoken` for the expressive version), so a
  // voice note is a message and must reach the lock screen as one.
  ok(
    "a voice note carries her words",
    M.notifyCopy([her("so tired yaar, abhi ghar pahunchi", "voice")], M.HER_NAME)?.body ===
      "so tired yaar, abhi ghar pahunchi",
  );
  ok(
    "a photo CAPTION is her words",
    M.notifyCopy([her("dekho kitna cute", "photo")], M.HER_NAME)?.body === "dekho kitna cute",
  );

  // one burst, one notification
  const burst = M.notifyCopy([her("arre"), her("suno na"), her("kal chalein?")], M.HER_NAME);
  ok("a burst's BODY is the newest line", burst?.body === "kal chalein?");
  ok(
    "a burst's largeBody carries the whole thing, in order",
    burst?.largeBody === "arre\nsuno na\nkal chalein?",
  );
  ok(
    "a single line gets NO largeBody",
    M.notifyCopy([her("bas")], M.HER_NAME)?.largeBody === undefined,
  );
  // a gif mid-burst is skipped without costing the burst
  ok(
    "a gif inside a burst is skipped, not fatal",
    M.notifyCopy([her("hahaha"), her("laughing cat", "gif"), her("ok bye")], M.HER_NAME)?.largeBody ===
      "hahaha\nok bye",
  );

  // clipping: at a word boundary, and only when it helps
  const long = "a".repeat(20) + " " + "b".repeat(200);
  const clipped = M.clip(long);
  ok("clip stays within the budget", clipped.length <= M.BODY_MAX + 1, `${clipped.length}`);
  ok("clip marks that it clipped", clipped.endsWith("…"));
  ok("clip does not touch a short line", M.clip("theek hai") === "theek hai");
  ok("clip collapses newlines into spaces", M.clip("a\n b") === "a b");

  // the missed call: flat, no voice, no ask
  const missed = M.missedCallCopy(M.HER_NAME);
  ok("a missed call says only that", missed.body === "Missed call");
  ok("a missed call is titled with her name", missed.title === M.HER_NAME);
  // §5(b): copy in her voice as longing is the tactic, delivered to a lock
  // screen. A word list is a blunt instrument and that is fine — it is a
  // tripwire for the next person who "improves" this string.
  const LONGING = /\bmiss(ing)? you|waiting|why (didn't|dont|don't)|come back|kahan ho|where are you/i;
  ok("the missed-call line carries no longing", !LONGING.test(missed.body));

  // the story: what she posted, never that she posted
  const story = M.storyCopy(M.HER_NAME, "chai on the balcony, book open on her knees");
  ok("the story body is the picture", story?.body === "chai on the balcony, book open on her knees");
  ok("a story with no description yields nothing", M.storyCopy(M.HER_NAME, "") === null);
}

// ══ 2. THE ONE ASK — shouldExplain's truth table ══════════════════════════
{
  const A = (prefs, perm = "prompt", avail = true) => M.shouldExplain(prefs, perm, avail);

  // The FTUE rule, as a condition rather than a convention.
  ok("never before a felt moment (this is the onboarding case)", A({}) === false);
  ok("never with no prefs at all", A(undefined) === false);
  ok("asked once a moment is felt", A({ felt: 1 }) === true);

  // Terminal in both directions.
  ok("never again after a decline", A({ felt: 1, declined: 2 }) === false);
  ok("never again after the system dialog was spent", A({ felt: 1, asked: 2 }) === false);
  ok("never when already granted", A({ felt: 1 }, "granted") === false);
  ok("never when the OS has already refused", A({ felt: 1 }, "denied") === false);
  ok("never where the browser cannot notify at all", A({ felt: 1 }, "prompt", false) === false);

  // A second felt moment must not resurrect the ask after a decline — the
  // re-nag this whole field exists to make impossible.
  ok("a later felt moment does not undo a decline", A({ felt: 99, declined: 2 }) === false);
}

// ══ 3. THE PLUMBING, against a recorder ══════════════════════════════════
{
  const calls = [];
  const recorder = (permission = "granted") => ({
    scheduled: calls,
    checkPermissions: async () => ({ display: permission }),
    requestPermissions: async () => ({ display: permission }),
    schedule: async (o) => calls.push({ op: "schedule", ...o }),
    cancel: async (o) => calls.push({ op: "cancel", ...o }),
    removeDeliveredNotificationsById: async (o) => calls.push({ op: "removeDelivered", ...o }),
    createChannel: async (c) => calls.push({ op: "channel", ...c }),
  });

  M.configureNotifier({ plugin: recorder("granted"), native: () => true });

  // ── a reply posts NOW, with no schedule of any kind ──
  calls.length = 0;
  const posted = await M.postReply([{ from: "her", kind: "text", text: "uth gaye?", at: 1 }], {});
  ok("a reply with permission posts", posted === "posted");
  const s1 = calls.find((c) => c.op === "schedule");
  ok("…as exactly one notification", s1 && s1.notifications.length === 1, JSON.stringify(calls));
  ok("…on the fixed reply id", s1?.notifications[0].id === M.NOTIFY_ID.reply);
  ok("…with her words as the body", s1?.notifications[0].body === "uth gaye?");
  ok("…routed at the thread", s1?.notifications[0].extra?.route === "#chat");
  // THE §5(a) ASSERTION, on the lane that must never carry one.
  ok("…and carries NO schedule", s1?.notifications[0].schedule === undefined);

  // ── the channel is created before the first post, once ──
  ok("a channel is created on native", calls.some((c) => c.op === "channel"));
  const chans = calls.filter((c) => c.op === "channel").length;
  calls.length = 0;
  await M.postMissedCall({});
  ok("…and not created again on the next post", calls.every((c) => c.op !== "channel"), `${chans}`);
  ok(
    "a missed call uses its own id",
    calls.find((c) => c.op === "schedule")?.notifications[0].id === M.NOTIFY_ID.missedCall,
  );

  // ── his switch is honoured before the OS is even asked ──
  calls.length = 0;
  ok("`enabled: false` refuses a reply", (await M.postReply([{ from: "her", text: "hi", at: 1 }], { enabled: false })) === "off");
  ok("…and posts nothing", calls.length === 0);
  ok("`enabled: false` refuses a missed call", (await M.postMissedCall({ enabled: false })) === "off");
  ok("`enabled: false` refuses the story", (await M.scheduleStory({ enabled: false }, { at: Date.now() + 60_000, desc: "x" })) === "none");

  // ── the story: the ONE scheduled notification, and its exact shape ──
  calls.length = 0;
  const at = Date.now() + 3 * 60 * 60 * 1000;
  const r = await M.scheduleStory({}, { at, desc: "chai on the balcony" });
  ok("the story schedules", r === "scheduled");
  const s2 = calls.find((c) => c.op === "schedule")?.notifications[0];
  ok("…at the instant it was given, as a Date", s2?.schedule?.at instanceof Date && s2.schedule.at.getTime() === at);
  ok("…on the story id", s2?.id === M.NOTIFY_ID.story);
  ok("…carrying what she posted", s2?.body === "chai on the balcony");
  // The exact-alarm decision, asserted rather than trusted: the plugin defaults
  // this to true, and true opens the system "Alarms & reminders" screen on
  // API 31+. See android/app/src/main/AndroidManifest.xml's tools:node="remove".
  ok("…INEXACT, so no settings screen is ever opened", s2?.isExactNotification === false);
  ok("…never repeating", s2?.schedule?.repeats === undefined && s2?.schedule?.every === undefined);
  ok("…and never idle-forced", s2?.schedule?.allowWhileIdle === false);
  ok("a story with no description schedules nothing", (await M.scheduleStory({}, null)) === "none");

  // ── coming back takes it down: pending AND delivered ──
  calls.length = 0;
  await M.cancel("reply");
  ok("cancel cancels the pending copy", calls.some((c) => c.op === "cancel" && c.notifications[0].id === M.NOTIFY_ID.reply));
  ok("cancel removes the DELIVERED copy too", calls.some((c) => c.op === "removeDelivered" && c.ids[0] === M.NOTIFY_ID.reply));

  // ── the teardown ──
  calls.length = 0;
  await M.clearReachability("", "device-1");
  const cancelled = new Set(calls.filter((c) => c.op === "cancel").map((c) => c.notifications[0].id));
  for (const [kind, id] of Object.entries(M.NOTIFY_ID)) {
    ok(`the teardown cancels '${kind}'`, cancelled.has(id));
  }

  // ── without permission, nothing is posted and the moment is FELT ──
  M.configureNotifier({ plugin: recorder("prompt"), native: () => true });
  calls.length = 0;
  ok(
    "no permission reports the felt moment",
    (await M.postReply([{ from: "her", kind: "text", text: "hello", at: 1 }], {})) === "unpermitted",
  );
  ok("…and posts nothing at all", calls.every((c) => c.op !== "schedule"));
  // and the case that must NOT arm the ask
  ok(
    "a gif with no permission is 'nothing', never 'unpermitted'",
    (await M.postReply([{ from: "her", kind: "gif", text: "dog", at: 1 }], {})) === "nothing",
  );
}

// ══ 4. HER STORY'S CLOCK — derived, never mirrored ═══════════════════════
{
  // `nextStoryChange` binary-searches storyCatalog's own `slotStartedAt`, so
  // these assertions are against the SHIPPING boundaries rather than a copy of
  // them. Swept across a whole day at 17-minute steps: fine enough to land
  // inside every slot including the short ones, coarse enough to stay cheap.
  const DAY = 86_400_000;
  const base = Date.UTC(2026, 7, 23, 0, 0, 0);
  let bad = 0;
  let sameOccurrence = 0;
  let n = 0;
  for (let t = base; t < base + DAY; t += 17 * 60_000) {
    const next = M.nextStoryChange(t);
    n++;
    if (next === null || next <= t) bad++;
    // the step is real: the occurrence at `next` is not the occurrence at `t`
    if (next !== null && M.slotStartedAt(next) === M.slotStartedAt(t)) sameOccurrence++;
  }
  ok(`nextStoryChange is always in the future (n=${n})`, bad === 0, `${bad} failures`);
  ok("…and always lands in a NEW occurrence", sameOccurrence === 0, `${sameOccurrence} did not`);
  // …and it is the FIRST such instant: a minute earlier is still the old one.
  let notFirst = 0;
  for (let t = base; t < base + DAY; t += 61 * 60_000) {
    const next = M.nextStoryChange(t);
    if (next !== null && M.slotStartedAt(next - 60_000) !== M.slotStartedAt(t)) notFirst++;
  }
  ok("…and is the FIRST instant of it", notFirst === 0, `${notFirst} overshot`);

  const at = M.nextStoryChange(base);
  const story = M.storyAtChange(at);
  ok("there is a real story at the change", Boolean(story?.desc), JSON.stringify(story));
  ok("…and it is what the app's own ring would show", story?.id === M.activeStories(at).at(-1)?.id);

  // NO MIRRORED TABLE. `storyCatalog.ts`'s header pays for its one mirror with
  // a 1,440-minute-per-weekday gate; a second copy here would need a third. So
  // the property is asserted directly: this file contains no clock numbers.
  const storyModule = src("src/notify/story.ts");
  const code = storyModule.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  ok(
    "src/notify/story.ts holds no slot boundary of its own",
    !/\b(4\s*\*\s*60|6\s*\*\s*60|11\s*\*\s*60|16\s*\*\s*60|18\s*\*\s*60|19\s*\*\s*60)\b/.test(code),
    code.slice(0, 300),
  );
}

// ══ 5. THE LINT §5(c) ASKS FOR ═══════════════════════════════════════════
//
// "no notification call site takes a delay/interval argument". Enforced over
// the source, because the failure it prevents is a FUTURE edit and no test that
// runs today's code can see one.
{
  const files = [
    "src/notify/index.ts",
    "src/notify/local.ts",
    "src/notify/copy.ts",
    "src/notify/story.ts",
    "src/notify/push.ts",
    // The two UI files are in the list for the copy rules below rather than for
    // the timer rules: every string a person reads about this feature is in one
    // of them, and the promise "we will not ask again" is only as good as what
    // the next edit to them says.
    "src/notify/NotifySheet.tsx",
    "src/notify/NotifyRow.tsx",
  ];
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/[^\n]*/g, "");

  for (const f of files) {
    const code = strip(src(f));
    // A repeating notification is the hourglass by definition.
    ok(`${f}: no repeating schedule`, !/\brepeats\s*:\s*true|\bevery\s*:\s*["']/.test(code), code.match(/.*(repeats|every)\s*:.*/)?.[0]);
    // A timer that decides to notify.
    ok(
      `${f}: no timer around a post`,
      !/setInterval\s*\(/.test(code) && !/setTimeout\s*\([^)]*\b(post|notify|schedule)/i.test(code),
    );
  }

  // The one scheduling entry point takes an INSTANT, never a duration. This is
  // the structural half of the rule: `postAt(kind, copy, at: Date)` cannot
  // express "in twenty minutes", so no caller can ask for it.
  const local = src("src/notify/local.ts");
  ok(
    "postAt takes a Date, not a delay",
    /export async function postAt\(\s*kind: NotifyKind,\s*copy: NotifyCopy,\s*at: Date,?\s*\)/.test(
      local.replace(/\s+/g, " ").replace(/ \(/g, "("),
    ) || /postAt\(kind: NotifyKind, copy: NotifyCopy, at: Date\)/.test(local.replace(/\s+/g, " ")),
    local.match(/export async function postAt[^{]*/)?.[0],
  );

  // The whole app, not just this module: nothing outside src/notify may reach
  // the plugin directly, or the rules above are advisory.
  const app = src("src/App.tsx");
  ok(
    "App.tsx does not import the plugin directly",
    !/@capacitor\/local-notifications/.test(app),
    "the notification lane has exactly one door (src/notify/), and a second " +
      "caller is how the copy and schedule rules stop binding.",
  );

  // §5(b), on the shipped strings rather than on intent: nothing in the module
  // may contain a line of longing. `copy.ts` builds bodies from her messages,
  // so the only literals that can reach a lock screen are the two flat ones.
  const copySrc = strip(src("src/notify/copy.ts"));
  const literals = [...copySrc.matchAll(/"([^"\\]{4,})"/g)].map((m) => m[1]);
  const LONGING = /\bmiss(ing)? you|waiting for you|come back|why (didn't|don't)|kab aaoge/i;
  ok(
    "no longing in any shipped notification literal",
    literals.every((l) => !LONGING.test(l)),
    literals.filter((l) => LONGING.test(l)).join(" | "),
  );
  // and the generic line this whole workstream refuses
  const GENERIC = /new message|you have a|tap to (open|view)|is waiting/i;
  ok(
    "no generic notification body anywhere in the module",
    files.every((f) => !GENERIC.test(strip(src(f)))),
    files.filter((f) => GENERIC.test(strip(src(f)))).join(", "),
  );
}

// ══ 6. THE FCM SLOT IS OFF, AND OFF MEANS OFF ════════════════════════════
{
  ok("push is unconfigured in the shipping tree", M.pushConfigured() === false);
  const r = await M.registerForPush();
  ok("…so registering reports 'unconfigured'", r.ok === false && r.reason === "unconfigured", JSON.stringify(r));
  ok("…and submitting a token is refused", (await M.submitPushToken("", "d", "t")) === false);

  // The server halves, by source: the gate must come BEFORE the work, or it
  // only changes the response.
  const route = src("api/push-token.js");
  const gateAt = route.indexOf("if (!pushConfigured())");
  ok("api/push-token.js has a config gate", gateAt > 0);
  ok(
    "…before it reads the body",
    gateAt > 0 && gateAt < route.indexOf("req.body"),
    "a gate that runs after the work is a gate that only changes the response.",
  );
  ok(
    "…before any query",
    gateAt > 0 && gateAt < route.indexOf("await q("),
    "with no keys, migration 015 need not even be applied.",
  );
  const send = src("api/_push.js");
  // Scoped to sendPush's own body: `accessToken()` sits above it in the file
  // and legitimately fetches, so a whole-file index comparison would measure
  // the wrong two things and pass or fail for the wrong reason.
  const sendPushBody = send.slice(send.indexOf("export async function sendPush"));
  ok(
    "api/_push.js returns before any fetch when unconfigured",
    sendPushBody.indexOf('if (!pushConfigured()) return { sent: 0, reason: "unconfigured" };') <
      sendPushBody.indexOf("fetch("),
  );
  // A token is reachability: it must never be echoed back or logged. String
  // literals are blanked first — `json({ error: "bad token" })` names the field
  // in prose and is not a leak, and a check that cannot tell those apart is a
  // check that gets disabled the first time it cries wolf.
  const noStrings = route.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  ok("api/push-token.js never echoes a token", !/\.json\(\{[^}]*\btoken\b/.test(noStrings));
  ok("api/push-token.js logs nothing", !/console\.(log|error|warn)/.test(route));
  ok("api/_push.js logs nothing", !/console\.(log|error|warn)/.test(send));

  // The client config template is a template, not a filled-in key.
  const cfg = src("src/notify/config.ts");
  ok(
    "src/notify/config.ts ships every field empty",
    /apiKey: "",[\s\S]*authDomain: "",[\s\S]*projectId: "",[\s\S]*messagingSenderId: "",[\s\S]*appId: "",[\s\S]*vapidKey: "",/.test(cfg),
  );
  // The README half of the slot. Six named fields and a numbered list, so
  // turning push on is a paste rather than a workstream — and the check is that
  // the instructions NAME the console and every field, not that they read well.
  const flat = cfg.replace(/\r?\n\/\/\s*/g, " ");
  ok(
    "…and says exactly what the owner must paste",
    /console\.firebase\.google\.com/.test(flat) &&
      /Web Push certificates/.test(flat) &&
      /google-services\.json/.test(flat) &&
      ["FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"].every((k) => flat.includes(k)) &&
      /015_push_tokens\.sql/.test(flat),
    "src/notify/config.ts is the one place the owner is told what to do; a " +
      "slot with no instructions is a slot nobody can fill.",
  );
}

console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
