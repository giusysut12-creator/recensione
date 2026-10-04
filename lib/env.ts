import "server-only";
import { z } from "zod";

/**
 * Configurazione server-side. Nessuna di queste variabili deve avere il prefisso
 * NEXT_PUBLIC_: non arrivano mai al browser.
 */
const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  APIFY_TOKEN: z.string().min(1),
  APIFY_GOOGLE_REVIEWS_ACTOR: z.string().default("compass/google-maps-reviews-scraper"),
  // JSON con input aggiuntivi per l'Actor (es. lingua), da usare solo dopo averli
  // verificati sull'input schema dell'Actor.
  APIFY_EXTRA_INPUT: z.string().optional(),
  // Solo per test locali (servizio simulato). In produzione lasciare vuoto.
  APIFY_BASE_URL: z.string().url().optional(),

  AI_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),
  AI_MODEL_FAST: z.string().optional(),
  AI_MODEL_SMART: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Accesso riservato: codice condiviso + segreto per firmare il cookie di sessione
  APP_ACCESS_CODE: z.string().min(6),
  APP_SESSION_SECRET: z.string().min(32),

  MAX_REVIEWS_PER_ANALYSIS: z.coerce.number().int().min(10).max(2000).default(300),
  MAX_ANALYSES_PER_DAY: z.coerce.number().int().min(1).default(30),
  MAX_ANALYSES_PER_HOUR_PER_CLIENT: z.coerce.number().int().min(1).default(5),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configurazione server incompleta: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}
