// ActivityPanel — the one surface that answers "what is happening to my stuff".
// Gurukul WS-AF.
//
// The owner's ask, verbatim: "I should also see that have we received the YT
// video and that processing done or not, and all the other processing going on
// we should see, in a user view."
//
// Seven asynchronous lanes run in this platform and the person who started them
// could see none of them. This screen answers, in order and at a glance:
//
//   did my YouTube link arrive     a row per video, titled with the video's
//                                  own title
//   is it processing               a state and a sentence, never a bar
//   did it finish                  a finished group with the time it finished
//   what came out of it            the suggestion count on the row
//   what do I do next              the one group at the top that is YOUR turn
//
// ── FOUR THINGS THIS FILE REFUSES TO DO ──────────────────────────────────
//
// 1. It never renders a percentage. The only progress it draws is the
//    eight-step tick rail for the enrollment pipeline, and only when the server
//    sent a real `progress` object. Six of the seven lanes send null and get
//    words. `plausible-return-hides-a-dead-pipeline` is this repo's most
//    expensive law and a progress bar is its purest form.
//
// 2. It never shows a spinner. Loading renders skeletons in the shape of the
//    rows that are coming, so the page does not reflow when they land.
//    DESIGN-LAW §3.
//
// 3. It never renders an empty list for a lane that cannot work. A lane whose
//    provider or cron is absent returns zero rows, and zero rows looks exactly
//    like "nothing has happened yet", which is a SUCCESS shape for a lane that
//    is not deployed at all. The server sends a per-lane verdict and this file
//    renders "not connected yet" with the missing piece NAMED.
//
// 4. It never polls into the void. `next_poll_ms: null` stops the loop, because
//    a screen that keeps asking a question whose answer cannot change bills a
//    serverless invocation every three seconds for as long as the tab is open.
//
// ── it does not mutate anything except the one safe retry ────────────────
// Every act this surface offers is owned by another endpoint that has its own
// consent gates and its own audit row, so the panel hands them back to the host
// through `onAct`. The single exception is `finish this upload`, which re-runs
// finalize on a source whose bytes are already in storage. That one is safe,
// needs nothing from the owner's disk, and is the recovery path for every
// upload stranded by the finalize defect.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./activity.css";
import { ReplicaApiError } from "./replicaApi";
import {
  fetchActivity,
  sameActivity,
  type ActivityJob,
  type ActivityLaneStatus,
  type ActivityState,
  type ActivityView,
} from "./activityApi";
import { finalizeSource } from "./enrollmentApi";

/** The four groups. "Your turn" first because it is the only one that is about
 *  the person; finished last because it is the only one they can stop reading. */
const GROUPS: Record<string, { key: string; title: string; states: ActivityState[] }> = {
  yours: { key: "yours", title: "Your turn", states: ["waiting_on_you"] },
  working: { key: "working", title: "Working now", states: ["running", "queued"] },
  stopped: { key: "stopped", title: "Stopped", states: ["failed", "blocked"] },
  finished: { key: "finished", title: "Finished", states: ["done", "cancelled"] },
};

/** WS-AE's `ProcessingStatusMount` asks for two moods, not one panel shown
 *  twice, and it is right about why:
 *
 *    feed  "did that land?"          asked right after a drop, while the file
 *                                    is still in the owner's hand.
 *    meet  "why does it not know
 *           that yet?"               asked when the clone answers without
 *                                    something the owner is sure they gave it.
 *
 *  The same jobs answer both questions, so the data is identical and the ORDER
 *  and the framing are not: on `feed` the finished work is the reassurance and
 *  goes last; on `meet` the UNFINISHED work is the answer and goes first. */
const MOODS = {
  feed: {
    title: "Where each upload is right now",
    lede: "Everything you have handed over, and what is happening to it. Anything that needs you is at the top.",
    order: ["yours", "working", "stopped", "finished"],
  },
  meet: {
    title: "What has finished, and what has not",
    lede: "If your AI does not know something you are sure you gave it, the reason is usually here. Unfinished work first.",
    order: ["working", "stopped", "yours", "finished"],
  },
} as const;

/** How long ago, in words a person says out loud.
 *
 *  Not a live-updating "last sync 4s ago" strip: DESIGN-LAW §1 bans those, and
 *  it is right to, because a ticking clock in the chrome is meta-information
 *  about the page rather than information about the work. This is a property of
 *  the ROW, it moves only when the row does, and its floor is a minute so it
 *  never twitches. */
