// Cultural currency, client side — the PULL half of api/culture.js.
//
// The whole design rests on one asymmetry. A 24-year-old who does not know a
// meme loses nothing; she says "kaunsa wala?? links khulte nhi mere, description
// do 😭" and that is a real person's answer. A 24-year-old who works a meme in
// because she happened to have one available is unbearable, and no amount of
// "use it sparingly" in a prompt fixes that — a list of current things sitting
// in context reads to a model as material to deploy. Volume is the enemy;
// restraint and timing are the skill.
//
// So nothing from here is ever pushed at her. The index sits in memory, and
// exactly one thing consults it: `cultureNote(whatTheUserJustSaid)`. No match,
// nothing enters the prompt — which is the overwhelming majority of turns. A
// match appends ~30 tokens to the volatile tail saying what the thing IS,
// explicitly framed as something she has heard of and has NOT seen, with the
// term itself off-limits to repeat back. She therefore cannot raise any of it
// first. That is a structural guarantee rather than an instruction, which is
// the only kind that survives contact with a model.
//
// It also needs no exemption from the "you do not recognise things" rule in
// persona.ts: knowing OF a word is not claiming to have watched something.
// The injected text says so out loud.
//
// Everything here fails to nothing: no network at boot, a dead endpoint, an
// empty index, a stale index — all produce "" and she is exactly the Meera she
// is today.

import { Capacitor } from "@capacitor/core";
import { diag } from "./diag";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
const LS_KEY = "meera.culture.v1";
const REFRESH_MS = 6 * 3600_000; // the row changes once a day; this is slack
const MAX_AGE_MS = 60 * 3600_000; // matches the endpoint's own staleness ceiling
const MAX_INJECTED = 2; // two is already generous; more is a briefing

interface CultureItem {
  term: string;
  aliases: string[];
  gist: string;
  /** match forms, normalized and space-padded the same way the haystack is */
  keys: string[];
}
interface CultureIndex {
  day: string | null;
  items: CultureItem[];
  dated: string[];
  fetchedAt: number;
  stale?: boolean;
}

let index: CultureIndex | null = null;
let loading = false;
let lastRefreshKick = 0;

/**
 * Load today's index. Safe to call at app boot; safe never to call at all
 * (the first `cultureNote` triggers it in the background). Never awaited by
 * anything on the reply path.
 */
export async function primeCulture(): Promise<void> {
  if (loading) return;
  if (index && Date.now() - index.fetchedAt < REFRESH_MS) return;
  loading = true;
  try {
    if (!index) index = fromStorage();
    const res = await fetch(`${BASE}/api/culture`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const body = (await res.json()) as Partial<CultureIndex>;
    const next: CultureIndex = {
      day: typeof body.day === "string" ? body.day : null,
      items: sanitizeItems(body.items),
      dated: Array.isArray(body.dated) ? body.dated.filter((d) => typeof d === "string").slice(0, 6) : [],
      fetchedAt: Date.now(),
      stale: body.stale === true,
    };
    index = next;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* private mode / quota — memory copy is enough for this session */
    }
    diag("chat", "culture_index", { items: next.items.length, dated: next.dated.length, stale: !!next.stale });
    // The refresh is idempotent per day, so this costs one distillation pass
    // globally per day even if every client asks. It runs detached: nothing
    // on the reply path can ever wait on it.
    if (next.stale) kickRefresh();
  } catch {
    /* offline or slow — she is simply not updated today */
  } finally {
    loading = false;
  }
}

