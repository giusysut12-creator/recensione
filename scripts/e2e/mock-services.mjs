/**
 * Servizi simulati per il test end-to-end LOCALE della pipeline.
 *
 *   /rest/v1/*     → inoltro a PostgREST (emula l'API REST di Supabase)
 *   /v2/*          → Apify simulato (avvio run, stato, dataset con dati sintetici)
 *   /v1/messages   → API Anthropic simulata (estrazione a regole, temi, sintesi)
 *
 * Serve a verificare il nostro codice (DB, pipeline, UI) senza rete esterna.
 * NON sostituisce il test con Apify e AI reali.
 *
 * Uso: POSTGREST_URL=http://127.0.0.1:3001 PORT=4010 node scripts/e2e/mock-services.mjs
 * Con MOCK_DATASET_FILE=export.json il finto Apify restituisce un export reale della Console
 * invece dei dati sintetici (utile per verificare la normalizzazione su dati veri).
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import { buildFixture } from "./fixture.mjs";

const PORT = Number(process.env.PORT ?? 4010);
const POSTGREST = process.env.POSTGREST_URL ?? "http://127.0.0.1:3001";
const SCRAPE_POLLS = Number(process.env.MOCK_SCRAPE_POLLS ?? 2); // quante volte risponde RUNNING

const runs = new Map();
const stats = { messages: 0, extractionCalls: 0, themeCalls: 0, synthesisCalls: 0, reviewsExtracted: 0 };

// --- Regole di estrazione simulate (quote = sottostringa esatta del testo) -----
const RULES = [
  { re: /impasto leggero e digeribile/i, kind: "positive_driver", topic: "impasto", label: "Impasto leggero e digeribile" },
  { re: /pizza buonissima|pizza è buonissima|pizza è sempre ottima/i, kind: "positive_driver", topic: "qualità della pizza", label: "Pizza molto buona" },
  { re: /il personale è gentilissimo( e attento)?|personale simpatico/i, kind: "positive_driver", topic: "cortesia del personale", label: "Personale gentile" },
  { re: /serviti in pochi minuti/i, kind: "positive_driver", topic: "tempi di attesa", label: "Servizio rapido" },
  { re: /abbiamo aspettato quaranta minuti/i, kind: "pain_point", topic: "tempi di attesa", label: "Attesa di quaranta minuti", severity: "medium" },
  { re: /il cameriere era scortese/i, kind: "pain_point", topic: "cortesia del personale", label: "Cameriere scortese", severity: "high" },
  { re: /pizza fredda/i, kind: "pain_point", topic: "qualità della pizza", label: "Pizza servita fredda", severity: "medium" },
  { re: /prenotazione non registrata/i, kind: "pain_point", topic: "prenotazioni", label: "Prenotazione non registrata", severity: "medium" },
  { re: /non si capisce come funziona la prenotazione online/i, kind: "confusion", topic: "prenotazioni", label: "Prenotazione online poco chiara" },
  { re: /un po' caro/i, kind: "objection", topic: "prezzo", label: "Prezzo percepito alto" },
  { re: /prezzi giusti/i, kind: "positive_driver", topic: "prezzo", label: "Prezzi giusti" },
  { re: /sarebbe bello avere più opzioni senza glutine/i, kind: "requested_feature", topic: "senza glutine", label: "Più opzioni senza glutine" },
  { re: /cercavo un posto con opzioni senza glutine/i, kind: "desire", topic: "senza glutine", label: "Cerca opzioni senza glutine" },
  { re: /mi aspettavo molto di più/i, kind: "unmet_expectation", topic: "qualità della pizza", label: "Si aspettava di più" },
  { re: /perché è vicino a casa/i, kind: "purchase_driver", topic: "posizione", label: "Vicino a casa" },
  { re: /ci veniamo da anni perché la pizza è sempre ottima/i, kind: "purchase_driver", topic: "qualità della pizza", label: "Torna per la qualità della pizza" },
  { re: /torneremo sicuramente/i, kind: "purchase_driver", topic: "fidelizzazione", label: "Intende tornare" },
  { re: /leggero e digeribile/i, kind: "customer_language", topic: "impasto", label: "Leggero e digeribile" },
  { re: /locale accogliente/i, kind: "customer_language", topic: "atmosfera", label: "Accogliente" },
];

function extract(text, stars) {
  const signals = [];
  for (const r of RULES) {
    const m = text.match(r.re);
    if (m) signals.push({ kind: r.kind, topic: r.topic, label: r.label, quote: m[0], severity: r.severity ?? "none" });
  }
  // Una citazione volutamente inventata: deve essere scartata dalla verifica
  if (stars === 1) signals.push({ kind: "pain_point", topic: "pulizia", label: "Bagno sporco", quote: "il bagno era sporchissimo", severity: "high" });
  const sentiment = stars >= 4 ? "positive" : stars <= 2 ? "negative" : "mixed";
  return { sentiment, sentiment_intensity: stars === 1 || stars === 5 ? 3 : 2, severity: stars <= 2 ? "medium" : "none", topics: [...new Set(signals.map((s) => s.topic))], signals };
}

const THEMES = {
  "qualità della pizza": ["qualita-pizza", "Qualità della pizza"],
  impasto: ["qualita-pizza", "Qualità della pizza"],
  "cortesia del personale": ["personale", "Cortesia del personale"],
  "tempi di attesa": ["tempi-attesa", "Tempi di attesa"],
  prenotazioni: ["prenotazioni", "Prenotazioni"],
  prezzo: ["prezzo", "Prezzo"],
  "senza glutine": ["senza-glutine", "Opzioni senza glutine"],
  posizione: ["posizione", "Posizione"],
};

function messageResponse(model, obj) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(obj) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1000, output_tokens: 300 },
  };
}

function handleMessages(body) {
  stats.messages++;
  const user = body.messages?.[0]?.content ?? "";
  const userText = typeof user === "string" ? user : user.map((c) => c.text ?? "").join("\n");
  const system = typeof body.system === "string" ? body.system : JSON.stringify(body.system);

  if (userText.includes("<review ref=")) {
    stats.extractionCalls++;
    const reviews = [...userText.matchAll(/<review ref="(r\d+)" stelle="(\d)">\n([\s\S]*?)\n<\/review>/g)];
    stats.reviewsExtracted += reviews.length;
    return messageResponse(body.model, { reviews: reviews.map(([, ref, stars, text]) => ({ ref, ...extract(text, Number(stars)) })) });
  }
  if (system.includes("topic grezzi")) {
    stats.themeCalls++;
    const topics = [...userText.matchAll(/^- (.+) \(\d+\)$/gm)].map((m) => m[1]);
    const themes = new Map();
    for (const t of topics) {
      const [key, label] = THEMES[t] ?? ["altro", "Altro"];
      if (!themes.has(key)) themes.set(key, { key, label, description: `Tema ${label}`, topics: [] });
      themes.get(key).topics.push(t);
    }
    return messageResponse(body.model, { themes: [...themes.values()] });
  }
  if (userText.includes("Dati calcolati dalle recensioni")) {
    stats.synthesisCalls++;
    const json = JSON.parse(userText.slice(userText.indexOf("{"), userText.lastIndexOf("}") + 1));
    const items = json.elementi.map((e) => ({
      id: e.id,
      title: `${e.tema}: ${e.cosa_dicono[0] ?? "tema ricorrente"}`.slice(0, 60),
      interpretation: `Emerge in ${e.recensioni} recensioni e potrebbe indicare un aspetto rilevante per l'esperienza.`,
      confidence: e.segnale_debole ? "bassa" : e.recensioni >= 10 ? "alta" : "media",
    }));
    const disappoint = json.elementi.find((e) => e.sezione === "Cosa li delude");
    const love = json.elementi.find((e) => e.sezione === "Cosa amano");
    return messageResponse(body.model, {
      headline: "I clienti apprezzano soprattutto la qualità della pizza e il personale; i tempi di attesa emergono come il problema più ricorrente nelle recensioni recenti.",
      items: [...items, { id: "inventato:xyz", title: "Non esiste", interpretation: "x", confidence: "alta" }],
      comparisons: json.confronti.map((c) => ({ theme_key: c.theme_key, interpretation: `Su ${c.tema} le esperienze positive e negative appaiono molto diverse.`, confidence: "media" })),
      opportunities: [
        disappoint && { type: "correggere", title: "Ridurre e comunicare i tempi di attesa", rationale: "È il problema più citato nelle recensioni negative.", based_on: [disappoint.id], confidence: "media" },
        love && { type: "comunicare", title: "Valorizzare l'impasto nella comunicazione", rationale: "È ciò che i clienti citano di più in positivo.", based_on: [love.id, "inventato:xyz"], confidence: "alta" },
        { type: "sviluppare", title: "Opportunità senza basi", rationale: "Deve essere scartata.", based_on: ["inventato:abc"], confidence: "alta" },
      ].filter(Boolean),
    });
  }
  return messageResponse(body.model, {});
}

// --- Apify simulato ---------------------------------------------------------------
function handleApify(req, url, res) {
  const send = (code, obj) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  let m;
  if (req.method === "POST" && (m = url.pathname.match(/^\/v2\/(?:acts|actors)\/([^/]+)\/runs$/))) {
    const id = `run_${runs.size + 1}`;
    runs.set(id, { polls: 0, actor: decodeURIComponent(m[1]), datasetId: `ds_${id}` });
    return send(201, { data: { id, actId: m[1], status: "RUNNING", defaultDatasetId: `ds_${id}` } });
  }
  if (req.method === "GET" && (m = url.pathname.match(/^\/v2\/actor-runs\/([^/]+)$/))) {
    const run = runs.get(m[1]);
    if (!run) return send(404, { error: { message: "not found" } });
    run.polls++;
    return send(200, { data: { id: m[1], status: run.polls > SCRAPE_POLLS ? "SUCCEEDED" : "RUNNING", defaultDatasetId: run.datasetId } });
  }
  if (req.method === "GET" && (m = url.pathname.match(/^\/v2\/datasets\/([^/]+)\/items$/))) {
    const items = process.env.MOCK_DATASET_FILE ? JSON.parse(readFileSync(process.env.MOCK_DATASET_FILE, "utf8")) : buildFixture();
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 1000);
    const page = items.slice(offset, offset + limit);
    res.writeHead(200, {
      "content-type": "application/json",
      "x-apify-pagination-total": String(items.length),
      "x-apify-pagination-offset": String(offset),
      "x-apify-pagination-limit": String(limit),
      "x-apify-pagination-count": String(page.length),
    });
    return res.end(JSON.stringify(page));
  }
  send(404, { error: { message: `mock: ${req.method} ${url.pathname}` } });
}

// --- Proxy PostgREST -----------------------------------------------------------------
function proxyPostgrest(req, url, res) {
  const target = new URL(url.pathname.replace(/^\/rest\/v1/, "") + url.search, POSTGREST);
  const headers = { ...req.headers, host: target.host };
  const p = http.request(target, { method: req.method, headers }, (pr) => {
    res.writeHead(pr.statusCode ?? 502, pr.headers);
    pr.pipe(res);
  });
  p.on("error", (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
  req.pipe(p);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/rest/v1")) return proxyPostgrest(req, url, res);
    if (url.pathname === "/__stats") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ...stats, apifyRuns: runs.size }));
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (url.pathname.startsWith("/v2/")) return handleApify(req, url, res);
      if (url.pathname === "/v1/messages") {
        const body = JSON.parse(raw || "{}");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(handleMessages(body)));
      }
      res.writeHead(404);
      res.end("not found");
    });
  })
  .listen(PORT, () => console.log(`mock services on :${PORT}`));
