// ============================================================================
// P20 - MEDIA ENGINE
//
//   page_registry / site_products / site_clusters / site_silos / articles
//                     |
//                [Media Engine]   upload > import > AI > placeholder
//                     |
//                image_assets  ->  Visual Renderer  ->  QA  ->  Launch Gate
//
// Actions:
//   stats             - coverage counters for the UI
//   generate_missing  - only entities without any ready image
//   generate_selected - explicit entity ids
//   regenerate        - drop existing AI assets of the targets and rebuild
//   import_only       - copy real photos (upload / xml / api) into image_assets
//
// Hard rule: the model never invents facts (размеры, цвет, материал,
// комплектацию, бренд). Промпт строится только из данных сущности.
// ============================================================================

import { jsonResponse, errorResponse } from "../_shared/cors.ts";
import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { withErrorHandler, HttpError } from "../_shared/errorHandler.ts";
import { fetchWithTimeout } from "../_shared/withTimeout.ts";
import { buildAlt, placeholderUrl, type MediaEntityType } from "../_shared/mediaAssets.ts";

const LOVABLE_API_KEY = (Deno.env.get("LOVABLE_API_KEY") || "").trim();
const BUCKET = "article-images";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

type Row = Record<string, any>;
const t = (v: unknown) => String(v ?? "").trim();

interface Target {
  entity_type: MediaEntityType;
  entity_id: string;
  name: string;
  /** facts allowed in the prompt - only real data */
  facts: string[];
  own_images: string[];
  /** slots to fill: [image_type, position, width, height, angle] */
  slots: { image_type: "hero" | "gallery" | "cover" | "inline"; position: number; width: number; height: number; angle: string }[];
}

// ---------------------------------------------------------------- prompts ---
const NO_TEXT =
  "no text, no letters, no words, no captions, no watermarks, no logos, no signs, no numbers";

function promptFor(target: Target, slot: Target["slots"][number]): string {
  const facts = target.facts.slice(0, 8).join(", ");
  const base = `${target.name}${facts ? `. Known real specifications: ${facts}` : ""}`;
  if (target.entity_type === "product") {
    return `Professional product photography of: ${base}. ${slot.angle}. ` +
      `Pure white seamless background, studio softbox lighting, industrial product realism, sharp focus, high detail, 4K. ` +
      `Do not add any object, marking, size, color, material or branding that is not listed above. ${NO_TEXT}.`;
  }
  if (target.entity_type === "category") {
    return `Wide editorial photo of a group of products of the category: ${base}. ${slot.angle}. ` +
      `Several items of the same category arranged together, neutral light background, studio lighting, B2B industrial realism, sharp focus, 4K. ${NO_TEXT}.`;
  }
  if (target.entity_type === "hub" || target.entity_type === "home") {
    return `Wide B2B hero photo for the product direction: ${base}. ${slot.angle}. ` +
      `Industrial warehouse or professional workshop context, assorted products of this direction, natural cool light, corporate realism, 4K. ${NO_TEXT}.`;
  }
  if (target.entity_type === "service") {
    return `Documentary photo of specialists performing the service: ${base}. ${slot.angle}. ` +
      `Real working environment, natural light, professional B2B reportage, 4K. ${NO_TEXT}.`;
  }
  return `Editorial illustration for an article: ${base}. ${slot.angle}. ` +
    `Realistic photography, natural light, professional editorial style, 4K. ${NO_TEXT}.`;
}

const PRODUCT_SLOTS: Target["slots"] = [
  { image_type: "hero", position: 0, width: 1200, height: 1200, angle: "Front three-quarter view of a single item, centered" },
  { image_type: "gallery", position: 1, width: 1200, height: 1200, angle: "Side view of the same item" },
  { image_type: "gallery", position: 2, width: 1200, height: 1200, angle: "Perspective close-up view of the same item" },
  { image_type: "gallery", position: 3, width: 1200, height: 1200, angle: "The item in a real usage context" },
];

const ARTICLE_ILLUSTRATIONS: Record<string, string[]> = {
  guide: ["Step-by-step workflow scene", "Close-up of the tools in use"],
  comparison: ["Two similar products placed side by side for comparison", "Detail shot highlighting the difference"],
  faq: ["Clean object photo of the discussed item", "Detail shot of the same item"],
  review: ["Real product on a work surface", "Product in operation"],
  expert: ["Specialist at work", "Detail of the working process"],
  default: ["Related objects on a neutral background", "Working context scene"],
};

