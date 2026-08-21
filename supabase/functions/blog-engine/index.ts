// ============================================================================
// P16 - BLOG / TOPIC AUTHORITY ENGINE runner.
//
//   SEMANTICS -> TOPIC MAP -> CONTENT PLAN -> GEMINI WRITER -> INTERNAL LINKS
//   -> articles -> (PDE) -> (SEO ENGINE) -> Build
//
// Writes only its own layer: topic_clusters, content_plan, articles rows.
// It never mutates PDE logic, page_registry rules, Content Engine,
// SEO Engine, Commercial Engine, Build or QA - it only *calls* PDE and the
// SEO Engine as they already exist.
//
// Body: { project_id,
//         action: "analyze" | "build_plan" | "generate" | "publish",
//         mode?: "new" | "priority" | "selected" | "all",
//         plan_ids?: string[], limit?: number }
// ============================================================================

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { chatJson, AiError } from "../_shared/aiClient.ts";
import { readCommercialProfile, factorFacts } from "../_shared/commercialProfile.ts";
import { slugifyPath } from "../_shared/siloUrl.ts";
import {
  buildTopicMap, planTopicsForCluster, clusterAuthorityScore,
  articleAuthorityScore, coveredKeywords, ARTICLE_STRUCTURE, MIN_WORDS,
  type ArticleType, type CommercialPage, type TopicClusterDraft,
} from "../_shared/topicAuthority.ts";
import {
  pickLinkTargets, injectLinks, countCommercialLinks,
  MIN_COMMERCIAL_LINKS, type LinkTarget,
} from "../_shared/internalLinks.ts";

const MODEL = "google/gemini-2.5-pro";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const t = (v: unknown) => String(v ?? "").trim();

const WRITER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "h1", "description", "outline", "content", "faq"],
  properties: {
    title: { type: "string" },
    h1: { type: "string" },
    description: { type: "string" },
    outline: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["h2", "h3"],
        properties: { h2: { type: "string" }, h3: { type: "array", items: { type: "string" } } },
      },
    },
    content: { type: "string" },
    faq: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["q", "a"],
        properties: { q: { type: "string" }, a: { type: "string" } },
      },
    },
    links: { type: "array", items: { type: "string" } },
  },
} as const;

interface WriterOut {
  title: string; h1: string; description: string;
  outline: { h2: string; h3: string[] }[];
  content: string;
  faq: { q: string; a: string }[];
  links?: string[];
}

function sanitize(s: string): string {
  return String(s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/ё/g, "е").replace(/Ё/g, "Е")
    .replace(/\*\*(.+?)\*\*/g, "$1");
}

