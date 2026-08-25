// ============================================================================
// PUBLISH PATH - the part of the deploy that decides WHAT gets shipped and
// pushes it to Cloudflare Pages Direct Upload.
//
// Everything upstream of this module (legacy render, template runtime, SILO,
// commerce, anti-fingerprint, SEO chrome) still lives in index.ts and is
// untouched. This module owns only the tail of the pipeline:
//
//   files -> manifest (blake3 hashes) -> upload-token -> check-missing
//         -> assets/upload -> upsert-hashes -> deployments
//
// It is the single seam where incremental publishing (site_deploy_queue) will
// be wired in: the queue decides which entries of `files` were re-rendered,
// this module already treats `files` as the full snapshot Cloudflare needs.
// ============================================================================

import { hash as blake3 } from "npm:blake3-wasm@2.1.5";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".php": "text/html; charset=utf-8",
};

export function mimeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return MIME[path.slice(dot).toLowerCase()] || "application/octet-stream";
}

export function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

export function toBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Wrangler hash: blake3(base64(content) + extension).slice(0, 32) */
export function hashFile(content: string, path: string): string {
  const b64 = toBase64(content);
  const input = new TextEncoder().encode(b64 + extOf(path));
  const out = blake3(input) as Uint8Array;
  return Array.from(out).map((b: number) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function tryParseJson(
  res: Response,
): Promise<{ ok: boolean; data: any; status: number; text: string }> {
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* ignore */ }
  return { ok: res.ok, data, status: res.status, text };
}

export function cfErr(payload: any, fallback: string, status: number): string {
  if (payload?.errors?.length) return payload.errors.map((e: any) => e.message).join("; ");
  if (payload?.message) return String(payload.message);
  return fallback.trim() || `HTTP ${status}`;
}

/** `{ "/index.html": "<hash>" }` plus a reverse index for the upload step. */
export function buildManifest(files: Record<string, string>): {
  manifest: Record<string, string>;
  fileByHash: Record<string, { path: string; content: string }>;
} {
  const manifest: Record<string, string> = {};
  const fileByHash: Record<string, { path: string; content: string }> = {};
  for (const [path, content] of Object.entries(files)) {
    const h = hashFile(content, path);
    manifest[`/${path}`] = h;
    fileByHash[h] = { path, content };
  }
  return { manifest, fileByHash };
}

export interface PublishInput {
  files: Record<string, string>;
  cfBaseUrl: string;
  cfProjectName: string;
  cfHeadersJson: Record<string, string>;
  apiToken: string;
}

export interface PublishResult {
  ok: boolean;
  /** Human-readable failure reason; only set when ok === false. */
  error?: string;
  deployId?: string | null;
  deployUrl?: string | null;
  manifest?: Record<string, string>;
  uploaded?: number;
  total?: number;
}

/**
 * Ships `files` as one Direct Upload deployment.
 *
 * Cloudflare requires the FULL file manifest on every deployment - a partial
 * manifest deletes the missing paths from the site. Incremental work therefore
 * happens upstream (skip re-rendering unchanged pages), while this function
 * always receives the complete snapshot. Cloudflare itself dedupes the network
 * transfer through check-missing, so unchanged files cost nothing to re-ship.
 */
export async function publishBundle(input: PublishInput): Promise<PublishResult> {
  const { files, cfBaseUrl, cfProjectName, cfHeadersJson, apiToken } = input;

  const { manifest, fileByHash } = buildManifest(files);
  console.log("[publish] manifest files:", Object.keys(manifest).length);

  // 1. Upload JWT
  const tokenRes = await fetch(`${cfBaseUrl}/${cfProjectName}/upload-token`, { headers: cfHeadersJson });
  const tokenParsed = await tryParseJson(tokenRes);
  console.log("[publish] upload-token status:", tokenParsed.status, "hasJwt:", !!tokenParsed.data?.result?.jwt);
  if (!tokenParsed.ok || !tokenParsed.data?.result?.jwt) {
    return { ok: false, error: `upload-token failed: ${cfErr(tokenParsed.data, tokenParsed.text, tokenParsed.status)}` };
  }
  const jwt: string = tokenParsed.data.result.jwt;
  const assetsHeaders = { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };

  // 2. check-missing
  const allHashes = Object.values(manifest);
  const checkRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/check-missing", {
    method: "POST",
    headers: assetsHeaders,
    body: JSON.stringify({ hashes: allHashes }),
  });
  const checkParsed = await tryParseJson(checkRes);
  console.log("[publish] check-missing status:", checkParsed.status, "missing:", checkParsed.data?.result?.length);
  if (!checkParsed.ok) {
    return { ok: false, error: `check-missing failed: ${cfErr(checkParsed.data, checkParsed.text, checkParsed.status)}` };
  }
  const missing: string[] = checkParsed.data?.result || allHashes;

  // 3. upload missing files
  if (missing.length > 0) {
    const payload = missing.map((h) => {
      const f = fileByHash[h];
      return { key: h, value: toBase64(f.content), metadata: { contentType: mimeOf(f.path) }, base64: true };
    });
    const upRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upload", {
      method: "POST",
      headers: assetsHeaders,
      body: JSON.stringify(payload),
    });
    const upParsed = await tryParseJson(upRes);
    console.log("[publish] assets/upload status:", upParsed.status, "ok:", upParsed.ok);
    if (!upParsed.ok) {
      console.log("[publish] upload err body:", upParsed.text.slice(0, 500));
      return { ok: false, error: `assets/upload failed: ${cfErr(upParsed.data, upParsed.text, upParsed.status)}` };
    }
  }

  // 4. upsert-hashes (registers all hashes for this deployment)
  const upsertRes = await fetch("https://api.cloudflare.com/client/v4/pages/assets/upsert-hashes", {
    method: "POST",
    headers: assetsHeaders,
    body: JSON.stringify({ hashes: allHashes }),
  });
  const upsertParsed = await tryParseJson(upsertRes);
  console.log("[publish] upsert-hashes status:", upsertParsed.status, "ok:", upsertParsed.ok);
  if (!upsertParsed.ok) {
    console.warn("[publish] upsert-hashes failed (continuing):", cfErr(upsertParsed.data, upsertParsed.text, upsertParsed.status));
  }

  // 5. Create deployment
  const fd = new FormData();
  fd.append("manifest", JSON.stringify(manifest));
  fd.append("branch", "main");
  const deployRes = await fetch(`${cfBaseUrl}/${cfProjectName}/deployments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` }, // let runtime set multipart boundary
    body: fd,
  });
  const deployParsed = await tryParseJson(deployRes);
  console.log("[publish] deployments status:", deployParsed.status, "ok:", deployParsed.ok);
  if (!deployParsed.ok) {
    console.log("[publish] deploy err body:", deployParsed.text.slice(0, 500));
    return { ok: false, error: `deployments failed: ${cfErr(deployParsed.data, deployParsed.text, deployParsed.status)}` };
  }

  return {
    ok: true,
    manifest,
    deployId: deployParsed.data?.result?.id || null,
    deployUrl: deployParsed.data?.result?.url || null,
    uploaded: missing.length,
    total: allHashes.length,
  };
}

