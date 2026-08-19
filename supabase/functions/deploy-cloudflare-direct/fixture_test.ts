import { applyCommerceLayer, type CommerceSilo, type CommerceCluster, type ProductRow } from "./commercePages.ts";
import { auditBundle } from "../_shared/siteAudit.ts";
import { getSiloUrl, getClusterUrl, slugifyPath } from "../_shared/siloUrl.ts";

Deno.test("P7 commercial fixture: 3 silos / 5 clusters / 22 items / 10 articles passes QA", () => {
  // P7.16 isolated fixture (deno test: `deno test supabase/functions/deploy-cloudflare-direct/fixture_test.ts`): 3 silos / 5 clusters / 20 products / 2 services / 10 articles.

  const DOMAIN = "example.ru";
  const silosDef = [["oborudovanie","Оборудование"],["uslugi","Услуги"],["zapchasti","Запчасти"]];
  const clustersDef: [string,string,string][] = [
    ["nasosy","Насосы","oborudovanie"],["filtry","Фильтры","oborudovanie"],
    ["montazh","Монтаж","uslugi"],["servis","Сервис","uslugi"],["klapany","Клапаны","zapchasti"],
  ];
  const silos: CommerceSilo[] = silosDef.map(([slug,name],i)=>({id:`s-${slug}`,name,slug,description:`Раздел ${name}`,position:i}));
  const clusters: CommerceCluster[] = clustersDef.map(([slug,name,silo],i)=>({id:`c-${slug}`,silo_id:`s-${silo}`,parent_id:null,name,slug,description:`Категория ${name}`,position:i,page_type:"category"}));
  const products: ProductRow[] = [];
  for (let i=1;i<=20;i++){
    const c = clusters[i%5];
    products.push({id:`p-${i}`,silo_id:c.silo_id,site_cluster_id:c.id,sku:`SKU-${i}`,name:`Товар ${c.name} ${i}`,slug:null,url_path:null,
      price:1000+i*10,currency:"RUB",brand:"Acme",availability:"InStock",description:`Описание товара ${i} для категории ${c.name}. Технические детали и применение.`,
      characteristics:{"Мощность":`${i} кВт`},images:[`https://cdn.example.com/img${i}.jpg`],kind:"product",status:"active",position:i});
  }
  for (let i=1;i<=2;i++){
    const c = clusters[2+i-1];
    products.push({id:`sv-${i}`,silo_id:c.silo_id,site_cluster_id:c.id,sku:null,name:`Услуга ${c.name} ${i}`,slug:null,url_path:null,
      price:5000*i,currency:"RUB",brand:null,availability:null,description:`Описание услуги ${i}: работы под ключ, гарантия, выезд.`,
      characteristics:null,images:null,kind:"service",status:"active",position:100+i});
  }

  const chrome: any = { domain: DOMAIN, siteName:"Fixture", siteAbout:"Тестовый сайт фабрики", topic:"оборудование", lang:"ru",
    accent:"#6E56CF", headingFont:"Inter", bodyFont:"Inter", projectId:"fixture" };

  // base bundle: home + blog + 10 articles (silo scheme)
  const files: Record<string,string> = {};
  const head = (title:string,desc:string,path:string,extra="") =>
    `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="https://${DOMAIN}${path}">${extra}</head>`;
  const navLinks = `<nav><a href="/">Главная</a><a href="/catalog/">Каталог</a><a href="/blog/">Блог</a></nav>`;
  files["index.html"] = `${head("Fixture - оборудование и услуги","Каталог оборудования, услуги монтажа и запчасти.","/")}<body>${navLinks}<h1>Fixture</h1><a href="/blog/">Блог</a><a href="/catalog/">Каталог</a>${silos.map(s=>`<a href="${getSiloUrl({slug:s.slug})}">${s.name}</a>`).join("")}</body></html>`;
  const articlePaths: string[] = [];
  for (let i=1;i<=10;i++){
    const c = clusters[i%5];
    const p = `${getClusterUrl({slug:c.slug,siloSlug:silos.find(s=>s.id===c.silo_id)!.slug})}statya-${i}.html`;
    articlePaths.push(p);
    files[p.slice(1)] = `${head(`Статья ${i} про ${c.name}`,`Экспертный разбор темы ${c.name}, выпуск ${i}.`,p,
      `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Статья ${i}"}</script>`)}<body>${navLinks}<h1>Статья ${i} про ${c.name}</h1><p>Текст.</p><a href="${getClusterUrl({slug:c.slug,siloSlug:silos.find(s=>s.id===c.silo_id)!.slug})}">В категорию</a><a href="/blog/">Все статьи</a><img src="/i.jpg" alt="Иллюстрация к статье ${i}"></body></html>`;
  }
  files["blog/index.html"] = `${head("Блог - Fixture","Материалы об оборудовании, монтаже и запчастях.","/blog/")}<body>${navLinks}<h1>Блог</h1>${articlePaths.map((p,i)=>`<a href="${p}">Статья ${i+1}</a>`).join("")}</body></html>`;
  for (const s of silos) {
    const path = getSiloUrl({slug:s.slug});
    const kids = clusters.filter(c=>c.silo_id===s.id);
    files[path.slice(1)+"index.html"] = `${head(`${s.name} - Fixture`,`Раздел ${s.name}: категории, товары и услуги.`,path)}<body>${navLinks}<h1>${s.name}</h1>${kids.map(c=>`<a href="${getClusterUrl({slug:c.slug,siloSlug:s.slug})}">${c.name}</a>`).join("")}</body></html>`;
  }
  for (const c of clusters) {
    const s = silos.find(x=>x.id===c.silo_id)!;
    const path = getClusterUrl({slug:c.slug,siloSlug:s.slug});
    files[path.slice(1)+"index.html"] = `${head(`${c.name} - ${s.name}`,`Категория ${c.name}: подобранные позиции с ценами.`,path)}<body>${navLinks}<h1>${c.name}</h1><a href="${getSiloUrl({slug:s.slug})}">${s.name}</a></body></html>`;
  }
  for (const [f,tt] of [["about.html","О компании"],["contacts.html","Контакты"],["privacy.html","Политика конфиденциальности"],["terms.html","Условия использования"]]) {
    files[f] = `${head(`${tt} - Fixture`,`${tt}: сведения о компании и правилах работы сервиса.`,`/${f}`)}<body>${navLinks}<h1>${tt}</h1><p>Текст страницы.</p></body></html>`;
  }
  files["robots.txt"] = `User-agent: *\nAllow: /\nSitemap: https://${DOMAIN}/sitemap.xml\n`;
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>`;

  const res = applyCommerceLayer({ chrome, files, silos, clusters, products, business:{ phone:"+7 900 000-00-00", address:"Москва", city:"Москва", workHours:"9-18" } });

  // sitemap assembly like the deploy pipeline does
  const allPaths = new Set<string>(["/","/blog/", ...articlePaths,
    ...silos.map(s=>getSiloUrl({slug:s.slug})),
    ...clusters.map(c=>getClusterUrl({slug:c.slug,siloSlug:silos.find(s=>s.id===c.silo_id)!.slug})),
    ...res.extraPaths, "/about.html","/contacts.html","/privacy.html","/terms.html"]);
  files["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...allPaths].map(p=>`  <url><loc>https://${DOMAIN}${p}</loc></url>`).join("\n")}\n</urlset>`;

  const report = auditBundle(files, DOMAIN, {
    silos: silos.map(s=>({id:s.id,name:s.name,status:"active"})),
    clusters: clusters.map(c=>({id:c.id,silo_id:c.silo_id,name:c.name,status:"active"})),
    products: products.map(p=>({id:p.id,name:p.name,site_cluster_id:p.site_cluster_id,silo_id:p.silo_id})),
  });

  const keys = Object.keys(files).sort();
  console.log("=== FILE TREE ===");
  for (const k of keys) console.log(" ", k);
  console.log("=== STATS ===");
  console.log(JSON.stringify({
    files: keys.length,
    html: keys.filter(k=>k.endsWith(".html")).length,
    commerce_products: res.products, commerce_categories: res.categories,
    internal_links: res.links.length,
    link_types: res.links.reduce((a:Record<string,number>,l)=>{a[`${l.from_kind}>${l.to_kind}`]=(a[`${l.from_kind}>${l.to_kind}`]||0)+1;return a;},{}),
    sitemap_urls: allPaths.size,
    qa: { score: report.score, critical: report.critical, warnings: report.warnings, counts: report.counts },
    sample_issues: report.issues.slice(0,8),
    product_schema: /"@type"\s*:\s*"Product"/.test(files[[...res.pathByProductId.values()][0].slice(1)] || "") ,
    service_schema: keys.some(k=>/"@type"\s*:\s*"Service"/.test(files[k]||"")),
  }, null, 1));

  if (report.critical !== 0) throw new Error("QA critical issues: "+JSON.stringify(report.counts));
  if (res.products !== 22 || res.categories !== 5) throw new Error("unexpected commerce counts");
});