// ----------------------------------------------------------- AI + storage ---
async function generateImage(prompt: string, width: number, height: number): Promise<string> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");
  const aspect = width === height ? "1:1" : width > height ? "16:9" : "9:16";
  const r = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image",
      messages: [{ role: "user", content: `${prompt}\n\nAspect ratio: ${aspect}.` }],
      modalities: ["image", "text"],
    }),
  }, 120_000);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (r.status === 429) throw new HttpError("Лимит запросов AI исчерпан, попробуйте позже", 429);
    if (r.status === 402) throw new HttpError("Закончились кредиты AI Gateway, пополните баланс", 402);
    throw new Error(`AI Gateway ${r.status}: ${body.slice(0, 200)}`);
  }
  const d = await r.json();
  const b64 = d?.data?.[0]?.b64_json;
  if (!b64 || typeof b64 !== "string") throw new Error("AI Gateway returned no image");
  return b64;
}

async function uploadBase64(admin: Row, projectId: string, b64: string, name: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const path = `media/${projectId}/${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.png`;
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return t(data?.publicUrl);
}

// --------------------------------------------------------------- targets ---
function productFacts(p: Row): string[] {
  const chars = (p.characteristics && typeof p.characteristics === "object") ? p.characteristics as Row : {};
  const list = Object.entries(chars).slice(0, 6).map(([k, v]) => `${t(k)}: ${t(v)}`);
  return [t(p.brand) ? `brand ${t(p.brand)}` : "", t(p.sku) ? `article ${t(p.sku)}` : "", ...list].filter(Boolean);
}

async function collectTargets(admin: Row, projectId: string, userId: string, scope: string[]): Promise<Target[]> {
  const out: Target[] = [];
  const want = (s: string) => scope.includes("all") || scope.includes(s);

  if (want("products")) {
    const { data } = await admin.from("site_products")
      .select("id, name, sku, brand, characteristics, images, kind, status")
      .eq("project_id", projectId).neq("status", "archived").limit(10000);
    for (const p of ((data || []) as Row[])) {
      const isService = t(p.kind) === "service";
      out.push({
        entity_type: isService ? "service" : "product",
        entity_id: t(p.id),
        name: t(p.name),
        facts: productFacts(p),
        own_images: Array.isArray(p.images) ? (p.images as unknown[]).map(t).filter(Boolean) : [],
        slots: isService
          ? [{ image_type: "hero", position: 0, width: 1600, height: 900, angle: "Wide documentary shot" }]
          : PRODUCT_SLOTS,
      });
    }
  }

  if (want("categories")) {
    const { data } = await admin.from("site_clusters")
      .select("id, name, description, status").eq("project_id", projectId).neq("status", "archived").limit(5000);
    for (const c of ((data || []) as Row[])) {
      out.push({
        entity_type: "category", entity_id: t(c.id), name: t(c.name),
        facts: [t(c.description).slice(0, 160)].filter(Boolean), own_images: [],
        slots: [{ image_type: "hero", position: 0, width: 1600, height: 900, angle: "Group of items of this category" }],
      });
    }
    const { data: silos } = await admin.from("site_silos")
      .select("id, name, description, status").eq("project_id", projectId).neq("status", "archived").limit(500);
    for (const s of ((silos || []) as Row[])) {
      out.push({
        entity_type: "hub", entity_id: t(s.id), name: t(s.name),
        facts: [t(s.description).slice(0, 160)].filter(Boolean), own_images: [],
        slots: [{ image_type: "hero", position: 0, width: 1600, height: 900, angle: "Wide B2B hero composition" }],
      });
    }
  }

  if (want("articles")) {
    const { data } = await admin.from("articles")
      .select("id, title, keyword, status, page_type").eq("project_id", projectId).eq("user_id", userId)
      .in("status", ["completed", "published"]).limit(2000);
    for (const a of ((data || []) as Row[])) {
      const kind = t(a.page_type) || "default";
      const extras = ARTICLE_ILLUSTRATIONS[kind] || ARTICLE_ILLUSTRATIONS.default;
      out.push({
        entity_type: "article", entity_id: t(a.id), name: t(a.title) || t(a.keyword),
        facts: [t(a.keyword)].filter(Boolean), own_images: [],
        slots: [
          { image_type: "cover", position: 0, width: 1600, height: 900, angle: "Wide cover composition" },
          ...extras.map((angle, i) => ({ image_type: "inline" as const, position: i + 1, width: 1600, height: 900, angle })),
        ],
      });
    }
  }

  return out.filter((x) => x.entity_id && x.name);
}

