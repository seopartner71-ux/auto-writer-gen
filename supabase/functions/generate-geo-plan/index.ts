import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error("Unauthorized");

    const { project_id, radar_data } = await req.json();
    if (!project_id || !radar_data) throw new Error("Missing project_id or radar_data");

    // Get project info
    const { data: project } = await supabase
      .from("radar_projects")
      .select("brand_name, domain, language, data_nuggets")
      .eq("id", project_id)
      .single();

    if (!project) throw new Error("Project not found");

    const lang = project.language || "ru";
    const {
      overallVisibility,
      somData,
      radarAxes,
      sentimentData,
      sovData,
      competitors,
      tips,
    } = radar_data;

    const systemPrompt = lang === "ru"
      ? `Ты — эксперт по GEO (Generative Engine Optimization). На основе данных анализа видимости бренда в AI-моделях создай детальный план действий.

Формат ответа — Markdown с чёткой структурой:
## 🎯 Общая оценка
Краткая оценка текущего состояния (2-3 предложения)

## 🔴 Критические действия (Приоритет 1)
Перечисли 2-3 самых важных действия с конкретными шагами

## 🟡 Важные улучшения (Приоритет 2)
3-4 действия среднего приоритета

## 🟢 Развитие (Приоритет 3)
2-3 действия для долгосрочного роста

## 📊 KPI и метрики
Конкретные метрики для отслеживания прогресса

## 📅 Таймлайн
Недельный план на первый месяц

Требования:
- Каждое действие должно быть КОНКРЕТНЫМ (не "улучшите контент", а "опубликуйте сравнительный обзор X vs Y на Habr")
- Указывай конкретные площадки и форматы контента
- Учитывай слабые модели и оси радара
- Упоминай реальных конкурентов из данных`
      : `You are a GEO (Generative Engine Optimization) expert. Based on the brand visibility analysis data in AI models, create a detailed action plan.

Response format — Markdown with clear structure:
## 🎯 Overall Assessment
Brief assessment of current state (2-3 sentences)

## 🔴 Critical Actions (Priority 1)
List 2-3 most important actions with specific steps

## 🟡 Important Improvements (Priority 2)
3-4 medium priority actions

## 🟢 Growth (Priority 3)
2-3 actions for long-term growth

## 📊 KPIs and Metrics
Specific metrics to track progress

## 📅 Timeline
Weekly plan for the first month

Requirements:
- Each action must be SPECIFIC (not "improve content" but "publish comparative review X vs Y on Medium")
- Specify exact platforms and content formats
- Consider weak models and radar axes
- Mention real competitors from the data`;

    const userPrompt = lang === "ru"
      ? `Бренд: ${project.brand_name}
Домен: ${project.domain}
Data Nuggets: ${(project.data_nuggets || []).join("; ")}

ДАННЫЕ АНАЛИЗА:
- Общая видимость: ${overallVisibility}%
- Видимость по моделям: ${JSON.stringify(somData)}
- Оси радара: ${JSON.stringify(radarAxes)}
- Тональность: ${JSON.stringify(sentimentData)}
- Share of Voice: ${JSON.stringify(sovData)}
- Топ конкуренты: ${JSON.stringify(competitors)}
- Текущие рекомендации системы: ${JSON.stringify(tips)}

Создай детальный GEO-план действий с приоритетами.`
      : `Brand: ${project.brand_name}
Domain: ${project.domain}
Data Nuggets: ${(project.data_nuggets || []).join("; ")}

ANALYSIS DATA:
- Overall visibility: ${overallVisibility}%
- Visibility by model: ${JSON.stringify(somData)}
- Radar axes: ${JSON.stringify(radarAxes)}
- Sentiment: ${JSON.stringify(sentimentData)}
- Share of Voice: ${JSON.stringify(sovData)}
- Top competitors: ${JSON.stringify(competitors)}
- Current system recommendations: ${JSON.stringify(tips)}

Create a detailed GEO action plan with priorities.`;

    // Get OpenRouter API key
    const { data: apiKeyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("provider", "openrouter")
      .eq("is_valid", true)
      .limit(1)
      .single();

    const apiKey = apiKeyRow?.api_key || Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) throw new Error("OpenRouter API key not configured");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenRouter error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-geo-plan error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
