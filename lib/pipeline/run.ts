import "server-only";
import { db, must, chunk } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getProvider } from "@/lib/ai";
import { AIOutputError, type TokenUsage } from "@/lib/ai/provider";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";
import {
  consolidateThemes,
  extractReviewSignals,
  synthesizeInsights,
  type ReviewForExtraction,
  type VerifiedExtraction,
} from "@/lib/ai/tasks";
import { aggregate, type AggSignal, type SectionItem } from "@/lib/insights/aggregate";
import { checkGoogleUrl, resolveGoogleUrl } from "@/lib/sources/google/url";
import { getRunState, readDataset, startGoogleReviewsRun } from "@/lib/sources/google/apify";
import { normalizeGoogleItems } from "@/lib/sources/google/normalize";
import type { SignalKind } from "@/lib/ai/schemas";
import { PipelineError } from "./errors";

export const PIPELINE_VERSION = "p1";

/** Durata massima di un passo: deve restare sotto il maxDuration della route. */
const LEASE_SECONDS = 290;
const STEP_BUDGET_MS = 200_000;
const EXTRACTION_BATCH_SIZE = 15;
const EXTRACTION_PARALLEL = 4;
const MAX_TRANSIENT_RETRIES = 6;

export type RunStatus =
  | "queued"
  | "resolving"
  | "scraping"
  | "importing"
  | "extracting"
  | "consolidating"
  | "synthesizing"
  | "completed"
  | "failed";

