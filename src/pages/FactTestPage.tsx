import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runLayer1Rules, type Finding, type FindingSeverity } from "@/lib/factRules";
import { AlertCircle, CheckCircle2, FileSearch } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const severityVariant: Record<FindingSeverity, "destructive" | "default" | "secondary"> = {
  critical: "destructive",
  major: "default",
  minor: "secondary",
};

export default function FactTestPage() {
  const [text, setText] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checked, setChecked] = useState(false);

  const [articles, setArticles] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepResult, setDeepResult] = useState<any>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const [promptText, setPromptText] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptStatus, setPromptStatus] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState<string | null>(null);

  const savePrompt = async () => {
    setPromptSaving(true);
    setPromptStatus(null);
    try {
      const { error } = await supabase
        .from("app_prompts")
        .update({ content: promptText })
        .eq("key", "fact_critic");
      setPromptStatus(error ? `Ошибка: ${error.message}` : "Сохранено");
    } catch (e) {
      setPromptStatus(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPromptSaving(false);
    }
  };

  const showCurrentPrompt = async () => {
    setPromptPreview(null);
    const { data, error } = await supabase
      .from("app_prompts")
      .select("content")
      .eq("key", "fact_critic")
      .maybeSingle();
    if (error) {
      setPromptPreview(`Ошибка: ${error.message}`);
      return;
    }
    const content = String((data as any)?.content ?? "");
    setPromptPreview(content.slice(0, 200) || "(пусто)");
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("articles")
        .select("id, title")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100);
      setArticles((data ?? []) as Array<{ id: string; title: string }>);
    })();
  }, []);

  const runDeepCheck = async () => {
    if (!selectedId) return;
    setDeepLoading(true);
    setDeepResult(null);
    setVerifyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("deep-fact-check", {
        body: { article_id: selectedId },
      });
      setDeepResult(error ? { error: error.message ?? String(error) } : data);
    } catch (e) {
      setDeepResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeepLoading(false);
    }
  };

  const runFactVerify = async () => {
    if (!deepResult?.fact_check_id) return;
    const toVerify: any[] = (deepResult.critic_findings ?? []).filter(
      (f: any) => f?.search_query && String(f.search_query).trim().length > 0,
    );
    setVerifyLoading(true);
    setVerifyResult(null);
    const batches: any[][] = [];
    for (let i = 0; i < toVerify.length; i += 5) batches.push(toVerify.slice(i, i + 5));
    const all: any[] = [];
    let lastRaw: any = null;
    try {
      for (const batch of batches) {
        const { data, error } = await supabase.functions.invoke("fact-verify", {
          body: { fact_check_id: deepResult.fact_check_id, findings: batch },
        });
        if (error) {
          all.push({ batch_error: error.message ?? String(error) });
        } else {
          lastRaw = data;
          if (Array.isArray((data as any)?.factcheck_findings)) {
            all.push(...(data as any).factcheck_findings);
          } else {
            all.push(data);
          }
        }
      }
      setVerifyResult({ batches: batches.length, factcheck_findings: all, last_response: lastRaw });
    } catch (e) {
      setVerifyResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleCheck = () => {
    setFindings(runLayer1Rules(text));
    setChecked(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <FileSearch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">DEV: Layer 1 Fact Check</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Исходный текст</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Вставьте текст статьи..."
              className="min-h-[240px] resize-y font-mono text-sm"
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {text.length} символов
              </span>
              <Button onClick={handleCheck}>Проверить</Button>
            </div>
          </CardContent>
        </Card>

        {checked && findings.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span>0 находок</span>
          </div>
        )}

        {findings.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Найдено: {findings.length}</span>
            </div>
            {findings.map((finding, idx) => (
              <Card key={idx}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant[finding.severity]}>
                      {finding.severity}
                    </Badge>
                    <Badge variant="outline">{finding.type}</Badge>
                  </div>
                  <blockquote className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">
                    {finding.quote}
                  </blockquote>
                  <p className="text-sm">{finding.verdict}</p>
                  {finding.suggested_fix && (
                    <p className="text-sm text-muted-foreground">
                      Исправление: {finding.suggested_fix}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Полная проверка (dev)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="sm:flex-1">
                  <SelectValue placeholder={articles.length ? "Выберите статью..." : "Нет статей"} />
                </SelectTrigger>
                <SelectContent>
                  {articles.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.title || "(без заголовка)"} — {a.id.slice(0, 8)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={runDeepCheck} disabled={!selectedId || deepLoading}>
                {deepLoading ? "Проверка..." : "Полная проверка (dev)"}
              </Button>
            </div>

            {deepResult && (
              <pre className="max-h-[500px] overflow-auto rounded-md border border-border bg-muted p-4 text-xs">
{JSON.stringify(
  {
    status: deepResult.status,
    fact_score: deepResult.fact_score,
    fact_check_id: deepResult.fact_check_id,
    layer1_findings: deepResult.layer1_findings,
    critic_findings: deepResult.critic_findings,
    error: deepResult.error,
  },
  null,
  2,
)}
              </pre>
            )}

            {deepResult?.status === "awaiting_verification" && (
              <div className="space-y-3">
                <Button onClick={runFactVerify} disabled={verifyLoading} variant="secondary">
                  {verifyLoading ? "Проверяем факты..." : "Проверить факты (dev)"}
                </Button>
                {verifyResult && (
                  <pre className="max-h-[500px] overflow-auto rounded-md border border-border bg-muted p-4 text-xs">
{JSON.stringify(verifyResult, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
