"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ERROR_MESSAGES } from "@/lib/pipeline/errors";

export function AnalyzeForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Valore letto dal form all'invio: funziona anche se si incolla prima del caricamento completo
    const url = String(new FormData(e.currentTarget).get("url") ?? "").trim();
    if (!url) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/analyses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.id) {
        setError(data.error ?? "server_error");
        setPending(false);
        return;
      }
      router.push(`/analisi/${data.id}`);
    } catch {
      setError("server_error");
      setPending(false);
    }
  }

  const msg = error ? ERROR_MESSAGES[error] ?? { title: "Qualcosa non ha funzionato", hint: "Riprova tra qualche istante." } : null;

  return (
    <div>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="place-url" className="sr-only">
          Link della tua attività su Google
        </label>
        <input
          id="place-url"
          name="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          required
          placeholder="Incolla il link della tua attività su Google Maps"
          className="min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-4 py-3.5 text-base outline-none placeholder:text-ink-3 focus:border-ink"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-accent px-6 py-3.5 text-base font-medium text-accent-ink transition-opacity disabled:opacity-50"
        >
          {pending ? "Avvio…" : "Analizza le recensioni"}
        </button>
      </form>

      {msg ? (
        <div role="alert" className="mt-3 rounded-lg border border-neg/30 bg-neg-soft px-4 py-3 text-sm">
          <div className="font-medium">{msg.title}</div>
          <div className="text-ink-2">{msg.hint}</div>
        </div>
      ) : null}

      <button type="button" onClick={() => setHelpOpen((v) => !v)} className="mt-4 text-sm text-ink-2 underline underline-offset-4">
        Dove trovo il link?
      </button>
      {helpOpen ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>Cerca la tua attività su Google Maps (app o sito).</li>
          <li>Apri la scheda e premi &ldquo;Condividi&rdquo;.</li>
          <li>Copia il link (es. maps.app.goo.gl/…) e incollalo qui.</li>
        </ol>
      ) : null}
    </div>
  );
}
