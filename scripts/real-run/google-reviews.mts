/**
 * Test reale della raccolta recensioni Google, senza Supabase né AI.
 *
 * Usa lo stesso codice dell'app (validazione URL, input dell'Actor, normalizzazione)
 * contro Apify vero, e stampa un rapporto sui dati ricevuti.
 *
 *   APIFY_TOKEN=... node scripts/real-run/google-reviews.mts "<link Google Maps>" [maxReviews] [cartellaOutput]
 *
 * Il dataset grezzo viene salvato solo se si indica una cartella di output (fuori dal repo).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApifyClient } from "apify-client";
import { resolveGoogleUrl } from "../../lib/sources/google/url.ts";
import { buildActorInput } from "../../lib/sources/google/actor-input.ts";
import { normalizeGoogleItems } from "../../lib/sources/google/normalize.ts";

const [link, maxArg, outDir] = process.argv.slice(2);
if (!link || !process.env.APIFY_TOKEN) {
  console.error('Uso: APIFY_TOKEN=... node scripts/real-run/google-reviews.mts "<link>" [maxReviews] [cartellaOutput]');
  process.exit(1);
}
const maxReviews = Number(maxArg ?? 100);
const actorId = process.env.APIFY_GOOGLE_REVIEWS_ACTOR ?? "compass/google-maps-reviews-scraper";
const maxCharge = Number(process.env.APIFY_MAX_CHARGE_USD ?? 0.5);

const resolved = await resolveGoogleUrl(link);
if (!resolved.ok || !resolved.url) {
  console.error("URL non valido:", resolved.code);
  process.exit(1);
}
console.log("URL canonico:", resolved.url);

const input = buildActorInput(resolved.url, maxReviews);
console.log("Input Actor:", JSON.stringify(input));

const client = new ApifyClient({ token: process.env.APIFY_TOKEN });
const started = Date.now();
const run = await client.actor(actorId).call(input, {
  timeout: 600,
  maxItems: maxReviews + 5,
  maxTotalChargeUsd: maxCharge,
});
const secs = Math.round((Date.now() - started) / 1000);
console.log(`Run ${run.id}: ${run.status} in ${secs}s, costo $${(run.usageTotalUsd ?? 0).toFixed(3)}`);
if (run.status !== "SUCCEEDED") process.exit(1);

const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true, limit: maxReviews + 5 });
if (outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "dataset.json"), JSON.stringify(items, null, 2));
}

// Campi presenti nell'output reale
const fields = new Map<string, number>();
for (const it of items) for (const k of Object.keys(it)) fields.set(k, (fields.get(k) ?? 0) + 1);
console.log(`\nElementi nel dataset: ${items.length}`);
console.log("Campi (presenza):", [...fields].map(([k, n]) => `${k}:${n}`).join(" "));

const result = normalizeGoogleItems(items);
const reviews = result.reviews;
const withText = reviews.filter((r) => r.text);
const count = <T,>(xs: T[], key: (x: T) => string) =>
  Object.fromEntries([...xs.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map<string, number>())].sort());

console.log("\nLuogo:", result.place);
console.log("Recensioni normalizzate:", reviews.length, "· scartate:", JSON.stringify(result.skipped));
console.log("Con testo:", withText.length, "· con traduzione:", reviews.filter((r) => r.textTranslated).length);
console.log("Con risposta del titolare:", reviews.filter((r) => r.ownerReplyText).length);
console.log("Stelle:", JSON.stringify(count(reviews, (r) => String(r.rating))));
console.log("Lingue:", JSON.stringify(count(withText, (r) => r.language ?? "?")));
console.log("Senza data:", reviews.filter((r) => !r.reviewDate).length, "· senza URL:", reviews.filter((r) => !r.reviewUrl).length);
console.log("ID da reviewId:", reviews.filter((r) => !/^[uh]_/.test(r.externalReviewId)).length);
console.log("Autori visibili:", reviews.filter((r) => r.authorDisplay && r.authorDisplay !== "Cliente").length);
const dates = reviews.map((r) => r.reviewDate).filter(Boolean).sort() as string[];
console.log("Periodo:", dates[0]?.slice(0, 10), "→", dates.at(-1)?.slice(0, 10));
