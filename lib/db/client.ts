import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Client Supabase con service role: SOLO lato server. Le tabelle hanno RLS attiva
 * senza policy pubbliche, quindi la chiave anon non può leggere nulla.
 */
let client: SupabaseClient<any, string> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any

export function db(): SupabaseClient<any, string> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!client) {
    const e = env();
    client = createClient(e.SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: e.SUPABASE_SCHEMA },
    });
  }
  return client;
}

/** Lancia un errore se la query Supabase è fallita, altrimenti restituisce i dati. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`DB ${what}: ${res.error.message}`);
  return res.data as T;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
