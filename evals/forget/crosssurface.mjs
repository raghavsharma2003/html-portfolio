// ── The forget path reaches the PERSON, not the surface ────────────────────
//
// `api/_surface.js` §4 states the law: "memory is never keyed by surface.
// Anything that keys memory by surface reintroduces the amnesia the relational
// layer exists to delete." WS-O measured the READ half of the violation — 89.2%
// of recall lost when a person moved from one surface to another — and closed
// it with an additive leg. It deliberately did NOT touch the FORGET half, and
// said so in writing: `legacy-forget-is-device-scoped`. A whole wipe asked for
// on the web deleted the web rows and left the same human's Telegram graph
// standing, with a receipt saying it had all gone.
//
// This file is that half's gate. Two arms, and they check different things:
//
//   OFFLINE (default, and the one wired into `evals/run.mjs`) — STRUCTURAL.
//   It reads `api/memory.js` and asserts that every legacy-lane `device_id`
//   predicate reachable from opForget is written over an id ARRAY, and that
//   opForget resolves the set exactly once. A structural check is the right
//   shape here for the reason `offline-mocks-cannot-type-check-sql` gives from
//   the other direction: a mock cannot prove these deletes are correct, but it
//   CAN prove nobody quietly re-narrowed one back to `= $1`, which is the
//   regression this is actually guarding against.
//
//   LIVE (`--live`, needs a reachable database) — FUNCTIONAL. It binds two
//   devices to one synthetic person, seeds rows under BOTH, wipes through the
//   real `opForget`, and asserts both are empty. It carries two negative
//   controls, and the controls are the point: a second person's rows must
//   SURVIVE, and a group room's synthetic device must SURVIVE. A widening that
//   deletes too much is a worse defect than the one being fixed, and a test
//   that only checks "the rows went" cannot tell the two apart.
//
// The live arm cleans up everything it creates, including on the failure path.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const LIVE = process.argv.includes("--live");

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok    ${name}`);
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// ── arm 1: structural ──────────────────────────────────────────────────────

const src = await readFile(path.join(ROOT, "api", "memory.js"), "utf8");

// The functions the forget path owns. Every one of them keys on device_id and
// every one of them is called ONLY from opForget (which is what makes widening
// their signatures safe, and what this list is really asserting).
const FORGET_FNS = [
  "opForget",
  "forgetCandidates",
  "dropEdgesFor",
  "noteForgotten",
  "purgeTelemetry",
  "purgeSyncedState",
  "purgeEvents",
  "purgeTurnTrace",
  "purgeRelational",
  "deletePhotos",
  "deletePhotoObjects",
];

/** The body of a top-level `function name(` / `async function name(` block,
 *  by brace balance. Crude on purpose: it has no dependency to go stale. */
function bodyOf(name) {
  const m = new RegExp(`^(?:export )?(?:async )?function ${name}\\(`, "m").exec(src);
  if (!m) return null;
  let i = src.indexOf("{", m.index);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

for (const fn of FORGET_FNS) {
  const body = bodyOf(fn);
  ok(`${fn}() found`, !!body);
  if (!body) continue;
  // `device_id = $n` — the narrow shape. `any($n::uuid[])` and `= any($n)` are
  // the widened ones. noteForgotten is the deliberate exception: it INSERTS a
  // suppression row per device inside an explicit loop, so its statements are
  // single-device by construction and its widening is the loop, checked below.
  const narrow = [...body.matchAll(/device_id\s*=\s*\$\d+/g)].map((x) => x[0]);
  if (fn === "noteForgotten") {
    ok(
      "noteForgotten() widens by looping the device set",
      /for \(const device of devices\)/.test(body),
      "the suppression list must be written on every surface or the term is re-derived on the others",
    );
  } else {
    ok(
      `${fn}() has no surface-scoped device predicate`,
      narrow.length === 0,
      narrow.length ? `${narrow.length} narrow predicate(s): ${narrow.join(", ")}` : "",
    );
  }
}

const forget = bodyOf("opForget") || "";
ok(
  "opForget() resolves the device set exactly once",
  (forget.match(/await personDeviceSet\(/g) || []).length === 1,
  "a set re-read between two statements can tear, and a torn forget is unrecoverable",
);
ok(
  "opForget() passes the set, never the single device, to its helpers",
  !/\b(purgeTelemetry|purgeEvents|purgeTurnTrace|purgeSyncedState|purgeRelational|dropEdgesFor|forgetCandidates|noteForgotten|deletePhotos|deletePhotoObjects)\(device[,)]/.test(
    forget,
  ),
);
ok(
  "personDeviceSet() fails closed to the asking device",
  /\.catch\(\(\) => \[\]\)/.test(bodyOf("personDeviceSet") || ""),
  "a mapping read that throws must narrow the delete, never widen it on an unverified result",
);
ok(
  "personDeviceSet() is built from vy_person_device (so a room device cannot be in it)",
  /from vy_person_device/.test(bodyOf("personDeviceSet") || ""),
);
ok(
  "personDeviceSet() caps the id list",
  /limit 64/.test(bodyOf("personDeviceSet") || ""),
);
// The generator shared with export.js must stay narrow by DEFAULT — a forget
// opting in is one thing, a DSAR export silently widening is another.
ok(
  "wipeWhereSql() is surface-scoped unless a caller opts in",
  /deviceSet = false/.test(bodyOf("wipeWhereSql") || ""),
);

// ── arm 2: live ────────────────────────────────────────────────────────────

if (!LIVE) {
  console.log(
    "\n  (live arm skipped — pass --live with a reachable database to run the " +
      "seed/wipe/negative-control battery)",
  );
} else {
  const { q } = await import(path.join(ROOT, "api", "_db.js"));
  const memory = await import(path.join(ROOT, "api", "memory.js"));
  const handler = memory.default;

  const uuid = () => crypto.randomUUID();
  const P1 = uuid();
  const P2 = uuid();
  const WEB = uuid(); // person 1, surface A — the device that asks
  const TG = uuid(); // person 1, surface B — the one that used to survive
  const OTHER = uuid(); // person 2 — must survive
  const ROOM = uuid(); // a group room's synthetic device — must survive
  const made = [WEB, TG, OTHER, ROOM];

  // Seeded under Meera's agent id: the legacy lane carries agent scope on
  // every statement, so a row written without it is not a row the forget path
  // would ever see and the test would prove nothing.
  const { MEERA_AGENT_ID } = await import(path.join(ROOT, "api", "_agentscope.js"));
  const seed = async (d) => {
    await q(
      `insert into meera_log (device_id, role, channel, kind, content, agent_id)
       values ($1,'user','chat','text',$2,$3::uuid)`,
      [d, "crosssurface probe row", MEERA_AGENT_ID],
    );
    await q(
      `insert into meera_nodes (device_id, kind, name, summary, agent_id)
       values ($1,'thing',$2,$3,$4::uuid)`,
      [d, `probe-${d.slice(0, 8)}`, "crosssurface probe node", MEERA_AGENT_ID],
    );
  };
  const rows = async (d) => {
    const [l, n] = await Promise.all([
      q(`select count(*)::int c from meera_log where device_id = $1`, [d]),
      q(`select count(*)::int c from meera_nodes where device_id = $1`, [d]),
    ]);
    return (l[0]?.c || 0) + (n[0]?.c || 0);
  };
  const cleanup = async () => {
    for (const d of made) {
      await q(`delete from meera_log where device_id = $1`, [d]).catch(() => {});
      await q(`delete from meera_nodes where device_id = $1`, [d]).catch(() => {});
      await q(`delete from meera_edges where device_id = $1`, [d]).catch(() => {});
      await q(`delete from meera_forget where device_id = $1`, [d]).catch(() => {});
      await q(`delete from vy_person_device where device_id = $1`, [d]).catch(() => {});
    }
    for (const p of [P1, P2]) await q(`delete from vy_person where person_id = $1`, [p]).catch(() => {});
  };

  try {
    await q(`insert into vy_person (person_id) values ($1) on conflict do nothing`, [P1]);
    await q(`insert into vy_person (person_id) values ($1) on conflict do nothing`, [P2]);
    await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [WEB, P1]);
    await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [TG, P1]);
    await q(`insert into vy_person_device (device_id, person_id) values ($1,$2)`, [OTHER, P2]);
    // ROOM is deliberately NOT mapped — that is exactly what a room device is.
    for (const d of made) await seed(d);

    const before = Object.fromEntries(await Promise.all(made.map(async (d) => [d, await rows(d)])));
    ok("live: every probe device seeded", Object.values(before).every((n) => n === 2), JSON.stringify(before));

    const set = await memory.personDeviceSet(WEB);
    ok("live: personDeviceSet(WEB) reaches both of the person's surfaces", set.includes(WEB) && set.includes(TG), set.join(","));
    ok("live: personDeviceSet(WEB) does not reach another person", !set.includes(OTHER));
    ok("live: personDeviceSet(WEB) does not reach a room device", !set.includes(ROOM));
    ok("live: an unmapped device resolves to itself alone", (await memory.personDeviceSet(ROOM)).join(",") === ROOM);

    // The real endpoint, the real op, the real cascade.
    let body = null;
    const res = {
      setHeader() {},
      status() {
        return this;
      },
      json(v) {
        body = v;
        return this;
      },
      end() {
        return this;
      },
    };
    await handler(
      { method: "POST", headers: {}, socket: {}, body: { op: "forget", scope: "all", device: WEB } },
      res,
    );
    ok("live: the wipe returned a receipt", body?.ok === true && body?.receipt === "done", JSON.stringify(body));

    const after = Object.fromEntries(await Promise.all(made.map(async (d) => [d, await rows(d)])));
    ok("live: the asking surface is empty", after[WEB] === 0, `${after[WEB]} row(s) left`);
    ok(
      "live: THE OTHER SURFACE IS EMPTY — this is the defect being closed",
      after[TG] === 0,
      `${after[TG]} row(s) left on the second surface`,
    );
    ok("live: another person's rows survive", after[OTHER] === 2, `${after[OTHER]} row(s) left, expected 2`);
    ok("live: a group room's rows survive", after[ROOM] === 2, `${after[ROOM]} row(s) left, expected 2`);
    ok(
      "live: the person's identity mapping is gone from both surfaces",
      (await q(`select count(*)::int c from vy_person_device where person_id = $1`, [P1]))[0]?.c === 0,
    );
  } finally {
    await cleanup();
  }
}

console.log(`\n${pass} check(s) passed, ${fails.length} failed.`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
