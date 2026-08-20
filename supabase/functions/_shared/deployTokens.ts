// Shared resolver for deploy tokens (GitHub / Vercel).
// Order: project token -> user's other projects -> user's ecosystem clients -> shared env secret.

type Resolved = { token: string; source: string } | null;

async function tryDecrypt(supabaseAdmin: any, value: string | null | undefined): Promise<string> {
  const raw = (value || "").trim();
  if (!raw) return "";
  // Plain PAT / token formats are used as is.
  if (/^(gh[pousr]_|github_pat_)/.test(raw) || /^[A-Za-z0-9_-]{20,60}$/.test(raw)) return raw;
  try {
    const { data, error } = await supabaseAdmin.rpc("decrypt_sensitive", { ciphertext: raw });
    if (!error && typeof data === "string" && data.trim()) return data.trim();
  } catch { /* ignore */ }
  return raw;
}

export async function resolveGithubToken(
  supabaseAdmin: any,
  project: { id: string; user_id?: string | null; github_token?: string | null },
): Promise<Resolved> {
  const own = await tryDecrypt(supabaseAdmin, project.github_token);
  if (own) return { token: own, source: "project" };

  const userId = project.user_id;
  if (userId) {
    const { data: others } = await supabaseAdmin
      .from("projects")
      .select("github_token")
      .eq("user_id", userId)
      .not("github_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const row of others || []) {
      const t = await tryDecrypt(supabaseAdmin, row.github_token);
      if (t) return { token: t, source: "user_projects" };
    }

    const { data: clients } = await supabaseAdmin
      .from("clients")
      .select("github_token_encrypted")
      .eq("user_id", userId)
      .not("github_token_encrypted", "is", null)
      .limit(5);
    for (const row of clients || []) {
      const t = await tryDecrypt(supabaseAdmin, row.github_token_encrypted);
      if (t) return { token: t, source: "ecosystem_client" };
    }
  }

  const shared = (Deno.env.get("GITHUB_PAT") || Deno.env.get("GITHUB_TOKEN") || "").trim();
  if (shared) return { token: shared, source: "shared" };
  return null;
}

export async function resolveVercelToken(
  supabaseAdmin: any,
  project: { id: string; user_id?: string | null; vercel_token?: string | null },
): Promise<Resolved> {
  const own = await tryDecrypt(supabaseAdmin, project.vercel_token);
  if (own) return { token: own, source: "project" };

  const userId = project.user_id;
  if (userId) {
    const { data: others } = await supabaseAdmin
      .from("projects")
      .select("vercel_token")
      .eq("user_id", userId)
      .not("vercel_token", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5);
    for (const row of others || []) {
      const t = await tryDecrypt(supabaseAdmin, row.vercel_token);
      if (t) return { token: t, source: "user_projects" };
    }
  }

  const shared = (Deno.env.get("VERCEL_API_TOKEN") || "").trim();
  if (shared) return { token: shared, source: "shared" };
  return null;
}
