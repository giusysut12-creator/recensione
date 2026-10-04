import "server-only";
import { db, must, chunk } from "./client";
import type { Overview } from "@/lib/insights/aggregate";

/** Dati pronti per la UI. Nessun dato interno (token, ID Apify, hash) arriva al browser. */

export interface RunStatusView {
  id: string;
  status: string;
  progress: { found?: number; withText?: number; toExtract?: number; extracted?: number; themes?: number; retries?: number };
  errorCode: string | null;
  createdAt: string;
  businessName: string | null;
}

export interface ReviewView {
  id: string;
  author: string | null;
  rating: number;
  text: string | null;
  language: string | null;
  translation: string | null;
  date: string | null;
  ownerReply: string | null;
  url: string | null;
}

export interface EvidenceView {
  reviewId: string;
  role: "supporting" | "contrasting";
  quote: string | null;
  start: number | null;
  end: number | null;
}

export interface InsightView {
  id: string;
  section: string;
  title: string;
  interpretation: string | null;
  confidence: string | null;
  metrics: Record<string, unknown>;
  payload: Record<string, unknown>;
  evidence: EvidenceView[];
}

export interface AnalysisView {
  run: RunStatusView & { completedAt: string | null; headline: string | null; overview: Overview | null };
  business: { name: string; category: string | null; address: string | null } | null;
  source: { platform: string; rating: number | null; reviewCount: number | null; url: string | null } | null;
  insights: InsightView[];
  reviews: ReviewView[];
}

interface RunRowLite {
  id: string;
  status: string;
  progress: RunStatusView["progress"];
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
  business_id: string | null;
  source_id: string | null;
  summary: { overview?: Overview; headline?: string } | null;
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function loadRun(runId: string): Promise<RunRowLite | null> {
  if (!isUuid(runId)) return null;
  const rows = must(
    await db()
      .from("analysis_runs")
      .select("id,status,progress,error_code,created_at,completed_at,business_id,source_id,summary")
      .eq("id", runId)
      .limit(1),
    "load run",
  ) as RunRowLite[];
  return rows[0] ?? null;
}

async function businessName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const rows = must(await db().from("businesses").select("name").eq("id", id).limit(1), "business name") as { name: string }[];
  return rows[0]?.name ?? null;
}

export async function getRunStatus(runId: string): Promise<RunStatusView | null> {
  const run = await loadRun(runId);
  if (!run) return null;
  const { retries, found, withText, toExtract, extracted, themes } = run.progress ?? {};
  return {
    id: run.id,
    status: run.status,
    progress: { retries, found, withText, toExtract, extracted, themes },
    errorCode: run.error_code,
    createdAt: run.created_at,
    businessName: await businessName(run.business_id),
  };
}

