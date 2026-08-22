// ============================================================================
// P20 - MEDIA ENGINE / shared asset layer
//
//   image_assets  ->  [loadMedia]  ->  Visual Renderer / Build
//
// Pure read helpers. The renderer never generates images: it only consumes
// what the Media Engine already stored. Real client / supplier photos always
// win over AI, AI wins over placeholder.
// ============================================================================

export type MediaEntityType = "product" | "category" | "article" | "hub" | "home" | "service";
export type MediaImageType = "hero" | "gallery" | "cover" | "inline";
export type MediaSource = "upload" | "xml" | "api" | "ai" | "placeholder";

export interface MediaAssetRow {
  id?: string;
  entity_type: string;
  entity_id: string | null;
  image_type: string;
  image_url: string;
  alt: string;
  source: string;
  status: string;
  position?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface MediaImage {
  url: string;
  alt: string;
  source: string;
  type: string;
}

export interface EntityMedia {
  hero?: MediaImage;
  cover?: MediaImage;
  gallery: MediaImage[];
  inline: MediaImage[];
  all: MediaImage[];
  hasPlaceholder: boolean;
}

const t = (v: unknown) => String(v ?? "").trim();

export const mediaKey = (entityType: string, entityId: string) => `${t(entityType)}:${t(entityId)}`;

/** Groups ready image_assets rows by entity. Failed / pending rows are ignored. */
export function groupMedia(rows: MediaAssetRow[]): Map<string, EntityMedia> {
  const map = new Map<string, EntityMedia>();
  const ordered = [...rows].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  for (const r of ordered) {
    if (t(r.status) !== "ready" || !t(r.image_url)) continue;
    const key = mediaKey(r.entity_type, t(r.entity_id));
    const bucket = map.get(key) || { gallery: [], inline: [], all: [], hasPlaceholder: false };
    const img: MediaImage = { url: t(r.image_url), alt: t(r.alt), source: t(r.source), type: t(r.image_type) };
    if (img.source === "placeholder") bucket.hasPlaceholder = true;
    if (img.type === "hero" && !bucket.hero) bucket.hero = img;
    else if (img.type === "cover" && !bucket.cover) bucket.cover = img;
    else if (img.type === "inline") bucket.inline.push(img);
    else bucket.gallery.push(img);
    bucket.all.push(img);
    map.set(key, bucket);
  }
  return map;
}

/** Loads every ready asset of a project, grouped by `entity_type:entity_id`. */
export async function loadMedia(
  admin: { from: (t: string) => any },
  projectId: string,
): Promise<Map<string, EntityMedia>> {
  const { data } = await admin.from("image_assets")
    .select("entity_type, entity_id, image_type, image_url, alt, source, status, position")
    .eq("project_id", projectId).eq("status", "ready").limit(20000);
  return groupMedia(((data || []) as MediaAssetRow[]));
}

/** Hero first, then gallery - the order the renderer expects in page.images. */
export function mediaUrls(m?: EntityMedia): string[] {
  if (!m) return [];
  const list = [m.hero, m.cover, ...m.gallery].filter(Boolean) as MediaImage[];
  const seen = new Set<string>();
  return list.map((x) => x.url).filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
}

/** Real photos always win: media assets are appended after existing ones. */
export function mergeImages(existing: unknown, m?: EntityMedia): string[] {
  const own = Array.isArray(existing) ? (existing as unknown[]).map(t).filter(Boolean) : [];
  const seen = new Set(own);
  const extra = mediaUrls(m).filter((u) => (seen.has(u) ? false : (seen.add(u), true)));
  return [...own, ...extra];
}

/**
 * Factual ALT text. Built only from data that exists on the entity -
 * никаких выдуманных размеров, цветов и материалов.
 */
export function buildAlt(parts: (string | null | undefined)[], max = 120): string {
  const clean = parts.map(t).filter(Boolean);
  const seen = new Set<string>();
  const uniq = clean.filter((p) => {
    const k = p.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const out = uniq.join(" ").replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}` : out;
}

/** Deterministic neutral placeholder - marked in QA and blocked in production. */
export function placeholderUrl(seed: string, width: number, height: number): string {
  const s = encodeURIComponent(t(seed).slice(0, 40) || "media");
  return `https://picsum.photos/seed/${s}/${width}/${height}`;
}
