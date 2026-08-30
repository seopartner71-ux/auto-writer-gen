// Part A: a product page must always show an image.
// The catalog import can deliver products without photos (project "Тест Метизы":
// 0 of 2957 rows had images/price/description). The renderer used to emit an
// empty <div class="cm-gallery"></div>; it now falls back to the same
// deterministic picsum placeholder the homepage uses.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyCommerceLayer, type CommerceCluster, type CommerceSilo, type ProductRow } from "./commercePages.ts";
import type { SiteChrome } from "./seoChrome.ts";

const chrome: SiteChrome = {
  domain: "media.example.com",
  siteName: "Тест Метизы",
  siteAbout: "Каталог крепежа",
  topic: "крепеж",
  lang: "ru",
  accent: "#6E56CF",
  headingFont: "Inter",
  bodyFont: "Inter",
  projectId: "media-test",
};

const silos: CommerceSilo[] = [
  { id: "s-1", name: "Крепеж", slug: "krepezh", description: "Каталог", position: 0 },
];
const clusters: CommerceCluster[] = [{
  id: "c-1", silo_id: "s-1", parent_id: null, name: "Болты", slug: "bolty",
  description: "Болты", position: 0, page_type: "category",
}];

function product(over: Partial<ProductRow>): ProductRow {
  return {
    id: "p-1", silo_id: "s-1", site_cluster_id: "c-1", sku: "SKU-1",
    name: "Болт анкерный", slug: "bolt-ankernyj", url_path: null,
    price: null, currency: "RUB", brand: null, availability: "in_stock",
    description: null, characteristics: null, images: null,
    kind: "product", status: "published", position: 0, ...over,
  };
}

function render(p: ProductRow): string {
  const res = applyCommerceLayer({
    chrome, files: {}, silos, clusters, products: [p],
  } as never);
  const path = res.pathByProductId.get(p.id)!;
  const key = path.replace(/^\//, "");
  return res.files[key];
}

function gallery(html: string): string {
  return (html.match(/<div class="cm-gallery">[\s\S]*?<\/div>/) || [""])[0];
}

Deno.test("Part A: product without photos still renders a placeholder image", () => {
  const html = render(product({}));
  const g = gallery(html);
  assert(g.includes("<img"), "cm-gallery must never be empty");
  assert(g.includes("picsum.photos"), "placeholder image expected");
  assert(html.includes("Цена по запросу"), "price fallback expected");
  // The placeholder must not leak into structured data.
  const ld = (html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []).join("");
  assertEquals(/picsum\.photos/.test(ld), false);
});

Deno.test("Part A: real price, photos and description are rendered", () => {
  const html = render(product({
    price: 149.5,
    images: ["https://cdn.example.com/bolt-1.jpg", "https://cdn.example.com/bolt-2.jpg"],
    description: "Анкерный болт для бетонных оснований.",
  }));
  const g = gallery(html);
  assert(g.includes("https://cdn.example.com/bolt-1.jpg"));
  assert(g.includes("https://cdn.example.com/bolt-2.jpg"));
  assertEquals(g.includes("picsum.photos"), false);
  assert(html.includes("Анкерный болт для бетонных оснований."));
  assertEquals(html.includes("Цена по запросу"), false);
});
