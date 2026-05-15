import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const URL = `${SUPABASE_URL}/functions/v1/polish-article`;

Deno.test("polish-article: OPTIONS returns CORS preflight", async () => {
  const res = await fetch(URL, { method: "OPTIONS" });
  await res.text();
  assertEquals(res.status, 200);
  assert(res.headers.get("access-control-allow-origin"));
});

Deno.test("polish-article: short content is skipped, not rewritten", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ content: "слишком коротко" }),
  });
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.skipped, true);
  assertEquals(json.reason, "too_short");
});

Deno.test("polish-article: empty body is handled gracefully", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: "{}",
  });
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.skipped, true);
});

Deno.test("polish-article: oversized content is skipped", async () => {
  const big = "а".repeat(60001);
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ content: big }),
  });
  const json = await res.json();
  assertEquals(res.status, 200);
  assertEquals(json.skipped, true);
  assertEquals(json.reason, "too_long");
});