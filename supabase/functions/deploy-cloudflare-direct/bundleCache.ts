// ============================================================================
// BUNDLE CACHE (step 3a of the incremental-rebuild refactor)
//
// After every successful Cloudflare deployment we persist the FULL rendered
// snapshot of the site to private Storage (`site-bundles/<projectId>.json.gz`).
// Step 3b reads that snapshot so a deploy can re-render only the pages listed
// in `site_deploy_queue` and take everything else verbatim from the cache,
// while still shipping the complete manifest Cloudflare requires.
//
// HASHING MODEL (two independent levels - required by 3b):
//
//   page_hash   - hash of ONE rendered page (path + its exact bytes).
//                 Changes only when that page's own output changes.
//   shared_hash - hash of the SHARED render layer: template engine version,
//                 seoChrome/metaTitles/schema generator versions, template id,
//                 engine mode, canonical domain, accent, font pair.
//                 Changes when something global to every page changes.
//
// The two are isolated by construction: page_hash never ingests shared inputs
// and shared_hash never ingests page bytes. A content edit on one page moves
// exactly one page_hash; a shared-layer change moves shared_hash and leaves
// every page_hash untouched (but invalidates the bundle wholesale).
//
// The cache is strictly an optimisation: any read error, version mismatch or
// missing object simply degrades to a full rebuild.
// ============================================================================

export const BUNDLE_BUCKET = "site-bundles";
export const BUNDLE_VERSION = 2;

/**
 * Bump whenever the shared render layer changes in a way that alters output
 * for every page (templateEngine.ts, seoChrome.ts, metaTitles.ts, schema
 * generation, shared components). This is the manual half of shared_hash.
 */
export const SHARED_LAYER_VERSION = "2026-08-25.1";

export interface CachedBundle {
  version: number;
  project_id: string;
  saved_at: string;
  /** Full page snapshot: path -> file content. */
  files: Record<string, string>;
  /** path -> page_hash (per-page isolation for incremental rebuilds). */
  page_hashes: Record<string, string>;
  /** Hash of the shared render layer; invalidates the whole bundle. */
  shared_hash: string;
  /** Hash of the whole shipped snapshot (page hashes + shared hash). */
  build_hash: string;
  /** @deprecated kept for v1 readers; equals shared_hash. */
  fingerprint: string;
}

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      upload: (path: string, body: Blob | Uint8Array, opts?: Record<string, unknown>) => Promise<{ error: unknown }>;
      download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
      remove: (paths: string[]) => Promise<{ error: unknown }>;
    };
  };
};

export function bundlePath(projectId: string): string {
  return `${projectId}/bundle.json.gz`;
}

/** FNV-1a 64-bit, hex. Deterministic, dependency-free, non-cryptographic. */
function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (let i = 0; i < bytes.length; i++) {
    h ^= BigInt(bytes[i]);
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

/** Hash of a single rendered page. Shared inputs are deliberately excluded. */
export function computePageHash(path: string, content: string): string {
  return fnv1a64(`${path}\u0000${content}`);
}

export function computePageHashes(files: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) out[path] = computePageHash(path, content);
  return out;
}

export interface SharedLayerInput {
  /** Version marker of the shared render modules (see SHARED_LAYER_VERSION). */
  layer_version?: string;
  template?: string;
  engine?: string;
  site_template_id?: string;
  domain?: string;
  accent?: string;
  fonts?: string;
  /** Optional extra shared-layer markers (module versions, feature flags). */
  [k: string]: unknown;
}

/**
 * Hash of everything shared by all pages. Page bytes never enter here, so a
 * single-page edit can never move shared_hash.
 */
export function computeSharedHash(parts: SharedLayerInput): string {
  const merged: Record<string, unknown> = { layer_version: SHARED_LAYER_VERSION, ...parts };
  const keys = Object.keys(merged).sort();
  return fnv1a64(keys.map((k) => `${k}=${String(merged[k] ?? "")}`).join("|"));
}

