import { describe, expect, it } from "vitest";
import { locateQuote } from "@/lib/ai/quotes";

const text = "Il personale è stato gentilissimo. Purtroppo l’attesa è stata di 40 minuti!\nTornerò comunque.";

describe("locateQuote", () => {
  it("trova citazioni esatte e restituisce il testo originale", () => {
    const m = locateQuote(text, "l’attesa è stata di 40 minuti");
    expect(m?.quote).toBe("l’attesa è stata di 40 minuti");
    expect(text.slice(m!.start, m!.end)).toBe(m!.quote);
  });
  it("tollera apostrofi dritti, maiuscole, spazi e virgolette esterne", () => {
    const m = locateQuote(text, '"PURTROPPO l\'attesa   è stata"');
    expect(m?.quote).toBe("Purtroppo l’attesa è stata");
  });
  it("attraversa gli a capo", () => {
    expect(locateQuote(text, "minuti! Tornerò")?.quote).toBe("minuti!\nTornerò");
  });
  it("rifiuta parafrasi e testo inventato", () => {
    expect(locateQuote(text, "il personale è stato scortese")).toBeNull();
    expect(locateQuote(text, "attesa di quaranta minuti")).toBeNull();
    expect(locateQuote(text, "ok")).toBeNull();
  });
});
