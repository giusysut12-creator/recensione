import Link from "next/link";
import type { ReactNode } from "react";

export function Stars({ value, size = "sm" }: { value: number; size?: "sm" | "md" }) {
  const full = Math.round(value);
  const cls = size === "md" ? "text-base" : "text-xs";
  return (
    <span className={`${cls} tracking-[0.08em] whitespace-nowrap`} aria-label={`${value} stelle su 5`}>
      <span className="text-star">{"★".repeat(full)}</span>
      <span className="text-line-strong">{"★".repeat(5 - full)}</span>
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "pos" | "neg" | "lettura" | "weak" }) {
  const tones = {
    neutral: "bg-surface-2 text-ink-2",
    pos: "bg-pos-soft text-ink",
    neg: "bg-neg-soft text-ink",
    lettura: "bg-lettura-soft text-lettura",
    weak: "border border-dashed border-line-strong text-ink-3",
  } as const;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

/** Blocco "Lettura": testo interpretativo generato dall'AI, sempre distinto dall'evidenza. */
export function Lettura({ children, confidence }: { children: ReactNode; confidence?: string | null }) {
  return (
    <div className="rounded-lg border-l-2 border-lettura bg-lettura-soft/60 px-3 py-2">
      <div className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-lettura">
        Lettura
        {confidence ? <span className="font-normal normal-case tracking-normal">· affidabilità {confidence}</span> : null}
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      {eyebrow ? <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-ink-3">{eyebrow}</div> : null}
      <h2 className="font-serif text-2xl text-ink">{title}</h2>
      {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{subtitle}</p> : null}
    </div>
  );
}

export function AppHeader({ right }: { right?: ReactNode }) {
  return (
    <header className="border-b border-line bg-surface/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" aria-hidden />
          Voce dei Clienti
        </Link>
        {right}
      </div>
    </header>
  );
}
