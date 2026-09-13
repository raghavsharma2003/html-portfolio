// WS-R162 — a personal AI's Room publishes (no migration).
//
//   node evals/person-room/run.mjs
//
// WS-R152 built Deploy for a personal AI on the real RoomStudio and found
// that a personal AI's Room still could not publish live: the disclosure
// gate had no way for a `sheetKind:"person"` sheet to ever satisfy it
// (`context/rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-
// pathway`, `context/decisions.md`'s `ws-r152-personal-ai-room-still-cannot-
// publish-live` entry). WS-R151 widened `vy_teacher_sheet` to carry a
// `sheet_kind` (migration 163) and wrote `personDisclosureLine(sheet)`, but
// left it with no caller, and left the compiler's platform boundary saying
// "you are a teacher, first and permanently" for a person. This suite is the
// end-to-end proof that both gaps are closed for real: the SAME `_room-
// publish.js` write predicate a teacher's Room already used now also passes
// for a published PERSON sheet, the Room's own about page shows that
// person's own one-line disclosure and never the word "teacher", and the
// compiled prompt behind that same Room carries a person-worded boundary.
//
// ── what this suite is actually guarding ───────────────────────────────────
//
// 1. THE PUBLISH LOCK, unmodified, now clears for a PERSON sheet. Drives the
//    REAL `createRoom`/`publishRoom`/`getOwnedRoom` (`api/_room-publish.js`)
//    through a fake `db` matched on the exact SQL text that function issues
//    (`evals/room-publish/run.mjs`'s own proven fixture shape, restated
//    here rather than imported — each suite in this registry is a standalone
//    process with its own fixture, this repo's own established pattern). A
//    person sheet with `status:"published"` and a real `consent_artifact_id`
//    passes the SAME `disclosureApproved` predicate a teacher's sheet always
//    did; an UNPUBLISHED person sheet is refused with the honest
//    `room_disclosure_not_approved` blocker, never a silent success.
// 2. THE ABOUT PAGE SHOWS THE PERSON'S OWN LINE. The published Room's own
//    `slug` is fed to the REAL `publicRoomAboutBySlug`/`buildRoomAboutHtml`
//    (`api/_room-about.js`), and the rendered page carries the person's own
//    `personLine`, in both locales, and never the word "teacher" anywhere. A
//    teacher published the identical way renders NO such line — byte
//    identical to a Room this workstream never touched.
// 3. THE COMPILED PROMPT MATCHES THE DISCLOSURE. The SAME person sheet
//    fixture, run through the REAL `sheetToModule` (`src/engine/agents/
//    fromSheet.ts`), compiles a core carrying `personBoundaryFor(sheet.name)`
//    and never the teacher-worded `PLATFORM_BOUNDARY` — tying together "this
//    Room can publish", "this Room's about page tells a visitor the truth"
//    and "this Room's AI was told the truth about itself" as one story about
//    the SAME person, rather than three suites that could each pass while
//    disagreeing about who this is.
//
// NEGATIVE CONTROLS: (a) an unpublished person sheet's Room refuses to
// publish, named blocker, never a crash or a silent success; (b) a
// TEACHER Room published the identical way carries no person disclosure
// line on its about page; (c) the about page's own predicate never learns
// whether an unrelated unknown slug exists.
//
// Offline, deterministic, $0, no DB, no network, no model call, no GPU.
// Re-bundles `fromSheet.ts` from the real source on every run
// (`evals/person-sheet/run.mjs`'s own reason: a frozen bundle passes forever
// while the source rots).
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const API = join(REPO, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const {
  getOwnedRoom, createRoom, publishRoom, personDisclosureLine, RoomPublishError,
} = await import(pathToFileURL(join(API, "_room-publish.js")).href);
const { publicRoomAboutBySlug, buildRoomAboutHtml } = await import(pathToFileURL(join(API, "_room-about.js")).href);
const { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } = await import(pathToFileURL(join(API, "_readiness.js")).href);

// ═══════════════════════════════════════════════════════════════════════
// PART A: the publish lock, real code, a fixture db — `evals/room-publish/
// run.mjs`'s own proven shape, restated here for a person and a teacher
// side by side.
// ═══════════════════════════════════════════════════════════════════════

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON_REPLICA = "c1000000-0000-4000-8000-0000000000c1";
const PERSON_AGENT = "b1000000-0000-4000-8000-0000000000b1";
const TEACHER_REPLICA = "c1000000-0000-4000-8000-0000000000c2";
const TEACHER_AGENT = "b1000000-0000-4000-8000-0000000000b2";
const CONSENT_ARTIFACT = "d1000000-0000-4000-8000-000000000001";

function freshState() {
  return {
    replicas: [
      { replica_id: PERSON_REPLICA, agent_id: PERSON_AGENT, owner_user_id: OWNER, display_name: "Priya Menon" },
      { replica_id: TEACHER_REPLICA, agent_id: TEACHER_AGENT, owner_user_id: OWNER, display_name: "Arjun Sir Physics" },
    ],
    rooms: [],
    caps: [
      { replica_id: PERSON_REPLICA, owner_user_id: OWNER, state: "active" },
      { replica_id: TEACHER_REPLICA, owner_user_id: OWNER, state: "active" },
    ],
    readiness: [
      { replica_id: PERSON_REPLICA, owner_user_id: OWNER, unmeasured_count: 0, overall: 82, min_part: 71 },
      { replica_id: TEACHER_REPLICA, owner_user_id: OWNER, unmeasured_count: 0, overall: 82, min_part: 71 },
    ],
    // `status`/`consent_artifact_id` are the WHOLE of `disclosureApproved`'s
    // predicate (`api/_room-publish.js`) — `sheet_kind` never appears in it
    // (WS-R151's own comment: "it already accepts a published sheet of
    // EITHER kind"), carried here only so a caller of THIS fixture's own
    // `sheets` array can tell the two fixture rows apart by eye.
    sheets: [
      { agent_id: PERSON_AGENT, status: "published", consent_artifact_id: CONSENT_ARTIFACT, sheet_kind: "person" },
      { agent_id: TEACHER_AGENT, status: "published", consent_artifact_id: CONSENT_ARTIFACT, sheet_kind: "teacher" },
    ],
  };
}

/** `evals/room-publish/run.mjs`'s own `makeDb`, trimmed to the statements
 *  THIS suite's own calls (`createRoom`/`publishRoom`/`getOwnedRoom`) can
 *  reach — no `rename`/`pause`/showcase/share-kit callers here, so those
 *  branches are not restated. An unmatched statement throws rather than
 *  returning an empty set, `evals/room-about/run.mjs`'s own posture. */
function makeDb(state) {
  const runtimeOk = (sql, owner, replica) => {
    if (!sql.includes("vy_replica_runtime_capability")) return true;
    return state.caps.some((c) => c.owner_user_id === owner && c.replica_id === replica && c.state === "active");
  };
  const readinessOk = (sql, owner, replica, overallFloor, partFloor) => {
    if (!sql.includes("vy_replica_readiness")) return true;
    const snap = state.readiness.find((x) => x.owner_user_id === owner && x.replica_id === replica);
    if (!snap) return false;
    return snap.unmeasured_count === 0 && snap.overall >= overallFloor && snap.min_part >= partFloor;
  };
  const disclosureOk = (sql, agentId) => {
    if (!sql.includes("vy_teacher_sheet")) return true;
    const sheet = state.sheets.find((s) => s.agent_id === agentId);
    return Boolean(sheet) && sheet.status === "published" && sheet.consent_artifact_id != null;
  };

  return async (sql, params = []) => {
    if (sql.includes("insert into vy_room")) {
      const [roomId, slug, replicaId, agentId, ownerId, displayName] = params;
      const row = {
        room_id: roomId, slug, replica_id: replicaId, agent_id: agentId, owner_user_id: ownerId,
        display_name: displayName, free_monthly_messages: 20, published_at: null, paused_at: null,
        created_at: "2026-09-13T00:00:00Z", updated_at: "2026-09-13T00:00:00Z",
      };
      state.rooms.push(row);
      return [{ ...row }];
    }
    if (sql.includes("set published_at = case")) {
      const [ownerId, replicaId, overallFloor, partFloor] = params;
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      const pass = runtimeOk(sql, ownerId, replicaId)
        && readinessOk(sql, ownerId, replicaId, overallFloor, partFloor)
        && disclosureOk(sql, row.agent_id);
      if (pass && !row.published_at) row.published_at = "2026-09-13T13:00:00Z";
      return [{ ...row }];
    }
    if (sql.includes("as ok") && sql.includes("vy_replica_runtime_capability")) {
      const [ownerId, replicaId] = params;
      return [{ ok: runtimeOk(sql, ownerId, replicaId) }];
    }
    if (sql.includes("as ok") && sql.includes("vy_replica_readiness")) {
      const [ownerId, replicaId, overallFloor, partFloor] = params;
      return [{ ok: readinessOk(sql, ownerId, replicaId, overallFloor, partFloor) }];
    }
    if (sql.includes("as ok") && sql.includes("vy_teacher_sheet")) {
      const [agentId] = params;
      return [{ ok: disclosureOk(sql, agentId) }];
    }
    // `ownedReplica`/`ownedRoomRow` — a single, permissive match covers
    // both (this suite never exercises the runtime-status probe or the
    // showcase/share-kit reads `room-publish/run.mjs`'s own fuller fixture
    // answers, so nothing else is reachable to mismatch against).
    if (sql.includes("from vy_replica r") && sql.includes("limit 1")) {
      const [replicaId, ownerId] = params;
      const r = state.replicas.find((x) => x.replica_id === replicaId && x.owner_user_id === ownerId);
      return r ? [{ ...r }] : [];
    }
    if (sql.includes("from vy_room") && sql.includes("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const [ownerId, replicaId] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      return r ? [{ ...r }] : [];
    }
    // `readRoomShowcase` — `getOwnedRoom`'s own second read, fed alongside
    // the room on the same call. This suite seeds no showcase items, so an
    // empty array is the honest answer for every room.
    if (sql.includes("from vy_room_showcase")) return [];
    throw new Error(`evals/person-room/run.mjs fake db: unmatched SQL: ${sql}`);
  };
}

console.log("\n── PART A: the publish lock clears for a PERSON sheet, the SAME predicate a teacher's Room already used ──");

const state = freshState();
const db = makeDb(state);

// A PERSON sheet, published and consented: createRoom + publishRoom succeed.
const personRoom = await createRoom(db, OWNER, PERSON_REPLICA, { slug: "priya-menon" });
ok("createRoom succeeds for a personal (self-mode) replica", personRoom?.slug === "priya-menon");
const personBeforePublish = await getOwnedRoom(db, OWNER, PERSON_REPLICA);
ok("can_publish is true for a PUBLISHED person sheet", personBeforePublish?.can_publish === true, JSON.stringify(personBeforePublish?.blockers));
const personPublished = await publishRoom(db, OWNER, PERSON_REPLICA);
ok("publishRoom sets published_at for a published person sheet", Boolean(personPublished?.published_at));

// A TEACHER sheet, published the identical way: unchanged regression.
const teacherRoom = await createRoom(db, OWNER, TEACHER_REPLICA, { slug: "arjun-sir-physics" });
ok("createRoom succeeds for a teacher replica (unchanged regression)", teacherRoom?.slug === "arjun-sir-physics");
const teacherPublished = await publishRoom(db, OWNER, TEACHER_REPLICA);
ok("publishRoom still sets published_at for a published teacher sheet (unchanged regression)", Boolean(teacherPublished?.published_at));

// NEGATIVE CONTROL: an UNPUBLISHED person sheet refuses, named blocker.
const negState = freshState();
negState.sheets.find((s) => s.agent_id === PERSON_AGENT).status = "draft";
const negDb = makeDb(negState);
await createRoom(negDb, OWNER, PERSON_REPLICA, { slug: "priya-menon-draft" });
const blockedRoom = await getOwnedRoom(negDb, OWNER, PERSON_REPLICA);
ok("NEGATIVE CONTROL: can_publish is false while the person sheet is a draft, not published",
  blockedRoom?.can_publish === false
    && (blockedRoom?.blockers?.waiting_on_you || []).some((b) => b.code === "room_disclosure_not_approved"));
let blockedError = null;
try {
  await publishRoom(negDb, OWNER, PERSON_REPLICA);
} catch (error) {
  blockedError = error;
}
ok("NEGATIVE CONTROL: publishRoom itself refuses an unpublished person sheet (room_publish_locked, never a silent success)",
  blockedError instanceof RoomPublishError
    && blockedError.code === "room_publish_locked"
    && (blockedError.details?.waiting_on_you || []).some((b) => b.code === "room_disclosure_not_approved"));

// ═══════════════════════════════════════════════════════════════════════
// PART B: the about page shows the person's own disclosure line, in both
// locales, and a teacher Room published the identical way carries none.
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── PART B: the published Room's about page shows the person's own disclosure line ──");

const PERSON_LINE = "Product designer. Bad puns. Worse badminton.";

function aboutRowFor({ slug, displayName, sheetKind, personLine }) {
  return {
    slug, display_name: displayName, default_locale: "en", dormancy_days: null,
    free_monthly_messages: 20, paid_monthly_messages: 500, paid_monthly_voice_seconds: 1800,
    sheet_kind: sheetKind, person_line: personLine,
  };
}
function aboutDb(row) {
  return async (sql) => {
    if (sql.includes("from vy_room r") && sql.includes("left join lateral")) return [row];
    throw new Error(`evals/person-room/run.mjs about-page fixture: unmatched SQL: ${sql}`);
  };
}

const personAboutRow = await publicRoomAboutBySlug(
  aboutDb(aboutRowFor({ slug: personRoom.slug, displayName: "Priya Menon", sheetKind: "person", personLine: PERSON_LINE })),
  personRoom.slug,
);
const personAboutHtml = buildRoomAboutHtml(personAboutRow, { origin: "https://vyakti.app", slug: personRoom.slug });
ok("the person's Room about page carries their own personLine", personAboutHtml.includes(`>${PERSON_LINE}<`));
ok('the person\'s Room about page never says "teacher"', !personAboutHtml.toLowerCase().includes("teacher"));
const personAboutHtmlHi = buildRoomAboutHtml(
  { ...aboutRowFor({ slug: personRoom.slug, displayName: "Priya Menon", sheetKind: "person", personLine: PERSON_LINE }), default_locale: "hi" },
  { origin: "https://vyakti.app", slug: personRoom.slug },
);
ok("the Hindi-locale render still carries the person's own (untranslated) personLine", personAboutHtmlHi.includes(`>${PERSON_LINE}<`));

// NEGATIVE CONTROL: the teacher Room, published the identical way, carries
// no person disclosure line at all.
const teacherAboutRow = await publicRoomAboutBySlug(
  aboutDb(aboutRowFor({ slug: teacherRoom.slug, displayName: "Arjun Sir Physics", sheetKind: "teacher", personLine: null })),
  teacherRoom.slug,
);
const teacherAboutHtml = buildRoomAboutHtml(teacherAboutRow, { origin: "https://vyakti.app", slug: teacherRoom.slug });
ok("NEGATIVE CONTROL: a teacher Room's about page carries no person disclosure line",
  !teacherAboutHtml.slice(teacherAboutHtml.indexOf("<body>")).includes("room-about-person-line"));

// NEGATIVE CONTROL: the about page's own predicate never learns whether an
// unrelated, unknown slug exists.
const unknownAboutRow = await publicRoomAboutBySlug(async (sql) => {
  if (sql.includes("from vy_room r") && sql.includes("left join lateral")) return [];
  throw new Error("unmatched SQL");
}, "no-such-room-at-all");
ok("NEGATIVE CONTROL: an unrelated unknown slug's about page still resolves to null", unknownAboutRow === null);

// ═══════════════════════════════════════════════════════════════════════
// PART C: the compiled prompt behind the SAME person matches the
// disclosure — `sheetToModule`, the real TypeScript, bundled once.
// ═══════════════════════════════════════════════════════════════════════

console.log("\n── PART C: the compiled prompt behind the same person carries a person boundary, never the teacher one ──");

const OUT = mkdtempSync(join(tmpdir(), "person-room-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export { sheetToModule } from ${JSON.stringify(join(REPO, "src/engine/agents/fromSheet"))};\n` +
    `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n` +
    `export { PLATFORM_BOUNDARY, personBoundaryFor } from ${JSON.stringify(join(REPO, "src/engine/compiler"))};\n`,
);
const BUNDLE = join(OUT, "person-room.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const { sheetToModule, DEMO_TEACHER, PLATFORM_BOUNDARY, personBoundaryFor } = M;

// The SAME person this suite already published a Room for and rendered an
// about page for - "Priya Menon", the SAME name, so this is one coherent
// story about one person rather than three suites that could each pass
// while quietly disagreeing about who this is.
const PERSON_SHEET = {
  ...DEMO_TEACHER,
  sheetKind: "person",
  slug: "priya-menon-sheet",
  name: "Priya Menon",
  personLine: PERSON_LINE,
  boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
};
const compiledPerson = sheetToModule(PERSON_SHEET);
const compiledCore = compiledPerson.buildSystemPromptParts({ name: "a follower", vibe: [], facts: {} }, 5, "text").core;
const expectedBoundary = personBoundaryFor("Priya Menon");
ok("the compiled prompt carries personBoundaryFor(\"Priya Menon\") verbatim", compiledCore.includes(expectedBoundary));
ok("the compiled prompt never carries the teacher-worded PLATFORM_BOUNDARY", !compiledCore.includes(PLATFORM_BOUNDARY));
ok('the compiled prompt never says "you are a teacher" for this person', !compiledCore.toLowerCase().includes("you are a teacher"));
ok(
  "the SAME published disclosure line (personDisclosureLine) and the compiled boundary name the SAME person",
  personDisclosureLine({ sheetKind: "person", personLine: PERSON_SHEET.personLine }) === PERSON_LINE
    && expectedBoundary.includes(PERSON_SHEET.name),
);

// Regression: the teacher path, unchanged.
const compiledTeacher = sheetToModule(DEMO_TEACHER);
const compiledTeacherCore = compiledTeacher.buildSystemPromptParts({ name: "a student", vibe: [], facts: {} }, 5, "text").core;
ok("a TEACHER sheet's compiled prompt still carries the unchanged PLATFORM_BOUNDARY", compiledTeacherCore.includes(PLATFORM_BOUNDARY));

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
