import { describe, expect, it } from "vitest";
import { normalizeSupabaseUrl } from "../lib/supabase-url";

describe("normalizeSupabaseUrl", () => {
  it("toglie percorsi e barra finale copiati dalla dashboard", () => {
    expect(normalizeSupabaseUrl("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(normalizeSupabaseUrl("https://abc.supabase.co/")).toBe("https://abc.supabase.co");
    expect(normalizeSupabaseUrl(" https://abc.supabase.co ")).toBe("https://abc.supabase.co");
  });

  it("mantiene host e porta locali", () => {
    expect(normalizeSupabaseUrl("http://127.0.0.1:4010")).toBe("http://127.0.0.1:4010");
  });
});
