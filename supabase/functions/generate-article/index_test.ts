import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const URL = `${SUPABASE_URL}/functions/v1/generate-article`;

Deno.test("generate-article: OPTIONS preflight returns CORS", async () => {
  const res = await fetch(URL, { method: "OPTIONS" });
  await res.text();
  assertEquals(res.status, 200);
  assert(res.headers.get("access-control-allow-headers"));
});

Deno.test("generate-article: no Authorization rejects request", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ keyword_id: "x" }),
  });
  const txt = await res.text();
  // Function throws "Unauthorized" without auth header (returns non-2xx)
  assert(res.status >= 400, `expected error status, got ${res.status}: ${txt}`);
});

Deno.test("generate-article: anon JWT without valid user is rejected", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ keyword_id: "00000000-0000-0000-0000-000000000000" }),
  });
  const txt = await res.text();
  // anon key has no user; supabase.auth.getUser() returns no user → Unauthorized
  assert(res.status >= 400, `expected error status, got ${res.status}: ${txt}`);
});