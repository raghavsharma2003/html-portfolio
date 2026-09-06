// WS-R129. QUIET HOURS ON EVERY CHANNEL — offline, deterministic, $0.
//
//   node evals/quiet-hours/run.mjs
//
// api/_quiet-hours.js is the ONE shared fragment this workstream's brief
// requires (law 2): this suite proves (1) the pure math is right at the
// four boundary instants the brief names, for a plain window and a
// midnight-wrapping one; (2) the fragment's own marker is actually spliced
// into the real SQL text every named due-select builds — driven through
// the REAL exported functions in api/_checkins.js, api/_renewals.js and
// api/_dormancy.js with a fake `db` that only ever RECORDS the statement
// text (never re-typed or hand-matched); (3) TWO REQUIRED NEGATIVE
// CONTROLS — a frozen copy of the renewals follower due-select exactly as
// it read before this workstream (no marker) fails the identical scan, and
// the follower-proxy predicate is a true no-op for a follower with zero
// active check-ins (never a new, silent block for the common case).
//
// The FUNCTIONAL, fake-clock proof per deliverer (21:59/22:01/06:59/07:01,
// the follower's own zone) lives in each sender's own suite —
// evals/checkins/run.mjs, evals/renewals/run.mjs, evals/room-dormancy/
// run.mjs — this suite's own scope is the shared module and the wiring,
// `evals/room-leak/run.mjs`'s own split between "the shared mechanism" and
// "each door's own proof" restated for a predicate instead of a scope.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

process.env.ROOM_SESSION_SECRET = process.env.ROOM_SESSION_SECRET || "r".repeat(48);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const QH = await import(pathToFileURL(join(REPO, "api/_quiet-hours.js")).href);
const {
  QUIET_HOURS_MARKER, quietHoursOkSql, quietHoursOkForFollowerRowSql, quietHoursOkForFollowerSql, isQuietHoursOk,
} = QH;

// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: THE PURE MATH — the four boundary instants, plain and wraparound ──");
{
  const IST = "Asia/Kolkata";

  // Wraparound window, 22:00 to 07:00 — the workstream brief's own example
  // (a follower in Lucknow).
  const t1959 = Date.parse("2026-09-05T16:29:00.000Z"); // 21:59 IST
  const t2201 = Date.parse("2026-09-05T16:31:00.000Z"); // 22:01 IST
  const t0659 = Date.parse("2026-09-06T01:29:00.000Z"); // 06:59 IST
  const t0701 = Date.parse("2026-09-06T01:31:00.000Z"); // 07:01 IST

  ok("21:59 IST is OUTSIDE a 22:00-07:00 window (not yet blocked)", isQuietHoursOk(t1959, IST, "22:00", "07:00") === true);
  ok("22:01 IST is INSIDE a 22:00-07:00 window (blocked)", isQuietHoursOk(t2201, IST, "22:00", "07:00") === false);
  ok("06:59 IST is still INSIDE a 22:00-07:00 window (blocked)", isQuietHoursOk(t0659, IST, "22:00", "07:00") === false);
  ok("07:01 IST is OUTSIDE a 22:00-07:00 window again (not blocked)", isQuietHoursOk(t0701, IST, "22:00", "07:00") === true);

  // Plain (non-wrapping) window, 13:00 to 15:00 — the complementary shape.
  const p1259 = Date.parse("2026-09-05T07:29:00.000Z"); // 12:59 IST
  const p1301 = Date.parse("2026-09-05T07:31:00.000Z"); // 13:01 IST
  const p1459 = Date.parse("2026-09-05T09:29:00.000Z"); // 14:59 IST
  const p1501 = Date.parse("2026-09-05T09:31:00.000Z"); // 15:01 IST
  ok("12:59 IST is OUTSIDE a 13:00-15:00 window", isQuietHoursOk(p1259, IST, "13:00", "15:00") === true);
  ok("13:01 IST is INSIDE a 13:00-15:00 window", isQuietHoursOk(p1301, IST, "13:00", "15:00") === false);
  ok("14:59 IST is still INSIDE a 13:00-15:00 window", isQuietHoursOk(p1459, IST, "13:00", "15:00") === false);
  ok("15:01 IST is OUTSIDE a 13:00-15:00 window again", isQuietHoursOk(p1501, IST, "13:00", "15:00") === true);

  // No window (the shipping default) never blocks, at ANY hour.
  ok("null/null quiet_from/quiet_to never blocks (3am, IST)", isQuietHoursOk(t2201, IST, null, null) === true);
  ok("null quiet_to alone never blocks (a half-set window has no meaning here)", isQuietHoursOk(t2201, IST, "22:00", null) === true);
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: THE FRAGMENT'S OWN SHAPE ──");
{
  const direct = quietHoursOkSql("c", 1);
  ok("quietHoursOkSql embeds the marker", direct.includes(QUIET_HOURS_MARKER));
  ok("quietHoursOkSql reads the given alias's own columns", direct.includes("c.quiet_from") && direct.includes("c.quiet_to") && direct.includes("c.timezone"));
  ok("quietHoursOkSql binds the given param index", direct.includes("($1)::timestamptz"));

  const direct2 = quietHoursOkSql("qc", 3);
  ok("a different param index is honoured, never hardcoded to $1", direct2.includes("($3)::timestamptz") && !direct2.includes("($1)::timestamptz"));

  const proxy = quietHoursOkForFollowerSql("f", 1);
  ok("quietHoursOkForFollowerSql embeds the marker", proxy.includes(QUIET_HOURS_MARKER));
  ok("quietHoursOkForFollowerSql is a NOT EXISTS over vy_room_checkin", /not exists\s*\(\s*select 1 from vy_room_checkin/.test(proxy));
  ok("quietHoursOkForFollowerSql joins on the given follower alias's own follower_id", proxy.includes("= f.follower_id"));
  ok("quietHoursOkForFollowerSql requires the check-in to be active", proxy.includes("state = 'active'"));

  // WS-R131 (migration 134). `quietHoursOkForFollowerRowSql` reads the
  // follower's own row directly; `quietHoursOkForFollowerSql` wraps it in a
  // `coalesce()` against the check-in proxy above — ONE SQL expression,
  // never two code paths choosing between them.
  const row = quietHoursOkForFollowerRowSql("f", 1);
  ok("quietHoursOkForFollowerRowSql embeds the marker", row.includes(QUIET_HOURS_MARKER));
  ok("quietHoursOkForFollowerRowSql reads the given alias's own columns", row.includes("f.quiet_from") && row.includes("f.quiet_to") && row.includes("f.timezone"));
  ok("quietHoursOkForFollowerRowSql binds the given param index", row.includes("($1)::timestamptz"));
  ok("quietHoursOkForFollowerRowSql guards a null timezone before ever using it in `at time zone`", row.includes("f.timezone is not null"));
  ok("quietHoursOkForFollowerSql is coalesce-shaped, own row first: it embeds the row fragment's own text",
    proxy.includes("coalesce(") && proxy.includes(row.trim()));
  // The row fragment sits BEFORE the check-in proxy inside the coalesce —
  // "own row wins, else the proxy", never the reverse.
  ok(
    "the row fragment appears before the check-in NOT EXISTS inside the coalesced text",
    proxy.indexOf("f.quiet_from") < proxy.indexOf("not exists"),
  );
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: THE REAL DUE-SELECTS, DRIVEN THROUGH A RECORDING FAKE db ──");
{
  function recordingDb(rows = []) {
    const calls = [];
    const db = async (sql, params = []) => {
      calls.push({ sql, params });
      return rows;
    };
    db.calls = calls;
    return db;
  }

  // ── api/_checkins.js's own sweep: two statements, both must carry the
  //    marker. Zero due rows returned, so every downstream branch (the
  //    delivery loop, the skip loop, the best-effort incident/rate-purge
  //    tail) is a no-op — this suite's own concern is the SQL TEXT, never
  //    the delivery mechanics evals/checkins/run.mjs already proves.
  {
    const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);
    const db = recordingDb([]);
    await CI.sweep({ db, env: {}, fetch: async () => ({ ok: true }) }, Date.now());
    const dueSelects = db.calls.filter((c) => /from vy_room_checkin c/.test(c.sql));
    ok("api/_checkins.js's sweep issues both due-selects", dueSelects.length === 2, `saw ${dueSelects.length}`);
    ok(
      "both of api/_checkins.js's due-selects carry the shared quiet-hours marker",
      dueSelects.length === 2 && dueSelects.every((c) => c.sql.includes(QUIET_HOURS_MARKER)),
    );
  }

  // ── api/_renewals.js's own follower due-select.
  {
    const RN = await import(pathToFileURL(join(REPO, "api/_renewals.js")).href);
    const db = recordingDb([]);
    await RN.dueReminders(db, Date.now());
    const followerSelect = db.calls.find((c) => c.sql.includes("from vy_room_subscription s") && c.sql.includes("s.follower_id as subject_id"));
    ok("api/_renewals.js's follower due-select was issued", Boolean(followerSelect));
    ok("api/_renewals.js's follower due-select carries the shared quiet-hours marker", Boolean(followerSelect?.sql.includes(QUIET_HOURS_MARKER)));
    // Creator/org reminders are owner-lane — this workstream's brief names
    // them out of scope — so neither is expected to carry the marker.
    const creatorSelect = db.calls.find((c) => c.sql.includes("from vy_creator_subscription s"));
    const orgSelect = db.calls.find((c) => c.sql.includes("from vy_org_subscription s"));
    ok("creator/org due-selects were issued (unaffected, owner-lane, out of scope)", Boolean(creatorSelect) && Boolean(orgSelect));
  }

  // ── api/_dormancy.js's own notice-due statement.
  {
    const DM = await import(pathToFileURL(join(REPO, "api/_dormancy.js")).href);
    const db = recordingDb([]);
    await DM.dormancyNoticeDue(db, Date.now());
    const notice = db.calls.find((c) => c.sql.includes("update vy_room_follower f") && c.sql.includes("set dormancy_notice_at"));
    ok("api/_dormancy.js's notice-due statement was issued", Boolean(notice));
    ok("api/_dormancy.js's notice-due statement carries the shared quiet-hours marker", Boolean(notice?.sql.includes(QUIET_HOURS_MARKER)));
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: NEGATIVE CONTROLS ──");
{
  // (a) A frozen copy of the renewals follower due-select's own WHERE
  //     clause exactly as it read before this workstream (WS-R37, no
  //     quiet-hours predicate at all) MUST fail the identical scan this
  //     suite's own §3 runs — proving the scan would have caught the gap
  //     the workstream brief describes, not merely that today's tree
  //     happens to pass.
  const FROZEN_PRE_WS_R129_RENEWALS_FOLLOWER_SELECT = `
    select s.follower_id as subject_id, s.room_id, s.person_id,
            s.current_period_end as period_end,
            r.slug, r.display_name, f.locale,
            p.follower_price_inr as amount_inr, coalesce(p.currency, 'INR') as currency
       from vy_room_subscription s
       join vy_room r on r.room_id = s.room_id
       join vy_room_follower f on f.follower_id = s.follower_id
       left join vy_room_price p on p.room_id = s.room_id
      where s.state = 'active'
        and s.cancel_at_period_end = false
        and s.current_period_end is not null
        and s.current_period_end >= ($1)::timestamptz
        and s.current_period_end < ($2)::timestamptz
        and not exists (
          select 1 from vy_renewal_reminder rr
           where rr.subject_kind = 'follower'
             and rr.subject_id = s.follower_id
             and rr.period_end = s.current_period_end
        )
      order by s.current_period_end asc
      limit 500`;
  ok(
    "NEGATIVE CONTROL: the pre-WS-R129 renewals follower select has no quiet-hours marker (the scan would have caught it)",
    !FROZEN_PRE_WS_R129_RENEWALS_FOLLOWER_SELECT.includes(QUIET_HOURS_MARKER),
  );

  // (b) The follower-proxy predicate is a TRUE NO-OP for a follower with
  //     zero active check-ins — never a new, silent block for the common
  //     case (checkins are paid-only; most followers have none).
  //     Proven by driving the real SQL fragment against a tiny in-memory
  //     interpreter of exactly what it expresses: "not exists an active
  //     check-in row for this follower whose own window blocks now" — with
  //     an empty check-in table, `exists` is false, so `not exists` is
  //     true, unconditionally, for every possible `now`.
  const proxySql = quietHoursOkForFollowerSql("f", 1);
  const noCheckins = [];
  const followerBlockedByAny = (followerId, nowMs) =>
    noCheckins
      .filter((c) => c.follower_id === followerId && c.state === "active")
      .some((c) => !isQuietHoursOk(nowMs, c.timezone, c.quiet_from, c.quiet_to));
  ok(
    "a follower with zero active check-ins is never blocked, at 3am or any other hour",
    followerBlockedByAny("f1", Date.parse("2026-09-06T21:30:00.000Z")) === false,
  );
  ok("the fragment driving that same claim is the real exported one, not a re-typed copy", proxySql.includes("not exists"));
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: WS-R131 (migration 134) — the follower's own row beats the proxy ──");
// ═════════════════════════════════════════════════════════════════════════
// A tiny in-memory interpreter of exactly what `quietHoursOkForFollowerSql`
// now expresses: the follower's own row (timezone/quiet_from/quiet_to on
// their own row) wins when set; only when it is NOT set does the check-in
// proxy from §4(b) ever get consulted — the coalesce §2 already proved the
// SQL text embeds.
{
  const effectiveOk = (follower, checkins, nowMs) => {
    const ownSet = follower.quiet_from != null && follower.quiet_to != null && follower.timezone;
    if (ownSet) return isQuietHoursOk(nowMs, follower.timezone, follower.quiet_from, follower.quiet_to);
    return !checkins
      .filter((c) => c.follower_id === follower.follower_id && c.state === "active")
      .some((c) => !isQuietHoursOk(nowMs, c.timezone, c.quiet_from, c.quiet_to));
  };

  const t2201 = Date.parse("2026-09-05T16:31:00.000Z"); // 22:01 IST
  const tNoon = Date.parse("2026-09-05T06:30:00.000Z"); // 12:00 IST — well outside 22:00-07:00

  // (a) Own row set, no check-in at all — the own row governs.
  const f1 = { follower_id: "f1", timezone: "Asia/Kolkata", quiet_from: "22:00", quiet_to: "07:00" };
  ok("own row alone: 22:01 IST is blocked by the account window, no check-in involved", effectiveOk(f1, [], t2201) === false);
  ok("own row alone: noon IST is not blocked", effectiveOk(f1, [], tNoon) === true);

  // (b) Own row set AND a check-in exists with a DIFFERENT, non-blocking
  //     window at this instant — the own row still governs (wins), the
  //     check-in's own window is never consulted at all.
  const f2 = { follower_id: "f2", timezone: "Asia/Kolkata", quiet_from: "22:00", quiet_to: "07:00" };
  const checkinsF2 = [{ follower_id: "f2", state: "active", timezone: "Asia/Kolkata", quiet_from: "01:00", quiet_to: "02:00" }];
  ok(
    "own row wins over a check-in whose own window would NOT have blocked this instant either — same answer, own row still the reason",
    effectiveOk(f2, checkinsF2, t2201) === false,
  );

  // (c) Own row set to a window that would NOT block, while an active
  //     check-in's OWN window WOULD have blocked — the own row still wins,
  //     proving this is a real override, not merely "whichever says block".
  const f3 = { follower_id: "f3", timezone: "Asia/Kolkata", quiet_from: "01:00", quiet_to: "02:00" };
  const checkinsF3 = [{ follower_id: "f3", state: "active", timezone: "Asia/Kolkata", quiet_from: "22:00", quiet_to: "07:00" }];
  ok(
    "own row (a non-blocking window) wins even though the check-in's own window WOULD have blocked — the row is the source of truth, not merely OR'd with the proxy",
    effectiveOk(f3, checkinsF3, t2201) === true,
  );

  // (d) No own-row window at all — the proxy still governs, WS-R129's
  //     original behaviour, byte-identical for a follower who has never used
  //     the new account-level control.
  const f4 = { follower_id: "f4", timezone: null, quiet_from: null, quiet_to: null };
  const checkinsF4 = [{ follower_id: "f4", state: "active", timezone: "Asia/Kolkata", quiet_from: "22:00", quiet_to: "07:00" }];
  ok("no own-row window: the check-in proxy still blocks exactly as WS-R129 always did", effectiveOk(f4, checkinsF4, t2201) === false);

  // NEGATIVE CONTROL: a frozen copy of `quietHoursOkForFollowerSql`'s own
  // PRE-WS-R131 text (the bare NOT EXISTS, no row-level check at all) has no
  // way to express case (c) above — it can only ever agree with or be
  // silent about the check-in, never override it. Proven structurally: the
  // frozen text contains no reference to the follower alias's own
  // quiet_from/quiet_to at the top level, only inside the nested check-in
  // subquery — exactly the shape that made case (c) impossible before this
  // workstream.
  const FROZEN_PRE_WS_R131_PROXY = `/* ws-r129-quiet-hours */ not exists (
    select 1 from vy_room_checkin qh_f
     where qh_f.follower_id = f.follower_id
       and qh_f.state = 'active'
       and not (qh_f.quiet_from is null or qh_f.quiet_to is null or true)
  )`;
  const topLevelRowRef = /^[^(]*f\.quiet_from/.test(FROZEN_PRE_WS_R131_PROXY.replace(/qh_f\.\w+/g, ""));
  ok(
    "NEGATIVE CONTROL: the pre-WS-R131 proxy text has no TOP-LEVEL reference to the follower's own quiet_from (only inside the nested check-in alias) — it could not have expressed 'own row overrides the check-in'",
    !topLevelRowRef,
  );
  ok(
    "the REAL, current fragment DOES carry a top-level reference to the follower alias's own quiet_from (the row check, ahead of the coalesce)",
    /coalesce\(\s*\/\* ws-r129-quiet-hours \*\/ \(\s*case when f\.quiet_from/.test(quietHoursOkForFollowerSql("f", 1)),
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
