# Scelta dell'Actor Apify per le recensioni Google

## Scelta
**`compass/google-maps-reviews-scraper`** (Google Maps Reviews Scraper), configurabile con
`APIFY_GOOGLE_REVIEWS_ACTOR`.

Perché:
- è pubblicato dall'organizzazione che mantiene i Google Maps scraper più usati dello Store Apify;
- accetta direttamente l'URL della scheda (`/maps/place`, `/maps/search`, `/maps/reviews`);
- restituisce un `reviewId` stabile, indispensabile per deduplicare e non rianalizzare le recensioni.

Esistono Actor di terze parti più economici (circa $0,20–0,30 ogni 1.000 recensioni secondo i loro
listini), con manutenzione meno garantita. L'integrazione è isolata in `lib/sources/google/`:
cambiare Actor significa cambiare la variabile d'ambiente e, se servono, i nomi dei campi in
`normalize.ts`.

## Cosa è stato verificato e cosa no

Dalla documentazione pubblica dell'Actor (le pagine apify.com non erano raggiungibili dall'ambiente
di sviluppo; le informazioni sono state raccolte da risultati di ricerca sulle pagine ufficiali):

| Elemento | Stato |
|---|---|
| Input `startUrls` (URL di schede), `maxReviews`, `reviewsSort` (`newest`, `mostRelevant`, `highestRanking`, `lowestRanking`) | verificato |
| Output `reviewId`, `stars`, `text`, `publishedAtDate`, `responseFromOwnerText`, `reviewUrl`, `placeId`, `totalScore` | verificato |
| Output `title`, `categoryName`, `address`, `reviewsCount`, `name`, `responseFromOwnerDate`, `originalLanguage`, `textTranslated`, `translatedLanguage` | **verificato** su un export reale completo (100 recensioni) |
| Input `language`, `personalData`, `reviewsStartDate` (`AAAA-MM-GG`) | **verificato** sul JSON di input della Console. Usati: `language: "it"`, `personalData: false`; `reviewsStartDate` predisposto per le rianalisi incrementali |
| Prezzo | **misurato**: run reale con 100 risultati = $0,06 (~$0,60 ogni 1.000 recensioni), tariffa *pay per event* |

**Export reali (Console, 4 ottobre 2026).** Il primo export conteneva solo `title`, `url`, `stars`,
`name`, `reviewUrl`, `text` (vista ridotta della Console). Il secondo, con tutti i campi, conferma
`reviewId`, `publishedAtDate` (ISO), `placeId`, `totalScore`, `reviewsCount`, `categoryName`,
`originalLanguage` e `textTranslated` (traduzione nella lingua richiesta, conservata e mostrata
all'utente). Nota: `language` è la lingua *richiesta*, non quella della recensione. L'output contiene
anche dati del recensore (`reviewerId`, `reviewerUrl`, `reviewerPhotoUrl`,
`reviewerNumberOfReviews`, `isLocalGuide`) che **non** salviamo. Su 100 recensioni reali: 100
normalizzate, 60 con testo, 11 lingue diverse. Confermati: `stars` intero, `text` `null` per
le recensioni con solo voto, testi in più lingue, `url` con il parametro `query_place_id`, `name` con
il nome completo (che riduciamo). Per robustezza il normalizzatore ricava il `placeId` da
`query_place_id` e, se manca `reviewId`, usa l'URL della recensione come ID stabile.

Con la versione installata di `apify-client`, l'avvio di un Actor chiama `POST /v2/actors/{id}/runs`
(verificato nel test locale).

## Come usiamo l'Actor
- Avvio asincrono con `maxReviews` = limite per analisi (default 300, le più recenti).
- Tetto di spesa: `maxTotalChargeUsd` (`APIFY_MAX_CHARGE_USD`, default $1), valido per gli Actor
  *pay per event* come questo; `maxItems` copre il caso di Actor pagati a risultato.
- `timeout` 600 secondi; un run fallito o scaduto produce un errore comprensibile all'utente.
- Lettura del dataset a pagine con `clean: true`.
- `personalData: false`: l'Actor non restituisce nome, ID, profilo e foto dei recensori (le recensioni
  appaiono come "Cliente"). Se un giorno arrivassero comunque, non vengono salvati e il nome viene
  ridotto a "Nome I.". Le impostazioni di privacy non sono sovrascrivibili da `APIFY_EXTRA_INPUT`.
- `language: "it"`: le recensioni in altre lingue arrivano con la traduzione italiana di Google.

## Checklist per il primo run reale
1. Dalla Console Apify, esegui l'Actor con un URL reale e `maxReviews: 20`; oppure, da terminale,
   con lo stesso codice dell'app (URL, input, normalizzazione) e senza Supabase né AI:
   `APIFY_TOKEN=... node scripts/real-run/google-reviews.mts "<link>" 100 /percorso/fuori/dal/repo`.
   Il token deve poter avviare Actor e leggere run e dataset: un token con permessi ristretti
   risponde `403 insufficient-permissions`.
2. Confronta un elemento del dataset con la mappatura in `lib/sources/google/normalize.ts`.
3. Controlla il costo del run e aggiorna `MAX_REVIEWS_PER_ANALYSIS` se necessario.
4. Se l'Actor espone un'opzione per escludere i dati personali dei recensori, attivala con
   `APIFY_EXTRA_INPUT`.
