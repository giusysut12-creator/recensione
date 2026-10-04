# Privacy, sicurezza e termini: da verificare prima di una release pubblica

> Non è consulenza legale. È l'elenco dei punti da verificare con un professionista prima di aprire
> lo strumento a utenti esterni.

## Già implementato
- **Chiavi solo lato server**: nessuna variabile `NEXT_PUBLIC_` contiene segreti. Il codice server
  è marcato `server-only` e il bundle del browser è stato controllato.
- **Database chiuso**: RLS attiva su tutte le tabelle, nessuna policy per `anon`/`authenticated`;
  la funzione `claim_run` non è eseguibile da `anon` (verificato).
- **Accesso riservato** con codice + cookie di sessione firmato (HMAC, httpOnly, 30 giorni).
- **Validazione input** (Zod) e **protezione SSRF**: si seguono solo redirect verso host Google.
- **Rate limiting**: limite giornaliero globale e limite orario per client (IP salvato solo come hash).
- **Minimizzazione**: del recensore si salva solo "Nome I."; nessun ID, profilo o foto.
- **Output**: testo sempre renderizzato come testo (niente HTML da recensioni o AI); header di
  sicurezza (`nosniff`, `X-Frame-Options: DENY`, ecc.).
- **Prompt injection**: il testo delle recensioni è delimitato come dato; l'output AI è vincolato a
  uno schema e verificato; nessun tool all'LLM.
- **Niente inferenze sensibili**: il prompt vieta di dedurre caratteristiche personali.

## Da verificare
1. **Termini di Google Maps**: limitano l'estrazione automatica dei contenuti. Apify raccoglie dati
   pubblici, ma la responsabilità d'uso resta a chi lo usa. L'API ufficiale Places restituisce al
   massimo 5 recensioni, insufficiente per questo prodotto. Posizionare l'uso sull'analisi della
   **propria** attività riduce il rischio.
2. **GDPR**: anche se pubblici, i nomi dei recensori sono dati personali. Servono una base giuridica
   (legittimo interesse con bilanciamento documentato), un'informativa, tempi di conservazione
   definiti (proposta: cancellare le recensioni non più usate da analisi dopo 12 mesi) e la gestione
   delle richieste di cancellazione.
3. **Fornitori e trasferimenti**: DPA con il provider AI (uso API senza addestramento sui dati),
   Supabase e Vercel in regione UE, Apify come sub-responsabile.
4. **Termini di Apify e dei provider AI** sull'uso commerciale degli output.
5. **Per un'apertura al pubblico**: termini di servizio, informativa privacy, eventuale banner
   cookie (oggi solo un cookie tecnico di sessione), captcha sul form di analisi.
