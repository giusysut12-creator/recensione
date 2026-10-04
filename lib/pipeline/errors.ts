/** Codici di errore mostrati all'utente con messaggi comprensibili. */
export const ERROR_MESSAGES: Record<string, { title: string; hint: string }> = {
  invalid_url: {
    title: "Il link non sembra valido",
    hint: "Copia il link della tua attività da Google Maps (pulsante \"Condividi\") e incollalo di nuovo.",
  },
  not_google: {
    title: "Il link non è di Google",
    hint: "Per ora analizziamo solo le recensioni Google. Usa il link della scheda della tua attività su Google Maps.",
  },
  not_a_place: {
    title: "Il link non porta a una singola attività",
    hint: "Apri la tua attività su Google Maps, premi \"Condividi\" e copia il link.",
  },
  resolve_failed: {
    title: "Non siamo riusciti ad aprire il link",
    hint: "Controlla che il link funzioni nel browser e riprova.",
  },
  place_not_found: {
    title: "Non abbiamo trovato l'attività",
    hint: "Verifica che il link apra la scheda corretta su Google Maps.",
  },
  no_reviews: {
    title: "Questa attività non ha ancora recensioni pubbliche",
    hint: "Quando arriveranno le prime recensioni potrai analizzarle qui.",
  },
  scrape_failed: {
    title: "La raccolta delle recensioni non è riuscita",
    hint: "Può capitare: riprova tra qualche minuto.",
  },
  analysis_failed: {
    title: "L'analisi si è interrotta",
    hint: "Riprova tra qualche minuto. Le recensioni già lette non verranno rielaborate.",
  },
  rate_limited: {
    title: "Hai avviato molte analisi in poco tempo",
    hint: "Attendi un po' prima di avviarne un'altra.",
  },
  daily_limit: {
    title: "Limite giornaliero raggiunto",
    hint: "Il numero massimo di analisi per oggi è stato raggiunto. Riprova domani.",
  },
};

export class PipelineError extends Error {
  constructor(
    readonly code: keyof typeof ERROR_MESSAGES | string,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}
