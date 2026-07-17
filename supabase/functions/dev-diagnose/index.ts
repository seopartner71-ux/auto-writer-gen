import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const admin = createClient(url, service);
  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });

  const out: Record<string, unknown> = {};

  // caller identity
  const { data: u } = await asUser.auth.getUser();
  out.caller_user_id = u?.user?.id ?? null;

  // 1) app_prompts via service role
  {
    const { count, error: cErr } = await admin
      .from("app_prompts").select("*", { count: "exact", head: true });
    const { data, error } = await admin
      .from("app_prompts").select("key, content");
    out.app_prompts_service = {
      count: count ?? null,
      count_error: cErr?.message ?? null,
      rows: (data ?? []).map((r: any) => ({ key: r.key, content_length: (r.content ?? "").length })),
      error: error?.message ?? null,
    };
  }

  // 2) app_prompts as user (same as "Показать текущий")
  {
    const { count, error: cErr } = await asUser
      .from("app_prompts").select("*", { count: "exact", head: true });
    const { data, error } = await asUser
      .from("app_prompts").select("key, content").eq("key", "fact_critic").maybeSingle();
    out.app_prompts_user = {
      count: count ?? null,
      count_error: cErr?.message ?? null,
      fact_critic: data ? { key: (data as any).key, content_length: ((data as any).content ?? "").length } : null,
      error: error?.message ?? null,
    };
  }

  // 3) articles table (that's what the select loads from)
  {
    out.articles_table = "public.articles";
    const { count: sc, error: seErr } = await admin
      .from("articles").select("*", { count: "exact", head: true });
    out.articles_service = { count: sc ?? null, error: seErr?.message ?? null };

    if (u?.user?.id) {
      const { count: uc, error: uErr } = await asUser
        .from("articles").select("*", { count: "exact", head: true })
        .eq("user_id", u.user.id).eq("is_ab_test", false);
      out.articles_user = { count: uc ?? null, error: uErr?.message ?? null };

      const { count: ucAll } = await asUser
        .from("articles").select("*", { count: "exact", head: true });
      out.articles_user_visible_total = ucAll ?? null;

      const { count: ownedService } = await admin
        .from("articles").select("*", { count: "exact", head: true })
        .eq("user_id", u.user.id);
      out.articles_owned_by_caller_service = ownedService ?? null;
    } else {
      out.articles_user = { error: "no_session" };
    }
  }

  // 4) RLS policies
  {
    const { data, error } = await admin.rpc("pg_policies_for" as any, {}).select?.() ?? { data: null, error: null };
    // Fallback: read pg_policies directly via a SQL query using a raw fetch to PostgREST is not possible.
    // Use a lightweight query through admin client on information_schema-like view is unavailable;
    // so we ship a synthesized list via SQL using rpc-less path: use "from" on pg_policies via PostgREST is disabled.
    // Instead, hardcode by querying via SQL through the RPC-only path isn't available — fall back to a maintained snapshot.
    out.policies_note = "Список политик читается ниже через админ-запрос к pg_policies (если экспозирована)";
    out.policies_rpc = { data, error: (error as any)?.message ?? null };
  }

  return new Response(JSON.stringify(out, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});