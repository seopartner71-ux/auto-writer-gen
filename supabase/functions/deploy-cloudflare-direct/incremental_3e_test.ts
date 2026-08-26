// Part 3e - regression tests for the four bugs the 3d live run exposed.
//
//  bug 1: sitemap/robots/llms were built from the fresh render only, so an
//         incremental deploy published a 2-URL sitemap for a 512-page site.
//  bug 2: page_registry paths use `slugifyPath` (_shared/siloUrl.ts) while the
//         renderer used a second, different transliteration table, so planned
//         pages were silently served from cache instead of being re-rendered.
//  bug 3: the QA gate audited the pre-merge state and saw every cached page as
//         missing from the bundle.
//  bug 4: no explicit force_full switch.

import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildCachedOverlay, planRebuild, type RebuildPlan } from "./publish.ts";
import { createRenderGate } from "./renderGate.ts";
import { slugifyPath } from "../_shared/siloUrl.ts";

function page(path: string, body: string) {
  return `<!doctype html><html><head><title>${path}</title></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------- bug 1 / 3

Deno.test("bug 1: global artefacts see the FULL page set, not just the render", () => {
  const total = 512;
  const cachedFiles: Record<string, string> = { "index.html": page("home", "home") };
  for (let i = 0; i < total; i++) cachedFiles[`posts/post-${i}.html`] = page(`p${i}`, "old");

  const plan: RebuildPlan = {
    mode: "incremental",
    reason: "shared layer unchanged",
    pages_to_rebuild: ["posts/post-7"],
    pages_from_cache: Object.keys(cachedFiles)
      .map((p) => ({ path: p, page_hash: "h" }))
      .filter((e) => e.path !== "posts/post-7.html"),
    targets: {},
    consumedIds: [],
    globalArtifacts: ["sitemap.xml", "robots.txt", "llms.txt"],
  };

  // What the render pass actually produced: one page + global artefacts.
  const rendered: Record<string, string> = {
    "posts/post-7.html": page("p7", "new"),
    "sitemap.xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "robots.txt": "User-agent: *\nAllow: /",
  };

  const overlay = buildCachedOverlay({ plan, rendered, cachedFiles });
  const view = { ...overlay, ...rendered };
  const htmlPages = Object.keys(view).filter((p) => p.endsWith(".html"));

  assertEquals(htmlPages.length, total + 1, "sitemap must be built from all 513 pages");
  assertEquals(view["posts/post-7.html"], rendered["posts/post-7.html"], "fresh render wins over cache");
  assert(!overlay["posts/post-7.html"], "a rebuilt page is never taken from the overlay");
  assert(!overlay["sitemap.xml"], "global artefacts never come from the overlay");
});

Deno.test("bug 3: the merged view removes phantom missing-page findings", () => {
  const cachedFiles = {
    "index.html": page("home", "home"),
    "catalog/bolt.html": page("bolt", "old"),
    "catalog/nut.html": page("nut", "old"),
  };
  const plan: RebuildPlan = {
    mode: "incremental",
    reason: "ok",
    pages_to_rebuild: ["catalog/bolt"],
    pages_from_cache: [
      { path: "index.html", page_hash: "h" },
      { path: "catalog/nut.html", page_hash: "h" },
    ],
    targets: {},
    consumedIds: [],
    globalArtifacts: [],
  };
  const rendered = { "catalog/bolt.html": page("bolt", "new") };
  const view = { ...buildCachedOverlay({ plan, rendered, cachedFiles }), ...rendered };

  // The QA gate resolves every registry page against this view.
  for (const registryPath of ["/", "/catalog/bolt", "/catalog/nut"]) {
    const key = registryPath === "/" ? "index.html" : `${registryPath.replace(/^\//, "")}.html`;
    assert(view[key] !== undefined, `registry page ${registryPath} must be present in the audited bundle`);
  }
});

