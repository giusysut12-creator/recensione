import "server-only";
import { headers } from "next/headers";
import { requesterHash } from "@/lib/auth";
import { env } from "@/lib/env";

export async function currentRequesterHash(): Promise<string> {
  const h = await headers();
  const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return requesterHash(env().APP_SESSION_SECRET, ip);
}
