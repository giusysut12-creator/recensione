import { NextResponse, type NextRequest } from "next/server";
import { getRunStatus } from "@/lib/db/queries";
import { driveRun } from "@/lib/pipeline/drive";
import { isTerminal } from "@/lib/pipeline/run";

export const maxDuration = 300;

/**
 * Restituisce lo stato dell'analisi e, se non è terminata, programma il passo
 * successivo. Chiamata dalla pagina di elaborazione e dalla catena interna.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/analyses/[id]/tick">) {
  const { id } = await ctx.params;
  const status = await getRunStatus(id);
  if (!status) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!isTerminal(status.status)) driveRun(id, request.nextUrl.origin);
  return NextResponse.json(status);
}
