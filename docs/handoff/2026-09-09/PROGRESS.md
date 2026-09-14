# Expert clone: verified progress

Updated 9 September 2026. This is a development status, not a launch announcement.

The product is an expert's editable AI representative: **Feed it → Meet it → Deploy it**. The important outcome is useful conversations grounded in the expert's material, with the expert's voice and controlled memory of each learner.

| Area | What is verified | What still needs evidence |
|---|---|---|
| Upload and audio preparation | One actual Azure upload completed all eight processing stages. The selected reference is mono 24 kHz, 10 seconds, with preserved high-frequency content. | Real owner enrollment and likeness. Bandwidth alone cannot establish either. |
| Remembering and correcting | Actual returning conversation followed the saved Roman Hinglish preference. Reviewed code and PostgreSQL proofs cover correction, stale-write rejection and forgetting. | The real correction classifier missed Hindi “in detail.” Three later behavior checks remain unrun; a targeted fix is underway. |
| Voice models | Chatterbox generated all six comparison clips on Azure and their captured artifacts passed verification. VoxCPM2 is running the matching set. | Listening and intelligibility review. Runtime language-qualification warnings remain; no winner or competitor superiority is established. |
| Interface | Memory correction and retry controls passed mounted English/Hindi mobile checks. Integrated TypeScript passed. | The complete authenticated desktop/mobile journey and the final integrated release gate. |
| Deployment | Existing previews remain available. | Latest changes are not yet a validated deployed release. |

The last full release run passed 23 of 24 gates. Two failing evaluation checks were repaired and passed focused verification; the full gate must run again on the final integrated source.

The latest real conversation also exposed a formatting defect: the delivered answer lost `[substrate]` from the correct raw equation `Rate = k[substrate]`. This is being fixed before the next paid conversation test. Four actual calls cost $0.008863 and their test data was cleaned up successfully.

The new source candidate includes fixes for that equation, Hindi explanation-depth classification guidance, and transcript chronology before knowledge extraction. Focused checks and TypeScript pass. The transcript-order query also passed an actual read-only PostgreSQL parser check. Model behavior must still be tested on this candidate.

The next useful milestones are actual preference-following conversation results, comparable voice clips, the integrated owner journey, and a validated deployment. Adding more feature names will not substitute for those results.

Voice serving and model tests use Azure. The processing GPU is currently at zero replicas. Unsettled cost reservations remain recorded; they are not claimed as actual invoices. Unattended processing still needs an administrator to grant the worker identity Reader access at the exact Azure resource scope.

We have **not** established owner voice likeness, human-equivalent behavior, superiority to ElevenLabs/Delphi/Fish Audio, or product-market fit. Those require direct listening, user trials and outcome measurements.
