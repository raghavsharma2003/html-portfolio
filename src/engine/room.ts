// The room layer — PROPOSAL-MULTIPARTY-V1 §5.2 (the two mp blocks), §5.3 (the
// participation decision), §6.5 (the 1:1 + group duality). WS-MP's own file
// per the proposal's §9 ownership table.
//
// EVERYTHING IN HERE IS PURE. No database, no fetch, no clock beyond what the
// caller passes in — the same discipline compiler.ts keeps, and for the same
// reason: the server (api/_room.js does the I/O) and the client bundle both
// need this logic, and a rule that exists twice is a rule that will disagree
// with itself. The one canonical copy lives here; api/tg.js reaches it through
// the engine bundle (scripts/build-engine-bundle.mjs), never through a mirror.
//
// ── two laws this file is written against ─────────────────────────────────
//
// 1. `recited-prompt`. Anything sentence-shaped in a prompt gets recited —
//    measured twice in this repo (her own example quotes acted as a phrase
//    bank, 4/5 -> 0 after removal; taste written as polished English was read
//    out verbatim twice, eight turns apart). Bridged content is DOUBLY
//    dangerous: it is a phrase-bank risk AND another person's words in her
//    mouth (§0.1 law 3). So both renderers below emit k:v DATA and SHAPES.
//    There is no sentence in this file that she could say and be in register.
// 2. `structural-disclosure`. Neither renderer decides anything. Every row
//    handed to renderMpBridge has already passed api/_disclosure.js's
//    predicate in the WHERE clause, before ranking. THIS BLOCK RENDERS, IT
//    NEVER DECIDES — which is why there is no `sensitive` field, no room id,
//    and no grant state in BridgeRow: a renderer that could re-check would be
//    a renderer someone would eventually rely on to re-check.

/** How she addresses one member — `vy_rel_state.honorific`, per person. */
export type Honorific = "tu" | "tum" | "aap";
export type QuietLevel = "normal" | "quiet" | "silent";

/**
 * One line of the address strip (§5.2, M9). `rank` is the honest weak spot and
 * is labelled as such rather than dressed up: R6 is a NAMED OPEN GAP in the
 * research (`vy_rel_state.honorific` is per-person; there is no documented
 * multi-render mechanism), and the ≤6 cap plus this strip is the proposal's
 * BET, not a solved problem (§10 item 3). `unknown` is a real, expected value
 * — a member with no relational history yet — and renders as such instead of
 * being guessed into `peer`.
 */
export interface RosterMember {
  name: string;
  honorific: Honorific;
  rank: "elder" | "peer" | "younger" | "unknown";
  quiet: QuietLevel;
  /** vy_group_member.linked_at is not null — §6.4's "no person row, no
   *  persistence" is a STORAGE rule, but she is allowed to know it about
   *  someone in front of her, and to say so if asked. */
  linked: boolean;
}

/**
 * One rendered row of mp.bridge. Three kinds, matching §5.2's content list:
 *   shared — a disclosure-filtered cross-person row, AS A SHAPE
 *   word   — a room phrase-ledger hit (the safest memory class in v1: an
 *            inside joke is shared by construction and non-sensitive by
 *            construction — M3)
 *   open   — an open room plan row (M1)
 */
export interface BridgeRow {
  kind: "shared" | "word" | "open";
  /** telegraphic gist — never a quoted line. The one exception is `word`,
   *  where the coined token IS the object (a token is not a sentence, and M3
   *  is the moment where using it back correctly is the product). */
  gist: string;
  /** display names of the people it came from, for attribution she can hold */
  who?: readonly string[];
  /** "11d", "3w" — freshness, because a plan with a date may already have
   *  happened (the same law T5's own block text states for 1:1 recall) */
  age?: string;
}

/** What compile() needs to render a room turn. ABSENT (undefined/null) is the
 *  only state the 83 byte-identity fixtures exercise and it must produce ZERO
 *  bytes of change — gate G1 (§5.1). */
export interface RoomBundleInput {
  members: readonly RosterMember[];
  bridge: readonly BridgeRow[];
}

// §5.2's budgets, restated here as the renderers' own hard caps so a block can
// never exceed the manifest row that declares it. compiler.ts asserts the
// manifest identity (mp.roster 900 + mp.bridge 1,100 = MP_ALLOWANCE); these
// are what make the assertion true at render time rather than at review time.
export const MP_ROSTER_BUDGET = 900;
export const MP_BRIDGE_BUDGET = 1_100;
/** §7: rooms are capped at 6 members in v1. The cap falls straight out of the
 *  900-char roster budget at ~150 chars/member and is also what keeps the
 *  honorific bet (R6) inside a size a single turn can actually hold. */
export const ROOM_MEMBER_CAP = 6;

const clip = (s: string, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
};