export async function getAnalysisView(runId: string): Promise<AnalysisView | null> {
  const run = await loadRun(runId);
  if (!run) return null;
  const status = await getRunStatus(runId);

  const business = run.business_id
    ? ((must(await db().from("businesses").select("name,category,address").eq("id", run.business_id).limit(1), "business") as {
        name: string;
        category: string | null;
        address: string | null;
      }[])[0] ?? null)
    : null;
  const sourceRow = run.source_id
    ? ((must(
        await db().from("sources").select("platform,platform_rating,platform_review_count,canonical_url").eq("id", run.source_id).limit(1),
        "source",
      ) as { platform: string; platform_rating: number | null; platform_review_count: number | null; canonical_url: string | null }[])[0] ?? null)
    : null;

  let insights: InsightView[] = [];
  const reviews: ReviewView[] = [];

  if (run.status === "completed") {
    const rows = must(
      await db()
        .from("insights")
        .select("id,section,title,interpretation,confidence,metrics,payload,rank")
        .eq("run_id", run.id)
        .order("section")
        .order("rank"),
      "insights",
    ) as (Omit<InsightView, "evidence"> & { rank: number })[];

    const evidence: { insight_id: string; review_id: string; signal_id: string | null; role: "supporting" | "contrasting" }[] = [];
    for (const part of chunk(rows.map((r) => r.id), 100)) {
      evidence.push(
        ...(must(
          await db().from("insight_evidence").select("insight_id,review_id,signal_id,role").in("insight_id", part),
          "evidence",
        ) as typeof evidence),
      );
    }
    const signalIds = [...new Set(evidence.map((e) => e.signal_id).filter((x): x is string => !!x))];
    const signals = new Map<string, { quote: string; quote_start: number | null; quote_end: number | null }>();
    for (const part of chunk(signalIds, 100)) {
      const srows = must(
        await db().from("review_signals").select("id,quote,quote_start,quote_end").in("id", part),
        "signals",
      ) as { id: string; quote: string; quote_start: number | null; quote_end: number | null }[];
      for (const s of srows) signals.set(s.id, s);
    }
    const byInsight = new Map<string, EvidenceView[]>();
    for (const e of evidence) {
      const s = e.signal_id ? signals.get(e.signal_id) : undefined;
      const list = byInsight.get(e.insight_id) ?? [];
      list.push({ reviewId: e.review_id, role: e.role, quote: s?.quote ?? null, start: s?.quote_start ?? null, end: s?.quote_end ?? null });
      byInsight.set(e.insight_id, list);
    }
    insights = rows.map((r) => ({
      id: r.id,
      section: r.section,
      title: r.title,
      interpretation: r.interpretation,
      confidence: r.confidence,
      metrics: r.metrics,
      payload: r.payload,
      evidence: byInsight.get(r.id) ?? [],
    }));

    const links = must(await db().from("analysis_run_reviews").select("review_id").eq("run_id", run.id), "sample") as { review_id: string }[];
    for (const part of chunk(links.map((l) => l.review_id), 100)) {
      const rrows = must(
        await db()
          .from("reviews")
          .select("id,author_display,rating,text,language,text_translated,review_date,owner_reply_text,review_url")
          .in("id", part),
        "reviews",
      ) as {
        id: string;
        author_display: string | null;
        rating: number;
        text: string | null;
        language: string | null;
        text_translated: string | null;
        review_date: string | null;
        owner_reply_text: string | null;
        review_url: string | null;
      }[];
      reviews.push(
        ...rrows.map((r) => ({
          id: r.id,
          author: r.author_display,
          rating: r.rating,
          text: r.text,
          language: r.language,
          // Traduzione mostrata solo se l'originale non è in italiano
          translation: r.text_translated && r.language && !r.language.startsWith("it") ? r.text_translated : null,
          date: r.review_date,
          ownerReply: r.owner_reply_text,
          url: r.review_url,
        })),
      );
    }
    reviews.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }

  return {
    run: {
      ...status!,
      completedAt: run.completed_at,
      headline: run.summary?.headline ?? null,
      overview: run.summary?.overview ?? null,
    },
    business,
    source: sourceRow
      ? { platform: sourceRow.platform, rating: sourceRow.platform_rating, reviewCount: sourceRow.platform_review_count, url: sourceRow.canonical_url }
      : null,
    insights,
    reviews,
  };
}

export interface RecentAnalysis {
  id: string;
  status: string;
  createdAt: string;
  businessName: string | null;
}

export async function listRecentAnalyses(limit = 10): Promise<RecentAnalysis[]> {
  const rows = must(
    await db().from("analysis_runs").select("id,status,created_at,business_id").order("created_at", { ascending: false }).limit(limit),
    "recent",
  ) as { id: string; status: string; created_at: string; business_id: string | null }[];
  const ids = [...new Set(rows.map((r) => r.business_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const b = must(await db().from("businesses").select("id,name").in("id", ids), "names") as { id: string; name: string }[];
    for (const x of b) names.set(x.id, x.name);
  }
  return rows.map((r) => ({ id: r.id, status: r.status, createdAt: r.created_at, businessName: r.business_id ? names.get(r.business_id) ?? null : null }));
}
