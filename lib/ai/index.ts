import "server-only";
import { env } from "@/lib/env";
import type { LLMProvider } from "./provider";
import { AnthropicProvider } from "./providers/anthropic";
import { OpenAIProvider } from "./providers/openai";

let provider: LLMProvider | null = null;

export function getProvider(): LLMProvider {
  if (provider) return provider;
  const e = env();
  if (e.AI_PROVIDER === "openai") {
    if (!e.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY mancante");
    if (!e.AI_MODEL_FAST || !e.AI_MODEL_SMART) throw new Error("Con AI_PROVIDER=openai servono AI_MODEL_FAST e AI_MODEL_SMART");
    provider = new OpenAIProvider(e.OPENAI_API_KEY, { fast: e.AI_MODEL_FAST, smart: e.AI_MODEL_SMART });
  } else {
    if (!e.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY mancante");
    provider = new AnthropicProvider(e.ANTHROPIC_API_KEY, { fast: e.AI_MODEL_FAST, smart: e.AI_MODEL_SMART });
  }
  return provider;
}

/** Solo per i test: inietta un provider finto. */
export function setProviderForTests(p: LLMProvider | null) {
  provider = p;
}
