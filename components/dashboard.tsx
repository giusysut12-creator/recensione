"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisView, EvidenceView, InsightView, ReviewView } from "@/lib/db/queries";
import type { ItemMetrics, Example } from "@/lib/insights/aggregate";
import { fmtDate, fmtInt, fmtMonthYear, fmtPct, fmtRating, plural } from "@/lib/format";
import { Badge, Lettura, SectionTitle, Stars } from "./ui";

// ---------------------------------------------------------------------------
// Sezioni "Cosa stanno dicendo i tuoi clienti?"
// ---------------------------------------------------------------------------

const SECTIONS: { key: string; title: string; subtitle: string; empty: string }[] = [
  { key: "why_choose", title: "Perché ti scelgono", subtitle: "I motivi per cui i clienti dicono di averti scelto o di voler tornare.", empty: "Nelle recensioni non emergono motivi di scelta espliciti e ricorrenti." },
  { key: "love", title: "Cosa amano", subtitle: "Gli aspetti dell'esperienza che i clienti apprezzano di più.", empty: "Nessun elemento apprezzato ricorre in più recensioni." },
  { key: "disappoint", title: "Cosa li delude", subtitle: "I problemi raccontati più spesso, ordinati per frequenza.", empty: "Nessun problema ricorrente: i problemi citati sono casi isolati o assenti." },
  { key: "confusion", title: "Cosa non capiscono", subtitle: "Punti poco chiari: prezzi, procedure, condizioni, orari.", empty: "Non emergono punti poco chiari ricorrenti." },
  { key: "desires", title: "Cosa vorrebbero", subtitle: "Obiettivi, bisogni e richieste esplicite dei clienti.", empty: "I clienti non esprimono desideri o richieste ricorrenti." },
  { key: "unmet_expectations", title: "Aspettative disattese", subtitle: "Dove l'esperienza è stata diversa da ciò che il cliente si aspettava.", empty: "Non emergono aspettative disattese ricorrenti." },
  { key: "objections", title: "Cosa potrebbe bloccare l'acquisto", subtitle: "Dubbi e timori che i clienti citano, anche quando poi li hanno superati.", empty: "Non emergono obiezioni ricorrenti." },
];

const TREND_LABEL: Record<string, string> = {
  in_aumento: "Più frequente di recente",
  in_calo: "Meno frequente di recente",
};

const OPP_TYPE: Record<string, { label: string; tone: "neg" | "pos" | "neutral" }> = {
  correggere: { label: "Correggere", tone: "neg" },
  comunicare: { label: "Comunicare", tone: "pos" },
  sviluppare: { label: "Sviluppare", tone: "neutral" },
};

interface DrawerState {
  title: string;
  subtitle?: string;
  evidence: EvidenceView[];
  split?: boolean; // confronto: positive vs negative
}

// ---------------------------------------------------------------------------

