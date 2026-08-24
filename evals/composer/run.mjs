// WS-COMPOSER — sending more than one picture, with something written on it.
//
//   node evals/composer/run.mjs
//
// ── what this gates ────────────────────────────────────────────────────────
//
// The owner asked for four things: a caption field, a camera as well as a
// gallery, up to five pictures on one message, and for all of it to look like
// it belongs in this app. Three of those four are DECISIONS rather than
// pictures, and every one of them is the kind that fails silently:
//
//   * a cap that is enforced in one of the two places a picture can enter
//   * a wire shape that drops everything past the first image
//   * a caption that reaches the screen and not her context, or the reverse
//   * a collage that resolves 5 pictures to a layout for 5 pictures, which has
//     no arrangement that is not visibly wrong
//   * a SECOND compressor, which is invisible because its only symptom is a
//     slightly worse photograph on one of two code paths
//
// So the rules live in `src/components/attachments.ts`, pure, and this file
// drives them from a fresh bundle of that real source. The parts that are not
// pure (which component clears what, which field the persistence guard knows
// about) are asserted over the SOURCE, because the failure they prevent is a
// future edit and no test that runs today's code can see one.
//
// Offline, deterministic, no browser, no network, no model, $0, ~1s.
//
// ITS BROWSER HALF is `evals/composer-browser.mjs`, which drives the real
// preview build. That one is not wired here for the reason
// gameplay-browser.mjs states about itself: it needs a built app and a server
// on a port, and a gate that skips looks exactly like a gate that passed.

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${extra ? "\n      " + extra : ""}`);
  }
};

// ── the REAL module, bundled fresh (never a frozen copy) ──────────────────
const tmp = mkdtempSync(join(tmpdir(), "composer-"));
const ENTRY = join(tmp, "entry.ts");
const BUNDLE = join(tmp, "bundle.mjs");
writeFileSync(ENTRY, `export * from "${join(ROOT, "src/components/attachments")}";\n`);
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const A = await import(BUNDLE);

// The SERVER's own numbers, imported rather than restated. A client cap that
// has quietly drifted from the server's is either a refusal the user did not
// need (client tighter) or a 413 dressed up as a broken app (client looser),
// and both are invisible until someone hits them.
const { MAX_DOCS: SERVER_MAX_DOCS, MAX_DOC_CHARS: SERVER_MAX_DOC_CHARS } = await import(
  join(ROOT, "api/_docs.js")
);

/**
 * Just the `const FATE = { … }` object out of evals/teardown.mjs.
 *
 * The teardown checks below ask whether this feature added a top-level AppState
 * key — that is what a FATE row IS. Asking it of the whole file instead conflates
 * the table with the prose around it, and that file is mostly prose: §6 and §6b
 * exist precisely to write down verdicts for state the FATE walker cannot see,
 * so the names of this feature's draft fields are SUPPOSED to appear there. A
 * whole-file grep turns documenting a verdict into a gate failure, which is the
 * check punishing the behaviour it was built to require.
 */
const fateTable = () => {
  const t = src("evals/teardown.mjs");
  const at = t.indexOf("const FATE = {");
  if (at < 0) throw new Error("teardown.mjs no longer has a FATE table to check");
  const end = t.indexOf("\n};", at);
  if (end < 0) throw new Error("teardown.mjs's FATE table has no visible end");
  return t.slice(at, end);
};

/** a stand-in attachment of a chosen size; nothing here decodes a real JPEG */
let seq = 0;
const att = (bytes = 1000, source = "gallery") => ({
  id: `a${++seq}`,
  dataUrl: `data:image/jpeg;base64,${"Q".repeat(bytes)}`,
  b64: "Q".repeat(bytes),
  source,
});

/** a stand-in document; `packDoc` is what turns a real File into one of these */
const doc = (chars = 100, name = "notes.md") => ({
  id: `d${++seq}`,
  name,
  mime: "text/markdown",
  size: chars,
  text: "x".repeat(chars),
  data: "",
});

// ══ 1. THE CAP ════════════════════════════════════════════════════════════
//
// Five is the owner's number. The interesting case is not "six is refused" —
// it is that a gallery multi-select of EIGHT onto an empty tray yields five and
// a cue, rather than zero and a cue. A cap that answers an over-selection by
// taking nothing is a cap that argues with the user.
{
  console.log("\n── 1. the cap ──");
  ok("the cap is five", A.MAX_ATTACHMENTS === 5);

  const five = A.addAttachments([], [att(), att(), att(), att(), att()]);
  ok("five are accepted", five.next.length === 5 && five.accepted === 5 && five.refused === 0);
  ok("…and nothing is refused", five.reason === null);

  const sixth = A.addAttachments(five.next, [att()]);
  ok("the SIXTH is refused", sixth.next.length === 5 && sixth.accepted === 0 && sixth.refused === 1);
  ok("…and says why", sixth.reason === "full", String(sixth.reason));
  ok(
    "…without disturbing the five already there",
    sixth.next.every((a, i) => a.id === five.next[i].id),
  );

  const eight = A.addAttachments([], Array.from({ length: 8 }, () => att()));
  ok(
    "eight at once become five, not zero",
    eight.next.length === 5 && eight.accepted === 5 && eight.refused === 3,
    JSON.stringify({ n: eight.next.length, a: eight.accepted, r: eight.refused }),
  );

  const partial = A.addAttachments([att(), att(), att(), att()], [att(), att(), att()]);
  ok(
    "a partial tray takes exactly its remaining room",
    partial.next.length === 5 && partial.accepted === 1 && partial.refused === 2,
  );

  // THE NEGATIVE CONTROL. An assertion whose evidence is "the number was 5"
  // passes just as happily against a function that always returns 5 as against
  // a working cap. This is what an UNCAPPED append does to the same input, and
  // the suite above must be able to tell the difference.
  const uncapped = [...[], ...Array.from({ length: 8 }, () => att())];
  ok(
    "control: a plain append of the same eight overflows",
    uncapped.length === 8 && uncapped.length !== eight.next.length,
  );

  // removal, and the identity of what is left
  const gone = A.removeAttachment(five.next, five.next[2].id);
  ok("removing one leaves four", gone.length === 4);
  ok("…and removes the RIGHT one", !gone.some((a) => a.id === five.next[2].id));
  ok("removing an unknown id changes nothing", A.removeAttachment(five.next, "nope").length === 5);
}

// ══ 2. THE BYTE RAIL ══════════════════════════════════════════════════════
//
// The second way a send can be refused, and the one nobody would find by hand:
// five pictures that each survive the cap and together exceed what a serverless
// body will take. Without this the symptom is a 413, which the user reads as
// the app being broken.
{
  console.log("\n── 2. the byte rail ──");
  ok("there is a total-byte rail", A.MAX_TOTAL_B64 > 0);
  const big = Math.floor(A.MAX_TOTAL_B64 / 2) + 1;
  const two = A.addAttachments([], [att(big), att(big)]);
  ok(
    "two over-budget pictures become one",
    two.next.length === 1 && two.refused === 1 && two.reason === "heavy",
    JSON.stringify({ n: two.next.length, reason: two.reason }),
  );
  ok("totalBytes sums the tray", A.totalBytes([att(10), att(15)]) === 25);
  ok(
    "an ordinary five-picture tray is nowhere near the rail",
    A.totalBytes(Array.from({ length: 5 }, () => att(340_000))) < A.MAX_TOTAL_B64,
    "a realistic send is being refused by the safety rail, which makes the rail the bug",
  );
}

// ══ 3. THE COLLAGE ════════════════════════════════════════════════════════
//
// One row per count the composer can produce, plus the two ends nothing should
// crash on. FIVE IS FOUR TILES AND A VEIL: see attachments.ts for why a 5-up
// grid has no arrangement that does not read as a layout bug.
{
  console.log("\n── 3. the collage ──");
  const table = [
    [1, "one", 1, 0],
    [2, "two", 2, 0],
    [3, "three", 3, 0],
    [4, "four", 4, 0],
    [5, "four", 4, 1],
  ];
  for (const [n, shape, tiles, overflow] of table) {
    const c = A.collageFor(n);
    ok(
      `${n} picture${n === 1 ? "" : "s"} -> ${shape}, ${tiles} tiles, +${overflow}`,
      c && c.shape === shape && c.tiles === tiles && c.overflow === overflow,
      JSON.stringify(c),
    );
  }
  ok("zero has no collage", A.collageFor(0) === null);
  ok("a negative count has no collage", A.collageFor(-3) === null);
  ok("NaN has no collage", A.collageFor(NaN) === null);
  // a synced blob from another build can carry more than this composer allows
  const seven = A.collageFor(7);
  ok(
    "seven (a foreign blob) still draws, as four and a +3",
    seven && seven.shape === "four" && seven.tiles === 4 && seven.overflow === 3,
    JSON.stringify(seven),
  );
  ok(
    "every drawable count keeps tiles + overflow equal to the count",
    [1, 2, 3, 4, 5, 9].every((n) => {
      const c = A.collageFor(n);
      return c.tiles + c.overflow === n;
    }),
    "a tile is missing or the veil is lying about how many are behind it",
  );

  // THE STYLESHEET AND THE MODULE MUST AGREE ON THE WORDS. `data-shape` is the
  // seam between them, and a shape the CSS has never heard of renders as an
  // unstyled grid, which is a defect nothing else here can see.
  const css = src("src/styles/composer.css");
  for (const shape of ["one", "two", "three", "four"]) {
    ok(`composer.css styles data-shape="${shape}"`, css.includes(`[data-shape="${shape}"]`));
  }
  ok(
    "…and the CSS does not re-derive the arrangement from a child count",
    !/\.pgrid[^{]*:nth-child/.test(css),
    "a stylesheet counting tiles is a second, untested copy of collageFor()",
  );
}

// ══ 4. THE PAYLOAD ════════════════════════════════════════════════════════
//
// The shape agreed with the server workstream: `images` + `caption`, with the
// pre-existing single-photo body kept for the one case it already covers
// exactly. That exception is the risk budget for this whole feature, so it is
// pinned in both directions: it must appear when it should and must NOT appear
// when a caption or a second picture makes it wrong.
{
  console.log("\n── 4. the payload ──");
  const one = att(11);
  const p1 = A.buildImagePayload([one], "");
  ok("one picture, no caption: images has one", p1.images.length === 1);
  ok("…the caption is empty", p1.caption === "");
  ok("…and the LEGACY body rides along", p1.legacy !== null && p1.legacy.data === one.b64);
  ok("…as the mime the compressor actually produces", p1.legacy.mime === "image/jpeg");

  const p1c = A.buildImagePayload([one], "  look at this  ");
  ok("one picture WITH a caption: no legacy body", p1c.legacy === null);
  ok("…and the caption is trimmed", p1c.caption === "look at this");
  ok("…the picture is still there", p1c.images.length === 1);

  const p3 = A.buildImagePayload([att(), att(), att()], "goa");
  ok("three pictures: three images", p3.images.length === 3);
  ok("…in the order they were added", p3.images.every((u, i) => u.startsWith("data:image/jpeg")));
  ok("…no legacy body", p3.legacy === null);
  ok("…caption threaded", p3.caption === "goa");

  const p9 = A.buildImagePayload(Array.from({ length: 9 }, () => att()), "");
  ok(
    "the payload builder caps too, so a second producer cannot get past it",
    p9.images.length === A.MAX_ATTACHMENTS,
    `${p9.images.length}`,
  );

  ok("an empty tray builds an empty payload", A.buildImagePayload([], "hi").images.length === 0);

  // the client half of the contract, asserted where it is actually sent
  const mem = src("src/engine/memory.ts");
  const fn = mem.slice(mem.indexOf("export async function uploadPhotos"));
  const body = fn.slice(0, fn.indexOf("\nexport "));
  ok("uploadPhotos exists", fn.startsWith("export async function uploadPhotos"));
  ok("…and posts op upload_photo", /op:\s*"upload_photo"/.test(body));
  ok("…with the agreed `images` array", /\bimages,/.test(body));
  ok("…and the caption beside it", /\bcaption,/.test(body));
  ok(
    "…and keeps the legacy single-photo call for one picture with no caption",
    /images\.length === 1 && !caption/.test(body) && /uploadPhoto\(device/.test(body),
  );
  ok(
    "…and falls back per image when the server does not know the new shape",
    /images\.map\(\(u\) => uploadPhoto\(/.test(body),
    "a build that assumed the server had already shipped would drop every " +
      "picture past the first, silently, for as long as the two were out of step",
  );
  ok(
    "…and never throws at its caller",
    /catch \{/.test(body),
    "an upload rejection would land on the send handler",
  );
}

// ══ 5. THE CAPTION, ALL THE WAY THROUGH ═══════════════════════════════════
//
// A caption has to arrive in three places and they are easy to get partly
// right: on screen under the pictures, on the wire with them, and in the
// transcript her memory is built from. The transcript line is the one that
// rots quietly, because nothing user-facing depends on it.
{
  console.log("\n── 5. the caption ──");
  ok("one picture, no caption", A.transcriptLine(1, "") === "[photo]");
  ok(
    "…byte-identical to what the single-photo path always wrote",
    A.transcriptLine(1, "") === "[photo]" && A.transcriptLine(1, "hi") === "[photo] hi",
    "brain.ts compares against the literal '[photo]' when it decides whether a " +
      "caption is worth repeating; changing this string changes what she says",
  );
  ok("three pictures, no caption", A.transcriptLine(3, "") === "[3 photos]");
  ok("five with a caption", A.transcriptLine(5, "goa trip") === "[5 photos] goa trip");

  const chat = src("src/components/Chat.tsx");
  const send = chat.slice(chat.indexOf("async function sendAttachments"));
  const fnBody = send.slice(0, send.indexOf("\n  // WhatsApp/Telegram swipe"));
  ok("the send takes the caption off the composer", /const caption = draft\.trim\(\)/.test(fnBody));
  ok("…and clears the box", /setDraft\(""\)/.test(fnBody));
  ok("…and the typing-signal mirror with it", /draftRef\.current = ""/.test(fnBody));
  ok("…the caption becomes the message's text", /text: caption/.test(fnBody));
  ok("…the transcript line is the shared one", /transcriptLine\(/.test(fnBody));
  ok(
    "…and the reply cycle is woken with the caption",
    /scheduleReply\(caption\)/.test(fnBody),
    "she has to answer what he WROTE with the pictures, not only the pictures",
  );
  ok(
    "the composer's placeholder changes job when something is staged",
    /attachments\.length \|\| docs\.length \? "Add a caption/.test(chat),
    "a box that has become a caption field while still reading 'Message Maya' " +
      "is describing the control it was a second ago",
  );
  ok(
    "…and Send is reachable with pictures and an empty box",
    /draft\.trim\(\) \|\| attachments\.length \|\| docs\.length\s*\?\s*"send"/.test(chat),
    "a tray full of photos above a MICROPHONE offers the one thing the " +
      "composer cannot currently do",
  );
  ok(
    "send() routes a staged tray to the picture path",
    /if \(attachments\.length \|\| docs\.length\) \{[\s\S]{0,120}sendAttachments\(\)/.test(chat),
  );
}

// ══ 6. ONE COMPRESSION PIPELINE ═══════════════════════════════════════════
//
// The mechanical version of attachments.ts's own header. A second downscaler
// would drift from the first by one quality step and nobody would ever see it,
// because the only symptom is a slightly worse picture on one of two paths.
{
  console.log("\n── 6. one pipeline ──");
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n.startsWith(".") || n === "node_modules") continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n)) files.push(p);
    }
  };
  walk(join(ROOT, "src"));

  const encoders = files
    .filter((f) => /toDataURL\(\s*["']image\//.test(readFileSync(f, "utf8")))
    .map((f) => f.replace(ROOT + "/", ""))
    .sort();
  // TWO JPEG encoders exist in src/ and exactly two may. The second is
  // useCallEngine.ts's screen-share frame grabber, which is a different subject
  // entirely: it encodes a live video frame at call cadence for the watch lane,
  // it never touches a file the user chose, and nothing it produces reaches the
  // thread. Naming it here rather than excluding it silently is the point — the
  // day a third appears, this line is what says so, and whoever added it has to
  // write down which of the two it is a copy of.
  ok(
    "exactly two JPEG encoders in src/, and they are the known two",
    encoders.length === 2 &&
      encoders[0] === "src/components/attachments.ts" &&
      encoders[1] === "src/components/useCallEngine.ts",
    encoders.join(", "),
  );
  ok(
    "…and the picture-send path uses the first of them",
    encoders.includes("src/components/attachments.ts"),
  );

  ok("the pipeline's numbers are named, not inlined", A.PHOTO_MAX_DIM === 1024 && A.PHOTO_QUALITY === 0.82);
  const att_src = src("src/components/attachments.ts");
  ok(
    "…and the defaults are the single-photo path's own, unchanged",
    /maxDim = PHOTO_MAX_DIM/.test(att_src) && /quality = PHOTO_QUALITY/.test(att_src),
    "the picture a person sends today must not get worse because a second one " +
      "can now ride beside it",
  );
  ok("compressImage never throws", typeof A.compressImage === "function" && /catch \{/.test(att_src));

  const chat = src("src/components/Chat.tsx");
  ok(
    "Chat.tsx imports the pipeline rather than carrying one",
    /compressImage,/.test(chat) && !/function compressImage/.test(chat),
    "Chat.tsx defines its own compressor again",
  );
  ok(
    "…and every arriving picture goes through it",
    /files\.map\(\(f\) => compressImage\(f\)\)/.test(chat),
  );
  ok(
    "…before the cap and the rail look at it",
    chat.indexOf("compressImage(f)") < chat.indexOf("addAttachments(attachments"),
    "the byte rail would be measuring the ORIGINAL file, which is the wrong number",
  );
}

// ══ 7. THE TWO SOURCES ════════════════════════════════════════════════════
//
// Camera and gallery, and the rule that a source which cannot work is not
// offered. The camera row is the one that can rot: desktop Chromium exposes the
// `capture` attribute and then ignores it, so a detection that only asked
// whether the attribute existed would put a Camera row on a laptop that opens a
// file browser.
{
  console.log("\n── 7. the two sources ──");
  const sheet = src("src/components/SourceSheet.tsx");
  // comments stripped, for the reason the viewer's own check gives below: this
  // file ARGUES about the rejected detection at length, and a grep that counted
  // the argument as the offence would punish explaining yourself
  const sheetCode = sheet
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  ok("a source sheet exists", /export default function SourceSheet/.test(sheet));
  ok("…and reuses the app's sheet, not a new one", /className="sheet source-sheet"/.test(sheet));
  ok("…with the same scrim", /className="sheet-veil"/.test(sheet));
  ok("…and the same rows", /className="srow"/.test(sheet));
  ok("…Escape closes it", /e\.key === "Escape"/.test(sheet));
  ok("…and focus starts inside it", /\.focus\(\{ preventScroll: true \}\)/.test(sheet));

  ok("camera availability is feature-detected", /export function cameraAvailable/.test(sheet));
  ok("…native is unconditional", /Capacitor\.isNativePlatform\(\)/.test(sheet));
  ok(
    "…and the web asks whether this is a phone, through the pointer",
    /pointer: coarse/.test(sheetCode) && /maxTouchPoints/.test(sheetCode),
    "HTML Media Capture is a phone feature; a desktop browser either lacks it " +
      "or exposes it and ignores it, opening a file dialog under a row that " +
      "says Camera",
  );
  ok(
    "…and NOT through the `capture` IDL attribute",
    !/"capture" in /.test(sheetCode),
    "measured in evals/composer-browser.mjs: `\"capture\" in input` reads FALSE " +
      "in desktop Chromium 141, so an attribute test agrees with the pointer " +
      "test on a laptop and cannot be trusted to agree with it on a phone",
  );
  ok(
    "…and the row is not rendered when it is unavailable",
    /\{room > 0 && camera && \(/.test(sheet),
    "a disabled Camera row is the dead-option rule broken one level down",
  );

  const chat = src("src/components/Chat.tsx");
  ok("the camera input carries capture", /capture="environment"/.test(chat));
  ok("the gallery input carries multiple", /ref=\{galleryRef\}[\s\S]{0,200}multiple/.test(chat));
  ok(
    "…and the camera input does NOT",
    !/ref=\{cameraRef\}[\s\S]{0,220}\smultiple/.test(chat),
    "a multi-select camera intent is not a thing; it degrades to a file picker",
  );
  ok(
    "both sources land in the same tray rather than sending",
    (chat.match(/takeFiles\(Array\.from\(e\.target\.files/g) || []).length === 2,
  );
  ok(
    "the attach button opens the sheet rather than a file dialog",
    /data-tel="chat\.attach"[\s\S]{0,600}setSourceOpen\(true\)/.test(chat),
  );

  // NO PLUGIN WAS ADDED, and that is a decision with a cost attached. See
  // Chat.tsx's note beside the inputs: this APK's OTA contract counts a new
  // plugin method as a break that forces every install to reinstall.
  const pkg = JSON.parse(src("package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  ok(
    "no camera plugin was added: the platform already does this",
    !deps["@capacitor/camera"],
    "adding one breaks OTA_NATIVE_CONTRACT for a capability the WebView has",
  );
  ok(
    "…and the CAMERA permission the platform path needs is declared",
    /android\.permission\.CAMERA/.test(src("android/app/src/main/AndroidManifest.xml")),
  );
}

// ══ 8. THE TEARDOWN, AND THE STORE ════════════════════════════════════════
//
// evals/teardown.mjs asks every AppState field what happens to it when the
// relationship is deleted. This feature adds state in two places that walker
// structurally cannot see, and both of them get their verdict here, in the same
// written form — which is the shape §6 of that file established for exactly
// this gap.
//
//   the compose tray     "clear+forget": draft state, component-local, wiped by
//                        both doors. A picture staged for a conversation that no
//                        longer exists belongs to that conversation.
//   Message.photoUrls    "clear+forget BY CONSTRUCTION": it is a field ON a
//                        message, so it is inside AppState.messages, whose
//                        verdict in that table is already clear+forget. The
//                        thing to check is not the verdict, it is that no NEW
//                        top-level key was introduced to dodge it.
{
  console.log("\n── 8. the teardown ──");
  const chat = src("src/components/Chat.tsx");
  const store = src("src/state/store.ts");

  const at = chat.indexOf("function tearDownLocally");
  ok("tearDownLocally was found", at > 0);
  const fn = chat.slice(at, chat.indexOf("\n  function ", at + 10));
  ok("…it empties the compose tray", /setAttachments\(\[\]\)/.test(fn));
  ok("…it closes the source sheet", /setSourceOpen\(false\)/.test(fn));
  ok(
    "…and it closes the photo viewer",
    /setViewer\(null\)/.test(fn),
    "a viewer left open over a wiped thread is the wiped thread, still on screen",
  );

  const iface = store.slice(store.indexOf("export interface AppState {"));
  const appState = iface.slice(0, iface.indexOf("\n}"));
  ok(
    "no attachment-shaped key entered AppState",
    !/\b(attachments|draftPhotos|pendingImages|composeTray)\b/.test(appState),
    "a new AppState key needs a row in evals/teardown.mjs's FATE table, and a " +
      "tray of data: URLs in synced state is another device's draft",
  );
  // SCOPED TO THE TABLE, not grepped over the file. The first version of this
  // asserted the WORD "attachments" appeared nowhere in evals/teardown.mjs,
  // which was a proxy that happened to hold only while this feature had not yet
  // written its verdicts down. It broke the moment §6b was added — the block
  // that states, in that file, what happens to the draft — so the check was
  // failing the workstream for doing the documenting the check exists to
  // encourage. What it always MEANT is narrower and is what it now asks: no new
  // top-level key entered the FATE object, because a key there is an AppState
  // field and an AppState field is the thing that syncs and persists.
  ok(
    "…so evals/teardown.mjs's FATE TABLE is untouched by this feature",
    !/\b(attachments|photoUrls|composeTray|draftPhotos)\b/.test(fateTable()),
    "a top-level FATE row means a new AppState key — the tray is component " +
      "state and must stay that way.",
  );
  ok(
    "…and the draft's verdicts are written down where §6 puts them",
    /COMPOSER_DRAFT_FATE/.test(src("evals/teardown.mjs")),
    "state the FATE walker cannot see needs its verdict in that file anyway, " +
      "or a teardown that missed a piece would pass every check in it.",
  );

  const msg = store.slice(store.indexOf("export interface Message {"));
  const message = msg.slice(0, msg.indexOf("\n}"));
  ok("Message carries photoUrls", /photoUrls\?: string\[\]/.test(message));
  ok(
    "…and messages are wiped by BOTH doors, so the pictures go with them",
    /^\s*messages: "clear\+forget",/m.test(src("evals/teardown.mjs")),
  );

  // THE PERSISTENCE GUARD. `persistable` strips stuck data: URLs so one failed
  // upload cannot brick the store. A five-picture message is the largest thing
  // this store can hold, so a guard that only knew `photoUrl` would have got
  // quieter exactly as the blobs got five times bigger.
  const p = store.slice(store.indexOf("function persistable"));
  const pers = p.slice(0, p.indexOf("\nexport function saveState"));
  ok("persistable strips stuck data: URLs", /startsWith\("data:"\)/.test(store));
  ok("…from photoUrl", /stuck\(m\.photoUrl\)/.test(pers));
  ok(
    "…and from photoUrls",
    /m\.photoUrls\?\.some\(stuck\)/.test(pers),
    "five stuck data: URLs on one message is the biggest blob this store can " +
      "hold, and the guard built for exactly that case would walk past it",
  );
  ok(
    "…keeping the ones that DID upload",
    /filter\(\(u\) => !stuck\(u\)\)/.test(pers),
    "an all-or-nothing strip throws away permanent URLs to punish a temporary one",
  );
}

// ══ 9. THE THREAD, AND THE VIEWER ═════════════════════════════════════════
{
  console.log("\n── 9. the thread ──");
  const row = src("src/components/MessageRow.tsx");
  ok("the row reads the pictures through imagesOf", /imagesOf\(m\)/.test(row));
  ok("…renders a collage past one", /mine\.length > 1 \? \(\s*<PhotoGrid/.test(row));
  ok("…and the caption stays in the same bubble", /m\.text && <div className="cap">/.test(row));
  ok("…under the pictures, not over them", row.indexOf("PhotoGrid") < row.indexOf('className="cap"'));
  ok("…with the existing tick and timestamp idiom", /<TickIcon status=\{m\.status \?\? "read"\}/.test(row));
  ok(
    "a single picture opens the viewer too",
    /data-tel="chat\.photo_open"[\s\S]{0,200}api\.openPhotos\(m, 0\)/.test(row),
    "tapping a photo to see it larger is the first thing every person tries",
  );

  ok("imagesOf prefers the new field", A.imagesOf({ photoUrls: ["a", "b"], photoUrl: "a" }).length === 2);
  ok("…falls back to the legacy one", A.imagesOf({ photoUrl: "z" })[0] === "z");
  ok("…and a message with neither has no pictures", A.imagesOf({}).length === 0);
  ok(
    "…and an empty array does not shadow the legacy field",
    A.imagesOf({ photoUrls: [], photoUrl: "z" })[0] === "z",
    "an older build writing photoUrls: [] would blank the picture entirely",
  );
  ok("…and holes are dropped", A.imagesOf({ photoUrls: ["a", "", "b"] }).length === 2);

  const viewer = src("src/components/PhotoViewer.tsx");
  ok("a viewer exists", /export default function PhotoViewer/.test(viewer));
  ok("…it swipes between the set", /translateX/.test(viewer));
  ok("…rubber-bands at both ends", /atStart \|\| atEnd \? band\(/.test(viewer));
  ok("…projects momentum rather than snapping to the nearest", /v \* PROJECT_MS/.test(viewer));
  ok("…swipes down to dismiss", /d\.dy > 110/.test(viewer));
  ok("…answers the keyboard", /ArrowRight/.test(viewer) && /Escape/.test(viewer));
  ok(
    "…and a new grab beats the settle in flight",
    /style\.transition = "none"/.test(viewer),
    "starting an interrupted animation from the logical value causes a visible jump",
  );
  // Comments stripped first: this file's own header ARGUES about the story
  // reader at length, and a grep that counted the argument as the offence would
  // be a check that punishes explaining yourself.
  const viewerCode = viewer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join("\n");
  ok(
    "…it does NOT reuse the story reader's classes",
    !/story-view|story-img|story-bars/.test(viewerCode),
    "an edit to Instagram's story mechanics must not be able to change what a " +
      "photo he sent does",
  );
}

// ══ 10. DOCUMENTS: THE CAP AND THE CHIP ═══════════════════════════════════
//
// Three per message, its own cap and its own rail, because a document and a
// picture are bounded by different things: five pictures are five vision
// tokens, three documents are 8,000 characters of prompt. Sharing one counter
// would mean a PDF costing a photograph.
{
  console.log("\n── 10. the document cap ──");
  ok("the document cap is three", A.MAX_DOCS === 3);
  ok("…and it matches the server's own", A.MAX_DOCS === SERVER_MAX_DOCS, `${A.MAX_DOCS} vs ${SERVER_MAX_DOCS}`);

  const three = A.addDocs([], [doc(), doc(), doc()]);
  ok("three are accepted", three.next.length === 3 && three.accepted === 3 && three.refused === 0);
  const fourth = A.addDocs(three.next, [doc()]);
  ok("the FOURTH is refused", fourth.next.length === 3 && fourth.accepted === 0 && fourth.refused === 1);
  ok("…and says why", fourth.reason === "full", String(fourth.reason));
  ok(
    "…without disturbing the three already there",
    fourth.next.every((d, i) => d.id === three.next[i].id),
  );
  const five = A.addDocs([], [doc(), doc(), doc(), doc(), doc()]);
  ok(
    "five at once become three, not zero",
    five.next.length === 3 && five.accepted === 3 && five.refused === 2,
    JSON.stringify({ n: five.next.length, a: five.accepted, r: five.refused }),
  );
  const gone = A.removeDoc(three.next, three.next[1].id);
  ok("removing one leaves two", gone.length === 2);
  ok("…and removes the RIGHT one", !gone.some((d) => d.id === three.next[1].id));

  // the rail, which is about the REQUEST rather than about the count
  const heavy = Math.floor(A.MAX_DOCS_TOTAL_CHARS / 2) + 1;
  const two = A.addDocs([], [doc(heavy), doc(heavy)]);
  ok(
    "two over-budget documents become one",
    two.next.length === 1 && two.reason === "heavy",
    JSON.stringify({ n: two.next.length, reason: two.reason }),
  );
  ok(
    "…and the rail leaves a serverless body room to exist",
    A.MAX_DOCS_TOTAL_CHARS <= 4_000_000 && A.MAX_DOC_BYTES <= A.MAX_DOCS_TOTAL_CHARS,
    `${A.MAX_DOC_BYTES} / ${A.MAX_DOCS_TOTAL_CHARS}`,
  );
  ok(
    "…and one document can never exceed what the server accepts",
    A.MAX_DOC_BYTES * 1.4 < SERVER_MAX_DOC_CHARS,
    `${A.MAX_DOC_BYTES} raw inflates past the server's ${SERVER_MAX_DOC_CHARS} of base64`,
  );

  // THE TWO CAPS ARE INDEPENDENT. The case that would be silently wrong if
  // they shared a counter: a full picture tray must not refuse a document.
  ok(
    "a full picture tray still takes documents",
    A.addDocs([], [doc()]).accepted === 1 && A.addAttachments(
      [att(), att(), att(), att(), att()], [att()],
    ).accepted === 0,
  );

  // ── the chip's own logic ──
  console.log("\n── 10b. the chip ──");
  ok("the badge is the extension, uppercased", A.docExt("lease-final.pdf") === "PDF");
  ok("…from the LAST dot", A.docExt("notes.v2.md") === "MD");
  ok("…and a name with no extension still says something", A.docExt("README") === "FILE");
  ok("…a trailing dot is not an extension", A.docExt("weird.") === "FILE");
  ok("bytes read short before they read precise", A.docSize(940) === "940 B");
  ok("…kilobytes", A.docSize(1536) === "1.5 KB");
  ok("…and megabytes", A.docSize(2_400_000) === "2.4 MB");
  ok("…a nonsense size renders nothing rather than NaN", A.docSize(NaN) === "");

  ok("plain formats are recognised by mime", A.isPlainDoc("x", "text/csv") === true);
  ok("…and by extension when the mime is missing", A.isPlainDoc("notes.md", "") === true);
  ok(
    "…and a PDF is not one of them",
    A.isPlainDoc("lease.pdf", "application/pdf") === false,
    "a client-side 'read the text' on a page-description format returns mojibake",
  );
  ok(
    "the picker offers exactly what the packer can handle",
    A.DOC_ACCEPT.split(",").every((e) => e.startsWith(".")) &&
      /\.pdf/.test(A.DOC_ACCEPT) &&
      A.DOC_ACCEPT.split(",")
        .filter((e) => e !== ".pdf")
        .every((e) => A.isPlainDoc(`f${e}`, "")),
    A.DOC_ACCEPT,
  );

  const tray = src("src/components/ComposeTray.tsx");
  ok("the tray renders file chips", /className="tray-doc"/.test(tray));
  // WS-ASSETWIRE moved the badge itself into `DocBadge`, which owns the choice
  // between a drawn mark and the letters; `docExt` is now called inside it
  // rather than at the two chip sites. The property this line has always been
  // about is unchanged and is what it still checks: a chip carries a badge, a
  // name and a size, and there is exactly ONE badge implementation.
  ok(
    "…with the badge, the name and the size",
    /<DocBadge[\s\S]*?name=\{d\.name\}/.test(tray) && /docSize\(d\.size\)/.test(tray),
  );
  ok("…and a remove button per chip", /data-tel="compose\.remove_doc"/.test(tray));
  ok(
    "…and the chips share one implementation with the thread's",
    /<DocBadge/.test(src("src/components/DocChips.tsx")) &&
      /docExt/.test(src("src/components/DocBadge.tsx")),
    "two chip renderers is two places for the badge to drift",
  );
}

// ══ 11. THE COUNT LINE, WITH TWO CAPS ═════════════════════════════════════
{
  console.log("\n── 11. the count line ──");
  ok("pictures only count against five", A.trayCount(3, 0) === "3 of 5");
  ok("documents only count against three", A.trayCount(0, 2) === "2 of 3");
  ok(
    "both in play stops counting and names them",
    A.trayCount(3, 1) === "3 photos, 1 file",
    A.trayCount(3, 1),
  );
  ok("…and it is singular when it should be", A.trayCount(1, 1) === "1 photo, 1 file");
  ok("…plural on the other side too", A.trayCount(2, 2) === "2 photos, 2 files");
}

// ══ 12. THE DOCS PAYLOAD ══════════════════════════════════════════════════
//
// `api/_docs.js`'s `normalizeDocs` is the reader. Its contract: an array of at
// most MAX_DOCS objects, each with a name, a mime, and EITHER text or data.
{
  console.log("\n── 12. the docs payload ──");
  const plain = { ...doc(50), name: "notes.md", mime: "text/markdown", text: "x".repeat(50), data: "" };
  const pdf = { ...doc(0), name: "lease.pdf", mime: "application/pdf", text: "", data: "data:application/pdf;base64,QQ==" };

  const p = A.buildDocPayload([plain, pdf]);
  ok("one entry per document", p.length === 2);
  ok("…the name rides", p[0].name === "notes.md" && p[1].name === "lease.pdf");
  ok("…and the mime", p[0].mime === "text/markdown" && p[1].mime === "application/pdf");
  ok(
    "a client-readable format sends TEXT",
    p[0].text === "x".repeat(50) && p[0].data === undefined,
    "sending a .md as base64 is a third more bytes for the server to decode " +
      "back into exactly what the client already had",
  );
  ok(
    "a PDF sends DATA",
    p[1].data === "data:application/pdf;base64,QQ==" && p[1].text === undefined,
    JSON.stringify(p[1]),
  );
  ok(
    "…never both",
    p.every((d) => (d.text === undefined) !== (d.data === undefined)),
    "a server choosing between two representations of the same file is a " +
      "decision nobody wrote down",
  );
  ok(
    "the builder caps too, so a second producer cannot get past it",
    A.buildDocPayload([plain, plain, plain, plain, plain]).length === A.MAX_DOCS,
  );
  ok("an empty tray builds an empty payload", A.buildDocPayload([]).length === 0);

  // what stays on the message: metadata, never bytes
  const refs = A.docRefs([plain, pdf]);
  ok("the message keeps a row per document", refs.length === 2);
  ok("…with name, mime and size", refs[0].name === "notes.md" && typeof refs[0].size === "number");
  ok(
    "…and NOTHING that could hold the file",
    refs.every((r) => Object.keys(r).sort().join(",") === "mime,name,size"),
    JSON.stringify(refs[0]) +
      " — a 2 MB PDF in AppState is saveState's whole degradation ladder fired " +
      "by one attachment, and no upload ever comes along to replace it",
  );

  const store = src("src/state/store.ts");
  const msg = store.slice(store.indexOf("export interface Message {"));
  const message = msg.slice(0, msg.indexOf("\n}"));
  ok(
    "Message.docs is declared as metadata only",
    /docs\?: Array<\{ name: string; mime: string; size: number \}>/.test(message),
    "a `data` or `text` field here is the bytes entering the store",
  );
}

// ══ 13. THE TRANSCRIPT, WITH FILES ════════════════════════════════════════
//
// The line she still has in three months. A document's text is never stored
// anywhere, so this is the entire long-term record of the fact that it existed.
{
  console.log("\n── 13. the transcript ──");
  ok("the picture lines are BYTE-IDENTICAL to before", A.transcriptLine(1, "") === "[photo]" &&
    A.transcriptLine(1, "hi") === "[photo] hi" &&
    A.transcriptLine(3, "") === "[3 photos]" &&
    A.transcriptLine(5, "goa trip") === "[5 photos] goa trip");
  ok("one file, no caption", A.transcriptLine(0, "", ["lease.pdf"]) === "[file lease.pdf]");
  ok("one file with a caption", A.transcriptLine(0, "padh lena", ["lease.pdf"]) === "[file lease.pdf] padh lena");
  ok(
    "several files are named, not counted",
    A.transcriptLine(0, "", ["a.pdf", "b.csv"]) === "[file a.pdf] [file b.csv]",
    "'2 files' three months later is a fact she cannot use; the NAME is the " +
      "thing a person actually remembers",
  );
  ok(
    "pictures and files on one message",
    A.transcriptLine(2, "ye dekh", ["lease.pdf"]) === "[2 photos] [file lease.pdf] ye dekh",
  );
  ok("a bare text message is untouched", A.transcriptLine(0, "just words") === "just words");
  ok("…and an empty everything is empty", A.transcriptLine(0, "") === "");

  // the brain's reader of that line
  const brain = src("src/engine/brain.ts");
  ok("toTurns names the files it finds on a message", /they sent \$\{[\s\S]{0,80}files/.test(brain));
  ok(
    "…and strips the composer's own head first",
    /\\\[file \[\^\\\]\]\*\\\]/.test(brain) || /\[file \[\^\\\]\]\*\\\]/.test(brain),
    "handing her '[file lease.pdf] ye dekh' as a caption has her reading a " +
      "marker back as if he had typed it",
  );
  ok(
    "…and a message with pictures AND files names both",
    /also sent: \$\{docNames\.join/.test(brain),
  );
}

// ══ 14. EXACTLY ONCE: THE TAKE-ONCE BOX ═══════════════════════════════════
//
// THE ASSERTION THE BRIEF ASKED FOR, and the one this whole slice turns on.
// A document reaches her through `think`'s `attachments` parameter, which means
// exactly one reply pass may carry it, and both ways of getting that wrong are
// silent: send it every pass and a burst hands her the same PDF three times
// inside one turn; send it once and forget it and a superseded pass throws away
// the only copy there will ever be.
{
  console.log("\n── 14. exactly once ──");
  const payload = [{ name: "a.pdf", mime: "application/pdf", data: "d" }];

  const hold = { current: null };
  A.holdDocs(hold, payload);
  ok("holding fills the box", hold.current?.length === 1);
  const first = A.takeDocs(hold);
  ok("the first take gets them", first?.length === 1);
  ok("…and empties the box", hold.current === null);
  const second = A.takeDocs(hold);
  ok(
    "A SECOND PASS SENDS NO DOCS",
    second === null,
    "the same document reaching her twice inside one turn is her reacting to " +
      "it twice, which is the tell",
  );

  // superseded: put back, and the NEXT pass gets them exactly once
  A.restoreDocs(hold, first);
  ok("a superseded pass puts them back", hold.current?.length === 1);
  ok("…and the next pass gets them", A.takeDocs(hold)?.length === 1);
  ok("…once", A.takeDocs(hold) === null);

  // a newer send while the old pass was in flight wins
  A.holdDocs(hold, payload);
  const taken = A.takeDocs(hold);
  const newer = [{ name: "b.csv", mime: "text/csv", text: "x" }];
  A.holdDocs(hold, newer);
  A.restoreDocs(hold, taken);
  ok(
    "restoring never overwrites a NEWER send",
    hold.current?.[0]?.name === "b.csv",
    "he attached something else while she was thinking; the older set is not " +
      "the one the next pass owes him",
  );

  // holding nothing clears, so a text-only send cannot inherit the last one
  A.holdDocs(hold, []);
  ok(
    "an empty hold CLEARS the box",
    hold.current === null,
    "otherwise the next plain text message would carry the last send's files",
  );
  ok("restoring null is a no-op", (A.restoreDocs(hold, null), hold.current === null));

  // ── and the wiring, over the source, because the box is only half of it ──
  const chat = src("src/components/Chat.tsx");
  // BOUNDED AT THE NEXT DECLARATION, not at a comment further down the file:
  // an over-wide slice would have swept `sendAttachments` into "replyPass's
  // body" and every absence-assertion below would have been reporting on the
  // wrong function.
  const pass = chat.slice(chat.indexOf("async function replyPass"));
  const passEnd = Math.min(
    ...[/\n  (?:async )?function /, /\n  const [A-Za-z]/]
      .map((re) => {
        const m = re.exec(pass.slice(40));
        return m ? m.index + 40 : Infinity;
      }),
  );
  ok("replyPass was isolated", Number.isFinite(passEnd) && passEnd < pass.length, String(passEnd));
  const body = pass.slice(0, passEnd);
  ok(
    "replyPass is the ONE caller of the attachments seam",
    (chat.match(/turnDocs \? \{ docs: turnDocs \} : undefined/g) || []).length === 1,
    "a second caller is a second place for the double-send to come back",
  );
  ok("…it takes from the box", /const turnDocs = takeDocs\(docHold\)/.test(body));
  ok(
    "…BEFORE the think, not after",
    body.indexOf("takeDocs(docHold)") < body.indexOf("await think("),
    "taking after the call leaves a window where a concurrent pass takes the " +
      "same documents",
  );
  ok(
    "…and puts them back when the pass was superseded",
    /seq !== chatSeq\.current[\s\S]{0,900}restoreDocs\(docHold, turnDocs\)/.test(body),
    "a superseded pass that keeps them is the owner attaching a PDF, typing " +
      "one more line, and her never seeing the PDF at all",
  );
  ok(
    "…and the epoch branch does NOT put them back",
    !/ep !== epoch\.current\) \{?\s*restoreDocs/.test(body),
    "an epoch change is the conversation being torn down; its documents go " +
      "with it",
  );
  ok(
    "the send parks them before waking the reply cycle",
    /holdDocs\(docHold, docPayload\)[\s\S]{0,400}scheduleReply\(caption\)/.test(chat),
    "a pass that wakes before the box is filled sends the message without its " +
      "own documents",
  );
  ok(
    "IMAGES ARE NOT PASSED THROUGH THE SEAM",
    !/images:\s*payload\.images[\s\S]{0,60}\}\s*:\s*undefined/.test(chat) &&
      !/\{ images:/.test(body),
    "pictures ride the thread (toTurns rebuilds them from photoUrls); passing " +
      "them here as well puts the same picture in the prompt twice",
  );
  ok(
    "…and NEITHER IS THE CAPTION",
    !/\bcaption:/.test(body),
    "the server appends a top-level `caption` to the last turn, and the caption " +
      "IS Message.text, which toTurns has already written into that same turn. " +
      "Sending both is the images mistake one field over.",
  );
}

// ══ 15. THE DOC TEARDOWN ══════════════════════════════════════════════════
//
// §8 asked what happens to the compose tray. This asks the same of the two
// things the document slice added, and one of them is the worst piece of state
// in the feature: a ref holding the TEXT of a document, which nothing about a
// re-render disturbs and which the epoch bump does not reach, because nothing
// reads the epoch when taking it.
{
  console.log("\n── 15. the doc teardown ──");
  const chat = src("src/components/Chat.tsx");
  const at = chat.indexOf("function tearDownLocally");
  const fn = chat.slice(at, chat.indexOf("\n  function ", at + 10));
  ok("the staged documents are dropped", /setDocs\(\[\]\)/.test(fn));
  ok(
    "…and so is the parked payload",
    /docHold\.current = null/.test(fn),
    "a surviving hold is the text of a document handed to the very first reply " +
      "of the conversation that begins by not knowing him",
  );

  const store = src("src/state/store.ts");
  const iface = store.slice(store.indexOf("export interface AppState {"));
  const appState = iface.slice(0, iface.indexOf("\n}"));
  // Parsed as FIELD NAMES, the way evals/teardown.mjs's own walker does it,
  // rather than grepped over the text: this interface is mostly prose, and a
  // comment citing `docs/MEMORY-FELT.md` is not a field called docs.
  const appFields = [...appState.matchAll(/^ {2}([A-Za-z0-9_]+)\??:/gm)].map((m) => m[1]);
  ok("AppState's keys were parsed", appFields.length >= 20, `${appFields.length}`);
  ok(
    "no document-shaped key entered AppState",
    !appFields.some((f) => /^(docs|documents|attachedDocs|pendingDocs|docHold)$/.test(f)),
    `a new AppState key needs a row in evals/teardown.mjs's FATE table: ${appFields.join(", ")}`,
  );
  // Same correction as §8: scoped to the FATE object, not to the file. See the
  // note there for why the whole-file grep was the wrong question.
  ok(
    "…so the FATE TABLE is still untouched by this workstream",
    !/\b(docs|documents|attachedDocs|pendingDocs|docHold)\b/.test(fateTable()),
    "a top-level FATE row means a new AppState key; documents are draft state " +
      "and their bytes are never persisted at all.",
  );
  ok(
    "…and docHold's verdict IS written down, in §6b",
    /docHold/.test(src("evals/teardown.mjs")),
    "the parked payload holds document TEXT and the FATE walker cannot see " +
      "it, so an unwritten verdict is an unchecked one.",
  );
  ok(
    "Message.docs rides `messages`, which BOTH doors wipe",
    /^\s*messages: "clear\+forget",/m.test(src("evals/teardown.mjs")),
  );

  // the persistence guard cannot save us here, so the field must not need it
  const p = store.slice(store.indexOf("function persistable"));
  const pers = p.slice(0, p.indexOf("\nexport function saveState"));
  ok(
    "persistable does not have to strip docs, because docs carry no bytes",
    !/\bdocs\b/.test(pers),
    "if this ever needs a strip, the field is holding something it should not",
  );
}

console.log(fail ? `\n${fail} FAILURES` : "\nALL PASS");
process.exit(fail ? 1 : 0);
