import "server-only";
import { after } from "next/server";
import { advanceRun, isTerminal } from "./run";
import { INTERNAL_HEADER, internalToken } from "@/lib/auth";
import { env } from "@/lib/env";

/**
 * Fa avanzare il run dopo la risposta e, se c'è ancora lavoro, si richiama con una
 * nuova invocazione (ognuna con il proprio limite di durata). Così l'analisi
 * prosegue anche se l'utente chiude la pagina. Solo chi ha ottenuto il lock
 * prosegue la catena: niente catene duplicate.
 */
export function driveRun(runId: string, origin: string) {
  after(async () => {
    const { run, worked } = await advanceRun(runId);
    if (!worked || !run || isTerminal(run.status)) return;
    try {
      await fetch(new URL(`/api/analyses/${runId}/tick`, origin), {
        method: "POST",
        headers: { [INTERNAL_HEADER]: await internalToken(env().APP_SESSION_SECRET) },
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      console.error("[pipeline] chain failed; the page polling will resume it", err);
    }
  });
}