// ============================================================================
// REBUILD PLANNING (Part 3b)
//
// Pure decision layer. Inputs:
//   - the pending site_deploy_queue rows for the project,
//   - the last cached snapshot (page_hashes + shared_hash) from 3a,
//   - the CURRENT shared_hash,
//   - the project's current page list (page_registry.url_path - the registry is
//     the source of truth for "which pages this site has").
//
// Output: a plan describing WHICH pages must be re-rendered and which can be
// taken verbatim from the cached snapshot. This function never renders and
// never publishes - executing the plan is 3c.
//
// Global artefacts - sitemap.xml, robots.txt, llms.txt - always regenerate,
// because they depend on the complete page list rather than on the diff.
// ============================================================================

import { validateBundleAgainstShared } from "./bundleCache.ts";

export interface DeployQueueEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  reason?: string | null;
}

/** One page as the registry knows it today. */
export interface RegistryPage {
  entity_type?: string | null;
  entity_id?: string | null;
  url_path: string;
}

export interface CachedPlanInput {
  page_hashes: Record<string, string>;
  shared_hash?: string | null;
}

export interface PlanRebuildInput {
  queue?: DeployQueueEntry[] | null;
  /** Snapshot from 3a (loadBundle). null / undefined => no previous bundle. */
  cached?: CachedPlanInput | null;
  currentSharedHash?: string | null;
  /** page_registry rows for the project (current structure). */
  registryPages?: RegistryPage[] | null;
  forceFull?: boolean;
}

export interface RebuildPlan {
  mode: "full" | "incremental";
  /** Why this mode was chosen (validateBundleAgainstShared reason or similar). */
  reason: string;
  /** Normalised page keys that must be re-rendered. */
  pages_to_rebuild: string[];
  /** Pages reusable from the snapshot, with their cached page_hash. */
  pages_from_cache: Array<{ path: string; page_hash: string }>;
  /** entity ids to re-render, grouped by entity_type. Empty on a full rebuild. */
  targets: Record<string, string[]>;
  /** Queue rows consumed by this plan; drained after a successful deploy. */
  consumedIds: string[];
  /** Always rebuilt regardless of mode. */
  globalArtifacts: string[];
}