function writerSystem(type: ArticleType, ru: boolean): string {
  const st = ARTICLE_STRUCTURE[type];
  const sections = (ru ? st.ru : st.en).map((s) => `  - ${s}`).join("\n");
  const common = ru
    ? [
        "Ты SEO-редактор блога коммерческого сайта. Пишешь статью, которая строит тематический авторитет.",
        "Категорически запрещено выдумывать факты: цены, сроки, гарантии, сертификаты, отзывы, статистику, названия клиентов.",
        "Факты о компании берешь только из company_facts. Если факта нет - пиши нейтрально, без цифр.",
        `Объем тела статьи: не меньше ${MIN_WORDS[type]} слов.`,
        "Формат content: markdown. H2 - '## ', H3 - '### '. H1 в content НЕ включать.",
        "Только короткий дефис '-', без длинного тире. Без буквы 'е' с точками. Без жирного текста.",
        "Не вставляй ссылки в content: перелинковку добавит движок.",
        "title до 65 символов, description 120-160 символов.",
        "faq: 4-5 пар вопрос-ответ, ответ не короче 40 слов.",
      ]
    : [
        "You are an SEO blog editor for a commercial site building topical authority.",
        "Never invent facts: prices, terms, warranty, certificates, reviews, statistics, client names.",
        "Company facts come only from company_facts.",
        `Body length: at least ${MIN_WORDS[type]} words.`,
        "content is markdown, H2 '## ', H3 '### ', no H1, no links, no bold.",
        "title max 65 chars, description 120-160 chars, faq 4-5 items with 40+ word answers.",
      ];
  return [
    common.map((c) => `- ${c}`).join("\n"),
    ru ? `Тип статьи: ${type}.` : `Article type: ${type}.`,
    ru ? `Обязательная структура разделов:\n${sections}` : `Required sections:\n${sections}`,
    ru ? st.rules.ru : st.rules.en,
    `JSON: {"title":"","h1":"","description":"","outline":[{"h2":"","h3":[]}],"content":"","faq":[{"q":"","a":""}],"links":[]}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;

    const body = await req.json().catch(() => ({}));
    const projectId = t(body?.project_id);
    const action = t(body?.action) || "analyze";
    const mode = t(body?.mode) || "new";
    const planIds: string[] = Array.isArray(body?.plan_ids) ? body.plan_ids.map(String) : [];
    const limit = Math.min(20, Math.max(1, Number(body?.limit) || 3));
    if (!projectId) return errorResponse("project_id is required", 400);

    const admin = adminClient();
    const { data: project } = await admin.from("projects").select("*").eq("id", projectId).maybeSingle();
    if (!project) return errorResponse("project not found", 404);
    const owner = String((project as any).user_id);
    if (owner !== auth.userId) {
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: auth.userId, _role: "admin" });
      if (!isAdmin) return errorResponse("forbidden", 403);
    }
    const ru = !String((project as any).language || "ru").toLowerCase().startsWith("en");

    // ---- registry (read-only source of truth) ------------------------------
    const { data: registryRows } = await admin
      .from("page_registry")
      .select("id, entity_type, entity_id, page_type, url_path, title, status, demand_score, indexable")
      .eq("project_id", projectId)
      .in("status", ["approved", "review"]);
    const registry = (registryRows || []) as any[];

    const pages: CommercialPage[] = registry.map((r) => ({
      registry_id: r.id, url_path: r.url_path, page_type: r.page_type,
      title: r.title || "", status: r.status, entity_id: r.entity_id,
      entity_type: r.entity_type, demand_score: r.demand_score,
    }));
    const linkPool: LinkTarget[] = registry.map((r) => ({
      registry_id: r.id, url_path: r.url_path, page_type: r.page_type,
      title: r.title || "", status: r.status, indexable: r.indexable,
    }));

    const [{ data: clusterRows }, { data: planRows }] = await Promise.all([
      admin.from("topic_clusters").select("*").eq("project_id", projectId).order("authority_score", { ascending: false }),
      admin.from("content_plan").select("*").eq("project_id", projectId).order("priority", { ascending: false }),
    ]);

    // ------------------------------------------------------------------ ANALYZE
    if (action === "analyze") {
      return jsonResponse({
        ok: true, action,
        summary: summarize(clusterRows || [], planRows || [], pages),
        clusters: clusterRows || [],
        plan: planRows || [],
      });
    }

    // --------------------------------------------------------------- BUILD PLAN
    if (action === "build_plan") {
      if (!registry.length) return errorResponse("registry_empty: run the Page Decision Engine first", 409);

      const { data: keywords } = await admin
        .from("site_keywords").select("keyword, frequency, intent, site_cluster_id, silo_id")
        .eq("project_id", projectId).limit(4000);

      const map = buildTopicMap(pages, (keywords || []) as any[]);
      if (!map.length) return errorResponse("no_commercial_pages: the topic map needs approved hub or category pages", 409);

      const { data: currentClusters } = await admin.from("topic_clusters")
        .select("id, name").eq("project_id", projectId);
      const clusterIdByName = new Map(
        (currentClusters || []).map((c: any) => [String(c.name).toLowerCase(), c.id]),
      );

      const savedClusters: { row: any; draft: TopicClusterDraft }[] = [];
      for (const d of map) {
        const payload = {
          project_id: projectId,
          name: d.name,
          main_entity: d.main_entity,
          commercial_pages: d.commercial_pages,
          commercial_paths: d.commercial_paths,
          commercial_pages_count: d.commercial_pages.length,
          keywords: d.keywords,
          keywords_count: d.keywords.length,
          authority_score: d.authority_score,
        };
        const existingId = clusterIdByName.get(d.name.toLowerCase());
        const q = existingId
          ? admin.from("topic_clusters").update(payload).eq("id", existingId)
          : admin.from("topic_clusters").insert(payload);
        const { data: row, error } = await q.select().maybeSingle();
        if (error) { console.error("[blog-engine] cluster save", error.message); continue; }
        if (row) savedClusters.push({ row, draft: d });
      }


      const existingTitles = new Set((planRows || []).map((p: any) => String(p.title).toLowerCase()));
      const inserts: any[] = [];
      for (const { row, draft } of savedClusters) {
        for (const p of planTopicsForCluster(draft as TopicClusterDraft, { lang: ru ? "ru" : "en" })) {
          const key = p.title.toLowerCase();
          if (existingTitles.has(key)) continue;
          existingTitles.add(key);
          inserts.push({
            project_id: projectId,
            topic_cluster_id: row.id,
            title: p.title,
            intent: p.intent,
            article_type: p.article_type,
            target_keywords: p.target_keywords,
            linked_pages: p.linked_pages,
            priority: p.priority,
            status: "planned",
          });
        }
      }
      if (inserts.length) {
        const { error } = await admin.from("content_plan").insert(inserts);
        if (error) return errorResponse(`content_plan: ${error.message}`, 500);
      }

      const { data: freshClusters } = await admin.from("topic_clusters").select("*")
        .eq("project_id", projectId).order("authority_score", { ascending: false });
      const { data: freshPlan } = await admin.from("content_plan").select("*")
        .eq("project_id", projectId).order("priority", { ascending: false });

      return jsonResponse({
        ok: true, action,
        clusters_created: savedClusters.length,
        topics_created: inserts.length,
        summary: summarize(freshClusters || [], freshPlan || [], pages),
        clusters: freshClusters || [],
        plan: freshPlan || [],
      });
    }

    // ---------------------------------------------------------------- GENERATE
    if (action === "generate") {
      const apiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
      if (!apiKey) return errorResponse("OPENROUTER_API_KEY is not configured", 500);

      let queue = (planRows || []) as any[];
      if (mode === "selected") queue = queue.filter((p) => planIds.includes(p.id));
      else if (mode === "priority") queue = queue.filter((p) => p.status !== "published").sort((a, b) => b.priority - a.priority);
      else if (mode === "all") queue = queue.filter((p) => p.status !== "published");
      else queue = queue.filter((p) => p.status === "planned" || p.status === "failed");
      queue = queue.slice(0, limit);
      if (!queue.length) return jsonResponse({ ok: true, action, generated: 0, results: [], note: "nothing to generate" });

      const profile = readCommercialProfile(project as any);
      const facts = factorFacts(profile);
      const clusterById = new Map((clusterRows || []).map((c: any) => [c.id, c]));
      const regById = new Map(registry.map((r) => [r.id, r]));

      const [{ data: existingArticles }, { data: siteClusters }, { data: products }] = await Promise.all([
        admin.from("articles").select("id, slug").eq("project_id", projectId).limit(500),
        admin.from("site_clusters").select("id, name, slug, silo_id").eq("project_id", projectId),
        admin.from("site_products").select("id, name, kind, brand, characteristics").eq("project_id", projectId).limit(60),
      ]);
      const usedSlugs = new Set((existingArticles || []).map((a: any) => String(a.slug || "")).filter(Boolean));
      const siteClusterById = new Map((siteClusters || []).map((c: any) => [c.id, c]));

      const results: any[] = [];
      let generated = 0, failed = 0, skipped = 0, linksCreated = 0;
      const startedAt = Date.now();
      const BUDGET_MS = 110_000;

      for (const plan of queue) {
        if (Date.now() - startedAt > BUDGET_MS) { skipped++; continue; }
        await admin.from("content_plan").update({ status: "generating", error: null }).eq("id", plan.id);

        const cluster = clusterById.get(plan.topic_cluster_id);
        const targetKeywords: string[] = Array.isArray(plan.target_keywords) ? plan.target_keywords.map(String) : [];
        const preferred: string[] = Array.isArray(plan.linked_pages) ? plan.linked_pages.map(String) : [];

        const targets = pickLinkTargets(linkPool, {
          preferred, keywords: targetKeywords, title: plan.title, min: MIN_COMMERCIAL_LINKS, max: 5,
        });

        const ctx = {
          article_title: plan.title,
          article_type: plan.article_type,
          intent: plan.intent,
          topic_cluster: cluster ? { name: cluster.name, main_entity: cluster.main_entity } : null,
          target_keywords: targetKeywords,
          related_commercial_pages: targets.map((x) => ({ title: x.title, type: x.page_type, url: x.url_path })),
          company_facts: facts,
          catalog_examples: (products || []).slice(0, 12).map((p: any) => ({ name: p.name, kind: p.kind, brand: p.brand })),
          language: ru ? "ru" : "en",
        };

        let gen: WriterOut | null = null;
        let lastErr = "";
        for (let attempt = 0; attempt < 2 && !gen; attempt++) {
          try {
            const res = await chatJson<WriterOut>({
              apiKey, model: MODEL,
              system: writerSystem(plan.article_type as ArticleType, ru),
              user: JSON.stringify(ctx, null, 1).slice(0, 12000),
              schema: WRITER_SCHEMA as unknown as Record<string, unknown>,
              schemaName: "blog_article",
              temperature: 0.6,
              maxTokens: 8000,
              timeoutMs: 110_000,
              retries: 1,
              appTitle: "SEO-Modul blog-engine",
              functionName: "blog-engine",
              userId: owner,
              projectId,
            });
            const d = res.data;
            if (!d || !t(d.content) || !Array.isArray(d.faq)) throw new Error("invalid_json_shape");
            gen = d;
          } catch (e) {
            lastErr = e instanceof AiError ? `${e.kind}: ${e.message}` : String((e as Error)?.message || e);
          }
        }

        if (!gen) {
          failed++;
          await admin.from("content_plan").update({ status: "failed", error: lastErr.slice(0, 500) }).eq("id", plan.id);
          results.push({ plan_id: plan.id, title: plan.title, error: lastErr });
          continue;
        }

        // ---- compose markdown ------------------------------------------------
        const title = sanitize(t(gen.title) || plan.title).slice(0, 120);
        const h1 = sanitize(t(gen.h1) || title);
        const description = sanitize(t(gen.description)).slice(0, 300);
        let markdown = sanitize(gen.content).trim();
        const faq = (gen.faq || []).slice(0, 6).map((f) => ({ q: sanitize(t(f.q)), a: sanitize(t(f.a)) }))
          .filter((f) => f.q && f.a);
        if (faq.length) {
          markdown += `\n\n## ${ru ? "Частые вопросы" : "FAQ"}\n\n` +
            faq.map((f) => `### ${f.q}\n\n${f.a}`).join("\n\n");
        }

        const injected = injectLinks(markdown, targets, { ru });
        markdown = injected.markdown;
        const commercialLinks = countCommercialLinks(injected.links);
        linksCreated += commercialLinks;

        // ---- authority score -------------------------------------------------
        const words = markdown.split(/\s+/).filter(Boolean).length;
        const headings = (markdown.match(/^#{2,3}\s/gm) || []).length;
        const covered = coveredKeywords(markdown, targetKeywords);
        const entityPool = [...new Set([
          ...targets.map((x) => x.title),
          ...(products || []).slice(0, 20).map((p: any) => p.name),
          t(facts.company_name),
        ].filter(Boolean))] as string[];
        const entities = coveredKeywords(markdown, entityPool).length;
        const authority = articleAuthorityScore({
          words, headings, faq: faq.length,
          commercial_links: commercialLinks,
          keywords_total: targetKeywords.length,
          keywords_covered: covered.length,
          entities,
          has_table: /\|.+\|/.test(markdown),
          article_type: plan.article_type as ArticleType,
        });

        // ---- place the article in the SILO ----------------------------------
        const anchor = targets.find((x) => x.page_type === "category") || targets[0];
        const anchorReg = anchor ? regById.get(anchor.registry_id) : null;
        let siteClusterId: string | null = null;
        let siloId: string | null = null;
        if (anchorReg?.entity_type === "cluster") {
          siteClusterId = anchorReg.entity_id;
          siloId = siteClusterById.get(anchorReg.entity_id)?.silo_id ?? null;
        } else if (anchorReg?.entity_type === "silo") {
          siloId = anchorReg.entity_id;
        }

        let slug = slugifyPath(title);
        let n = 2;
        while (usedSlugs.has(slug)) slug = `${slugifyPath(title)}-${n++}`;
        usedSlugs.add(slug);

        const scheme = String((project as any).url_scheme || "legacy");
        const basePath = anchor && scheme === "silo" && anchor.url_path.endsWith("/")
          ? anchor.url_path
          : null;
        const urlPath = basePath ? `${basePath}${slug}.html` : `/posts/${slug}.html`;

        const { data: article, error: aErr } = await admin.from("articles").insert({
          user_id: owner,
          project_id: projectId,
          title,
          content: markdown,
          meta_description: description,
          status: "completed",
          language: ru ? "ru" : "en",
          main_keyword: targetKeywords[0] || plan.title,
          page_type: "article",
          source: "blog_engine",
          generation_model: MODEL,
          silo_id: siloId,
          site_cluster_id: siteClusterId,
          slug,
          url_path: urlPath,
        }).select("id").maybeSingle();

        if (aErr || !article) {
          failed++;
          await admin.from("content_plan").update({ status: "failed", error: (aErr?.message || "insert failed").slice(0, 500) }).eq("id", plan.id);
          results.push({ plan_id: plan.id, title, error: aErr?.message });
          continue;
        }

        // record the links in the existing internal_links layer
        if (injected.links.length) {
          await admin.from("internal_links").insert(injected.links.map((l) => ({
            project_id: projectId,
            from_article_id: article.id,
            from_path: urlPath,
            to_path: l.url,
            anchor: l.anchor,
            type: "blog_to_commercial",
            to_kind: l.page_type,
            from_kind: "article",
            is_silo_internal: true,
          })));
        }

        await admin.from("content_plan").update({
          status: "ready",
          article_id: article.id,
          url_path: urlPath,
          authority_score: authority.score,
          quality: {
            status: authority.status, issues: authority.issues, words, headings,
            faq: faq.length, commercial_links: commercialLinks,
            covered_keywords: covered, entities, h1,
          },
          error: null,
          generated_at: new Date().toISOString(),
        }).eq("id", plan.id);

        generated++;
        results.push({
          plan_id: plan.id, article_id: article.id, title, url_path: urlPath,
          article_type: plan.article_type, words, faq: faq.length,
          commercial_links: commercialLinks,
          links: injected.links.map((l) => ({ url: l.url, anchor: l.anchor, placement: l.placement })),
          authority_score: authority.score, authority_status: authority.status,
          issues: authority.issues,
        });
      }

      // P14/PDE integration: register the new pages and build their SEO package
      let seo: unknown = null;
      if (generated > 0) {
        await callInternal("page-decision-engine", { project_id: projectId }, owner);
        seo = await callInternal("seo-engine", { project_id: projectId, mode: "missing", limit: 40 }, owner);
      }

      const { data: freshPlan } = await admin.from("content_plan").select("*")
        .eq("project_id", projectId).order("priority", { ascending: false });

      return jsonResponse({
        ok: true, action, mode,
        generated, failed, skipped, internal_links: linksCreated,
        seo_engine: seo,
        results,
        plan: freshPlan || [],
      });
    }

    // ----------------------------------------------------------------- PUBLISH
    if (action === "publish") {
      let ready = (planRows || []).filter((p: any) => p.status === "ready" && p.article_id);
      if (planIds.length) ready = ready.filter((p: any) => planIds.includes(p.id));
      const gate = ready.filter((p: any) => (p.quality?.status || "FAIL") !== "FAIL");
      const blocked = ready.filter((p: any) => (p.quality?.status || "FAIL") === "FAIL");

      for (const p of gate) {
        await admin.from("articles").update({ status: "published" }).eq("id", p.article_id);
        await admin.from("content_plan").update({ status: "published", scheduled_at: new Date().toISOString() }).eq("id", p.id);
        if (p.topic_cluster_id) {
          await admin.from("topic_clusters").update({ status: "published" }).eq("id", p.topic_cluster_id);
        }
      }

      return jsonResponse({
        ok: true, action,
        published: gate.length,
        blocked: blocked.map((p: any) => ({ plan_id: p.id, title: p.title, issues: p.quality?.issues || [] })),
      });
    }

    return errorResponse(`unknown action: ${action}`, 400);
  } catch (e) {
    console.error("blog-engine error:", e);
    return errorResponse(e instanceof Error ? e.message : "blog engine failed", 500);
  }
});

