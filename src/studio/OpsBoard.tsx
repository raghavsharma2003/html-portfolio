// OpsBoard.tsx - WS-R21. The platform-operator board at `/studio?mode=ops`.
// Answers "is the Room alive" in ten seconds: a table per Room, a sweeps
// strip, real counts only. Never a follower's words, never a fake number.
//
// Mounted standalone from `main.tsx` on `?mode=ops`, not inside `StudioApp`
// - a 2000+ line, heavily gated file (`scripts/check-layout.mjs` renders its
// real signed-in shape) is the wrong place to graft a second, unrelated
// product onto. This file owns its own small sign-in flow, reusing the SAME
// session store (`./session.ts`) and the SAME Google OAuth path
// (`./studioAuth.ts`) every other studio screen uses - never a second auth
// system, `api/ops.js`'s own header restates the same rule server-side.
//
// A 404 from `/api/ops` means EXACTLY what `api/ops.js`'s law says it means:
// this page is not here for you, whether that is because the capability is
// unconfigured or because you are not the operator. This screen's own copy
// never tries to tell those two apart either - disclosing which one it was
// would itself be the leak the law exists to prevent.
import { useCallback, useEffect, useState } from "react";
import { restoreSession, writeStoredSession } from "./session";
import { googleSignIn, isStudioAuthDead } from "./studioAuth";
import { ReplicaApiError } from "./replicaApi";
import { readOpsOverview, type OpsOverview, type OpsRoom, type OpsSweep, type OpsFunnel, type SweepStaleness } from "./opsApi";
import type { StudioSession } from "./types";
import "./design/ops-board.css";

const RETURN_PATH = "/studio?mode=ops";

function badgeClassForStaleness(staleness: SweepStaleness): string {
  if (staleness === "fresh") return "ops-board__badge ops-board__badge--done";
  if (staleness === "stale") return "ops-board__badge ops-board__badge--waiting";
  if (staleness === "never_ran") return "ops-board__badge ops-board__badge--stopped";
  return "ops-board__badge ops-board__badge--running";
}

function badgeLabelForStaleness(staleness: SweepStaleness): string {
  if (staleness === "fresh") return "fresh";
  if (staleness === "stale") return "stale";
  if (staleness === "never_ran") return "never ran";
  if (staleness === "unscheduled") return "no schedule";
  return "schedule unrecognised";
}

function badgeClassForOutcome(outcome: OpsSweep["last_outcome"]): string {
  if (outcome === "ok") return "ops-board__badge ops-board__badge--done";
  if (outcome === "partial") return "ops-board__badge ops-board__badge--waiting";
  if (outcome === "failed") return "ops-board__badge ops-board__badge--stopped";
  if (outcome === "running") return "ops-board__badge ops-board__badge--running";
  return "ops-board__badge ops-board__badge--stopped"; // never_ran
}

function badgeClassForDrift(state: OpsRoom["drift_state"]): string {
  if (state === "steady") return "ops-board__badge ops-board__badge--done";
  if (state === "moved") return "ops-board__badge ops-board__badge--waiting";
  return "ops-board__badge ops-board__badge--running"; // not_measured / no_report
}

function formatAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

const inr = (paise: number) => `Rs ${paise.toLocaleString("en-IN")}`;

// WS-R25. Plain-words labels for `api/_funnel.js`'s FUNNEL_STEPS - a stall
// count on screen naming "readiness_passed_lock" reads as a bug report, not
// an answer.
const FUNNEL_STEP_LABELS: Record<string, string> = {
  account_created: "creating an account",
  studio_opened: "opening the studio",
  first_source_uploaded: "uploading a first source",
  processing_finished: "processing finishing",
  first_preview_heard: "hearing a first preview",
  readiness_first_measured: "readiness being measured",
  readiness_passed_lock: "readiness passing the lock",
  disclosure_approved: "the disclosure being approved",
  room_created: "creating a Room",
  publish_clicked: "clicking Publish",
  room_published: "the Room actually publishing",
};

function funnelStepLabel(step: string): string {
  return FUNNEL_STEP_LABELS[step] || step.replace(/_/g, " ");
}

