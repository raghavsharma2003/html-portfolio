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
  "asr_unconfigured",
]);

export function isCapabilityAbsence(code) {
  return CAPABILITY_ABSENCE_CODES.includes(String(code || "").trim());
}
