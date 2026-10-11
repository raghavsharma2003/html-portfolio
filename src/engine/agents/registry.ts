// Static fixture modules used by compiler and safety suites. Published Vyakti
// agents are constructed from their stored sheets and are never selected from
// a process-wide default.
import type { AgentModule } from "./types";
import { kabirAgent } from "./kabir";
import { demoTeacherAgent } from "./teacher";

const REGISTRY: Record<string, AgentModule> = {
  // The existence proof (RelationalOS R2): a second personality composed
  // from the SAME core, differing only by its character sheet. Registering
  // him puts his module under the per-module invariant floor (G-E3) on
  // every eval run. He has no vy_agent row yet — runtime use needs one;
  // compile-time gating does not.
  kabir: kabirAgent,
  // Gurukul WS-A: the demo teacher (TeacherSheet on the same core). Registered
  // for the SAME reason Kabir is — the per-module safety floor
  // (evals/persona-invariants.mjs) asks the registry for what exists and runs
  // safetyFloorChecks() against every entry, so registering is how a teacher
  // module gets gated rather than trusted. He is FICTIONAL, has no vy_agent
  // row and no consent artifact, and must not be reachable at runtime: WS-B's
  // publish path is where a real teacher's consent row gates registration
  // (docs/gurukul/safety-floor-teacher.md §2.2 — revocation deregisters the
  // module rather than asking the clone to stop).
  "teacher-demo-arjun": demoTeacherAgent,
};

export function getAgent(slug: string): AgentModule | undefined {
  return REGISTRY[slug];
}

export function listAgents(): readonly AgentModule[] {
  return Object.values(REGISTRY);
}
