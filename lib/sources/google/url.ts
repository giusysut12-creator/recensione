/**
 * Validazione e risoluzione degli URL di schede Google.
 *
 * Sicurezza (SSRF): seguiamo i redirect manualmente e solo verso host Google noti.
 */

const SHORT_LINK_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.page", "share.google", "g.co"]);

function isGoogleHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "maps.google.com" || h === "google.com" || h === "www.google.com") return true;
  // www.google.it, google.co.uk, maps.google.de, ...
  return /^(www\.|maps\.)?google\.(com?\.)?[a-z]{2,3}$/.test(h);
}

// Host ammessi solo come passaggio intermedio di un redirect
const REDIRECT_ONLY_HOSTS = new Set(["consent.google.com"]);

export function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return isGoogleHost(h) || SHORT_LINK_HOSTS.has(h) || REDIRECT_ONLY_HOSTS.has(h);
}

export type UrlCheck =
  | { ok: true; url: URL; kind: "place" | "short" | "search" }
  | { ok: false; code: "invalid_url" | "not_google" | "not_a_place" };

/** Controllo sintattico, senza rete. Usato sia lato server che per feedback immediato. */
export function checkGoogleUrl(input: string): UrlCheck {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) return { ok: false, code: "invalid_url" };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, code: "invalid_url" };
  url.protocol = "https:";
  if (url.username || url.password || url.port) return { ok: false, code: "invalid_url" };

  const host = url.hostname.toLowerCase();

  if (SHORT_LINK_HOSTS.has(host)) {
    // goo.gl generico è stato dismesso: accettiamo solo goo.gl/maps/...
    if (host === "goo.gl" && !url.pathname.startsWith("/maps")) return { ok: false, code: "not_a_place" };
    if (url.pathname.length <= 1) return { ok: false, code: "not_a_place" };
    return { ok: true, url, kind: "short" };
  }

  if (!isGoogleHost(host)) return { ok: false, code: "not_google" };

  const path = url.pathname;
  if (path.startsWith("/maps/place/") || path.startsWith("/maps/reviews")) {
    return { ok: true, url, kind: "place" };
  }
  if (path.startsWith("/maps/search/") || (path.startsWith("/maps") && (url.searchParams.has("cid") || url.searchParams.has("q")))) {
    return { ok: true, url, kind: "search" };
  }
  // https://www.google.com/maps?cid=123  oppure  https://maps.google.com/?cid=123
  if (url.searchParams.has("cid") && (path === "/" || path === "/maps")) {
    return { ok: true, url, kind: "search" };
  }
  return { ok: false, code: "not_a_place" };
}

/**
 * Pulisce un URL di scheda: rimuove parametri di tracciamento, mantiene path e
 * parametri utili (cid, q, query_place_id).
 */
export function canonicalizePlaceUrl(url: URL): string {
  const keep = ["cid", "q", "query", "query_place_id", "hl"];
  const out = new URL(`https://www.google.com${url.pathname.startsWith("/maps") ? url.pathname : "/maps" + url.pathname}`);
  if (url.pathname === "/" || url.pathname === "") out.pathname = "/maps";
  for (const k of keep) {
    const v = url.searchParams.get(k);
    if (v) out.searchParams.set(k, v);
  }
  return out.toString();
}

export interface ResolveResult {
  ok: boolean;
  url?: string;
  code?: "invalid_url" | "not_google" | "not_a_place" | "resolve_failed";
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Risolve i link brevi (maps.app.goo.gl, g.page, share.google) seguendo i redirect
 * uno a uno, verificando ogni salto contro l'allowlist.
 */
export async function resolveGoogleUrl(
  input: string,
  fetcher: Fetcher = fetch,
  maxHops = 5,
): Promise<ResolveResult> {
  const first = checkGoogleUrl(input);
  if (!first.ok) return { ok: false, code: first.code };
  if (first.kind !== "short") return { ok: true, url: canonicalizePlaceUrl(first.url) };

  let current = first.url.toString();
  for (let hop = 0; hop < maxHops; hop++) {
    let res: Response;
    try {
      res = await fetcher(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; VoceClienti/1.0)" },
      });
    } catch {
      return { ok: false, code: "resolve_failed" };
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, code: "resolve_failed" };
      }
      if (!isAllowedHost(next.hostname)) return { ok: false, code: "not_google" };
      const check = checkGoogleUrl(next.toString());
      if (check.ok && check.kind !== "short") return { ok: true, url: canonicalizePlaceUrl(check.url) };
      // consent.google.com ecc.: il parametro "continue" contiene la destinazione reale
      const cont = next.searchParams.get("continue");
      if (cont) {
        const c = checkGoogleUrl(cont);
        if (c.ok && c.kind !== "short") return { ok: true, url: canonicalizePlaceUrl(c.url) };
      }
      current = next.toString();
      continue;
    }
    return { ok: false, code: "resolve_failed" };
  }
  return { ok: false, code: "resolve_failed" };
}
