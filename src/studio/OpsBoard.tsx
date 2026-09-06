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
import {
  readOpsOverview,
  subscribeOpsPush,
  revokeOpsPush,
  sendTestOpsDigest,
  type OpsOverview,
  type OpsRoom,
  type OpsSweep,
  type OpsFunnel,
  type OpsShareArrivals,
  type OpsTasteTurns,
  type OpsPhaseGate,
  type OpsIncidents,
  type OpsPushConfig,
  type OpsSelfCheck,
  type OpsPosterArrivals,
  type OpsDigest,
  type OpsShareKitArrivals,
  type OpsFriendArrivals,
  type OpsReconciliation,
  type OpsReceiptsLate,
} from "./opsApi";
import type { StudioSession } from "./types";
import { STUDIO_LANGUAGE_LABELS, STUDIO_LOCALES, type StudioCopy, type StudioLocale } from "./copy";
import { StudioLocaleProvider, useStudioLocale } from "./localeContext";
import { readRememberedStudioLocale, resolveStudioLocale, writeRememberedStudioLocale } from "./studioLocalePreference";
import "./design/ops-board.css";

// WS-R135. Reverses the standing WS-R62/WS-R123 decision that this board
// stays English-only forever (context/decisions.md#ws-r62-ops-board-push-
// copy-stays-english-inline, #ws-r123-ops-board-doors-observed-denominator-
// english-only) now that both entries' own named reversal condition is
// met: every string on this page now reads from `copy.ts#ops`/`hiCopy.ts`'s
// own section (both locales), and this page's OWN `<OpsBoard>` wraps its
// content in `StudioLocaleProvider` directly rather than inheriting one
// from a tree it is never mounted inside (this file's own header, above:
// a standalone `?mode=ops` mount, never grafted onto `StudioApp`). Locale
// resolution reuses `studioLocalePreference.ts`'s pure chain with
// `replica: null` - an operator has no `vy_replica` row, so the chain
// collapses to "`?lang=` wins, else the remembered local choice, else en",
// the exact pre-auth order the sign-in screen elsewhere in the studio
// already uses for the same reason (no row to read yet).
type Ops = StudioCopy["ops"];

/** RFC 4648 base64url, both directions - `src/room/AccountPage.tsx`'s own
 *  pair, restated here rather than imported: that file lives under
 *  `src/room/`, a different surface this board deliberately does not
 *  depend on (this board's own header: a standalone mount, never grafted
 *  onto another product). Two tiny pure functions duplicated once is a
 *  smaller risk than a cross-surface import neither side asked for. */
function b64uToUint8Array(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const base64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Splices named `{key}` placeholders in a copy template - a generalised
 *  `withCount`/`withNameAndCount` (copy.ts) for the handful of templates on
 *  this board that carry more than two values (`phaseGate.nConversionTemplate`
 *  has three). Kept local rather than added to copy.ts's own helpers: those
 *  are deliberately fixed-shape (`{n}`, `{name}`+`{n}`) and used across
 *  every studio file; this one is this board's own, arbitrary-key need. */
function fillTemplate(template: string, vars: Record<string, string | number>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) out = out.split(`{${key}}`).join(String(value));
  return out;
}

const RETURN_PATH = "/studio?mode=ops";

