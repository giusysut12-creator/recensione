import { describe, expect, it } from "vitest";
import { normalizeGoogleItems, minimizeAuthorName } from "@/lib/sources/google/normalize";

const base = {
  placeId: "ChIJ123",
  title: "Pizzeria Da Mario",
  categoryName: "Pizzeria",
  address: "Via Roma 1, Milano",
  totalScore: 4.4,
  reviewsCount: 812,
  url: "https://www.google.com/maps/place/?q=place_id:ChIJ123",
};

describe("normalizeGoogleItems", () => {
  it("normalizza recensioni, luogo e minimizza il nome", () => {
    const res = normalizeGoogleItems([
      { ...base, reviewId: "r1", name: "Marco Rossi", reviewerId: "999", reviewerPhotoUrl: "x", stars: 5, text: "  Pizza   ottima,\r\n servizio veloce ", publishedAtDate: "2026-05-01T10:00:00.000Z", responseFromOwnerText: "Grazie!", reviewUrl: "https://g/r1" },
    ]);
    expect(res.place?.externalId).toBe("ChIJ123");
    expect(res.place?.rating).toBe(4.4);
    const r = res.reviews[0];
    expect(r.authorDisplay).toBe("Marco R.");
    expect(r.text).toBe("Pizza ottima,\n servizio veloce");
    expect(r.ownerReplyText).toBe("Grazie!");
    expect(r.reviewDate).toBe("2026-05-01T10:00:00.000Z");
    expect(JSON.stringify(r.raw)).not.toContain("999"); // niente ID del recensore
  });

  it("gestisce recensioni senza testo, date mancanti, duplicati e righe senza voto", () => {
    const res = normalizeGoogleItems([
      { ...base, reviewId: "a", stars: 4, text: null, publishedAtDate: null },
      { ...base, reviewId: "a", stars: 4, text: null },
      { ...base, reviewId: null, stars: null },
      { ...base, reviewId: "b", stars: 9, text: "x" },
      null,
    ]);
    expect(res.reviews).toHaveLength(1);
    expect(res.reviews[0].text).toBeNull();
    expect(res.reviews[0].reviewDate).toBeNull();
    const reasons = Object.fromEntries(res.skipped.map((s) => [s.reason, s.count]));
    expect(reasons).toMatchObject({ duplicate: 1, no_rating: 1, invalid_rating: 1, invalid_item: 1 });
  });

  it("genera un ID stabile quando manca reviewId", () => {
    const item = { ...base, stars: 3, text: "ok", name: "Anna", publishedAtDate: "2026-01-01T00:00:00Z" };
    const a = normalizeGoogleItems([item]).reviews[0].externalReviewId;
    const b = normalizeGoogleItems([item]).reviews[0].externalReviewId;
    expect(a).toMatch(/^h_/);
    expect(a).toBe(b);
  });

  it("cambia content hash se cambia il testo", () => {
    const a = normalizeGoogleItems([{ ...base, reviewId: "x", stars: 3, text: "ok" }]).reviews[0].contentHash;
    const b = normalizeGoogleItems([{ ...base, reviewId: "x", stars: 3, text: "ok!" }]).reviews[0].contentHash;
    expect(a).not.toBe(b);
  });

  it("attività senza recensioni: luogo presente, zero recensioni", () => {
    const res = normalizeGoogleItems([{ ...base }]);
    expect(res.place?.name).toBe("Pizzeria Da Mario");
    expect(res.reviews).toHaveLength(0);
  });
});

describe("formato reale dell'export Apify (campi ridotti)", () => {
  // Stessa forma di un export reale ricevuto dalla Console (nomi anonimizzati)
  const url = "https://www.google.com/maps/search/?api=1&query=Parco%20nazionale%20di%20Yellowstone&query_place_id=ChIJVVVVVVXlUVMRu-GPNDD5qKw";
  const items = [
    { title: "Parco nazionale di Yellowstone", url, stars: 3, name: "Anna B.", reviewUrl: "https://www.google.com/maps/reviews/data=!4m8!1sAAA?hl=it", text: null },
    { title: "Parco nazionale di Yellowstone", url, stars: 5, name: "Nome Cognome", reviewUrl: "https://www.google.com/maps/reviews/data=!4m8!1sBBB?hl=it", text: "A MUST see! It's like Heaven on Earth!" },
    { title: "Parco nazionale di Yellowstone", url, stars: 5, name: "utente.123", reviewUrl: "https://www.google.com/maps/reviews/data=!4m8!1sCCC?hl=it", text: "יש פה מהכל\nנופים יפים" },
  ];

  it("conserva la traduzione e la lingua originale, non quella dell'interfaccia", () => {
    const res = normalizeGoogleItems([
      { ...items[2], reviewId: "x1", language: "it", originalLanguage: "iw", textTranslated: "Qui c'è di tutto", translatedLanguage: "it" },
      { ...items[0], reviewId: "x2", language: "it", originalLanguage: null, textTranslated: null },
    ]);
    expect(res.reviews[0]).toMatchObject({ language: "iw", textTranslated: "Qui c'è di tutto", translatedLanguage: "it" });
    expect(res.reviews[1]).toMatchObject({ language: null, textTranslated: null });
  });

  it("ricava il placeId dall'URL e un ID stabile dall'URL della recensione", () => {
    const res = normalizeGoogleItems(items);
    expect(res.place).toMatchObject({ externalId: "ChIJVVVVVVXlUVMRu-GPNDD5qKw", name: "Parco nazionale di Yellowstone" });
    expect(res.reviews).toHaveLength(3);
    expect(new Set(res.reviews.map((r) => r.externalReviewId)).size).toBe(3);
    expect(res.reviews.every((r) => r.externalReviewId.startsWith("u_"))).toBe(true);
    expect(normalizeGoogleItems(items).reviews[1].externalReviewId).toBe(res.reviews[1].externalReviewId);
  });

  it("mantiene testo in qualsiasi lingua e voti senza testo", () => {
    const res = normalizeGoogleItems(items);
    expect(res.reviews[0].text).toBeNull();
    expect(res.reviews[2].text).toContain("נופים");
    expect(res.reviews[0].language).toBeNull();
    expect(res.reviews[1].authorDisplay).toBe("Nome C.");
  });
});

describe("minimizeAuthorName", () => {
  it("riduce il cognome all'iniziale", () => {
    expect(minimizeAuthorName("Giulia  De Santis")).toBe("Giulia S.");
    expect(minimizeAuthorName("Luca")).toBe("Luca");
    expect(minimizeAuthorName(null)).toBeNull();
  });
});
