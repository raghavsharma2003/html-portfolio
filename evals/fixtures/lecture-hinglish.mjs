// A Hinglish JEE-physics lecture transcript, authored as DATA for
// `evals/ingest.mjs` (Gurukul WS-F).
//
// ── it is a fixture, not a sample of a real person ────────────────────────
// Nothing here is transcribed from anybody. The teacher is Arjun Sir, the
// fictional demo teacher `src/engine/agents/characters/demoTeacher.ts` already
// ships, and the class is the one his sheet says he teaches: JEE mechanics,
// English-first with classroom Hindi underneath, every technical noun in
// English. Using a real teacher's words as a test fixture would put a real
// person's speech in version control without a consent artifact, which is the
// one thing this entire workstream exists to gate.
//
// ── what it has to contain to be worth anything ───────────────────────────
// A fixture for a frequency counter must have the frequencies. Specifically:
//
//  1. Verbalisms that survive `splitHeldOut` — each candidate must appear ≥5
//     times in the teacher's HELD-OUT half, which (the split being per-speaker
//     parity) means roughly ≥10 times across his turns. A fixture whose
//     catchphrases fail the rule would make the suite's positive case
//     unreachable and every assertion in it vacuous.
//  2. A speaker who is NOT the teacher, with enough turns to be a real
//     diarization problem — the student says "dekho" exactly zero times, so an
//     implementation that measured both speakers together would drift the
//     counts and the suite would see it.
//  3. Genuine code-switching, not English with Hindi sprinkled on: the marker
//     words have to arrive inside real clauses, because a marker list matched
//     against decorative Hindi measures the decoration.
//  4. Fillers, laughter and stretch, at plausible rates — a lecture with one
//     "matlab" in it cannot tell a working filler counter from a broken one.
//  5. Fragments in all THREE bands of the ≥5 rule, or the thresholds are never
//     tested. Measured on this fixture, teacher turns, after the per-speaker
//     parity split (`node evals/ingest.mjs` prints these):
//
//       verified          dekho 12, theek hai 9, achha 6, ab batao 5, haan 5
//       below-threshold   axis 4
//       is-a-line         sanity check 1, limiting case 1
//
//  6. And the case that justifies the whole held-out apparatus: **socho zara,
//     8 occurrences in the derive half and 2 in the held-out half.** An
//     in-sample check would pass it comfortably. It is a phrase he used
//     heavily in one stretch of one lecture and then stopped, which is what a
//     memorable LINE looks like from the inside — and a pipeline that mined
//     and verified on the same corpus could not tell it from a habit. The
//     suite asserts it is rejected, so the day someone "simplifies" the split
//     away, this is the fragment that says so.
//
// 80 turns: 60 teacher, 20 student.

export const TEACHER_SPEAKER = "SPEAKER_00";
export const STUDENT_SPEAKER = "SPEAKER_01";

const T = (text) => ({ speaker: TEACHER_SPEAKER, text });
const S = (text) => ({ speaker: STUDENT_SPEAKER, text });

