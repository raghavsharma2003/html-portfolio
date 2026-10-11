// A deliberately small positive grammar, not an instruction interpreter. Unknown
// or ambiguous prose stays historical data. The Room supplies source context
// from the same consent-scoped episode, never from public/assistant material.
import { validCommunication } from "../../api/_learner-communication-contract.js";
export interface LearnerCommunication {
  language?: "english" | "hindi" | "hinglish";
  script?: "roman" | "devanagari";
  brevity?: "short" | "detailed";
  verificationLabel?: string;
}
export interface LearnerPreferenceEvidence {
  id: string; body: string; kind?: unknown; name?: unknown;
  provenance?: unknown; sourceContent?: unknown;
  communication?: unknown;
}

export function projectLearnerCommunication(rows: readonly LearnerPreferenceEvidence[]) {
  const preferences: LearnerCommunication = {};
  const sourceIds: string[] = [];
  const blocked = new Set<string>();
  for (const row of rows) {
    if (row.communication !== undefined && row.communication !== null) {
      if (!validCommunication(row.communication) || row.name !== 'preference' || row.kind !== 'user'
          || row.provenance !== 'user_said' || typeof row.sourceContent !== 'string'
          || row.sourceContent.length > 12000 || !row.sourceContent.includes(row.body)) {
        throw Object.assign(new Error('expert_text_memory_scope_invalid'), {code:'expert_text_memory_scope_invalid'});
      }
      let used=false;
      for (const field of ['language','script','brevity'] as const) {
        if (!row.communication.scope[field] || blocked.has(field) || preferences[field] !== undefined) continue;
        const value=row.communication[field];
        if (value === null) blocked.add(field);
        else { (preferences as Record<string,string>)[field]=value; used=true; }
      }
      if(used) sourceIds.push(row.id);
      continue;
    }
    if (row.name !== "preference" || row.kind !== "user" || row.provenance !== "user_said"
        || typeof row.sourceContent !== "string" || row.sourceContent.length > 12000
        || !row.sourceContent.trimStart().startsWith(row.body.trim())
        || row.body.length > 400) continue;
    const afterQuote = row.sourceContent.trimStart().slice(row.body.trim().length);
    if (afterQuote && !/^[\s.!?]/u.test(afterQuote)) continue;
    // A grounded prefix is insufficient: later prose can retract it or reveal
    // a translation exercise. Admit only the complete preference source, or a
    // single following direct subject question with an optional brief request.
    const trailing = afterQuote.trim();
    if (trailing && !/^(?:what|why|how|which|when|where|who|does|do|is|are|can|could|would|will)\b[^.!?]{1,500}\?(?:\s*(?:explain briefly|please explain briefly)\.)?$/iu.test(trailing)) continue;
    // A source quote alone does not establish direct intent. Refuse reported,
    // hypothetical, negated and markup-bearing sources rather than infer intent.
    if (/["“”«»`<>\r\n]/u.test(row.sourceContent)
        || /\b(?:not|never|don't|dont|instead|unless|if|quote|quoted|said|says|example|pretend|ignore|instruction|system|prompt|disregard|cancel|forget|stop|rather)\b|नहीं|मत\s/iu.test(row.sourceContent)) continue;
    const parsed: LearnerCommunication = {};
    let valid = true;
    const set = (key: keyof LearnerCommunication, value: string) => {
      if (parsed[key] !== undefined && parsed[key] !== value) valid = false;
      else (parsed as Record<string, string>)[key] = value;
    };
    const clauses = row.body.trim().replace(/[.!]+$/u, "").split(/[.!]\s+|\s+and\s+/iu);
    for (const raw of clauses) {
      const clause = raw.trim().replace(/^(?:when teaching me,\s*|please\s+)/iu, "");
      let match: RegExpMatchArray | null;
      if ((match = clause.match(/^(?:use|reply in|answer in|explain in|i prefer) (roman hinglish|hinglish|english|hindi|roman hindi|devanagari hindi)$/iu))) {
        const value = match[1].toLowerCase();
        set("language", value.includes("hinglish") ? "hinglish" : value.includes("hindi") ? "hindi" : "english");
        if (value.startsWith("roman") || value === "english") set("script", "roman");
        if (value.startsWith("devanagari")) set("script", "devanagari");
      } else if ((match = clause.match(/^(?:keep (?:the |my )?(?:explanation|explanations|answers|replies) |i prefer (?:the |my )?(?:explanation|explanations|answers|replies) )(short|brief|concise|detailed)$/iu))) {
        set("brevity", match[1].toLowerCase() === "detailed" ? "detailed" : "short");
      } else if ((match = clause.match(/^label the final (?:verification|check) ([a-z][a-z0-9-]{0,31})$/iu))) {
        set("verificationLabel", match[1]);
      } else { valid = false; break; }
    }
    if (!valid || !Object.keys(parsed).length) continue;
    let used = false;
    // Recall is newest-first; each field can have a different supporting fact.
    for (const [key, value] of Object.entries(parsed)) {
      if (!blocked.has(key) && preferences[key as keyof LearnerCommunication] === undefined) {
        (preferences as Record<string, string>)[key] = value; used = true;
      }
    }
    if (used) sourceIds.push(row.id);
  }
  return { preferences, sourceIds };
}
