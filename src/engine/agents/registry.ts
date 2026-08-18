// The agent registry — SPEC-AGENT-LAYER.md §3, §6. One place that knows
// every AgentModule this build carries, and the fixed id that ties Meera's
// module to her `vy_agent` row.
import type { AgentModule } from "./types";
import { meeraAgent } from "./meera";

// Mirrors db/migrations/009_agents.sql's fixed constant — read directly out
// of that file (its own header: "mirrored in db/schema.sql and (when it
// exists) src/engine/agents/registry.ts, asserted equal by
// scripts/verify-agent-id.mjs — the same mirrored-not-imported pattern as
// OPERATIONAL_CORE_CAP"). WS-AGENT-SCHEMA's migration landed with this exact
// v4-shaped uuid ("agent one"); do not hand-edit without re-reading that
// file, and do not invent a replacement — a mismatch here is a silent
// data-corruption bug (rows get written under the wrong agent_id).
export const MEERA_AGENT_ID = "a0000000-0000-4000-8000-000000000001";

const REGISTRY: Record<string, AgentModule> = {
  meera: meeraAgent,
};

// The default injected into compiler.ts's CompileInput.agent — keeps every
// existing call site correct (SPEC-AGENT-LAYER.md §3 / §7 G-E2) while the
// rest of the stack learns to pass an explicit agent.
export const DEFAULT_AGENT: AgentModule = meeraAgent;

export function getAgent(slug: string): AgentModule | undefined {
  return REGISTRY[slug];
}

export function listAgents(): readonly AgentModule[] {
  return Object.values(REGISTRY);
}
