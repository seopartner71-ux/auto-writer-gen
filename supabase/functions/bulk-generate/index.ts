import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized");

    const token = authHeader.replace("Bearer ", "");
    const payloadB64 = token.split(".")[1];
    if (!payloadB64) throw new Error("Unauthorized");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) throw new Error("Unauthorized");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Check PRO plan
    const { data: profile } = await admin.from("profiles").select("plan").eq("id", userId).single();
    if (!profile || profile.plan !== "pro") {
      return new Response(JSON.stringify({ error: "Bulk generation is only available on the PRO plan" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { bulk_job_id } = await req.json();
    if (!bulk_job_id) throw new Error("bulk_job_id is required");

    // Verify ownership
    const { data: job } = await admin.from("bulk_jobs").select("*").eq("id", bulk_job_id).eq("user_id", userId).single();
    if (!job) throw new Error("Job not found");

    // Get pending items
    const { data: items } = await admin
      .from("bulk_job_items")
      .select("*")
      .eq("bulk_job_id", bulk_job_id)
      .eq("status", "queued")
      .order("created_at", { ascending: true });

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ message: "No items to process" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update job status to processing
    await admin.from("bulk_jobs").update({ status: "processing" }).eq("id", bulk_job_id);

    // Get model assignment
    const { data: assignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "writer_pro")
      .single();
    const writerModel = assignment?.model_key || "google/gemini-2.5-pro";

    const { data: researchAssignment } = await admin
      .from("task_model_assignments")
      .select("model_key")
      .eq("task_key", "research_pro")
      .single();
    const researchModel = researchAssignment?.model_key || "google/gemini-2.5-flash";

    // Get author profile if set
    let authorPrompt = "";
    if (job.author_profile_id) {
      const { data: author } = await admin.from("author_profiles").select("*").eq("id", job.author_profile_id).single();
      if (author) {
        authorPrompt = `\n\nАвторский стиль: ${author.voice_tone || "нейтральный"}. ${author.system_prompt_override || ""}`;
        if (author.stop_words?.length) authorPrompt += `\nНе используй слова: ${author.stop_words.join(", ")}`;
      }
    }

    let completedCount = job.completed_items || 0;

    // Process items sequentially
    for (const item of items) {
      try {
        // 1. Update status to researching
        await admin.from("bulk_job_items").update({ status: "researching" }).eq("id", item.id);

        // 2. Research: call Serper + AI analysis
        const isRussian = /[а-яё]/i.test(item.seed_keyword);
        const geo = isRussian ? "ru" : "us";
        const lang = isRussian ? "ru" : "en";

        // Serper search
        const { data: apiKeys } = await admin.from("api_keys").select("api_key").eq("provider", "serper").eq("is_valid", true).limit(1);
        let competitors: any[] = [];
        if (apiKeys?.length) {
          try {
            const serperRes = await fetch("https://google.serper.dev/search", {
              method: "POST",
              headers: { "X-API-KEY": apiKeys[0].api_key, "Content-Type": "application/json" },
              body: JSON.stringify({ q: item.seed_keyword, gl: geo, hl: lang, num: 10 }),
            });
            if (serperRes.ok) {
              const serperData = await serperRes.json();
              competitors = (serperData.organic || []).slice(0, 10);
            }
          } catch { /* continue without SERP */ }
        }

        // AI analysis
        const analysisPrompt = `Analyze this keyword for SEO content creation: "${item.seed_keyword}"
Competitors found: ${competitors.map((c: any) => c.title).join(", ") || "none"}

Return JSON: { "intent": "informational|transactional|navigational", "must_cover_topics": [...], "lsi_keywords": [...], "recommended_headings": [...], "recommended_word_count": number }`;

        const analysisResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: researchModel, messages: [{ role: "user", content: analysisPrompt }], response_format: { type: "json_object" } }),
        });

        let analysis: any = {};
        if (analysisResp.ok) {
          const aData = await analysisResp.json();
          try { analysis = JSON.parse(aData.choices?.[0]?.message?.content || "{}"); } catch { /* empty */ }
        }

        // Save keyword
        const { data: kwData } = await admin.from("keywords").insert({
          user_id: userId,
          seed_keyword: item.seed_keyword,
          intent: analysis.intent || null,
          lsi_keywords: analysis.lsi_keywords || [],
          must_cover_topics: analysis.must_cover_topics || [],
          recommended_headings: analysis.recommended_headings || [],
        }).select("id").single();

        const keywordId = kwData?.id;
        if (keywordId) {
          await admin.from("bulk_job_items").update({ keyword_id: keywordId }).eq("id", item.id);

          // Save SERP results
          if (competitors.length > 0) {
            const serpInserts = competitors.map((c: any, i: number) => ({
              keyword_id: keywordId,
              position: i + 1,
              url: c.link || c.url || null,
              title: c.title || null,
              snippet: c.snippet || null,
            }));
            await admin.from("serp_results").insert(serpInserts);
          }
        }

        // 3. Update status to writing
        await admin.from("bulk_job_items").update({ status: "writing" }).eq("id", item.id);

        // 4. Generate article
        const headings = analysis.recommended_headings || [];
        const lsiKws = analysis.lsi_keywords || [];
        const articleLang = isRussian ? "русском" : "English";

        const articlePrompt = `Write a comprehensive SEO article on the topic: "${item.seed_keyword}"
Language: ${articleLang}
${headings.length > 0 ? `Use these headings: ${headings.join(", ")}` : ""}
${lsiKws.length > 0 ? `Include LSI keywords: ${lsiKws.join(", ")}` : ""}
Target word count: ${analysis.recommended_word_count || 2000}
Format: Markdown with proper H2/H3 headings.${authorPrompt}`;

        const articleResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: writerModel, messages: [{ role: "user", content: articlePrompt }] }),
        });

        if (!articleResp.ok) {
          const errText = await articleResp.text();
          throw new Error(`AI API error: ${articleResp.status} ${errText}`);
        }

        const articleData = await articleResp.json();
        const articleContent = articleData.choices?.[0]?.message?.content || "";

        // Extract title from first H1
        const h1Match = articleContent.match(/^#\s+(.+)$/m);
        const articleTitle = h1Match?.[1] || item.seed_keyword;
        const metaDesc = articleContent.replace(/^#.+$/gm, "").split(/\n\n+/).map((p: string) => p.trim()).filter((p: string) => p.length > 30)[0]?.replace(/[*_#`]/g, "").slice(0, 160) || "";

        // Save article
        const { data: artData } = await admin.from("articles").insert({
          user_id: userId,
          keyword_id: keywordId || null,
          author_profile_id: job.author_profile_id || null,
          title: articleTitle,
          content: articleContent,
          meta_description: metaDesc,
          status: "draft",
        }).select("id").single();

        // 5. Mark item done
        completedCount++;
        await admin.from("bulk_job_items").update({
          status: "done",
          article_id: artData?.id || null,
        }).eq("id", item.id);

        await admin.from("bulk_jobs").update({ completed_items: completedCount }).eq("id", bulk_job_id);

      } catch (itemErr) {
        console.error(`Error processing item ${item.id}:`, itemErr);
        await admin.from("bulk_job_items").update({
          status: "error",
          error_message: itemErr instanceof Error ? itemErr.message : "Unknown error",
        }).eq("id", item.id);
        completedCount++;
        await admin.from("bulk_jobs").update({ completed_items: completedCount }).eq("id", bulk_job_id);
      }
    }

    // Update job status
    const { data: finalItems } = await admin
      .from("bulk_job_items")
      .select("status")
      .eq("bulk_job_id", bulk_job_id);
    const allDone = finalItems?.every((i: any) => i.status === "done" || i.status === "error");
    
    await admin.from("bulk_jobs").update({
      status: allDone ? "completed" : "processing",
      completed_items: completedCount,
    }).eq("id", bulk_job_id);

    return new Response(JSON.stringify({ success: true, processed: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("bulk-generate error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    const status = msg.includes("Forbidden") || msg.includes("PRO") ? 403 : msg.includes("Unauthorized") ? 401 : 500;
    return new Response(JSON.stringify({ error: msg }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
