import type { LLMProvider, TokenUsage } from "./provider";
import { EXTRACTION_SYSTEM, SYNTHESIS_SYSTEM, THEMES_SYSTEM } from "./prompts";
import {
  ExtractionBatchSchema,
  SIGNAL_KINDS,
  SynthesisSchema,
  ThemesSchema,
  type ExtractedReview,
  type SignalKind,
  type Severity,
  type Sentiment,
  type SynthesisOutput,
} from "./schemas";
import { locateQuote } from "./quotes";
import type { AggregationResult, SectionItem } from "@/lib/insights/aggregate";

/**
 * Task AI dell'applicazione. Ogni task:
 *  - prepara un input compatto,
 *  - chiama il provider con uno schema,
 *  - VALIDA l'output con regole di codice (citazioni, riferimenti, limiti).
 */

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});
const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };

// ---------------------------------------------------------------------------
// 1. Estrazione segnali per recensione
// ---------------------------------------------------------------------------

export interface ReviewForExtraction {
  id: string;
  rating: number;
  text: string;
}

export interface VerifiedSignal {
  kind: SignalKind;
  topic: string;
  label: string;
  quote: string;
  quoteStart: number;
  quoteEnd: number;
  severity: Severity;
}

export interface VerifiedExtraction {
  reviewId: string;
  sentiment: Sentiment;
  sentimentIntensity: number;
  severity: Severity;
  topics: string[];
  signals: VerifiedSignal[];
  droppedSignals: number; // segnali scartati perché la citazione non è nel testo
}

const MAX_SIGNALS_PER_REVIEW = 12;

const normTopic = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);

