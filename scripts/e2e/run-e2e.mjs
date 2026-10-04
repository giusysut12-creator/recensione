/**
 * Percorso utente end-to-end in un browser reale (Playwright):
 * accesso → incolla URL → Analizza → attesa → dashboard → apre un insight →
 * verifica che le recensioni mostrate contengano davvero la frase evidenziata →
 * ricarica la pagina e verifica che l'analisi sia ancora lì.
 *
 * Uso: BASE_URL=http://127.0.0.1:3100 ACCESS_CODE=... PLACE_URL=... node scripts/e2e/run-e2e.mjs
 * (richiede il pacchetto "playwright"; CHROMIUM_PATH opzionale)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const CODE = process.env.ACCESS_CODE ?? "prova-123456";
const PLACE = process.env.PLACE_URL ?? "https://www.google.com/maps/place/Pizzeria+Il+Forno/@45.46,9.18,17z";
const SHOTS = process.env.SCREENSHOT_DIR;
const TIMEOUT = Number(process.env.E2E_TIMEOUT_MS ?? 15 * 60 * 1000);

const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
  console.log(`  ✓ ${msg}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));

try {
  console.log("1. Accesso");
  await page.goto(BASE);
  assert(page.url().includes("/accesso"), "senza sessione si viene mandati alla pagina di accesso");
  await page.fill("#code", "sbagliato");
  await page.click("button[type=submit]");
  await page.getByText("Codice non corretto").waitFor();
  assert(true, "un codice errato viene rifiutato");
  await page.fill("#code", CODE);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/`);
  await page.waitForLoadState("networkidle");
  assert(true, "con il codice corretto si entra");

  console.log("2. URL non valido");
  await page.fill("#place-url", "https://www.example.com/qualcosa");
  await page.click("text=Analizza le recensioni");
  await page.getByText("Il link non è di Google").waitFor();
  assert(true, "un link non Google mostra un messaggio comprensibile");

  console.log("3. Avvio analisi");
  await page.fill("#place-url", PLACE);
  await page.click("text=Analizza le recensioni");
  await page.waitForURL(/\/analisi\//);
  const analysisUrl = page.url();
  assert(true, `analisi creata: ${analysisUrl}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-progress.png` });

  console.log("4. Attesa elaborazione");
  const started = Date.now();
  await page.getByRole("heading", { name: "Cosa stanno dicendo i tuoi clienti?" }).waitFor({ timeout: TIMEOUT });
  console.log(`  analisi completata in ${Math.round((Date.now() - started) / 1000)}s`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-dashboard.png`, fullPage: true });

  console.log("5. Dashboard");
  const h1 = await page.locator("h1").first().innerText();
  assert(h1.length > 0, `nome attività mostrato: ${h1}`);
  const analyzed = await page.locator("dt:has-text('Recensioni analizzate') + dd").innerText();
  assert(Number(analyzed.replace(/\D/g, "")) > 0, `recensioni analizzate: ${analyzed}`);
  assert(await page.getByText("Lettura").first().isVisible(), "le interpretazioni sono etichettate come Lettura");

  console.log("6. Evidenze di un insight");
  const card = page.locator("article", { has: page.getByRole("button", { name: /Vedi le recensioni/ }) }).first();
  const title = await card.locator("h3").innerText();
  const btnText = await card.getByRole("button", { name: /Vedi le recensioni/ }).innerText();
  const declared = Number(btnText.match(/\((\d+)\)/)?.[1] ?? 0);
  await card.getByRole("button", { name: /Vedi le recensioni/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const shown = await dialog.locator("article").count();
  assert(shown === declared, `"${title}": la card dichiara ${declared} recensioni, il pannello ne mostra ${shown}`);
  const marks = await dialog.locator("mark").allInnerTexts();
  assert(marks.length > 0, `frasi evidenziate nel pannello: ${marks.length}`);
  const texts = await dialog.locator("article p").allInnerTexts();
  assert(marks.every((m) => texts.some((t) => t.includes(m))), "ogni frase evidenziata compare nel testo della recensione");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-evidence.png` });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  console.log("7. Ricarica");
  await page.reload();
  await page.getByRole("heading", { name: "Cosa stanno dicendo i tuoi clienti?" }).waitFor();
  assert(page.url() === analysisUrl, "dopo il ricaricamento l'analisi è ancora disponibile");

  console.log("8. Mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `nessuno scroll orizzontale su mobile (eccedenza ${overflow}px)`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-mobile.png` });

  console.log("\nE2E OK");
} catch (err) {
  console.error("\nE2E FALLITO:", err.message);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/error.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
