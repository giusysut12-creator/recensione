# FASE 1 — Piano di prodotto e architettura (V1)

> Stato: **bozza da approvare**. Nessun codice applicativo è stato scritto.
> Le voci marcate **[DA VERIFICARE]** non sono state confermate su fonte primaria (vedi §6.4).

---

## 1. Interpretazione del prodotto

Non è un "sentiment analyzer". È uno strumento decisionale per l'imprenditore:

```
RECENSIONI → EVIDENZE → INSIGHT → DECISIONI → AZIONI
```

Tre regole di prodotto che guidano ogni scelta tecnica:

1. **I numeri li calcola il codice, non l'AI.** L'LLM estrae segnali dalle singole recensioni
   (con citazione testuale). Conteggi, percentuali, medie e trend sono calcolati in modo
   deterministico (SQL/TypeScript) a partire da quei segnali. L'AI scrive solo l'interpretazione,
   ricevendo i numeri già calcolati.
2. **Nessuna citazione inventata.** Ogni citazione estratta deve essere una sottostringa
   verificabile del testo originale. Se non lo è, viene scartata.
3. **Evidenza ≠ Interpretazione.** In UI sono due zone visivamente distinte:
   "Cosa dicono le recensioni" (fatti: conteggi, citazioni, link) vs "Lettura AI" (ipotesi,
   con livello di confidenza e linguaggio prudente).

Domanda guida di ogni schermata: **"Cosa significa per la mia azienda?"**

---

## 2. User flow V1

```
[Home]  Incolla il link della tua attività su Google  →  [Analizza le recensioni]
   │
   ▼  (validazione immediata lato client + server)
[Elaborazione]  pagina con URL stabile /analisi/{id} — si può chiudere e tornare
   1. "Stiamo trovando la tua attività…"          (risoluzione URL)
   2. "Stiamo raccogliendo le recensioni… 214"    (Apify)
   3. "Stiamo leggendo le recensioni… 120/214"    (estrazione AI)
   4. "Stiamo individuando i temi ricorrenti…"    (consolidamento + aggregazione)
   5. "Stiamo preparando le conclusioni…"         (sintesi)
   │
   ▼
[Dashboard]  Header: nome attività · rating · n. recensioni analizzate · periodo
   A. Panoramica (rating, distribuzione stelle, sentiment secondario, temi principali)
   ── COSA STANNO DICENDO I TUOI CLIENTI? ──
   B. Perché ti scelgono          F. Aspettative disattese
   C. Cosa amano                  G. Cosa potrebbe bloccare l'acquisto (obiezioni)
   D. Cosa li delude              H. Le parole che usano per descriverti
   E. Cosa vorrebbero             I. Opportunità (+ "Cosa non capiscono")
   ── Stesso tema, esperienze opposte ── (confronto 4–5★ vs 1–2★)
   │
   ▼  click su qualunque card
[Pannello evidenze]  "27 recensioni" → elenco recensioni reali, frase rilevante evidenziata,
                     stelle, data, risposta del titolare, link alla recensione su Google
```

Stati di errore in linguaggio semplice: link non riconosciuto, attività non trovata,
attività senza recensioni, raccolta fallita (con "Riprova"), analisi parziale.

---

## 3. Architettura

```
Browser (Next.js, solo UI)          Vercel (server)                       Servizi esterni
───────────────────────────        ──────────────────────────────        ───────────────
Home / Dashboard / Evidenze  ──►   Route handlers + Server Components ──► Apify (Actor)
  (nessuna chiave, nessun            lib/sources/google  (URL, Apify)      LLM provider
   accesso diretto al DB)            lib/pipeline        (state machine)   Supabase Postgres
                                     lib/ai              (provider astratto)
                                     lib/db              (service role, server-only)
```

### 3.1 Stack
Next.js (App Router) + TypeScript · Tailwind CSS · Supabase (Postgres, regione EU) ·
Apify (`apify-client`) · Zod per validare ogni dato in ingresso/uscita · deploy su Vercel.

