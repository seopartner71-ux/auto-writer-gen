// Fixture tests for the publish path (Part 2 of the deploy refactor).
// Run: deno test --allow-net supabase/functions/deploy-cloudflare-direct/publish_test.ts
//
// The Cloudflare API is stubbed through globalThis.fetch so the tests assert
// the CONTRACT of publishBundle: full manifest on every deployment, dedup via
// check-missing, no accidental page drops.

import { assertEquals, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildManifest, planRebuild, executePlan, publishBundle, GLOBAL_ARTIFACTS } from "./publish.ts";
import { computePageHash, computePageHashes } from "./bundleCache.ts";

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


// ════════════════════════════════════════════════════════════════════════════
// Part 3b.1 - queue coverage for articles / page_seo and silo classification
// ════════════════════════════════════════════════════════════════════════════

// ── Test 7: article edit produces a point rebuild, not an empty incremental ──
Deno.test("article queue row rebuilds exactly its registry page", () => {
  const paths = ["index.html", "posts/post-1.html", "posts/post-2.html"];
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-2", reason: "update" }],
    cached: snapshot(paths),
    currentSharedHash: SHARED,
    registryPages: registry(2),
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, ["posts/post-2"]);
  assertEquals(plan.pages_from_cache.length, 2);
});

// ── Test 8: page_seo edit maps through page_registry.id ─────────────────────
Deno.test("seo queue row resolves via page_registry id", () => {
  const paths = ["index.html", "catalog/bolt-m8.html"];
  const registryPages = [
    { id: "r-home", entity_type: "site", entity_id: "home", url_path: "/" },
    { id: "r-1", entity_type: "product", entity_id: "p-1", url_path: "/catalog/bolt-m8" },
  ];
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "seo", entity_id: "r-1", reason: "update" }],
    cached: snapshot(paths),
    currentSharedHash: SHARED,
    registryPages,
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, ["catalog/bolt-m8"]);
  assertEquals(plan.targets, { seo: ["r-1"] });
});

// ── Test 9: cosmetic silo edit stays incremental (Part B) ───────────────────
Deno.test("cosmetic silo change is a point rebuild of its hub page", () => {
  const paths = ["index.html", "hub/bolts.html", "posts/post-1.html"];
  const registryPages = [
    { id: "r-home", entity_type: "site", entity_id: "home", url_path: "/" },
    { id: "r-hub", entity_type: "hub", entity_id: "s-1", url_path: "/hub/bolts" },
    { id: "r-a1", entity_type: "article", entity_id: "a-1", url_path: "/posts/post-1" },
  ];
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "silo", entity_id: "s-1", reason: "cosmetic" }],
    cached: snapshot(paths),
    currentSharedHash: SHARED,
    registryPages,
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, ["hub/bolts"]);
  assertEquals(plan.pages_from_cache.length, 2);
});

// ── Test 10: structural silo edit still forces a full rebuild ───────────────
Deno.test("structural silo change still forces a full rebuild", () => {
  const registryPages = [
    { id: "r-home", entity_type: "site", entity_id: "home", url_path: "/" },
    { id: "r-hub", entity_type: "hub", entity_id: "s-1", url_path: "/hub/bolts" },
  ];
  for (const reason of ["structural", "insert", "delete", "update"]) {
    const plan = planRebuild({
      queue: [{ id: "q1", entity_type: "silo", entity_id: "s-1", reason }],
      cached: snapshot(["index.html", "hub/bolts.html"]),
      currentSharedHash: SHARED,
      registryPages,
    });
    assertEquals(plan.mode, "full", `reason=${reason}`);
    assertEquals(plan.reason, "structural change: silo");
  }
});


// ════════════════════════════════════════════════════════════════════════════
// Part 3c - executing the plan (cached pages vs freshly rendered ones)
// ════════════════════════════════════════════════════════════════════════════

/** A snapshot whose page hashes are the REAL ones, so executePlan can verify. */
function realSnapshot(files: Record<string, string>) {
  const page_hashes: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) page_hashes[p] = computePageHash(p, c);
  return { files, page_hashes, shared_hash: SHARED };
}