function ago(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function StepRail({ done, total }: { done: number; total: number }) {
  return (
    <span className="vy-activity__steps" aria-label={`${done} of ${total} steps done`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="vy-activity__step" data-done={i < done ? "true" : "false"} />
      ))}
    </span>
  );
}

function SkeletonRow() {
  return (
    <div className="vy-activity__skeleton" aria-hidden="true">
      <span className="vy-activity__bone vy-activity__bone--dot" />
      <span>
        <span className="vy-activity__bone vy-activity__bone--subject" style={{ display: "block" }} />
        <span className="vy-activity__bone vy-activity__bone--reason" style={{ display: "block" }} />
      </span>
      <span className="vy-activity__bone vy-activity__bone--when" />
    </div>
  );
}

function NotConnected({ lane }: { lane: ActivityLaneStatus }) {
  return (
    <div className="vy-activity__notice">
      <p><strong>{lane.label}: not connected yet.</strong></p>
      <p>
        Nothing in this lane can run until it is set up, so an empty list here does not mean
        nothing has happened. What is missing:{" "}
        <span className="vy-activity__missing">{lane.missing.join(", ")}</span>
      </p>
    </div>
  );
}

export default function ActivityPanel({
  token,
  replicaId,
  where = "feed",
  showHeading = true,
  onAuthError,
  onAct,
  onView,
}: {
  token: string;
  replicaId: string;
  /** Which of the two questions this mount is answering. See MOODS above. */
  where?: "feed" | "meet";
  /**
   * False when the host already gave this mount a heading AND an intro of
   * its own.
   *
   * On Feed it used to be printed twice: `StudioApp.tsx` wraps this panel in
   * a `Band` titled "Where each upload is right now" with its own blurb, and
   * this component printed the identical title (`MOODS.feed.title`) and a
   * near-identical lede one line below it — the owner's screenshot showed the
   * heading stacked twice. This suppresses both here and relies on the host's
   * copy instead, since a host that gives this panel its own dedicated Band
   * already says the same thing.
   */
  showHeading?: boolean;
  onAuthError?: (error: ReplicaApiError) => void;
  /** The host owns navigation. A `review` action means "take me to the
   *  suggestions", a `fix_input` action means "take me to the step that owns
   *  this". The panel deliberately does not navigate on its own, on
   *  ContextLockerPanel's precedent: a screen that jumps while the owner is
   *  reading a failure reason takes the reason away with it. */
  onAct?: (job: ActivityJob) => void;
  /** Every successful read, handed up (WS-AJ).
   *
   *  This exists so the wizard can tell the two blocker classes apart without a
   *  SECOND poll of the same endpoint. `/api/replica-activity` is polled on a
   *  server-decided interval and every call is a billed serverless invocation;
   *  a parallel fetch in `StudioApp` purely to ask "is the platform busy" would
   *  double that for an answer this component already has in hand. It is
   *  additive and optional, so a mount that does not care is unchanged. */
  onView?: (view: ActivityView) => void;
}) {
  const [view, setView] = useState<ActivityView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [retrying, setRetrying] = useState<string>("");

  // Held in refs rather than state: changing them must not re-run the poll
  // effect, which would restart the loop and reset the backoff on every tick.
  const unchanged = useRef(0);
  const latest = useRef<ActivityView | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (signal: AbortSignal): Promise<number | null> => {
    try {
      const next = await fetchActivity(token, replicaId, unchanged.current, signal);
      // The backoff counts CONSECUTIVE polls in which nothing a person would
      // notice moved, and resets to the floor the moment anything does. A fixed
      // fast interval is wasteful; a fixed slow one makes the screen feel dead.
      unchanged.current = sameActivity(latest.current, next) ? unchanged.current + 1 : 0;
      latest.current = next;
      setView(next);
      onView?.(next);
      setError("");
      return next.next_poll_ms;
    } catch (cause) {
      if (signal.aborted) return null;
      if (cause instanceof ReplicaApiError && cause.status === 401) {
        onAuthError?.(cause);
        return null;
      }
      setError(cause instanceof Error ? cause.message : "could not read activity");
      // A failed poll is not a reason to give up, but it IS a reason to slow
      // down: an endpoint that is 500ing does not get hammered every 3 s.
      return latest.current?.in_flight ? 15_000 : null;
    } finally {
      setLoading(false);
    }
  }, [token, replicaId, onAuthError, onView]);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    unchanged.current = 0;
    latest.current = null;
    setLoading(true);

    const tick = async () => {
      const delay = await load(controller.signal);
      if (!live || delay === null) return; // null is the STOP rule
      timer.current = setTimeout(tick, delay);
    };
    void tick();

    return () => {
      live = false;
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const mood = MOODS[where];

  const grouped = useMemo(() => {
    const jobs = view?.jobs ?? [];
    return mood.order
      .map((key) => GROUPS[key])
      .map((group) => ({ ...group, jobs: jobs.filter((job) => group.states.includes(job.state)) }))
      .filter((group) => group.jobs.length > 0);
  }, [view, mood]);

  const undeployed = (view?.lanes ?? []).filter((lane) => !lane.deployed);

  const act = async (job: ActivityJob) => {
    if (job.next_action.kind !== "retry") {
      onAct?.(job);
      return;
    }
    setRetrying(job.job_id);
    try {
      await finalizeSource(token, replicaId, job.ref);
      unchanged.current = 0;
      const controller = new AbortController();
      await load(controller.signal);
    } catch (cause) {
      // Named, never swallowed. `source_state_changed` means it already moved
      // on, which is good news and is said as such.
      const raw = cause instanceof Error ? cause.message : "the retry did not go through";
      setError(raw.includes("source state changed")
        ? "That upload had already moved on, so there was nothing to finish."
        : raw);
    } finally {
      setRetrying("");
    }
  };

  return (
    <section
      className="vy-activity"
      id={`processing-status-${where}`}
      aria-labelledby={showHeading ? `vy-activity-title-${where}` : undefined}
      aria-label={showHeading ? undefined : mood.title}
    >
      {showHeading && (
        <>
          <header className="vy-activity__head">
            <h2 className="vy-activity__title" id={`vy-activity-title-${where}`}>{mood.title}</h2>
          </header>
          <p className="vy-activity__lede">{mood.lede}</p>
        </>
      )}

      {error ? <div className="vy-activity__error" role="status">{error}</div> : null}

      {undeployed.map((lane) => <NotConnected key={lane.lane} lane={lane} />)}

      {loading && !view ? (
        <div className="vy-activity__group">
          <p className="vy-activity__group-name">Loading</p>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : null}

      {!loading && grouped.length === 0 ? (
        <p className="vy-activity__empty">
          Nothing has been started yet. Add a recording, a file or your channel and it will show up here
          while it runs.
        </p>
      ) : null}

      {grouped.map((group) => (
        <div className="vy-activity__group" key={group.key}>
          <p className="vy-activity__group-name">{group.title}</p>
          {group.jobs.map((job) => (
            <article className="vy-activity__row" key={job.job_id} data-state={job.state} data-lane={job.lane}>
              <span className="vy-activity__dot" aria-hidden="true" />
              <div className="vy-activity__body">
                <div className="vy-activity__subject">{job.subject}</div>
                <p className="vy-activity__reason">{job.state_reason}</p>
                {job.progress ? (
                  <div className="vy-activity__meta">
                    <StepRail done={job.progress.done} total={job.progress.total} />
                    <span>{job.progress.done} of {job.progress.total} {job.progress.unit} done</span>
                  </div>
                ) : null}
              </div>
              <div className="vy-activity__side">
                <span className="vy-activity__when">
                  {job.finished_at ? ago(job.finished_at) : ago(job.updated_at)}
                </span>
                {/* `owner_setup` joins wait and none as TEXT, not a button.
                    It names a deployment setting somebody has to change, and
                    there is no op in this app that changes one, so a button
                    here would be the same fake affordance this file already
                    refuses for "check again". */}
                {job.next_action.kind === "wait" || job.next_action.kind === "none"
                  || job.next_action.kind === "owner_setup" ? (
                  job.next_action.label ? <span className="vy-activity__when">{job.next_action.label}</span> : null
                ) : (
                  <button
                    type="button"
                    className="vy-activity__act"
                    disabled={retrying === job.job_id}
                    // Feedback fires on pointerdown, never on release.
                    // DESIGN-LAW §2: the press IS the feedback, and waiting for
                    // pointerup puts the whole click duration into the latency.
                    onPointerDown={() => { void act(job); }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void act(job);
                      }
                    }}
                  >
                    {retrying === job.job_id ? "Working" : job.next_action.label}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ))}
    </section>
  );
}