### 3.2 Pipeline a step (vincolo Vercel)
Una raccolta Apify può durare minuti e l'estrazione AI di centinaia di recensioni anche.
Le funzioni serverless hanno un tempo massimo, quindi la pipeline è una **state machine
persistita in DB**, avanzata a piccoli passi idempotenti (< 60 s ciascuno):

```
queued → resolving_url → scraping → importing → extracting (batch per batch)
       → consolidating_themes → aggregating → synthesizing → completed | failed
```

- Ogni step legge lo stato da `analysis_runs`, fa una porzione di lavoro, salva e rilascia.
- Avanzamento guidato da: (a) polling della pagina di elaborazione (`/api/runs/{id}/advance`),
  (b) webhook Apify a fine raccolta, (c) `after()` di Next.js per concatenare step.
- Un lock con scadenza (`locked_until`) impedisce esecuzioni concorrenti dello stesso run.
- Se l'utente chiude la pagina, il run riprende alla prossima visita; nulla va perso.
- Upgrade futuro senza riscrivere: una coda (Supabase Queues / Inngest) può chiamare gli stessi step.

### 3.3 Astrazione provider AI
```ts
// lib/ai/provider.ts
interface LLMProvider {
  generateStructured<T>(req: {
    tier: "fast" | "smart";          // modello economico vs capace
    system: string;
    input: string;
    schema: ZodSchema<T>;            // output sempre validato
    promptVersion: string;
  }): Promise<{ data: T; usage: TokenUsage; model: string }>;
}
// lib/ai/providers/anthropic.ts, lib/ai/providers/openai.ts
// lib/ai/tasks/: extractReviewSignals(), consolidateThemes(), synthesizeInsights(), ...
```
Selezione via env: `AI_PROVIDER`, `AI_MODEL_FAST`, `AI_MODEL_SMART`. Il resto dell'app chiama
solo i task, mai l'SDK del provider.

### 3.4 Struttura repository (prevista)
```
app/                      pagine e route handlers
  page.tsx                home (input URL)
  analisi/[id]/page.tsx   elaborazione + dashboard
  api/runs/…              create / advance / status
  api/webhooks/apify/     webhook firmato
components/               UI (cards, evidence drawer, stars, ...)
lib/sources/              adapter per fonte: google/ (oggi), trustpilot/ (domani)
lib/pipeline/             state machine e step
lib/ai/                   provider, task, prompt versionati, schemi Zod
lib/insights/             aggregazione deterministica, soglie statistiche
lib/db/                   client server-only, query
supabase/migrations/      schema SQL + RLS
docs/                     decisioni, scelta Actor, compliance
```

---

## 4. Schema database (Supabase / Postgres)

Catena di tracciabilità garantita: **insight → analysis_run → evidence → mention → review → source → business**.