// ------------------------------------------------------------------ main ---
Deno.serve(withErrorHandler("media-engine", async (req) => {
  if (req.method !== "POST") throw new HttpError("Method not allowed", 405);
  const auth = await verifyAuth(req);
  if (auth instanceof Response) return auth;

  const body = await req.json().catch(() => ({}));
  const projectId = t(body?.project_id);
  if (!projectId) throw new HttpError("project_id required", 400);
  const mode = t(body?.mode) || t(body?.action) || "stats";
  const scope: string[] = Array.isArray(body?.scope) && body.scope.length ? body.scope.map(t) : ["all"];
  const entityIds: string[] = Array.isArray(body?.entity_ids) ? body.entity_ids.map(t).filter(Boolean) : [];
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body?.limit) || DEFAULT_LIMIT));

  const admin = adminClient();
  const { data: project } = await admin.from("projects").select("id, user_id").eq("id", projectId).maybeSingle();
  if (!project) throw new HttpError("Project not found", 404);
  if ((project as Row).user_id !== auth.userId) throw new HttpError("Forbidden", 403);

  const targets = await collectTargets(admin, projectId, auth.userId, scope);
  const { data: assetRows } = await admin.from("image_assets")
    .select("id, entity_type, entity_id, image_type, source, status, position, alt, image_url")
    .eq("project_id", projectId).limit(30000);
  const assets = ((assetRows || []) as Row[]);
  const byEntity = new Map<string, Row[]>();
  for (const a of assets) {
    const k = `${t(a.entity_type)}:${t(a.entity_id)}`;
    byEntity.set(k, [...(byEntity.get(k) || []), a]);
  }
  const readyOf = (target: Target) =>
    (byEntity.get(`${target.entity_type}:${target.entity_id}`) || []).filter((a) => t(a.status) === "ready");

  // ------------------------------------------------------------- stats ----
  const stats = () => {
    const products = targets.filter((x) => x.entity_type === "product" || x.entity_type === "service");
    const withOwn = products.filter((p) => p.own_images.length > 0).length;
    const sourceCount = (s: string) => assets.filter((a) => t(a.source) === s && t(a.status) === "ready").length;
    const covered = (list: Target[]) => list.filter((x) => readyOf(x).length > 0 || x.own_images.length > 0).length;
    const cats = targets.filter((x) => x.entity_type === "category" || x.entity_type === "hub");
    const arts = targets.filter((x) => x.entity_type === "article");
    return {
      products_total: products.length,
      products_with_photo: covered(products),
      products_without_photo: products.length - covered(products),
      products_own_photo: withOwn,
      categories_total: cats.length,
      categories_with_photo: covered(cats),
      articles_total: arts.length,
      articles_with_cover: arts.filter((a) => readyOf(a).some((x) => t(x.image_type) === "cover")).length,
      images_total: assets.filter((a) => t(a.status) === "ready").length,
      ai: sourceCount("ai"),
      imported: sourceCount("xml") + sourceCount("api") + sourceCount("upload"),
      placeholder: sourceCount("placeholder"),
      failed: assets.filter((a) => t(a.status) === "failed").length,
      no_alt: assets.filter((a) => t(a.status) === "ready" && !t(a.alt)).length,
    };
  };

  if (mode === "stats") return jsonResponse({ ok: true, stats: stats() });

  // ------------------------------------------------------- import_only ----
  // Real photos already attached to the catalog become first-class assets.
  const importReal = async (list: Target[]) => {
    const rows: Row[] = [];
    for (const target of list) {
      if (!target.own_images.length) continue;
      const already = new Set(readyOf(target).map((a) => t(a.image_url)));
      target.own_images.slice(0, 4).forEach((url, i) => {
        if (already.has(url)) return;
        rows.push({
          project_id: projectId, entity_type: target.entity_type, entity_id: target.entity_id,
          image_type: i === 0 ? "hero" : "gallery", position: i, image_url: url,
          source: "xml", status: "ready", width: null, height: null,
          alt: buildAlt([target.name, target.facts[0]]),
        });
      });
    }
    if (!rows.length) return 0;
    for (let i = 0; i < rows.length; i += 200) {
      await admin.from("image_assets")
        .upsert(rows.slice(i, i + 200), { onConflict: "project_id,entity_type,entity_id,image_type,position" });
    }
    return rows.length;
  };

  if (mode === "import_only") {
    const imported = await importReal(targets);
    return jsonResponse({ ok: true, imported, stats: stats() });
  }

  // ----------------------------------------------------------- generate ---
  let pool = targets;
  if (mode === "generate_selected" || mode === "regenerate") {
    if (!entityIds.length) throw new HttpError("entity_ids required", 400);
    const wanted = new Set(entityIds);
    pool = targets.filter((x) => wanted.has(x.entity_id));
  }

  // Import real photos first - AI is used only where nothing real exists.
  const imported = await importReal(pool);

  if (mode === "regenerate") {
    const ids = pool.map((x) => x.entity_id);
    for (let i = 0; i < ids.length; i += 100) {
      await admin.from("image_assets").delete()
        .eq("project_id", projectId).in("source", ["ai", "placeholder"]).in("entity_id", ids.slice(i, i + 100));
    }
    for (const x of pool) byEntity.set(`${x.entity_type}:${x.entity_id}`, []);
  }

  // Build the queue of missing slots. Entities with real photos are skipped
  // for hero/gallery: реальные фото всегда в приоритете над генерацией.
  interface Job { target: Target; slot: Target["slots"][number] }
  const queue: Job[] = [];
  for (const target of pool) {
    const ready = mode === "regenerate" ? [] : readyOf(target);
    const hasReal = target.own_images.length > 0 || ready.some((a) => ["upload", "xml", "api"].includes(t(a.source)));
    if (hasReal && target.entity_type !== "article") continue;
    const filled = new Set(ready.map((a) => `${t(a.image_type)}:${a.position ?? 0}`));
    for (const slot of target.slots) {
      if (filled.has(`${slot.image_type}:${slot.position}`)) continue;
      queue.push({ target, slot });
    }
  }

  const batch = queue.slice(0, limit);
  let generated = 0;
  let failed = 0;
  let placeholders = 0;

  const results = await Promise.all(batch.map(async ({ target, slot }) => {
    const prompt = promptFor(target, slot);
    const alt = buildAlt([target.name, target.facts[0], slot.image_type === "hero" ? "" : slot.angle.toLowerCase()]);
    const base: Row = {
      project_id: projectId, entity_type: target.entity_type, entity_id: target.entity_id,
      image_type: slot.image_type, position: slot.position, width: slot.width, height: slot.height,
      alt, prompt,
    };
    try {
      const b64 = await generateImage(prompt, slot.width, slot.height);
      const url = await uploadBase64(admin, projectId, b64, `${target.entity_type}-${slot.image_type}`);
      generated++;
      return { ...base, image_url: url, source: "ai", status: "ready", error: null };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "generation failed";
      console.error("[media-engine] slot failed:", target.entity_type, target.entity_id, msg);
      // Only hero / cover fall back to a placeholder so a page is never empty.
      if (slot.image_type === "hero" || slot.image_type === "cover") {
        placeholders++;
        return {
          ...base, image_url: placeholderUrl(`${target.entity_type}-${target.entity_id}`, slot.width, slot.height),
          source: "placeholder", status: "ready", error: msg,
        };
      }
      failed++;
      return { ...base, image_url: "", source: "ai", status: "failed", error: msg };
    }
  }));

  const writable = results.filter((r) => t(r.image_url) || r.status === "failed");
  if (writable.length) {
    const { error } = await admin.from("image_assets")
      .upsert(writable.map((r) => ({ ...r, image_url: t(r.image_url) })),
        { onConflict: "project_id,entity_type,entity_id,image_type,position" });
    if (error) throw new HttpError(`Save failed: ${error.message}`, 500);
  }

  return jsonResponse({
    ok: true,
    mode,
    imported,
    generated,
    placeholders,
    failed,
    processed: batch.length,
    remaining: Math.max(0, queue.length - batch.length),
    stats: stats(),
  });
}));
