# Voce dei Clienti

Uno strumento che trasforma ciò che i clienti scrivono nelle recensioni pubbliche in decisioni:
perché ti scelgono, cosa li delude, cosa vorrebbero, cosa potrebbe bloccare l'acquisto, le parole
che usano e le opportunità concrete. **Ogni conclusione è collegata alle recensioni reali che la
supportano.**

```
INCOLLA URL → ANALIZZA → INSIGHT (con evidenze verificabili)
```

Piano e architettura: [`docs/PHASE1_PLAN.md`](docs/PHASE1_PLAN.md) · Scelta dell'Actor:
[`docs/APIFY_ACTOR.md`](docs/APIFY_ACTOR.md) · Privacy e termini: [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md)

## Come funziona

1. L'utente incolla il link Google Maps dell'attività (anche link brevi `maps.app.goo.gl`).
2. Il server valida e risolve il link (solo host Google, protezione SSRF).
3. Apify raccoglie le recensioni pubbliche (Actor `compass/google-maps-reviews-scraper`).
4. Le recensioni vengono normalizzate in uno schema unico (pronto per Trustpilot & co.).
5. **Estrazione AI per recensione** (modello economico): segnali con citazione testuale.
   Ogni citazione viene verificata nel testo originale: se non c'è, il segnale è scartato.
6. **Temi**: i topic estratti vengono raggruppati in temi chiari.
7. **Aggregazione nel codice**: conteggi, percentuali, rating medio, trend, confronto 4–5★ vs 1–2★.
   L'AI non calcola numeri.
8. **Sintesi AI** (modello più capace): solo interpretazione, con linguaggio prudente, a partire
   dai dati già calcolati. I riferimenti inventati vengono scartati.
9. Dashboard: ogni scheda ha il numero di recensioni, le citazioni e "Vedi le recensioni".
   L'interpretazione AI è sempre etichettata come **Lettura**, separata dall'**Evidenza**.

La pipeline è una macchina a stati salvata in Postgres e avanzata a passi brevi: regge i limiti di
durata delle funzioni Vercel e prosegue anche se l'utente chiude la pagina.

Le recensioni già analizzate (stesso contenuto, stessa versione del prompt) **non vengono mai
rielaborate**: una nuova analisi della stessa attività paga solo le recensioni nuove o modificate.

## Struttura

```
app/                     pagine (home, accesso, analisi) e API
components/              UI (dashboard, pannello evidenze, avanzamento)
lib/sources/google/      URL, Apify, normalizzazione
lib/ai/                  provider astratto (Anthropic/OpenAI), prompt versionati, task, verifica citazioni
lib/insights/            aggregazione deterministica e soglie statistiche
lib/pipeline/            macchina a stati dell'analisi
lib/db/                  accesso a Supabase (solo server)
supabase/migrations/     schema SQL + RLS
scripts/e2e/             test end-to-end locale (servizi simulati + browser)
tests/                   test unitari (vitest)
```

## Setup

### 1. Supabase
1. Crea un progetto (consigliata regione UE, es. Francoforte).
2. SQL Editor → esegui, in ordine, tutti i file di `supabase/migrations/` (`0001_init.sql`,
   `0002_review_translation.sql`, ...).
3. Project Settings → API: copia `Project URL` e la chiave `service_role`.

**Supabase condiviso (piano free già pieno).** Si può usare un progetto esistente mettendo le
tabelle in uno schema separato, senza toccare quelle che ci sono:
1. Genera lo script: `node scripts/schema-sql.mjs vdc > vdc.sql` ed eseguilo nel SQL Editor.
   Crea tutto nello schema `vdc`, in una sola transazione (se qualcosa fallisce non salva nulla),
   e non modifica `public`. Va eseguito una volta sola; per migrazioni future:
   `node scripts/schema-sql.mjs vdc 0003 > nuove.sql`.
2. Project Settings → Data API → *Exposed schemas*: **aggiungi** `vdc` lasciando gli schemi già
   presenti (togliere `public` romperebbe l'altra app).
3. Imposta `SUPABASE_SCHEMA=vdc`.

Verificato su un database che simula un progetto esistente, con tabelle omonime in `public`
(`reviews`, `sources`), un tipo e una funzione con lo stesso nome: dopo installazione e analisi
completa, `public` è identico (struttura, permessi e dati).

RLS è attiva su tutte le tabelle senza policy pubbliche: la chiave `anon` non legge nulla. L'app usa
solo la `service_role`, e solo lato server.

### 2. Apify
Crea un account, copia il token API (Settings → API & Integrations). Prima di andare in produzione
esegui un run di prova dell'Actor dalla Console per confermare input e output (vedi
`docs/APIFY_ACTOR.md`).

### 3. AI
Di default: Anthropic (`ANTHROPIC_API_KEY`). Per usare OpenAI: `AI_PROVIDER=openai`,
`OPENAI_API_KEY`, `AI_MODEL_FAST`, `AI_MODEL_SMART`.

### 4. Variabili d'ambiente
Copia `.env.example` in `.env.local` e compila. Su Vercel: Settings → Environment Variables.

### 5. Avvio locale
```bash
npm install
npm run dev        # http://localhost:3000 → pagina di accesso (APP_ACCESS_CODE)
```

### 6. Deploy su Vercel
1. Importa il repository su Vercel (framework: Next.js).
2. Imposta le variabili d'ambiente (Production e Preview).
3. Deploy. Le route di analisi usano `maxDuration = 300` secondi (Fluid compute).
4. Se attivi la *Deployment Protection* sulle Preview, l'auto-avanzamento interno della pipeline
   viene bloccato: in quel caso l'analisi avanza solo con la pagina aperta. In Production non c'è
   questo problema.

## Test

```bash
npm run lint && npm run typecheck && npm test      # test unitari
```

**Test end-to-end locale** (database reale, Apify e AI simulati, browser reale): richiede Postgres +
PostgREST. Il simulatore `scripts/e2e/mock-services.mjs` espone l'API REST stile Supabase (inoltro a
PostgREST), un Apify finto con dati sintetici e un'API Anthropic finta a regole. Poi:

```bash
SUPABASE_URL=http://127.0.0.1:4010 APIFY_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ... npm run dev
BASE_URL=http://127.0.0.1:3000 ACCESS_CODE=... npm run e2e
```

Il test con dati reali (Apify + AI veri) va eseguito con le chiavi reali, in locale o su Vercel.
