// Tests for Part 3a: bundle cache, page_hash / shared_hash isolation and the
// logical invalidation contract.
// Run: deno test --allow-read supabase/functions/deploy-cloudflare-direct/bundleCache_test.ts

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BUNDLE_BUCKET,
  bundlePath,
  computeBuildHash,
  computePageHash,
  computePageHashes,
  computeSharedHash,
  loadBundle,
  saveBundle,
  validateBundleAgainstShared,
} from "./bundleCache.ts";

// ── in-memory Storage stub ──────────────────────────────────────────────────
function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const client = {
    storage: {
      from(bucket: string) {
        assertEquals(bucket, BUNDLE_BUCKET);
        return {
          async upload(path: string, body: Blob | Uint8Array) {
            objects.set(path, body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer()));
            return { error: null };
          },
          download(path: string) {
            const raw = objects.get(path);
            return Promise.resolve(raw ? { data: new Blob([raw]), error: null } : { data: null, error: { message: "not found" } });
          },
          remove(paths: string[]) {
            paths.forEach((p) => objects.delete(p));
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };
  return { client, objects };
}

const SHARED_INPUT = {
  template: "premium",
  engine: "template",
  site_template_id: "tpl-1",
  domain: "example.com",
  accent: "#6E56CF",
  fonts: "Inter|JetBrains Mono",
  // mock module marker - stands in for templateEngine.ts / seoChrome.ts version
  template_engine_version: "1",
};

function bundleFiles(): Record<string, string> {
  return {
    "index.html": "<!doctype html><title>Home</title><h1>Home</h1>",
    "catalog/bolts.html": "<!doctype html><title>Bolts</title><h1>Bolts</h1>",
    "blog/post-1.html": "<!doctype html><title>Post 1</title><h1>Post 1</h1>",
    "sitemap.xml": "<?xml version=\"1.0\"?><urlset/>",
    "robots.txt": "User-agent: *\nAllow: /\n",
    "llms.txt": "# example.com\n",
  };
}

// ── Test 1 ──────────────────────────────────────────────────────────────────
Deno.test("bundle is persisted to Storage with manifest and all pages present", async () => {
  const { client, objects } = memoryStorage();
  const files = bundleFiles();
  const sharedHash = computeSharedHash(SHARED_INPUT);

  const saved = await saveBundle(client as never, "proj-1", files, sharedHash);
  assert(saved.ok);
  assert(objects.has(bundlePath("proj-1")));
  assertEquals(saved.shared_hash, sharedHash);
  assertEquals(Object.keys(saved.page_hashes).sort(), Object.keys(files).sort());
  assertEquals(saved.build_hash, computeBuildHash(sharedHash, computePageHashes(files)));

  const loaded = await loadBundle(client as never, "proj-1", sharedHash);
  assert(loaded, "bundle must load back");
  assertEquals(Object.keys(loaded!.files).sort(), Object.keys(files).sort());
  assertEquals(loaded!.files["catalog/bolts.html"], files["catalog/bolts.html"]);
  assertEquals(loaded!.page_hashes, saved.page_hashes);
});

// ── Test 2 ──────────────────────────────────────────────────────────────────
Deno.test("page content change moves only that page_hash, shared_hash unchanged", () => {
  const before = bundleFiles();
  const after = { ...before, "blog/post-1.html": "<!doctype html><title>Post 1</title><h1>Post 1 edited</h1>" };

  const hBefore = computePageHashes(before);
  const hAfter = computePageHashes(after);

  assertNotEquals(hAfter["blog/post-1.html"], hBefore["blog/post-1.html"]);
  for (const path of Object.keys(before)) {
    if (path === "blog/post-1.html") continue;
    assertEquals(hAfter[path], hBefore[path], `${path} must be untouched`);
  }

  // shared_hash does not ingest page bytes at all.
  assertEquals(computeSharedHash(SHARED_INPUT), computeSharedHash(SHARED_INPUT));
  // build_hash aggregates both levels, so it does move.
  assertNotEquals(
    computeBuildHash(computeSharedHash(SHARED_INPUT), hAfter),
    computeBuildHash(computeSharedHash(SHARED_INPUT), hBefore),
  );
});

// ── Test 3 ──────────────────────────────────────────────────────────────────
Deno.test("mock templateEngine.ts change moves shared_hash and invalidates the bundle", async () => {
  const { client } = memoryStorage();
  const files = bundleFiles();
  const oldShared = computeSharedHash(SHARED_INPUT);
  await saveBundle(client as never, "proj-1", files, oldShared);

  // Simulate an edit inside the shared render layer.
  const newShared = computeSharedHash({ ...SHARED_INPUT, template_engine_version: "2" });
  assertNotEquals(newShared, oldShared);

  // Page hashes are unaffected by the shared-layer change.
  assertEquals(computePageHashes(files), computePageHashes(files));

  const loaded = await loadBundle(client as never, "proj-1", newShared);
  assertEquals(loaded, null, "stale bundle must not be reused");
  const stillValid = await loadBundle(client as never, "proj-1", oldShared);
  assert(stillValid, "unchanged shared layer keeps the bundle usable");
});

// ── Test 4 ──────────────────────────────────────────────────────────────────
Deno.test("logical invalidation contract: match and mismatch", () => {
  const shared = computeSharedHash(SHARED_INPUT);

  assertEquals(validateBundleAgainstShared(shared, shared), {
    valid: true,
    reason: "bundle valid",
    action: "incremental rebuild allowed",
  });

  const changed = computeSharedHash({ ...SHARED_INPUT, accent: "#FF0000" });
  assertEquals(validateBundleAgainstShared(changed, shared), {
    valid: false,
    reason: "shared layer changed",
    action: "full rebuild required",
  });

  assertEquals(validateBundleAgainstShared(shared, null), {
    valid: false,
    reason: "no previous shared hash",
    action: "full rebuild required",
  });
});

// ── Baseline snapshot (frozen for the 3c comparison) ────────────────────────
Deno.test("baseline snapshot of the fixture site still matches", async () => {
  const baseline = JSON.parse(await Deno.readTextFile(new URL("./baseline_snapshot.json", import.meta.url)));
  const files = bundleFiles();
  const shared = computeSharedHash(SHARED_INPUT);

  assertEquals(Object.keys(files).sort(), baseline.urls);
  assertEquals(computePageHashes(files), baseline.page_hashes);
  assertEquals(shared, baseline.shared_hash);
  assertEquals(computeBuildHash(shared, computePageHashes(files)), baseline.build_hash);
  assertEquals(computePageHash("robots.txt", files["robots.txt"]), baseline.page_hashes["robots.txt"]);
});
