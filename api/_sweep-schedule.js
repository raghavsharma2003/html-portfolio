// The ops board's only source for "how often is this sweep supposed to
// run": `vercel.json`'s own `crons` array, imported as JSON at build time
// (`api/route.js`'s own convention for `config/models.json`) rather than
// hand-copied into a second table that could drift from the file Vercel
// actually schedules against. WS-R21's brief is explicit: "read at build
// time, not guessed."
import vercelConfig from "../vercel.json" with { type: "json" };

// Every cron path in this repo is `/api/<name>-sweep`, and every handler
// that calls `withSweepRun` (api/_sweep-run.js) names its sweep the SAME
// `<name>` this strips out - one derivation, so a sweep row and its
// schedule entry can never disagree about what to call each other.
//
// WS-R76 (migration 120): `api/self-check.js` is the one deliberate
// exception - it probes the deployment itself rather than sweeping a table
// of rows, so the workstream brief names its file literally `self-check.js`,
// not `self-check-sweep.js`. Vercel routes a cron path to the file of the
// same name, so the cron path is exactly `/api/self-check` and cannot end
// in `-sweep` without renaming the file. One exact, named exception rather
// than loosening the regex below for every future cron this repo adds.
export function sweepNameFromPath(path) {
  const p = String(path || "");
  if (p === "/api/self-check") return "self-check";
  const m = p.match(/^\/api\/(.+)-sweep$/);
  return m ? m[1] : null;
}

/**
 * The longest gap that should EVER separate two firings of a standard 5-field
 * cron expression, in milliseconds - not a general cron parser, only the
 * shapes `vercel.json` actually uses in this repo (every-N-minutes,
 * every-N-hours, hourly, one daily slot, and one weekly slot). Returns null for a shape this
 * does not recognise, and the caller must treat null as "unknown", never as
 * "never fires" - guessing a number for a schedule this cannot read would be
 * exactly the "read at build time, not guessed" law broken from the inside.
 */
export function expectedIntervalMs(schedule) {
  const fields = String(schedule || "").trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [min, hour, dom, mon, dow] = fields;
  if (dom !== "*" || mon !== "*") return null; // month/day-of-month schedules: out of scope, unknown rather than guessed

  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === "*" && dow === "*") return Number(everyMin[1]) * 60_000;

  // WS-R76: generalized from the literal `min === "0"` every existing
  // schedule in this repo happens to use to any FIXED single minute value -
  // none of the hour-scale branches below depend on WHICH minute past the
  // hour a schedule fires, only on the hour/day-of-week shape, so a cron
  // firing at :30 (self-check's own "30 2 * * *", chosen to land off the
  // top-of-hour crowd every other daily cron here fires on) is exactly as
  // computable as one firing at :00 - this widens what the parser can READ,
  // never what it will GUESS: an unrecognised shape is still null, below.
  if (/^\d+$/.test(min)) {
    const everyHour = hour.match(/^\*\/(\d+)$/);
    if (everyHour && dow === "*") return Number(everyHour[1]) * 3_600_000;
    if (hour === "*" && dow === "*") return 3_600_000; // hourly
    // One daily slot (`0 H * * *`). WS-R37 first wrote its daily sweep as
    // `0 */24 * * *` so this parser's every-N-hours arm would read it;
    // Vercel rejected the deployment (`Invalid value found 24`: an hour step
    // must be 1..23), so the daily shape is read here instead
    // (rejected.md#ws-r37-cron-step-of-24-hours-is-not-a-cron).
    if (/^\d+$/.test(hour) && dow === "*") return 24 * 3_600_000;
    if (/^\d+$/.test(hour) && /^[0-6]$/.test(dow)) return 7 * 24 * 3_600_000; // one weekly slot
  }
  return null;
}

/**
 * Every sweep named in `vercel.json`'s crons, as
 *   { [sweepName]: { path, schedule, expectedIntervalMs } }
 * `expectedIntervalMs` is null for a schedule shape this file does not
 * parse - the board must show "schedule unrecognised", never invent a
 * number to compare a run's age against.
 */
export function sweepSchedules(config = vercelConfig) {
  const out = {};
  for (const entry of config?.crons || []) {
    const name = sweepNameFromPath(entry.path);
    if (!name) continue;
    out[name] = {
      path: entry.path,
      schedule: entry.schedule,
      expected_interval_ms: expectedIntervalMs(entry.schedule),
    };
  }
  return out;
}
