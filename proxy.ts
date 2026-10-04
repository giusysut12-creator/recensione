import { NextResponse, type NextRequest } from "next/server";
import { INTERNAL_HEADER, internalToken, SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** Area riservata: senza sessione valida si viene mandati alla pagina di accesso. */
export async function proxy(request: NextRequest) {
  const ok = await verifySessionToken(process.env.APP_SESSION_SECRET, request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();

  // Chiamate interne della pipeline (solo la route di avanzamento)
  const internal = request.headers.get(INTERNAL_HEADER);
  const secret = process.env.APP_SESSION_SECRET;
  if (internal && secret && /^\/api\/analyses\/[^/]+\/tick$/.test(request.nextUrl.pathname)) {
    if (internal === (await internalToken(secret))) return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/accesso", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("da", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!accesso|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
