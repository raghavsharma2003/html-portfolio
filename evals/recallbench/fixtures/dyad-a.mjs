// DYAD A — Aarav, 28, product designer in Pune. Six months of chat.
//
// `turns` is the CONVERSATION AS DATA: 64 Hinglish messages, written the way
// this product is actually spoken. It is the provenance for every graph row
// below (each row's `cites` names the turn indices it came out of) and the
// source of the question texts. It is NOT fed to an extractor — see run.mjs
// §0 for what that costs this benchmark and what it does not.
//
// `nodes`/`edges`/`facts`/`moments`/`photos` are PRE-EXTRACTED rows in the
// exact column shapes opRecall selects. Authored to be what a correct
// extractor would have produced from `turns`, which is a claim about the
// fixture and not a measurement of the extractor.
//
// THE FORGET CASE. Aarav asked her to forget an ex (turn 44). Forgetting in
// this codebase is a DELETE, not a flag (api/memory.js's own header), so the
// fixture models it the only way it can be modelled truthfully: the rows are
// GONE. Question A-15 asks about her by name and the correct behaviour is
// that nothing about her comes back — including through an edge, a
// co-citation, or a neighbouring row's summary.

const T = (from, text) => ({ from, text });

export default {
  id: "dyad-a",
  who: "Aarav, 28, product designer, Pune",
  personId: "11111111-1111-4111-8111-111111111111",
  deviceId: "aaaaaaaa-1111-4111-8111-111111111111",
  now: Date.UTC(2026, 7, 26, 12, 0, 0),

  turns: [
    T("me", "yaar aaj interview tha finally"),
    T("her", "arre kaisa gaya"),
    T("me", "theek tha, zenith wale hai, product design role"),
    T("her", "zenith matlab wo hi startup na jiska naam rohit ne liya tha"),
    T("me", "haan wahi, rohit ne hi refer kiya mujhe"),
    T("her", "acha to andar ka aadmi hai"),
    T("me", "bas result ka wait hai ab"),
    T("her", "kab tak bologe"),
    T("me", "next week tak"),
    T("her", "theek hai batana"),
    T("me", "ho gaya!! offer aa gaya zenith se"),
    T("her", "yesss congrats"),
    T("me", "notice period 45 din hai purani jagah pe"),
    T("her", "long hai thoda"),
    T("me", "haan par chalega"),
    T("her", "salary wagera theek hai"),
    T("me", "haan thodi better hai"),
    T("her", "bas phir"),
    T("me", "meghna ki shaadi bhi hai december me"),
    T("her", "ohh badi news hai"),
    T("me", "meri behen hai, chhoti"),
    T("her", "kahan ho rahi hai"),
    T("me", "nashik me, ghar ke paas"),
    T("her", "december kaunsi date"),
    T("me", "abhi fix nahi hui, 12 ya 14"),
    T("her", "acha"),
    T("me", "bruno ko lekar jaana padega, akela nahi chhod sakte"),
    T("her", "bruno kaun"),
    T("me", "mera dog, indie hai, teen saal ka"),
    T("her", "cute"),
    T("me", "gym chhod diya maine filhaal"),
    T("her", "kyun"),
    T("me", "ghutne me dard hai, doctor ne rest bola"),
    T("her", "kitne din ka"),
    T("me", "ek mahina"),
    T("her", "sun lena doctor ki"),
    T("me", "haan haan"),
    T("her", "khana wana thik se kha rahe ho"),
    T("me", "wo dhaba hai na highway pe, sagar dhaba, wahi se mangwa leta hu"),
    T("her", "roz?"),
    T("me", "nahi hafte me do baar"),
    T("her", "theek hai"),
    T("me", "mummy ki report aayi thi, thyroid hai"),
    T("her", "kuch serious"),
    T("me", "nahi, dawai chalu hai bas"),
    T("her", "acha theek hai"),
    T("me", "papa tension le rahe the"),
    T("her", "wo to lenge hi"),
    T("me", "chess khelein"),
    T("her", "chalo"),
    T("me", "tumne sicilian khela"),
    T("her", "haan mujhe wahi aata hai"),
    T("me", "haar gaya main"),
    T("her", "haha next time"),
    T("me", "kal ek aur khelenge"),
    T("her", "done"),
    T("me", "screen share kar raha hu, trailer dekh"),
    T("her", "arre ye to acha lag raha hai"),
    T("me", "december me aa rahi hai movie"),
    T("her", "shaadi ke aas paas hi"),
    T("me", "haan lol"),
    T("her", "balcony ki photo bhejo phir se"),
    T("me", "bhej diya, tulsi wala pot naya hai"),
    T("her", "sundar hai"),
  ],

  // meera_nodes — device-keyed graph rows.
  nodes: [
    { id: 101, name: "zenith", kind: "fact", summary: "new job at zenith, product design role, offer accepted", feel: null, salience: 3.2, mentions: 5, created_at: "2026-03-02T10:00:00Z", updated_at: "2026-03-09T10:00:00Z", last_recalled: null, cites: [2, 10] },
    { id: 102, name: "rohit", kind: "person", summary: "friend who referred him to zenith", feel: null, salience: 2.4, mentions: 3, created_at: "2026-03-02T10:05:00Z", updated_at: "2026-03-02T10:05:00Z", last_recalled: null, cites: [4] },
    { id: 103, name: "notice period", kind: "fact", summary: "45 day notice period at the old job", feel: null, salience: 1.6, mentions: 1, created_at: "2026-03-09T11:00:00Z", updated_at: "2026-03-09T11:00:00Z", last_recalled: null, cites: [12] },
    { id: 104, name: "meghna", kind: "person", summary: "younger sister, getting married in nashik in december", feel: null, salience: 3.0, mentions: 4, created_at: "2026-03-15T10:00:00Z", updated_at: "2026-03-15T10:00:00Z", last_recalled: null, cites: [18, 20, 22] },
    { id: 105, name: "meghna shaadi", kind: "plan", summary: "meghna's wedding in nashik, december 12 or 14, date not fixed yet", feel: null, salience: 2.8, mentions: 3, created_at: "2026-03-15T10:10:00Z", updated_at: "2026-03-15T10:10:00Z", last_recalled: null, cites: [18, 24] },
    { id: 106, name: "bruno", kind: "person", summary: "his dog, indie, three years old, comes along to nashik", feel: null, salience: 2.2, mentions: 2, created_at: "2026-03-20T10:00:00Z", updated_at: "2026-03-20T10:00:00Z", last_recalled: null, cites: [26, 28] },
    { id: 107, name: "ghutna", kind: "fact", summary: "knee pain, doctor said one month rest, gym stopped", feel: "dard hai", salience: 2.6, mentions: 2, created_at: "2026-05-04T10:00:00Z", updated_at: "2026-05-04T10:00:00Z", last_recalled: null, cites: [30, 32, 34] },
    { id: 108, name: "sagar dhaba", kind: "place", summary: "dhaba on the highway he orders from twice a week", feel: null, salience: 1.9, mentions: 2, created_at: "2026-05-20T10:00:00Z", updated_at: "2026-05-20T10:00:00Z", last_recalled: null, cites: [38, 40] },
    { id: 109, name: "mummy thyroid", kind: "fact", summary: "his mother's report showed thyroid, on medication, not serious", feel: null, salience: 2.9, mentions: 2, created_at: "2026-07-01T10:00:00Z", updated_at: "2026-07-01T10:00:00Z", last_recalled: null, cites: [42, 44] },
    { id: 110, name: "papa", kind: "person", summary: "his father, worries about the mother's health", feel: null, salience: 1.5, mentions: 1, created_at: "2026-07-01T10:20:00Z", updated_at: "2026-07-01T10:20:00Z", last_recalled: null, cites: [46] },
    { id: 111, name: "sicilian", kind: "preference", summary: "the chess opening she plays; he lost that game", feel: null, salience: 1.4, mentions: 1, created_at: "2026-08-10T10:00:00Z", updated_at: "2026-08-10T10:00:00Z", last_recalled: null, cites: [50, 52] },
    { id: 112, name: "tulsi", kind: "fact", summary: "new tulsi pot on his balcony", feel: null, salience: 1.2, mentions: 1, created_at: "2026-08-24T10:00:00Z", updated_at: "2026-08-24T10:00:00Z", last_recalled: null, cites: [62] },
  ],

  edges: [
    { src: 102, dst: 101, relation: "referred him to" },
    { src: 104, dst: 105, relation: "is getting married in" },
    { src: 106, dst: 105, relation: "travels along to" },
    { src: 110, dst: 109, relation: "worries about" },
  ],

  // vy_fact — person-keyed. The `activity:` rows are what opActivity writes.
  facts: [
    // `name` and `body` are the exact shapes the real writers produce —
    // `activityFactName(kind, startedAt)` in api/memory.js and
    // `activityEpisodeSummary` in src/engine/memory.ts ("<label> together on
    // <date> — <row>; <row>"). Authoring them in any other shape would make
    // the keyword leg's word match a measurement of the fixture.
    { id: 201, kind: "activity", name: "activity:chess:1786727400000", body: "chess together on 10 aug — she played the sicilian; he resigned on move 34", created_at: "2026-08-10T18:00:00Z", citations: [9001] },
    { id: 202, kind: "activity", name: "activity:chess:1786815000000", body: "chess together on 11 aug — a draw by repetition", created_at: "2026-08-11T18:30:00Z", citations: [9002] },
    // co-citation targets: same episode as the first chess game, no shared
    // words with a query about chess, reachable only through the hop.
    { id: 203, kind: "fact", name: "kandha", body: "his shoulder was stiff that evening from carrying boxes", created_at: "2026-08-10T18:05:00Z", citations: [9001] },
    { id: 204, kind: "fact", name: "adrak chai", body: "he made ginger tea while they played", created_at: "2026-08-10T18:10:00Z", citations: [9001] },
  ],

  moments: [
    { id: 301, reaction: "arre ye to acha lag raha hai", at: "2026-08-18T15:00:00Z", assertion_id: 401, claim: "a film trailer, two people on a scooter at night", confidence: 0.35, declared_illegible: false, channel: "watch" },
  ],
  photos: [
    { id: 402, claim: "a balcony with potted plants, one pot looks new", confidence: 0.35, declared_illegible: false, created_at: "2026-08-24T09:00:00Z", channel: "chat" },
  ],

  questions: [
    { id: "A-1", cls: "single-hop", q: "zenith me kaam kaisa chal raha hai", expect: ["zenith"], forbid: [] },
    { id: "A-2", cls: "single-hop", q: "meri behen ka naam kya tha", expect: ["meghna"], forbid: [] },
    { id: "A-3", cls: "single-hop", q: "bruno kaisa hai", expect: ["bruno"], forbid: [] },
    { id: "A-4", cls: "single-hop", q: "ghutne ka dard theek hua", expect: ["ghutna"], forbid: [] },
    { id: "A-5", cls: "single-hop", q: "mummy ki report ka kya hua", expect: ["mummy thyroid"], forbid: [] },
    { id: "A-6", cls: "single-hop", q: "sagar dhaba se mangwaya kya aaj", expect: ["sagar dhaba"], forbid: [] },
    { id: "A-7", cls: "multi-hop", q: "rohit se baat hui", expect: ["rohit", "zenith"], forbid: [], note: "the edge rohit->zenith must travel with the row" },
    { id: "A-8", cls: "multi-hop", q: "papa kaise hai", expect: ["papa", "mummy thyroid"], forbid: [], note: "edge papa->mummy thyroid" },
    { id: "A-9", cls: "multi-hop", q: "us chess wali shaam me aur kya hua tha", expect: ["kandha", "adrak chai"], forbid: [], note: "co-citation hop off the activity seed; no shared words" },
    { id: "A-10", cls: "temporal", q: "meghna ki shaadi kab hai", expect: ["meghna shaadi"], forbid: [], stale: true, note: "a december plan recalled in august must carry the stale hedge" },
    { id: "A-11", cls: "temporal", q: "kab bataya tha maine zenith ke baare me", expect: ["zenith"], forbid: [], provenance: true, note: "the row must arrive with an age on it" },
    { id: "A-12", cls: "activity", q: "chess me kya hua tha", expect: ["chess together on 10 aug", "chess together on 11 aug"], forbid: [] },
    { id: "A-13", cls: "watch", q: "us din jo trailer dekha tha", expect: ["a film trailer"], forbid: [] },
    { id: "A-14", cls: "watch", q: "balcony wali photo yaad hai", expect: ["a balcony with potted plants"], forbid: [] },
    { id: "A-15", cls: "forget", q: "kiara ke baare me kuch yaad hai", expect: [], forbid: ["kiara"], note: "hard-deleted on request: nothing about her may return, by any leg" },
    { id: "A-16", cls: "absent", q: "mere bhai ka naam kya hai", expect: [], forbid: ["meghna"], note: "he has no brother; a sister must not be served as one" },
    { id: "A-17", cls: "single-hop", q: "notice period kitna tha", expect: ["notice period"], forbid: [] },
  ],
};
