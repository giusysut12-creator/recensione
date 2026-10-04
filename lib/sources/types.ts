/**
 * Modello comune a tutte le fonti di recensioni (Google oggi; Trustpilot, Shopify,
 * WooCommerce domani). Ogni adapter produce questi oggetti: il resto dell'app non
 * conosce la fonte.
 */
export type ReviewPlatform = "google" | "trustpilot" | "shopify" | "woocommerce" | "other";

export interface NormalizedReview {
  source: ReviewPlatform;
  externalReviewId: string;
  authorDisplay: string | null;
  rating: number; // 1..5
  text: string | null;
  language: string | null;
  reviewDate: string | null; // ISO
  ownerReplyText: string | null;
  ownerReplyDate: string | null; // ISO
  reviewUrl: string | null;
  contentHash: string;
  raw: Record<string, unknown> | null;
}

export interface NormalizedPlace {
  platform: ReviewPlatform;
  externalId: string; // Google: placeId
  name: string;
  category: string | null;
  address: string | null;
  websiteUrl: string | null;
  canonicalUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface NormalizationResult {
  place: NormalizedPlace | null;
  reviews: NormalizedReview[];
  skipped: { reason: string; count: number }[];
}