export function verifyExtraction(review: ReviewForExtraction, out: ExtractedReview): VerifiedExtraction {
  const signals: VerifiedSignal[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const s of out.signals) {
    if (!SIGNAL_KINDS.includes(s.kind)) {
      dropped++;
      continue;
    }
    const match = locateQuote(review.text, s.quote);
    const topic = normTopic(s.topic);
    const label = s.label.trim().slice(0, 200);
    if (!match || !topic || !label) {
      dropped++;
      continue;
    }
    const key = `${s.kind}|${topic}|${match.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({
      kind: s.kind,
      topic,
      label,
      quote: match.quote,
      quoteStart: match.start,
      quoteEnd: match.end,
      severity: s.severity,
    });
    if (signals.length >= MAX_SIGNALS_PER_REVIEW) break;
  }
  const intensity = Math.min(3, Math.max(1, Math.round(out.sentiment_intensity || 1)));
  return {
    reviewId: review.id,
    sentiment: out.sentiment,
    sentimentIntensity: intensity,
    severity: out.severity,
    topics: [...new Set(out.topics.map(normTopic).filter(Boolean))].slice(0, 10),
    signals,
    droppedSignals: dropped,
  };
}

function formatReviewsForPrompt(reviews: ReviewForExtraction[]): string {
  const blocks = reviews.map(
    (r, i) => `<review ref="r${i + 1}" stelle="${r.rating}">\n${r.text.replace(/<\/?review/gi, "")}\n</review>`,
  );
  return `Analizza le seguenti ${reviews.length} recensioni. Restituisci un elemento per ciascun ref.\n\n${blocks.join("\n\n")}`;
}

export async function extractReviewSignals(
  provider: LLMProvider,
  reviews: ReviewForExtraction[],
): Promise<{ results: VerifiedExtraction[]; missing: string[]; usage: TokenUsage; model: string }> {
  if (reviews.length === 0) return { results: [], missing: [], usage: ZERO, model: provider.modelFor("fast") };
  const res = await provider.generateStructured({
    tier: "fast",
    system: EXTRACTION_SYSTEM,
    user: formatReviewsForPrompt(reviews),
    schema: ExtractionBatchSchema,
    schemaName: "review_extraction",
    maxTokens: Math.min(16000, 600 + reviews.length * 700),
  });
  const byRef = new Map(res.data.reviews.map((r) => [r.ref.trim().toLowerCase(), r]));
  const results: VerifiedExtraction[] = [];
  const missing: string[] = [];
  reviews.forEach((review, i) => {
    const out = byRef.get(`r${i + 1}`);
    if (!out) missing.push(review.id);
    else results.push(verifyExtraction(review, out));
  });
  return { results, missing, usage: res.usage, model: res.model };
}

// ---------------------------------------------------------------------------
// 2. Consolidamento dei temi
// ---------------------------------------------------------------------------

export interface TopicStat {
  topic: string;
  count: number;
}

export interface ThemeAssignment {
  themes: { key: string; label: string; description: string }[];
  topicToTheme: Map<string, string>;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tema"
  );
}

export function buildThemeAssignment(topics: TopicStat[], out: { themes: { key: string; label: string; description: string; topics: string[] }[] }): ThemeAssignment {
  const known = new Map(topics.map((t) => [normTopic(t.topic), t.topic]));
  const topicToTheme = new Map<string, string>();
  const themes: ThemeAssignment["themes"] = [];
  const usedKeys = new Set<string>();

  const addTheme = (key: string, label: string, description: string) => {
    if (usedKeys.has(key)) return;
    usedKeys.add(key);
    themes.push({ key, label: label.trim().slice(0, 60) || key, description: description.trim().slice(0, 300) });
  };

  for (const t of out.themes) {
    // Un tema "altro" mescolerebbe argomenti diversi in un unico conteggio: lo scomponiamo
    if (slugify(t.key || t.label) === "altro") continue;
    // Se lo stesso key compare due volte, i topic confluiscono nel tema già esistente
    const key = slugify(t.key || t.label);
    addTheme(key, t.label, t.description);
    for (const raw of t.topics) {
      const original = known.get(normTopic(raw));
      if (original && !topicToTheme.has(original)) topicToTheme.set(original, key);
    }
  }

  // Topic non raggruppati: ognuno resta un tema a sé (mai sommati tra loro)
  for (const t of topics) {
    if (topicToTheme.has(t.topic)) continue;
    let key = `t-${slugify(t.topic)}`;
    if (usedKeys.has(key)) key = `${key}-${themes.length}`; // due topic con lo stesso slug restano distinti
    addTheme(key, t.topic.charAt(0).toUpperCase() + t.topic.slice(1), "");
    topicToTheme.set(t.topic, key);
  }

  // Rimuove temi rimasti vuoti
  const usedThemeKeys = new Set(topicToTheme.values());
  return { themes: themes.filter((t) => usedThemeKeys.has(t.key)), topicToTheme };
}

export async function consolidateThemes(
  provider: LLMProvider,
  topics: TopicStat[],
): Promise<{ assignment: ThemeAssignment; usage: TokenUsage; model: string }> {
  if (topics.length === 0) {
    return { assignment: { themes: [], topicToTheme: new Map() }, usage: ZERO, model: provider.modelFor("fast") };
  }
  const list = [...topics]
    .sort((a, b) => b.count - a.count)
    .map((t) => `- ${t.topic} (${t.count})`)
    .join("\n");
  const res = await provider.generateStructured({
    tier: "fast",
    system: THEMES_SYSTEM,
    user: `Topic estratti (frequenza tra parentesi):\n${list}`,
    schema: ThemesSchema,
    schemaName: "themes",
    maxTokens: 8000,
  });
  return { assignment: buildThemeAssignment(topics, res.data), usage: res.usage, model: res.model };
}

// ---------------------------------------------------------------------------
// 3. Sintesi (interpretazione) — riceve solo dati aggregati
// ---------------------------------------------------------------------------

const SECTION_NAMES: Record<string, string> = {
  why_choose: "Perché ti scelgono",
  love: "Cosa amano",
  disappoint: "Cosa li delude",
  confusion: "Cosa non capiscono",
  desires: "Cosa vorrebbero",
  unmet_expectations: "Aspettative disattese",
  objections: "Cosa potrebbe bloccare l'acquisto",
  language: "Le parole che usano",
};

function itemForPrompt(i: SectionItem) {
  const m = i.metrics;
  return {
    id: i.id,
    sezione: SECTION_NAMES[i.section],
    tema: i.themeLabel,
    recensioni: m.reviewCount,
    base: m.base,
    quota: m.share !== null ? `${Math.round(m.share * 100)}%` : "base troppo piccola per una percentuale",
    rating_medio: m.avgRating,
    segnale_debole: m.weak,
    andamento: m.trend ? m.trend.direction : "non calcolabile",
    cosa_dicono: i.labels,
    citazioni: i.examples.map((e) => `${e.rating}★ "${e.quote}"`),
  };
}

export interface SynthesisInput {
  businessName: string;
  category: string | null;
  aggregation: AggregationResult;
}

export function buildSynthesisPrompt(input: SynthesisInput): { prompt: string; itemIds: Set<string>; themeKeys: Set<string> } {
  const { overview, sections, comparisons } = input.aggregation;
  const items = Object.values(sections).flat();
  const payload = {
    attivita: { nome: input.businessName, categoria: input.category },
    panoramica: {
      recensioni_analizzate: overview.reviewsAnalyzed,
      recensioni_totali: overview.reviewsTotal,
      rating_medio: overview.avgRating,
      distribuzione_stelle: overview.ratingDistribution,
      periodo: { da: overview.periodFrom, a: overview.periodTo },
      temi_principali: overview.topThemes.map((t) => ({ tema: t.label, recensioni: t.reviewCount, positive: t.positive, negative: t.negative })),
    },
    elementi: items.map(itemForPrompt),
    confronti: comparisons.map((c) => ({
      theme_key: c.themeKey,
      tema: c.themeLabel,
      recensioni_positive: c.positive.reviewCount,
      recensioni_negative: c.negative.reviewCount,
      citazioni_positive: c.positive.examples.map((e) => `"${e.quote}"`),
      citazioni_negative: c.negative.examples.map((e) => `"${e.quote}"`),
    })),
  };
  return {
    prompt: `Dati calcolati dalle recensioni (JSON):\n${JSON.stringify(payload, null, 1)}\n\nScrivi l'interpretazione per ogni elemento (stesso id), per ogni confronto (stesso theme_key), le opportunità e la headline.`,
    itemIds: new Set(items.map((i) => i.id)),
    themeKeys: new Set(comparisons.map((c) => c.themeKey)),
  };
}

