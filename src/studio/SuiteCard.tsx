// The Suite card (WS-R28). Account-level: a creator's own Suites (an
// organisation that pays for seats, one seat per Room), never a follower.
// Self-contained on the same `CheckinsCard.tsx` precedent: it owns its own
// fetch/create/attach state rather than threading yet more `useState`s
// through `RoomStudio.tsx`'s already-large hook graph, and it fails closed
// on its own - a creator who cannot see this card can still publish and run
// their Room without a Suite at all.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSuite,
  inviteToSuite,
  acceptSuiteInvite,
  attachRoomToSuite,
  detachRoomFromSuite,
  listMySuites,
  suiteMembers,
  suiteSubscription,
  startSuiteSubscription,
  updateSuiteSeats,
  cancelSuiteSubscription,
  OrgApiError,
  type MySuite,
  type Suite,
  type SuiteMember,
  type SuiteSubscription,
} from "./orgApi";
// WS-R48. "Start a Suite" on site/suites.html: a name and a seat count that
// have to survive a sign-in round trip land here as a stored draft; this
// card is where they turn into an actual Suite, reusing `createSuite`/
// `startSuiteSubscription` above verbatim - never a second write path.
import { takeStartSuiteDraft } from "./startSuiteDraft";
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel } from "./copy";

const NAME_MAX = 120;
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
/** Mirrors api/_payments.js's own PLATFORM_TAKE_BP_DEFAULT (2500 = 25.00%) -
 *  shown as the same one number every other money card in this studio
 *  already quotes, never a second figure invented for the Suite lane. */
const PLATFORM_TAKE_PERCENT = 25;

function readableError(e: unknown, fallback: string): string {
  return e instanceof OrgApiError ? e.code.replaceAll("_", " ") : fallback;
}

