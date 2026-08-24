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
// REBUILD PLANNING (site_deploy_queue seam)
//
// Pure decision layer: given the pending queue rows for a project, decide
// whether this deploy is a FULL rebuild (render every page) or an INCREMENTAL
// one (re-render only the queued entities). Global artefacts - sitemap.xml,
// robots.txt, llms.txt and the SILO indexes - always regenerate, because they
// depend on the complete page list rather than on the changed subset.
//
// The DB read and the actual incremental render are wired in later (3b); this
// helper is deliberately side-effect free so it can be unit tested.
// ============================================================================

export interface DeployQueueEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  reason?: string | null;
}

export interface RebuildPlan {
  mode: "full" | "incremental";
  /** entity ids to re-render, grouped by entity_type. Empty on a full rebuild. */
  targets: Record<string, string[]>;
  /** Queue rows consumed by this plan; drained after a successful deploy. */
  consumedIds: string[];
  /** Always rebuilt regardless of mode. */
  globalArtifacts: string[];
}

export const GLOBAL_ARTIFACTS = ["sitemap.xml", "robots.txt", "llms.txt"];

export function planRebuild(
  queue: DeployQueueEntry[] | null | undefined,
  opts: { forceFull?: boolean } = {},
): RebuildPlan {
  const rows = (queue || []).filter((r) => r && r.id);
  // Empty queue keeps the historical behaviour: a first deploy of a new site,
  // or any deploy without tracked changes, renders everything.
  if (opts.forceFull || rows.length === 0) {
    return { mode: "full", targets: {}, consumedIds: rows.map((r) => r.id), globalArtifacts: GLOBAL_ARTIFACTS };
  }
  const targets: Record<string, string[]> = {};
  for (const r of rows) {
    // A structural change invalidates page selection itself - fall back to full.
    if (!r.entity_id || r.entity_type === "site" || r.entity_type === "silo") {
      return { mode: "full", targets: {}, consumedIds: rows.map((x) => x.id), globalArtifacts: GLOBAL_ARTIFACTS };
    }
    (targets[r.entity_type] ||= []).push(r.entity_id);
  }
  for (const k of Object.keys(targets)) targets[k] = [...new Set(targets[k])];
  return { mode: "incremental", targets, consumedIds: rows.map((r) => r.id), globalArtifacts: GLOBAL_ARTIFACTS };
}