/** Elimina riferimenti inesistenti e duplicati: l'AI non può creare evidenze. */
export function validateSynthesis(out: SynthesisOutput, itemIds: Set<string>, themeKeys: Set<string>): SynthesisOutput {
  const seenItems = new Set<string>();
  const seenThemes = new Set<string>();
  return {
    headline: out.headline.trim().slice(0, 800),
    items: out.items
      .filter((i) => itemIds.has(i.id) && !seenItems.has(i.id) && seenItems.add(i.id))
      .map((i) => ({ ...i, title: i.title.trim().slice(0, 100), interpretation: i.interpretation.trim().slice(0, 600) })),
    comparisons: out.comparisons
      .filter((c) => themeKeys.has(c.theme_key) && !seenThemes.has(c.theme_key) && seenThemes.add(c.theme_key))
      .map((c) => ({ ...c, interpretation: c.interpretation.trim().slice(0, 600) })),
    opportunities: out.opportunities
      .map((o) => ({ ...o, based_on: [...new Set(o.based_on.filter((id) => itemIds.has(id)))] }))
      .filter((o) => o.based_on.length > 0)
      .slice(0, 6)
      .map((o) => ({ ...o, title: o.title.trim().slice(0, 120), rationale: o.rationale.trim().slice(0, 600) })),
  };
}

export async function synthesizeInsights(
  provider: LLMProvider,
  input: SynthesisInput,
): Promise<{ synthesis: SynthesisOutput; usage: TokenUsage; model: string }> {
  const { prompt, itemIds, themeKeys } = buildSynthesisPrompt(input);
  if (itemIds.size === 0) {
    return {
      synthesis: { headline: "", items: [], comparisons: [], opportunities: [] },
      usage: ZERO,
      model: provider.modelFor("smart"),
    };
  }
  const res = await provider.generateStructured({
    tier: "smart",
    system: SYNTHESIS_SYSTEM,
    user: prompt,
    schema: SynthesisSchema,
    schemaName: "synthesis",
    maxTokens: 16000,
  });
  return { synthesis: validateSynthesis(res.data, itemIds, themeKeys), usage: res.usage, model: res.model };
}

export { addUsage, ZERO as ZERO_USAGE };
