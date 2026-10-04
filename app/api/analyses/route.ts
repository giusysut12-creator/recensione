import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnalysis } from "@/lib/pipeline/run";
import { driveRun } from "@/lib/pipeline/drive";
import { PipelineError } from "@/lib/pipeline/errors";
import { currentRequesterHash } from "@/lib/request";

export const maxDuration = 300;

const Body = z.object({ url: z.string().min(1).max(2048) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_url" }, { status: 400 });

  try {
    const { id } = await createAnalysis(parsed.data.url, await currentRequesterHash());
    driveRun(id, new URL(request.url).origin);
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof PipelineError) {
      const status = err.code === "rate_limited" || err.code === "daily_limit" ? 429 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[api] create analysis failed", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
