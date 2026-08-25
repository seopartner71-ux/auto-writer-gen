// Part 3d - render gate.
//
// Until 3c the deploy rendered every page of the project and only THEN asked
// planRebuild what actually changed: the cache saved uploads, never render
// time, so a 500-page site still had to render 500 pages inside one edge
// function invocation. 3d moves the decision in front of the renderer.
//
// The renderer inside index.ts is a monolith with one loop per page family
// (posts in the dark/local/expert/minimal branch, news, magazine, template
// runtime, commerce catalog, filter pages, silo pages). Instead of rewriting
// those branches, every single-page render call is funnelled through
// `gate.renderPage(pathKey, () => <the exact same call as before>)`.
//
// - full mode              -> the callback always runs; byte-identical output
// - incremental mode       -> the callback runs ONLY for pages the plan marked
//                             for rebuild; cached pages are skipped entirely
//                             (no HTML generated at all) and executePlan later
//                             fills them in from the stored bundle
//
// The gate holds no render logic of its own and never rewrites HTML. Shared
// context (chrome, template, images, accent) stays prepared once per deploy
// upstream of the gate - the gate only decides whether a page body is built.

import { normalizePagePath, GLOBAL_ARTIFACTS } from "./publish.ts";

export interface RenderPlanView {
  mode: "full" | "incremental";
  pages_to_rebuild: string[];
  pages_from_cache: Array<{ path: string; page_hash: string }>;
}

export interface RenderGateOptions {
  /**
   * The previously published bundle. When provided, a page is only skipped if
   * its HTML is genuinely available there - a plan that points at a page the
   * bundle does not hold degrades to rendering it, never to a missing page.
   */
  cachedFiles?: Record<string, string> | null;
}

export interface RenderGateStats {
  mode: "full" | "incremental";
  planned_pages: number;
  render_invocations: number;
  rendered: number;
  skipped: number;
  skipped_paths: string[];
  rendered_paths: string[];
}

export interface RenderGate {
  readonly mode: "full" | "incremental";
  /** True when this page must be generated in this deploy. */
  shouldRender(pathKey: string): boolean;
  /**
   * Runs `render` only when the page is due for a rebuild and returns its
   * result; returns null when the page is served from the cached bundle.
   */
  renderPage<T>(pathKey: string, render: () => T): T | null;
  /** Same as renderPage, for renderers that must await (dynamic imports, AI). */
  renderPageAsync<T>(pathKey: string, render: () => Promise<T>): Promise<T | null>;
  stats(): RenderGateStats;
}

/**
 * Builds the gate for one deploy. A null plan (planning failed, build_only,
 * first deploy) yields a permissive gate that renders everything, so any
 * failure in the planning layer can only cost time, never correctness.
 */
export function createRenderGate(
  plan: RenderPlanView | null,
  opts: RenderGateOptions = {},
): RenderGate {
  const cachedFiles = opts.cachedFiles || null;
  const incremental = !!plan && plan.mode === "incremental";

  // Pages the plan says can be reused, keyed by their normalized path.
  const reusable = new Set<string>();
  if (incremental && plan) {
    const cachedKeys = cachedFiles
      ? new Set(Object.keys(cachedFiles).map((p) => normalizePagePath(p)))
      : null;
    const rebuild = new Set(plan.pages_to_rebuild.map((p) => normalizePagePath(p)));
    for (const entry of plan.pages_from_cache) {
      const key = normalizePagePath(entry.path);
      if (rebuild.has(key)) continue;                       // rebuild always wins
      if (cachedKeys && !cachedKeys.has(key)) continue;     // not really in the bundle
      reusable.add(key);
    }
  }

  const globals = new Set(GLOBAL_ARTIFACTS.map((g) => normalizePagePath(g)));
  const renderedPaths: string[] = [];
  const skippedPaths: string[] = [];

  function shouldRender(pathKey: string): boolean {
    if (!incremental) return true;
    const key = normalizePagePath(pathKey);
    if (globals.has(key)) return true; // sitemap/robots/llms are always rebuilt
    return !reusable.has(key);
  }

  function mark(pathKey: string, rendered: boolean) {
    (rendered ? renderedPaths : skippedPaths).push(pathKey);
  }

  return {
    mode: incremental ? "incremental" : "full",
    shouldRender,
    renderPage<T>(pathKey: string, render: () => T): T | null {
      if (!shouldRender(pathKey)) {
        mark(pathKey, false);
        return null;
      }
      mark(pathKey, true);
      return render();
    },
    async renderPageAsync<T>(pathKey: string, render: () => Promise<T>): Promise<T | null> {
      if (!shouldRender(pathKey)) {
        mark(pathKey, false);
        return null;
      }
      mark(pathKey, true);
      return await render();
    },
    stats(): RenderGateStats {
      return {
        mode: incremental ? "incremental" : "full",
        planned_pages: incremental && plan ? plan.pages_to_rebuild.length : renderedPaths.length,
        render_invocations: renderedPaths.length,
        rendered: renderedPaths.length,
        skipped: skippedPaths.length,
        skipped_paths: skippedPaths.slice(0, 50),
        rendered_paths: renderedPaths.slice(0, 50),
      };
    },
  };
}
