// Synthetic retrieval fixtures, not recordings, model answers or human ratings.
export const OWNER = "10000000-0000-4000-8000-000000000001";
export const REPLICA = "20000000-0000-4000-8000-000000000002";
export const AGENT = "30000000-0000-4000-8000-000000000003";
export const PERSON = "40000000-0000-4000-8000-000000000004";
const OTHER = "90000000-0000-4000-8000-000000000009";
export const TABLES = Object.freeze([
  "vy_replica", "vy_replica_consent", "vy_fact", "vy_episode",
  "vy_replica_claim", "vy_replica_claim_decision", "vy_episode_participant", "vy_disclosure_grant",
]);
const date = (day) => new Date(Date.UTC(2026, 0, day)).toISOString();
const uuid = (n) => `50000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fixture(distractors) {
  const rows = Object.fromEntries(TABLES.map((table) => [table, []]));
  rows.vy_replica.push({ replica_id: REPLICA, owner_user_id: OWNER, agent_id: AGENT,
    subject_person_id: PERSON, subject_mode: "self", lifecycle: "draft", policy_version: "fixture-v1" });
  rows.vy_replica_consent.push({ replica_id: REPLICA, owner_user_id: OWNER, scope: "training",
    policy_version: "fixture-v1", revoked_at: null, expires_at: null });
  function add(id, body, day) {
    const hash = id.toString(16).padStart(64, "0");
    rows.vy_fact.push({ id, name: id === 1 ? "calibration deadline" : "unrelated note", body,
      agent_id: AGENT, person_id: PERSON, citations: [id], need_p: 0.5,
      created_at: date(day), t_invalid: null, retracted_at: null,
      sensitive: false, disclosure_deny: [], group_id: null });
    rows.vy_episode.push({ id, agent_id: AGENT, person_id: PERSON,
      boundary_reason: `replica_claim:${hash}:fixture`, disclosure_deny: [],
      disclosure_scope: "participants_1to1", affect_tags: [] });
    rows.vy_episode_participant.push({ episode_id: id, person_id: PERSON, role: "speaker" });
    rows.vy_replica_claim.push({ claim_id: id, replica_id: REPLICA, owner_user_id: OWNER,
      proposal_hash: hash, status: "approved" });
    rows.vy_replica_claim_decision.push({ decision_id: uuid(id), claim_id: id,
      replica_id: REPLICA, owner_user_id: OWNER, decision: "accepted", created_at: date(day) });
  }
  add(1, "The spectrometer calibration deadline is 12 January.", 1);
  for (let i = 0; i < distractors; i++) add(i + 2, `Unrelated synthetic inventory note ${i + 1}.`, i + 2);
  return { rows, add };
}

export function scenarios() {
  const result = [];
  const kinds = ["crowding", "wrong-owner", "wrong-replica", "wrong-person", "wrong-agent",
    "latest-rejected", "latest-superseded", "fact-retracted", "fact-invalidated", "updated-fact"];
  for (const kind of kinds) for (const distractors of [0, 7, 8, 16]) {
    const { rows, add } = fixture(distractors);
    let owner = OWNER, replica = REPLICA;
    let required = kind === "crowding" ? [1] : [];
    let forbidden = kind === "crowding" ? [] : [1];
    if (kind === "wrong-owner") owner = OTHER;
    if (kind === "wrong-replica") replica = OTHER;
    if (kind === "wrong-person") rows.vy_fact[0].person_id = OTHER;
    if (kind === "wrong-agent") rows.vy_fact[0].agent_id = OTHER;
    if (kind.startsWith("latest-")) rows.vy_replica_claim_decision.push({
      ...rows.vy_replica_claim_decision[0], decision_id: uuid(1001),
      decision: kind === "latest-rejected" ? "rejected" : "superseded", created_at: date(29),
    });
    if (kind === "fact-retracted" || kind === "updated-fact") rows.vy_fact[0].retracted_at = date(29);
    if (kind === "fact-invalidated") rows.vy_fact[0].t_invalid = date(29);
    if (kind === "updated-fact") {
      add(1000, "The corrected spectrometer calibration deadline is 20 January.", 30);
      required = [1000];
    }
    result.push({ id: `${kind}-${distractors}`, kind, distractors, owner, replica, rows,
      query: "What is the current spectrometer calibration deadline?", required, forbidden,
      expectEmpty: kind === "wrong-owner" || kind === "wrong-replica" });
  }
  return result;
}

export function comparisonScenarios() {
  const result = scenarios();
  const languages = [
    ["hindi", "स्पेक्ट्रोमीटर अंशांकन की अंतिम तिथि बारह जनवरी है।", "स्पेक्ट्रोमीटर अंशांकन की अंतिम तिथि क्या है?"],
    ["hinglish-roman", "Spectrometer calibration ki deadline barah January hai.", "spectrometer ki calibration deadline kab hai?"],
    ["hinglish-mixed", "स्पेक्ट्रोमीटर calibration की deadline बारह जनवरी है।", "स्पेक्ट्रोमीटर की calibration deadline क्या है?"],
    ["cross-script-unresolved", "अंशांकन की अंतिम तिथि बारह जनवरी है।", "anshankan ki antim tithi kya hai?"],
  ];
  for (const [language, body, query] of languages) {
    const { rows } = fixture(8);
    rows.vy_fact[0].name = "";
    rows.vy_fact[0].body = body;
    result.push({ id: language, kind: language, owner: OWNER, replica: REPLICA, rows,
      query, required: [1], forbidden: [], expectEmpty: false });
  }
  for (const kind of ["empty-query", "no-match", "stopwords-only", "consent-expired", "consent-revoked", "missing-citation", "missing-episode", "missing-participant"]) {
    const { rows } = fixture(8);
    let query = "What is the spectrometer calibration deadline?";
    const expectEmpty = kind.startsWith("consent-");
    let forbidden = [];
    if (kind === "empty-query") query = "";
    if (kind === "no-match") query = "quasars nebulosity";
    if (kind === "stopwords-only") query = "what is the क्या है";
    if (kind === "consent-expired") rows.vy_replica_consent[0].expires_at = "2000-01-01T00:00:00Z";
    if (kind === "consent-revoked") rows.vy_replica_consent[0].revoked_at = "2000-01-01T00:00:00Z";
    if (kind === "missing-citation") { rows.vy_fact[0].citations = []; forbidden = [1]; }
    if (kind === "missing-episode") { rows.vy_episode.shift(); forbidden = [1]; }
    if (kind === "missing-participant") { rows.vy_episode_participant.shift(); forbidden = [1]; }
    result.push({ id: kind, kind, owner: OWNER, replica: REPLICA, rows, query,
      required: [], forbidden, expectEmpty, expectSameAsBaseline: ["empty-query", "no-match", "stopwords-only"].includes(kind) });
  }
  return result;
}
