"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Status {
  status: string;
  progress: { found?: number; withText?: number; toExtract?: number; extracted?: number; retries?: number };
  businessName: string | null;
}

const STEPS = [
  { key: "resolving", label: "Troviamo la tua attività", match: ["queued", "resolving"] },
  { key: "scraping", label: "Raccogliamo le recensioni pubbliche", match: ["scraping", "importing"] },
  { key: "extracting", label: "Leggiamo le recensioni una per una", match: ["extracting"] },
  { key: "consolidating", label: "Individuiamo i temi ricorrenti", match: ["consolidating"] },
  { key: "synthesizing", label: "Prepariamo le conclusioni", match: ["synthesizing"] },
];

export function ProgressView({ id, initial }: { id: string; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState<Status>(initial);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/analyses/${id}/tick`, { method: "POST" });
        if (res.ok) {
          const data: Status = await res.json();
          if (stopped) return;
          setS(data);
          if (data.status === "completed" || data.status === "failed") {
            router.refresh();
            return;
          }
        }
      } catch {
        // rete instabile: riproviamo al prossimo giro
      }
      if (!stopped) timer = setTimeout(tick, 4000);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, router]);

  const activeIndex = Math.max(0, STEPS.findIndex((st) => st.match.includes(s.status)));
  const p = s.progress ?? {};

  const detail = (key: string) => {
    if (key === "scraping" && p.found) return `${p.found} recensioni trovate`;
    if (key === "scraping" && s.status === "scraping") return "Di solito richiede da 1 a 3 minuti";
    if (key === "extracting" && p.toExtract) return `${p.extracted ?? 0} di ${p.toExtract}`;
    return null;
  };

  const pct = p.toExtract ? Math.round(((p.extracted ?? 0) / p.toExtract) * 100) : null;

  return (
    <div className="mx-auto max-w-xl px-4 py-20 sm:px-6">
      <p className="text-sm font-medium text-ink-3">Analisi in corso</p>
      <h1 className="mt-1 font-serif text-3xl">{s.businessName ?? "Stiamo preparando la tua analisi"}</h1>
      <ol className="mt-10 space-y-5" aria-live="polite">
        {STEPS.map((st, i) => {
          const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
          const d = detail(st.key);
          return (
            <li key={st.key} className="flex gap-4">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs ${
                  state === "done"
                    ? "border-ink bg-ink text-accent-ink"
                    : state === "active"
                      ? "border-ink text-ink"
                      : "border-line-strong text-ink-3"
                }`}
                aria-hidden
              >
                {state === "done" ? "✓" : state === "active" ? <span className="h-2 w-2 animate-pulse rounded-full bg-ink" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={state === "todo" ? "text-ink-3" : "font-medium text-ink"}>{st.label}</div>
                {state === "active" && d ? <div className="text-sm text-ink-2">{d}</div> : null}
                {state === "active" && st.key === "extracting" && pct !== null ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-ink transition-all" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {p.retries ? <p className="mt-8 text-sm text-ink-3">Un servizio ha risposto lentamente: stiamo riprovando.</p> : null}
      <p className="mt-10 text-sm text-ink-3">Puoi chiudere questa pagina: l&apos;analisi prosegue e la ritrovi tra le analisi recenti.</p>
    </div>
  );
}
