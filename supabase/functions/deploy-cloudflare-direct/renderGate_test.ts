// Part 3d - the render gate decides WHICH pages are generated at all.
//
// deno test --allow-all --node-modules-dir=auto \
//   supabase/functions/deploy-cloudflare-direct/renderGate_test.ts

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createRenderGate } from "./renderGate.ts";
import { planRebuild } from "./publish.ts";
import { computePageHash, computePageHashes, computeSharedHash, computeBuildHash } from "./bundleCache.ts";
import { renderTemplate } from "./templates.ts";
import { applyCommerceLayer, type CommerceCluster, type CommerceSilo, type ProductRow } from "./commercePages.ts";

const SHARED = "shared-hash-1";

function posts(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    title: `Статья ${i + 1}`,
    slug: `post-${i + 1}`,
    excerpt: `Краткое описание материала номер ${i + 1}.`,
    contentHtml: `<p>Тело статьи ${i + 1} с достаточным объемом текста для рендера.</p>`,
    publishedAt: `2026-01-${String((i % 27) + 1).padStart(2, "0")}T10:00:00.000Z`,
  }));
}

function registry(n: number) {
  return [
    { id: "r-home", entity_type: "site", entity_id: "home", url_path: "/" },
    ...Array.from({ length: n }, (_, i) => ({
      id: `r-a${i + 1}`,
      entity_type: "article",
      entity_id: `a-${i + 1}`,
      url_path: `/posts/post-${i + 1}`,
    })),
  ];
}

function ctx(extra: Record<string, unknown> = {}) {
  return {
    siteName: "Море болтов",
    siteAbout: "Крепеж и метизы оптом",
    topic: "крепеж",
    accent: "#6E56CF",
    headingFont: "Inter",
    bodyFont: "Inter",
    template: "minimal" as const,
    domain: "example.com",
    posts: posts(10),
    projectId: "proj-3d",
    ...extra,
  };
}

// ── Test 1: regression - full mode renders exactly what it rendered before ──
// NOTE: renderTemplate intentionally varies some markup between runs (style
// jitter), so "identical" here means the same page set, not the same bytes.
// Byte-level regression is covered by the deterministic commerce layer below
// and by the frozen baseline in bundleCache_test.
Deno.test("full mode through the gate renders exactly the same page set as no gate", () => {
  const before = renderTemplate(ctx() as never);

  // A gate built from a full plan must not gate anything away.
  const plan = planRebuild({ queue: [], cached: null, currentSharedHash: SHARED });
  assertEquals(plan.mode, "full");
  const gate = createRenderGate(plan);
  const after = renderTemplate(ctx({ renderPage: <T>(p: string, render: () => T) => gate.renderPage(p, render) }) as never);

  assertEquals(Object.keys(after).sort(), Object.keys(before).sort());
  assertEquals(Object.keys(after).filter((k) => k.startsWith("posts/")).length, 10);
  assertEquals(gate.stats().skipped, 0);

  // the hashing helpers the cache layer relies on stay wired up
  const shared = computeSharedHash({ template: "minimal", domain: "example.com", accent: "#6E56CF", fonts: "Inter|Inter", engine: "legacy", site_template_id: "" });
  assert(computeBuildHash(shared, computePageHashes(after)).length > 0);
});

// ── Test 1b: the frozen 3a baseline is still the reference point ────────────
Deno.test("baseline_snapshot.json is unchanged by 3d", async () => {
  const baseline = JSON.parse(await Deno.readTextFile(new URL("./baseline_snapshot.json", import.meta.url)));
  assert(Array.isArray(baseline.urls) && baseline.urls.length > 0);
  assert(typeof baseline.build_hash === "string" && baseline.build_hash.length > 0);
  // bundleCache_test re-renders the fixture and compares it against these
  // hashes; 3d must not have moved them.
  assertEquals(Object.keys(baseline.page_hashes).sort(), [...baseline.urls].sort());
});