export const GLOBAL_ARTIFACTS = ["sitemap.xml", "robots.txt", "llms.txt"];

/**
 * "/about.html", "about.html", "/about/" and "/about" are the same page;
 * the home page is the empty key "".
 */
export function normalizePagePath(p: string): string {
  let s = String(p || "").trim();
  s = s.replace(/^\.?\//, "").replace(/\.html$/i, "").replace(/\/+$/, "");
  if (s === "index" || s === "") return "";
  return s.replace(/\/index$/i, "");
}

function isPageFile(path: string): boolean {
  if (!/\.html?$/i.test(path)) return false;
  return !GLOBAL_ARTIFACTS.includes(path.replace(/^\//, ""));
}

function fullPlan(reason: string, rows: DeployQueueEntry[]): RebuildPlan {
  return {
    mode: "full",
    reason,
    pages_to_rebuild: [],
    pages_from_cache: [],
    targets: {},
    consumedIds: rows.map((r) => r.id),
    globalArtifacts: GLOBAL_ARTIFACTS,
  };
}

export function planRebuild(
  input?: PlanRebuildInput | DeployQueueEntry[] | null,
  opts: { forceFull?: boolean } = {},
): RebuildPlan {
  const inp: PlanRebuildInput = Array.isArray(input) ? { queue: input } : (input || {});
  const rows = (inp.queue || []).filter((r) => r && r.id);
  const forceFull = inp.forceFull ?? opts.forceFull;

  if (forceFull) return fullPlan("force full rebuild", rows);

  // (a) no previous snapshot -> nothing to reuse.
  const cached = inp.cached;
  if (!cached || !cached.page_hashes) return fullPlan("no previous bundle", rows);

  // (b) shared layer verdict decides whether the snapshot is logically usable.
  const verdict = validateBundleAgainstShared(String(inp.currentSharedHash ?? ""), cached.shared_hash);
  if (!verdict.valid) return fullPlan(verdict.reason, rows);

  // Structural queue entries invalidate page selection itself.
  for (const r of rows) {
    if (!r.entity_id || r.entity_type === "site" || r.entity_type === "silo") {
      return fullPlan(`structural change: ${r.entity_type}`, rows);
    }
  }

  // (c) queued entities -> rebuild; everything else in the snapshot -> cache.
  const targets: Record<string, string[]> = {};
  for (const r of rows) (targets[r.entity_type] ||= []).push(r.entity_id as string);
  for (const k of Object.keys(targets)) targets[k] = [...new Set(targets[k])];

  const registry = (inp.registryPages || []).filter((p) => p && p.url_path);
  const queuedEntityIds = new Set(rows.map((r) => `${r.entity_type}:${r.entity_id}`));

  const cachedPages = new Map<string, string>();
  for (const [path, hash] of Object.entries(cached.page_hashes)) {
    if (isPageFile(path)) cachedPages.set(normalizePagePath(path), hash);
  }

  const toRebuild = new Set<string>();
  for (const p of registry) {
    const key = normalizePagePath(p.url_path);
    const queued = queuedEntityIds.has(`${p.entity_type}:${p.entity_id}`);
    // (d) A page present in the registry but absent from the last snapshot is
    // new (added outside the change-tracking flow) and must be rendered even
    // without a queue row.
    if (queued || !cachedPages.has(key)) toRebuild.add(key);
  }
  // Queue rows whose entity has no registry page yet (registry read failed or
  // page not registered) still force a rebuild of the whole set they belong to.
  const unmapped = rows.filter((r) =>
    !registry.some((p) => `${p.entity_type}:${p.entity_id}` === `${r.entity_type}:${r.entity_id}`)
  );
  if (registry.length === 0 && rows.length > 0) return fullPlan("no registry pages to map queue onto", rows);
  if (unmapped.length > 0) return fullPlan("queued entity missing from page registry", rows);

  const pages_from_cache = [...cachedPages.entries()]
    .filter(([key]) => !toRebuild.has(key))
    .map(([path, page_hash]) => ({ path, page_hash }));

  return {
    mode: "incremental",
    reason: verdict.reason,
    pages_to_rebuild: [...toRebuild].sort(),
    pages_from_cache,
    targets,
    consumedIds: rows.map((r) => r.id),
    globalArtifacts: GLOBAL_ARTIFACTS,
  };
}

