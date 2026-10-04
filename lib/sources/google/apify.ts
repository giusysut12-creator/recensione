import "server-only";
import { ApifyClient } from "apify-client";
import { env } from "@/lib/env";
import { buildActorInput } from "./actor-input";

/**
 * Integrazione Apify per le recensioni Google.
 * L'utente non vede mai Apify: qui avviamo il run, ne controlliamo lo stato e
 * leggiamo il dataset a pagine.
 */

let client: ApifyClient | null = null;
function apify(): ApifyClient {
  if (!client) {
    const e = env();
    client = new ApifyClient({ token: e.APIFY_TOKEN, ...(e.APIFY_BASE_URL ? { baseUrl: e.APIFY_BASE_URL } : {}) });
  }
  return client;
}

export interface StartedRun {
  runId: string;
  datasetId: string;
}

export async function startGoogleReviewsRun(placeUrl: string, maxReviews: number, since?: string | null): Promise<StartedRun> {
  const e = env();
  let extra: Record<string, unknown> = {};
  if (e.APIFY_EXTRA_INPUT) {
    try {
      extra = JSON.parse(e.APIFY_EXTRA_INPUT);
    } catch {
      throw new Error("APIFY_EXTRA_INPUT non è JSON valido");
    }
  }
  const input = buildActorInput(placeUrl, maxReviews, { since, extra });
  const run = await apify()
    .actor(e.APIFY_GOOGLE_REVIEWS_ACTOR)
    .start(input, {
      timeout: 600, // secondi: oltre questo il run è considerato fallito
      maxItems: maxReviews + 5, // tetto di spesa se l'Actor è a pagamento per risultato
      maxTotalChargeUsd: e.APIFY_MAX_CHARGE_USD, // tetto di spesa se l'Actor è "pay per event" (caso attuale)
    });
  return { runId: run.id, datasetId: run.defaultDatasetId };
}

export type ApifyRunState = "running" | "succeeded" | "failed";

export async function getRunState(runId: string, waitSecs = 0): Promise<{ state: ApifyRunState; status: string }> {
  const run = await apify().run(runId).get(waitSecs > 0 ? { waitForFinish: Math.min(waitSecs, 60) } : undefined);
  if (!run) return { state: "failed", status: "NOT_FOUND" };
  const status = run.status;
  if (status === "SUCCEEDED") return { state: "succeeded", status };
  if (["FAILED", "ABORTED", "ABORTING", "TIMED-OUT", "TIMING-OUT"].includes(status)) return { state: "failed", status };
  return { state: "running", status };
}

export async function countDatasetItems(datasetId: string): Promise<number> {
  const ds = await apify().dataset(datasetId).get();
  return ds?.itemCount ?? 0;
}

export async function readDataset(datasetId: string, max: number): Promise<unknown[]> {
  const out: unknown[] = [];
  const pageSize = 500;
  let offset = 0;
  while (out.length < max) {
    const { items } = await apify()
      .dataset(datasetId)
      .listItems({ offset, limit: Math.min(pageSize, max - out.length), clean: true });
    if (items.length === 0) break;
    out.push(...items);
    offset += items.length;
    if (items.length < pageSize) break;
  }
  return out;
}

export async function abortRun(runId: string): Promise<void> {
  try {
    await apify().run(runId).abort();
  } catch {
    // ignorato: il run potrebbe essere già terminato
  }
}
