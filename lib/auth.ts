/**
 * Accesso riservato V1: codice di accesso condiviso + cookie di sessione firmato
 * (HMAC-SHA256). Usa Web Crypto per funzionare sia in proxy che nelle route.
 */
export const SESSION_COOKIE = "vc_session";
const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Buffer.from(sig).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(secret: string): Promise<{ token: string; maxAge: number }> {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const exp = Math.floor(Date.now() / 1000) + maxAge;
  const payload = `v1.${exp}`;
  return { token: `${payload}.${await hmac(secret, payload)}`, maxAge };
}

export async function verifySessionToken(secret: string | undefined, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return false;
  return safeEqual(parts[2], await hmac(secret, `${parts[0]}.${parts[1]}`));
}

export async function checkAccessCode(expected: string | undefined, provided: string): Promise<boolean> {
  if (!expected) return false;
  // Confronto a tempo costante sugli hash
  const [a, b] = await Promise.all([hmac("access", expected), hmac("access", provided)]);
  return safeEqual(a, b);
}

/** Hash del client per il rate limiting: nessun IP salvato in chiaro. */
export async function requesterHash(secret: string, ip: string): Promise<string> {
  return (await hmac(secret, `ip:${ip}`)).slice(0, 32);
}

/** Token per le chiamate interne (auto-avanzamento della pipeline). */
export const INTERNAL_HEADER = "x-internal-token";
export async function internalToken(secret: string): Promise<string> {
  return hmac(secret, "internal-pipeline-v1");
}