| Tabella | Scopo | Campi principali |
|---|---|---|
| `businesses` | L'attività | `id, name, category, website_url` (per futuro Brand Promise Gap) |
| `sources` | Una fonte di recensioni per attività | `id, business_id, platform` (`google`, `trustpilot`, `shopify`, …), `external_id` (placeId Google), `canonical_url, input_url, platform_rating, platform_review_count, last_fetched_at` · **unique(platform, external_id)** |
| `reviews` | Recensioni normalizzate, schema unico multi-fonte | `id, source_id, external_review_id, author_display, rating, text, language, review_date, owner_reply_text, owner_reply_date, review_url, content_hash, raw (minimizzato), first_seen_at, last_seen_at` · **unique(source_id, external_review_id)** |
| `analysis_runs` | Una analisi | `id, business_id, status, stage, progress, error_code, settings (max_reviews, …), apify_run_id, apify_dataset_id, pipeline_version, prompt_versions, models, reviews_total, reviews_with_text, period_from, period_to, token_usage, cost_estimate, locked_until, created_at, completed_at` |
| `analysis_run_reviews` | Quali recensioni compongono il campione del run | `run_id, review_id` |
| `review_extractions` | Output AI per singola recensione (**cache**) | `id, review_id, content_hash, extraction_version, model, sentiment, sentiment_intensity, severity, result (jsonb), created_at` · **unique(review_id, content_hash, extraction_version)** |
| `review_signals` | Segnali normalizzati, uno per riga (base dei conteggi) | `id, extraction_id, review_id, kind` (`positive_driver, pain_point, objection, desire, requested_feature, unmet_expectation, purchase_driver, confusion, customer_language`), `raw_topic, label, quote, quote_start, quote_end, severity` |
| `run_themes` | Temi canonici del run (es. "Assistenza", "Consegna") | `id, run_id, key, label, description` |
| `signal_themes` | Mappatura segnale → tema canonico per run | `run_id, signal_id, theme_id` |
| `insights` | Insight aggregati | `id, run_id, section` (B…I + `comparison`), `theme_id, title, ai_interpretation, confidence, metrics (jsonb calcolato dal codice), rank` |
| `insight_evidence` | Collegamento insight ↔ recensioni | `insight_id, review_id, signal_id, role` (`supporting`, `contrasting`) |
| `recommendations` | **Predisposta** per moduli Migliora / ADV / Contenuti / Recupero | `id, run_id, module, payload (jsonb), source_insight_ids, source_review_ids, status` (`proposed → approved → rejected → executed`), `approved_by, approved_at` |

Note:
- Le estrazioni sono legate a `review + content_hash + extraction_version`, non al run: una
  recensione invariata **non viene mai ri-analizzata**; più run la riusano.
- I dati AI non sono duplicati: gli insight puntano a segnali/recensioni, non li copiano.
- `metrics` contiene solo valori calcolati dal codice (conteggio, base, %, rating medio, trend).
- Trustpilot/Shopify/WooCommerce = nuovo adapter in `lib/sources/*` che produce lo stesso
  `NormalizedReview`. Nessuna modifica al modello dati.
- Brand Promise Gap (futuro): tabella `brand_claims(business_id, claim, theme_key, source_url)`
  da confrontare con `run_themes` + metriche. `businesses.website_url` è già previsto.
- **RLS attiva su tutte le tabelle, nessuna policy per `anon`**: il browser non accede mai al DB;
  tutte le letture passano da codice server.

---

## 5. Pipeline Apify (Google)

```
URL incollato
 → validazione sintattica (Zod) + allowlist host Google
 → se link breve (maps.app.goo.gl, goo.gl/maps, g.page, share.google):
     risoluzione redirect lato server, max 5 salti, ogni salto ricontrollato
     contro l'allowlist (protezione SSRF), timeout breve
 → URL canonico /maps/place/... (o /maps/search/... con place/cid)
 → avvio Actor in modalità asincrona + webhook di completamento
 → lettura dataset paginata
 → normalizzazione → upsert in `reviews` (dedup su external_review_id, fallback su hash)
```

