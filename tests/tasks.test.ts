import { describe, expect, it } from "vitest";
import { buildThemeAssignment, extractReviewSignals, validateSynthesis, verifyExtraction } from "@/lib/ai/tasks";
import type { LLMProvider, StructuredRequest } from "@/lib/ai/provider";

const review = { id: "rev-1", rating: 2, text: "Cibo buono ma abbiamo aspettato un'ora per il secondo. Cameriere scortese." };

describe("verifyExtraction", () => {
  it("tiene solo segnali con citazione presente nel testo", () => {
    const v = verifyExtraction(review, {
      ref: "r1",
      sentiment: "mixed",
      sentiment_intensity: 7,
      severity: "medium",
      topics: ["Tempi di attesa", "tempi di attesa", "cortesia"],
      signals: [
        { kind: "pain_point", topic: "Tempi di attesa", label: "Attesa di un'ora", quote: "abbiamo aspettato un'ora per il secondo", severity: "medium" },
        { kind: "pain_point", topic: "cortesia", label: "Cameriere maleducato", quote: "il cameriere ci ha insultato", severity: "high" },
        { kind: "positive_driver", topic: "cibo", label: "Cibo buono", quote: "Cibo buono", severity: "none" },
      ],
    });
    expect(v.signals.map((s) => s.topic)).toEqual(["tempi di attesa", "cibo"]);
    expect(v.droppedSignals).toBe(1);
    expect(v.sentimentIntensity).toBe(3);
    expect(v.topics).toEqual(["tempi di attesa", "cortesia"]);
    expect(review.text.slice(v.signals[0].quoteStart, v.signals[0].quoteEnd)).toBe(v.signals[0].quote);
  });
});

describe("extractReviewSignals", () => {
  it("mappa i ref sulle recensioni e segnala quelle mancanti", async () => {
    const fake: LLMProvider = {
      name: "fake",
      modelFor: () => "fake-model",
      async generateStructured<T>(req: StructuredRequest<T>) {
        expect(req.user).toContain('ref="r2"');
        expect(req.tier).toBe("fast");
        const data = { reviews: [{ ref: "r1", sentiment: "positive", sentiment_intensity: 2, severity: "none", topics: [], signals: [] }] };
        return { data: data as T, usage: { inputTokens: 10, outputTokens: 5 }, model: "fake-model" };
      },
    };
    const res = await extractReviewSignals(fake, [review, { id: "rev-2", rating: 5, text: "Perfetto" }]);
    expect(res.results.map((r) => r.reviewId)).toEqual(["rev-1"]);
    expect(res.missing).toEqual(["rev-2"]);
  });
});

describe("buildThemeAssignment", () => {
  it("assegna i topic, unisce key duplicati e non somma mai topic diversi in 'altro'", () => {
    const topics = [
      { topic: "attesa", count: 5 },
      { topic: "tempi di attesa", count: 3 },
      { topic: "personale", count: 4 },
      { topic: "parcheggio", count: 1 },
      { topic: "musica", count: 1 },
    ];
    const a = buildThemeAssignment(topics, {
      themes: [
        { key: "Tempi Attesa", label: "Tempi di attesa", description: "", topics: ["Attesa"] },
        { key: "tempi-attesa", label: "Duplicato", description: "", topics: ["tempi di attesa", "inventato"] },
        { key: "personale", label: "Personale", description: "", topics: ["personale"] },
        { key: "vuoto", label: "Vuoto", description: "", topics: [] },
        { key: "altro", label: "Altro", description: "", topics: ["musica"] },
      ],
    });
    expect(a.topicToTheme.get("attesa")).toBe("tempi-attesa");
    expect(a.topicToTheme.get("tempi di attesa")).toBe("tempi-attesa");
    expect(a.topicToTheme.get("parcheggio")).toBe("t-parcheggio");
    expect(a.topicToTheme.get("musica")).toBe("t-musica");
    expect(a.themes.map((t) => t.key)).toEqual(["tempi-attesa", "personale", "t-parcheggio", "t-musica"]);
    expect(a.themes.find((t) => t.key === "t-musica")?.label).toBe("Musica");
  });
});

describe("validateSynthesis", () => {
  it("scarta riferimenti inventati dall'AI", () => {
    const out = validateSynthesis(
      {
        headline: "  Sintesi ",
        items: [
          { id: "love:personale", title: "Personale", interpretation: "x", confidence: "alta" },
          { id: "love:inventato", title: "?", interpretation: "x", confidence: "alta" },
        ],
        comparisons: [{ theme_key: "nope", interpretation: "x", confidence: "bassa" }],
        opportunities: [
          { type: "comunicare", title: "Valorizza il personale", rationale: "r", based_on: ["love:personale", "fake"], confidence: "media" },
          { type: "correggere", title: "Senza basi", rationale: "r", based_on: ["fake"], confidence: "alta" },
        ],
      },
      new Set(["love:personale"]),
      new Set(["attesa"]),
    );
    expect(out.headline).toBe("Sintesi");
    expect(out.items.map((i) => i.id)).toEqual(["love:personale"]);
    expect(out.comparisons).toHaveLength(0);
    expect(out.opportunities).toHaveLength(1);
    expect(out.opportunities[0].based_on).toEqual(["love:personale"]);
  });
});