Deno.test("full mode keeps the overlay empty", () => {
  const overlay = buildCachedOverlay({
    plan: { ...(planRebuild({ forceFull: true })) },
    rendered: { "index.html": page("home", "x") },
    cachedFiles: { "index.html": page("home", "old") },
  });
  assertEquals(Object.keys(overlay).length, 0);
});

// -------------------------------------------------------------------- bug 2

Deno.test("bug 2: one transliteration source - registry paths equal render paths", () => {
  // The exact letters where the two tables disagreed: ц, х, й, ё.
  const cases: Array<[string, string]> = [
    ["Оптимизация процессов", "optimizaciya-processov"],
    ["Хороший цех", "horoshiy-ceh"],
    ["Ёлка и йогурт", "elka-i-yogurt"],
  ];
  for (const [title, expected] of cases) {
    assertEquals(slugifyPath(title), expected);
    assert(!slugifyPath(title).includes("ts"), "old renderer table (ц->ts) must be gone");
    assert(!slugifyPath(title).includes("kh"), "old renderer table (х->kh) must be gone");
  }
});

Deno.test("bug 2: a queued article on a transliterated path is really re-rendered", () => {
  const articleTitle = "Оптимизация процессов на производстве";
  const productTitle = "Цельный крюк";
  const articlePath = `posts/${slugifyPath(articleTitle)}.html`;
  const productPath = `catalog/${slugifyPath(productTitle)}.html`;

  // Bundle from the previous deploy - written by the same slug source.
  const cachedFiles: Record<string, string> = {
    "index.html": page("home", "home"),
    [articlePath]: page("article", "old"),
    [productPath]: page("product", "old"),
  };
  for (let i = 0; i < 20; i++) cachedFiles[`posts/filler-${i}.html`] = page("f", "old");

  const registryPages = Object.keys(cachedFiles).map((p, i) => ({
    id: `reg-${i}`,
    entity_type: p.startsWith("catalog/") ? "product" : p === "index.html" ? "home" : "article",
    entity_id: `ent-${i}`,
    url_path: `/${p.replace(/index\.html$/, "").replace(/\.html$/, "")}`,
  }));
  const articleEntity = registryPages.find((r) => r.url_path === `/${articlePath.replace(".html", "")}`)!;
  const productEntity = registryPages.find((r) => r.url_path === `/${productPath.replace(".html", "")}`)!;

  const plan = planRebuild({
    queue: [
      { id: "q1", entity_type: "article", entity_id: articleEntity.entity_id },
      { id: "q2", entity_type: "product", entity_id: productEntity.entity_id },
    ],
    cached: { page_hashes: Object.fromEntries(Object.keys(cachedFiles).map((p) => [p, "h"])), shared_hash: "s" },
    currentSharedHash: "s",
    registryPages,
  });

  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild.length, 2, "only the two queued pages are planned");

  // The gate must invoke the renderer exactly for the planned pages.
  const gate = createRenderGate(plan, { cachedFiles });
  const emitted: string[] = [];
  for (const path of Object.keys(cachedFiles)) {
    gate.renderPage(path, () => emitted.push(path));
  }
  const stats = gate.stats();
  assertEquals(stats.render_invocations, stats.planned_pages, "planned == rendered, no silent skips");
  assertEquals(emitted.sort(), [productPath, articlePath].sort());
});

// -------------------------------------------------------------------- bug 4

Deno.test("bug 4: force_full forces a full rebuild without touching shared data", () => {
  const cached = { page_hashes: { "index.html": "h" }, shared_hash: "s" };
  const incremental = planRebuild({ cached, currentSharedHash: "s", registryPages: [{ url_path: "/" }] });
  assertEquals(incremental.mode, "incremental");

  const forced = planRebuild({ cached, currentSharedHash: "s", registryPages: [{ url_path: "/" }], forceFull: true });
  assertEquals(forced.mode, "full");
  assertEquals(forced.reason, "force full rebuild");
  assertEquals(forced.pages_from_cache.length, 0);
});