async function callInternal(fn: string, payload: unknown, userId: string): Promise<unknown> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "x-queue-user-id": userId,
      },
      body: JSON.stringify(payload),
    });
    return await res.json().catch(() => ({ ok: res.ok }));
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

function summarize(clusters: any[], plan: any[], pages: CommercialPage[]) {
  const byStatus = (s: string) => plan.filter((p) => p.status === s).length;
  const scored = plan.filter((p) => typeof p.authority_score === "number");
  const clusterScores = clusters.map((c) =>
    clusterAuthorityScore({
      commercial_pages_count: c.commercial_pages_count || 0,
      keywords_count: c.keywords_count || 0,
      articles_count: plan.filter((p) => p.topic_cluster_id === c.id && p.article_id).length,
      linked_articles: plan.filter((p) => p.topic_cluster_id === c.id && (p.quality?.commercial_links || 0) >= 2).length,
    }));
  return {
    clusters: clusters.length,
    commercial_pages: pages.filter((p) => ["hub", "category", "product", "service", "local"].includes(p.page_type)).length,
    topics: plan.length,
    planned: byStatus("planned"),
    ready: byStatus("ready"),
    published: byStatus("published"),
    failed: byStatus("failed"),
    covered_clusters: clusters.filter((c) => plan.some((p) => p.topic_cluster_id === c.id && p.article_id)).length,
    authority_score: clusterScores.length
      ? Math.round(clusterScores.reduce((a, b) => a + b, 0) / clusterScores.length) : 0,
    article_authority_avg: scored.length
      ? Math.round(scored.reduce((a, p) => a + p.authority_score, 0) / scored.length) : 0,
    internal_links: plan.reduce((a, p) => a + (p.quality?.commercial_links || 0), 0),
  };
}
