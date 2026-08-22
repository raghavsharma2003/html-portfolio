// Task #76 proof — the NATIVE watch lane, end to end, with only the Android
// process itself stubbed.
//
//   stubbed "watchwake" / "watchturn" bridge event
//     -> the REAL src/native/watch.ts listener + dispatch
//     -> the REAL armMomentWindow / consumeMomentWindow (bundled from
//        src/components/useCallEngine.ts, wired the way that file wires them)
//     -> the REAL api/episodes.js handler, op:"watch_moment"
//     -> a REAL vy_shared_moment row in Postgres, then zero residue.
//
// Nothing here re-models the gate: the only fakes are @capacitor/core (the
// process boundary, which cannot exist off device) and the HTTP req/res pair
// (evals/multimodal/fixtures.mjs's own mock, as db-writer.mjs uses).
//
//   node fix76-native-e2e.mjs
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = "/home/user/html-portfolio";
const STUB = join(HERE, "capacitor-stub.mjs");

const tmp = mkdtempSync(join(tmpdir(), "fix76-"));
const ENTRY = join(tmp, "entry.mjs");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(ROOT, "src/native/watch.ts"))};\n` +
    `export { __bridge } from "@capacitor/core";\n`,
);
const WATCH_BUNDLE = join(tmp, "watch.bundle.mjs");
const ENGINE_BUNDLE = join(tmp, "useCallEngine.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --alias:@capacitor/core=${STUB} --outfile=${WATCH_BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
execSync(
  `npx esbuild ${join(ROOT, "src/components/useCallEngine.ts")} --bundle --format=esm --platform=node --outfile=${ENGINE_BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);

const { startWatch, watchOwned, __bridge } = await import(WATCH_BUNDLE);
const { armMomentWindow, consumeMomentWindow, WATCH_MOMENT_WINDOW_MS } = await import(ENGINE_BUNDLE);
const { q } = await import(join(ROOT, "api/_db.js"));
const episodes = await import(join(ROOT, "api/episodes.js"));
const handler = episodes.default;
const { MARKER, makeFixturePerson, teardown, assertZeroResidue, mockReqRes } = await import(
  join(ROOT, "evals/multimodal/fixtures.mjs")
);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

// ── the useCallEngine side, transcribed from its own two call sites and
// nothing more: the onWake callback (arm) and noteHerLine's tail (consume,
// clear unconditionally, post only when a moment survived). postWatchMoment
// is module-private, so its fetch is replaced by the direct handler call the
// same body would have reached — db-writer.mjs proves the wire hop itself.
function makeLane(deviceId) {
  const lane = {
    live: true,
    priv: false,
    pending: null,
    posts: [],
    onWake(cls, at = Date.now()) {
      if (!lane.live) return;
      if (lane.priv) return;
      lane.pending = armMomentWindow(lane.pending, cls, at);
    },
    async onHerLine(text, at = Date.now()) {
      if (!lane.live) return;
      const moment = consumeMomentWindow(lane.pending, at);
      lane.pending = null;
      if (moment && !lane.priv) {
        const body = { op: "watch_moment", device: deviceId, reaction: text };
        lane.posts.push(body);
        const { req, res } = mockReqRes(body);
        await handler(req, res);
        return res;
      }
      return null;
    },
  };
  return lane;
}

const { personId, deviceId } = await makeFixturePerson();
console.log(`fixture person ${personId}`);

