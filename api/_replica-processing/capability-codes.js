// The codes that mean "this platform has not deployed the thing", as distinct
// from "this recording is bad".
//
// This is a LEAF module on purpose. Two very different places need this set:
// `composition.js`, which decides what to requeue once a capability lands, and
// `api/_replica-activity.js`, which decides whether the owner is shown a next
// action they can act on or one they cannot. The activity surface is
// deliberately pure and dependency-light so an eval can drive it with an
// awkward row and no database, and importing the provider chain into it just to
// learn five strings would take that away.
//
// The distinction these codes draw is the one the owner feels. A capability
// absence is on us: the recording is fine, nothing they can do helps, and it
// recovers by itself the moment the capability arrives. A real failure is about
// the bytes, and only a different upload fixes it. Telling someone to upload
// their file again because OUR scanner is not deployed is a lie with a button
// on it.
export const CAPABILITY_ABSENCE_CODES = Object.freeze([
  "private_storage_not_configured",
  "malware_scanner_unavailable",
  "media_probe_tool_unavailable",
  "reference_window_tool_unavailable",
  "voice_evidence_unconfigured",
  // Configured but temporarily unavailable is still a platform capability
  // problem. A different recording cannot wake or repair the private GPU, so
  // these must recover through the worker rather than asking for re-upload.
  "voice_evidence_unreachable",
  "voice_evidence_not_ready",
  // Private input transport is a platform-owned condition, including jobs
  // exhausted before a corrected streamed reader was deployed. Requeueing is
  // safe because integrity, MIME and size failures have separate permanent
  // codes and can never match this entry.
  "azure_asr_input_unavailable",
  "asr_unconfigured",
]);

export function isCapabilityAbsence(code) {
  return CAPABILITY_ABSENCE_CODES.includes(String(code || "").trim());
}
