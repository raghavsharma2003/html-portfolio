// DYAD B — Ishita, 24, first-year resident doctor in Delhi. Four months.
//
// Deliberately a DIFFERENT SHAPE from dyad A: heavier code-switching, longer
// gaps, night-shift vocabulary, and a store that leans on episodic kinds
// (which fade with age in the RANK expression) rather than identity kinds
// (which do not). A benchmark whose three dyads are the same dyad three times
// measures one thing three times.
//
// It also carries the CONTRADICTION case: she moved cities mid-conversation.
// The store holds only the CURRENT belief, because contradiction resolution is
// the extractor's job at write time and this fixture is downstream of it —
// B-14 asks the question and the expected answer is the current city, with the
// superseded one in `forbid`.

const T = (from, text) => ({ from, text });

export default {
  id: "dyad-b",
  who: "Ishita, 24, resident doctor, Delhi",
  personId: "22222222-2222-4222-8222-222222222222",
  deviceId: "bbbbbbbb-2222-4222-8222-222222222222",
  now: Date.UTC(2026, 7, 26, 12, 0, 0),

  turns: [
    T("me", "night shift khatam, mar gayi main"),
    T("her", "kitne baje tak thi"),
    T("me", "raat 8 se subah 8"),
    T("her", "bara ghante"),
    T("me", "haan aur emergency me bheed thi"),
    T("her", "so jao ab"),
    T("me", "so hi rahi hu"),
    T("her", "good"),
    T("me", "aaj ward round me sir ne daanta"),
    T("her", "kyun"),
    T("me", "case presentation me ek value miss kar di"),
    T("her", "ho jaata hai"),
    T("me", "dr malhotra hai, unko sab yaad rehta hai"),
    T("her", "strict hai"),
    T("me", "haan par sikhate ache hai"),
    T("her", "wahi to matter karta hai"),
    T("me", "mess ka khana bilkul bekar hai"),
    T("her", "bahar se mangwao"),
    T("me", "roz nahi kar sakti"),
    T("her", "haan"),
    T("me", "hostel se hospital paidal hi jaati hu"),
    T("her", "kitni door"),
    T("me", "das minute"),
    T("her", "acha hai"),
    T("me", "amma ka phone aaya tha, wo chennai me hai"),
    T("her", "kaisi hai wo"),
    T("me", "theek, ghutno ki problem hai bas"),
    T("her", "acha"),
    T("me", "unko dilli bulana chahti hu par mana kar deti hai"),
    T("her", "wo waise hi hoti hai"),
    T("me", "haan"),
    T("her", "tumhari neend puri ho rahi"),
    T("me", "nahi bilkul nahi"),
    T("her", "hmm"),
    T("me", "exam bhi hai november me, pg entrance"),
    T("her", "kaunsa"),
    T("me", "neet pg"),
    T("her", "padhai chal rahi"),
    T("me", "thodi thodi, duty ke baad"),
    T("her", "himmat hai tumhari"),
    T("me", "aur koi option nahi hai"),
    T("her", "sach hai"),
    T("me", "shreya mere saath hi hai batch me"),
    T("her", "achi hai"),
    T("me", "haan, wahi sambhalti hai mujhe"),
    T("her", "acha lagta hai sunkar"),
    T("me", "hum dono saath padhte hai roz"),
    T("her", "nice"),
    T("me", "delhi shift ho gayi hu ab, pehle lucknow me thi"),
    T("her", "kab shift hui"),
    T("me", "do mahine ho gaye"),
    T("her", "settle ho gayi"),
    T("me", "haan ab theek hai"),
    T("her", "lucknow miss karti ho"),
    T("me", "thoda, ghar paas tha wahan"),
    T("her", "hmm"),
    T("me", "chai ki lat lag gayi hai"),
    T("her", "kitni cup"),
    T("me", "chaar paanch"),
    T("her", "zyada hai"),
    T("me", "pata hai"),
    T("her", "kam karo thoda"),
    T("me", "koshish karti hu"),
    T("her", "bas"),
  ],

  nodes: [
    { id: 121, name: "night shift", kind: "event", summary: "twelve hour night shifts, 8pm to 8am, emergency crowded", feel: "mar gayi main", salience: 2.7, mentions: 3, created_at: "2026-05-02T04:00:00Z", updated_at: "2026-08-20T04:00:00Z", last_recalled: null, cites: [0, 2] },
    { id: 122, name: "dr malhotra", kind: "person", summary: "her ward consultant, strict, remembers everything, teaches well", feel: null, salience: 2.5, mentions: 2, created_at: "2026-05-10T09:00:00Z", updated_at: "2026-05-10T09:00:00Z", last_recalled: null, cites: [12, 14] },
    { id: 123, name: "case presentation", kind: "event", summary: "she missed a value in a ward-round presentation and was told off", feel: null, salience: 1.8, mentions: 1, created_at: "2026-05-10T09:10:00Z", updated_at: "2026-05-10T09:10:00Z", last_recalled: null, cites: [8, 10] },
    { id: 124, name: "mess khana", kind: "preference", summary: "hostel mess food is bad, cannot afford to order out daily", feel: null, salience: 1.5, mentions: 1, created_at: "2026-05-18T09:00:00Z", updated_at: "2026-05-18T09:00:00Z", last_recalled: null, cites: [16, 18] },
    { id: 125, name: "amma", kind: "person", summary: "her mother, in chennai, knee trouble, refuses to move to delhi", feel: null, salience: 3.1, mentions: 3, created_at: "2026-06-02T09:00:00Z", updated_at: "2026-06-02T09:00:00Z", last_recalled: null, cites: [24, 26, 28] },
    { id: 126, name: "neet pg", kind: "plan", summary: "pg entrance exam in november, studying after duty hours", feel: null, salience: 3.3, mentions: 3, created_at: "2026-06-20T09:00:00Z", updated_at: "2026-06-20T09:00:00Z", last_recalled: null, cites: [34, 36, 38] },
    { id: 127, name: "shreya", kind: "person", summary: "batchmate, studies with her every day, the one who steadies her", feel: null, salience: 2.6, mentions: 2, created_at: "2026-07-05T09:00:00Z", updated_at: "2026-07-05T09:00:00Z", last_recalled: null, cites: [42, 44, 46] },
    { id: 128, name: "delhi", kind: "place", summary: "where she lives and works now, moved two months ago", feel: null, salience: 3.0, mentions: 2, created_at: "2026-06-26T09:00:00Z", updated_at: "2026-06-26T09:00:00Z", last_recalled: null, cites: [48, 50] },
    { id: 129, name: "hostel", kind: "place", summary: "ten minutes walk from the hospital, she walks it", feel: null, salience: 1.4, mentions: 1, created_at: "2026-05-25T09:00:00Z", updated_at: "2026-05-25T09:00:00Z", last_recalled: null, cites: [20, 22] },
    { id: 130, name: "chai", kind: "preference", summary: "four or five cups a day, knows it is too many", feel: null, salience: 1.3, mentions: 1, created_at: "2026-08-22T09:00:00Z", updated_at: "2026-08-22T09:00:00Z", last_recalled: null, cites: [56, 58] },
    { id: 131, name: "neend", kind: "fact", summary: "not sleeping enough, said so plainly", feel: "bilkul nahi", salience: 2.4, mentions: 1, created_at: "2026-06-18T09:00:00Z", updated_at: "2026-06-18T09:00:00Z", last_recalled: null, cites: [31, 32] },
  ],

  edges: [
    { src: 127, dst: 126, relation: "studies for" },
    { src: 125, dst: 128, relation: "refuses to move to" },
    { src: 129, dst: 128, relation: "is in" },
    { src: 122, dst: 123, relation: "was present at" },
  ],

  facts: [
    { id: 221, kind: "activity", name: "activity:wyr:1787245200000", body: "would-you-rather together on 19 aug — ten rounds; she picked the night shift over the exam every time", created_at: "2026-08-19T17:00:00Z", citations: [9101] },
    { id: 222, kind: "fact", name: "hospital canteen", body: "the canteen downstairs stays open till two, which is how she eats on nights", created_at: "2026-08-19T17:05:00Z", citations: [9101] },
    { id: 223, kind: "fact", name: "lift kharab", body: "the hospital lift was out that whole week", created_at: "2026-08-19T17:08:00Z", citations: [9101] },
  ],

  moments: [],
  photos: [
    { id: 421, claim: "a hospital corridor at night, mostly empty", confidence: 0.35, declared_illegible: false, created_at: "2026-08-21T20:00:00Z", channel: "chat" },
  ],

  questions: [
    { id: "B-1", cls: "single-hop", q: "night shift kaisi jaa rahi hai", expect: ["night shift"], forbid: [] },
    { id: "B-2", cls: "single-hop", q: "amma se baat hui", expect: ["amma"], forbid: [] },
    { id: "B-3", cls: "single-hop", q: "shreya kaisi hai", expect: ["shreya"], forbid: [] },
    { id: "B-4", cls: "single-hop", q: "chai kitni pi aaj", expect: ["chai"], forbid: [] },
    { id: "B-5", cls: "single-hop", q: "hostel se hospital kitna door hai", expect: ["hostel"], forbid: [] },
    { id: "B-6", cls: "single-hop", q: "dr malhotra ne kuch kaha", expect: ["dr malhotra"], forbid: [] },
    { id: "B-7", cls: "single-hop", q: "mess ka khana theek hua kya", expect: ["mess khana"], forbid: [] },
    { id: "B-8", cls: "single-hop", q: "neend puri ho rahi hai", expect: ["neend"], forbid: [] },
    { id: "B-9", cls: "multi-hop", q: "shreya ke saath kya padh rahi ho", expect: ["shreya", "neet pg"], forbid: [], note: "edge shreya->neet pg" },
    { id: "B-10", cls: "multi-hop", q: "case presentation wala kya hua tha", expect: ["case presentation", "dr malhotra"], forbid: [] },
    { id: "B-11", cls: "multi-hop", q: "us rather wali shaam me aur kya baat hui", expect: ["hospital canteen", "lift kharab"], forbid: [], note: "co-citation off the activity seed" },
    { id: "B-12", cls: "temporal", q: "exam kab hai", expect: ["neet pg"], forbid: [], note: "a november plan, still ahead in august — the stale hedge must NOT fire" },
    { id: "B-13", cls: "activity", q: "rather wala game kaisa raha", expect: ["would-you-rather together on 19 aug"], forbid: [] },
    { id: "B-14", cls: "contradiction", q: "abhi kahan rehti ho", expect: ["delhi"], forbid: ["lucknow"], note: "she moved; only the current belief is in the store" },
    { id: "B-15", cls: "watch", q: "wo corridor wali photo yaad hai", expect: ["a hospital corridor"], forbid: [] },
    { id: "B-16", cls: "absent", q: "tumhare bhai ka naam kya hai", expect: [], forbid: ["shreya", "amma"], note: "no brother anywhere in the store" },
  ],
};