try {
  // ── 1. the real bridge: startWatch registers the listeners and a native
  //      "watchwake" reaches the onWake handler ────────────────────────────
  const lane = makeLane(deviceId);
  const seen = { frames: 0, turns: [], wakes: [], stopped: 0 };
  const session = await startWatch(
    { base: "x", system: "s", systemTail: "t", directive: "d" },
    () => seen.frames++,
    (who, text) => {
      seen.turns.push([who, text]);
      if (who === "her") lane.pendingLine = text;
    },
    () => seen.stopped++,
    (cls) => {
      seen.wakes.push(cls);
      lane.onWake(cls);
    },
  );
  ok("startWatch resolves and owns the native listeners", watchOwned() === true);
  ok(
    "the bridge registered a 'watchwake' listener",
    (__bridge.listeners.get("watchwake") ?? []).length === 1,
  );
  ok("Watch.start() was called with the compiled config", __bridge.calls.some((c) => c.method === "start"));

  __bridge.emit("watchwake", { class: "settle" });
  ok("a native SHOW wake reaches the JS onWake callback", seen.wakes.join(",") === "settle");
  ok("...and arms exactly one moment window", lane.pending?.cls === "settle");

  __bridge.emit("watchwake", { class: "idle" });
  ok("an ambient wake cannot clobber the open window", lane.pending?.cls === "settle");

  // ── 2. her next line, delivered as the native "watchturn" event, records
  //      a REAL vy_shared_moment row through the REAL handler ──────────────
  const reaction = `${MARKER}arre that edit is so good ya`;
  __bridge.emit("watchturn", { who: "her", text: reaction });
  ok("a native turn reaches the JS onTurn callback", seen.turns.length === 1 && seen.turns[0][0] === "her");
  const res = await lane.onHerLine(reaction);
  ok("the handler answered 200", res?.statusCode === 200, `status=${res?.statusCode}`);
  ok("the handler reports ok:true", res?.body?.ok === true, JSON.stringify(res?.body));

  const rows = await q(
    `select m.*, e.channel from vy_shared_moment m join vy_episode e on e.id = m.episode_id
      where m.person_id = $1 order by m.id`,
    [personId],
  );
  ok("exactly one vy_shared_moment row landed from the native lane", rows.length === 1, `n=${rows.length}`);
  ok("the row's reaction is exactly what she said", rows[0]?.reaction === reaction, rows[0]?.reaction);
  ok("the row carries no invented assertion", rows[0]?.assertion_id === null, String(rows[0]?.assertion_id));
  ok("the episode is on the watch channel", rows[0]?.channel === "watch", rows[0]?.channel);
  const assertions = await q(`select count(*)::int as n from vy_visual_assertion where person_id = $1`, [personId]);
  ok("the native lane never writes a visual assertion", assertions[0]?.n === 0, `n=${assertions[0]?.n}`);

  // ── 3. the window is consumed once: her second line writes nothing ──────
  await lane.onHerLine(`${MARKER}anyway what were you saying`);
  const after2 = await q(`select count(*)::int as n from vy_shared_moment where person_id = $1`, [personId]);
  ok("her second line does not double-record the same wake", after2[0]?.n === 1, `n=${after2[0]?.n}`);

  // ── 4. a lapsed window writes nothing ───────────────────────────────────
  const t0 = Date.now();
  lane.onWake("point", t0);
  await lane.onHerLine(`${MARKER}late line`, t0 + WATCH_MOMENT_WINDOW_MS + 1);
  const after3 = await q(`select count(*)::int as n from vy_shared_moment where person_id = $1`, [personId]);
  ok("a line after the window lapses records nothing", after3[0]?.n === 1, `n=${after3[0]?.n}`);

  // ── 5. the look-away, re-checked at the write decision ──────────────────
  lane.onWake("switch", Date.now());
  lane.priv = true;
  await lane.onHerLine(`${MARKER}during look-away`);
  const after4 = await q(`select count(*)::int as n from vy_shared_moment where person_id = $1`, [personId]);
  ok("a look-away engaged after the wake still records nothing", after4[0]?.n === 1, `n=${after4[0]?.n}`);
  lane.priv = false;

  // ── 6. a wake that outlives its share dies in watch.ts, not downstream ──
  const wakesBeforeStop = seen.wakes.length; // "settle" + the ambient "idle"
  __bridge.emit("stopped", {});
  ok("the native 'stopped' event released JS ownership", watchOwned() === false);
  ok("...and ran the session's onStopped exactly once", seen.stopped === 1);
  __bridge.emit("watchwake", { class: "settle" });
  ok(
    "a wake after the share ended reaches no handler",
    seen.wakes.length === wakesBeforeStop,
    `${seen.wakes.length} vs ${wakesBeforeStop}`,
  );
  session.stop();

  // ── 7. structural: the shipping useCallEngine.ts really does pass the
  //      onWake argument and really does note native turns. A bundle proves
  //      the functions work; only the source proves they are CALLED. ───────
  const eng = readFileSync(join(ROOT, "src/components/useCallEngine.ts"), "utf8");
  const nativeStart = eng.slice(eng.indexOf("await startWatch("));
  const nativeBlock = nativeStart.slice(0, nativeStart.indexOf("\n      setWatching(true);"));
  ok("useCallEngine passes an onWake callback to startWatch", /\(cls\)\s*=>/.test(nativeBlock));
  ok("...whose body arms the shared window", /armMomentWindow\(/.test(nativeBlock));
  ok("...and re-checks the look-away and the live share first", /watchPrivate\.current/.test(nativeBlock) && /!watchSession\.current/.test(nativeBlock));
  ok('native "her" turns go through noteHerLine', /noteHerLine\(text, "native", id\)/.test(nativeBlock));
  ok(
    "noteHerLine consumes the window and posts the moment",
    /consumeMomentWindow\(pendingShowWake\.current[\s\S]{0,400}?postWatchMoment\(/.test(eng),
  );
  ok(
    'src/native/watch.ts dispatches "watchwake" to the owning session only',
    /addListener\("watchwake"[\s\S]{0,400}?handlers\?\.onWake\?\.\(cls\)/.test(
      readFileSync(join(ROOT, "src/native/watch.ts"), "utf8"),
    ),
  );
} finally {
  const counts = await teardown(personId);
  const residue = await assertZeroResidue(personId);
  console.log(`teardown: ${JSON.stringify(counts)}`);
  ok("zero residue after teardown", residue === 0, `residue=${residue}`);
}

console.log(failed ? `\nFAILED (${failed})` : "\nPASSED");
process.exit(failed ? 1 : 0);
