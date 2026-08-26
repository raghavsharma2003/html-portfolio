// MasteryMap — the syllabus tree, read as mastery states, plus XP/level and a
// timeline of moments. This product's version of `UsScreen`, and it inherits
// `UsScreen`'s rule 3 by the same reasoning that page states it for a
// relationship record: every row here is a THING THAT HAPPENED (a graded
// attempt), never a field name or a completeness display.
//
// ── the falsifiable test, applied to every string in this file ────────────
//
// `SPEC-GURUKUL.md` §3 item 4 / `student-app-spec.md` §2.3: a mechanic is
// allowed iff removing every fear and obligation from it leaves the mechanic
// intact. There is no streak on this screen — WS-D's brief does not ask this
// workstream to build one, and a mastery/XP screen with an UNBUILT streak
// counter next to it is a smaller falsifiable surface than one that ships a
// streak with nothing to freeze. What IS here (mastery %, XP, level, a
// moments timeline) survives the test as written: take away every fear and
// obligation and a bar that fills because a problem was actually solved right
// is still exactly as full.
//
// ── computes nothing itself, same discipline as `PracticeActivity` ────────
//
// `foldMastery`, `levelForXp` and `totalXp` do all the arithmetic
// (`engine/practice/mastery.ts`, `gurukul/practiceStore.ts`). This file reads
// their output and the syllabus tree (`engine/practice/syllabus.ts`) and
// renders. No score is computed inline, and no threshold is repeated here
// that the fold does not already own.

import { useMemo } from "react";
import { SYLLABUS } from "../engine/practice/syllabus";
import { foldMastery, levelForXp, masteryOf, type MasteryLevel } from "../engine/practice/mastery";
import { momentFact } from "../engine/practiceTalk";
import { practiceHistory, practiceSummaries, totalXp } from "../gurukul/practiceStore";
import "../styles/practice.css";

interface Props {
  onExit: () => void;
}

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  unattempted: "not started",
  building: "building",
  developing: "developing",
  solid: "solid",
  mastered: "mastered",
};

export default function MasteryMap({ onExit }: Props) {
  const mastery = useMemo(() => foldMastery(practiceSummaries()), []);
  const xp = useMemo(() => totalXp(), []);
  const xpLevel = useMemo(() => levelForXp(xp), [xp]);
  const history = useMemo(() => practiceHistory(), []);

  // The moments timeline — the durable half of every finished set, oldest
  // absent, newest-first the way a person actually revisits "what happened".
  // Bounded, same reason `UsScreen`'s own timeline is bounded: a page is not
  // an audit log.
  const recentMoments = useMemo(() => {
    const rows: { key: string; text: string }[] = [];
    for (const entry of history) {
      for (const m of entry.summary.moments) {
        const text = momentFact(m);
        if (text) rows.push({ key: `${entry.completedAt}-${rows.length}`, text });
      }
    }
    return rows.reverse().slice(0, 12);
  }, [history]);

  return (
    <div className="pa-screen">
      <header className="pa-head">
        <button type="button" className="pa-back" onClick={onExit} aria-label="Back">
          ‹ Back
        </button>
        <span className="pa-title">Mastery Map</span>
      </header>
      <div className="pa-body">
        <div className="mm-xp" aria-live="polite">
          <b>Level {xpLevel.level}</b>
          <span>
            {xpLevel.xp} XP{xpLevel.nextTierXp !== null ? ` · ${xpLevel.nextTierXp - xpLevel.xp} to next level` : ""}
          </span>
        </div>

        {SYLLABUS.map((subject) => (
          <section className="mm-subject" key={subject.id}>
            <h2 className="pa-h2">{subject.name}</h2>
            {subject.units.map((unit) =>
              unit.chapters.map((chapter) => {
                const leaves = chapter.topics.length ? chapter.topics : [{ id: chapter.id, name: chapter.name }];
                return (
                  <div className="mm-chapter" key={chapter.id}>
                    <h3 className="mm-chapter-name">{chapter.name}</h3>
                    <ul className="mm-topics">
                      {leaves.map((leaf) => {
                        const m = masteryOf(mastery, leaf.id);
                        return (
                          <li className="mm-topic" key={leaf.id} data-level={m.level}>
                            <span className="mm-topic-name">{leaf.name}</span>
                            <span className="mm-topic-state">
                              <i className="mm-dot" data-level={m.level} aria-hidden="true" />
                              {LEVEL_LABEL[m.level]}
                              {m.attempted > 0 ? ` · ${Math.round(m.score * 100)}%` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              }),
            )}
          </section>
        ))}

        {recentMoments.length ? (
          <section className="mm-moments">
            <h2 className="pa-h2">Moments</h2>
            {recentMoments.map((r) => (
              <p className="pa-moment" key={r.key}>
                {r.text}
              </p>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
