/**
 * Verifica delle citazioni: una citazione è accettata solo se è presente nel
 * testo originale. Tolleriamo differenze di spazi, maiuscole e apostrofi/virgolette
 * tipografiche, ma non parole diverse.
 */

function normChar(c: string): string {
  switch (c) {
    case "‘":
    case "’":
    case "ʼ":
    case "`":
    case "´":
      return "'";
    case "“":
    case "”":
    case "«":
    case "»":
      return '"';
    case "–":
    case "—":
      return "-";
    case "…":
      return "...";
    default:
      return c.toLowerCase();
  }
}

/** Testo normalizzato + mappa dall'indice normalizzato all'indice originale. */
function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (!lastWasSpace && norm.length > 0) {
        norm += " ";
        map.push(i);
      }
      lastWasSpace = true;
      continue;
    }
    lastWasSpace = false;
    const n = normChar(c);
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

export interface QuoteMatch {
  quote: string; // estratto dal testo ORIGINALE
  start: number;
  end: number;
}

export function locateQuote(text: string, quote: string): QuoteMatch | null {
  const q = quote
    .trim()
    .replace(/^["'«“”‘’]+|["'»“”‘’]+$/g, "")
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
  if (q.length < 3) return null;
  const t = normalizeWithMap(text);
  const nq = normalizeWithMap(q).norm.trim();
  if (!nq) return null;
  const idx = t.norm.indexOf(nq);
  if (idx === -1) return null;
  const start = t.map[idx];
  const end = t.map[idx + nq.length - 1] + 1;
  return { quote: text.slice(start, end), start, end };
}
