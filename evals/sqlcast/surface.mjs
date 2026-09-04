// The file surface this suite holds to the STRICT rule (every parameter site
// against a non-text column carries an explicit cast).
//
// Why a surface rather than the whole of api/: the strict rule is a house
// style, not a correctness law. A bare `$1` against a uuid column works on its
// own — measured against the live database. What actually breaks is the
// CONFLICT rule (see scan.mjs), and that one is enforced everywhere, with no
// exceptions, because it is a guaranteed 500.
//
// The replica/gurukul modules get the stricter rule because they are the newest
// and least-exercised surface in the repo, they are where the first live
// failure landed, and their queries are the biggest in the codebase — the
// twenty-CTE statements where a second use of a parameter is easy to add and
// impossible to eyeball. Casting every site there makes the conflict rule
// unreachable by construction rather than merely tested for.
//
// The older meera_* paths (api/memory.js, api/consolidate.js, api/account.js,
// …) are deliberately NOT on this list. They are long-running production code
// whose bare parameters are proven by traffic; converting them would be a large
// mechanical diff with no failure to point at. They remain covered by the
// conflict rule.
export const STRICT_SURFACE = [
  /^api\/_replica[^/]*\.js$/,
  /^api\/_replica-processing\//,
  /^api\/replica[^/]*\.js$/,
  /^api\/_person-model\.js$/,
  /^api\/replica-person-model\.js$/,
  /^api\/_teachersheet\.js$/,
  /^api\/_teacher-sheet-draft\.js$/,
  /^api\/teacher-sheet\.js$/,
  /^api\/_channel-ingest\.js$/,
  /^api\/_channel-watch\.js$/,
  /^api\/channel-watch\.js$/,
  /^api\/_channel\//,
  /^api\/channel-ingest-sweep\.js$/,
  /^api\/_fidelity\.js$/,
  // WS-X, the Mirror Call. On the strict list from its first commit rather
  // than after its first live 500: it is the newest surface in the repo, its
  // decide statement is a nine-CTE write against a real person's clone, and
  // `offline-mocks-cannot-type-check-sql` says a mock proves control flow and
  // not types. Nothing here has ever run against a database.
  /^api\/_mirrorcall[^/]*\.js$/,
  /^api\/mirror-call\.js$/,
  // WS-AF, the activity surface. On the strict list from its first commit, for
  // WS-X's reason and one more of its own: this is the endpoint that gets
  // POLLED, so a type error here does not 500 once, it 500s every three seconds
  // on the one screen a worried owner is staring at.
  //
  // `api/_replica-activity.js` already matches `^api\/_replica[^/]*\.js$`
  // above; `api/replica-activity.js` already matches `^api\/replica[^/]*\.js$`.
  // Both are listed anyway, because the day one of those patterns is narrowed
  // the coverage should be lost visibly rather than silently
  // (`coverage-lists-that-enumerate-a-subset`).
  /^api\/_replica-activity\.js$/,
  /^api\/replica-activity\.js$/,
  // WS-R4, the review queue. On the strict list from its first commit, on WS-X
  // and WS-AF's reasoning: its decide statement is a twelve-CTE write that
  // moves a person's own claims and retires their derived model, its generate
  // statement fans a jsonb array into a bulk insert, and nothing in it has ever
  // run against a database. `api/_review-queue.js` and `api/review-queue.js`
  // match none of the patterns above, so both are listed by name.
  /^api\/_review-queue\.js$/,
  /^api\/_review-queue\//,
  /^api\/review-queue\.js$/,
  // The never-rule predicate has no SQL at all and imports nothing. Listed so
  // that if it ever grows a statement it is covered from that day rather than
  // from the day it 500s (`coverage-lists-that-enumerate-a-subset`).
  /^api\/_never-rules\.js$/,
  // WS-R3, readiness and the publish lock. On the strict list from its first
  // commit for the same reason, plus one that is specific to it: the lock this
  // module computes is joined against inside the runtime activation statement,
  // so a parameter whose type Postgres cannot deduce here does not fail a
  // screen, it fails the gate that decides whether a clone may talk to anyone.
  /^api\/_readiness\.js$/,
  /^api\/readiness\.js$/,
  // WS-R1, the Room. On the strict list from its first commit for WS-X's
  // reason, and one of its own: this surface's conditional UPDATE is what
  // enforces the free cap, and a type error in it does not fail loudly, it
  // fails as zero rows updated, which this lane reads as "the cap is spent".
  // A parameter whose type Postgres could not deduce would present to every
  // free follower as a Room that refuses their first message.
  /^api\/_room-surface\.js$/,
  /^api\/room\.js$/,
  // WS-R7, the Room's creator side. On the strict list from its first commit
  // for the same reason as the follower side above, plus one of its own:
  // `publishRoom`'s write is the ONLY place `vy_room.published_at` is ever
  // set, so a parameter Postgres cannot type here does not fail a screen, it
  // fails silently closed forever — the Room simply never opens, with no
  // error a creator would ever see twice.
  /^api\/_room-publish\.js$/,
  /^api\/room-publish\.js$/,
  // WS-R9, drift watch. On the strict list from its first commit, on WS-R3's
  // exact reasoning: the sweep's write is a guarded insert that runs
  // unattended every six hours against every active replica with nobody
  // watching, and the read is the number a creator's "still sounds like you"
  // card is built from. A parameter Postgres could not type here fails
  // silently for months rather than loudly on the first request.
  /^api\/_drift-watch\.js$/,
  /^api\/drift-watch\.js$/,
  /^api\/drift-watch-sweep\.js$/,
  // WS-R12, week-six retention - the number that decides the company. On the
  // strict list from its first commit, on WS-R3/WS-R9's exact reasoning: this
  // is the one screen that answers the Rooms plan's Phase 0/Phase 2 gates, so
  // a parameter Postgres could not type here does not fail a screen, it fails
  // the only measurement that says whether the product works, silently.
  /^api\/_room-cohorts\.js$/,
  /^api\/room-cohorts\.js$/,
  // WS-R11, the Room's money. On the strict list from its first commit, on
  // WS-R7's exact reasoning plus one of its own: the webhook write is a
  // three-CTE statement that flips a real person's billing tier from money a
  // provider says actually moved, unattended, with nobody watching the
  // response. A parameter Postgres could not type here does not fail a
  // screen, it either drops a real payment on the floor or charges the wrong
  // room's split.
  /^api\/_payments\.js$/,
  /^api\/_payments\//,
  /^api\/payments\.js$/,
  /^api\/room-pay\.js$/,
  /^api\/payments-webhook\.js$/,
  // WS-R18, the Room on Telegram. `api/_room-telegram.js` issues no SQL of
  // its own (every read and write goes through the already-strict
  // `api/_room-surface.js`), and `api/room-tg.js` is a thin handler with
  // none either — both listed anyway, from their first commit, on
  // `_never-rules.js`'s own precedent: covered from the day either one
  // grows a statement rather than from the day it 500s.
  /^api\/_room-telegram\.js$/,
  /^api\/room-tg\.js$/,
];

export function isStrict(rel) {
  const p = rel.split("\\").join("/");
  return STRICT_SURFACE.some((re) => re.test(p));
}
