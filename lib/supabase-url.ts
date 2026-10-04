/**
 * Riporta l'URL del progetto Supabase alla sola origine (https://<ref>.supabase.co).
 * Copiandolo dalla dashboard capita di includere "/rest/v1" o una "/" finale: supabase-js
 * aggiunge da sé i percorsi, e con un percorso in più Supabase risponde
 * "Invalid path specified in request URL".
 */
export function normalizeSupabaseUrl(raw: string): string {
  return new URL(raw.trim()).origin;
}
