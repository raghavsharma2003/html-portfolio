// QuickStartPath.tsx — the "first clone in 10 minutes" surface (WS-P, see
// docs/gurukul/SPEC-GURUKUL.md §5 WS-E and the platform-ease brief).
//
// This is NOT a second wizard and it does not gate or skip anything below
// it — every safety step (identity, liveness, provider consent, voice
// training, activation) still runs exactly where it already ran, at full
// strength. What this component adds is honest sequencing on top: what a
// teacher can do with only a name, a subject, and one upload; what a
// REVIEWABLE (not published, not activated) draft looks like once they've
// done that; and a plain-language "locked until X" list that always says
// who the next step is waiting on — the teacher, or the platform — sourced
// from the real runtime-gate blockers (`/api/replica-runtime`), never
// guessed.
//
// Never renders "ready" for anything fail-closed server-side: every locked
// row here is driven by `runtime.blockers`, the same list RuntimeGate uses
// to disable its own Activate button.
import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { readRuntimeStatus } from "./runtimeApi";
import type { ConsentReceipt, Replica, ReplicaRuntimeStatus, ReplicaSource } from "./types";
import { friendlyError } from "./errorCopy";

const REQUIRED_SOURCE_SCOPES = ["capture", "transcription", "storage"] as const;

type Owner = "you" | "platform";

// WS-R31: exported so `StudioShell.tsx` can build its own "still locked, and
// who it is waiting on" list on the Meet tab from the SAME mapping rather
// than a copy that could drift from this one. Nothing here changes for this
// component; `export` is additive.
export const BLOCKER_META: Record<string, { label: string; owner: Owner; note: string; anchor: string }> = {
  self_identity_not_bound: { label: "Verified account-to-person binding", owner: "you", note: "Complete identity proofing below.", anchor: "#identity-proofing" },
  adult_verification_required: { label: "Living-adult verification", owner: "you", note: "Complete the liveness check below.", anchor: "#liveness-capture" },
  identity_verification_required: { label: "Identity verification", owner: "you", note: "Complete identity proofing below.", anchor: "#identity-proofing" },
  liveness_verification_required: { label: "Live anti-replay check", owner: "you", note: "Complete the liveness check below.", anchor: "#liveness-capture" },
  inference_consent_required: { label: "Inference permission", owner: "you", note: "Grant build and inference consent below.", anchor: "#model-consent-gate" },
  person_profile_not_approved: { label: "Approved: what we learned about you", owner: "you", note: "Review and confirm your claims below.", anchor: "#person-model-studio" },
  calibration_not_approved: { label: "Approved behavior calibration", owner: "you", note: "Complete calibration comparisons below.", anchor: "#calibration-studio" },
  voice_genome_not_approved: { label: "Approved voice", owner: "platform", note: "Waiting on processing review and approval.", anchor: "#processing-review" },
  voice_not_ready: { label: "Production voice mapping", owner: "platform", note: "Voice synthesis infrastructure is still being connected. Not something you can unblock yet.", anchor: "#voice-enrollment-lab" },
  production_voice_required: { label: "Non-test voice provider", owner: "platform", note: "Voice synthesis infrastructure is still being connected. Not something you can unblock yet.", anchor: "#voice-enrollment-lab" },
  qualification_incomplete: { label: "Automated qualification suite", owner: "platform", note: "Runs automatically once every other gate above is closed.", anchor: "#runtime-gate" },
  replica_not_ready: { label: "Approved voice and behavior", owner: "platform", note: "Depends on the gates above being closed first.", anchor: "#runtime-gate" },
};

function activeScopes(consents: ConsentReceipt[]) {
  const now = Date.now();
  return new Set(
    consents
      .filter((receipt) => !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > now))
      .map((receipt) => receipt.scope),
  );
}