export function Dashboard({ view }: { view: AnalysisView }) {
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const reviewsById = useMemo(() => new Map(view.reviews.map((r) => [r.id, r])), [view.reviews]);
  const bySection = useMemo(() => {
    const m = new Map<string, InsightView[]>();
    for (const i of view.insights) {
      const list = m.get(i.section) ?? [];
      list.push(i);
      m.set(i.section, list);
    }
    return m;
  }, [view.insights]);

  const ov = view.run.overview;
  const business = view.business;

  const openInsight = useCallback((i: InsightView, subtitle?: string) => {
    setDrawer({ title: i.title, subtitle, evidence: i.evidence, split: i.section === "comparison" });
  }, []);

  const openTheme = useCallback(
    (themeKey: string, label: string) => {
      const evidence: EvidenceView[] = [];
      const seen = new Set<string>();
      for (const i of view.insights) {
        if ((i.payload as { themeKey?: string }).themeKey !== themeKey || i.section === "comparison") continue;
        for (const e of i.evidence) {
          if (seen.has(e.reviewId)) continue;
          seen.add(e.reviewId);
          evidence.push(e);
        }
      }
      setDrawer({ title: label, subtitle: "Tutte le recensioni che parlano di questo tema", evidence });
    },
    [view.insights],
  );

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-3">{[business?.category, business?.address].filter(Boolean).join(" · ")}</p>
        <h1 className="font-serif text-4xl text-ink">{business?.name ?? "La tua attività"}</h1>
      </div>

      {ov ? (
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
          <Stat label="Rating su Google" value={fmtRating(view.source?.rating ?? ov.avgRating)} extra={<Stars value={view.source?.rating ?? ov.avgRating ?? 0} />} />
          <Stat
            label="Recensioni analizzate"
            value={fmtInt(ov.reviewsTotal)}
            extra={<span className="text-xs text-ink-3">{view.source?.reviewCount ? `su ${fmtInt(view.source.reviewCount)} totali · ` : ""}{fmtInt(ov.reviewsWithText)} con testo</span>}
          />
          <Stat label="Periodo coperto" value={`${fmtMonthYear(ov.periodFrom)} – ${fmtMonthYear(ov.periodTo)}`} small />
          <Stat
            label="Risposte del titolare"
            value={ov.ownerReplyRate !== null ? fmtPct(ov.ownerReplyRate) : "–"}
            extra={<span className="text-xs text-ink-3">delle recensioni analizzate</span>}
          />
        </dl>
      ) : null}

      {view.run.headline ? (
        <div className="mt-6">
          <Lettura>{view.run.headline}</Lettura>
        </div>
      ) : null}

      <Legend />

      {/* A. Panoramica */}
      {ov ? (
        <section className="mt-14">
          <SectionTitle eyebrow="Panoramica" title="Il quadro generale" subtitle="Il voto medio conta, ma conta di più capire da cosa dipende. Clicca un tema per leggere le recensioni." />
          <div className="grid gap-4 md:grid-cols-5">
            <div className="rounded-xl border border-line bg-surface p-5 md:col-span-2">
              <h3 className="text-sm font-semibold">Distribuzione delle stelle</h3>
              <p className="text-xs text-ink-3">Sulle {fmtInt(ov.reviewsTotal)} recensioni analizzate · media {fmtRating(ov.avgRating)}</p>
              <StarBars dist={ov.ratingDistribution} total={ov.reviewsTotal} />
              <p className="mt-4 text-xs text-ink-3">
                Tono delle recensioni con testo: {fmtInt(ov.sentiment.positive)} positive · {fmtInt(ov.sentiment.mixed)} miste · {fmtInt(ov.sentiment.negative)} negative
                {ov.sentiment.neutral ? ` · ${fmtInt(ov.sentiment.neutral)} neutre` : ""}
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface p-5 md:col-span-3">
              <h3 className="text-sm font-semibold">I temi di cui parlano di più</h3>
              <p className="text-xs text-ink-3">Recensioni che citano il tema, divise tra 4–5 stelle e 1–2 stelle</p>
              <ThemeBars themes={ov.topThemes} onOpen={openTheme} />
            </div>
          </div>
        </section>
      ) : null}

      {/* Cosa stanno dicendo */}
      <section className="mt-20">
        <h2 className="font-serif text-3xl sm:text-4xl">Cosa stanno dicendo i tuoi clienti?</h2>
        <p className="mt-2 max-w-2xl text-ink-2">
          Ogni scheda riporta quante recensioni ne parlano e le parole reali dei clienti. Apri le recensioni per verificare da dove nasce ogni conclusione.
        </p>
      </section>

      {SECTIONS.map((s) => {
        const items = bySection.get(s.key) ?? [];
        if (s.key === "confusion" && items.length === 0) return null;
        return (
          <section key={s.key} className="mt-12">
            <SectionTitle title={s.title} subtitle={s.subtitle} />
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-5 py-4 text-sm text-ink-3">{s.empty}</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((i) => (
                  <InsightCard key={i.id} insight={i} onOpen={() => openInsight(i, s.title)} />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {/* H. Linguaggio */}
      <LanguageSection items={bySection.get("language") ?? []} onOpen={(i) => openInsight(i, "Le parole che usano")} />

      {/* Confronto */}
      {(bySection.get("comparison") ?? []).length > 0 ? (
        <section className="mt-16">
          <SectionTitle
            title="Stesso tema, esperienze opposte"
            subtitle="Temi che compaiono sia nelle recensioni da 4–5 stelle sia in quelle da 1–2 stelle. Il confronto mostra cosa distingue un'esperienza riuscita da una deludente."
          />
          <div className="grid gap-4 md:grid-cols-2">
            {(bySection.get("comparison") ?? []).map((i) => (
              <ComparisonCard key={i.id} insight={i} onOpen={() => openInsight(i, "Confronto tra recensioni positive e negative")} />
            ))}
          </div>
        </section>
      ) : null}

      {/* I. Opportunità */}
      <section className="mt-16">
        <SectionTitle eyebrow="Cosa puoi fare" title="Opportunità" subtitle="Possibili azioni suggerite a partire dai dati. Sono proposte da valutare: la decisione resta tua." />
        {(bySection.get("opportunity") ?? []).length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-5 py-4 text-sm text-ink-3">Non ci sono abbastanza elementi ricorrenti per proporre opportunità affidabili.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {(bySection.get("opportunity") ?? []).map((i) => (
              <OpportunityCard key={i.id} insight={i} onOpen={() => openInsight(i, "Recensioni su cui si basa l'opportunità")} />
            ))}
          </div>
        )}
      </section>

      <AllReviews reviews={view.reviews} />

      <p className="mt-16 text-xs text-ink-3">
        Analisi completata il {fmtDate(view.run.completedAt)}. I conteggi sono calcolati sulle recensioni pubbliche raccolte; le &ldquo;Letture&rdquo; sono interpretazioni automatiche da verificare.
        {ov && ov.extractionFailed > 0 ? ` ${ov.extractionFailed} recensioni non sono state lette correttamente e sono escluse dai conteggi.` : ""}
      </p>

      {drawer ? <EvidenceDrawer state={drawer} reviewsById={reviewsById} onClose={() => setDrawer(null)} /> : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function Stat({ label, value, extra, small }: { label: string; value: string; extra?: React.ReactNode; small?: boolean }) {
  return (
    <div className="bg-surface p-4">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={`mt-1 font-semibold text-ink ${small ? "text-base" : "text-2xl"}`}>{value}</dd>
      {extra ? <div className="mt-0.5">{extra}</div> : null}
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-3">
      <span className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm border border-line-strong bg-surface" aria-hidden />
        <span>
          <strong className="font-semibold text-ink-2">Evidenza</strong>: numeri e citazioni reali dalle recensioni
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm bg-lettura" aria-hidden />
        <span>
          <strong className="font-semibold text-lettura">Lettura</strong>: interpretazione automatica, da verificare
        </span>
      </span>
    </div>
  );
}

function StarBars({ dist, total }: { dist: Record<string, number>; total: number }) {
  return (
    <div className="mt-4 space-y-2">
      {["5", "4", "3", "2", "1"].map((k) => {
        const n = dist[k] ?? 0;
        const pct = total ? n / total : 0;
        return (
          <div key={k} className="flex items-center gap-3 text-sm" title={`${n} recensioni da ${k} stelle`}>
            <span className="w-8 shrink-0 text-ink-2">{k}★</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-ink-2" style={{ width: `${Math.max(pct * 100, n ? 1.5 : 0)}%` }} />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums text-ink-2">
              {fmtInt(n)} <span className="text-ink-3">({Math.round(pct * 100)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ThemeBars({
  themes,
  onOpen,
}: {
  themes: { key: string; label: string; reviewCount: number; positive: number; negative: number }[];
  onOpen: (key: string, label: string) => void;
}) {
  if (themes.length === 0) return <p className="mt-4 text-sm text-ink-3">Le recensioni con testo sono troppo poche per individuare temi.</p>;
  const max = Math.max(...themes.map((t) => t.reviewCount));
  return (
    <div className="mt-4">
      <div className="mb-2 flex gap-4 text-xs text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-pos" /> 4–5 stelle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-neg" /> 1–2 stelle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-neutral" /> 3 stelle
        </span>
      </div>
      <ul className="space-y-1">
        {themes.map((t) => {
          const neutral = Math.max(0, t.reviewCount - t.positive - t.negative);
          const w = (n: number) => `${(n / max) * 100}%`;
          return (
            <li key={t.key}>
              <button
                type="button"
                onClick={() => onOpen(t.key, t.label)}
                className="group grid w-full grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                title={`${t.reviewCount} recensioni: ${t.positive} da 4–5 stelle, ${t.negative} da 1–2 stelle`}
              >
                <span className="truncate text-ink">{t.label}</span>
                <span className="flex h-2.5 gap-[2px]">
                  {t.positive ? <span className="h-full rounded-l-[4px] bg-pos" style={{ width: w(t.positive) }} /> : null}
                  {neutral ? <span className="h-full bg-neutral" style={{ width: w(neutral) }} /> : null}
                  {t.negative ? <span className="h-full rounded-r-[4px] bg-neg" style={{ width: w(t.negative) }} /> : null}
                </span>
                <span className="tabular-nums text-ink-2 group-hover:text-ink">
                  {fmtInt(t.reviewCount)} <span className="text-ink-3">→</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MetricsLine({ m }: { m: ItemMetrics }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="text-3xl font-semibold tabular-nums text-ink">{fmtInt(m.reviewCount)}</span>
      <span className="text-sm text-ink-2">
        {m.reviewCount === 1 ? "recensione" : "recensioni"}
        {m.share !== null ? ` · ${fmtPct(m.share)} di quelle con testo` : ` su ${fmtInt(m.base)} con testo`}
      </span>
      {m.avgRating !== null ? (
        <span className="flex items-center gap-1 text-sm text-ink-2">
          <Stars value={m.avgRating} /> media {fmtRating(m.avgRating)}
        </span>
      ) : null}
    </div>
  );
}

function Quote({ ex }: { ex: Example }) {
  return (
    <blockquote className="border-l-2 border-line-strong pl-3 font-serif text-[15px] italic leading-relaxed text-ink">
      &ldquo;{ex.quote}&rdquo;
      <footer className="mt-1 font-sans text-xs not-italic text-ink-3">
        <Stars value={ex.rating} /> · {fmtMonthYear(ex.reviewDate)}
      </footer>
    </blockquote>
  );
}

function InsightCard({ insight, onOpen }: { insight: InsightView; onOpen: () => void }) {
  const m = insight.metrics as unknown as ItemMetrics;
  const p = insight.payload as { themeLabel?: string; examples?: Example[] };
  const examples = p.examples ?? [];
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{p.themeLabel}</span>
        {m.weak ? <Badge tone="weak">Segnale debole · pochi casi</Badge> : null}
        {m.trend && TREND_LABEL[m.trend.direction] ? <Badge>{TREND_LABEL[m.trend.direction]}</Badge> : null}
        {m.severity && m.severity.high > 0 ? <Badge tone="neg">{plural(m.severity.high, "caso grave", "casi gravi")}</Badge> : null}
      </div>
      <h3 className="-mt-2 text-lg font-semibold leading-snug text-ink">{insight.title}</h3>
      <MetricsLine m={m} />
      {examples.slice(0, 2).map((ex) => (
        <Quote key={ex.signalId} ex={ex} />
      ))}
      {insight.interpretation ? <Lettura confidence={insight.confidence}>{insight.interpretation}</Lettura> : null}
      <button
        type="button"
        onClick={onOpen}
        className="mt-auto self-start rounded-lg border border-line-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2"
      >
        Vedi le recensioni ({fmtInt(m.reviewCount)}) →
      </button>
    </article>
  );
}

function LanguageSection({ items, onOpen }: { items: InsightView[]; onOpen: (i: InsightView) => void }) {
  return (
    <section className="mt-12">
      <SectionTitle title="Le parole che usano per descriverti" subtitle="Espressioni reali dei clienti, utili per testi, pagine e comunicazione: è il linguaggio in cui si riconoscono." />
      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-5 py-4 text-sm text-ink-3">Non emergono espressioni ricorrenti.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((i) => {
            const p = i.payload as { themeLabel?: string; examples?: Example[] };
            const m = i.metrics as unknown as ItemMetrics;
            return (
              <article key={i.id} className="rounded-xl border border-line bg-surface p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{p.themeLabel}</span>
                  {m.weak ? <Badge tone="weak">Pochi casi</Badge> : null}
                </div>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {(p.examples ?? []).map((ex) => (
                    <li key={ex.signalId} className={`rounded-full px-3 py-1 font-serif text-sm italic ${ex.rating >= 4 ? "bg-pos-soft" : ex.rating <= 2 ? "bg-neg-soft" : "bg-surface-2"}`}>
                      &ldquo;{ex.quote}&rdquo;
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => onOpen(i)} className="mt-4 text-sm font-medium text-ink underline underline-offset-4">
                  Vedi le recensioni ({fmtInt(m.reviewCount)})
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ComparisonCard({ insight, onOpen }: { insight: InsightView; onOpen: () => void }) {
  const p = insight.payload as { positive?: Example[]; negative?: Example[] };
  const m = insight.metrics as { positive: number; negative: number };
  return (
    <article className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5">
      <h3 className="text-lg font-semibold">{insight.title}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-pos-soft p-3">
          <div className="mb-2 text-xs font-semibold text-ink-2">4–5 stelle · {plural(m.positive, "recensione", "recensioni")}</div>
          {(p.positive ?? []).slice(0, 2).map((ex) => (
            <p key={ex.signalId} className="mb-2 font-serif text-sm italic leading-relaxed">&ldquo;{ex.quote}&rdquo;</p>
          ))}
        </div>
        <div className="rounded-lg bg-neg-soft p-3">
          <div className="mb-2 text-xs font-semibold text-ink-2">1–2 stelle · {plural(m.negative, "recensione", "recensioni")}</div>
          {(p.negative ?? []).slice(0, 2).map((ex) => (
            <p key={ex.signalId} className="mb-2 font-serif text-sm italic leading-relaxed">&ldquo;{ex.quote}&rdquo;</p>
          ))}
        </div>
      </div>
      {insight.interpretation ? <Lettura confidence={insight.confidence}>{insight.interpretation}</Lettura> : null}
      <button type="button" onClick={onOpen} className="mt-auto self-start rounded-lg border border-line-strong px-3 py-2 text-sm font-medium hover:bg-surface-2">
        Confronta le recensioni →
      </button>
    </article>
  );
}

function OpportunityCard({ insight, onOpen }: { insight: InsightView; onOpen: () => void }) {
  const p = insight.payload as { type?: string; basedOn?: { key: string; section: string; themeLabel: string; reviewCount: number }[] };
  const t = OPP_TYPE[p.type ?? ""] ?? OPP_TYPE.sviluppare;
  const m = insight.metrics as { reviewCount: number };
  const sectionName = (s: string) => SECTIONS.find((x) => x.key === s)?.title ?? (s === "language" ? "Linguaggio" : s);
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5">
      <div>
        <Badge tone={t.tone}>{t.label}</Badge>
      </div>
      <h3 className="text-lg font-semibold leading-snug">{insight.title}</h3>
      {insight.interpretation ? <Lettura confidence={insight.confidence}>{insight.interpretation}</Lettura> : null}
      <div className="text-xs text-ink-3">
        <span className="font-semibold text-ink-2">Si basa su: </span>
        {(p.basedOn ?? []).map((b, i) => (
          <span key={b.key}>
            {i > 0 ? " · " : ""}
            {b.themeLabel} ({sectionName(b.section).toLowerCase()}, {b.reviewCount})
          </span>
        ))}
      </div>
      <button type="button" onClick={onOpen} className="mt-auto self-start rounded-lg border border-line-strong px-3 py-2 text-sm font-medium hover:bg-surface-2">
        Vedi le recensioni ({fmtInt(m.reviewCount)}) →
      </button>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Recensioni
// ---------------------------------------------------------------------------

function Highlighted({ text, quote, start, end }: { text: string; quote: string | null; start: number | null; end: number | null }) {
  let s = start;
  let e = end;
  if ((s === null || e === null || text.slice(s, e) !== quote) && quote) {
    const idx = text.indexOf(quote);
    s = idx >= 0 ? idx : null;
    e = idx >= 0 ? idx + quote.length : null;
  }
  if (s === null || e === null) return <>{text}</>;
  return (
    <>
      {text.slice(0, s)}
      <mark>{text.slice(s, e)}</mark>
      {text.slice(e)}
    </>
  );
}

function ReviewCard({ review, evidence }: { review: ReviewView; evidence?: EvidenceView }) {
  const [replyOpen, setReplyOpen] = useState(false);
  return (
    <article className="rounded-xl border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        <span className="flex items-center gap-2">
          <Stars value={review.rating} />
          <span>{review.author ?? "Cliente"}</span>
        </span>
        <span>{fmtDate(review.date)}</span>
      </header>
      {review.text ? (
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">
          {evidence ? <Highlighted text={review.text} quote={evidence.quote} start={evidence.start} end={evidence.end} /> : review.text}
        </p>
      ) : (
        <p className="mt-2 text-sm italic text-ink-3">Solo valutazione, senza testo.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        {review.ownerReply ? (
          <button type="button" onClick={() => setReplyOpen((v) => !v)} className="text-ink-2 underline underline-offset-4">
            {replyOpen ? "Nascondi risposta" : "Risposta del titolare"}
          </button>
        ) : (
          <span className="text-ink-3">Nessuna risposta del titolare</span>
        )}
        {review.url ? (
          <a href={review.url} target="_blank" rel="noopener noreferrer nofollow" className="text-ink-2 underline underline-offset-4">
            Apri su Google
          </a>
        ) : null}
      </div>
      {replyOpen && review.ownerReply ? <p className="mt-2 rounded-lg bg-surface-2 p-3 text-sm text-ink-2">{review.ownerReply}</p> : null}
    </article>
  );
}

function EvidenceDrawer({ state, reviewsById, onClose }: { state: DrawerState; reviewsById: Map<string, ReviewView>; onClose: () => void }) {
  const [tab, setTab] = useState<"supporting" | "contrasting">("supporting");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const rows = useMemo(() => {
    const seen = new Set<string>();
    return state.evidence
      .filter((e) => (state.split ? e.role === tab : true))
      .filter((e) => reviewsById.has(e.reviewId) && !seen.has(e.reviewId) && seen.add(e.reviewId))
      .map((e) => ({ e, r: reviewsById.get(e.reviewId)! }))
      .sort((a, b) => (b.r.date ?? "").localeCompare(a.r.date ?? ""));
  }, [state, tab, reviewsById]);

  const avg = rows.length ? rows.reduce((a, x) => a + x.r.rating, 0) / rows.length : null;
  const count = (role: string) => new Set(state.evidence.filter((e) => e.role === role).map((e) => e.reviewId)).size;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={state.title}>
      <button type="button" aria-label="Chiudi" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="relative flex h-full w-full max-w-xl flex-col bg-bg shadow-2xl outline-none">
        <div className="border-b border-line bg-surface px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {state.subtitle ? <p className="text-xs text-ink-3">{state.subtitle}</p> : null}
              <h2 className="text-lg font-semibold leading-snug">{state.title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-ink-2 hover:bg-surface-2" aria-label="Chiudi">
              ✕
            </button>
          </div>
          {state.split ? (
            <div className="mt-3 flex gap-2">
              <TabButton active={tab === "supporting"} onClick={() => setTab("supporting")}>
                4–5 stelle ({count("supporting")})
              </TabButton>
              <TabButton active={tab === "contrasting"} onClick={() => setTab("contrasting")}>
                1–2 stelle ({count("contrasting")})
              </TabButton>
            </div>
          ) : null}
          <p className="mt-3 text-xs text-ink-2">
            <strong className="font-semibold">Evidenza:</strong> {plural(rows.length, "recensione", "recensioni")}
            {avg !== null ? ` · media ${fmtRating(avg)} stelle` : ""}. In evidenza la frase da cui nasce il segnale.
          </p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {rows.map(({ e, r }) => (
            <ReviewCard key={r.id} review={r} evidence={e} />
          ))}
          {rows.length === 0 ? <p className="text-sm text-ink-3">Nessuna recensione da mostrare.</p> : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-sm ${active ? "bg-ink text-accent-ink" : "border border-line-strong text-ink-2 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}

function AllReviews({ reviews }: { reviews: ReviewView[] }) {
  const [filter, setFilter] = useState<number | null>(null);
  const [limit, setLimit] = useState(20);
  const filtered = filter ? reviews.filter((r) => r.rating === filter) : reviews;
  return (
    <section className="mt-20">
      <SectionTitle title="Tutte le recensioni analizzate" subtitle="Le recensioni pubbliche raccolte per questa analisi, dalla più recente." />
      <div className="mb-4 flex flex-wrap gap-2">
        <TabButton active={filter === null} onClick={() => setFilter(null)}>
          Tutte ({fmtInt(reviews.length)})
        </TabButton>
        {[5, 4, 3, 2, 1].map((n) => (
          <TabButton key={n} active={filter === n} onClick={() => setFilter(n)}>
            {n}★ ({reviews.filter((r) => r.rating === n).length})
          </TabButton>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {filtered.slice(0, limit).map((r) => (
          <ReviewCard key={r.id} review={r} />
        ))}
      </div>
      {filtered.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + 40)} className="mt-4 rounded-lg border border-line-strong px-4 py-2 text-sm hover:bg-surface-2">
          Mostra altre
        </button>
      ) : null}
    </section>
  );
}