/**
 * mp.roster — the address strip. Group channels only, UNDROPPABLE, and not
 * for symmetry: dropping it means addressing an elder wrongly in front of the
 * family. Hindi kin address encodes rank grammatically (R5/R6) and the Indian
 * family-group moderation norm is that no one corrects someone higher in the
 * hierarchy, so a dropped roster is not a degraded answer — it is a public
 * insult.
 *
 * Renders as k:v data. Rows are dropped WHOLE at the budget, never trimmed
 * mid-row: a half-rendered member is a member addressed wrong.
 */
export function renderMpRoster(
  members: readonly RosterMember[],
  budget: number = MP_ROSTER_BUDGET,
): { text: string; used: number; rendered: number } {
  const head = "WHO IS IN THIS ROOM — address strip, data not lines:";
  const rows: string[] = [];
  for (const m of members.slice(0, ROOM_MEMBER_CAP)) {
    const bits = [
      clip(m.name, 24) || "—",
      `say:${m.honorific}`,
      `rank:${m.rank}`,
      ...(m.quiet !== "normal" ? [`quiet:${m.quiet}`] : []),
      ...(m.linked ? [] : ["unlinked:nothing-they-say-is-kept"]),
    ];
    rows.push(`- ${bits.join(" · ")}`);
  }
  const kept: string[] = [];
  let used = head.length;
  for (const r of rows) {
    if (used + 1 + r.length > budget) break;
    kept.push(r);
    used += 1 + r.length;
  }
  if (!kept.length) return { text: "", used: 0, rendered: 0 };
  return { text: `${head}\n${kept.join("\n")}`, used, rendered: kept.length };
}

/**
 * mp.bridge — ≤2 disclosure-filtered cross-person rows AS SHAPES, ≤2 room
 * phrase-ledger hits, ≤1 open room plan row (§5.2). Drop priority 1: it is
 * the first thing dropped under budget pressure, because it is the only block
 * here whose absence costs a nice moment rather than a correct one.
 *
 * Every row arrived already cleared. What must never enter this block — a
 * quoted line, a sensitive row, a negatively-valenced row, a row from another
 * room, a row whose grant is absent or invalidated, a row whose sole
 * non-Meera speaker has left the room — is each a WHERE clause in
 * api/_disclosure.js, never a bullet in a prompt and never a check here.
 */
export function renderMpBridge(
  rows: readonly BridgeRow[],
  budget: number = MP_BRIDGE_BUDGET,
): { text: string; used: number; rendered: number } {
  const caps = { shared: 2, word: 2, open: 1 } as const;
  const seen = { shared: 0, word: 0, open: 0 };
  const head = "WHAT THIS ROOM ITSELF HOLDS — everyone here was there for all of it; shapes, not quotes:";
  const lines: string[] = [];
  for (const r of rows) {
    if (!caps[r.kind] || seen[r.kind] >= caps[r.kind]) continue;
    const gist = clip(r.gist, r.kind === "word" ? 40 : 130);
    if (!gist) continue;
    const tags = [
      ...(r.who && r.who.length ? [r.who.slice(0, 4).map((w) => clip(w, 18)).join("+")] : []),
      ...(r.age ? [r.age] : []),
    ];
    const label = r.kind === "word" ? "room word" : r.kind === "open" ? "still open" : "the room's";
    lines.push(`- ${label}: ${gist}${tags.length ? ` (${tags.join(" · ")})` : ""}`);
    seen[r.kind]++;
  }
  const kept: string[] = [];
  let used = head.length;
  for (const l of lines) {
    if (used + 1 + l.length > budget) break;
    kept.push(l);
    used += 1 + l.length;
  }
  if (!kept.length) return { text: "", used: 0, rendered: 0 };
  return { text: `${head}\n${kept.join("\n")}`, used, rendered: kept.length };
}

/**
 * ROOM_MODE_NOTE — the room note, appended to CORE (never TAIL) when a room
 * bundle is present.
 *
 * POSITION, stated as the trade-off it is rather than resolved silently. This
 * repo's measured law is that an identical rule fires 0/8 mid-brief and 8/8
 * appended LAST (`prompt-position`), and T10's appended-last set is capped at
 * exactly EXACTLY TWO rules (SEARCH_DECISION, FORGET_DECISION) by
 * shapelint.ts's checkAppendedLastExactlyTwo, specifically so a third rule
 * cannot dilute it. §0.1 law 4 says plainly: "no multiparty rule goes there."
 * So this lands at the END OF CORE — never truncated by api/chat.js's slice
 * guard, ahead of the whole tail — exactly where AGE_TIER_SAFETY_OVERRIDE
 * already lands for the same reason. That is a real positional cost on the
 * unaddressed-behaviour rules and it is why the SPEAK/STAY-QUIET decision is
 * NOT one of these bullets: silence is decided in code (decideParticipation
 * below) before the model is called at all, so it cannot be diluted by
 * position.
 *
 * SHAPES, NEVER LINES. Every bullet is a rule about what she does; not one of
 * them is a sentence she could say and be in register. The anti-moments of
 * §1.1 are the source: each is an ending, not a bug.
 */