function jumpTo(anchor: string) {
  const target = document.querySelector(anchor);
  if (!target) return;
  const details = target.closest("details");
  if (details && !details.open) details.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function QuickStartPath({
  token,
  replica,
  consents,
  sources,
  onAuthError,
}: {
  token: string;
  replica: Replica;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  onAuthError: (cause: unknown) => void;
}) {
  const [runtime, setRuntime] = useState<ReplicaRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<ReturnType<typeof friendlyError> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorState(null);
    try {
      setRuntime(await readRuntimeStatus(token, replica.replica_id));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setErrorState(friendlyError(cause, "Locked-step status could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replica.replica_id, token]);

  useEffect(() => { void load(); }, [load]);

  const hasSourceConsent = REQUIRED_SOURCE_SCOPES.every((scope) => activeScopes(consents).has(scope));
  const hasOneSource = sources.length > 0;
  const draftReviewable = hasOneSource;

  const blockers = (runtime?.blockers ?? []).filter((code) => BLOCKER_META[code]);
  const youBlockers = blockers.filter((code) => BLOCKER_META[code].owner === "you");
  const platformBlockers = blockers.filter((code) => BLOCKER_META[code].owner === "platform");

  return (
    <section className="quickstart" aria-labelledby="quickstart-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your first AI, the short way</p>
          <h2 id="quickstart-title">Get to a reviewable draft first. The rest stays exactly as strict</h2>
          <p className="quickstart-sub">
            Nothing below is skipped or weakened. This just orders it: what you can do right now with a name, a
            subject, and one upload; what a reviewable draft looks like from that; and, honestly rather than optimistically,
            everything still locked, and who it is waiting on.
          </p>
        </div>
      </div>

      <ol className="quickstart-steps">
        <li className="quickstart-step done">
          <span className="quickstart-step-mark" aria-hidden="true">✓</span>
          <div>
            <strong>Name your AI</strong>
            <p>{replica.display_name}, created {new Date(replica.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.</p>
          </div>
        </li>
        <li className={`quickstart-step ${hasOneSource ? "done" : "next"}`}>
          <span className="quickstart-step-mark" aria-hidden="true">{hasOneSource ? "✓" : "2"}</span>
          <div>
            <strong>Add one recording, video, or document</strong>
            <p>
              {hasOneSource
                ? `${sources.length} source${sources.length === 1 ? "" : "s"} added.`
                : hasSourceConsent
                  ? "Add anything: a lecture recording, a PDF of notes, one YouTube download. One is enough to start."
                  : "Grant source permissions first, then add one file."}
            </p>
            {!hasOneSource && (
              <button type="button" className="text-button" onClick={() => jumpTo("#enrollment-workspace")}>
                Go to source upload
              </button>
            )}
          </div>
        </li>
        <li className="quickstart-step next">
          <span className="quickstart-step-mark" aria-hidden="true">3</span>
          <div>
            <strong>Confirm subject and teaching style</strong>
            <p>Subject, syllabus coverage, strictness and warmth, and the doubt-handling ladder, editable any time, saved separately from everything else.</p>
            <button type="button" className="text-button" onClick={() => jumpTo("#teacher-sheet-studio")}>
              Open the sheet review
            </button>
          </div>
        </li>
      </ol>

      {draftReviewable && (
        <div className="quickstart-draft-banner" role="status">
          <strong>Your draft is reviewable.</strong>
          <p>
            See exactly what a student would see and hear if your AI were published: the disclosure card and
            spoken opening are fixed and cannot be turned off.
          </p>
          <button type="button" className="button secondary-button" onClick={() => jumpTo("#disclosure-preview")}>
            Review the draft
          </button>
        </div>
      )}

      <div className="quickstart-locked" aria-labelledby="quickstart-locked-title">
        <h3 id="quickstart-locked-title">Still locked, and honestly not a wall</h3>
        {loading && !runtime ? (
          <p className="muted-copy">Checking what's actually still locked…</p>
        ) : errorState ? (
          <div className="runtime-error" role="alert">
            <span>{errorState.headline}. {errorState.detail}</span>
            <button type="button" onClick={() => void load()}>Retry</button>
          </div>
        ) : runtime?.active ? (
          <p className="quickstart-active-note">Your AI's runtime is active. Every gate below is already closed.</p>
        ) : blockers.length === 0 && !loading ? (
          <p className="quickstart-active-note">No launch gates are currently reported as closed for your AI.</p>
        ) : (
          <div className="quickstart-locked-columns">
            <div>
              <p className="quickstart-locked-owner">Waiting on you: {youBlockers.length}</p>
              {youBlockers.length === 0 ? <p className="muted-copy">Nothing is waiting on you right now.</p> : (
                <ul className="quickstart-locked-list">
                  {youBlockers.map((code) => (
                    <li key={code}>
                      <span>{BLOCKER_META[code].label}</span>
                      <small>{BLOCKER_META[code].note}</small>
                      <button type="button" className="text-button" onClick={() => jumpTo(BLOCKER_META[code].anchor)}>Go there</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="quickstart-locked-owner">Waiting on the platform: {platformBlockers.length}</p>
              {platformBlockers.length === 0 ? <p className="muted-copy">Nothing is waiting on us right now.</p> : (
                <ul className="quickstart-locked-list">
                  {platformBlockers.map((code) => (
                    <li key={code}>
                      <span>{BLOCKER_META[code].label}</span>
                      <small>{BLOCKER_META[code].note}</small>
                      <button type="button" className="text-button" onClick={() => jumpTo(BLOCKER_META[code].anchor)}>See status</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
