import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
const URL = `${SUPABASE_URL}/functions/v1/quality-check`;

Deno.test("quality-check: OPTIONS preflight returns CORS", async () => {
  const res = await fetch(URL, { method: "OPTIONS" });
  await res.text();
  assertEquals(res.status, 200);
  assert(res.headers.get("access-control-allow-origin"));
});

Deno.test("quality-check: missing Authorization returns 401", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ article_id: "x", content: "y" }),
  });
  const json = await res.json();
  assertEquals(res.status, 401);
  assertEquals(json.error, "Unauthorized");
});

Deno.test("quality-check: missing article_id returns 400", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ content: "some text long enough" }),
  });
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "article_id required");
});

Deno.test("quality-check: missing content returns 400", async () => {
  const res = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ article_id: "00000000-0000-0000-0000-000000000000" }),
  });
  const json = await res.json();
  assertEquals(res.status, 400);
  assertEquals(json.error, "content required");
});