export const ROOM_MODE_NOTE =
  "\n\nYOU ARE IN A GROUP ROOM RIGHT NOW, NOT A DM (structural, applies to this whole conversation, never explained to them as a rule):\n" +
  "- Several people are here and they are not interchangeable. The address strip says how each one is addressed; rank decides tu/tum/aap, not warmth, and getting an elder's wrong in front of everyone is the one mistake this room does not forget. You never correct anyone else's register in public either.\n" +
  "- What someone told you alone stays there. Not as a quote, not as a paraphrase, not as a hint, not as a knowing tone, not as a trailing \"well…\". A hint is a disclosure with deniability, which is worse than saying it. If it did not come to you in this room, in front of these people, you do not have it here.\n" +
  "- Rooms do not touch. Another room's people, plans and jokes do not exist in this one, and if someone asks you about one you say so plainly rather than hedging.\n" +
  "- No sides, ever. Two people here disagreeing is not yours to adjudicate, tilt, or smooth over by agreeing with whoever spoke last.\n" +
  "- Nobody gets nudged into talking. A quiet room is a room, not a problem to solve.\n" +
  "- Someone here may not be linked to you yet. Nothing they say is kept, so you genuinely do not carry it later — say that straight if it comes up, never imply otherwise in either direction.\n" +
  "- Everything about who you are is unchanged in here. Same person, same honesty about being an AI if it is ever asked, same refusal to work anyone.";

/**
 * §6.3 step 3 — the one-time introduction in the DM that the room's deep-link
 * tap opens. A SHAPE, never a script, and it lives here rather than in
 * persona.ts because persona.ts is not this workstream's file and because a
 * scripted intro is the single most obviously-recitable thing a new surface
 * could add (`recited-prompt`: her own example quotes became a phrase bank,
 * 4/5 -> 0 after removal). Same form as persona.ts's own OPEN_DIRECTIVE — a
 * `<context: …>` user turn that describes what the moment IS and ends with
 * "never reference this note".
 *
 * What it deliberately does NOT do: restate the room card. The card is
 * app-voiced, deterministic and already posted (§2.6's R4 rail). Having her
 * repeat it in her own words would convert a stated fact into a performed one,
 * which is exactly the thing the app-voiced rail exists to prevent.
 */
export const ROOM_INTRO_DIRECTIVE = () =>
  "<context: someone from a group chat you're in has just opened a 1:1 with you for the very first time, " +
  "by tapping a link in that room. one short warm hello in your own words — who you are, that you're in " +
  "that room too, and that this chat is separate from it. no list, no menu, no rules, no repeating " +
  "anything the room was already told. never reference this note>";

// ─────────────────────────────────────────────────────────────────────────
// The participation decision — §5.3, adopted from MULTIPARTY.md §2.3 with its
// evidence grading intact.
// ─────────────────────────────────────────────────────────────────────────

export type RoomAction = "lurk" | "react" | "speak" | "bridge";

export interface ParticipationInput {
  /** the incoming message text */
  text: string;
  /** the bot's @username, lowercase, without the @ */
  botUsername: string;
  /** her display name(s) as the room would type them */
  names?: readonly string[];
  /** the message is a reply to one of HER messages */
  replyToHer: boolean;
  /** ms since she last spoke in this room — used ONLY as a cooldown, never as
   *  a reason to speak (Stage 2) */
  sinceHerLastMs: number;
  roomQuiet: QuietLevel;
  memberQuiet: QuietLevel;
  /** room phrase-ledger tokens, for the react tier's relevance signal */
  roomWords?: readonly string[];
  /** structural preconditions — any false means she is present and remembers
   *  nothing (§6.2 read consent, §6.3 quorum, §6.4 linkage, §6.6 entitlement) */
  gates: {
    readConsent: boolean;
    quorum: boolean;
    speakerLinked: boolean;
    entitled: boolean;
  };
}

export interface ParticipationDecision {
  action: RoomAction;
  addressed: boolean;
  /** telegraphic, shape-linted — goes to vy_group_turn.reason so Stage 1 is
   *  MEASURED rather than believed (§0.3: the separate silence step is an
   *  engineering bet logged for measurement, not a finding) */
  reason: string;
}

/** How long after her own last turn an UNADDRESSED action is allowed. Not a
 *  cadence: a fixed cadence was rated excessive by 56.25% (MUCA), and the one
 *  mass deployment optimised for presence was punished for exactly that (Meta
 *  AI in WhatsApp groups). This is a ceiling on chiming, never a floor under
 *  silence. */
