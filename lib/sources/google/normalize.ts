import { createHash } from "node:crypto";
import type { NormalizationResult, NormalizedPlace, NormalizedReview } from "../types";

/**
 * Normalizzazione dell'output dell'Actor Apify "Google Maps Reviews Scraper".
 *
 * La mappatura è volutamente difensiva: i nomi dei campi sono quelli documentati
 * dall'Actor (reviewId, stars, text, publishedAtDate, responseFromOwnerText,
 * reviewUrl, placeId, totalScore, ...) ma ogni campo è opzionale e verificato
 * per tipo. Dati del recensore (ID, profilo, foto) non vengono conservati.
 */

type Item = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const isoDate = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** "Marco Rossi" → "Marco R." — non serve altro per leggere una recensione. */
export function minimizeAuthorName(name: string | null): string | null {
  if (!name) return null;
  const parts = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0].slice(0, 30);
  if (parts.length === 1) return first;
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

export function cleanReviewText(text: string | null): string | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 10000) : null;
}

export function contentHash(rating: number, text: string | null): string {
  return createHash("sha256").update(`${rating}\u0000${text ?? ""}`).digest("hex").slice(0, 32);
}

/** placeId dal campo dedicato o, in sua assenza, dal parametro query_place_id dell'URL della scheda. */
function placeIdOf(item: Item): string | null {
  const direct = str(item.placeId);
  if (direct) return direct;
  const url = str(item.url);
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("query_place_id");
  } catch {
    return null;
  }
}

function extractPlace(item: Item): NormalizedPlace | null {
  const placeId = placeIdOf(item);
  const name = str(item.title) ?? str(item.placeName);
  if (!placeId || !name) return null;
  return {
    platform: "google",
    externalId: placeId,
    name,
    category: str(item.categoryName),
    address: str(item.address),
    websiteUrl: str(item.website),
    canonicalUrl: str(item.url),
    rating: num(item.totalScore),
    reviewCount: num(item.reviewsCount),
  };
}

export function normalizeGoogleItems(items: unknown[]): NormalizationResult {
  let place: NormalizedPlace | null = null;
  const byId = new Map<string, NormalizedReview>();
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const raw of items) {
    if (!raw || typeof raw !== "object") {
      skip("invalid_item");
      continue;
    }
    const item = raw as Item;
    if (!place) place = extractPlace(item);

    const ratingRaw = num(item.stars) ?? num(item.rating);
    if (ratingRaw === null) {
      // Riga che descrive solo il luogo (es. attività senza recensioni) o dato incompleto
      skip("no_rating");
      continue;
    }
    const rating = Math.round(ratingRaw);
    if (rating < 1 || rating > 5) {
      skip("invalid_rating");
      continue;
    }

    // Testo originale: preferiamo l'originale alla traduzione di Google
    const text = cleanReviewText(str(item.text));
    const reviewDate = isoDate(item.publishedAtDate);
    const authorDisplay = minimizeAuthorName(str(item.name) ?? str(item.reviewerName));
    const hash = contentHash(rating, text);
    // ID: reviewId dell'Actor; altrimenti l'URL della recensione (stabile e univoco);
    // in ultima istanza un hash di autore, data e contenuto.
    const reviewUrl = str(item.reviewUrl);
    const externalReviewId =
      str(item.reviewId) ??
      (reviewUrl ? `u_${createHash("sha256").update(reviewUrl).digest("hex").slice(0, 32)}` : null) ??
      `h_${createHash("sha256").update(`${authorDisplay ?? ""}|${reviewDate ?? ""}|${hash}`).digest("hex").slice(0, 24)}`;

    if (byId.has(externalReviewId)) {
      skip("duplicate");
      continue;
    }

    byId.set(externalReviewId, {
      source: "google",
      externalReviewId,
      authorDisplay,
      rating,
      text,
      // "language" dell'Actor è la lingua richiesta, non quella della recensione
      language: text ? str(item.originalLanguage) : null,
      textTranslated: text ? cleanReviewText(str(item.textTranslated)) : null,
      translatedLanguage: text && str(item.textTranslated) ? str(item.translatedLanguage) : null,
      reviewDate,
      ownerReplyText: cleanReviewText(str(item.responseFromOwnerText)),
      ownerReplyDate: isoDate(item.responseFromOwnerDate),
      reviewUrl,
      contentHash: hash,
      raw: {
        // Sottoinsieme minimo e non identificativo, utile per debug
        publishAt: str(item.publishAt),
        likesCount: num(item.likesCount),
      },
    });
  }

  return {
    place,
    reviews: [...byId.values()],
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}
