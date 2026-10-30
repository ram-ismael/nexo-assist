import { Agent } from "@mastra/core/agent";
import { AGENT_INSTRUCTIONS } from "./instructions";
import type { ResolvedModel } from "./model";
import { agentTools } from "./tools";

let cached: { id: string; agent: Agent } | null = null;

/** One Mastra agent per model id; it is stateless, state lives in Postgres. */
export function nexoAgent(resolved: ResolvedModel): Agent {
  if (cached?.id === resolved.id) return cached.agent;
  const agent = new Agent({
    id: "nexo-assist",
    name: "Nexo Assist",
    description: "Agent de atendimento do service desk de TI da Nexo",
    instructions: AGENT_INSTRUCTIONS,
    model: resolved.model,
    tools: agentTools,
  });
  cached = { id: resolved.id, agent };
  return agent;
}
