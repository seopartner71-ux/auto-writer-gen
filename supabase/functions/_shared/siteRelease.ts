// ============================================================================
// SITE RELEASES - single writer contract (Part 3c)
//
// Two callers can finish a deploy: `deployment-engine` (orchestrated deploy,
// P21 Release Manager) and `deploy-cloudflare-direct` (direct deploy invoked
// from the UI). Both must end up with exactly ONE site_releases row per deploy
// and with projects.last_release_id pointing at it.
//
// Contract:
//   - deployment-engine passes `skip_release: true` when it invokes the deploy
//     function, then records the release itself once the deploy returns.
//   - deploy-cloudflare-direct records the release only when that flag is
//     absent (i.e. it was called directly).
//   - both go through recordRelease(), so the version sequence, the is_current
//     flip and last_release_id stay consistent no matter who writes.
// ============================================================================

type Sb = {
  from: (t: string) => any;
};

export function nextReleaseVersion(last: string | null | undefined): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(last || ""));
  if (!m) return "v1.0.0";
  return `v${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export interface RecordReleaseArgs {
  projectId: string;
  userId: string;
  provider: string;
  url?: string | null;
  pages: number;
  deploymentId?: string | null;
  buildHash?: string | null;
  launchReport?: unknown;
}

/**
 * Insert one release row, flip is_current and store its id on the project.
 * Never throws - a release row must not break a successful deploy.
 */
export async function recordRelease(
  sb: Sb,
  args: RecordReleaseArgs,
): Promise<Record<string, unknown> | null> {
  try {
    const { data: last } = await sb.from("site_releases").select("version")
      .eq("project_id", args.projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const version = nextReleaseVersion((last as { version?: string } | null)?.version);

    await sb.from("site_releases").update({ is_current: false })
      .eq("project_id", args.projectId).eq("is_current", true);

    const { data } = await sb.from("site_releases").insert({
      project_id: args.projectId,
      user_id: args.userId,
      version,
      build_hash: args.buildHash ?? null,
      provider: args.provider,
      pages: args.pages,
      published_url: args.url || null,
      status: args.url ? "published" : "draft",
      is_current: !!args.url,
      deployment_id: args.deploymentId ?? null,
      launch_report: (args.launchReport as Record<string, unknown>) || null,
    }).select("*").maybeSingle();

    const row = (data as Record<string, unknown>) || null;
    if (row?.id) {
      await sb.from("projects").update({ last_release_id: row.id }).eq("id", args.projectId);
    }
    return row;
  } catch {
    return null;
  }
}
