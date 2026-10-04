import type { z } from "zod";

/**
 * Astrazione del provider AI. Il resto dell'app usa solo i task in lib/ai/tasks.ts,
 * che a loro volta usano questa interfaccia: cambiare provider = cambiare env.
 */
export type ModelTier = "fast" | "smart";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredRequest<T> {
  tier: ModelTier;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens?: number;
}

export interface StructuredResponse<T> {
  data: T;
  usage: TokenUsage;
  model: string;
}

export interface LLMProvider {
  readonly name: string;
  modelFor(tier: ModelTier): string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<StructuredResponse<T>>;
}

export class AIOutputError extends Error {
  constructor(
    message: string,
    readonly reason: "refusal" | "truncated" | "invalid_output",
  ) {
    super(message);
  }
}