function markPages(files: Record<string, string>, marker: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) out[p] = /\.html?$/i.test(p) ? c.replace("</body>", `${marker}</body>`) : c;
  return out;
}

// ── Test 11: full mode is byte-identical to the fresh render (baseline) ─────
Deno.test("full plan ships the freshly rendered snapshot untouched", () => {
  const rendered = makeBundle(9);
  const cachedFiles = makeBundle(9); // a stale bundle must be ignored entirely
  cachedFiles["posts/post-1.html"] = "<html>STALE</html>";
  const plan = planRebuild({ queue: [], cached: null, currentSharedHash: SHARED });
  const exec = executePlan({ plan, rendered, cachedFiles });

  assertEquals(exec.mode, "full");
  assertEquals(exec.cached_pages, 0);
  assertEquals(exec.files, rendered);
  assertEquals(exec.incidents, []);
  assertEquals(exec.global_artifacts, GLOBAL_ARTIFACTS);
});

// ── Test 12: incremental ships 2 fresh pages and 8 verbatim cached ones ─────
Deno.test("incremental plan renders only queued pages and copies the rest byte-for-byte", () => {
  const previous = makeBundle(9);                 // index + 9 posts = 10 pages
  const snap = realSnapshot(previous);
  const rendered = markPages(previous, "<!--fresh-->"); // every page differs
  rendered["sitemap.xml"] = "<?xml version=\"1.0\"?><urlset><url>new</url></urlset>";
  rendered["robots.txt"] = "User-agent: *\nDisallow: /tmp\n";

  const plan = planRebuild({
    queue: [
      { id: "q1", entity_type: "article", entity_id: "a-1" },
      { id: "q2", entity_type: "article", entity_id: "a-4" },
    ],
    cached: { page_hashes: snap.page_hashes, shared_hash: snap.shared_hash },
    currentSharedHash: SHARED,
    registryPages: registry(9),
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild.length, 2);

  const exec = executePlan({ plan, rendered, cachedFiles: previous });
  assertEquals(exec.incidents, []);
  assertEquals(exec.cached_pages, 8);
  assertEquals(exec.rendered_pages, 2);

  // rebuilt pages carry the new bytes
  assertEquals(exec.files["posts/post-1.html"], rendered["posts/post-1.html"]);
  assertEquals(exec.files["posts/post-4.html"], rendered["posts/post-4.html"]);
  // untouched pages are byte-identical to the cached bundle
  for (const i of [2, 3, 5, 6, 7, 8, 9]) {
    assertEquals(exec.files[`posts/post-${i}.html`], previous[`posts/post-${i}.html`]);
  }
  assertEquals(exec.files["index.html"], previous["index.html"]);
  // global artefacts always come from this deploy
  assertEquals(exec.files["sitemap.xml"], rendered["sitemap.xml"]);
  assertEquals(exec.files["robots.txt"], rendered["robots.txt"]);
  // the page set itself never shrinks
  assertEquals(Object.keys(exec.files).sort(), Object.keys(rendered).sort());
});

// ── Test 13: page_hash desync falls back to rendering that one page ─────────
Deno.test("cached page whose hash does not match the bundle is re-rendered, not trusted", () => {
  const previous = makeBundle(4);
  const snap = realSnapshot(previous);
  const rendered = markPages(previous, "<!--fresh-->");

  // The bundle drifted after the hash was recorded (corrupt / partial write).
  const desyncedBundle = { ...previous, "posts/post-3.html": "<html>TAMPERED</html>" };

  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-1" }],
    cached: { page_hashes: snap.page_hashes, shared_hash: snap.shared_hash },
    currentSharedHash: SHARED,
    registryPages: registry(4),
  });
  const exec = executePlan({ plan, rendered, cachedFiles: desyncedBundle });

  assertEquals(exec.incidents.length, 1);
  assertEquals(exec.incidents[0].kind, "page_hash_desync");
  assertEquals(exec.incidents[0].path, "posts/post-3.html");
  // the desynced page ships freshly rendered, NOT the tampered cache bytes
  assertEquals(exec.files["posts/post-3.html"], rendered["posts/post-3.html"]);
  // its neighbours still come from cache
  assertEquals(exec.files["posts/post-2.html"], previous["posts/post-2.html"]);
  assertEquals(exec.cached_pages, 3);
});

