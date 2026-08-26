// DisclosurePreview.tsx — shows the teacher exactly what every student sees
// and hears before any session, so consent is INFORMED rather than assumed.
//
// Non-editable, deliberately: docs/gurukul/safety-floor-teacher.md §1 makes
// disclosure a predicate, not a persona rule ("a sentence in a brief is a
// preference; a predicate on the output is a guarantee"). This step is the
// teacher-facing window onto that predicate, not a place to soften it. The
// two blocks below are copied from safety-floor-teacher.md §1.1–§1.2
// verbatim, with only the teacher's own name interpolated — exactly the
// substitution `cloneDisclosureFact` performs at runtime.
import type { TeacherSheet } from "../engine/agents/teacherTypes";

export default function DisclosurePreview({ sheet }: { sheet: TeacherSheet }) {
  const name = sheet.name || "this teacher";

  return (
    <section id="disclosure-preview" className="disclosure-preview" aria-labelledby="disclosure-preview-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Teacher clone · Disclosure preview</p>
          <h2 id="disclosure-preview-title">What every student sees, before you decide anything else</h2>
          <p>
            This is the floor, not a draft — it is identical for every published teacher clone and cannot be
            edited, shortened, or turned off. It exists here so your consent is informed by exactly what a
            student will experience, not by a summary of it.
          </p>
        </div>
      </div>

      <article className="disclosure-card" aria-labelledby="disclosure-card-title">
        <span className="disclosure-card-kicker">Session-open card · shown before the first turn, every session</span>
        <h3 id="disclosure-card-title">You're talking with an AI clone of {name}</h3>
        <p>
          Built from {name}'s own recorded teaching, published by them. This is not {name} — they are not reading
          these conversations, and nothing said here reaches them unless you're told plainly that it will.
        </p>
      </article>

      <article className="disclosure-card disclosure-card-spoken" aria-labelledby="disclosure-spoken-title">
        <span className="disclosure-card-kicker">Spoken opening · every synthesized call, non-disableable</span>
        <h3 id="disclosure-spoken-title">The first thing a student hears on a call</h3>
        <p>
          "Hi — quick reminder before we start: I'm an AI clone of {name}, built from their own teaching. I'm not
          {" "}{name}, and this conversation stays between us unless you tell someone about it yourself."
        </p>
      </article>

      <div className="teacher-sheet-readonly">
        <span className="claim-meta">If a student talks to the clone as though it is you</span>
        <p>
          It corrects the mistake the first time, briefly, without apology or ceremony, and carries straight on
          with the work (safety-floor-teacher.md §1.2). It also never claims you saw, read, or were told anything
          said in a session — that is a separate, structural honesty rule (<code>teacher-relay-claim</code>), not a
          request made of the clone.
        </p>
      </div>

      <p className="field-note">
        Watermarked and provenance-signed on every synthesized call, and fired at the start of every session — not
        only at a time boundary — so it is the one disclosure guaranteed to be seen (P1, safety-floor-teacher.md).
      </p>
    </section>
  );
}
