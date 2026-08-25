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

// ── Part 3b: plan fixtures ──────────────────────────────────────────────────
const SHARED = "shared-hash-1";

function snapshot(paths: string[]) {
  const page_hashes: Record<string, string> = {};
  for (const p of paths) page_hashes[p] = `h-${p}`;
  return { page_hashes, shared_hash: SHARED };
}

function registry(n: number) {
  const pages = [{ entity_type: "site", entity_id: "home", url_path: "/" }];
  for (let i = 1; i <= n; i++) {
    pages.push({ entity_type: "article", entity_id: `a-${i}`, url_path: `/posts/post-${i}` });
  }
  return pages;
}

// ── Test 2: first deploy (no snapshot) ──────────────────────────────────────
Deno.test("first deploy without a snapshot plans a full rebuild and publishes unchanged", async () => {
  const plan = planRebuild({ queue: [], cached: null, currentSharedHash: SHARED });
  assertEquals(plan.mode, "full");
  assertEquals(plan.reason, "no previous bundle");
  assertEquals(plan.targets, {});
  assertEquals(plan.pages_to_rebuild, []);
  assertEquals(plan.globalArtifacts, GLOBAL_ARTIFACTS);

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

// ── Test 3: shared layer changed ────────────────────────────────────────────
Deno.test("changed shared_hash forces a full rebuild regardless of the queue", () => {
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-1" }],
    cached: snapshot(["index.html", "posts/post-1.html"]),
    currentSharedHash: "shared-hash-2",
    registryPages: registry(2),
  });
  assertEquals(plan.mode, "full");
  assertEquals(plan.reason, "shared layer changed");
});

// ── Test 4: incremental with 2 of 10 queued ─────────────────────────────────
Deno.test("incremental deploy re-renders only queued pages and reuses the cached bundle", () => {
  const paths = ["index.html", ...Array.from({ length: 9 }, (_, i) => `posts/post-${i + 1}.html`)];
  const plan = planRebuild({
    queue: [
      { id: "q1", entity_type: "article", entity_id: "a-1" },
      { id: "q2", entity_type: "article", entity_id: "a-1" },
      { id: "q3", entity_type: "article", entity_id: "a-4" },
    ],
    cached: snapshot(paths),
    currentSharedHash: SHARED,
    registryPages: registry(9),
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.reason, "bundle valid");
  assertEquals(plan.targets, { article: ["a-1", "a-4"] });
  assertEquals(plan.pages_to_rebuild, ["posts/post-1", "posts/post-4"]);
  assertEquals(plan.pages_from_cache.length, 8);
  assert(plan.pages_from_cache.every((p) => p.page_hash.startsWith("h-")));
  assertEquals(plan.pages_from_cache.find((p) => p.path === "")?.page_hash, "h-index.html");
  assertEquals(plan.consumedIds, ["q1", "q2", "q3"]);
});

// ── Test 5: empty queue with a valid bundle ─────────────────────────────────
// Nothing changed and the shared layer matches, so nothing needs rendering:
// every page is served from the snapshot. Global artefacts still regenerate.
Deno.test("valid bundle with an empty queue plans an incremental no-op", () => {
  const paths = ["index.html", "posts/post-1.html", "posts/post-2.html"];
  const plan = planRebuild({
    queue: [],
    cached: snapshot(paths),
    currentSharedHash: SHARED,
    registryPages: registry(2),
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, []);
  assertEquals(plan.pages_from_cache.length, 3);
});

// ── Test 6: new page outside the queue and outside the snapshot ─────────────
Deno.test("page missing from both queue and snapshot is rebuilt anyway", () => {
  const plan = planRebuild({
    queue: [],
    cached: snapshot(["index.html", "posts/post-1.html"]),
    currentSharedHash: SHARED,
    registryPages: [...registry(1), { entity_type: "product", entity_id: "p-9", url_path: "/catalog/bolt-m8" }],
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, ["catalog/bolt-m8"]);
  assertEquals(plan.pages_from_cache.length, 2);
});

Deno.test("structural queue entries force a full rebuild", () => {
  const cached = snapshot(["index.html"]);
  assertEquals(
    planRebuild({ queue: [{ id: "q1", entity_type: "silo", entity_id: "s-1" }], cached, currentSharedHash: SHARED, registryPages: registry(1) }).mode,
    "full",
  );
  assertEquals(
    planRebuild({ queue: [{ id: "q1", entity_type: "article", entity_id: null }], cached, currentSharedHash: SHARED, registryPages: registry(1) }).mode,
    "full",
  );
});

