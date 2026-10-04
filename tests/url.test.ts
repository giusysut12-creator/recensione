import { describe, expect, it } from "vitest";
import { checkGoogleUrl, resolveGoogleUrl } from "@/lib/sources/google/url";

describe("checkGoogleUrl", () => {
  it("accetta URL di scheda Google Maps", () => {
    const r = checkGoogleUrl("https://www.google.com/maps/place/Pizzeria+Da+Mario/@45.46,9.18,17z/data=!3m1");
    expect(r.ok && r.kind).toBe("place");
  });
  it("accetta domini nazionali e link senza protocollo", () => {
    expect(checkGoogleUrl("www.google.it/maps/place/Bar+Roma").ok).toBe(true);
    expect(checkGoogleUrl("https://maps.google.co.uk/maps/place/X").ok).toBe(true);
  });
  it("riconosce i link brevi", () => {
    const r = checkGoogleUrl("https://maps.app.goo.gl/AbCdEf123");
    expect(r.ok && r.kind).toBe("short");
    expect(checkGoogleUrl("https://share.google/xyz").ok).toBe(true);
  });
  it("accetta link con cid", () => {
    const r = checkGoogleUrl("https://maps.google.com/?cid=1234567890");
    expect(r.ok && r.kind).toBe("search");
  });
  it("rifiuta domini non Google e URL malformati", () => {
    expect(checkGoogleUrl("https://evil.com/maps/place/x")).toEqual({ ok: false, code: "not_google" });
    expect(checkGoogleUrl("https://google.com.evil.com/maps/place/x")).toEqual({ ok: false, code: "not_google" });
    expect(checkGoogleUrl("javascript:alert(1)").ok).toBe(false);
    expect(checkGoogleUrl("")).toEqual({ ok: false, code: "invalid_url" });
    expect(checkGoogleUrl("https://user:pass@www.google.com/maps/place/x").ok).toBe(false);
  });
  it("rifiuta pagine Google che non sono una scheda", () => {
    expect(checkGoogleUrl("https://www.google.com/search?q=pizza")).toEqual({ ok: false, code: "not_a_place" });
    expect(checkGoogleUrl("https://goo.gl/abc")).toEqual({ ok: false, code: "not_a_place" });
  });
});

describe("resolveGoogleUrl", () => {
  const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

  it("segue i redirect dei link brevi fino alla scheda", async () => {
    const hops = [redirect("https://www.google.com/maps/place/Bar+Roma/@1,2,3z?entry=ttu&g_st=ic")];
    const r = await resolveGoogleUrl("https://maps.app.goo.gl/abc", async () => hops.shift()!);
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://www.google.com/maps/place/Bar+Roma/@1,2,3z");
  });
  it("blocca redirect verso host non Google (SSRF)", async () => {
    const r = await resolveGoogleUrl("https://maps.app.goo.gl/abc", async () => redirect("http://169.254.169.254/latest"));
    expect(r).toEqual({ ok: false, code: "not_google" });
  });
  it("gestisce la pagina di consenso usando il parametro continue", async () => {
    const r = await resolveGoogleUrl("https://maps.app.goo.gl/abc", async () =>
      redirect("https://consent.google.com/m?continue=https://www.google.com/maps/place/Bar%2BRoma&gl=IT"),
    );
    expect(r.ok).toBe(true);
    expect(r.url).toContain("/maps/place/Bar");
  });
  it("si ferma dopo troppi redirect", async () => {
    const r = await resolveGoogleUrl("https://maps.app.goo.gl/abc", async () => redirect("https://maps.app.goo.gl/loop"));
    expect(r).toEqual({ ok: false, code: "resolve_failed" });
  });
});
