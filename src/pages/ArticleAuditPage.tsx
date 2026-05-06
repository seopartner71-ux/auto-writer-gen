import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Search, Loader2, Sparkles, Copy, ExternalLink, CheckCircle2, AlertTriangle, Target, History, Trash2 } from "lucide-react";

type AuditResult = {
  score: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  priorities: string[];
  stats?: Record<string, any>;
};

type AuditRow = {
  id: string;
  url: string;
  keyword: string | null;
  result: AuditResult;
  created_at: string;
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-400";
  if (score >= 40) return "text-amber-400";
  return "text-red-400";
}
function scoreLabel(score: number): string {
  if (score >= 90) return "Отлично";
  if (score >= 70) return "Хорошо";
  if (score >= 40) return "Средне";
  return "Слабо";
}
function scoreBarColor(score: number): string {
  if (score >= 70) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

export default function ArticleAuditPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<AuditRow | null>(null);

  const { data: history } = useQuery({
    queryKey: ["article-audits", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("article_audits" as any)
        .select("id, url, keyword, result, created_at")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data as any) as AuditRow[];
    },
  });

  const runAudit = async () => {
    if (!url.trim() || !/^https?:\/\//i.test(url.trim())) {
      toast.error("Введите корректный URL (с http:// или https://)");
      return;
    }
    setLoading(true);
    setCurrent(null);
    try {
      const { data, error } = await supabase.functions.invoke("article-audit", {
        body: { url: url.trim(), keyword: keyword.trim() || undefined },
      });
      if (error) throw new Error(error.message || "Ошибка анализа");
      if ((data as any)?.error) throw new Error((data as any).error);
      const row: AuditRow = {
        id: (data as any).id,
        url: url.trim(),
        keyword: keyword.trim() || null,
        result: (data as any).result,
        created_at: (data as any).created_at || new Date().toISOString(),
      };
      setCurrent(row);
      qc.invalidateQueries({ queryKey: ["article-audits", user?.id] });
      toast.success("Аудит готов");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось выполнить аудит");
    } finally {
      setLoading(false);
    }
  };

  const copyReport = () => {
    if (!current) return;
    const r = current.result;
    const lines = [
      `Аудит: ${current.url}`,
      current.keyword ? `Ключ: ${current.keyword}` : "",
      `Оценка: ${r.score}/100 - ${scoreLabel(r.score)}`,
      `Резюме: ${r.summary}`,
      "",
      "Сильные стороны:",
      ...r.strengths.map((s) => `- ${s}`),
      "",
      "Что улучшить:",
      ...r.improvements.map((s) => `- ${s}`),
      "",
      "Приоритеты:",
      ...r.priorities.map((s, i) => `${i + 1}. ${s}`),
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(lines);
    toast.success("Отчет скопирован");
  };

  const rewriteThis = () => {
    if (!current) return;
    const h1 =
      (current.result as any).h1 ||
      current.result.stats?.h1 ||
      current.result.stats?.title ||
      "";
    const params = new URLSearchParams();
    if (current.keyword) params.set("keyword", current.keyword);
    if (h1) params.set("title", h1);
    if (current.url) params.set("source_url", current.url);
    params.set("autostart", "true");
    params.set("mode", "quick");
    navigate(`/articles?${params.toString()}`);
  };

  const deleteAudit = async (id: string) => {
    const { error } = await supabase.from("article_audits" as any).delete().eq("id", id);
    if (error) {
      toast.error("Не удалось удалить");
      return;
    }
    qc.invalidateQueries({ queryKey: ["article-audits", user?.id] });
  };

  return (
    <div className="container mx-auto max-w-4xl px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          AI-аудит статьи
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Вставьте URL вашей статьи или статьи конкурента - за 30 секунд получите отчет что улучшить.
        </p>
      </header>

      <Card className="p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">URL статьи</label>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/moya-statya"
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Ключевое слово (опционально)</label>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="газовая колонка купить"
            disabled={loading}
          />
        </div>
        <Button onClick={runAudit} disabled={loading} className="w-full md:w-auto">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Анализирую (~30 сек)
            </>
          ) : (
            <>
              <Search className="h-4 w-4 mr-2" />
              Проанализировать статью
            </>
          )}
        </Button>
      </Card>

      {current && (
        <Card className="p-5 space-y-5">
          <div>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <ExternalLink className="h-3 w-3" />
              <a href={current.url} target="_blank" rel="noreferrer" className="hover:underline truncate max-w-md inline-block">
                {current.url}
              </a>
            </div>
            <h2 className="text-lg font-semibold">
              {current.result.stats?.h1 || current.result.stats?.title || "Аудит статьи"}
            </h2>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium">Общая оценка</span>
              <span className={`text-2xl font-bold ${scoreColor(current.result.score)}`}>
                {current.result.score}/100
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${scoreBarColor(current.result.score)} transition-all`}
                style={{ width: `${current.result.score}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              {scoreLabel(current.result.score)} - {current.result.summary}
            </div>
          </div>

          {current.result.strengths.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-2 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Сильные стороны
              </h3>
              <ul className="space-y-1 text-sm">
                {current.result.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-emerald-400">•</span><span>{s}</span></li>
                ))}
              </ul>
            </div>
          )}

          {current.result.improvements.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-2 text-amber-400">
                <AlertTriangle className="h-4 w-4" /> Что улучшить
              </h3>
              <ul className="space-y-1 text-sm">
                {current.result.improvements.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-amber-400">•</span><span>{s}</span></li>
                ))}
              </ul>
            </div>
          )}

          {current.result.priorities.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-2 text-primary">
                <Target className="h-4 w-4" /> Приоритеты для роста в топ
              </h3>
              <ol className="space-y-1 text-sm list-decimal list-inside">
                {current.result.priorities.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-2 border-t">
            <Button onClick={rewriteThis} className="gap-2">
              <Sparkles className="h-4 w-4" />
              Переписать эту статью
            </Button>
            <Button onClick={copyReport} variant="outline" className="gap-2">
              <Copy className="h-4 w-4" />
              Скопировать отчет
            </Button>
          </div>
        </Card>
      )}

      {history && history.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
            <History className="h-4 w-4" /> История аудитов
          </h3>
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 text-sm">
                <Badge variant="outline" className={scoreColor(h.result?.score ?? 0)}>
                  {h.result?.score ?? 0}
                </Badge>
                <div className="flex-1 min-w-0">
                  <div className="truncate">{h.url}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.keyword ? `${h.keyword} · ` : ""}
                    {new Date(h.created_at).toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setCurrent(h)}>Открыть</Button>
                <Button size="sm" variant="ghost" onClick={() => deleteAudit(h.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}