// India state — SPEC §8 (india.md §7 adopted as spec). WS-RELSTATE, M4.
// Ownership (SPEC §13): this file belongs to WS-RELSTATE exclusively.
//
// §8's placement rule, restated as the reason this file is shaped the way
// it is: "Dynamic fields live inside the relationship state (honorific,
// cs_ratio, cs_on_stress...)" — those three already live in relstate.ts
// (vy_rel_state), NOT here, on purpose; this file owns the four
// STRUCTURED, citation-carrying stores that sit beside rel-state and feed
// T3: `vy_kin`, `vy_ritual`, `vy_currency`, `vy_india_profile`. Same
// client-bundle discipline as relstate.ts (see that file's header): every
// DB-facing function takes a `QueryFn` parameter, nothing here imports
// api/_db.js or api/_config.js.
import { lintBlock } from "./shapelint";
import type { QueryFn, RenderResult } from "./relstate";
// Mirrored constant, not a second source of truth — see relstate.ts's own note
// on why this is imported from there rather than from agents/registry.
import { MEERA_AGENT_ID } from "./relstate";

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/schema.sql migration 004 (WS-SCHEMA, already live).
// ─────────────────────────────────────────────────────────────────────────

export interface KinRow {
  id: number;
  person_id: string;
  name: string;
  relation: string; // role-labeled: chachi != mausi != bua
  fictive: boolean;
  address_term: string;
  citations: number[];
}

export interface RitualRow {
  person_id: string;
  key: string; // khana_khaya|good_morning|match_checkin
  last_at: string | null;
  count: number;
  cold_last: boolean;
  citations: number[];
}

export interface CurrencyRow {
  person_id: string;
  topic: string;
  kind: string; // cricket|food|place|film|festival
  last_used: string | null;
  uses: number;
  citations: number[];
}

