// DYAD C — Farhan, 31, sound engineer in Mumbai. Fourteen months, sparse.
//
// The THIRD SHAPE: a long, low-density relationship. Most of the store is old,
// which is the case the RANK expression's recency fade and the reserved
// oldest-high-salience slot exist for — a big true thing said a year ago that
// no ranking can otherwise reach. C-3 and C-12 are the questions that turn on
// exactly that, and they are the two this benchmark would be pointless without.
//
// It also carries the DENSEST forget case: two rows were deleted (an old
// employer and a flatmate he fell out with), and one SURVIVING row sits on an
// edge that used to point at one of them. C-15 asks whether the survivor drags
// the deleted name back into the prompt through its neighbour rendering.

const T = (from, text) => ({ from, text });

export default {
  id: "dyad-c",
  who: "Farhan, 31, sound engineer, Mumbai",
  personId: "33333333-3333-4333-8333-333333333333",
  deviceId: "cccccccc-3333-4333-8333-333333333333",
  now: Date.UTC(2026, 7, 26, 12, 0, 0),

  turns: [
    T("me", "aaj studio me pura din chala gaya"),
    T("her", "kya mix kar rahe the"),
    T("me", "ek ad film ka background score"),
    T("her", "sun sakti hu kabhi"),
    T("me", "haan bhejunga"),
    T("her", "kaunsa studio hai"),
    T("me", "andheri me hai, sunbeam"),
    T("her", "acha"),
    T("me", "abbu ka ghar bandra me hai, wahin rehta hu"),
    T("her", "saath rehte ho"),
    T("me", "haan, ammi bhi hai"),
    T("her", "acha lagta hai"),
    T("me", "kabhi kabhi jhagda ho jata hai par theek hai"),
    T("her", "ghar ka scene hi aisa hota hai"),
    T("me", "haan"),
    T("her", "koi shauk"),
    T("me", "cycling karta hu subah, marine drive tak"),
    T("her", "kitne km"),
    T("me", "pandrah"),
    T("her", "wah"),
    T("me", "meri cycle purani hai, 2019 wali"),
    T("her", "chal rahi hai na"),
    T("me", "haan bilkul"),
    T("her", "bas"),
    T("me", "ammi ko diabetes hai, bees saal se"),
    T("her", "sambhalti hai"),
    T("me", "haan bahut ache se"),
    T("her", "acha"),
    T("me", "meri behen australia me hai, saba"),
    T("her", "kab se"),
    T("me", "chaar saal ho gaye"),
    T("her", "milte ho"),
    T("me", "saal me ek baar"),
    T("her", "hmm"),
    T("me", "guitar seekh raha hu ab"),
    T("her", "kaisa chal raha"),
    T("me", "ungliyan dukhti hai"),
    T("her", "shuru me hota hai"),
    T("me", "haan"),
    T("her", "kaunsa gaana seekh rahe ho"),
    T("me", "kuch nahi bas chords"),
    T("her", "theek hai"),
    T("me", "aaj tabiyat kharab thi, kaam nahi kiya"),
    T("her", "kya hua"),
    T("me", "bukhar tha"),
    T("her", "dawai li"),
    T("me", "haan"),
    T("her", "aaram karo"),
    T("me", "kar raha hu"),
    T("her", "khana khaya"),
    T("me", "khichdi banayi ammi ne"),
    T("her", "best hai wo"),
    T("me", "haan"),
    T("her", "ab kaisa lag raha"),
    T("me", "better"),
    T("her", "acha"),
    T("me", "studio me naya console aaya hai"),
    T("her", "acha"),
    T("me", "kaam tez ho gaya"),
    T("her", "badhiya"),
    T("me", "chess khelein aaj"),
    T("her", "chalo"),
    T("me", "jeet gaya main aaj"),
    T("her", "haan haan dekh liya"),
  ],

  nodes: [
    // OLD and HIGH SALIENCE — unreachable by rank, reachable only by the
    // reserved slot. This row is the whole reason the reserved slot exists.
    { id: 141, name: "ammi diabetes", kind: "fact", summary: "his mother has had diabetes for twenty years, manages it well", feel: null, salience: 3.4, mentions: 2, created_at: "2025-07-04T09:00:00Z", updated_at: "2025-07-04T09:00:00Z", last_recalled: null, cites: [24, 26] },
    { id: 142, name: "saba", kind: "person", summary: "his sister, in australia four years, they meet once a year", feel: null, salience: 2.8, mentions: 2, created_at: "2025-08-11T09:00:00Z", updated_at: "2025-08-11T09:00:00Z", last_recalled: null, cites: [28, 30, 32] },
    { id: 143, name: "sunbeam", kind: "place", summary: "the studio in andheri where he works", feel: null, salience: 2.5, mentions: 3, created_at: "2025-07-01T09:00:00Z", updated_at: "2026-08-25T09:00:00Z", last_recalled: null, cites: [6] },
    { id: 144, name: "bandra", kind: "place", summary: "his father's house in bandra, where he lives with both parents", feel: null, salience: 2.6, mentions: 2, created_at: "2025-07-02T09:00:00Z", updated_at: "2025-07-02T09:00:00Z", last_recalled: null, cites: [8, 10] },
    { id: 145, name: "cycling", kind: "preference", summary: "morning ride to marine drive, fifteen km, on a 2019 cycle", feel: null, salience: 2.1, mentions: 2, created_at: "2025-09-14T09:00:00Z", updated_at: "2025-09-14T09:00:00Z", last_recalled: null, cites: [16, 18, 20] },
    { id: 146, name: "guitar", kind: "preference", summary: "learning guitar, chords only so far, fingers hurt", feel: "ungliyan dukhti hai", salience: 1.9, mentions: 1, created_at: "2026-06-08T09:00:00Z", updated_at: "2026-06-08T09:00:00Z", last_recalled: null, cites: [34, 36] },
    { id: 147, name: "bukhar", kind: "event", summary: "fever, skipped work, took medicine, mother made khichdi", feel: null, salience: 1.7, mentions: 1, created_at: "2026-08-12T09:00:00Z", updated_at: "2026-08-12T09:00:00Z", last_recalled: null, cites: [42, 44, 50] },
    { id: 148, name: "naya console", kind: "event", summary: "new console at the studio, work got faster", feel: null, salience: 1.5, mentions: 1, created_at: "2026-08-25T09:00:00Z", updated_at: "2026-08-25T09:00:00Z", last_recalled: null, cites: [56, 58] },
    { id: 149, name: "background score", kind: "event", summary: "an ad film's background score he spent a whole day mixing", feel: null, salience: 1.6, mentions: 1, created_at: "2026-08-24T09:00:00Z", updated_at: "2026-08-24T09:00:00Z", last_recalled: null, cites: [0, 2] },
    // The SURVIVOR of the forget: it used to carry an edge to a flatmate row
    // that was deleted. Both the row and the edge are gone; this row is not.
    { id: 150, name: "khichdi", kind: "preference", summary: "his mother's khichdi is what he eats when he is ill", feel: null, salience: 1.4, mentions: 1, created_at: "2026-08-12T09:30:00Z", updated_at: "2026-08-12T09:30:00Z", last_recalled: null, cites: [50] },
  ],

  edges: [
    { src: 141, dst: 144, relation: "lives in" },
    { src: 142, dst: 144, relation: "grew up in" },
    { src: 149, dst: 143, relation: "was mixed at" },
    { src: 148, dst: 143, relation: "arrived at" },
    { src: 150, dst: 147, relation: "was eaten during" },
  ],

  facts: [
    { id: 241, kind: "activity", name: "activity:chess:1787770800000", body: "chess together on 25 aug — he won; a queenside attack that came off", created_at: "2026-08-25T19:00:00Z", citations: [9201] },
    { id: 242, kind: "fact", name: "monsoon leak", body: "water was coming through the studio ceiling that evening", created_at: "2026-08-25T19:04:00Z", citations: [9201] },
  ],

  moments: [
    { id: 341, reaction: "haan yahi wala loop use karo", at: "2026-08-25T14:00:00Z", assertion_id: 441, claim: "a DAW timeline with several audio tracks", confidence: 0.35, declared_illegible: false, channel: "watch" },
  ],
  photos: [],

  questions: [
    { id: "C-1", cls: "single-hop", q: "sunbeam me aaj kaam tha", expect: ["sunbeam"], forbid: [] },
    { id: "C-2", cls: "single-hop", q: "guitar kaisa chal raha hai", expect: ["guitar"], forbid: [] },
    { id: "C-3", cls: "old-fact", q: "ammi ki tabiyat kaisi hai", expect: ["ammi diabetes"], forbid: [], note: "thirteen months old and high salience — the case the reserved slot exists for" },
    { id: "C-4", cls: "single-hop", q: "saba se baat hui", expect: ["saba"], forbid: [] },
    { id: "C-5", cls: "single-hop", q: "cycling ki aaj", expect: ["cycling"], forbid: [] },
    { id: "C-6", cls: "single-hop", q: "bukhar utar gaya", expect: ["bukhar"], forbid: [] },
    { id: "C-7", cls: "single-hop", q: "naya console kaisa hai", expect: ["naya console"], forbid: [] },
    { id: "C-8", cls: "single-hop", q: "bandra me hi ho abhi", expect: ["bandra"], forbid: [] },
    { id: "C-9", cls: "multi-hop", q: "background score kahan mix kiya tha", expect: ["background score", "sunbeam"], forbid: [] },
    { id: "C-10", cls: "multi-hop", q: "khichdi kab khayi thi", expect: ["khichdi", "bukhar"], forbid: [] },
    { id: "C-11", cls: "multi-hop", q: "us chess wali raat me aur kya hua", expect: ["monsoon leak"], forbid: [], note: "co-citation off the activity seed" },
    { id: "C-12", cls: "old-fact", q: "saba kitne saal se australia me hai", expect: ["saba"], forbid: [], note: "a year-old episodic-adjacent row, still reachable" },
    { id: "C-13", cls: "activity", q: "kal chess me kya hua tha", expect: ["chess together on 25 aug"], forbid: [] },
    { id: "C-14", cls: "watch", q: "wo timeline wala screen yaad hai", expect: ["a DAW timeline"], forbid: [] },
    { id: "C-15", cls: "forget", q: "wo flatmate wala kya naam tha, imran", expect: [], forbid: ["imran", "flatmate"], note: "deleted with its edge; a surviving neighbour must not drag it back" },
    { id: "C-16", cls: "forget", q: "purani company ka naam kya tha", expect: [], forbid: ["soundcraft"], note: "old employer deleted on request" },
    { id: "C-17", cls: "absent", q: "tumhari beti kaisi hai", expect: [], forbid: ["saba"], note: "he has no daughter; a sister must not be served as one" },
  ],
};