function FunnelCard({ funnel }: { funnel: OpsFunnel }) {
  const { median, p90, n } = funnel.minutes_to_first_room;
  return (
    <div className="ops-board__panel">
      <h2>Minutes to first Room</h2>
      {n === 0 ? (
        <p className="ops-board__empty">No creator has published yet.</p>
      ) : (
        <div className="ops-board__stats">
          <Stat label="median minutes" value={median ?? "not measured"} />
          <Stat label="p90 minutes" value={p90 ?? "not measured"} />
          <Stat label="published (n)" value={n} />
        </div>
      )}
      <h2 style={{ marginTop: "var(--space-section)" }}>Where creators stop</h2>
      {funnel.stalled_at.length === 0 ? (
        <p className="ops-board__empty">No creator has stalled for 7 days or more.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="ops-board__table">
            <thead>
              <tr>
                <th>last reached</th>
                <th>creators stalled here</th>
              </tr>
            </thead>
            <tbody>
              {funnel.stalled_at.map((s) => (
                <tr key={s.step}>
                  <td>{funnelStepLabel(s.step)}</td>
                  <td>{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="ops-board__stat">
      <span className="ops-board__stat-value">{value}</span>
      <span className="ops-board__stat-label">{label}</span>
    </div>
  );
}

function RoomCard({ room }: { room: OpsRoom }) {
  const deliveries = Object.entries(room.deliveries_last_24h);
  const deliveredCount = room.deliveries_last_24h.delivered ?? 0;
  return (
    <div className="ops-board__room">
      <div className="ops-board__room-head">
        <h3>{room.display_name || room.slug}</h3>
        <span className="ops-board__slug">/r/{room.slug}</span>
        <span className={badgeClassForOutcome(room.published ? "ok" : "partial")}>
          {room.published ? "published" : "not published"}
        </span>
        <span className={badgeClassForDrift(room.drift_state)}>
          voice: {room.drift_state === "no_report" ? "not measured yet" : room.drift_state.replace("_", " ")}
        </span>
      </div>
      <div className="ops-board__stats">
        <Stat label="followers" value={room.followers_total} />
        <Stat label="paid followers" value={room.followers_paid} />
        <Stat label="joined, last 7d" value={room.joined_last_7d} />
        <Stat label="messages, last 24h" value={room.messages_last_24h} />
        <Stat label="at message cap this month" value={room.at_cap_this_month} />
        <Stat label="voice seconds this month" value={room.voice_seconds_this_month} />
        <Stat label="active check-ins" value={room.active_check_ins} />
        <Stat label="check-ins delivered, last 24h" value={deliveredCount} />
        <Stat label="Pulse opt-ins" value={room.pulse_opt_ins} />
        <Stat label="latest Pulse week" value={room.latest_pulse_week ?? "none yet"} />
        <Stat label="active subscriptions" value={room.subscriptions.active} />
        <Stat label="revenue this month" value={inr(room.revenue_this_month_inr)} />
      </div>
      {deliveries.length > 1 && (
        <p className="ops-board__slug" style={{ marginTop: "var(--space-row)" }}>
          deliveries by state, last 24h: {deliveries.map(([state, n]) => `${state.replace(/_/g, " ")} ${n}`).join(", ")}
        </p>
      )}
    </div>
  );
}

function SweepsStrip({ sweeps }: { sweeps: OpsSweep[] }) {
  return (
    <div className="ops-board__panel">
      <h2>Sweeps</h2>
      {/* WS-R25: closes WS-R21's own open item ("the heartbeat table needs a
          retention delete before Phase 1") by saying the window out loud
          rather than leaving the retention invisible on the one screen that
          reads this table. */}
      <p className="ops-board__slug">Runs older than 30 days are deleted automatically, per sweep.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="ops-board__table">
          <thead>
            <tr>
              <th>sweep</th>
              <th>schedule</th>
              <th>last ran</th>
              <th>outcome</th>
              <th>freshness</th>
            </tr>
          </thead>
          <tbody>
            {sweeps.map((s) => (
              <tr key={s.sweep}>
                <td>{s.sweep}</td>
                <td>{s.schedule ?? "not scheduled"}</td>
                <td>{formatAgo(s.last_started_at)}</td>
                <td><span className={badgeClassForOutcome(s.last_outcome)}>{s.last_outcome.replace("_", " ")}</span></td>
                <td><span className={badgeClassForStaleness(s.staleness)}>{badgeLabelForStaleness(s.staleness)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function OpsBoard() {
  const [session, setSession] = useState<StudioSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  // `notHere` covers both an unconfigured board and a signed-in non-operator
  // - the API answers 404 for both, on purpose, and this screen keeps that
  // same non-disclosure rather than telling the two apart client-side.
  const [notHere, setNotHere] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    restoreSession().then((restored) => {
      setSession(restored);
      setCheckedSession(true);
    });
  }, []);

  const load = useCallback(async (current: StudioSession) => {
    setLoading(true);
    setError(null);
    setNotHere(false);
    try {
      const data = await readOpsOverview(current.accessToken);
      setOverview(data);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 404) {
        setNotHere(true);
      } else if (isStudioAuthDead(cause)) {
        writeStoredSession(null);
        setSession(null);
      } else {
        setError("Could not load the board. Try again.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load(session);
  }, [session, load]);

  if (!checkedSession) return <div className="ops-board ops-board__loading">Loading.</div>;

  if (!session) {
    return (
      <div className="ops-board">
        <div className="ops-board__signin">
          <h1 className="ops-board__title">Ops board</h1>
          <p>Sign in to continue.</p>
          <button
            type="button"
            onPointerDown={() => {
              googleSignIn(RETURN_PATH).catch(() => setError("Sign-in is unavailable right now."));
            }}
          >
            Continue with Google
          </button>
          {error && <p className="ops-board__error">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="ops-board">
      <div className="ops-board__head">
        <div>
          <h1 className="ops-board__title">Ops board</h1>
          {overview && <p className="ops-board__meta">Generated {formatAgo(overview.generated_at)}</p>}
        </div>
        <button
          type="button"
          className="ops-board__refresh"
          disabled={loading}
          onPointerDown={() => load(session)}
        >
          {loading ? "Refreshing." : "Refresh"}
        </button>
      </div>
      <div className="ops-board__body">
        {notHere && <p className="ops-board__empty">This page is not available.</p>}
        {error && !notHere && <p className="ops-board__error">{error}</p>}
        {loading && !overview && !notHere && !error && <p className="ops-board__loading">Loading.</p>}
        {overview && (
          <>
            <div className="ops-board__panel">
              <h2>Rooms</h2>
              {overview.rooms.length === 0 ? (
                <p className="ops-board__empty">No Rooms exist yet.</p>
              ) : (
                overview.rooms.map((room) => <RoomCard key={room.room_id} room={room} />)
              )}
            </div>
            <FunnelCard funnel={overview.funnel} />
            <SweepsStrip sweeps={overview.sweeps} />
          </>
        )}
      </div>
    </div>
  );
}