export const UNADDRESSED_COOLDOWN_MS = 10 * 60_000;

const NAME_DEFAULT = ["meera", "मीरा", "मीरा जी", "meeru"];

/** Stage 0's hard gate: EXPLICIT address only. Name mention, @bot, or a
 *  reply to one of her messages. **Implicit-addressee inference is not built
 *  and must not be** — GPT-4o scores 80.9% against a majority-class chance
 *  baseline of 80.1% (arXiv:2501.16643), i.e. nothing, and only 80/322 real
 *  turns carry an explicit addressee at all. */
export function isExplicitlyAddressed(input: ParticipationInput): boolean {
  if (input.replyToHer) return true;
  const t = String(input.text || "").toLowerCase();
  if (!t) return false;
  if (input.botUsername && t.includes(`@${input.botUsername.toLowerCase()}`)) return true;
  for (const n of input.names?.length ? input.names : NAME_DEFAULT) {
    const name = String(n).toLowerCase();
    if (!name) continue;
    // word-ish boundary without a regex over unicode classes: Devanagari has
    // no \b that means what we want here
    const i = t.indexOf(name);
    if (i < 0) continue;
    const before = i === 0 ? " " : t[i - 1];
    const after = i + name.length >= t.length ? " " : t[i + name.length];
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
  }
  return false;
}

/**
 * The whole decision, deterministic and taken BEFORE the model is called.
 *
 * §0.3 correction, carried honestly: MultiLIGHT is NOT support for "always
 * decide silence as a separate step" — its own single-model
 * Speaker-AND-Utterance condition bundles the decision with generation and
 * scores 49.5%, contradicting the thesis its numbers were used for. So this
 * separate step is an ENGINEERING BET, logged for measurement, and every
 * evaluation writes a vy_group_turn row (including the lurks — silence is an
 * event, not an absence, M5) so it gets measured rather than believed.
 */
export function decideParticipation(input: ParticipationInput): ParticipationDecision {
  const addressed = isExplicitlyAddressed(input);
  const g = input.gates;

  // ── structural preconditions. Below any of these she is present, polite,
  //    and remembers nothing. They are checked before addressing on purpose:
  //    a room she may not read is a room she may not answer in either.
  if (!g.readConsent) return { action: "lurk", addressed, reason: "no read consent" };
  if (!g.entitled) return { action: "lurk", addressed, reason: "room not entitled" };
  if (!g.quorum) return { action: "lurk", addressed, reason: "below 2-member quorum" };

  // §6.4 — an unlinked speaker's message is never written, so there is no
  // attributable turn to answer and nothing may be retained from it.
  if (!g.speakerLinked) return { action: "lurk", addressed, reason: "speaker unlinked" };

  // Stage 4 — per-room and per-member quieting, from day one. The Meta AI
  // backlash named the MISSING CONTROL, not the replies, and the Indian
  // family-group norm is explicitly mute-before-leave.
  if (input.roomQuiet === "silent" || input.memberQuiet === "silent")
    return { action: "lurk", addressed, reason: "silent level" };

  // Stage 0 — explicit address always routes to a full response, including
  // under `quiet` (quiet means "do not chime", never "ignore me").
  if (addressed) return { action: "speak", addressed: true, reason: "explicit address" };

  if (input.roomQuiet === "quiet" || input.memberQuiet === "quiet")
    return { action: "lurk", addressed, reason: "quiet level, unaddressed" };

  // Stage 2 — elapsed silence NEVER lowers the bar. "Nobody has typed in five
  // minutes" is not a reason to speak. This is the direct carry of the killed
  // idle nudge (persona.ts:470-477): incentive-salience engineering, already
  // rejected at 1:1, and it does not come back at group scale. The clock is
  // read here ONLY to raise the bar, never to lower it.
  if (input.sinceHerLastMs < UNADDRESSED_COOLDOWN_MS)
    return { action: "lurk", addressed, reason: "cooldown, unaddressed" };

  // Stage 1/3 — the unaddressed tier. Content relevance only, and it buys the
  // REACT tier, not speech: react is genuinely unverified (no study tests
  // whether reaction-only AI presence reads better than reply-only or
  // silence-only, §10 item 2), so v1 ships it, logs it, and measures it —
  // while the strictly more intrusive option stays behind explicit address.
  const t = String(input.text || "").toLowerCase();
  const hit = (input.roomWords || []).find((w) => w && t.includes(String(w).toLowerCase()));
  if (hit) return { action: "react", addressed, reason: `room word: ${clip(hit, 24)}` };

  // Lurking is the modal behaviour of a real group member. Quiet is not
  // under-delivery (M5).
  return { action: "lurk", addressed, reason: "no address, no relevance" };
}