/** Hash of the whole shipped snapshot: shared layer + every page hash. */
export function computeBuildHash(sharedHash: string, pageHashes: Record<string, string>): string {
  const paths = Object.keys(pageHashes).sort();
  return fnv1a64(`${sharedHash}|` + paths.map((p) => `${p}:${pageHashes[p]}`).join("|"));
}

/** @deprecated v1 name; now an alias of computeSharedHash. */
export function bundleFingerprint(parts: Record<string, unknown>): string {
  return computeSharedHash(parts as SharedLayerInput);
}

// ── Logical invalidation ────────────────────────────────────────────────────
// This is NOT the infrastructural fallback (missing/corrupt object -> full
// rebuild). It answers a single question: is a cached bundle still logically
// usable given the CURRENT shared layer?

export interface BundleValidity {
  valid: boolean;
  reason: string;
  action: "full rebuild required" | "incremental rebuild allowed";
}

export function validateBundleAgainstShared(
  currentSharedHash: string,
  lastSharedHash: string | null | undefined,
): BundleValidity {
  if (!lastSharedHash) {
    return { valid: false, reason: "no previous shared hash", action: "full rebuild required" };
  }
  if (currentSharedHash !== lastSharedHash) {
    return { valid: false, reason: "shared layer changed", action: "full rebuild required" };
  }
  return { valid: true, reason: "bundle valid", action: "incremental rebuild allowed" };
}

/** Never throws - caching failures must not break a deploy. */
export async function saveBundle(
  client: StorageClient,
  projectId: string,
  files: Record<string, string>,
  sharedHash: string,
): Promise<{ ok: boolean; build_hash: string; shared_hash: string; page_hashes: Record<string, string> }> {
  const page_hashes = computePageHashes(files);
  const build_hash = computeBuildHash(sharedHash, page_hashes);
  try {
    const payload: CachedBundle = {
      version: BUNDLE_VERSION,
      project_id: projectId,
      saved_at: new Date().toISOString(),
      files,
      page_hashes,
      shared_hash: sharedHash,
      build_hash,
      fingerprint: sharedHash,
    };
    const body = await gzip(JSON.stringify(payload));
    const { error } = await client.storage.from(BUNDLE_BUCKET).upload(bundlePath(projectId), body, {
      contentType: "application/gzip",
      upsert: true,
    });
    if (error) {
      console.warn("[bundle-cache] save failed:", (error as { message?: string })?.message);
      return { ok: false, build_hash, shared_hash: sharedHash, page_hashes };
    }
    console.log("[bundle-cache] saved", Object.keys(files).length, "files for", projectId, "build", build_hash);
    return { ok: true, build_hash, shared_hash: sharedHash, page_hashes };
  } catch (e) {
    console.warn("[bundle-cache] save skipped:", (e as Error).message);
    return { ok: false, build_hash, shared_hash: sharedHash, page_hashes };
  }
}

/** Returns null when there is no usable cache (missing, corrupt, stale). */
export async function loadBundle(
  client: StorageClient,
  projectId: string,
  currentSharedHash: string,
): Promise<CachedBundle | null> {
  try {
    const { data, error } = await client.storage.from(BUNDLE_BUCKET).download(bundlePath(projectId));
    if (error || !data) return null;
    const parsed = JSON.parse(await gunzip(data)) as CachedBundle;
    if (parsed?.version !== BUNDLE_VERSION) return null;
    const verdict = validateBundleAgainstShared(currentSharedHash, parsed.shared_hash ?? parsed.fingerprint);
    if (!verdict.valid) {
      console.log("[bundle-cache]", verdict.reason, "->", verdict.action);
      return null;
    }
    if (!parsed.files || typeof parsed.files !== "object") return null;
    if (!parsed.page_hashes) parsed.page_hashes = computePageHashes(parsed.files);
    console.log("[bundle-cache] loaded", Object.keys(parsed.files).length, "files for", projectId);
    return parsed;
  } catch (e) {
    console.warn("[bundle-cache] load skipped:", (e as Error).message);
    return null;
  }
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(text)]).stream()
    .pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(blob: Blob): Promise<string> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
