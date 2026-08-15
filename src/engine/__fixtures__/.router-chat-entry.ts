// Bundle entry for scripts/verify-chat-lane-route.mjs — WS-MANIFEST's Phase D
// prep ticket (docs/SPEC.md §7.3): "brain.ts consults router.route() for the
// chat lane ... the returned model must equal today's hardcoded choice,
// asserted in a fixture." Re-exports the REAL source (never a frozen copy —
// same discipline byte-identity.mjs's own header states) so the proof is
// against the code that actually ships, not a description of it.
export { OPENROUTER_DEFAULT_MODEL, routeChatLane, CHAT_LANE_MODELS, CHAT_LANE_CONFIG } from "../brain";
export { route } from "../router";
