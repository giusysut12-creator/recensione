"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkAccessCode, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export async function login(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const code = String(formData.get("code") ?? "").slice(0, 200);
  const next = String(formData.get("da") ?? "/");
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || !(await checkAccessCode(process.env.APP_ACCESS_CODE, code))) {
    await new Promise((r) => setTimeout(r, 600)); // rallenta i tentativi
    return { error: "Codice non corretto." };
  }
  const { token, maxAge } = await createSessionToken(secret);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
