import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { AIOutputError, type LLMProvider, type ModelTier, type StructuredRequest, type StructuredResponse } from "../provider";

/**
 * Provider OpenAI (alternativo). I modelli vanno indicati esplicitamente via
 * AI_MODEL_FAST / AI_MODEL_SMART: non ipotizziamo nomi di modello.
 */
export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(
    apiKey: string,
    private models: Record<ModelTier, string>,
  ) {
    this.client = new OpenAI({ apiKey, maxRetries: 3 });
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>> {
    const model = this.modelFor(req.tier);
    const res = await this.client.responses.parse({
      model,
      max_output_tokens: req.maxTokens ?? 16000,
      instructions: req.system,
      input: req.user,
      text: { format: zodTextFormat(req.schema, req.schemaName) },
    });
    if (res.status === "incomplete") throw new AIOutputError("Risposta troncata", "truncated");
    if (!res.output_parsed) throw new AIOutputError("Output non valido", "invalid_output");
    return {
      data: res.output_parsed as T,
      usage: { inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 },
      model: res.model,
    };
  }
}
