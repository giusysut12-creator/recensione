import Link from "next/link";
import { AnalyzeForm } from "@/components/analyze-form";
import { AppHeader } from "@/components/ui";
import { listRecentAnalyses } from "@/lib/db/queries";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  completed: "Pronta",
  failed: "Non riuscita",
};

export default async function Home() {
  let recent: Awaited<ReturnType<typeof listRecentAnalyses>> = [];
  try {
    recent = await listRecentAnalyses(8);
  } catch (err) {
    console.error("[home] recent analyses", err);
  }

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-16 sm:px-6 sm:pt-24">
        <p className="mb-3 text-sm font-medium text-ink-3">Recensioni → evidenze → decisioni</p>
        <h1 className="font-serif text-4xl leading-tight text-ink sm:text-5xl">Cosa stanno dicendo i tuoi clienti?</h1>
        <p className="mt-4 max-w-xl text-lg text-ink-2">
          Incolla il link della tua attività su Google. Leggiamo le recensioni pubbliche e ti mostriamo perché ti scelgono,
          cosa li delude e cosa puoi fare, con le recensioni reali a supporto di ogni conclusione.
        </p>

        <div className="mt-10">
          <AnalyzeForm />
        </div>

        {recent.length > 0 ? (
          <section className="mt-20">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-3">Analisi recenti</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/analisi/${r.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-2">
                    <span className="truncate font-medium">{r.businessName ?? "Analisi in preparazione"}</span>
                    <span className="shrink-0 text-sm text-ink-3">
                      {STATUS_LABEL[r.status] ?? "In corso"} · {fmtDate(r.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-10 text-xs text-ink-3 sm:px-6">
        Analizziamo solo recensioni pubbliche. Non identifichiamo le persone e non conserviamo dati del profilo dei recensori.
      </footer>
    </>
  );
}