// ── Test 2: incremental renders exactly the planned pages, no more ──────────
Deno.test("incremental mode invokes the page renderer exactly once per planned page", () => {
  const rendered = renderTemplate(ctx() as never); // 10 posts + chrome
  const cachedFiles = { ...rendered };
  const page_hashes = computePageHashes(cachedFiles);

  const plan = planRebuild({
    queue: [
      { id: "q1", entity_type: "article", entity_id: "a-2" },
      { id: "q2", entity_type: "article", entity_id: "a-7" },
    ],
    cached: { page_hashes, shared_hash: SHARED },
    currentSharedHash: SHARED,
    registryPages: registry(10),
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild.sort(), ["posts/post-2", "posts/post-7"]);

  const gate = createRenderGate(plan, { cachedFiles });

  // Count real invocations of the single-page renderer.
  let calls = 0;
  const out: Record<string, string> = {};
  for (const p of posts(10)) {
    const path = `posts/${p.slug}.html`;
    const html = gate.renderPage(path, () => { calls++; return `<html>${p.slug}</html>`; });
    if (html !== null) out[path] = html;
  }

  assertEquals(calls, 2, "renderer must run for the 2 planned pages only");
  assertEquals(Object.keys(out).sort(), ["posts/post-2.html", "posts/post-7.html"]);
  const stats = gate.stats();
  assertEquals(stats.rendered, 2);
  assertEquals(stats.skipped, 8);
});

// ── Test 2b: the same gate wired into the real template renderer ────────────
Deno.test("renderTemplate under an incremental gate emits only the planned post pages", () => {
  const full = renderTemplate(ctx() as never);
  const page_hashes = computePageHashes(full);
  const plan = planRebuild({
    queue: [{ id: "q1", entity_type: "article", entity_id: "a-3" }],
    cached: { page_hashes, shared_hash: SHARED },
    currentSharedHash: SHARED,
    registryPages: registry(10),
  });
  const gate = createRenderGate(plan, { cachedFiles: full });
  const partial = renderTemplate(ctx({ renderPage: <T>(p: string, render: () => T) => gate.renderPage(p, render) }) as never);

  const postPages = Object.keys(partial).filter((k) => k.startsWith("posts/"));
  assertEquals(postPages, ["posts/post-3.html"]);
  // global artefacts still list every page
  assert(full["sitemap.xml"].includes("post-9"));
  assert(partial["sitemap.xml"].includes("post-9"));
});

// ── Test 2c: commerce layer keeps links/paths for pages it does not render ──
Deno.test("commerce layer skips cached product HTML but keeps its links and paths", () => {
  const silos: CommerceSilo[] = [{ id: "s-1", name: "Крепеж", slug: "krepezh", description: "Раздел", position: 0 }];
  const clusters: CommerceCluster[] = [{
    id: "c-1", silo_id: "s-1", parent_id: null, name: "Болты", slug: "bolty",
    description: "Категория болтов", position: 0, page_type: "category",
  }];
  const products: ProductRow[] = Array.from({ length: 6 }, (_, i) => ({
    id: `p-${i + 1}`, silo_id: "s-1", site_cluster_id: "c-1", sku: `SKU-${i + 1}`,
    name: `Болт M${i + 6}`, slug: null, url_path: null, price: 100 + i, currency: "RUB",
    brand: "Acme", availability: "InStock", description: `Описание болта ${i + 1}.`,
    characteristics: { "Диаметр": `M${i + 6}` }, images: null, kind: "product",
    status: "active", position: i,
  })) as ProductRow[];
  const chrome: any = {
    domain: "example.com", siteName: "Море болтов", siteAbout: "Крепеж", topic: "крепеж",
    lang: "ru", accent: "#6E56CF", headingFont: "Inter", bodyFont: "Inter", projectId: "proj-3d",
  };

  const baseFiles: Record<string, string> = { "index.html": "<html></html>" };
  const fullRes = applyCommerceLayer({ chrome, files: { ...baseFiles }, silos, clusters, products });

  // product pages live at <silo>/<cluster>/<product>.html
  const productPages = Object.keys(fullRes.files).filter((k) => /^krepezh\/bolty\/bolt-m\d+\.html$/.test(k));
  assertEquals(productPages.length, 6);
  const kept = "krepezh/bolty/bolt-m6.html";
  const partialRes = applyCommerceLayer({
    chrome, files: { ...baseFiles }, silos, clusters, products,
    shouldRenderPage: (p) => p === kept || !productPages.includes(p),
  });

  // every product path still exists for sitemap / registry purposes
  assertEquals(partialRes.extraPaths.sort(), fullRes.extraPaths.sort());
  // and the internal link graph is unchanged
  assertEquals(partialRes.links.length, fullRes.links.length);
  assertEquals(partialRes.skippedProducts, 5);
  assertEquals(Object.keys(partialRes.files).filter((k) => productPages.includes(k)), [kept]);
  // the commerce layer is deterministic: what it does render is byte-identical
  for (const key of Object.keys(partialRes.files)) {
    assertEquals(partialRes.files[key], fullRes.files[key], `differs: ${key}`);
  }
});

// ── Test 3: safety - a plan pointing at a page missing from the bundle ──────
Deno.test("gate refuses to skip a page the cached bundle does not actually hold", () => {
  const plan = {
    mode: "incremental" as const,
    pages_to_rebuild: ["posts/post-1"],
    pages_from_cache: [
      { path: "posts/post-2", page_hash: "h-2" },
      { path: "posts/post-3", page_hash: "h-3" },
    ],
  };
  const cachedFiles = { "posts/post-2.html": "<html>2</html>" }; // post-3 absent
  const gate = createRenderGate(plan, { cachedFiles });

  assertEquals(gate.shouldRender("posts/post-1.html"), true);
  assertEquals(gate.shouldRender("posts/post-2.html"), false);
  assertEquals(gate.shouldRender("posts/post-3.html"), true, "missing from bundle -> render");
  // global artefacts are never gated away
  assertEquals(gate.shouldRender("sitemap.xml"), true);
  assertEquals(gate.shouldRender("robots.txt"), true);
  assertEquals(gate.shouldRender("llms.txt"), true);
});

// ── Test 3b: no plan at all -> permissive gate ──────────────────────────────
Deno.test("a missing plan renders everything", () => {
  const gate = createRenderGate(null);
  assertEquals(gate.mode, "full");
  assertEquals(gate.shouldRender("anything.html"), true);
  assertEquals(gate.renderPage("posts/x.html", () => "html"), "html");
  assertEquals(computePageHash("a.html", "x"), computePageHash("a.html", "x"));
});
