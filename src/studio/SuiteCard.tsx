// The Suite card (WS-R28). Account-level: a creator's own Suites (an
// organisation that pays for seats, one seat per Room), never a follower.
// Self-contained on the same `CheckinsCard.tsx` precedent: it owns its own
// fetch/create/attach state rather than threading yet more `useState`s
// through `RoomStudio.tsx`'s already-large hook graph, and it fails closed
// on its own - a creator who cannot see this card can still publish and run
// their Room without a Suite at all.
import { useCallback, useEffect, useState } from "react";
import {
  createSuite,
  inviteToSuite,
  acceptSuiteInvite,
  attachRoomToSuite,
  detachRoomFromSuite,
  listMySuites,
  suiteMembers,
  OrgApiError,
  type MySuite,
  type SuiteMember,
} from "./orgApi";

const NAME_MAX = 120;

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
      setNotice("Suite created. You are its admin.");
    } catch (e) {
      setError(readableError(e, "could not create this Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, nameDraft, planDraft, seatDraft, load]);

  const invite = useCallback(
    async (orgId: string) => {
      setBusy(`invite-${orgId}`);
      setError("");
      setNotice("");
      try {
        const inv = await inviteToSuite(token, orgId);
        setNotice(`Share this Suite's id with the creator: ${inv.org_id}. ${inv.instructions}`);
      } catch (e) {
        setError(readableError(e, "could not prepare an invite"));
      } finally {
        setBusy(null);
      }
    },
    [token],
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
      setNotice("You have joined this Suite as a creator.");
    } catch (e) {
      setError(readableError(e, "could not join this Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, joinOrgId, load]);

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
        setNotice("This Room is now part of the Suite.");
      } catch (e) {
        setError(readableError(e, "could not attach this Room"));
      } finally {
        setBusy(null);
      }
    },
    [token, roomId, load, onRoomSuiteChange],
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
      setNotice("This Room is no longer part of that Suite.");
    } catch (e) {
      setError(readableError(e, "could not remove this Room from its Suite"));
    } finally {
      setBusy(null);
    }
  }, [token, roomId, load, onRoomSuiteChange]);

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

  return (
    <article className="teacher-sheet-card vy-room__suite-card">
      <h3>Suites</h3>
      <p className="field-note">
        A Suite is an organisation that pays for seats - one seat per Room. Create one to bring several Rooms
        (a coach, a teacher, a doctor) under one roster; an admin sees only counts for each Room, never what a
        follower said.
      </p>

      {suites && suites.length > 0 && (
        <ul className="vy-room__suite-list">
          {suites.map((s) => (
            <li key={s.org_id} className="vy-room__suite-row">
              <div className="vy-room__suite-row-head">
                <span className="vy-room__suite-name">{s.name}</span>
                <span className="vy-room__suite-seats">
                  {s.seats_used} of {s.seat_limit} seats used - {s.role === "admin" ? "you administer this Suite" : "you are a member"}
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
                      {busy === `invite-${s.org_id}` ? "Working..." : "Invite a creator"}
                    </button>
                    <button
                      className="button secondary-button"
                      type="button"
                      onPointerDown={() => void toggleMembers(s.org_id)}
                    >
                      {openMembers === s.org_id ? "Hide members" : "Show members"}
                    </button>
                    {roomId && roomOrgId !== s.org_id && (
                      <button
                        className="button primary-button"
                        type="button"
                        disabled={busy === `attach-${s.org_id}` || Boolean(roomOrgId) || s.seats_used >= s.seat_limit}
                        onPointerDown={() => void attach(s.org_id)}
                      >
                        {busy === `attach-${s.org_id}`
                          ? "Working..."
                          : s.seats_used >= s.seat_limit
                            ? "No seat free"
                            : "Attach this Room"}
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
                    {busy === "detach" ? "Working..." : "Remove this Room from this Suite"}
                  </button>
                )}
              </div>
              {openMembers === s.org_id && (
                members ? (
                  <ul className="vy-room__suite-members">
                    {members.map((m) => (
                      <li key={m.owner_user_id}>{m.role === "admin" ? "Admin" : "Creator"} - {m.owner_user_id}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="field-note" role="status">Loading members.</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {suites && suites.length === 0 && (
        <p className="field-note">No Suites yet. Create one below, or join one a Suite admin invited you to.</p>
      )}

      <label className="field-label" htmlFor="suite-name">New Suite name</label>
      <input
        id="suite-name"
        className="field"
        value={nameDraft}
        maxLength={NAME_MAX}
        placeholder="North Coaching"
        onChange={(event) => setNameDraft(event.target.value)}
      />
      <label className="field-label" htmlFor="suite-plan">Plan</label>
      <select
        id="suite-plan"
        className="field"
        value={planDraft}
        onChange={(event) => setPlanDraft(event.target.value === "institute" ? "institute" : "starter")}
      >
        <option value="starter">Starter</option>
        <option value="institute">Institute</option>
      </select>
      <label className="field-label" htmlFor="suite-seats">Seats</label>
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
        {busy === "create" ? "Saving..." : "Create Suite"}
      </button>

      <label className="field-label" htmlFor="suite-join">Join a Suite (paste the id an admin shared with you)</label>
      <div className="vy-room__suite-join">
        <input
          id="suite-join"
          className="field"
          value={joinOrgId}
          placeholder="Suite id"
          onChange={(event) => setJoinOrgId(event.target.value)}
        />
        <button
          className="button secondary-button"
          type="button"
          disabled={busy === "join" || !joinOrgId.trim()}
          onPointerDown={() => void join()}
        >
          {busy === "join" ? "Working..." : "Join"}
        </button>
      </div>

      {notice && <p className="field-note" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
