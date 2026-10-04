import type { SignalKind } from "@/lib/ai/schemas";

/**
 * Aggregazione deterministica. Tutti i numeri mostrati all'utente nascono qui,
 * a partire dai segnali verificati: l'AI non calcola conteggi né percentuali.
 */

export type SectionKey =
  | "why_choose"
  | "love"
  | "disappoint"
  | "confusion"
  | "desires"
  | "unmet_expectations"
  | "objections"
  | "language";

export const SECTION_KINDS: Record<SectionKey, SignalKind[]> = {
  why_choose: ["purchase_driver"],
  love: ["positive_driver"],
  disappoint: ["pain_point"],
  confusion: ["confusion"],
  desires: ["desire", "requested_feature"],
  unmet_expectations: ["unmet_expectation"],
  objections: ["objection"],
  language: ["customer_language"],
};

// Soglie statistiche (vedi docs/PHASE1_PLAN.md §6.3)
export const THRESHOLDS = {
  minBaseForShare: 20,
  weakSignalBelow: 3,
  minItemCount: 2,
  minTrendHalf: 15,
  minTrendDelta: 0.05,
  maxItemsPerSection: 8,
  maxExamples: 4,
  minComparisonSide: 2,
  maxComparisons: 4,
};

export interface AggReview {
  id: string;
  rating: number;
  text: string | null;
  reviewDate: string | null;
  hasOwnerReply: boolean;
}

export interface AggExtraction {
  reviewId: string;
  sentiment: "positive" | "mixed" | "negative" | "neutral" | null;
}

export interface AggSignal {
  id: string;
  reviewId: string;
  kind: SignalKind;
  label: string;
  quote: string;
  severity: "none" | "low" | "medium" | "high" | null;
  themeKey: string;
}

export interface AggTheme {
  key: string;
  label: string;
}

export interface Example {
  reviewId: string;
  signalId: string;
  quote: string;
  rating: number;
  reviewDate: string | null;
}

export interface Trend {
  direction: "in_aumento" | "in_calo" | "stabile";
  recentShare: number;
  olderShare: number;
  splitDate: string;
}

export interface ItemMetrics {
  reviewCount: number;
  base: number;
  share: number | null; // null se la base è troppo piccola
  avgRating: number | null;
  weak: boolean;
  trend: Trend | null;
  severity: { high: number; medium: number; low: number } | null;
  ratingSplit: { positive: number; neutral: number; negative: number };
}

export interface SectionItem {
  id: string; // es. "disappoint:consegna"
  section: SectionKey;
  themeKey: string;
  themeLabel: string;
  metrics: ItemMetrics;
  examples: Example[];
  labels: string[]; // etichette dei segnali più frequenti
  evidence: { reviewId: string; signalId: string }[];
}

export interface ComparisonItem {
  id: string; // "comparison:<theme>"
  themeKey: string;
  themeLabel: string;
  positive: { reviewCount: number; examples: Example[] };
  negative: { reviewCount: number; examples: Example[] };
  evidence: { reviewId: string; signalId: string; role: "supporting" | "contrasting" }[];
}

export interface Overview {
  reviewsTotal: number;
  reviewsWithText: number;
  reviewsAnalyzed: number;
  extractionFailed: number;
  avgRating: number | null;
  ratingDistribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  sentiment: Record<"positive" | "mixed" | "negative" | "neutral", number>;
  periodFrom: string | null;
  periodTo: string | null;
  ownerReplyRate: number | null;
  topThemes: { key: string; label: string; reviewCount: number; positive: number; negative: number }[];
}

export interface AggregationResult {
  overview: Overview;
  sections: Record<SectionKey, SectionItem[]>;
  comparisons: ComparisonItem[];
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function wordCount(s: string) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Sceglie esempi rappresentativi: citazioni di lunghezza utile, recensioni diverse, più recenti prima. */
function pickExamples(signals: AggSignal[], reviews: Map<string, AggReview>, max: number): Example[] {
  const seen = new Set<string>();
  const seenQuotes = new Set<string>();
  const scored = signals
    .map((s) => {
      const r = reviews.get(s.reviewId)!;
      const wc = wordCount(s.quote);
      const lengthScore = wc >= 5 && wc <= 25 ? 2 : wc >= 3 ? 1 : 0;
      return { s, r, score: lengthScore, date: r.reviewDate ?? "" };
    })
    .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
  const out: Example[] = [];
  for (const { s, r } of scored) {
    const q = s.quote.toLowerCase().replace(/\s+/g, " ").trim();
    // Esempi diversi tra loro: stessa recensione o stessa frase una volta sola
    if (seen.has(s.reviewId) || seenQuotes.has(q)) continue;
    seen.add(s.reviewId);
    seenQuotes.add(q);
    out.push({ reviewId: s.reviewId, signalId: s.id, quote: s.quote, rating: r.rating, reviewDate: r.reviewDate });
    if (out.length >= max) break;
  }
  return out;
}

function medianDate(dates: string[]): string | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return sorted[Math.floor(sorted.length / 2)];
}

