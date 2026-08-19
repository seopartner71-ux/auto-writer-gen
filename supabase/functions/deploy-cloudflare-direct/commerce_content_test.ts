// Commerce Content Engine fixture (isolated, no DB, no network).
// deno test supabase/functions/deploy-cloudflare-direct/commerce_content_test.ts
//
// 3 silos / 5 categories / 20 products / 2 services / 10 articles / 120 keywords.

import { applyCommerceLayer, type CommerceSilo, type CommerceCluster, type ProductRow } from "./commercePages.ts";
import { auditBundle } from "../_shared/siteAudit.ts";
import { getSiloUrl, getClusterUrl } from "../_shared/siloUrl.ts";
import {
  buildKeywordCoverage, buildFallbackContent, buildContentFacts,
  type TargetEntity, type PageKind,
} from "../_shared/commerceContent.ts";

Deno.test("Commerce Content Engine: semantics -> content -> render -> QA", () => {
  const DOMAIN = "example.ru";
  const SITE = "Фикстура";
  const silosDef = [["oborudovanie", "Оборудование"], ["uslugi", "Услуги"], ["zapchasti", "Запчасти"]];
  const clustersDef: [string, string, string][] = [
    ["nasosy", "Насосы", "oborudovanie"], ["filtry", "Фильтры", "oborudovanie"],
    ["montazh", "Монтаж", "uslugi"], ["servis", "Сервис", "uslugi"], ["klapany", "Клапаны", "zapchasti"],
  ];
  const silos: CommerceSilo[] = silosDef.map(([slug, name], i) =>
    ({ id: `s-${slug}`, name, slug, description: `Раздел ${name}`, position: i }));
  const clusters: CommerceCluster[] = clustersDef.map(([slug, name, silo], i) =>
    ({ id: `c-${slug}`, silo_id: `s-${silo}`, parent_id: null, name, slug, description: `Категория ${name}`, position: i, page_type: "category" }));

  const products: ProductRow[] = [];
  for (let i = 1; i <= 20; i++) {
    const c = clusters[i % 5];
    products.push({
      id: `p-${i}`, silo_id: c.silo_id, site_cluster_id: c.id, sku: `SKU-${i}`,
      name: `${c.name.slice(0, -1)} ${i % 2 ? "Acme" : "Nordis"} DN${20 + i}`, slug: null, url_path: null,
      price: 1000 + i * 10, currency: "RUB", brand: i % 2 ? "Acme" : "Nordis", availability: "InStock",
      description: `Описание позиции ${i} категории ${c.name}: применение, монтаж и обслуживание.`,
      characteristics: { "Мощность": `${i} кВт`, "Диаметр": `${20 + i} мм` },
      images: [`https://cdn.example.com/img${i}.jpg`], kind: "product", status: "active", position: i,
    });
  }
  for (let i = 1; i <= 2; i++) {
    const c = clusters[2 + i - 1];
    products.push({
      id: `sv-${i}`, silo_id: c.silo_id, site_cluster_id: c.id, sku: null,
      name: `${c.name} оборудования ${i === 1 ? "под ключ" : "по регламенту"}`, slug: null, url_path: null,
      price: 5000 * i, currency: "RUB", brand: null, availability: null,
      description: `Услуга ${i}: работы под ключ, выезд специалиста, гарантия на результат.`,
      characteristics: null, images: null, kind: "service", status: "active", position: 100 + i,
    });
  }

  // ---- 1. SEMANTICS: 120 keywords -> targets --------------------------------
  const keywords: { id: string; keyword: string; frequency: number; intent: string }[] = [];
  let kn = 0;
  const push = (k: string, intent: string) =>
    keywords.push({ id: `k-${++kn}`, keyword: k, frequency: 100 - kn, intent });
  for (const s of silos) { push(s.name.toLowerCase(), "commercial"); push(`${s.name.toLowerCase()} каталог`, "commercial"); }
  for (const c of clusters) {
    push(c.name.toLowerCase(), "commercial");
    push(`${c.name.toLowerCase()} купить`, "transactional");
    push(`${c.name.toLowerCase()} цена`, "transactional");
    push(`${c.name.toLowerCase()} подбор`, "commercial");
  }
  for (const p of products) {
    push(p.name.toLowerCase(), "transactional");
    push(`${p.name.toLowerCase()} купить`, "transactional");
    push(`${p.name.toLowerCase()} характеристики`, "commercial");
  }
  for (let i = 1; i <= 24; i++) push(`как выбрать оборудование вариант ${i}`, "informational");

  const entities: TargetEntity[] = [
    ...silos.map((s) => ({ id: s.id, kind: "hub" as PageKind, name: s.name, text: s.description || "", silo_id: s.id })),
    ...clusters.map((c) => ({ id: c.id, kind: "category" as PageKind, name: c.name, text: c.description || "", silo_id: c.silo_id, cluster_id: c.id })),
    ...products.map((p) => ({
      id: p.id, kind: (p.kind === "service" ? "service" : "product") as PageKind, name: p.name,
      text: [p.brand, p.sku, p.description].filter(Boolean).join(" "),
      silo_id: p.silo_id, cluster_id: p.site_cluster_id,
    })),
  ];
  const coverage = buildKeywordCoverage(keywords, entities);
  const kwOf = (id: string) => {
    const arr = coverage.byTarget.get(id) || [];
    return {
      primaryKeywords: arr.filter((a) => a.role === "primary").map((a) => a.keyword),
      secondaryKeywords: arr.filter((a) => a.role !== "primary").map((a) => a.keyword),
    };
  };

  // ---- 2. CONTENT GENERATION (deterministic engine path) --------------------
  for (const s of silos) {
    (s as unknown as { seo_content: unknown }).seo_content = buildFallbackContent({
      kind: "hub", name: s.name, siteName: SITE, lang: "ru", description: s.description,
      childNames: clusters.filter((c) => c.silo_id === s.id).map((c) => c.name), ...kwOf(s.id),
    });
  }
  for (const c of clusters) {
    (c as unknown as { seo_content: unknown }).seo_content = buildFallbackContent({
      kind: "category", name: c.name, siteName: SITE, lang: "ru", description: c.description,
      siloName: silos.find((s) => s.id === c.silo_id)!.name,
      childNames: products.filter((p) => p.site_cluster_id === c.id).map((p) => p.name), ...kwOf(c.id),
    });
  }
  for (const p of products) {
    const c = clusters.find((x) => x.id === p.site_cluster_id)!;
    (p as unknown as { seo_content: unknown }).seo_content = buildFallbackContent({
      kind: p.kind === "service" ? "service" : "product", name: p.name, siteName: SITE, lang: "ru",
      brand: p.brand, sku: p.sku, price: `${p.price} RUB`, availability: p.availability,
      description: p.description, characteristics: p.characteristics as Record<string, unknown>,
      categoryName: c.name, siloName: silos.find((s) => s.id === c.silo_id)!.name, ...kwOf(p.id),
    });
  }

  // ---- 3. RENDER -------------------------------------------------------------
  const chrome = {
    domain: DOMAIN, siteName: SITE, siteAbout: "Каталог оборудования, услуг и запчастей",
    topic: "оборудование", lang: "ru", accent: "#6E56CF", headingFont: "Inter", bodyFont: "Inter",
    projectId: "fixture",
  } as unknown as Parameters<typeof applyCommerceLayer>[0]["chrome"];

  const files: Record<string, string> = {};
  const head = (title: string, desc: string, path: string, extra = "") =>
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="https://${DOMAIN}${path}">${extra}</head>`;
  const nav = `<nav><a href="/">Главная</a><a href="/catalog/">Каталог</a><a href="/blog/">Блог</a></nav>`;
  files["index.html"] = `${head(`${SITE} - оборудование и услуги`, "Каталог оборудования, услуги монтажа и запчасти.", "/")}<body>${nav}<h1>${SITE}</h1><a href="/blog/">Блог</a><a href="/catalog/">Каталог</a>${silos.map((s) => `<a href="${getSiloUrl({ slug: s.slug })}">${s.name}</a>`).join("")}</body></html>`;

  const articlePaths: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const c = clusters[i % 5];
    const siloSlug = silos.find((s) => s.id === c.silo_id)!.slug;
    const cPath = getClusterUrl({ slug: c.slug, siloSlug });
    const path = `${cPath}statya-${i}.html`;
    articlePaths.push(path);
    files[path.slice(1)] = `${head(`Статья ${i} про ${c.name}`, `Практический разбор темы ${c.name}, выпуск ${i}.`, path,
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Статья ${i}"}</script>`)}<body>${nav}<h1>Статья ${i} про ${c.name}</h1><p>Текст.</p><a href="${cPath}">В категорию</a><a href="/blog/">Все статьи</a><img src="/i.jpg" alt="Иллюстрация к статье ${i}"></body></html>`;
  }
  files["blog/index.html"] = `${head(`Блог - ${SITE}`, "Материалы об оборудовании, монтаже и запчастях.", "/blog/")}<body>${nav}<h1>Блог</h1>${articlePaths.map((p, i) => `<a href="${p}">Статья ${i + 1}</a>`).join("")}</body></html>`;
  for (const s of silos) {
    const path = getSiloUrl({ slug: s.slug });
    const sc = (s as unknown as { seo_content: { h1: string; seo_title: string; seo_description: string; intro: string } }).seo_content;
    const kids = clusters.filter((c) => c.silo_id === s.id);
    files[`${path.slice(1)}index.html`] = `${head(sc.seo_title, sc.seo_description, path)}<body>${nav}<h1>${sc.h1}</h1><p>${sc.intro}</p>${kids.map((c) => `<a href="${getClusterUrl({ slug: c.slug, siloSlug: s.slug })}">${c.name}</a>`).join("")}</body></html>`;
  }
  for (const [f, tt] of [["about.html", "О компании"], ["contacts.html", "Контакты"], ["privacy.html", "Политика конфиденциальности"], ["terms.html", "Условия использования"]]) {
    files[f] = `${head(`${tt} - ${SITE}`, `${tt}: сведения о компании и правилах работы сервиса.`, `/${f}`)}<body>${nav}<h1>${tt}</h1><p>Текст страницы.</p></body></html>`;
  }
  files["robots.txt"] = `User-agent: *\nAllow: /\nSitemap: https://${DOMAIN}/sitemap.xml\n`;

  const res = applyCommerceLayer({
    chrome, files, silos, clusters, products,
    business: { phone: "+7 900 000-00-00", address: "Москва", city: "Москва", workHours: "9-18" },
  });

  const allPaths = new Set<string>([
    "/", "/blog/", ...articlePaths,
    ...silos.map((s) => getSiloUrl({ slug: s.slug })),
    ...res.extraPaths, "/about.html", "/contacts.html", "/privacy.html", "/terms.html",
  ]);
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...allPaths].map((p) => `  <url><loc>https://${DOMAIN}${p}</loc></url>`).join("\n")}\n</urlset>`;

  // ---- 4. QA -----------------------------------------------------------------
  const report = auditBundle(files, DOMAIN, {
    silos: silos.map((s) => ({ id: s.id, name: s.name, status: "active" })),
    clusters: clusters.map((c) => ({ id: c.id, silo_id: c.silo_id, name: c.name, status: "active" })),
    products: products.map((p) => ({ id: p.id, name: p.name, site_cluster_id: p.site_cluster_id, silo_id: p.silo_id })),
    content: buildContentFacts({
      silos: silos as unknown as { id: string; name: string; seo_content?: unknown }[],
      clusters: clusters as unknown as { id: string; name: string; seo_content?: unknown }[],
      products: products.map((p) => ({ id: p.id, name: p.name, kind: p.kind, url_path: res.pathByProductId.get(p.id), seo_content: (p as unknown as { seo_content: unknown }).seo_content })),
    }),
    keywords: coverage.assignments.map((a) => ({ keyword: a.keyword, target_type: a.target_type, target_id: a.target_id })),
  });

  const productPages = [...res.pathByProductId.values()];
  const withFaq = productPages.filter((p) => (files[p.replace(/^\//, "")] || "").includes("cm-faq")).length;
  const withFaqLd = productPages.filter((p) => (files[p.replace(/^\//, "")] || "").includes("FAQPage")).length;

  console.log("=== COMMERCE CONTENT FIXTURE ===");
  console.log(JSON.stringify({
    files: Object.keys(files).length,
    products: res.products, categories: res.categories, internal_links: res.links.length,
    coverage: {
      total: coverage.total, covered: coverage.covered, uncovered: coverage.uncovered,
      conflict: coverage.conflict, duplicate_intent: coverage.duplicate_intent,
      assigned: coverage.assignments.filter((a) => a.target_id).length,
    },
    targets_by_kind: coverage.assignments.reduce((a: Record<string, number>, x) => {
      const k = x.target_type || "none"; a[k] = (a[k] || 0) + 1; return a;
    }, {}),
    pages_with_faq_html: withFaq, pages_with_faq_schema: withFaqLd,
    qa: { score: report.score, critical: report.critical, warnings: report.warnings, counts: report.counts },
    sample_issues: report.issues.slice(0, 8),
  }, null, 1));

  const orphanProducts = products.filter((p) => !p.site_cluster_id).length;
  if (orphanProducts) throw new Error("orphan products present");
  if (res.products !== 22 || res.categories !== 5) throw new Error("unexpected commerce counts");
  const assigned = coverage.assignments.filter((a) => a.target_id).length;
  if (assigned < 80) throw new Error(`low keyword coverage: ${assigned}/${coverage.total}`);
  if (report.critical !== 0) throw new Error("QA critical issues: " + JSON.stringify(report.counts));
});