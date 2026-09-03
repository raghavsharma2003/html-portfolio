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
];

export function isStrict(rel) {
  const p = rel.split("\\").join("/");
  return STRICT_SURFACE.some((re) => re.test(p));
}
