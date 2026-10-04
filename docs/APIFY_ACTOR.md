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
| Output `title`, `categoryName`, `address`, `reviewsCount`, `name`, `responseFromOwnerDate`, `originalLanguage` | **da verificare** al primo run reale: il normalizzatore li tratta come opzionali |
| Input per lingua, data minima, esclusione dati personali del recensore | **da verificare**: non usati. Si possono aggiungere con `APIFY_EXTRA_INPUT` dopo la verifica |
| Prezzo per 1.000 recensioni | **da verificare** sul listino attuale nella Console Apify |

**Primo export reale (Console, 4 ottobre 2026):** l'export conteneva solo `title`, `url`, `stars`,
`name`, `reviewUrl`, `text`. Probabilmente si trattava della vista ridotta della Console: va
ricontrollato con un export di tutti i campi, o via API. Confermati: `stars` intero, `text` `null` per
le recensioni con solo voto, testi in più lingue, `url` con il parametro `query_place_id`, `name` con
il nome completo (che riduciamo). Per robustezza il normalizzatore ricava il `placeId` da
`query_place_id` e, se manca `reviewId`, usa l'URL della recensione come ID stabile.

Con la versione installata di `apify-client`, l'avvio di un Actor chiama `POST /v2/actors/{id}/runs`
(verificato nel test locale).

## Come usiamo l'Actor
- Avvio asincrono con `maxReviews` = limite per analisi (default 300, le più recenti).
- `maxItems` = tetto di spesa per gli Actor a pagamento per risultato.
- `timeout` 600 secondi; un run fallito o scaduto produce un errore comprensibile all'utente.
- Lettura del dataset a pagine con `clean: true`.
- Del dato originale conserviamo solo i campi utili. Non conserviamo ID, link al profilo o foto del
  recensore; il nome viene ridotto a "Nome I.".

## Checklist per il primo run reale
1. Dalla Console Apify, esegui l'Actor con un URL reale e `maxReviews: 20`.
2. Confronta un elemento del dataset con la mappatura in `lib/sources/google/normalize.ts`.
3. Controlla il costo del run e aggiorna `MAX_REVIEWS_PER_ANALYSIS` se necessario.
4. Se l'Actor espone un'opzione per escludere i dati personali dei recensori, attivala con
   `APIFY_EXTRA_INPUT`.
