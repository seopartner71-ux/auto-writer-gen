import { assert, assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { applyCommerceLayer, type CommerceCluster, type CommerceSilo, type ProductRow } from "./commercePages.ts";
import { computePageHashes } from "./bundleCache.ts";
import { createRenderGate, type RenderPlanView } from "./renderGate.ts";
import { executePlan, planRebuild } from "./publish.ts";
import { buildPostPage, type PostInput, type SiteChrome } from "./seoChrome.ts";

const ARTICLE_COUNT = 250;
const PRODUCT_COUNT = 250;
const SHARED_HASH = "acceptance-3d-shared";

const chrome: SiteChrome = {
  domain: "acceptance.example.com",
  siteName: "Приемочный каталог",
  siteAbout: "Каталог крепежа и экспертные материалы",
  topic: "крепеж",
  lang: "ru",
  accent: "#6E56CF",
  headingFont: "Inter",
  bodyFont: "Inter",
  projectId: "acceptance-3d",
};

const articles: Array<PostInput & { id: string }> = Array.from({ length: ARTICLE_COUNT }, (_, i) => ({
  id: `a-${i + 1}`,
  title: `Статья ${i + 1} о крепеже`,
  slug: `article-${i + 1}`,
  excerpt: `Практический материал номер ${i + 1}.`,
  contentHtml: `<h2>Раздел ${i + 1}</h2><p>${"Техническое описание. ".repeat(80)}</p>`,
  publishedAt: "2026-08-25T10:00:00.000Z",
}));

const silos: CommerceSilo[] = [
  { id: "s-1", name: "Крепеж", slug: "krepezh", description: "Каталог крепежа", position: 0 },
];
const clusters: CommerceCluster[] = [{
  id: "c-1", silo_id: "s-1", parent_id: null, name: "Болты", slug: "bolty",
  description: "Категория болтов", position: 0, page_type: "category",
}];
const products: ProductRow[] = Array.from({ length: PRODUCT_COUNT }, (_, i) => ({
  id: `p-${i + 1}`,
  silo_id: "s-1",
  site_cluster_id: "c-1",
  sku: `SKU-${i + 1}`,
  name: `Болт M${i + 1}`,
  slug: `bolt-m${i + 1}`,
  url_path: null,
  price: 100 + i,
  currency: "RUB",
  brand: "Acme",
  availability: "InStock",
  description: `Описание товара ${i + 1}. ${"Проверенные характеристики. ".repeat(30)}`,
  characteristics: { Диаметр: `M${i + 1}`, Материал: "Сталь", Покрытие: "Цинк" },
  images: null,
  kind: "product",
  status: "active",
  position: i,
})) as ProductRow[];

function renderSite(plan: RenderPlanView | null, cachedFiles?: Record<string, string>) {
  const gate = createRenderGate(plan, { cachedFiles });
  const files: Record<string, string> = {};
  for (const article of articles) {
    const key = `posts/${article.slug}.html`;
    const html = gate.renderPage(key, () => buildPostPage(chrome, article, []));
    if (html !== null) files[key] = html;
  }
  const commerce = applyCommerceLayer({
    chrome,
    files,
    silos,
    clusters,
    products,
    renderPage: (path, render) => gate.renderPage(path, render),
  });
  return { files: commerce.files, paths: commerce.pathByProductId, stats: gate.stats() };
}

Deno.test("3d acceptance: 500+ pages render only one changed article and product", () => {
  const fullStarted = performance.now();
  const full = renderSite(null);
  const fullDurationMs = performance.now() - fullStarted;
  const pageFiles = Object.keys(full.files).filter((path) => path.endsWith(".html"));
  assertEquals(pageFiles.length, ARTICLE_COUNT + PRODUCT_COUNT + 2);
  assertEquals(full.stats.render_invocations, ARTICLE_COUNT + PRODUCT_COUNT + 2);

  const productPath = full.paths.get("p-1");
  assert(productPath);
  const registryPages = [
    ...articles.map((article) => ({
      id: `r-${article.id}`, entity_type: "article", entity_id: article.id,
      url_path: `/posts/${article.slug}.html`,
    })),
    ...products.map((product) => ({
      id: `r-${product.id}`, entity_type: "product", entity_id: product.id,
      url_path: full.paths.get(product.id) || "",
    })),
    { id: "r-category", entity_type: "category", entity_id: "c-1", url_path: "/krepezh/bolty/" },
    { id: "r-catalog", entity_type: "system", entity_id: "catalog", url_path: "/catalog/" },
  ];
  const plan = planRebuild({
    queue: [
      { id: "q-article", entity_type: "article", entity_id: "a-1" },
      { id: "q-product", entity_type: "product", entity_id: "p-1" },
    ],
    cached: { page_hashes: computePageHashes(full.files), shared_hash: SHARED_HASH },
    currentSharedHash: SHARED_HASH,
    registryPages,
  });
  assertEquals(plan.mode, "incremental");
  assertEquals(plan.pages_to_rebuild, ["krepezh/bolty/bolt-m1", "posts/article-1"]);

  const incrementalStarted = performance.now();
  const incremental = renderSite(plan, full.files);
  const incrementalDurationMs = performance.now() - incrementalStarted;
  assertEquals(incremental.stats.planned_pages, 2);
  assertEquals(incremental.stats.render_invocations, 2);
  assertEquals(incremental.stats.rendered, 2);
  assertEquals(incremental.stats.skipped, 500);

  const productKey = productPath.replace(/^\//, "").replace(/\/$/, "/index.html");
  assertEquals(incremental.files["posts/article-1.html"], full.files["posts/article-1.html"]);
  assertEquals(incremental.files[productKey], full.files[productKey]);

  const merged = executePlan({ plan, rendered: incremental.files, cachedFiles: full.files });
  assertEquals(merged.files, full.files, "incremental snapshot must be byte-identical to full output");
  assert(incrementalDurationMs < fullDurationMs, "incremental render must be faster than full render");

  console.log(JSON.stringify({
    pages: pageFiles.length,
    changed_pages: 2,
    full_duration_ms: Number(fullDurationMs.toFixed(2)),
    incremental_duration_ms: Number(incrementalDurationMs.toFixed(2)),
    speedup: Number((fullDurationMs / incrementalDurationMs).toFixed(2)),
    render_invocations: incremental.stats.render_invocations,
  }));
});