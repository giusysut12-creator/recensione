import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AIOutputError, type LLMProvider, type ModelTier, type StructuredRequest, type StructuredResponse } from "../provider";

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-4-5", // estrazione per recensione e raggruppamento temi
  smart: "claude-opus-5-5", // sintesi degli insight
};

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    private models: Partial<Record<ModelTier, string>> = {},
    workspaceId?: string,
  ) {
    // Le chiavi non legate a un workspace richiedono l'header anthropic-workspace-id
    this.client = new Anthropic({
      apiKey,
      maxRetries: 3,
      defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
    });
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier] || DEFAULT_MODELS[tier];
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const model = this.modelFor(req.tier);
    const maxTokens = req.maxTokens ?? 16000;

    if (req.tier === "smart") {
      // Modello capace: thinking adattivo, effort esplicito, fallback lato server
      // in caso di rifiuto dei classificatori di sicurezza.
      const res = await this.client.beta.messages.parse({
        model,
        max_tokens: maxTokens,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(req.schema) },
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      if (res.stop_reason === "refusal") throw new AIOutputError("Richiesta rifiutata dal modello", "refusal");
      if (res.stop_reason === "max_tokens") throw new AIOutputError("Risposta troncata", "truncated");
      if (!res.parsed_output) throw new AIOutputError("Output non valido", "invalid_output");
      return {
        data: res.parsed_output as T,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        model: res.model,
      };
    }

    const res = await this.client.messages.parse({
      model,
      max_tokens: maxTokens,
      output_config: { format: zodOutputFormat(req.schema) },
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    });
    if (res.stop_reason === "refusal") throw new AIOutputError("Richiesta rifiutata dal modello", "refusal");
    if (res.stop_reason === "max_tokens") throw new AIOutputError("Risposta troncata", "truncated");
    if (!res.parsed_output) throw new AIOutputError("Output non valido", "invalid_output");
    return {
      data: res.parsed_output as T,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      model: res.model,
    };
  }
}
