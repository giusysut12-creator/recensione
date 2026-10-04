import Link from "next/link";
import { notFound } from "next/navigation";
import { getAnalysisView } from "@/lib/db/queries";
import { ProgressView } from "@/components/progress-view";
import { Dashboard } from "@/components/dashboard";
import { AppHeader } from "@/components/ui";
import { ERROR_MESSAGES } from "@/lib/pipeline/errors";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const view = await getAnalysisView(id);
  if (!view) notFound();

  const header = <AppHeader right={<Link href="/" className="text-sm text-ink-2 hover:text-ink">Nuova analisi</Link>} />;

  if (view.run.status === "failed") {
    const msg = ERROR_MESSAGES[view.run.errorCode ?? ""] ?? ERROR_MESSAGES.analysis_failed;
    return (
      <>
        {header}
        <main className="mx-auto max-w-xl px-4 py-20 sm:px-6">
          <h1 className="font-serif text-3xl">{msg.title}</h1>
          <p className="mt-2 text-ink-2">{msg.hint}</p>
          <Link href="/" className="mt-8 inline-block rounded-xl bg-accent px-5 py-3 text-sm font-medium text-accent-ink">
            Torna all&apos;inizio
          </Link>
        </main>
      </>
    );
  }

  if (view.run.status !== "completed") {
    return (
      <>
        {header}
        <ProgressView
          id={view.run.id}
          initial={{ status: view.run.status, progress: view.run.progress, businessName: view.run.businessName }}
        />
      </>
    );
  }

  return (
    <>
      {header}
      <Dashboard view={view} />
    </>
  );
}