export default function SuiteCard({
  token,
  roomId,
  roomOrgId,
  onRoomSuiteChange,
}: {
  token: string;
  /** The currently open Room's own id, or null before a Room has been
   *  created - "attach this Room" has nothing to attach until then. */
  roomId: string | null;
  /** The Suite (if any) this Room already belongs to, from the Room's own
   *  status read - so this card and the Room card's "Part of <Suite>" line
   *  can never disagree about the current state. */
  roomOrgId: string | null;
  /** Fired after a successful attach/detach so the Room card above can
   *  refresh its own "Part of <Suite>" line without a second poll. */
  onRoomSuiteChange?: (orgId: string | null) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.suite;
  const mandate = t.suiteSeatLock;
  const [suites, setSuites] = useState<MySuite[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [planDraft, setPlanDraft] = useState<"starter" | "institute">("starter");
  const [seatDraft, setSeatDraft] = useState(1);
  const [openMembers, setOpenMembers] = useState<string | null>(null);
  const [members, setMembers] = useState<SuiteMember[] | null>(null);
  const [joinOrgId, setJoinOrgId] = useState("");
  const [openMoney, setOpenMoney] = useState<string | null>(null);
  // undefined: not loaded yet (show "Loading money"). null: loaded, no
  // subscription exists yet. A SuiteSubscription: loaded and real.
  const [subscription, setSubscription] = useState<SuiteSubscription | null | undefined>(undefined);
  const [seatEditDraft, setSeatEditDraft] = useState(1);
  // WS-R48. null: nothing to auto-start, or already finished. Otherwise the
  // two-step self-serve flow's own progress, shown while it runs.
  const [autoStart, setAutoStart] = useState<"creating" | "starting" | null>(null);

  const load = useCallback(async () => {
    try {
      setSuites(await listMySuites(token));
    } catch (e) {
      setError(readableError(e, "could not load your Suites"));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  // WS-R48. "Start a Suite" self-serve: a draft waiting in localStorage (see
  // startSuiteDraft.ts's own header for why it is not a URL param by now)
  // becomes a real Suite the moment this card mounts, whether that is
  // straight off the marketing page or after a sign-in redirect brought the
  // visitor back here. `consumed` guards React StrictMode's double-invoke in
  // development - `takeStartSuiteDraft()` already removes the draft from
  // storage as it reads it, so a REAL second mount (a route change, not
  // StrictMode) also runs this at most once, since the second call finds
  // nothing left to take.
  const consumed = useRef(false);
  useEffect(() => {
    if (consumed.current) return;
    const draft = takeStartSuiteDraft();
    if (!draft) return;
    consumed.current = true;
    void (async () => {
      setAutoStart("creating");
      setError("");
      setNotice("");
      let org: Suite;
      try {
        org = await createSuite(token, { name: draft.name, plan: draft.plan, seatLimit: draft.seats });
        await load();
      } catch (e) {
        setAutoStart(null);
        setError(readableError(e, "could not start this Suite automatically"));
        return;
      }
      // Law 2's own words: "nothing new is charged: the provider is none or
      // fake until the owner sets Razorpay." A provider that is not
      // configured yet is not a failed Suite - it is created either way, and
      // its admin starts the subscription later from the SAME "Start Suite
      // subscription" control this card already ships (WS-R28), so a
      // provider failure here is reported gently rather than as an error.
      setAutoStart("starting");
      try {
        await startSuiteSubscription(token, org.org_id, draft.plan, draft.seats);
        await load();
        setNotice(c.autoStartLiveStarted.split("{name}").join(draft.name));
      } catch {
        setNotice(c.autoStartLivePending.split("{name}").join(draft.name));
      } finally {
        setAutoStart(null);
      }
    })();
  }, [token, load, c.autoStartLiveStarted, c.autoStartLivePending]);

  const create = useCallback(async () => {
    const name = nameDraft.trim();
    if (!name) return;
    setBusy("create");
    setError("");
    setNotice("");
    try {
      await createSuite(token, { name, plan: planDraft, seatLimit: seatDraft });
      setNameDraft("");
      await load();
      setNotice(c.noticeCreated);
    } catch (e) {
      setError(readableError(e, "could not create this Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, nameDraft, planDraft, seatDraft, load, c.noticeCreated]);

  const invite = useCallback(
    async (orgId: string) => {
      setBusy(`invite-${orgId}`);
      setError("");
      setNotice("");
      try {
        const inv = await inviteToSuite(token, orgId);
        // `inv.instructions` is server-authored and stays English -- copy.ts's
        // own header names this exception.
        setNotice(`${c.inviteNotice.split("{orgId}").join(inv.org_id)} ${inv.instructions}`);
      } catch (e) {
        setError(readableError(e, "could not prepare an invite"));
      } finally {
        setBusy(null);
      }
    },
    [token, c.inviteNotice],
  );

  const join = useCallback(async () => {
    const orgId = joinOrgId.trim();
    if (!orgId) return;
    setBusy("join");
    setError("");
    setNotice("");
    try {
      await acceptSuiteInvite(token, orgId);
      setJoinOrgId("");
      await load();
      setNotice(c.noticeJoined);
    } catch (e) {
      setError(readableError(e, "could not join this Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, joinOrgId, load, c.noticeJoined]);

  const attach = useCallback(
    async (orgId: string) => {
      if (!roomId) return;
      setBusy(`attach-${orgId}`);
      setError("");
      setNotice("");
      try {
        await attachRoomToSuite(token, orgId, roomId);
        await load();
        onRoomSuiteChange?.(orgId);
        setNotice(c.noticeAttached);
      } catch (e) {
        setError(readableError(e, "could not attach this Room"));
      } finally {
        setBusy(null);
      }
    },
    [token, roomId, load, onRoomSuiteChange, c.noticeAttached],
  );

  const detach = useCallback(async () => {
    if (!roomId) return;
    setBusy("detach");
    setError("");
    setNotice("");
    try {
      await detachRoomFromSuite(token, roomId);
      await load();
      onRoomSuiteChange?.(null);
      setNotice(c.noticeDetached);
    } catch (e) {
      setError(readableError(e, "could not remove this Room from its Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, roomId, load, onRoomSuiteChange, c.noticeDetached]);

  const toggleMembers = useCallback(
    async (orgId: string) => {
      if (openMembers === orgId) {
        setOpenMembers(null);
        return;
      }
      setOpenMembers(orgId);
      setMembers(null);
      try {
        setMembers(await suiteMembers(token, orgId));
      } catch (e) {
        setError(readableError(e, "could not load members"));
      }
    },
    [token, openMembers],
  );

  const toggleMoney = useCallback(
    async (orgId: string, seats_used: number) => {
      if (openMoney === orgId) {
        setOpenMoney(null);
        return;
      }
      setOpenMoney(orgId);
      setSubscription(undefined);
      try {
        const sub = await suiteSubscription(token, orgId);
        setSubscription(sub);
        setSeatEditDraft(Math.max(sub?.seats ?? seats_used, seats_used, 1));
      } catch (e) {
        setError(readableError(e, "could not load this Suite's money"));
      }
    },
    [token, openMoney],
  );

  const startMoney = useCallback(
    async (orgId: string, plan: "starter" | "institute", seats: number) => {
      setBusy(`start-money-${orgId}`);
      setError("");
      setNotice("");
      try {
        const sub = await startSuiteSubscription(token, orgId, plan, seats);
        setSubscription(sub);
        setNotice(c.noticeSubscriptionStarted);
      } catch (e) {
        setError(readableError(e, "could not start this Suite's subscription"));
      } finally {
        setBusy(null);
      }
    },
    [token, c.noticeSubscriptionStarted],
  );

  const addSeat = useCallback(
    async (orgId: string, seats: number) => {
      setBusy(`seats-${orgId}`);
      setError("");
      setNotice("");
      try {
        const sub = await updateSuiteSeats(token, orgId, seats);
        setSubscription(sub);
        await load();
        setNotice(c.noticeSeatsUpdated);
      } catch (e) {
        // WS-R73: Razorpay refuses this outright on a UPI/Emandate
        // subscription (api/_payments.js's updateOrgSeats, named
        // org_seats_locked_by_mandate) - named separately from every other
        // failure so the admin reads the actual path forward, not a
        // reason-code with its underscores turned to spaces.
        setError(
          e instanceof OrgApiError && e.code === "org_seats_locked_by_mandate"
            ? mandate.seatsLockedByMandate
            : readableError(e, "could not update seats"),
        );
      } finally {
        setBusy(null);
      }
    },
    [token, load, c.noticeSeatsUpdated, mandate.seatsLockedByMandate],
  );

  // WS-R37: cancel at period end - never immediately, api/_renewals.js's own
  // law. Every attached Room keeps its seat until the date shown; only
  // `cancel_at_period_end` changes.
  const cancelMoney = useCallback(
    async (orgId: string) => {
      setBusy(`cancel-money-${orgId}`);
      setError("");
      setNotice("");
      try {
        const sub = await cancelSuiteSubscription(token, orgId);
        setSubscription(sub);
        setNotice(c.noticeWillNotRenewSimple);
      } catch (e) {
        setError(readableError(e, "could not cancel this Suite's subscription"));
      } finally {
        setBusy(null);
      }
    },
    [token, c.noticeWillNotRenewSimple],
  );

  return (
    <article className="teacher-sheet-card vy-room__suite-card">
      <h3>{c.title}</h3>
      <p className="field-note">
        {c.intro}
      </p>

      {autoStart && (
        <p className="field-note" role="status">
          {autoStart === "creating" ? c.creating : c.starting}
        </p>
      )}

      {suites && suites.length > 0 && (
        <ul className="vy-room__suite-list">
          {suites.map((s) => (
            <li key={s.org_id} className="vy-room__suite-row">
              <div className="vy-room__suite-row-head">
                <span className="vy-room__suite-name">{s.name}</span>
                <span className="vy-room__suite-seats">
                  {withCount(
                    s.role === "admin" ? c.seatsUsedAdmin : c.seatsUsedMember,
                    s.seats_used,
                  ).split("{n2}").join(String(s.seats_paid))}
                </span>
              </div>
              <div className="vy-room__suite-actions">
                {s.role === "admin" && (
                  <>
                    <button
                      className="button secondary-button"
                      type="button"
                      disabled={busy === `invite-${s.org_id}`}
                      onPointerDown={() => void invite(s.org_id)}
                    >
                      {busy === `invite-${s.org_id}` ? c.working : c.inviteCreator}
                    </button>
                    <button
                      className="button secondary-button"
                      type="button"
                      onPointerDown={() => void toggleMembers(s.org_id)}
                    >
                      {openMembers === s.org_id ? c.hideMembers : c.showMembers}
                    </button>
                    <button
                      className="button secondary-button"
                      type="button"
                      onPointerDown={() => void toggleMoney(s.org_id, s.seats_used)}
                    >
                      {openMoney === s.org_id ? c.hideMoney : c.showMoney}
                    </button>
                    {roomId && roomOrgId !== s.org_id && (
                      <button
                        className="button primary-button"
                        type="button"
                        disabled={busy === `attach-${s.org_id}` || Boolean(roomOrgId) || s.seats_used >= s.seats_paid}
                        onPointerDown={() => void attach(s.org_id)}
                      >
                        {busy === `attach-${s.org_id}`
                          ? c.working
                          : s.seats_used >= s.seats_paid
                            ? c.noSeatFree
                            : c.attachThisRoom}
                      </button>
                    )}
                  </>
                )}
                {roomId && roomOrgId === s.org_id && (
                  <button
                    className="button secondary-button"
                    type="button"
                    disabled={busy === "detach"}
                    onPointerDown={() => void detach()}
                  >
                    {busy === "detach" ? c.working : c.removeFromSuite}
                  </button>
                )}
              </div>
              {openMembers === s.org_id && (
                members ? (
                  <ul className="vy-room__suite-members">
                    {members.map((m) => (
                      <li key={m.owner_user_id}>{m.role === "admin" ? c.memberAdmin : c.memberCreator} - {m.owner_user_id}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-note" role="status">{c.loadingMembers}</p>
                )
              )}
              {openMoney === s.org_id && (
                subscription !== undefined ? (
                  <div className="vy-room__suite-money">
                    {subscription ? (
                      <>
                        <p className="field-note">
                          {c.seatsAtPrice
                            .split("{n}").join(String(subscription.seats))
                            .split("{label}").join(inr(subscription.price_per_seat_inr))
                            .split("{label2}").join(subscription.state)}
                        </p>
                        {subscription.state === "active" && subscription.current_period_end && (
                          <p className="field-note">
                            {subscription.cancel_at_period_end
                              ? withLabel(c.willNotRenew, new Date(subscription.current_period_end).toLocaleDateString())
                              : c.nextCharge
                                .split("{label}").join(inr(subscription.seats * subscription.price_per_seat_inr))
                                .split("{label2}").join(new Date(subscription.current_period_end).toLocaleDateString())}
                          </p>
                        )}
                        <p className="field-note">{withCount(c.platformTake, PLATFORM_TAKE_PERCENT)}</p>
                        {subscription.state === "active" && !subscription.cancel_at_period_end && (
                          <button
                            className="button secondary-button"
                            type="button"
                            disabled={busy === `cancel-money-${s.org_id}`}
                            onPointerDown={() => void cancelMoney(s.org_id)}
                          >
                            {busy === `cancel-money-${s.org_id}` ? c.working : c.cancel}
                          </button>
                        )}
                        <div className="vy-room__cap-row" role="group" aria-label="Add seats">
                          <input
                            className="field vy-room__cap-field"
                            type="number"
                            min={1}
                            max={500}
                            value={seatEditDraft}
                            onChange={(event) => setSeatEditDraft(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
                          />
                          <button
                            className="button secondary-button"
                            type="button"
                            disabled={busy === `seats-${s.org_id}` || seatEditDraft === subscription.seats}
                            onPointerDown={() => void addSeat(s.org_id, seatEditDraft)}
                          >
                            {busy === `seats-${s.org_id}` ? c.working : c.updateSeats}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="field-note">{c.noSubscriptionYet}</p>
                        <p className="field-note">{withCount(c.platformTake, PLATFORM_TAKE_PERCENT)}</p>
                        {/* WS-R73: stated before checkout, not after a UPI mandate
                            has already locked the seat count. */}
                        <p className="field-note">{mandate.mandateNote}</p>
                        <button
                          className="button primary-button"
                          type="button"
                          disabled={busy === `start-money-${s.org_id}`}
                          onPointerDown={() => void startMoney(s.org_id, s.plan, Math.max(s.seats_used, 1))}
                        >
                          {busy === `start-money-${s.org_id}` ? c.working : c.startSubscription}
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="field-note" role="status">{c.loadingMoney}</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {suites && suites.length === 0 && (
        <p className="field-note">{c.noSuitesYet}</p>
      )}

      <label className="field-label" htmlFor="suite-name">{c.newSuiteName}</label>
      <input
        id="suite-name"
        className="field"
        value={nameDraft}
        maxLength={NAME_MAX}
        placeholder={c.namePlaceholder}
        onChange={(event) => setNameDraft(event.target.value)}
      />
      <label className="field-label" htmlFor="suite-plan">{c.plan}</label>
      <select
        id="suite-plan"
        className="field"
        value={planDraft}
        onChange={(event) => setPlanDraft(event.target.value === "institute" ? "institute" : "starter")}
      >
        <option value="starter">{c.planStarter}</option>
        <option value="institute">{c.planInstitute}</option>
      </select>
      <label className="field-label" htmlFor="suite-seats">{c.seats}</label>
      <input
        id="suite-seats"
        className="field"
        type="number"
        min={1}
        max={500}
        value={seatDraft}
        onChange={(event) => setSeatDraft(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
      />
      <button
        className="button primary-button"
        type="button"
        disabled={busy === "create" || !nameDraft.trim()}
        onPointerDown={() => void create()}
      >
        {busy === "create" ? c.saving : c.createSuite}
      </button>

      <label className="field-label" htmlFor="suite-join">{c.joinSuite}</label>
      <div className="vy-room__suite-join">
        <input
          id="suite-join"
          className="field"
          value={joinOrgId}
          placeholder={c.joinPlaceholder}
          onChange={(event) => setJoinOrgId(event.target.value)}
        />
        <button
          className="button secondary-button"
          type="button"
          disabled={busy === "join" || !joinOrgId.trim()}
          onPointerDown={() => void join()}
        >
          {busy === "join" ? c.working : c.join}
        </button>
      </div>

      {notice && <p className="field-note" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
