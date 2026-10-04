/**
 * Genera un unico script SQL che installa tutte le migrazioni in uno schema dedicato,
 * per usare un progetto Supabase già esistente senza toccare le sue tabelle.
 *
 *   node scripts/schema-sql.mjs vdc > vdc.sql        → prima installazione (tutte le migrazioni)
 *   node scripts/schema-sql.mjs vdc 0003 > vdc.sql   → solo le migrazioni dalla 0003 in poi
 *
 * Da incollare nel SQL Editor di Supabase. Tutto gira in una transazione: se qualcosa fallisce
 * non viene salvato nulla. Tocca solo lo schema indicato, mai "public".
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const schema = process.argv[2] ?? "vdc";
const from = process.argv[3] ?? "";
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || schema === "public") {
  console.error("Uso: node scripts/schema-sql.mjs <schema>  (minuscole, cifre, _; non 'public')");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql") && f >= from).sort();

const out = [
  `-- Voce dei Clienti: installazione nello schema "${schema}" (generato da scripts/schema-sql.mjs)`,
  `-- Dopo l'esecuzione: Project Settings → Data API → Exposed schemas → aggiungi "${schema}".`,
  `begin;`,
  ...(from ? [] : [`create schema if not exists ${schema};`]),
  `set local search_path = ${schema}, extensions;`,
  ``,
];
for (const f of files) {
  out.push(`-- ===== ${f} =====`);
  // Le estensioni su Supabase vivono nello schema "extensions": non le ricreiamo qui.
  // Le funzioni con search_path fisso su public devono puntare allo schema dedicato.
  out.push(
    readFileSync(join(dir, f), "utf8")
      .replace(/^create extension .*$/gim, "-- $&")
      .replace(/^set search_path = public$/gim, `set search_path = ${schema}`),
  );
  out.push("");
}
out.push(
  `-- Accesso: solo service_role (codice server). anon/authenticated restano senza permessi.`,
  `grant usage on schema ${schema} to service_role;`,
  `grant all on all tables in schema ${schema} to service_role;`,
  `grant all on all sequences in schema ${schema} to service_role;`,
  `alter default privileges in schema ${schema} grant all on tables to service_role;`,
  `alter default privileges in schema ${schema} grant all on sequences to service_role;`,
  `commit;`,
  `notify pgrst, 'reload schema';`,
);
process.stdout.write(out.join("\n") + "\n");
