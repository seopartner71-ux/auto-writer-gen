import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_CONCURRENT = 5; // Process up to 5 items at a time
const RETRY_BASE_DELAY_MS = 5000; // 5s, 10s, 20s exponential backoff

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // Count currently processing items
    const { count: processingCount } = await admin
      .from("generation_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing");

    const availableSlots = MAX_CONCURRENT - (processingCount || 0);
    if (availableSlots <= 0) {
      return new Response(JSON.stringify({ 
        message: "Queue is at capacity", 
        processing: processingCount,
        max: MAX_CONCURRENT 
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch next items from queue (priority DESC, created_at ASC)
    const { data: queueItems, error: fetchErr } = await admin
      .from("generation_queue")
      .select("*")
      .in("status", ["queued", "retry"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(availableSlots);

    if (fetchErr) throw fetchErr;
    if (!queueItems?.length) {
      return new Response(JSON.stringify({ message: "Queue is empty", processing: processingCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ id: string; status: string; error?: string }> = [];

    // Process items concurrently (up to availableSlots)
    const promises = queueItems.map(async (item) => {
      // Mark as processing
      await admin.from("generation_queue").update({ 
        status: "processing", 
        started_at: new Date().toISOString() 
      }).eq("id", item.id);

      try {
        // Call generate-article with the stored payload
        const payload = item.request_payload as Record<string, unknown>;
        
        // Get user's auth - we use service role to call the function directly
        const response = await fetch(`${supabaseUrl}/functions/v1/generate-article`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
            "x-queue-user-id": item.user_id, // Pass user context
          },
          body: JSON.stringify({
            ...payload,
            _queue_item_id: item.id,
            _queue_user_id: item.user_id,
          }),
        });

        if (response.status === 429) {
          // Rate limited - schedule retry with backoff
          const nextRetry = item.retry_count + 1;
          if (nextRetry >= item.max_retries) {
            await admin.from("generation_queue").update({
              status: "failed",
              error_message: "Превышен лимит запросов к AI после нескольких попыток",
              completed_at: new Date().toISOString(),
            }).eq("id", item.id);
            results.push({ id: item.id, status: "failed", error: "Rate limit exhausted" });
          } else {
            const delay = RETRY_BASE_DELAY_MS * Math.pow(2, nextRetry);
            await admin.from("generation_queue").update({
              status: "retry",
              retry_count: nextRetry,
              error_message: `429 Rate limited. Retry ${nextRetry}/${item.max_retries} after ${delay}ms`,
            }).eq("id", item.id);
            results.push({ id: item.id, status: "retry", error: `Will retry in ${delay}ms` });
          }
          return;
        }

        if (response.status === 402) {
          await admin.from("generation_queue").update({
            status: "failed",
            error_message: "Недостаточно кредитов",
            completed_at: new Date().toISOString(),
          }).eq("id", item.id);
          results.push({ id: item.id, status: "failed", error: "No credits" });
          return;
        }

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`HTTP ${response.status}: ${errText}`);
        }

        // For streaming responses, consume the full stream
        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("text/event-stream")) {
          // Consume the stream to get the full article content
          const reader = response.body?.getReader();
          let fullContent = "";
          
          if (reader) {
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunk = decoder.decode(value, { stream: true });
              
              // Parse SSE format
              const lines = chunk.split("\n");
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const data = line.slice(6);
                  if (data === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) fullContent += delta;
                  } catch { /* skip non-JSON */ }
                }
              }
            }
          }

          // Save the article
          if (fullContent.trim()) {
            const h1Match = fullContent.match(/^#\s+(.+)$/m);
            const title = h1Match?.[1] || (payload.seed_keyword as string) || "Без названия";
            
            const { data: article } = await admin.from("articles").insert({
              user_id: item.user_id,
              keyword_id: item.keyword_id,
              author_profile_id: item.author_profile_id,
              title,
              content: fullContent,
              status: "completed",
            }).select("id").single();

            await admin.from("generation_queue").update({
              status: "completed",
              article_id: article?.id || null,
              completed_at: new Date().toISOString(),
            }).eq("id", item.id);

            // Notify user
            await admin.from("notifications").insert({
              user_id: item.user_id,
              title: "📝 Статья готова!",
              message: `Статья "${title}" успешно сгенерирована из очереди.`,
            });

            results.push({ id: item.id, status: "completed" });
          } else {
            throw new Error("Empty response from AI");
          }
        } else {
          // Non-streaming JSON response (likely error)
          const data = await response.json();
          if (data.error) throw new Error(data.error);
          
          await admin.from("generation_queue").update({
            status: "completed",
            completed_at: new Date().toISOString(),
          }).eq("id", item.id);
          results.push({ id: item.id, status: "completed" });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Queue item ${item.id} error:`, errMsg);

        const nextRetry = item.retry_count + 1;
        if (nextRetry < item.max_retries) {
          await admin.from("generation_queue").update({
            status: "retry",
            retry_count: nextRetry,
            error_message: `Error: ${errMsg}. Retry ${nextRetry}/${item.max_retries}`,
          }).eq("id", item.id);
          results.push({ id: item.id, status: "retry", error: errMsg });
        } else {
          await admin.from("generation_queue").update({
            status: "failed",
            error_message: errMsg,
            completed_at: new Date().toISOString(),
          }).eq("id", item.id);

          // Notify user about failure
          await admin.from("notifications").insert({
            user_id: item.user_id,
            title: "❌ Ошибка генерации",
            message: `Не удалось сгенерировать статью: ${errMsg}`,
          });

          results.push({ id: item.id, status: "failed", error: errMsg });
        }
      }
    });

    await Promise.allSettled(promises);

    // Get queue stats
    const { count: totalQueued } = await admin
      .from("generation_queue")
      .select("*", { count: "exact", head: true })
      .in("status", ["queued", "retry"]);

    const { count: totalProcessing } = await admin
      .from("generation_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "processing");

    return new Response(JSON.stringify({ 
      processed: results.length,
      results,
      queue_remaining: totalQueued || 0,
      currently_processing: totalProcessing || 0,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("process-queue error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