export interface IndiaProfile {
  person_id: string;
  mother_tongue: string | null;
  home_region: string | null;
  religion: unknown | null; // opt-in only, DPDP-sensitive
  family_structure: unknown | null;
  dietary: string | null;
  sensitive_consent: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────
// Kin graph — cited (vy_kin CHECK requires >=1 citation).
// ─────────────────────────────────────────────────────────────────────────

export interface WriteKinInput {
  person_id: string;
  name: string;
  relation: string;
  fictive?: boolean;
  address_term?: string;
  citations: number[];
}

/** Address term "learned once" per §8's table row — upsert on
 * (person_id, lower(name)) so a re-mention updates relation/address_term
 * rather than creating a duplicate row for the same person, matching the
 * unique index WS-SCHEMA already ships (db/schema.sql `vy_kin_ix`). */
export async function writeKin(
  q: QueryFn,
  input: WriteKinInput,
  agentId: string = MEERA_AGENT_ID,
): Promise<number> {
  if (!input.citations || input.citations.length < 1) {
    throw new Error(`vy_kin requires >=1 citation (${input.name} for ${input.person_id})`);
  }
  const rows = await q(
    `insert into vy_kin (person_id, agent_id, name, relation, fictive, address_term, citations)
     values ($1,($7)::uuid,$2,$3,$4,$5,$6)
     on conflict (agent_id, person_id, lower(name)) do update set
       relation = excluded.relation,
       fictive = excluded.fictive,
       address_term = coalesce(nullif(excluded.address_term, ''), vy_kin.address_term),
       citations = (select array(select distinct unnest(vy_kin.citations || excluded.citations))),
       updated_at = now()
     returning id`,
    [input.person_id, input.name, input.relation, input.fictive ?? false, input.address_term ?? "", input.citations, agentId],
  );
  return Number(rows[0]?.id);
}

// ─────────────────────────────────────────────────────────────────────────
// Rituals — "freshness = last_at data, not prompt pleading" (§8). Staleness
// for free: a ritual with an old last_at simply stops being "due" without
// anyone deleting or re-writing anything — decay by data shape, matching
// this repo's one proven mechanism (structural guarantees over prompt text).
// ─────────────────────────────────────────────────────────────────────────

/** >=20h spacing (§8's own number) between two prompt-eligible occurrences
 *  of the SAME ritual — a "good morning" check-in due again 3h after the
 *  last one is not freshness, it's nagging. */
export const RITUAL_MIN_SPACING_H = 20;

export interface DueRitual {
  key: string;
  hoursSinceLast: number | null;
}

/**
 * Pure: which of `rows` are "due" right now — never fetched, never data,
 * never skipped for a reason not visible in the row itself. A ritual with
 * `cold_last = true` (the last time it was raised the reception was cold,
 * a CITED event per the schema comment) is excluded until the writer
 * explicitly clears the flag — "goes-rote solved by data staleness, not
 * prompt pleading" (§8) applies to the SKIP direction too, not only the
 * due direction.
 */
export function dueRituals(rows: readonly RitualRow[], now: Date = new Date()): DueRitual[] {
  const out: DueRitual[] = [];
  for (const r of rows) {
    if (r.cold_last) continue;
    const hoursSinceLast = r.last_at ? (now.getTime() - new Date(r.last_at).getTime()) / 3_600_000 : null;
    if (hoursSinceLast === null || hoursSinceLast >= RITUAL_MIN_SPACING_H) {
      out.push({ key: r.key, hoursSinceLast });
    }
  }
  // most-overdue first (never-occurred rituals — hoursSinceLast === null —
  // sort last: a ritual that has never happened is not "more due" than one
  // stale for two weeks, it is simply untried)
  return out.sort((a, b) => {
    if (a.hoursSinceLast === null) return 1;
    if (b.hoursSinceLast === null) return -1;
    return b.hoursSinceLast - a.hoursSinceLast;
  });
}

/** Records one occurrence. `coldReception` (a cited event — `citation` is
 *  the establishing/observing episode) sets `cold_last`, which `dueRituals`
 *  then excludes on every future call until the NEXT warm occurrence clears
 *  it — matching the schema's own comment ("skipped after a cold
 *  reception... cold_last, a cited event"). */
export async function recordRitualOccurrence(
  q: QueryFn,
  personId: string,
  key: string,
  citation: number,
  coldReception = false,
  agentId: string = MEERA_AGENT_ID,
): Promise<void> {
  await q(
    `insert into vy_ritual (person_id, agent_id, key, last_at, count, cold_last, citations)
     values ($1,($5)::uuid,$2, now(), 1, $3, array[$4]::bigint[])
     on conflict (agent_id, person_id, key) do update set
       last_at = now(),
       count = vy_ritual.count + 1,
       cold_last = $3,
       citations = (select array(select distinct unnest(vy_ritual.citations || array[$4]::bigint[])))`,
    [personId, key, coldReception, citation, agentId],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Currency — topical freshness pool, 14-day reuse exclusion (§8).
// ─────────────────────────────────────────────────────────────────────────

export const CURRENCY_REUSE_EXCLUSION_DAYS = 14;
const CURRENCY_MAX_FRESH = 2; // T3's own cap: "≤2 fresh currency rows"

/** Pure: rows not used in the last 14 days, freshest-eligible first (least
 *  recently used wins, so the pool rotates rather than favoring whichever
 *  topic happens to sort first). Never-used rows (last_used null) are
 *  eligible immediately — nothing to exclude yet. */
export function pickFreshCurrency(rows: readonly CurrencyRow[], now: Date = new Date()): CurrencyRow[] {
  const eligible = rows.filter((r) => {
    if (!r.last_used) return true;
    const days = (now.getTime() - new Date(r.last_used).getTime()) / 86_400_000;
    return days >= CURRENCY_REUSE_EXCLUSION_DAYS;
  });
  return eligible
    .sort((a, b) => {
      const at = a.last_used ? new Date(a.last_used).getTime() : 0;
      const bt = b.last_used ? new Date(b.last_used).getTime() : 0;
      return at - bt;
    })
    .slice(0, CURRENCY_MAX_FRESH);
}

export async function writeCurrencyUse(
  q: QueryFn,
  personId: string,
  topic: string,
  kind: string,
  citation: number | null,
  agentId: string = MEERA_AGENT_ID,
): Promise<void> {
  await q(
    `insert into vy_currency (person_id, agent_id, topic, kind, last_used, uses, citations)
     values ($1,($5)::uuid,$2,$3, now(), 1, $4)
     on conflict (agent_id, person_id, topic) do update set
       last_used = now(), uses = vy_currency.uses + 1,
       citations = case when $4 = '{}'::bigint[] then vy_currency.citations
                        else (select array(select distinct unnest(vy_currency.citations || $4))) end`,
    [personId, topic, kind, citation === null ? [] : [citation], agentId],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Festival calendar — "authored region-keyed repo file (culture pattern) ×
// home_region + observed set" (§8). Authored, not fetched — same shape as
// inner.ts's TASTE table and culture.ts's own recognition-index pattern:
// a small reviewed table, matched deterministically, never generated at
// runtime. Coverage here is deliberately not exhaustive (a two-person team
// cannot author every regional calendar in one pass); rows are the major
// pan-India + large-population-region festivals, extend by adding rows,
// never by inferring one at runtime.
// ─────────────────────────────────────────────────────────────────────────

export interface FestivalRow {
  name: string;
  regions: readonly string[]; // home_region values this festival is salient for; "all" = pan-India
  month: number; // 1-12, approximate (many are lunar and drift; window logic below is generous on purpose)
  windowDays: number; // days before/after `month`'s 15th this festival is "in window"
}

export const FESTIVAL_CALENDAR: readonly FestivalRow[] = [
  { name: "diwali", regions: ["all"], month: 10, windowDays: 20 },
  { name: "holi", regions: ["all"], month: 3, windowDays: 10 },
  { name: "raksha bandhan", regions: ["all"], month: 8, windowDays: 7 },
  { name: "eid", regions: ["all"], month: 4, windowDays: 10 }, // lunar drift is real; window kept wide
  { name: "durga puja", regions: ["west bengal", "bengal"], month: 10, windowDays: 12 },
  { name: "ganesh chaturthi", regions: ["maharashtra"], month: 9, windowDays: 10 },
  { name: "onam", regions: ["kerala"], month: 9, windowDays: 10 },
  { name: "pongal", regions: ["tamil nadu"], month: 1, windowDays: 7 },
  { name: "baisakhi", regions: ["punjab"], month: 4, windowDays: 5 },
  { name: "navratri", regions: ["all"], month: 10, windowDays: 10 },
  { name: "karva chauth", regions: ["north india", "delhi", "punjab", "up", "uttar pradesh"], month: 10, windowDays: 5 },
  { name: "christmas", regions: ["all"], month: 12, windowDays: 7 },
];

/** Pure: which festival (at most one — the closest window center) is
 *  currently "in window" for `homeRegion`, or null. Never claims to know
 *  the exact lunar date; T3 renders it as a WINDOW note, not a countdown
 *  (§8: "T3 window note"). */
export function currentFestivalWindow(homeRegion: string | null, now: Date = new Date()): FestivalRow | null {
  const region = (homeRegion || "").toLowerCase().trim();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  let best: { row: FestivalRow; distanceDays: number } | null = null;
  for (const row of FESTIVAL_CALENDAR) {
    if (!row.regions.includes("all") && !row.regions.includes(region)) continue;
    const center = new Date(now.getFullYear(), row.month - 1, 15);
    const distanceDays = Math.abs((now.getTime() - center.getTime()) / 86_400_000);
    if (distanceDays <= row.windowDays) {
      if (!best || distanceDays < best.distanceDays) best = { row, distanceDays };
    }
  }
  void month;
  void day;
  return best ? best.row : null;
}

// ─────────────────────────────────────────────────────────────────────────
// T3 `india.dynamic` — budget 1,000 chars (§3.2, §8). Content per the spec
// row: due rituals (freshness from last_at), festival window, ≤2 fresh
// currency rows. All values render as SHAPES ("honorific: tum (his choice,
// 3w)" is §8's OWN example for the sibling T2 field — the equivalent
// discipline applies here), never lines. Signature:
// `renderIndiaDynamic(rituals, homeRegion, currency, now?) => RenderResult`.
// ─────────────────────────────────────────────────────────────────────────

export function renderIndiaDynamic(
  rituals: readonly RitualRow[],
  homeRegion: string | null,
  currency: readonly CurrencyRow[],
  now: Date = new Date(),
): RenderResult {
  const lines: string[] = [];

  for (const r of dueRituals(rituals, now)) {
    const label = r.hoursSinceLast === null ? "never yet" : `${Math.round(r.hoursSinceLast / 24)}d since last`;
    lines.push(`ritual due: ${r.key} (${label})`);
  }

  const festival = currentFestivalWindow(homeRegion, now);
  if (festival) lines.push(`festival window: ${festival.name}`);

  for (const c of pickFreshCurrency(currency, now)) {
    lines.push(`currency: ${c.topic} (${c.kind})`);
  }

  const text = lines.length
    ? `INDIA CONTEXT (context only, never raise unprompted — a due ritual is not an instruction to perform it, just a note it exists):\n${lines
        .map((l) => `- ${l}`)
        .join("\n")}`
    : "";
  const lint = lintBlock(lines.join("\n"));
  const result: RenderResult = { text, lint: { clean: lint.clean, violations: lint.violations.length } };
  if (result.text.length > 1000) {
    return { ...result, lint: { ...result.lint, violations: result.lint.violations + 1 } };
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// India profile — statics, opt-in, DPDP-sensitive (§8, §9). Per-field
// consent receipts live in `sensitive_consent` (already the schema's own
// shape); this file only enforces that a sensitive field is never written
// without its receipt.
// ─────────────────────────────────────────────────────────────────────────

const SENSITIVE_FIELDS = ["religion", "family_structure"] as const;

export interface WriteIndiaProfileInput {
  person_id: string;
  mother_tongue?: string | null;
  home_region?: string | null;
  religion?: unknown;
  family_structure?: unknown;
  dietary?: string | null;
  /** consent receipt: {field: {at: ISOString, method: string}} — required
   *  for any of SENSITIVE_FIELDS present in this call. */
  consentReceipts?: Record<string, { at: string; method: string }>;
}

export async function writeIndiaProfile(
  q: QueryFn,
  input: WriteIndiaProfileInput,
  agentId: string = MEERA_AGENT_ID,
): Promise<void> {
  for (const field of SENSITIVE_FIELDS) {
    const touching = field in input && (input as unknown as Record<string, unknown>)[field] !== undefined;
    if (touching && !input.consentReceipts?.[field]) {
      throw new Error(`vy_india_profile.${field} is DPDP-sensitive and requires a consent receipt before write`);
    }
  }
  const existing = await q(
    `select sensitive_consent from vy_india_profile where person_id = $1 and agent_id = ($2)::uuid`,
    [input.person_id, agentId],
  );
  const mergedConsent = {
    ...(existing[0]?.sensitive_consent ?? {}),
    ...(input.consentReceipts ?? {}),
  };
  await q(
    `insert into vy_india_profile
       (person_id, agent_id, mother_tongue, home_region, religion, family_structure, dietary,
        sensitive_consent, updated_at)
     values ($1,($8)::uuid,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb, now())
     on conflict (agent_id, person_id) do update set
       mother_tongue = coalesce($2, vy_india_profile.mother_tongue),
       home_region = coalesce($3, vy_india_profile.home_region),
       religion = coalesce($4::jsonb, vy_india_profile.religion),
       family_structure = coalesce($5::jsonb, vy_india_profile.family_structure),
       dietary = coalesce($6, vy_india_profile.dietary),
       sensitive_consent = $7::jsonb,
       updated_at = now()`,
    [
      input.person_id,
      input.mother_tongue ?? null,
      input.home_region ?? null,
      input.religion === undefined ? null : JSON.stringify(input.religion),
      input.family_structure === undefined ? null : JSON.stringify(input.family_structure),
      input.dietary ?? null,
      JSON.stringify(mergedConsent),
      agentId,
    ],
  );
}
