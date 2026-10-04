import { z } from "zod";

/**
 * Schemi di output dell'AI. Sono volutamente semplici (enum, stringhe, array):
 * i vincoli più fini (citazioni verificate, riferimenti esistenti, limiti) sono
 * applicati dal codice dopo la risposta.
 */

export const SIGNAL_KINDS = [
  "purchase_driver",
  "positive_driver",
  "pain_point",
  "confusion",
  "desire",
  "requested_feature",
  "unmet_expectation",
  "objection",
  "customer_language",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SEVERITIES = ["none", "low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SENTIMENTS = ["positive", "mixed", "negative", "neutral"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

// --- 1. Estrazione per recensione -----------------------------------------

export const ExtractedSignalSchema = z.object({
  kind: z.enum(SIGNAL_KINDS),
  topic: z.string().describe("Tema breve in italiano, 1-3 parole, minuscolo (es. 'tempi di consegna')"),
  label: z.string().describe("Cosa dice il cliente, in italiano, max 12 parole, senza aggiungere nulla"),
  quote: z.string().describe("Frase copiata ESATTAMENTE dal testo della recensione, max 25 parole"),
  severity: z.enum(SEVERITIES),
});

export const ExtractedReviewSchema = z.object({
  ref: z.string().describe("Il riferimento della recensione, es. r3"),
  sentiment: z.enum(SENTIMENTS),
  sentiment_intensity: z.number().int().describe("1 = lieve, 2 = moderata, 3 = forte"),
  severity: z.enum(SEVERITIES).describe("Gravità del problema raccontato; none se non c'è un problema"),
  topics: z.array(z.string()),
  signals: z.array(ExtractedSignalSchema),
});

export const ExtractionBatchSchema = z.object({
  reviews: z.array(ExtractedReviewSchema),
});
export type ExtractionBatch = z.infer<typeof ExtractionBatchSchema>;
export type ExtractedReview = z.infer<typeof ExtractedReviewSchema>;
export type ExtractedSignal = z.infer<typeof ExtractedSignalSchema>;

// --- 2. Consolidamento temi ------------------------------------------------

export const ThemesSchema = z.object({
  themes: z.array(
    z.object({
      key: z.string().describe("slug minuscolo senza spazi, es. 'assistenza'"),
      label: z.string().describe("Nome breve per un imprenditore, es. 'Assistenza clienti'"),
      description: z.string().describe("Cosa comprende il tema, una frase"),
      topics: z.array(z.string()).describe("I topic grezzi assegnati a questo tema, copiati esattamente"),
    }),
  ),
});
export type ThemesOutput = z.infer<typeof ThemesSchema>;

// --- 3. Sintesi ------------------------------------------------------------

export const CONFIDENCE = ["alta", "media", "bassa"] as const;

export const SynthesisSchema = z.object({
  headline: z.string().describe("2-3 frasi: cosa emerge di più importante per l'attività"),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string().describe("Titolo breve e concreto, max 8 parole"),
      interpretation: z.string().describe("1-2 frasi: cosa potrebbe significare per l'attività. Linguaggio prudente."),
      confidence: z.enum(CONFIDENCE),
    }),
  ),
  comparisons: z.array(
    z.object({
      theme_key: z.string(),
      interpretation: z.string().describe("Cosa distingue le esperienze positive da quelle negative su questo tema. Mai causalità."),
      confidence: z.enum(CONFIDENCE),
    }),
  ),
  opportunities: z.array(
    z.object({
      type: z.enum(["correggere", "comunicare", "sviluppare"]),
      title: z.string().describe("Azione concreta, max 10 parole"),
      rationale: z.string().describe("Perché, collegato ai dati, 1-2 frasi"),
      based_on: z.array(z.string()).describe("id degli elementi su cui si basa"),
      confidence: z.enum(CONFIDENCE),
    }),
  ),
});
export type SynthesisOutput = z.infer<typeof SynthesisSchema>;
