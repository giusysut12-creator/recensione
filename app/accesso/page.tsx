import { LoginForm } from "./login-form";

export const metadata = { title: "Accesso · Voce dei Clienti" };

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ da?: string }> }) {
  const { da } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2 text-sm font-semibold">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" aria-hidden />
          Voce dei Clienti
        </div>
        <h1 className="font-serif text-2xl">Accesso riservato</h1>
        <p className="mt-1 text-sm text-ink-2">Inserisci il codice di accesso che hai ricevuto.</p>
        <LoginForm next={da ?? "/"} />
      </div>
    </main>
  );
}
