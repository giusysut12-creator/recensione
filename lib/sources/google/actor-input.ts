/**
 * Input dell'Actor. Nomi dei campi verificati sul JSON di input della Console Apify:
 * startUrls, maxReviews, reviewsSort, language, personalData, reviewsStartDate (AAAA-MM-GG).
 */
export function buildActorInput(
  placeUrl: string,
  maxReviews: number,
  options: { since?: string | null; extra?: Record<string, unknown> } = {},
): Record<string, unknown> {
  return {
    ...(options.extra ?? {}),
    startUrls: [{ url: placeUrl }],
    maxReviews,
    reviewsSort: "newest",
    language: "it", // lingua delle traduzioni automatiche di Google mostrate all'utente
    personalData: false, // non riceviamo nome, ID, profilo e foto dei recensori
    ...(options.since ? { reviewsStartDate: options.since.slice(0, 10) } : {}),
  };
}
