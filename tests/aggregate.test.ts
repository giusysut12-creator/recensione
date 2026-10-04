import { describe, expect, it } from "vitest";
import { aggregate, type AggReview, type AggSignal } from "@/lib/insights/aggregate";

function makeData() {
  const reviews: AggReview[] = [];
  const signals: AggSignal[] = [];
  // 40 recensioni con testo, date su 2 anni
  for (let i = 0; i < 40; i++) {
    const rating = i < 28 ? 5 : i < 32 ? 3 : 1;
    const date = new Date(Date.UTC(2024, 0, 1) + i * 18 * 864e5).toISOString();
    reviews.push({ id: `r${i}`, rating, text: `testo ${i}`, reviewDate: date, hasOwnerReply: i % 2 === 0 });
  }
  reviews.push({ id: "silent", rating: 4, text: null, reviewDate: null, hasOwnerReply: false });
  // "personale" amato in 10 recensioni positive
  for (let i = 0; i < 10; i++) signals.push({ id: `s-love-${i}`, reviewId: `r${i}`, kind: "positive_driver", label: "Personale gentile", quote: "personale gentilissimo e disponibile", severity: "none", themeKey: "personale" });
  // "attesa": problema in 6 recensioni negative/neutre, più frequente di recente (r30..r39)
  for (let i = 34; i < 40; i++) signals.push({ id: `s-pain-${i}`, reviewId: `r${i}`, kind: "pain_point", label: "Attesa lunga", quote: "abbiamo aspettato quaranta minuti", severity: i === 39 ? "high" : "medium", themeKey: "attesa" });
  // "attesa" anche positiva in 3 recensioni 5 stelle → confronto
  for (let i = 10; i < 13; i++) signals.push({ id: `s-att-${i}`, reviewId: `r${i}`, kind: "positive_driver", label: "Servizio veloce", quote: "serviti in pochi minuti", severity: "none", themeKey: "attesa" });
  // un caso isolato di obiezione
  signals.push({ id: "s-obj", reviewId: "r5", kind: "objection", label: "Prezzo alto", quote: "un po' caro", severity: "low", themeKey: "prezzo" });
  const extractions = reviews.filter((r) => r.text).map((r) => ({ reviewId: r.id, sentiment: (r.rating >= 4 ? "positive" : r.rating <= 2 ? "negative" : "mixed") as "positive" | "negative" | "mixed" }));
  return {
    reviews,
    signals,
    extractions,
    themes: [
      { key: "personale", label: "Personale" },
      { key: "attesa", label: "Tempi di attesa" },
      { key: "prezzo", label: "Prezzo" },
    ],
    extractionFailed: 0,
  };
}

describe("aggregate", () => {
  const res = aggregate(makeData());

  it("calcola la panoramica dai dati, non da stime", () => {
    expect(res.overview.reviewsTotal).toBe(41);
    expect(res.overview.reviewsWithText).toBe(40);
    expect(res.overview.reviewsAnalyzed).toBe(40);
    expect(res.overview.ratingDistribution).toEqual({ "1": 8, "2": 0, "3": 4, "4": 1, "5": 28 });
    expect(res.overview.sentiment.positive).toBe(28);
    expect(res.overview.topThemes[0]).toMatchObject({ key: "personale", reviewCount: 10, positive: 10, negative: 0 });
  });

  it("conta recensioni distinte, quota sulla base e rating medio", () => {
    const love = res.sections.love.find((i) => i.themeKey === "personale")!;
    expect(love.metrics.reviewCount).toBe(10);
    expect(love.metrics.base).toBe(40);
    expect(love.metrics.share).toBe(0.25);
    expect(love.metrics.avgRating).toBe(5);
    expect(love.evidence).toHaveLength(10);
    expect(love.examples.length).toBeLessThanOrEqual(4);
  });

  it("rileva un problema in aumento nel periodo recente", () => {
    const pain = res.sections.disappoint[0];
    expect(pain.themeKey).toBe("attesa");
    expect(pain.metrics.trend?.direction).toBe("in_aumento");
    expect(pain.metrics.severity).toEqual({ high: 1, medium: 5, low: 0 });
  });

  it("segnala come deboli i casi isolati invece di nasconderli o gonfiarli", () => {
    const obj = res.sections.objections;
    expect(obj).toHaveLength(1);
    expect(obj[0].metrics.weak).toBe(true);
    expect(res.sections.confusion).toHaveLength(0);
  });

  it("costruisce il confronto positivo vs negativo sullo stesso tema", () => {
    expect(res.comparisons).toHaveLength(1);
    const c = res.comparisons[0];
    expect(c.themeKey).toBe("attesa");
    expect(c.positive.reviewCount).toBe(3);
    expect(c.negative.reviewCount).toBe(6);
    expect(c.evidence.filter((e) => e.role === "contrasting")).toHaveLength(6);
  });

  it("non mostra percentuali con una base troppo piccola", () => {
    const d = makeData();
    const small = aggregate({ ...d, reviews: d.reviews.slice(0, 10), extractions: d.extractions.slice(0, 10), signals: d.signals.filter((s) => Number(s.reviewId.slice(1)) < 10) });
    expect(small.sections.love[0].metrics.share).toBeNull();
    expect(small.sections.love[0].metrics.trend).toBeNull();
  });
});