export const LECTURE_TURNS = Object.freeze([
  T("theek hai, chalo shuru karte hain. Aaj rotational motion, aur specifically moment of inertia."),
  T("dekho, pehle picture banao. Ek rod hai, length L, mass M, uniform."),
  T("socho zara, agar main ise centre se ghumaun toh kya hoga, aur agar end se?"),
  S("Sir, end se zyada hoga na?"),
  T("achha, haan. Par kyun? Reason batao, answer nahi."),
  S("Because mass door hai axis se?"),
  T("theek hai, exactly. Distance squared weight karta hai, matlab door ka mass zyada count karta hai."),
  T("dekho, formula likhta hoon. I equals integral of r squared dm, bas yahi hai poora concept."),
  T("ab batao, dm kya hai is rod ke liye? Linear density into dx, theek hai."),
  T("lambda equals M by L, uniform hai isliye constant hai, matlab integral ke bahar aa jayega."),
  T("socho zara, limits kya lagengi centre ke liye? Minus L by two se plus L by two."),
  T("haan, aur end ke liye zero se L. Bas yahi difference hai, aur kuch nahi."),
  S("Sir ek doubt hai."),
  T("bolo."),
  S("Integration mein r ka matlab perpendicular distance hai ya normal distance?"),
  T("achha, achha. Perpendicular distance from the axis. Hamesha axis se, point se nahi."),
  T("dekho, ye galti bahut common hai. Sign convention aur distance, dono jagah log phaste hain."),
  T("theek hai, ab main solve karta hoon centre wala case, aur tum end wala karo."),
  T("integral minus L by two se plus L by two, lambda r squared dr, matlab lambda into r cubed by three."),
  T("limits daalo, L cubed by twelve into lambda, aur lambda equals M by L, toh M L squared by twelve."),
  T("ab batao, units check karo. Mass into length squared, theek hai, kilogram metre squared. Haan."),
  T("dekho, main hamesha bolta hoon, units likho. Units nahi likhe toh answer adha hai."),
  S("Sir end wala M L squared by three aa raha hai."),
  T("theek hai, correct hai. Aur ab ratio dekho, four is to one. Socho zara ye kyun."),
  T("haha, nahiii, koi baat nahi, main batata hoon. Parallel axis theorem, dekho."),
  T("I about end equals I about centre plus M d squared, aur d equals L by two."),
  T("M L squared by twelve plus M L squared by four, matlab M L squared by three. Theek hai."),
  T("ab batao, kya ye theorem har axis pe lagega? Nahi. Parallel hona chahiye, wahi naam mein hai."),
  T("dekho, ek limiting case check karo hamesha. Agar d zero, toh centre wala aa jana chahiye. Aaya."),
  T("achha, ab ek numerical. Rod ki mass do kilogram, length ek metre, end se rotate."),
  S("Two by three kilogram metre squared?"),
  T("haan, theek hai. Aur sanity check karo, twelve wala chhota hona chahiye tha. Hai."),
  T("socho zara, physically kyun chhota hai? Kyunki mass distribution axis ke paas hai."),
  T("dekho, yahi intuition exam mein bachata hai. Formula bhool jaoge, picture nahi bhoolte."),
  T("ab batao, disc ka moment of inertia kitna hai about its centre? Half M R squared."),
  T("theek hai, aur ring ka? M R squared, poora. Kyunki saara mass rim pe hai."),
  T("achha, ye compare karo. Ring zyada, disc kam, solid sphere aur bhi kam. Pattern dekho."),
  S("Sir sphere ka two by five hai na?"),
  T("haan, two by five M R squared, solid ke liye. Hollow ka two by three."),
  T("dekho, main derivation nahi karaunga sphere ka abhi, wo integration lamba hai."),
  T("socho zara, tum khud try karo, shells mein todo. Homework."),
  T("ab batao, agar main disc pe ek axis lagaun rim pe, tangential, toh kya?"),
  T("parallel axis, matlab half M R squared plus M R squared, three by two M R squared. Theek hai."),
  T("achha, ek aur cheez. Perpendicular axis theorem, sirf planar bodies ke liye. Sirf."),
  T("dekho, Iz equals Ix plus Iy, aur ye rod pe nahi lagega. Rod planar nahi hai us sense mein."),
  S("Sir rod toh line hai, planar nahi?"),
  T("achha, heh, haaan, accha sawaal. Line planar hai technically, par thickness zero hai, careful raho."),
  T("theek hai, ab torque pe aate hain, kyunki I akela kaam nahi karta."),
  T("tau equals I alpha, matlab Newton's second law ka rotational version. Bas."),
  T("dekho, F equals m a ke saath compare karo. Force ki jagah torque, mass ki jagah I."),
  T("socho zara, acceleration ki jagah kya? Angular acceleration, alpha. Sab kuch parallel hai."),
  T("ab batao, ek pulley problem. Massless string, pulley ki mass hai, moment of inertia hai."),
  T("dekho, ab do tension alag honge. Yahi wo jagah hai jahan sab galti karte hain."),
  T("theek hai, T one aur T two, dono alag. Pulley ki mass zero hoti toh barabar hote."),
  T("achha, equations likho. Block one ke liye m g minus T one equals m a."),
  T("ab batao, doosre block ke liye? T two minus M g equals M a, sign dekho."),
  T("socho zara, aur pulley ke liye? T one minus T two into R equals I alpha, aur a equals alpha R."),
  T("dekho, teen equations, teen unknowns. Bas solve karo, physics khatam."),
  T("theek hai, aur ek sanity check, agar I zero toh purana Atwood aa jayega. Aaega."),
  T("achha, aaj ke liye itna. Kal energy method karenge, wo shortcut hai par trap bhi hai."),
  S("Sir notes upload karenge?"),
  T("haan, kar dunga. Par pehle khud likho, uske baad dekhna."),
  T("dekho, likhne se yaad rehta hai, padhne se nahi. Ye main har batch ko bolta hoon."),
  T("socho zara, kitni baar tumne solution padha aur exam mein bhool gaye. Haan?"),
  S("Sir sahiii, wahi hota hai."),
  T("haha, sabke saath hota hai. Theek hai, chalo, ab batao kal kya karenge."),
  S("Energy method."),
  T("achha, theek hai. Aur uske pehle aaj ka homework, sphere ki derivation."),
  T("dekho, ek hint. Shells lo, har shell ka contribution, phir integrate. Bas."),
  T("socho zara, shell ka I pata hai tumhe, two by three m r squared. Wahi use karo."),
  T("ab batao, koi aur doubt?"),
  S("Sir arreee ek minute, wo ratio wala."),
  T("haan bolo."),
  S("Four is to one, wo centre aur end ka tha na?"),
  T("achha, haan, bilkul. End wala four times centre wala. Theek hai."),
  T("dekho, aur ye ratio yaad rakhne layak hai. Exam mein direct aata hai."),
  T("socho zara, aur bhi ratios hain, disc aur ring ka two is to one. Note karo."),
  T("theek hai, bas. Kal milte hain. Aur haan, units likhna mat bhoolna."),
  T("ab batao, sab clear? Achha, chalo. Bye."),
]);

/** The same corpus with the teacher's catchphrases removed from the held-out
 *  half only — the NEGATIVE fixture for the phrase-bank rule. A corpus where
 *  every fragment verifies cannot demonstrate a verifier that rejects. */
export const LECTURE_TURNS_NO_HABITS = Object.freeze(
  LECTURE_TURNS.map((turn, i) =>
    turn.speaker === TEACHER_SPEAKER && i % 2 === 1
      ? { ...turn, text: "Ok. Next step. Write the equation and check the units." }
      : turn,
  ),
);