export interface RunRow {
  id: string;
  business_id: string | null;
  source_id: string | null;
  input_url: string;
  resolved_url: string | null;
  status: RunStatus;
  progress: Record<string, unknown>;
  error_code: string | null;
  error_detail: string | null;
  settings: { maxReviews: number };
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  token_usage: Record<string, TokenUsage>;
  models: Record<string, string>;
  summary: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Creazione
// ---------------------------------------------------------------------------

export async function createAnalysis(inputUrl: string, requesterHash: string): Promise<{ id: string; reused: boolean }> {
  const check = checkGoogleUrl(inputUrl);
  if (!check.ok) throw new PipelineError(check.code);
  const e = env();
  const normalizedInput = check.url.toString();

  // Stessa attività già in elaborazione (o appena completata): riusiamo l'analisi
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const existing = must(
    await db()
      .from("analysis_runs")
      .select("id,status")
      .eq("input_url", normalizedInput)
      .neq("status", "failed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1),
    "lookup run",
  ) as { id: string; status: string }[];
  if (existing.length > 0) return { id: existing[0].id, reused: true };

  // Rate limiting (contatori in Postgres, nessun servizio esterno)
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: daily } = await db().from("analysis_runs").select("id", { count: "exact", head: true }).gte("created_at", dayAgo);
  if ((daily ?? 0) >= e.MAX_ANALYSES_PER_DAY) throw new PipelineError("daily_limit");
  const { count: mine } = await db()
    .from("analysis_runs")
    .select("id", { count: "exact", head: true })
    .eq("requester_hash", requesterHash)
    .gte("created_at", since);
  if ((mine ?? 0) >= e.MAX_ANALYSES_PER_HOUR_PER_CLIENT) throw new PipelineError("rate_limited");

  const provider = getProvider();
  const row = must(
    await db()
      .from("analysis_runs")
      .insert({
        input_url: normalizedInput,
        status: "queued",
        settings: { maxReviews: e.MAX_REVIEWS_PER_ANALYSIS },
        pipeline_version: PIPELINE_VERSION,
        prompt_versions: PROMPT_VERSIONS,
        models: { provider: provider.name, fast: provider.modelFor("fast"), smart: provider.modelFor("smart") },
        requester_hash: requesterHash,
      })
      .select("id")
      .single(),
    "insert run",
  ) as { id: string };
  return { id: row.id, reused: false };
}

// ---------------------------------------------------------------------------
// Avanzamento (state machine)
// ---------------------------------------------------------------------------

async function getRun(runId: string): Promise<RunRow | null> {
  const rows = must(await db().from("analysis_runs").select("*").eq("id", runId).limit(1), "get run") as RunRow[];
  return rows[0] ?? null;
}

async function updateRun(runId: string, patch: Partial<RunRow> & Record<string, unknown>) {
  must(await db().from("analysis_runs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", runId), "update run");
}

async function addUsage(run: RunRow, step: string, usage: TokenUsage) {
  const current = run.token_usage?.[step] ?? { inputTokens: 0, outputTokens: 0 };
  run.token_usage = {
    ...(run.token_usage ?? {}),
    [step]: { inputTokens: current.inputTokens + usage.inputTokens, outputTokens: current.outputTokens + usage.outputTokens },
  };
  await updateRun(run.id, { token_usage: run.token_usage });
}

async function fail(run: RunRow, code: string, detail?: string) {
  await updateRun(run.id, { status: "failed", error_code: code, error_detail: detail?.slice(0, 1000) ?? null, locked_until: null });
}

/**
 * Esegue uno o più passi della pipeline entro un budget di tempo.
 * Idempotente e sicuro in concorrenza grazie al lock con scadenza (claim_run).
 */
export async function advanceRun(runId: string): Promise<{ run: RunRow | null; worked: boolean }> {
  const claimed = must(await db().rpc("claim_run", { p_run_id: runId, p_lease_seconds: LEASE_SECONDS }), "claim run") as RunRow[];
  if (!claimed || claimed.length === 0) return { run: await getRun(runId), worked: false }; // occupato o già terminato

  const run = claimed[0];
  const started = Date.now();
  try {
    // Esegue passi finché c'è budget; si ferma quando un passo non cambia stato
    // (attesa di Apify o estrazione che ha esaurito il budget del turno)
    while (Date.now() - started < STEP_BUDGET_MS) {
      const previous = run.status;
      const next = await step(run, started);
      run.status = next;
      if (next === previous || next === "completed" || next === "failed") break;
    }
    if (run.progress?.retries) {
      run.progress = { ...run.progress, retries: 0 };
      await updateRun(run.id, { progress: run.progress });
    }
  } catch (err) {
    if (err instanceof PipelineError) {
      await fail(run, err.code, err.message);
    } else {
      // Errore transitorio (rete, API): riproveremo al prossimo avanzamento
      const retries = Number(run.progress?.retries ?? 0) + 1;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[pipeline] run ${run.id} step ${run.status} error (retry ${retries}):`, message);
      if (retries >= MAX_TRANSIENT_RETRIES) {
        const collecting = ["queued", "resolving", "scraping", "importing"].includes(run.status);
        await fail(run, collecting ? "scrape_failed" : "analysis_failed", message);
      } else {
        await updateRun(run.id, { progress: { ...run.progress, retries, lastError: message.slice(0, 300) } });
      }
    }
  } finally {
    await db().from("analysis_runs").update({ locked_until: null }).eq("id", run.id);
  }
  return { run: await getRun(runId), worked: true };
}

export const isTerminal = (status: string | undefined) => status === "completed" || status === "failed";

async function step(run: RunRow, started: number): Promise<RunStatus> {
  switch (run.status) {
    case "queued":
    case "resolving":
      return stepResolveAndStart(run);
    case "scraping":
      return stepScraping(run);
    case "importing":
      return stepImport(run);
    case "extracting":
      return stepExtract(run, started);
    case "consolidating":
      return stepThemes(run);
    case "synthesizing":
      return stepSynthesize(run);
    default:
      return run.status;
  }
}

// --- 1. URL → avvio Apify ----------------------------------------------------

async function stepResolveAndStart(run: RunRow): Promise<RunStatus> {
  await updateRun(run.id, { status: "resolving" });
  const resolved = await resolveGoogleUrl(run.input_url);
  if (!resolved.ok || !resolved.url) throw new PipelineError(resolved.code ?? "invalid_url");
  const { runId, datasetId } = await startGoogleReviewsRun(resolved.url, run.settings.maxReviews);
  run.resolved_url = resolved.url;
  run.apify_run_id = runId;
  run.apify_dataset_id = datasetId;
  run.progress = { ...run.progress, scrapingStartedAt: new Date().toISOString() };
  await updateRun(run.id, {
    status: "scraping",
    resolved_url: resolved.url,
    apify_run_id: runId,
    apify_dataset_id: datasetId,
    progress: run.progress,
  });
  return "scraping";
}

// --- 2. Attesa raccolta -------------------------------------------------------

async function stepScraping(run: RunRow): Promise<RunStatus> {
  if (!run.apify_run_id) throw new PipelineError("scrape_failed", "apify_run_id mancante");
  const { state, status } = await getRunState(run.apify_run_id, 25);
  if (state === "running") {
    run.progress = { ...run.progress, apifyStatus: status };
    await updateRun(run.id, { progress: run.progress });
    return "scraping";
  }
  if (state === "failed") throw new PipelineError("scrape_failed", `Apify: ${status}`);
  await updateRun(run.id, { status: "importing" });
  return "importing";
}

// --- 3. Import e normalizzazione ----------------------------------------------

async function stepImport(run: RunRow): Promise<RunStatus> {
  if (!run.apify_dataset_id) throw new PipelineError("scrape_failed", "dataset mancante");
  const items = await readDataset(run.apify_dataset_id, run.settings.maxReviews + 50);
  const { place, reviews, skipped } = normalizeGoogleItems(items);

  if (!place && reviews.length === 0) throw new PipelineError("place_not_found", `items=${items.length}`);
  if (reviews.length === 0) {
    // Salviamo comunque l'attività per mostrare un messaggio chiaro
    if (place) await upsertPlace(run, place);
    throw new PipelineError("no_reviews");
  }

  const placeInfo = place ?? {
    platform: "google" as const,
    externalId: `url:${run.resolved_url}`,
    name: "La tua attività",
    category: null,
    address: null,
    websiteUrl: null,
    canonicalUrl: run.resolved_url,
    rating: null,
    reviewCount: null,
  };
  const { businessId, sourceId } = await upsertPlace(run, placeInfo);

  // Campione: le più recenti, fino al limite
  const sample = [...reviews]
    .sort((a, b) => (b.reviewDate ?? "").localeCompare(a.reviewDate ?? ""))
    .slice(0, run.settings.maxReviews);

  const now = new Date().toISOString();
  const idByExternal = new Map<string, string>();
  for (const part of chunk(sample, 200)) {
    const rows = must(
      await db()
        .from("reviews")
        .upsert(
          part.map((r) => ({
            source_id: sourceId,
            external_review_id: r.externalReviewId,
            author_display: r.authorDisplay,
            rating: r.rating,
            text: r.text,
            language: r.language,
            review_date: r.reviewDate,
            owner_reply_text: r.ownerReplyText,
            owner_reply_date: r.ownerReplyDate,
            review_url: r.reviewUrl,
            content_hash: r.contentHash,
            raw: r.raw,
            last_seen_at: now,
          })),
          { onConflict: "source_id,external_review_id" },
        )
        .select("id,external_review_id"),
      "upsert reviews",
    ) as { id: string; external_review_id: string }[];
    for (const row of rows) idByExternal.set(row.external_review_id, row.id);
  }

  await db().from("analysis_run_reviews").delete().eq("run_id", run.id);
  for (const part of chunk([...idByExternal.values()], 500)) {
    must(await db().from("analysis_run_reviews").insert(part.map((review_id) => ({ run_id: run.id, review_id }))), "insert sample");
  }

  run.business_id = businessId;
  run.source_id = sourceId;
  run.progress = {
    ...run.progress,
    found: sample.length,
    withText: sample.filter((r) => r.text).length,
    skipped,
  };
  await updateRun(run.id, { status: "extracting", business_id: businessId, source_id: sourceId, progress: run.progress });
  return "extracting";
}

async function upsertPlace(
  run: RunRow,
  place: NonNullable<ReturnType<typeof normalizeGoogleItems>["place"]>,
): Promise<{ businessId: string; sourceId: string }> {
  const existing = must(
    await db().from("sources").select("id,business_id").eq("platform", place.platform).eq("external_id", place.externalId).limit(1),
    "lookup source",
  ) as { id: string; business_id: string }[];

  const businessPatch = {
    name: place.name,
    category: place.category,
    address: place.address,
    website_url: place.websiteUrl,
    updated_at: new Date().toISOString(),
  };
  const sourcePatch = {
    canonical_url: place.canonicalUrl ?? run.resolved_url,
    platform_rating: place.rating,
    platform_review_count: place.reviewCount,
    last_fetched_at: new Date().toISOString(),
  };

  let businessId: string;
  let sourceId: string;
  if (existing.length > 0) {
    businessId = existing[0].business_id;
    sourceId = existing[0].id;
    must(await db().from("businesses").update(businessPatch).eq("id", businessId), "update business");
    must(await db().from("sources").update(sourcePatch).eq("id", sourceId), "update source");
  } else {
    const b = must(await db().from("businesses").insert(businessPatch).select("id").single(), "insert business") as { id: string };
    businessId = b.id;
    const s = must(
      await db()
        .from("sources")
        .insert({ business_id: businessId, platform: place.platform, external_id: place.externalId, ...sourcePatch })
        .select("id")
        .single(),
      "insert source",
    ) as { id: string };
    sourceId = s.id;
  }
  await updateRun(run.id, { business_id: businessId, source_id: sourceId });
  return { businessId, sourceId };
}

// --- 4. Estrazione AI (a lotti, con cache) -------------------------------------

interface SampleReview {
  id: string;
  rating: number;
  text: string | null;
  review_date: string | null;
  content_hash: string;
  owner_reply_text: string | null;
}

async function loadSample(runId: string): Promise<SampleReview[]> {
  const links = must(await db().from("analysis_run_reviews").select("review_id").eq("run_id", runId), "load sample ids") as {
    review_id: string;
  }[];
  const out: SampleReview[] = [];
  for (const part of chunk(links.map((l) => l.review_id), 100)) {
    const rows = must(
      await db().from("reviews").select("id,rating,text,review_date,content_hash,owner_reply_text").in("id", part),
      "load sample",
    ) as SampleReview[];
    out.push(...rows);
  }
  return out;
}

interface ExtractionRow {
  id: string;
  review_id: string;
  content_hash: string;
  status: "ok" | "failed";
  sentiment: "positive" | "mixed" | "negative" | "neutral" | null;
}

/** Estrazioni valide (stessa versione e stesso contenuto) per le recensioni del campione. */
async function loadCurrentExtractions(sample: SampleReview[]): Promise<Map<string, ExtractionRow>> {
  const hashById = new Map(sample.map((r) => [r.id, r.content_hash]));
  const out = new Map<string, ExtractionRow>();
  for (const part of chunk(sample.map((r) => r.id), 100)) {
    const rows = must(
      await db()
        .from("review_extractions")
        .select("id,review_id,content_hash,status,sentiment")
        .eq("extraction_version", PROMPT_VERSIONS.extraction)
        .in("review_id", part),
      "load extractions",
    ) as ExtractionRow[];
    for (const row of rows) if (hashById.get(row.review_id) === row.content_hash) out.set(row.review_id, row);
  }
  return out;
}

async function saveExtraction(review: SampleReview, model: string, ex: VerifiedExtraction | null) {
  const inserted = must(
    await db()
      .from("review_extractions")
      .upsert(
        {
          review_id: review.id,
          content_hash: review.content_hash,
          extraction_version: PROMPT_VERSIONS.extraction,
          status: ex ? "ok" : "failed",
          model,
          sentiment: ex?.sentiment ?? null,
          sentiment_intensity: ex?.sentimentIntensity ?? null,
          severity: ex?.severity ?? null,
          topics: ex?.topics ?? [],
          result: ex ? { droppedSignals: ex.droppedSignals, signalCount: ex.signals.length } : null,
        },
        { onConflict: "review_id,content_hash,extraction_version" },
      )
      .select("id")
      .single(),
    "save extraction",
  ) as { id: string };
  await db().from("review_signals").delete().eq("extraction_id", inserted.id);
  if (ex && ex.signals.length > 0) {
    must(
      await db()
        .from("review_signals")
        .insert(
          ex.signals.map((s) => ({
            extraction_id: inserted.id,
            review_id: review.id,
            kind: s.kind,
            topic: s.topic,
            label: s.label,
            quote: s.quote,
            quote_start: s.quoteStart,
            quote_end: s.quoteEnd,
            severity: s.severity,
          })),
        ),
      "save signals",
    );
  }
}

async function extractBatch(run: RunRow, batch: SampleReview[]): Promise<void> {
  const provider = getProvider();
  const input: ReviewForExtraction[] = batch.map((r) => ({ id: r.id, rating: r.rating, text: r.text! }));
  let results: VerifiedExtraction[] = [];
  let missing: string[] = [];
  let model = provider.modelFor("fast");
  try {
    const res = await extractReviewSignals(provider, input);
    results = res.results;
    missing = res.missing;
    model = res.model;
    await addUsage(run, "extraction", res.usage);
  } catch (err) {
    if (!(err instanceof AIOutputError)) throw err; // errore di rete/API: riprova più tardi
    missing = batch.map((r) => r.id);
  }
  const byId = new Map(batch.map((r) => [r.id, r]));
  for (const ex of results) await saveExtraction(byId.get(ex.reviewId)!, model, ex);

  // Recensioni mancanti o lotto non valido: un tentativo singolo, poi segnate come fallite
  for (const id of missing) {
    const review = byId.get(id)!;
    try {
      const res = await extractReviewSignals(provider, [{ id, rating: review.rating, text: review.text! }]);
      await addUsage(run, "extraction", res.usage);
      await saveExtraction(review, res.model, res.results[0] ?? null);
    } catch (err) {
      if (!(err instanceof AIOutputError)) throw err;
      await saveExtraction(review, model, null);
    }
  }
}

async function stepExtract(run: RunRow, started: number): Promise<RunStatus> {
  const sample = await loadSample(run.id);
  const withText = sample.filter((r) => r.text);
  const done = await loadCurrentExtractions(withText);
  const pending = withText.filter((r) => !done.has(r.id));

  const report = async (extracted: number) => {
    run.progress = { ...run.progress, toExtract: withText.length, extracted };
    await updateRun(run.id, { progress: run.progress });
  };
  await report(withText.length - pending.length);

  if (pending.length === 0) {
    await updateRun(run.id, { status: "consolidating" });
    return "consolidating";
  }

  const batches = chunk(pending, EXTRACTION_BATCH_SIZE);
  let processed = withText.length - pending.length;
  for (const group of chunk(batches, EXTRACTION_PARALLEL)) {
    if (Date.now() - started > STEP_BUDGET_MS * 0.6) break;
    const results = await Promise.allSettled(group.map((b) => extractBatch(run, b)));
    const failures = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    processed += group.filter((_, i) => results[i].status === "fulfilled").reduce((a, b) => a + b.length, 0);
    await report(processed);
    if (failures.length === group.length) throw failures[0].reason;
  }
  return "extracting";
}

// --- 5. Temi -------------------------------------------------------------------

interface SignalRow {
  id: string;
  review_id: string;
  extraction_id: string;
  kind: SignalKind;
  topic: string;
  label: string;
  quote: string;
  severity: AggSignal["severity"];
}

async function loadSignals(extractionIds: string[]): Promise<SignalRow[]> {
  const out: SignalRow[] = [];
  for (const part of chunk(extractionIds, 100)) {
    const rows = must(
      await db().from("review_signals").select("id,review_id,extraction_id,kind,topic,label,quote,severity").in("extraction_id", part),
      "load signals",
    ) as SignalRow[];
    out.push(...rows);
  }
  return out;
}

async function stepThemes(run: RunRow): Promise<RunStatus> {
  const sample = await loadSample(run.id);
  const extractions = await loadCurrentExtractions(sample.filter((r) => r.text));
  const okIds = [...extractions.values()].filter((e) => e.status === "ok").map((e) => e.id);
  const signals = await loadSignals(okIds);

  const topicReviews = new Map<string, Set<string>>();
  for (const s of signals) {
    const set = topicReviews.get(s.topic) ?? new Set();
    set.add(s.review_id);
    topicReviews.set(s.topic, set);
  }
  const topics = [...topicReviews.entries()].map(([topic, set]) => ({ topic, count: set.size }));

  const { assignment, usage } = await consolidateThemes(getProvider(), topics);
  await addUsage(run, "themes", usage);

  // Idempotenza: ricreiamo i temi del run
  await db().from("run_themes").delete().eq("run_id", run.id);
  const themeRows =
    assignment.themes.length > 0
      ? (must(
          await db()
            .from("run_themes")
            .insert(assignment.themes.map((t) => ({ run_id: run.id, key: t.key, label: t.label, description: t.description })))
            .select("id,key"),
          "insert themes",
        ) as { id: string; key: string }[])
      : [];
  const themeIdByKey = new Map(themeRows.map((t) => [t.key, t.id]));
  const links = signals
    .map((s) => ({ run_id: run.id, signal_id: s.id, theme_id: themeIdByKey.get(assignment.topicToTheme.get(s.topic) ?? "") }))
    .filter((l): l is { run_id: string; signal_id: string; theme_id: string } => !!l.theme_id);
  for (const part of chunk(links, 500)) must(await db().from("signal_themes").insert(part), "insert signal themes");

  await updateRun(run.id, { status: "synthesizing", progress: { ...run.progress, themes: assignment.themes.length } });
  return "synthesizing";
}

// --- 6. Aggregazione + sintesi + salvataggio insight ---------------------------

async function stepSynthesize(run: RunRow): Promise<RunStatus> {
  const sample = await loadSample(run.id);
  const extractions = await loadCurrentExtractions(sample.filter((r) => r.text));
  const ok = [...extractions.values()].filter((e) => e.status === "ok");
  const failedCount = [...extractions.values()].filter((e) => e.status === "failed").length;
  const signals = await loadSignals(ok.map((e) => e.id));

  const themes = must(await db().from("run_themes").select("id,key,label").eq("run_id", run.id), "load themes") as {
    id: string;
    key: string;
    label: string;
  }[];
  const themeKeyById = new Map(themes.map((t) => [t.id, t.key]));
  const themeIdByKey = new Map(themes.map((t) => [t.key, t.id]));
  const signalTheme = new Map<string, string>();
  for (const part of chunk(signals.map((s) => s.id), 100)) {
    const rows = must(
      await db().from("signal_themes").select("signal_id,theme_id").eq("run_id", run.id).in("signal_id", part),
      "load signal themes",
    ) as { signal_id: string; theme_id: string }[];
    for (const r of rows) signalTheme.set(r.signal_id, themeKeyById.get(r.theme_id)!);
  }

  const aggregation = aggregate({
    reviews: sample.map((r) => ({
      id: r.id,
      rating: r.rating,
      text: r.text,
      reviewDate: r.review_date,
      hasOwnerReply: !!r.owner_reply_text,
    })),
    extractions: ok.map((e) => ({ reviewId: e.review_id, sentiment: e.sentiment })),
    signals: signals
      .filter((s) => signalTheme.has(s.id))
      .map((s) => ({
        id: s.id,
        reviewId: s.review_id,
        kind: s.kind,
        label: s.label,
        quote: s.quote,
        severity: s.severity,
        themeKey: signalTheme.get(s.id)!,
      })),
    themes: themes.map((t) => ({ key: t.key, label: t.label })),
    extractionFailed: failedCount,
  });

  const business = run.business_id
    ? ((must(await db().from("businesses").select("name,category").eq("id", run.business_id).single(), "load business") as {
        name: string;
        category: string | null;
      }) ?? null)
    : null;

  const { synthesis, usage } = await synthesizeInsights(getProvider(), {
    businessName: business?.name ?? "Attività",
    category: business?.category ?? null,
    aggregation,
  });
  await addUsage(run, "synthesis", usage);

  // Salvataggio insight (idempotente)
  await db().from("insights").delete().eq("run_id", run.id);
  const interp = new Map(synthesis.items.map((i) => [i.id, i]));
  const allItems: SectionItem[] = Object.values(aggregation.sections).flat();
  const itemById = new Map(allItems.map((i) => [i.id, i]));

  type InsightInsert = {
    row: Record<string, unknown>;
    evidence: { reviewId: string; signalId: string | null; role: "supporting" | "contrasting" }[];
  };
  const inserts: InsightInsert[] = [];

  allItems.forEach((item, idx) => {
    const ai = interp.get(item.id);
    inserts.push({
      row: {
        run_id: run.id,
        section: item.section,
        theme_id: themeIdByKey.get(item.themeKey) ?? null,
        title: ai?.title || item.themeLabel,
        interpretation: ai?.interpretation ?? null,
        confidence: ai?.confidence ?? null,
        metrics: item.metrics,
        payload: { key: item.id, themeKey: item.themeKey, themeLabel: item.themeLabel, labels: item.labels, examples: item.examples },
        rank: idx,
      },
      evidence: item.evidence.map((e) => ({ ...e, role: "supporting" as const })),
    });
  });

  const compInterp = new Map(synthesis.comparisons.map((c) => [c.theme_key, c]));
  aggregation.comparisons.forEach((c, idx) => {
    const ai = compInterp.get(c.themeKey);
    inserts.push({
      row: {
        run_id: run.id,
        section: "comparison",
        theme_id: themeIdByKey.get(c.themeKey) ?? null,
        title: c.themeLabel,
        interpretation: ai?.interpretation ?? null,
        confidence: ai?.confidence ?? null,
        metrics: { positive: c.positive.reviewCount, negative: c.negative.reviewCount },
        payload: { key: c.id, themeKey: c.themeKey, positive: c.positive.examples, negative: c.negative.examples },
        rank: idx,
      },
      evidence: c.evidence,
    });
  });

  synthesis.opportunities.forEach((o, idx) => {
    const sources = o.based_on.map((id) => itemById.get(id)).filter((x): x is SectionItem => !!x);
    const reviewIds = new Set(sources.flatMap((s) => s.evidence.map((e) => e.reviewId)));
    inserts.push({
      row: {
        run_id: run.id,
        section: "opportunity",
        theme_id: null,
        title: o.title,
        interpretation: o.rationale,
        confidence: o.confidence,
        metrics: { reviewCount: reviewIds.size, basedOn: sources.length },
        payload: {
          type: o.type,
          basedOn: sources.map((s) => ({ key: s.id, section: s.section, themeLabel: s.themeLabel, reviewCount: s.metrics.reviewCount })),
        },
        rank: idx,
      },
      evidence: sources.flatMap((s) => s.evidence.map((e) => ({ ...e, role: "supporting" as const }))),
    });
  });

  for (const part of chunk(inserts, 50)) {
    const rows = must(await db().from("insights").insert(part.map((p) => p.row)).select("id"), "insert insights") as { id: string }[];
    const evidenceRows: { insight_id: string; review_id: string; signal_id: string | null; role: string }[] = [];
    rows.forEach((row, i) => {
      const seen = new Set<string>();
      for (const e of part[i].evidence) {
        const k = `${e.reviewId}|${e.role}`;
        if (seen.has(k)) continue;
        seen.add(k);
        evidenceRows.push({ insight_id: row.id, review_id: e.reviewId, signal_id: e.signalId, role: e.role });
      }
    });
    for (const ev of chunk(evidenceRows, 500)) must(await db().from("insight_evidence").insert(ev), "insert evidence");
  }

  await updateRun(run.id, {
    status: "completed",
    completed_at: new Date().toISOString(),
    summary: { overview: aggregation.overview, headline: synthesis.headline },
    error_code: null,
    error_detail: null,
  });
  return "completed";
}