function kickRefresh() {
  if (Date.now() - lastRefreshKick < 6 * 3600_000) return;
  lastRefreshKick = Date.now();
  fetch(`${BASE}/api/culture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "refresh" }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => {});
}

/**
 * The only consumer of the index. Pure and local — a few dozen substring
 * checks, no network, no await — so it is safe to call in front of a reply.
 *
 * Returns "" (the normal case) or a short block to append to the VOLATILE
 * tail. Never the cached core: this varies per turn, and putting it in core
 * would invalidate the day-stable prompt cache on every message.
 */
export function cultureNote(userText: string): string {
  if (!index || Date.now() - index.fetchedAt > REFRESH_MS) {
    // fire-and-forget; this turn simply goes without, as it does today
    void primeCulture();
    if (!index) return "";
  }
  // Hard ceiling, independent of the endpoint's own. Stale IS the failure mode
  // for culture — a girl who half-knows last week's thing is the "fellow kids"
  // failure in its purest form, and going blank costs nothing.
  if (Date.now() - index.fetchedAt > MAX_AGE_MS) return "";
  const hay = pad(userText);
  if (hay.length < 6) return "";

  const hits: CultureItem[] = [];
  for (const it of index.items) {
    if (hits.length >= MAX_INJECTED) break;
    if (it.keys.some((k) => matches(hay, k))) hits.push(it);
  }
  if (!hits.length) return "";

  diag("chat", "culture_match", { n: hits.length, of: index.items.length });

  const lines = hits.map((h) => `- ${h.term}: ${h.gist}`).join("\n");
  // The dated list rides ONLY here, never on its own. Naming dead slang in the
  // prompt is mild negation priming, so it is paid for only in the one context
  // where the mistake it prevents is actually live — a conversation that is
  // already about internet things.
  const dated =
    index.dated.length > 0
      ? `\nWere everywhere a while back, read as try-hard now, not yours to reach for: ${index.dated.join(", ")}.`
      : "";

  return `\n\nSOMETHING THEY JUST MENTIONED — you have heard OF this, the way you hear of things without opening them:
${lines}
You have not watched or verified any of it and you never say you have. This is only here so you are not blank: react like someone who half-knows it, or ask ("wo kya h exactly?"). Never announce that you know it, never explain it back, never repeat the term to show you got it. Knowing less than them is normal. If you need an actual fact about it, check.${dated}`;
}

/** Everything the index currently holds — for tests and diagnostics only. */
export function cultureDebug(): CultureIndex | null {
  return index;
}

// A single-word key that is also an ordinary Hinglish word is a trap. The live
// index once carried "haare" (a song) and it fired on "rcb haare ya jeete aaj"
// and "match me hum haare" — 2 false fires in 40 ordinary messages. A false
// match is worse than a miss: it hands her a gist for something nobody
// mentioned, which is the fabrication direction, not the blankness direction.
// Multi-word keys are unaffected; only bare tokens are checked against this.
const COMMON = new Set(
  `haan haa nahi nhi naa yaar yar bhai bhaiya behen didi dost jaan dil pyaar pyar
   acha accha achha theek thik sahi galat bura mast badhiya zabardast
   kya kyu kyun kaise kaisa kaisi kaha kahan kab kaun kitna kitne kitni kuch kuchh
   sab sabhi abhi aaj kal parso subah shaam raat din time waqt
   mera meri mere tera teri tere uska uski unka apna apni hum tum aap main mujhe
   tujhe usko humko unko sabko
   karo karna kiya kiye karke hona hua hui huye gaya gayi gaye raha rahi rahe
   tha thi the hoga hogi honge chal chalo chala chali dekh dekha dekhi dekho
   suna suno sunn bola bolo bolna batao bata batana jaana jaao aana aaya aayi
   khana khaya khaana peena piya soya soja neend uth utha
   ghar office kaam paisa paise log logo baat baate baaten
   bahut bohot bhut thoda zyada jyada itna utna jitna kaafi bilkul ekdum ekdam
   haar haare haara jeet jeeta jeete jeeti khel khela match
   gaana gaane film movie picture phone message reply story status photo video
   reel reels insta scene shot clip
   matlab waise phir fir lekin magar agar toh tho bas sirf sath saath
   dhyan yaad bhool gussa khush dukh mood tension problem sorry thanks hello
   maa mummy papa pita family bacha bache
   love miss want need know think feel like just okay okey right left thing
   really about after before today tomorrow night morning`
    .split(/\s+/)
    .filter(Boolean),
);

/** " lowercase words only, space padded " — both sides of a match use this. */
const pad = (s: string) =>
  " " +
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

/** `key` arrives padded. Multi-word keys are always fine; bare tokens must be
 *  long enough and not be a word people use for something else entirely. */
function usableKey(key: string): boolean {
  const t = key.trim();
  if (t.length < 4) return false;
  if (t.includes(" ")) return true;
  return t.length >= 5 && !COMMON.has(t);
}

function matches(hay: string, key: string): boolean {
  // key is already padded, so this is a whole-word test: "aura" never fires
  // inside "auravana" and "mog" never fires inside "mogging"
  if (hay.includes(key)) return true;
  // the one inflection worth catching — people type "canon events"
  return hay.includes(key.slice(0, -1) + "s ");
}

function sanitizeItems(raw: unknown): CultureItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CultureItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const term = typeof o.term === "string" ? o.term.toLowerCase().trim() : "";
    const gist = typeof o.gist === "string" ? o.gist.trim() : "";
    if (term.length < 4 || !gist) continue;
    const aliases = Array.isArray(o.aliases)
      ? o.aliases
          .filter((a): a is string => typeof a === "string" && a.trim().length >= 4)
          .map((a) => a.toLowerCase().trim())
          .slice(0, 4)
      : [];
    const keys = [term, ...aliases].map(pad).filter(usableKey);
    if (!keys.length) continue;
    out.push({ term, aliases, gist: gist.slice(0, 140), keys });
    if (out.length >= 12) break;
  }
  return out;
}

function fromStorage(): CultureIndex | null {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return null;
    const p = JSON.parse(s) as CultureIndex;
    if (!p || !Array.isArray(p.items)) return null;
    // a cached index older than the endpoint's own staleness ceiling is worse
    // than nothing: last week's slang is the "fellow kids" failure exactly
    if (Date.now() - (p.fetchedAt || 0) > MAX_AGE_MS) return null;
    return { ...p, items: sanitizeItems(p.items) };
  } catch {
    return null;
  }
}
