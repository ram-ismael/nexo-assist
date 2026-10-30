import type { MastraModelConfig } from "@mastra/core/llm";
import { config } from "@/lib/config";
import { AppError } from "@/server/errors";

export type ResolvedModel = { model: MastraModelConfig; id: string };

/**
 * Resolves the configured model. There is no silent fallback: without a key the
 * agent reports itself unavailable instead of answering with canned text.
 */
export async function resolveModel(): Promise<ResolvedModel> {
  const env = config();
  if (env.NEXO_SCRIPTED_MODEL) {
    const { createScriptedModel } = await import("./scripted-model");
    // Mastra bundles its own copy of the provider types; the runtime contract is
    // the same LanguageModelV4, only the declaration files differ.
    return {
      model: createScriptedModel() as unknown as MastraModelConfig,
      id: "scripted-test-model",
    };
  }
  const [provider, ...rest] = env.LLM_MODEL.split("/");
  const modelName = rest.join("/");
  if (provider !== "anthropic" || !modelName) {
    throw new AppError("unavailable", "O modelo de IA configurado não é suportado.");
  }
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(
      "unavailable",
      "O assistente está indisponível: o provedor de IA não está configurado.",
    );
  }
  // Mastra's model router with an explicit key: the key comes from validated
  // server config instead of being read implicitly from process.env.
  return {
    model: { id: `anthropic/${modelName}` as const, apiKey: env.ANTHROPIC_API_KEY },
    id: env.LLM_MODEL,
  };
}
