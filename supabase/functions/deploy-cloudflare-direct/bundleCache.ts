// ============================================================================
// BUNDLE CACHE (step 3a of the incremental-rebuild refactor)
//
// After every successful Cloudflare deployment we persist the FULL rendered
// snapshot of the site to private Storage (`site-bundles/<projectId>.json.gz`).
// Step 3b reads that snapshot so a deploy can re-render only the pages listed
// in `site_deploy_queue` and take everything else verbatim from the cache,
// while still shipping the complete manifest Cloudflare requires.
//
// The cache is strictly an optimisation: any read error, version mismatch or
// missing object simply degrades to a full rebuild.
// ============================================================================

export const BUNDLE_BUCKET = "site-bundles";
export const BUNDLE_VERSION = 1;

export interface CachedBundle {
  version: number;
  project_id: string;
  saved_at: string;
  /** Full page snapshot: path -> file content. */
  files: Record<string, string>;
  /** Inputs that invalidate the whole cache when they change. */
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

/** Cheap stable fingerprint of the render inputs (template, domain, theme...). */
export function bundleFingerprint(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  return keys.map((k) => `${k}=${String(parts[k] ?? "")}`).join("|");
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

/** Never throws - caching failures must not break a deploy. */
export async function saveBundle(
  client: StorageClient,
  projectId: string,
  files: Record<string, string>,
  fingerprint: string,
): Promise<boolean> {
  try {
    const payload: CachedBundle = {
      version: BUNDLE_VERSION,
      project_id: projectId,
      saved_at: new Date().toISOString(),
      files,
      fingerprint,
    };
    const body = await gzip(JSON.stringify(payload));
    const { error } = await client.storage.from(BUNDLE_BUCKET).upload(bundlePath(projectId), body, {
      contentType: "application/gzip",
      upsert: true,
    });
    if (error) {
      console.warn("[bundle-cache] save failed:", (error as { message?: string })?.message);
      return false;
    }
    console.log("[bundle-cache] saved", Object.keys(files).length, "files for", projectId);
    return true;
  } catch (e) {
    console.warn("[bundle-cache] save skipped:", (e as Error).message);
    return false;
  }
}

/** Returns null when there is no usable cache (missing, corrupt, stale). */
export async function loadBundle(
  client: StorageClient,
  projectId: string,
  fingerprint: string,
): Promise<CachedBundle | null> {
  try {
    const { data, error } = await client.storage.from(BUNDLE_BUCKET).download(bundlePath(projectId));
    if (error || !data) return null;
    const parsed = JSON.parse(await gunzip(data)) as CachedBundle;
    if (parsed?.version !== BUNDLE_VERSION) return null;
    if (parsed.fingerprint !== fingerprint) {
      console.log("[bundle-cache] fingerprint changed -> full rebuild");
      return null;
    }
    if (!parsed.files || typeof parsed.files !== "object") return null;
    console.log("[bundle-cache] loaded", Object.keys(parsed.files).length, "files for", projectId);
    return parsed;
  } catch (e) {
    console.warn("[bundle-cache] load skipped:", (e as Error).message);
    return null;
  }
}
