// rewrite-start: entry-point for the /rewrite feature.
//
// Body: {
//   article_id?: string,   // existing draft (optional; if absent, we create one)
//   content: string,       // raw HTML or Markdown pasted by the user
//   language: "ru" | "en",
//   main_keyword: string,
//   source_url?: string,
//   title?: string,
// }
//
// Behaviour:
//   1. Verifies auth.
//   2. Ensures the draft article exists (source='rewrite', humanize_profile='conservative').
//   3. Computes credit cost: max(5, ceil(chars / 1500)).
//   4. Deducts credits (admins bypass). Records charged amount in
//      articles.quality_details.rewrite so cycle-finalizer can refund on failure.
//   5. Fires improve-article with cycle=true — actual work happens in background.
//   6. Client polls articles.quality_details.cycle_progress for progress.

import { verifyAuth, adminClient } from "../_shared/auth.ts";
import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";

function computeCost(chars: number): number {
  return Math.max(5, Math.ceil(chars / 1500));
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const auth = await verifyAuth(req);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    const body = await req.json().catch(() => ({}));
    const {
      article_id: incomingId,
      content,
      language,
      main_keyword,
      source_url,
      title,
    } = body as {
      article_id?: string;
      content?: string;
      language?: string;
      main_keyword?: string;
      source_url?: string;
      title?: string;
    };

    if (!content || typeof content !== "string" || content.trim().length < 200) {
      return errorResponse("content_too_short", 400);
    }
    if (content.length > 60_000) return errorResponse("content_too_long", 400);
    if (!main_keyword || typeof main_keyword !== "string" || !main_keyword.trim()) {
      return errorResponse("main_keyword required", 400);
    }
    const lang: "ru" | "en" = language === "en" ? "en" : "ru";
    const chars = content.length;
    const cost = computeCost(chars);

    const admin = adminClient();

    // Ensure/create draft article.
    let articleId = incomingId || null;
    if (articleId) {
      const { data: existing } = await admin
        .from("articles")
        .select("id, user_id, source")
        .eq("id", articleId)
        .maybeSingle();
      if (!existing || existing.user_id !== userId) {
        return errorResponse("article_not_found", 404);
      }
      // Ensure it is flagged as a rewrite target.
      await admin
        .from("articles")
        .update({
          source: "rewrite",
          humanize_profile: "conservative",
          language: lang,
          main_keyword: main_keyword.trim(),
          source_url: source_url || null,
          content,
        })
        .eq("id", articleId);
    } else {
      const derivedTitle = (title && title.trim()) || main_keyword.trim().slice(0, 200);
      const { data: created, error: createErr } = await admin
        .from("articles")
        .insert({
          user_id: userId,
          title: derivedTitle,
          content,
          language: lang,
          source: "rewrite",
          humanize_profile: "conservative",
          main_keyword: main_keyword.trim(),
          source_url: source_url || null,
          keywords: [main_keyword.trim()],
          status: "draft",
        })
        .select("id")
        .maybeSingle();
      if (createErr || !created) {
        return errorResponse(`create_failed: ${createErr?.message || "unknown"}`, 500);
      }
      articleId = created.id;
    }

    // Deduct credits. RPC handles admin/staff bypass internally.
    const { data: deducted, error: dedErr } = await admin.rpc("deduct_credits_v2", {
      p_user_id: userId,
      p_amount: cost,
      p_reason: "rewrite_start",
      p_model_key: null,
      p_article_id: articleId,
      p_metadata: { chars, language: lang },
    });
    if (dedErr) return errorResponse(`credit_error: ${dedErr.message}`, 500);
    const dedRes = deducted as { ok: boolean; reason?: string; balance?: number; bypassed?: boolean } | null;
    if (dedRes && dedRes.ok === false) {
      return errorResponse(dedRes.reason || "insufficient_credits", 402, { balance: dedRes.balance });
    }
    const bypassed = !!dedRes?.bypassed;

    // Record charge on the article so cycle-finalizer can refund on failure.
    try {
      const { data: existingQD } = await admin
        .from("articles")
        .select("quality_details")
        .eq("id", articleId)
        .maybeSingle();
      const qd = (existingQD?.quality_details && typeof existingQD.quality_details === "object")
        ? existingQD.quality_details : {};
      const nextQD = {
        ...qd,
        rewrite: {
          credits_charged: bypassed ? 0 : cost,
          bypassed,
          started_at: new Date().toISOString(),
          chars,
        },
      };
      await admin.from("articles").update({ quality_details: nextQD }).eq("id", articleId);
    } catch (e) {
      console.warn("[rewrite-start] failed to stamp quality_details:", (e as Error).message);
    }

    // Kick off the improve cycle in background (fire-and-forget).
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization")!;
    const bg = fetch(`${url}/functions/v1/improve-article`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: Deno.env.get("SUPABASE_ANON_KEY") || "",
      },
      body: JSON.stringify({ article_id: articleId, cycle: true, priority: "auto", source: "rewrite_start" }),
    }).catch((e) => console.warn("[rewrite-start] improve dispatch failed:", (e as Error).message));
    try { (globalThis as any).EdgeRuntime?.waitUntil?.(bg); } catch (_) { void bg; }

    return jsonResponse({ ok: true, article_id: articleId, cost, bypassed });
  } catch (e) {
    console.error("[rewrite-start] error", e);
    return errorResponse(e instanceof Error ? e.message : "Unknown error", 500);
  }
});