### 5.1 Actor proposto
**`compass/google-maps-reviews-scraper`** ("Google Maps Reviews Scraper", pubblicato
dall'organizzazione Apify che mantiene i Google Maps scraper ufficiali dello Store).

Motivazione: è il più usato e mantenuto per le sole recensioni; accetta direttamente URL di
schede; espone `reviewId` stabile (necessario per deduplica e cache). Esistono Actor di terze
parti più economici (~$0.20–0.30 / 1.000 recensioni) ma con manutenzione meno garantita:
l'adapter è isolato, quindi sostituire l'Actor costa poco.

### 5.2 Input (verificato da documentazione pubblica dell'Actor)
- `startUrls`: URL di schede Google Maps — sono validi gli URL con `/maps/search`, `/maps/place`, `/maps/reviews`
- `maxReviews`: massimo per luogo
- `reviewsSort`: `newest` | `mostRelevant` | `highestRanking` | `lowestRanking`
- **[DA VERIFICARE]** `language`, filtro per data di partenza (utile per scaricare solo
  recensioni nuove), opzione per escludere i dati personali del recensore.

### 5.3 Output (campi citati nella documentazione pubblica)
`reviewId`, `stars`, `text`, `publishedAtDate`, `responseFromOwnerText`, `reviewUrl`,
`placeId`, `totalScore`, oltre a dati del recensore e del luogo.
**[DA VERIFICARE]** nome esatto dei campi `title`/nome attività, `reviewsCount`,
`textTranslated`, `responseFromOwnerDate`, `name` del recensore.

Il normalizzatore è difensivo (Zod con campi opzionali + `raw` conservato in forma ridotta) e
la mappatura sarà confermata con un run reale prima di considerarla completa.

### 5.4 Normalizzazione
| Campo normalizzato | Origine | Gestione casi limite |
|---|---|---|
| `source` | costante `google` | — |
| `external_review_id` | `reviewId` | se assente: hash(autore+data+testo) |
| `author_display` | nome recensore | **minimizzato** (vedi decisione D4) |
| `rating` | `stars` | intero 1–5; scarto se mancante |
| `review_text` | `text` | `null` se vuoto → conta solo per statistiche di rating |
| `review_date` | `publishedAtDate` | `null` ammesso; esclusa dai trend |
| `business_reply` | `responseFromOwnerText` | `null` se assente |
| `review_url` | `reviewUrl` | opzionale |
| `raw_data` | record Apify | solo i campi utili, senza foto/ID profilo |

Errori gestiti: URL non valido · attività non trovata · zero recensioni · run Apify fallito o
in timeout · dataset vuoto · credito Apify esaurito. Ognuno ha un `error_code` e un messaggio
comprensibile.

### 5.5 Costi Apify [DA VERIFICARE sul listino attuale]
Ordine di grandezza dello Store: ~$0.20–0.60 per 1.000 recensioni. Con un tetto di
300 recensioni per analisi: pochi centesimi per analisi.

---

## 6. Pipeline AI

```
reviews del campione
 │
 ├─ senza testo ───────────────► solo statistiche di rating (nessuna chiamata AI)
 │
 └─ con testo
     1. ESTRAZIONE (modello economico, batch ~20 recensioni, output strutturato)
        cache: salta se esiste extraction(review_id, content_hash, version)
     2. VALIDAZIONE (codice): schema Zod, enum, ogni quote ⊂ testo originale
     3. CONSOLIDAMENTO TEMI (modello economico, input = etichette uniche + frequenze,
        non le recensioni) → 8–15 temi canonici del run
     4. AGGREGAZIONE (codice, deterministica): per tema × tipo di segnale
        conteggi, % sulla base pertinente, rating medio, split 4–5★ vs 1–2★, trend
     5. SINTESI (modello capace, input = tabella aggregata + citazioni scelte dal codice)
        → interpretazione per sezione, confronto positivo/negativo, opportunità,
          confidenza, linguaggio prudente
     6. VALIDAZIONE (codice): ogni insight deve riferirsi a temi/segnali esistenti;
        le evidenze vengono collegate dal codice, non dall'AI
```

### 6.1 Output estrazione (per recensione)
```json
{
  "review_id": "uuid",
  "sentiment": "positive | mixed | negative | neutral",
  "sentiment_intensity": 1,
  "severity": "none | low | medium | high",
  "topics": ["tempi di consegna", "packaging"],
  "signals": [
    {
      "kind": "pain_point",
      "topic": "tempi di consegna",
      "label": "Consegna in ritardo rispetto alla data promessa",
      "quote": "è arrivato dopo due settimane",
      "severity": "medium"
    }
  ],
  "notable_customer_language": ["arrivato dopo due settimane"]
}
```
Regole del prompt: niente categorie forzate (`[]`/`null` se non c'è evidenza); niente
inferenze su persone o caratteristiche sensibili; testo della recensione trattato come dato
(delimitato, mai come istruzione); etichette in italiano, citazioni in lingua originale.

### 6.2 Output insight (per card)
```json
{
  "section": "disappoints",
  "theme_key": "consegna",
  "title": "Consegna",
  "evidence": {
    "review_count": 27,
    "base": 180,
    "share": 0.15,
    "avg_rating": 2.1,
    "trend": "in aumento negli ultimi 6 mesi",
    "examples": ["review_id_1", "review_id_7", "review_id_12"]
  },
  "interpretation": {
    "text": "I ritardi di consegna ricorrono soprattutto nelle recensioni da 1–2 stelle e potrebbero pesare sul giudizio complessivo.",
    "confidence": "media"
  }
}
```
`evidence` è calcolato dal codice; solo `interpretation` viene dall'AI.

### 6.3 Soglie statistiche (anti-sovrainterpretazione)
- Percentuale mostrata solo con base ≥ 20 recensioni con testo; altrimenti "n su m".
- Tema con < 3 recensioni → etichetta "segnale debole", mai tra gli insight principali.
- Trend solo se ≥ 2 periodi con ≥ 15 recensioni ciascuno.
- Linguaggio imposto: "emerge frequentemente", "appare associato", "potrebbe indicare".
  Mai causalità.

### 6.4 Costi AI (stima per 300 recensioni, ~250 con testo)
- Estrazione con modello economico: ~15 chiamate, ~50k token in / ~45k out → ordine di
  grandezza **$0.20–0.40**.
- Consolidamento + sintesi con modello capace: ~25k in / ~8k out → **$0.10–0.20**.
- Rianalisi della stessa attività: si pagano solo le recensioni nuove o modificate.
- Prompt caching del system prompt di estrazione (stesso prefisso per tutti i batch).

---

## 7. Moduli successivi (architettura predisposta, non nella V1 base)

Tutti scrivono in `recommendations` con riferimenti a insight/recensioni sorgente e stato.

- **Migliora prodotto/servizio**: pain point + aspettative disattese → problema, frequenza,
  severità, evidenze, possibile intervento, confidenza.
- **Trova angoli ADV**: prima la matrice Voice of Customer (problema, desiderio, obiezione,
  beneficio percepito, proof, linguaggio cliente) costruita dai dati aggregati; poi angolo,
  hook, promessa, proof, idea creativa, ciascuno con gli insight/review che lo hanno generato.
- **Crea contenuti**: da domande, obiezioni, pain point, desideri, casi d'uso, elementi apprezzati
  → insight sorgente, idea, formato, messaggio centrale, perché è rilevante.
- **Recupera cliente**: recensioni problematiche ordinate per priorità (severità, recenza,
  assenza di risposta), bozza di risposta, azione di recovery suggerita.
  Principio: **AI PROPONE → ESSERE UMANO APPROVA → SISTEMA ESEGUE**. Nessun invio automatico.
- **Brand Promise Gap**: estrazione delle promesse dal sito → `brand_claims` → confronto con
  temi/metriche delle recensioni → "possibile gap di posizionamento".

---

## 8. Privacy, sicurezza, compliance

Tecnico (V1):
- Chiavi solo in env server-side; moduli DB/AI marcati `server-only`. Nessuna variabile
  `NEXT_PUBLIC_` con segreti.
- RLS su tutte le tabelle, nessun accesso anonimo; il client riceve solo dati già filtrati.
- Validazione input (Zod), allowlist host per gli URL, protezione SSRF sui redirect.
- Output renderizzato come testo (niente HTML grezzo dalle recensioni o dall'AI).
- Rate limiting: per IP/utente e tetto giornaliero globale di analisi (contatori in Postgres),
  tetto recensioni per analisi.
- Webhook Apify verificato con segreto condiviso.
- Minimizzazione: niente foto, ID profilo o link profilo del recensore; nome ridotto.

Da verificare prima di una release pubblica (non è consulenza legale):
1. **Termini di Google**: i Termini di Google Maps limitano l'estrazione automatica dei
   contenuti. Apify raccoglie dati pubblici, ma la responsabilità d'uso resta a chi lo usa.
   L'API ufficiale Places restituisce solo 5 recensioni, insufficiente per il prodotto.
   → valutazione legale necessaria; posizionare l'uso sulla **propria** attività dell'utente
   riduce il rischio.
2. **GDPR**: i nomi dei recensori sono dati personali anche se pubblici → base giuridica
   (legittimo interesse + bilanciamento), informativa, minimizzazione, conservazione limitata,
   gestione richieste di cancellazione.
3. **Fornitori**: DPA con provider AI (uso API senza addestramento), Supabase e Vercel in regione
   UE, Apify (sub-responsabile).
4. **Termini Apify** sull'uso commerciale degli output, e termini dei provider AI.
5. Se si apre al pubblico: termini di servizio, informativa privacy, cookie (anche solo tecnici).

---

## 9. Scope

### V1 (questa build)
- Solo Google, via URL pubblico (lunghi e brevi).
- Pipeline completa e persistente: URL → Apify → normalizzazione → estrazione → temi →
  aggregazione → sintesi → dashboard.
- Dashboard sezioni A–I + confronto "stesso tema, esperienze opposte".
- Pannello evidenze su ogni card, recensioni con frase evidenziata.
- Elenco completo delle recensioni recuperate con filtro per stelle.
- Distinzione visiva evidenza / interpretazione AI.
- Cache estrazioni + rianalisi incrementale.
- Accesso protetto (vedi D1) e rate limiting.

### V1.1 (subito dopo, se la V1 regge su dati reali)
- Modulo "Migliora prodotto/servizio".
- Modulo "Recupera cliente" (lista priorità + bozza risposta + approvazione).

### Rimandato
- Moduli ADV e Contenuti · Trustpilot e altre fonti · Brand Promise Gap · account multi-utente
  e team · export PDF · rianalisi pianificate · confronto con competitor · multilingua UI.

---

## 10. Rischi principali

| Rischio | Mitigazione |
|---|---|
| Actor Apify che si rompe o cambia output | Adapter isolato, Zod difensivo, errori chiari, Actor sostituibile |
| Limiti di durata delle funzioni Vercel | Pipeline a step persistita, idempotente, riprendibile |
| Allucinazioni / citazioni inventate | Quote verificate come sottostringhe; numeri solo dal codice |
| Campioni piccoli → conclusioni forzate | Soglie statistiche, "segnale debole", linguaggio prudente |
| Prompt injection nelle recensioni | Testo delimitato come dato, output vincolato a schema, nessun tool all'LLM |
| Costi fuori controllo | Tetto recensioni, cache, accesso protetto, limiti giornalieri |
| Temi incoerenti tra analisi | Consolidamento per run + versionamento prompt; tassonomia stabile in V2 |
| ToS / GDPR | Vedi §8, da validare prima del lancio pubblico |
| **Test end-to-end da questo ambiente** | Oggi la rete del container blocca Apify, Supabase, OpenAI e Vercel: serve abilitarli (vedi D6) |

---

## 11. Decisioni che richiedono approvazione

- **D1 – Accesso V1**: (a) consigliato: area riservata con login via email (magic link Supabase)
  e lista di email autorizzate; (b) pubblico con rate limit + captcha.
- **D2 – Provider AI**: consigliato Anthropic (modello economico per estrazione, modello più capace
  per sintesi); OpenAI resta pronto tramite l'astrazione. Quale chiave hai già?
- **D3 – Recensioni per analisi**: consigliato 300 più recenti (modificabile fino a 1.000).
- **D4 – Nome del recensore**: consigliato salvare solo forma ridotta ("Marco R.").
- **D5 – Actor**: `compass/google-maps-reviews-scraper` (affidabilità) vs alternativa più
  economica di terze parti.
- **D6 – Accessi per il test reale**: account/chiavi Apify, AI, progetto Supabase (regione UE),
  progetto Vercel collegato al repo; abilitazione di rete per `api.apify.com`,
  `*.supabase.co` e il provider AI scelto.
- **D7 – Lingua UI**: solo italiano in V1.
