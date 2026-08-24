// Fixture tests for the publish path (Part 2 of the deploy refactor).
// Run: deno test --allow-net supabase/functions/deploy-cloudflare-direct/publish_test.ts
//
// The Cloudflare API is stubbed through globalThis.fetch so the tests assert
// the CONTRACT of publishBundle: full manifest on every deployment, dedup via
// check-missing, no accidental page drops.

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildManifest, planRebuild, publishBundle, GLOBAL_ARTIFACTS } from "./publish.ts";

function makeBundle(pages: number): Record<string, string> {
  const files: Record<string, string> = {
    "index.html": "<!doctype html><html><head><title>Home</title></head><body>home</body></html>",
    "style.css": "body{margin:0}",
    "robots.txt": "User-agent: *\nAllow: /\n",
    "sitemap.xml": "<?xml version=\"1.0\"?><urlset></urlset>",
  };
  for (let i = 1; i <= pages; i++) {
    files[`posts/post-${i}.html`] = `<!doctype html><html><head><title>Post ${i}</title></head><body>p${i}</body></html>`;
  }
  return files;
}

interface StubCalls {
  checkMissing: string[][];
  uploaded: string[][];
  manifests: Record<string, string>[];
}

function stubCloudflare(opts: { alreadyOnEdge?: Set<string> } = {}): { calls: StubCalls; restore: () => void } {
  const realFetch = globalThis.fetch;
  const calls: StubCalls = { checkMissing: [], uploaded: [], manifests: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

    if (url.endsWith("/upload-token")) return json({ result: { jwt: "test-jwt" } });

    if (url.endsWith("/assets/check-missing")) {
      const hashes: string[] = JSON.parse(String(init?.body ?? "{}")).hashes;
      calls.checkMissing.push(hashes);
      const missing = hashes.filter((h) => !opts.alreadyOnEdge?.has(h));
      return json({ result: missing });
    }

    if (url.endsWith("/assets/upload")) {
      const payload: Array<{ key: string }> = JSON.parse(String(init?.body ?? "[]"));
      calls.uploaded.push(payload.map((p) => p.key));
      return json({ result: null });
    }

    if (url.endsWith("/assets/upsert-hashes")) return json({ result: null });

    if (url.endsWith("/deployments")) {
      const fd = init?.body as FormData;
      calls.manifests.push(JSON.parse(String(fd.get("manifest"))));
      return json({ result: { id: "dep-1", url: "https://test.pages.dev" } });
    }

    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;

  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const BASE = {
  cfBaseUrl: "https://api.cloudflare.com/client/v4/accounts/acc/pages/projects",
  cfProjectName: "test-site",
  cfHeadersJson: { Authorization: "Bearer t", "Content-Type": "application/json" },
  apiToken: "t",
};

// ── Test 1: full rebuild ────────────────────────────────────────────────────
Deno.test("full rebuild ships every file and the complete manifest", async () => {
  const files = makeBundle(12);
  const { calls, restore } = stubCloudflare();
  try {
    const res = await publishBundle({ files, ...BASE });
    assert(res.ok, res.error);
    assertEquals(res.total, Object.keys(files).length);
    assertEquals(res.uploaded, Object.keys(files).length);

    const manifest = calls.manifests[0];
    // Manifest URLs mirror the bundle 1:1 - a missing key deletes the page.
    assertEquals(
      Object.keys(manifest).sort(),
      Object.keys(files).map((k) => `/${k}`).sort(),
    );
    assert(Object.values(manifest).every((h) => /^[0-9a-f]{32}$/.test(h)));
    assertEquals(res.deployId, "dep-1");
  } finally {
    restore();
  }
});

// ── Test 2: empty queue ─────────────────────────────────────────────────────
Deno.test("empty deploy queue plans a full rebuild and publishes unchanged", async () => {
  const plan = planRebuild([]);
  assertEquals(plan.mode, "full");
  assertEquals(plan.targets, {});
  assertEquals(plan.consumedIds, []);
  assertEquals(plan.globalArtifacts, GLOBAL_ARTIFACTS);

  // Nothing changed on the edge: every hash is already uploaded, so the deploy
  // must still succeed and still send the full manifest, uploading nothing.
  const files = makeBundle(5);
  const { manifest } = buildManifest(files);
  const onEdge = new Set(Object.values(manifest));
  const { calls, restore } = stubCloudflare({ alreadyOnEdge: onEdge });
  try {
    const res = await publishBundle({ files, ...BASE });
    assert(res.ok, res.error);
    assertEquals(res.uploaded, 0);
    assertEquals(calls.uploaded.length, 0);
    assertEquals(Object.keys(calls.manifests[0]).length, Object.keys(files).length);
  } finally {
    restore();
  }
});

// ── Test 3: single changed branch (incremental) ─────────────────────────────
Deno.test("queued article plans an incremental rebuild of that entity only", () => {
  const plan = planRebuild([
    { id: "q1", entity_type: "article", entity_id: "a-1", reason: "updated" },
    { id: "q2", entity_type: "article", entity_id: "a-1", reason: "updated" },
  ]);
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.targets, { article: ["a-1"] });
  assertEquals(plan.consumedIds, ["q1", "q2"]);
  // Global artefacts depend on the full page list, never on the diff.
  assertEquals(plan.globalArtifacts, GLOBAL_ARTIFACTS);
});

Deno.test("structural queue entries force a full rebuild", () => {
  assertEquals(planRebuild([{ id: "q1", entity_type: "silo", entity_id: "s-1" }]).mode, "full");
  assertEquals(planRebuild([{ id: "q1", entity_type: "article", entity_id: null }]).mode, "full");
});

// Pending: wired in Part 3b once the renderer can reuse a cached previous
// bundle. Until then there is no source for the unchanged pages.
Deno.test({
  name: "incremental deploy re-renders only queued pages and reuses the cached bundle",
  ignore: true,
  fn: () => {},
});