// ── Test 14: a page listed in the plan but absent from the bundle ───────────
Deno.test("cached page missing from the bundle degrades to the fresh render", () => {
  const previous = makeBundle(3);
  const snap = realSnapshot(previous);
  const rendered = markPages(previous, "<!--fresh-->");
  const trimmed = { ...previous };
  delete trimmed["posts/post-2.html"];

  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-1" }],
    cached: { page_hashes: snap.page_hashes, shared_hash: snap.shared_hash },
    currentSharedHash: SHARED,
    registryPages: registry(3),
  });
  const exec = executePlan({ plan, rendered, cachedFiles: trimmed });

  assertEquals(exec.incidents.map((i) => i.kind), ["missing_in_bundle"]);
  assertEquals(exec.files["posts/post-2.html"], rendered["posts/post-2.html"]);
});

// ── Test 15: the shipped snapshot is what gets published and re-cached ──────
Deno.test("publishBundle ships the executed snapshot, which is what saveBundle must persist", async () => {
  const previous = makeBundle(5);
  const snap = realSnapshot(previous);
  const rendered = markPages(previous, "<!--fresh-->");
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-2" }],
    cached: { page_hashes: snap.page_hashes, shared_hash: snap.shared_hash },
    currentSharedHash: SHARED,
    registryPages: registry(5),
  });
  const exec = executePlan({ plan, rendered, cachedFiles: previous });

  const { calls, restore } = stubCloudflare();
  try {
    const res = await publishBundle({ files: exec.files, ...BASE });
    assert(res.ok, res.error);
    // Cloudflare still receives the COMPLETE manifest on an incremental deploy.
    assertEquals(
      Object.keys(calls.manifests[0]).sort(),
      Object.keys(rendered).map((k) => `/${k}`).sort(),
    );
    // Next cycle's cache must describe exactly what shipped.
    const nextHashes = computePageHashes(exec.files);
    assertEquals(nextHashes["posts/post-2.html"], computePageHash("posts/post-2.html", rendered["posts/post-2.html"]));
    assertEquals(nextHashes["posts/post-3.html"], snap.page_hashes["posts/post-3.html"]);
  } finally {
    restore();
  }
});

// ── Test 16: release writer contract (single row, last_release_id set) ──────
Deno.test("recordRelease writes one row, flips is_current and stores last_release_id", async () => {
  const ops: string[] = [];
  const state = { version: "v1.0.3" as string | null };
  const sb = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: q.inserted ?? { version: state.version } }),
        update(patch: Record<string, unknown>) {
          ops.push(`${table}.update:${Object.keys(patch).join(",")}=${Object.values(patch).join(",")}`);
          return chain;
        },
        insert(row: Record<string, unknown>) {
          ops.push(`${table}.insert:${row.version}:${row.is_current}`);
          q.inserted = { ...row, id: "rel-1" };
          return chain;
        },
      };
      return chain;
    },
  };
  const { recordRelease } = await import("../_shared/siteRelease.ts");
  const rel = await recordRelease(sb as never, {
    projectId: "p-1", userId: "u-1", provider: "cloudflare",
    url: "https://x.pages.dev", pages: 10, buildHash: "bh-1",
  });
  assertEquals((rel as { id?: string } | null)?.id, "rel-1");
  // exactly one insert, one is_current flip, one last_release_id write
  assertEquals(ops.filter((o) => o.startsWith("site_releases.insert")).length, 1);
  assertEquals(ops.filter((o) => o === "site_releases.update:is_current=false").length, 1);
  assertEquals(ops.filter((o) => o === "projects.update:last_release_id=rel-1").length, 1);
  assertEquals(ops.filter((o) => o.startsWith("site_releases.insert:v1.0.4")).length, 1);
});