export function aggregate(input: {
  reviews: AggReview[];
  extractions: AggExtraction[];
  signals: AggSignal[];
  themes: AggTheme[];
  extractionFailed: number;
}): AggregationResult {
  const reviews = new Map(input.reviews.map((r) => [r.id, r]));
  const themeLabel = new Map(input.themes.map((t) => [t.key, t.label]));
  const analyzedIds = new Set(input.extractions.map((e) => e.reviewId));
  const base = analyzedIds.size;

  // Trend: dividiamo le recensioni analizzate con data in due metà
  const datedAnalyzed = input.reviews.filter((r) => analyzedIds.has(r.id) && r.reviewDate);
  const split = medianDate(datedAnalyzed.map((r) => r.reviewDate!));
  const recentIds = new Set(datedAnalyzed.filter((r) => split && r.reviewDate! >= split).map((r) => r.id));
  const olderIds = new Set(datedAnalyzed.filter((r) => split && r.reviewDate! < split).map((r) => r.id));
  const trendPossible =
    split !== null && recentIds.size >= THRESHOLDS.minTrendHalf && olderIds.size >= THRESHOLDS.minTrendHalf;

  const computeTrend = (reviewIds: Set<string>): Trend | null => {
    if (!trendPossible || !split) return null;
    let recent = 0;
    let older = 0;
    for (const id of reviewIds) {
      if (recentIds.has(id)) recent++;
      else if (olderIds.has(id)) older++;
    }
    const recentShare = recent / recentIds.size;
    const olderShare = older / olderIds.size;
    const delta = recentShare - olderShare;
    let direction: Trend["direction"] = "stabile";
    if (Math.abs(delta) >= THRESHOLDS.minTrendDelta && Math.max(recent, older) >= 3) {
      direction = delta > 0 ? "in_aumento" : "in_calo";
    }
    return { direction, recentShare: round(recentShare, 3), olderShare: round(olderShare, 3), splitDate: split };
  };

  const buildMetrics = (sigs: AggSignal[]): ItemMetrics => {
    const reviewIds = new Set(sigs.map((s) => s.reviewId));
    const ratings = [...reviewIds].map((id) => reviews.get(id)!.rating);
    const count = reviewIds.size;
    const sev = { high: 0, medium: 0, low: 0 };
    let anySeverity = false;
    for (const s of sigs) {
      if (s.severity === "high" || s.severity === "medium" || s.severity === "low") {
        sev[s.severity]++;
        anySeverity = true;
      }
    }
    return {
      reviewCount: count,
      base,
      share: base >= THRESHOLDS.minBaseForShare ? round(count / base, 3) : null,
      avgRating: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length, 1) : null,
      weak: count < THRESHOLDS.weakSignalBelow,
      trend: computeTrend(reviewIds),
      severity: anySeverity ? sev : null,
      ratingSplit: {
        positive: ratings.filter((r) => r >= 4).length,
        neutral: ratings.filter((r) => r === 3).length,
        negative: ratings.filter((r) => r <= 2).length,
      },
    };
  };

  // --- Sezioni ---
  const sections = {} as Record<SectionKey, SectionItem[]>;
  for (const [section, kinds] of Object.entries(SECTION_KINDS) as [SectionKey, SignalKind[]][]) {
    const byTheme = new Map<string, AggSignal[]>();
    for (const s of input.signals) {
      if (!kinds.includes(s.kind)) continue;
      const list = byTheme.get(s.themeKey) ?? [];
      list.push(s);
      byTheme.set(s.themeKey, list);
    }
    let items: SectionItem[] = [...byTheme.entries()].map(([themeKey, sigs]) => {
      const labelCounts = new Map<string, number>();
      for (const s of sigs) labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);
      return {
        id: `${section}:${themeKey}`,
        section,
        themeKey,
        themeLabel: themeLabel.get(themeKey) ?? themeKey,
        metrics: buildMetrics(sigs),
        examples: pickExamples(sigs, reviews, THRESHOLDS.maxExamples),
        labels: [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l),
        evidence: sigs.map((s) => ({ reviewId: s.reviewId, signalId: s.id })),
      };
    });
    const sevScore = (i: SectionItem) => (i.metrics.severity ? i.metrics.severity.high * 3 + i.metrics.severity.medium : 0);
    items.sort((a, b) => b.metrics.reviewCount - a.metrics.reviewCount || sevScore(b) - sevScore(a));
    const strong = items.filter((i) => i.metrics.reviewCount >= THRESHOLDS.minItemCount);
    // Se una sezione ha solo casi isolati, li mostriamo comunque come segnali deboli
    items = (strong.length > 0 ? strong : items.slice(0, 3)).slice(0, THRESHOLDS.maxItemsPerSection);
    sections[section] = items;
  }

  // --- Confronto positivo vs negativo sullo stesso tema ---
  const positiveKinds: SignalKind[] = ["positive_driver", "purchase_driver"];
  const negativeKinds: SignalKind[] = ["pain_point", "unmet_expectation"];
  const comparisons: ComparisonItem[] = [];
  const themeKeys = new Set(input.signals.map((s) => s.themeKey));
  for (const key of themeKeys) {
    if (key === "altro") continue;
    const pos = input.signals.filter(
      (s) => s.themeKey === key && positiveKinds.includes(s.kind) && reviews.get(s.reviewId)!.rating >= 4,
    );
    const neg = input.signals.filter(
      (s) => s.themeKey === key && negativeKinds.includes(s.kind) && reviews.get(s.reviewId)!.rating <= 2,
    );
    const posReviews = new Set(pos.map((s) => s.reviewId)).size;
    const negReviews = new Set(neg.map((s) => s.reviewId)).size;
    if (posReviews < THRESHOLDS.minComparisonSide || negReviews < THRESHOLDS.minComparisonSide) continue;
    comparisons.push({
      id: `comparison:${key}`,
      themeKey: key,
      themeLabel: themeLabel.get(key) ?? key,
      positive: { reviewCount: posReviews, examples: pickExamples(pos, reviews, 3) },
      negative: { reviewCount: negReviews, examples: pickExamples(neg, reviews, 3) },
      evidence: [
        ...pos.map((s) => ({ reviewId: s.reviewId, signalId: s.id, role: "supporting" as const })),
        ...neg.map((s) => ({ reviewId: s.reviewId, signalId: s.id, role: "contrasting" as const })),
      ],
    });
  }
  comparisons.sort(
    (a, b) =>
      Math.min(b.positive.reviewCount, b.negative.reviewCount) - Math.min(a.positive.reviewCount, a.negative.reviewCount),
  );

  // --- Panoramica ---
  const all = input.reviews;
  const dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 } as Overview["ratingDistribution"];
  for (const r of all) dist[String(r.rating) as keyof typeof dist]++;
  const sentiment = { positive: 0, mixed: 0, negative: 0, neutral: 0 };
  for (const e of input.extractions) if (e.sentiment) sentiment[e.sentiment]++;
  const dates = all.map((r) => r.reviewDate).filter((d): d is string => !!d).sort();
  const withText = all.filter((r) => r.text).length;

  const themeStats = new Map<string, { reviews: Set<string>; pos: Set<string>; neg: Set<string> }>();
  for (const s of input.signals) {
    if (s.kind === "customer_language") continue;
    const st = themeStats.get(s.themeKey) ?? { reviews: new Set(), pos: new Set(), neg: new Set() };
    st.reviews.add(s.reviewId);
    const rating = reviews.get(s.reviewId)!.rating;
    if (rating >= 4) st.pos.add(s.reviewId);
    if (rating <= 2) st.neg.add(s.reviewId);
    themeStats.set(s.themeKey, st);
  }
  const topThemes = [...themeStats.entries()]
    .filter(([k]) => k !== "altro")
    .map(([key, st]) => ({
      key,
      label: themeLabel.get(key) ?? key,
      reviewCount: st.reviews.size,
      positive: st.pos.size,
      negative: st.neg.size,
    }))
    .sort((a, b) => b.reviewCount - a.reviewCount)
    .slice(0, 8);

  const overview: Overview = {
    reviewsTotal: all.length,
    reviewsWithText: withText,
    reviewsAnalyzed: base,
    extractionFailed: input.extractionFailed,
    avgRating: all.length ? round(all.reduce((a, r) => a + r.rating, 0) / all.length, 2) : null,
    ratingDistribution: dist,
    sentiment,
    periodFrom: dates[0] ?? null,
    periodTo: dates[dates.length - 1] ?? null,
    ownerReplyRate: all.length ? round(all.filter((r) => r.hasOwnerReply).length / all.length, 3) : null,
    topThemes,
  };

  return { overview, sections, comparisons };
}