function badgeClassForStaleness(staleness: OpsSweep["staleness"]): string {
  if (staleness === "fresh") return "ops-board__badge ops-board__badge--done";
  if (staleness === "stale") return "ops-board__badge ops-board__badge--waiting";
  if (staleness === "never_ran") return "ops-board__badge ops-board__badge--stopped";
  return "ops-board__badge ops-board__badge--running";
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

// WS-R30. `below`/`at_or_above` never map to "done"/"stopped" the way a
// sweep outcome does - the sweeps strip is a health check, this card is a
// gate, and "below" is a normal, expected state for a young platform, never
// a failure.
function badgeClassForGateState(state: OpsPhaseGate["conversion"]["state"]): string {
  if (state === "at_or_above") return "ops-board__badge ops-board__badge--done";
  if (state === "below") return "ops-board__badge ops-board__badge--waiting";
  return "ops-board__badge ops-board__badge--running"; // not_enough_data
}

const pct1 = (v: number | null, notMeasured: string): string => (v == null ? notMeasured : `${v.toFixed(1)}%`);

function formatAgo(iso: string | null, ago: Ops["ago"]): string {
  if (!iso) return ago.never;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return ago.justNow;
  if (minutes < 60) return fillTemplate(ago.minutes, { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return fillTemplate(ago.hours, { n: hours });
  const days = Math.round(hours / 24);
  return fillTemplate(ago.days, { n: days });
}

const inr = (paise: number, prefix: string) => `${prefix} ${paise.toLocaleString("en-IN")}`;

// WS-R25. Plain-words labels for `api/_funnel.js`'s FUNNEL_STEPS - a stall
// count on screen naming "readiness_passed_lock" reads as a bug report, not
// an answer. The known steps live in `copy.ts#ops.funnel.stepLabel`, both
// locales; an unrecognised step (a future FUNNEL_STEPS addition this table
// has not caught up with yet) falls back to the raw, de-underscored name in
// EITHER locale, same as before this workstream.
function funnelStepLabel(step: string, labels: Ops["funnel"]["stepLabel"]): string {
  return (labels as Record<string, string>)[step] || step.replace(/_/g, " ");
}

function OpsLanguageSwitch({ onSwitch }: { onSwitch: (next: StudioLocale) => void }) {
  const { t, locale } = useStudioLocale();
  return (
    <div className="ops-board__lang-switch" role="group" aria-label={t.ops.languageGroupLabel}>
      {STUDIO_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="ops-board__lang-btn"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => onSwitch(l)}
        >
          {STUDIO_LANGUAGE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}

function PhaseGateCard({ gate }: { gate: OpsPhaseGate }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  const funnelReasons = Object.keys(gate.conversion.funnel).sort();
  return (
    <div className="ops-board__panel">
      <h2>{o.phaseGate.title}</h2>
      <p className="ops-board__slug">{gate.summary}</p>
      <div className="ops-board__stats">
        <div>
          <span className={badgeClassForGateState(gate.conversion.state)}>{o.gateState[gate.conversion.state]}</span>
          <Stat
            label={fillTemplate(o.phaseGate.conversionLabelTemplate, { n: gate.conversion.threshold_pct })}
            value={pct1(gate.conversion.pct, o.notMeasured)}
          />
          <span className="ops-board__slug">
            {fillTemplate(o.phaseGate.nConversionTemplate, {
              n: gate.conversion.n, paying: gate.conversion.paying, eligible: gate.conversion.eligible,
            })}
          </span>
        </div>
        <div>
          <span className={badgeClassForGateState(gate.retention.state)}>{o.gateState[gate.retention.state]}</span>
          <Stat
            label={fillTemplate(o.phaseGate.retentionLabelTemplate, { n: gate.retention.threshold_pct })}
            value={pct1(gate.retention.pct, o.notMeasured)}
          />
          <span className="ops-board__slug">
            {fillTemplate(o.phaseGate.nRetentionTemplate, {
              n: gate.retention.n, returned: gate.retention.returned, joined: gate.retention.joined,
            })}
          </span>
        </div>
        <div>
          <span className={badgeClassForGateState(gate.renewed_unasked.state)}>{o.gateState[gate.renewed_unasked.state]}</span>
          <Stat
            label={fillTemplate(o.phaseGate.renewedLabelTemplate, { n: gate.renewed_unasked.threshold })}
            value={gate.renewed_unasked.count}
          />
          <span className="ops-board__slug">
            {fillTemplate(o.phaseGate.nRenewedPrefixTemplate, { n: gate.renewed_unasked.n })}
            {gate.renewed_unasked.note}.
          </span>
        </div>
      </div>
      {funnelReasons.length > 0 && (
        /* WS-R135: `tabIndex={0}` makes a horizontally scrollable region
           keyboard-operable (axe `scrollable-region-focusable`, WCAG 2.1.1)
           - a real, pre-existing gap in every `overflowX: "auto"` wrapper
           on this board, never caught before because the accessibility
           gate never rendered this page at all. TWO nested scroll boxes
           exist here, not one: this wrapping div's own inline style is the
           scroll boundary above 640px, but `ops-board.css`'s own
           `@media (max-width: 640px) { .ops-board__table { overflow-x:
           auto } }` (restating `design/mobile.css`'s `.studio-main table`
           rule for this standalone mount's own scoped sheet, which is
           never inside `.studio-main`) makes the TABLE ITSELF a second,
           independent scroll box at the 390px width this gate actually
           renders at - axe's own selector for the violation names the
           `table`, not this `div`. Both elements get `tabIndex={0}` so
           whichever one is the real scroll boundary at a given width is
           always the one with a keyboard path; a second, always-present
           tab stop on the other one is a harmless no-op when it is not
           the scrolling element. */
        <div style={{ overflowX: "auto", marginTop: "var(--space-row)" }} tabIndex={0}>
          <table className="ops-board__table" tabIndex={0}>
            <thead>
              <tr>
                <th>{o.phaseGate.tableOfferReason}</th>
                <th>{o.phaseGate.tableShown}</th>
                <th>{o.phaseGate.tableStarted}</th>
                <th>{o.phaseGate.tablePaid}</th>
              </tr>
            </thead>
            <tbody>
              {funnelReasons.map((reason) => (
                <tr key={reason}>
                  <td>{reason.replace(/_/g, " ")}</td>
                  <td>{gate.conversion.funnel[reason].shown}</td>
                  <td>{gate.conversion.funnel[reason].started}</td>
                  <td>{gate.conversion.funnel[reason].paid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FunnelCard({
  funnel,
  shareArrivals,
  tasteTurns,
  posterArrivals,
  shareKitArrivals,
  friendArrivals,
}: {
  funnel: OpsFunnel;
  shareArrivals: OpsShareArrivals;
  tasteTurns: OpsTasteTurns;
  posterArrivals: OpsPosterArrivals;
  shareKitArrivals: OpsShareKitArrivals;
  friendArrivals: OpsFriendArrivals;
}) {
  const { t } = useStudioLocale();
  const o = t.ops;
  const { median, p90, n } = funnel.minutes_to_first_room;
  return (
    <div className="ops-board__panel">
      <h2>{o.funnel.minutesTitle}</h2>
      {n === 0 ? (
        <p className="ops-board__empty">{o.funnel.noPublished}</p>
      ) : (
        <div className="ops-board__stats">
          <Stat label={o.funnel.medianMinutes} value={median ?? o.notMeasured} />
          <Stat label={o.funnel.p90Minutes} value={p90 ?? o.notMeasured} />
          <Stat label={o.funnel.published} value={n} />
        </div>
      )}
      <h2 style={{ marginTop: "var(--space-section)" }}>{o.funnel.stopTitle}</h2>
      {funnel.stalled_at.length === 0 ? (
        <p className="ops-board__empty">{o.funnel.noStalled}</p>
      ) : (
        <div style={{ overflowX: "auto" }} tabIndex={0}>
          {/* WS-R135: the SAME two-scroll-box fix as `PhaseGateCard`'s own
              table above - `tabIndex={0}` on both this table and its
              wrapping div, one keyboard path per width. */}
          <table className="ops-board__table" tabIndex={0}>
            <thead>
              <tr>
                <th>{o.funnel.tableLastReached}</th>
                <th>{o.funnel.tableCreatorsStalled}</th>
              </tr>
            </thead>
            <tbody>
              {funnel.stalled_at.map((s) => (
                <tr key={s.step}>
                  <td>{funnelStepLabel(s.step, o.funnel.stepLabel)}</td>
                  <td>{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* WS-R40 (migration 102). One line: the share loop's own growth
          count, floored at n>=5 the same way `creator_invite_arrivals`
          elsewhere on this board already is - `shareArrivals.note` renders
          the honest floor sentence below that, never a small real number.
          Server-computed prose (`copy.ts#OpsCopy`'s own header): read
          straight off the wire, in whichever locale `api/_funnel.js`
          composed it in (English today, both locales unchanged by this
          workstream). */}
      <h2 style={{ marginTop: "var(--space-section)" }}>{o.funnel.growthTitle}</h2>
      <p className="ops-board__empty">{shareArrivals.note}</p>
      {/* WS-R78 (migration 121). The printed poster's own growth line -
          `shareArrivals`'s own shape, floored the identical way, right
          below it: a poster arrival is a share by another name. */}
      <p className="ops-board__empty">{posterArrivals.note}</p>
      {/* WS-R86 (migration 123). A follower's own "Bring a friend" link -
          `shareArrivals`'s own shape, floored the identical way, right
          below it: an arrival counts here whether or not the visit ever
          becomes a credited referral. */}
      <p className="ops-board__empty">{friendArrivals.note}</p>
      {/* WS-R53 (migration 110). A count of TURNS, never people - the taste
          has no follower at all, so unlike the line above this one carries
          no anonymity floor and always renders the real number. */}
      <p className="ops-board__empty">{tasteTurns.note}</p>
      {/* WS-R85 (migration 122). The share kit's own breakdown - one line
          per channel, same floor, so a stalled `share_arrivals_this_week`
          line does not hide that a creator's WhatsApp copy is actually
          working. Fixed order matches api/_share-kit.js's SHARE_KIT_CHANNELS. */}
      <p className="ops-board__empty">{shareKitArrivals.channels.whatsapp.note}</p>
      <p className="ops-board__empty">{shareKitArrivals.channels.instagram.note}</p>
      <p className="ops-board__empty">{shareKitArrivals.channels.youtube.note}</p>
      <p className="ops-board__empty">{shareKitArrivals.channels.telegram.note}</p>
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
  const { t } = useStudioLocale();
  const o = t.ops;
  const deliveries = Object.entries(room.deliveries_last_24h);
  const deliveredCount = room.deliveries_last_24h.delivered ?? 0;
  return (
    <div className="ops-board__room">
      <div className="ops-board__room-head">
        <h3>{room.display_name || room.slug}</h3>
        <span className="ops-board__slug">/r/{room.slug}</span>
        <span className={badgeClassForOutcome(room.published ? "ok" : "partial")}>
          {room.published ? o.rooms.published : o.rooms.notPublished}
        </span>
        <span className={badgeClassForDrift(room.drift_state)}>
          {fillTemplate(o.rooms.voicePrefixTemplate, { label: o.rooms.driftState[room.drift_state] })}
        </span>
      </div>
      <div className="ops-board__stats">
        <Stat label={o.rooms.stat.followers} value={room.followers_total} />
        <Stat label={o.rooms.stat.paidFollowers} value={room.followers_paid} />
        <Stat label={o.rooms.stat.joinedLast7d} value={room.joined_last_7d} />
        <Stat label={o.rooms.stat.messagesLast24h} value={room.messages_last_24h} />
        <Stat label={o.rooms.stat.atCapThisMonth} value={room.at_cap_this_month} />
        <Stat label={o.rooms.stat.voiceSecondsThisMonth} value={room.voice_seconds_this_month} />
        <Stat label={o.rooms.stat.activeCheckIns} value={room.active_check_ins} />
        <Stat label={o.rooms.stat.checkInsDeliveredLast24h} value={deliveredCount} />
        <Stat label={o.rooms.stat.pulseOptIns} value={room.pulse_opt_ins} />
        <Stat label={o.rooms.stat.latestPulseWeek} value={room.latest_pulse_week ?? o.rooms.latestPulseWeekNone} />
        <Stat label={o.rooms.stat.activeSubscriptions} value={room.subscriptions.active} />
        <Stat label={o.rooms.stat.revenueThisMonth} value={inr(room.revenue_this_month_inr, o.currencyPrefix)} />
      </div>
      {deliveries.length > 1 && (
        <p className="ops-board__slug" style={{ marginTop: "var(--space-row)" }}>
          {o.rooms.deliveriesPrefix}
          {deliveries.map(([state, n]) => `${state.replace(/_/g, " ")} ${n}`).join(", ")}
        </p>
      )}
    </div>
  );
}

function SweepsStrip({ sweeps }: { sweeps: OpsSweep[] }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  return (
    <div className="ops-board__panel">
      <h2>{o.sweeps.title}</h2>
      {/* WS-R25: closes WS-R21's own open item ("the heartbeat table needs a
          retention delete before Phase 1") by saying the window out loud
          rather than leaving the retention invisible on the one screen that
          reads this table. */}
      <p className="ops-board__slug">{o.sweeps.retentionNote}</p>
      {/* WS-R135: the SAME two-scroll-box fix as `PhaseGateCard`'s own
          table (above `formatAgo`) - `tabIndex={0}` on both this table
          and its wrapping div, one keyboard path per width. */}
      <div style={{ overflowX: "auto" }} tabIndex={0}>
        <table className="ops-board__table" tabIndex={0}>
          <thead>
            <tr>
              <th>{o.sweeps.tableSweep}</th>
              <th>{o.sweeps.tableSchedule}</th>
              <th>{o.sweeps.tableLastRan}</th>
              <th>{o.sweeps.tableOutcome}</th>
              <th>{o.sweeps.tableFreshness}</th>
            </tr>
          </thead>
          <tbody>
            {sweeps.map((s) => (
              <tr key={s.sweep}>
                <td>{s.sweep}</td>
                <td>{s.schedule ?? o.sweeps.noSchedule}</td>
                <td>{formatAgo(s.last_started_at, o.ago)}</td>
                <td><span className={badgeClassForOutcome(s.last_outcome)}>{o.outcome[s.last_outcome]}</span></td>
                <td><span className={badgeClassForStaleness(s.staleness)}>{o.staleness[s.staleness]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// WS-R58 (migration 109). "Make failure a row" - last 7 days by kind and
// door, `none` an honest empty state (law 3's own word, restated as the
// same `ops-board__empty` copy every other card here already uses for
// "nothing yet"), red only for a kind not seen in the 7 days before this
// window - `badgeClassForOutcome`'s `--stopped` class one card over, the
// same red every failed sweep already renders in, never a new color.
function IncidentsCard({ incidents }: { incidents: OpsIncidents }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  return (
    <div className="ops-board__panel">
      <h2>{o.incidents.title}</h2>
      <p className="ops-board__slug">{o.incidents.subtitle}</p>
      {/* WS-R123, law 4: the derived door count as this card's own
          denominator - a completeness badge (`api/_incidents.js
          #OBSERVED_DOOR_COUNT` on both sides), never a live count, so it
          reads "18 of 18" whether or not any door has ever failed.
          WS-R135: a copy function of the two numbers, both locales, rather
          than the English-only interpolation this badge shipped with. */}
      <p className="ops-board__slug">
        <span className="ops-board__badge ops-board__badge--running">
          {fillTemplate(o.incidents.doorsObservedTemplate, { a: incidents.doors_observed, b: incidents.doors_total })}
        </span>
      </p>
      {incidents.by_kind_door.length === 0 ? (
        <p className="ops-board__empty">{o.incidents.none}</p>
      ) : (
        <div style={{ overflowX: "auto" }} tabIndex={0}>
          {/* WS-R135: the SAME two-scroll-box fix as `PhaseGateCard`'s own
              table above - `tabIndex={0}` on both this table and its
              wrapping div, one keyboard path per width. */}
          <table className="ops-board__table" tabIndex={0}>
            <thead>
              <tr>
                <th>{o.incidents.tableKind}</th>
                <th>{o.incidents.tableDoor}</th>
                <th>{o.incidents.tableCount}</th>
              </tr>
            </thead>
            <tbody>
              {incidents.by_kind_door.map((row) => {
                const isNew = incidents.new_kinds.includes(row.kind);
                return (
                  <tr key={`${row.kind}:${row.door}`}>
                    <td>
                      <span className={isNew ? "ops-board__badge ops-board__badge--stopped" : "ops-board__badge ops-board__badge--running"}>
                        {row.kind.replace(/_/g, " ")}
                      </span>
                      {isNew && <span className="ops-board__slug"> {o.incidents.newSinceLastWeek}</span>}
                    </td>
                    <td>{row.door}</td>
                    <td>{row.count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// WS-R76 (migration 120). "The ops board gains a Self-check line: last run,
// checks passed, the names of the failing ones" - the workstream brief's
// own words. `badgeClassForOutcome`/`badgeClassForStaleness` are reused
// unchanged from the Sweeps strip above - `api/_ops.js`'s own
// `selfCheckOverview` types `last_outcome`/`staleness` as the SAME
// `SweepOutcome`/`SweepStaleness` shapes, so this card's badges can never
// render a color the Sweeps strip does not already use for the same word.
function SelfCheckCard({ selfCheck }: { selfCheck: OpsSelfCheck }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  return (
    <div className="ops-board__panel">
      <h2>{o.selfCheck.title}</h2>
      <p className="ops-board__slug">{o.selfCheck.subtitle}</p>
      <p>
        {fillTemplate(o.selfCheck.lastRanPrefixTemplate, { label: formatAgo(selfCheck.last_started_at, o.ago) })}
        <span className={badgeClassForOutcome(selfCheck.last_outcome)}>{o.outcome[selfCheck.last_outcome]}</span>{" "}
        <span className={badgeClassForStaleness(selfCheck.staleness)}>{o.staleness[selfCheck.staleness]}</span>
      </p>
      <p className="ops-board__slug">
        {fillTemplate(o.selfCheck.countsTemplate, { checked: selfCheck.checked, passed: selfCheck.passed, failed: selfCheck.failed })}
      </p>
      {selfCheck.failing_checks.length === 0 ? (
        <p className="ops-board__empty">{o.selfCheck.none}</p>
      ) : (
        <ul>
          {selfCheck.failing_checks.map((door) => (
            <li key={door}>
              <span className="ops-board__badge ops-board__badge--stopped">{door}</span>
            </li>
          ))}
        </ul>
      )}
      {selfCheck.optional_absent.length > 0 && (
        <div className="ops-board__self-check-optional">
          <p className="ops-board__slug">
            {fillTemplate(o.selfCheck.optionalAbsentTemplate, {
              n: selfCheck.optional_absent.length,
              s: selfCheck.optional_absent.length === 1 ? "" : "s",
            })}
          </p>
          {/* WS-R116. `docs/gurukul/ENV-MANIFEST.md`'s own ~90 names grouped
              by section - counts closed, names on expand, a native
              <details>/<summary> pair so the toggle is keyboard-reachable
              with no extra JS (`docs/gurukul/DESIGN-LAW.md`'s own
              "interruptible, no bespoke widget where a native one already
              does the job" restated). Section titles and names are the
              manifest's own server-side strings (`copy.ts#OpsCopy`'s own
              header): read straight through, never routed through this
              table. */}
          {selfCheck.optional_absent_by_section.sections.map((section) => (
            <details key={section.section} className="ops-board__self-check-section">
              <summary>
                {section.sectionTitle} ({section.names.length})
              </summary>
              <p className="ops-board__slug">{section.names.join(", ")}</p>
            </details>
          ))}
          {selfCheck.optional_absent_by_section.ungrouped.length > 0 && (
            <details className="ops-board__self-check-section">
              <summary>{fillTemplate(o.selfCheck.other, { n: selfCheck.optional_absent_by_section.ungrouped.length })}</summary>
              <p className="ops-board__slug">{selfCheck.optional_absent_by_section.ungrouped.join(", ")}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// WS-R62 (migration 114). "The person running Phase 0 should learn that a
// door started failing from their phone, not from opening Vercel"
// (workstream brief). Reuses `/push-sw.js` - the SAME generic, already-
// committed, already-reviewed display worker `src/notify/push.ts` registers
// for Meera's own account-wide push - rather than a second service worker
// this workstream would have to write and review from scratch. It works
// unmodified because `api/_incidents.js`'s own operator payload is shaped
// as exactly the `{title, body, kind, route}` flat JSON that worker's own
// `push` handler already expects (`const data = d.data || d;` falls
// through to the payload itself when it carries no `data` wrapper) - see
// that file's own header for the full argument.
function PushAlertsCard({ token, push }: { token: string; push: OpsPushConfig }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  const [subscribed, setSubscribed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!push.configured) {
      setChecked(true);
      return;
    }
    let live = true;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
        const existing = await registration?.pushManager.getSubscription();
        if (live) setSubscribed(Boolean(existing));
      } catch {
        // Unsupported browser (no serviceWorker/PushManager) - the control
        // below renders its own "not supported here" state from `busy`/
        // `error` never being set, `AccountPage.tsx`'s own posture for the
        // identical case one surface over.
      } finally {
        if (live) setChecked(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [push.configured]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(false);
    try {
      if (subscribed) {
        const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          await revokeOpsPush(token, existing.endpoint);
          await existing.unsubscribe();
        }
        setSubscribed(false);
      } else {
        if (!push.vapid_public) return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("push_unsupported");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("push_denied");
        const registration = await navigator.serviceWorker.register("/push-sw.js");
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64uToUint8Array(push.vapid_public),
          }));
        const endpoint = subscription.endpoint;
        const p256dh = bufToB64u(subscription.getKey("p256dh"));
        const auth = bufToB64u(subscription.getKey("auth"));
        await subscribeOpsPush(token, endpoint, p256dh, auth);
        setSubscribed(true);
      }
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [subscribed, push.vapid_public, token]);

  return (
    <div className="ops-board__panel">
      <h2>{o.push.title}</h2>
      {!push.configured ? (
        <p className="ops-board__empty">{o.push.notConfigured}</p>
      ) : (
        <>
          <p className="ops-board__slug">{o.push.description}</p>
          <button type="button" disabled={busy || !checked} onPointerDown={toggle}>
            {subscribed ? o.push.turnOff : o.push.turnOn}
          </button>
          {error && <p className="ops-board__error">{o.push.error}</p>}
        </>
      )}
    </div>
  );
}

// WS-R88 (migration 125). "The ops board shows 'Last digest' with its sent
// time and a 'Send a test digest now' operator op" - the workstream brief's
// own words. `PushAlertsCard`'s own busy/error posture restated: a test
// send is a POST on the SAME `/api/ops` door, and its own result never
// changes `digest.sent_at` (workstream law 4: "writes no ledger row"), so
// this card's own "Last digest" line is deliberately never optimistically
// updated by a successful test send - only a real overview refresh moves
// it, which is the honest reflection of what the ledger actually recorded.
function DigestCard({ token, digest }: { token: string; digest: OpsDigest }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"sent" | "none" | "error" | null>(null);

  const sendTest = useCallback(async () => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await sendTestOpsDigest(token);
      setResult(outcome.pushed > 0 ? "sent" : "none");
    } catch {
      setResult("error");
    } finally {
      setBusy(false);
    }
  }, [token]);

  return (
    <div className="ops-board__panel">
      <h2>{o.digest.title}</h2>
      <p className="ops-board__slug">{o.digest.description}</p>
      <p>{fillTemplate(o.digest.lastPushTemplate, { label: formatAgo(digest.sent_at, o.ago) })}</p>
      {/* WS-R98, workstream law #3: "the ops board's digest card shows both
          channels' last delivery." Telegram's own line reads honestly - see
          api/_ops.js's own digestTelegramOverview header on why "never" here
          can mean "not this run", not "never in this Room's history". */}
      <p>
        {o.digest.lastTelegramPrefix}
        {!digest.telegram.configured
          ? o.digest.telegramNotSetUp
          : digest.telegram.last_sent_count > 0
            ? fillTemplate(o.digest.telegramSentTemplate, {
                label: formatAgo(digest.telegram.last_run_at, o.ago),
                n: digest.telegram.last_sent_count,
                s: digest.telegram.last_sent_count === 1 ? "" : "s",
              })
            : o.digest.telegramNever}
      </p>
      <button type="button" disabled={busy} onPointerDown={sendTest}>
        {busy ? o.digest.sending : o.digest.sendTest}
      </button>
      {result === "sent" && <p className="ops-board__slug">{o.digest.sent}</p>}
      {result === "none" && <p className="ops-board__slug">{o.digest.none}</p>}
      {result === "error" && <p className="ops-board__error">{o.digest.error}</p>}
    </div>
  );
}

// WS-R103 (no migration). "A count on the ops board" (this workstream's own
// law 2) plus `reconcilePeriod`'s own `charges_without_receipt` (law 3) -
// two platform-wide totals, neither a follower nor a Room, so neither needs
// the anonymity floor `FunnelCard`'s own growth lines carry. Zero on both,
// any time after the daily sweep has run, is the proof the backfill caught
// up - the workstream brief's own words.
function ReceiptsCard({
  receiptsLate,
  reconciliation,
}: {
  receiptsLate: OpsReceiptsLate;
  reconciliation: OpsReconciliation;
}) {
  const { t } = useStudioLocale();
  const o = t.ops;
  return (
    <div className="ops-board__panel">
      <h2>{o.receipts.title}</h2>
      <div className="ops-board__stats">
        <Stat label={o.receipts.issuedLate} value={receiptsLate.issued} />
        <Stat label={o.receipts.chargesWithoutReceipt} value={reconciliation.charges_without_receipt} />
      </div>
    </div>
  );
}

function OpsBoardInner({ onSwitchLocale }: { onSwitchLocale: (next: StudioLocale) => void }) {
  const { t } = useStudioLocale();
  const o = t.ops;
  const [session, setSession] = useState<StudioSession | null>(null);
  const [checkedSession, setCheckedSession] = useState(false);
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [loading, setLoading] = useState(false);
  // `notHere` covers both an unconfigured board and a signed-in non-operator
  // - the API answers 404 for both, on purpose, and this screen keeps that
  // same non-disclosure rather than telling the two apart client-side.
  const [notHere, setNotHere] = useState(false);
  // WS-R135: which of the two error messages this screen can show, never
  // the rendered string itself - a language switch mid-error must not leave
  // a stale-locale sentence on screen.
  const [errorKind, setErrorKind] = useState<"load" | "signin" | null>(null);

  useEffect(() => {
    restoreSession().then((restored) => {
      setSession(restored);
      setCheckedSession(true);
    });
  }, []);

  const load = useCallback(async (current: StudioSession) => {
    setLoading(true);
    setErrorKind(null);
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
        setErrorKind("load");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) load(session);
  }, [session, load]);

  if (!checkedSession) return <div className="ops-board ops-board__loading">{o.loading}</div>;

  if (!session) {
    return (
      <div className="ops-board">
        <div className="ops-board__signin">
          <OpsLanguageSwitch onSwitch={onSwitchLocale} />
          <h1 className="ops-board__title">{o.title}</h1>
          <p>{o.signIn.prompt}</p>
          <button
            type="button"
            onPointerDown={() => {
              googleSignIn(RETURN_PATH).catch(() => setErrorKind("signin"));
            }}
          >
            {o.signIn.button}
          </button>
          {errorKind === "signin" && <p className="ops-board__error">{o.signIn.error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="ops-board">
      <div className="ops-board__head">
        <div>
          <h1 className="ops-board__title">{o.title}</h1>
          {overview && <p className="ops-board__meta">{fillTemplate(o.generatedTemplate, { label: formatAgo(overview.generated_at, o.ago) })}</p>}
        </div>
        <OpsLanguageSwitch onSwitch={onSwitchLocale} />
        <button
          type="button"
          className="ops-board__refresh"
          disabled={loading}
          onPointerDown={() => load(session)}
        >
          {loading ? o.refreshing : o.refresh}
        </button>
      </div>
      <div className="ops-board__body">
        {notHere && <p className="ops-board__empty">{o.notAvailable}</p>}
        {errorKind === "load" && !notHere && <p className="ops-board__error">{o.loadError}</p>}
        {loading && !overview && !notHere && errorKind !== "load" && <p className="ops-board__loading">{o.loading}</p>}
        {overview && (
          <>
            <div className="ops-board__panel">
              <h2>{o.rooms.title}</h2>
              {overview.rooms.length === 0 ? (
                <p className="ops-board__empty">{o.rooms.empty}</p>
              ) : (
                overview.rooms.map((room) => <RoomCard key={room.room_id} room={room} />)
              )}
            </div>
            <FunnelCard
              funnel={overview.funnel}
              shareArrivals={overview.share_arrivals_this_week}
              tasteTurns={overview.taste_turns_this_week}
              posterArrivals={overview.poster_arrivals_this_week}
              shareKitArrivals={overview.share_kit_arrivals_this_week}
              friendArrivals={overview.friend_arrivals_this_week}
            />
            <PhaseGateCard gate={overview.phase_gate} />
            <SweepsStrip sweeps={overview.sweeps} />
            <SelfCheckCard selfCheck={overview.self_check} />
            <IncidentsCard incidents={overview.incidents} />
            <PushAlertsCard token={session.accessToken} push={overview.push} />
            <DigestCard token={session.accessToken} digest={overview.digest} />
            <ReceiptsCard receiptsLate={overview.receipts_issued_late_this_week} reconciliation={overview.reconciliation} />
          </>
        )}
      </div>
    </div>
  );
}

/** `?lang=` wins, else the remembered local choice, else "en" -
 *  `studioLocalePreference.ts`'s own chain with `replica: null` throughout:
 *  an operator has no `vy_replica` row for any step of the chain to read. */
function resolveOpsLocale(): StudioLocale {
  try {
    const raw = new URLSearchParams(window.location.search).get("lang");
    const urlLocale: StudioLocale | null = raw === "hi" ? "hi" : raw === "en" ? "en" : null;
    return resolveStudioLocale({ urlLocale, replica: null, rememberedLocale: readRememberedStudioLocale() });
  } catch {
    return "en";
  }
}

export default function OpsBoard() {
  const [locale, setLocale] = useState<StudioLocale>(() => resolveOpsLocale());

  // `src/room/RoomApp.tsx`'s own line, same reason: this page's chrome
  // locale is a client-side fact `studio.html`'s static `lang="en"` cannot
  // know at build time.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const switchLocale = useCallback(
    (next: StudioLocale) => {
      if (next === locale) return;
      // Remembered regardless of sign-in state, `StudioApp.tsx`'s own
      // `switchLocale` precedent: an operator has no replica row for this
      // page to write the choice to, so the local remembered choice is the
      // only durable record there is.
      writeRememberedStudioLocale(next);
      setLocale(next);
    },
    [locale],
  );

  return (
    <StudioLocaleProvider locale={locale}>
      <OpsBoardInner onSwitchLocale={switchLocale} />
    </StudioLocaleProvider>
  );
}
