import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Download, CheckCircle2, XCircle, TrendingUp, Minus, Eye } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { motion } from "framer-motion";

const AI_MODELS = [
  { key: "chatgpt", name: "ChatGPT", color: "#10a37f" },
  { key: "perplexity", name: "Perplexity", color: "#1fb8cd" },
  { key: "claude", name: "Claude", color: "#d97706" },
  { key: "gemini_flash", name: "Gemini", color: "#4285f4" },
  { key: "deepseek", name: "DeepSeek", color: "#5B6AE0" },
  { key: "mistral", name: "Mistral", color: "#F97316" },
  { key: "llama", name: "Llama", color: "#8B5CF6" },
];

const SENTIMENT_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  positive: { label: "Позитив", variant: "default" },
  negative: { label: "Негатив", variant: "destructive" },
  neutral: { label: "Нейтрал", variant: "secondary" },
  not_found: { label: "—", variant: "secondary" },
};

export default function MentionsPage({ projectId }: { projectId?: string }) {
  const [selectedModel, setSelectedModel] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");
  const [mentionFilter, setMentionFilter] = useState("all");
  const [viewResult, setViewResult] = useState<any>(null);

  // Fetch prompt groups
  const { data: groups = [] } = useQuery({
    queryKey: ["radar-prompt-groups", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_prompt_groups" as any).select("*").eq("project_id", projectId).order("sort_order");
      return (data || []) as any[];
    },
    enabled: !!projectId,
  });

  // Fetch prompts
  const { data: prompts = [] } = useQuery({
    queryKey: ["radar-prompts", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_prompts" as any).select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!projectId,
  });

  // Fetch keywords (for backward compat)
  const { data: keywords = [] } = useQuery({
    queryKey: ["radar-keywords-mentions", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_keywords").select("*").eq("project_id", projectId);
      return data || [];
    },
    enabled: !!projectId,
  });

  // Fetch results
  const allItemIds = [...prompts.map((p: any) => p.id), ...keywords.map((k: any) => k.id)];
  const { data: results = [] } = useQuery({
    queryKey: ["radar-results-mentions", projectId, allItemIds.join(",")],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_results").select("*").eq("user_id", (await supabase.auth.getUser()).data.user?.id || "").order("checked_at", { ascending: false }).limit(500);
      return data || [];
    },
    enabled: !!projectId,
  });

  // Combine prompts + keywords as "query items"
  const queryItems = useMemo(() => {
    const items: { id: string; text: string; groupId: string | null; type: "prompt" | "keyword" }[] = [];
    prompts.forEach((p: any) => items.push({ id: p.id, text: p.text, groupId: p.group_id, type: "prompt" }));
    keywords.forEach((k: any) => items.push({ id: k.id, text: k.keyword, groupId: null, type: "keyword" }));
    return items;
  }, [prompts, keywords]);

  // Filter query items
  const filteredItems = useMemo(() => {
    return queryItems.filter(item => {
      if (selectedGroup !== "all" && selectedGroup !== "unassigned" && item.groupId !== selectedGroup) return false;
      if (selectedGroup === "unassigned" && item.groupId !== null) return false;
      return true;
    });
  }, [queryItems, selectedGroup]);

  // Get results for a query item
  const getItemResults = (itemId: string) => {
    return results.filter((r: any) => {
      const matchesItem = r.prompt_id === itemId || r.keyword_id === itemId;
      if (!matchesItem) return false;
      if (selectedModel !== "all" && r.model !== selectedModel) return false;
      if (mentionFilter === "yes" && !r.is_brand_found && !r.brand_mentioned) return false;
      if (mentionFilter === "no" && (r.is_brand_found || r.brand_mentioned)) return false;
      if (sentimentFilter !== "all" && r.sentiment !== sentimentFilter) return false;
      return true;
    });
  };

  const visibleModels = selectedModel === "all" ? AI_MODELS : AI_MODELS.filter(m => m.key === selectedModel);

  // KPI stats
  const totalChecks = results.length;
  const totalMentions = results.filter((r: any) => r.is_brand_found || r.brand_mentioned).length;
  const visibilityPct = totalChecks > 0 ? ((totalMentions / totalChecks) * 100).toFixed(1) : "0";
  const positivePct = totalMentions > 0 ? ((results.filter((r: any) => r.sentiment === "positive" && (r.is_brand_found || r.brand_mentioned)).length / totalMentions) * 100).toFixed(1) : "0";

  // Chart data
  const modelChartData = AI_MODELS.map(m => {
    const modelResults = results.filter((r: any) => r.model === m.key);
    const mentioned = modelResults.filter((r: any) => r.is_brand_found || r.brand_mentioned).length;
    return { name: m.name, visibility: modelResults.length > 0 ? +((mentioned / modelResults.length) * 100).toFixed(1) : 0, color: m.color };
  });

  // History data (group by date)
  const historyData = useMemo(() => {
    const byDate: Record<string, Record<string, { total: number; mentioned: number }>> = {};
    results.forEach((r: any) => {
      const date = new Date(r.checked_at).toLocaleDateString();
      if (!byDate[date]) byDate[date] = {};
      if (!byDate[date][r.model]) byDate[date][r.model] = { total: 0, mentioned: 0 };
      byDate[date][r.model].total++;
      if (r.is_brand_found || r.brand_mentioned) byDate[date][r.model].mentioned++;
    });
    return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([day, models]) => {
      const obj: Record<string, string | number> = { day };
      AI_MODELS.forEach(m => {
        const d = models[m.key];
        obj[m.name] = d ? Math.round((d.mentioned / d.total) * 100) : 0;
      });
      return obj;
    });
  }, [results]);

  const handleExport = () => {
    const rows = [["Запрос", ...AI_MODELS.map(m => `${m.name} (упом.)`), ...AI_MODELS.map(m => `${m.name} (тон.)`)].join(",")];
    filteredItems.forEach(item => {
      const mentions = AI_MODELS.map(m => {
        const r = results.find((r: any) => (r.prompt_id === item.id || r.keyword_id === item.id) && r.model === m.key);
        return r?.is_brand_found || r?.brand_mentioned ? "Да" : "Нет";
      });
      const sents = AI_MODELS.map(m => {
        const r = results.find((r: any) => (r.prompt_id === item.id || r.keyword_id === item.id) && r.model === m.key);
        return r ? (SENTIMENT_BADGE[r.sentiment]?.label || r.sentiment) : "-";
      });
      rows.push([`"${item.text}"`, ...mentions, ...sents].join(","));
    });
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "mentions_export.csv";
    link.click();
  };

  if (!projectId) {
    return <div className="text-center py-12 text-muted-foreground">Выберите проект для просмотра позиций</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Позиции и Упоминания</h2>
          <p className="text-muted-foreground text-sm">Отслеживание присутствия бренда в ответах AI</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Экспорт CSV</Button>
      </div>

      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3">
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="AI Модель" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все модели</SelectItem>
                {AI_MODELS.map(m => <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Группа" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="unassigned">Без группы</SelectItem>
                {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={mentionFilter} onValueChange={setMentionFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Упоминание" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="yes">Упомянут</SelectItem>
                <SelectItem value="no">Не упомянут</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sentimentFilter} onValueChange={setSentimentFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Тональность" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="positive">Позитив</SelectItem>
                <SelectItem value="negative">Негатив</SelectItem>
                <SelectItem value="neutral">Нейтрал</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList>
          <TabsTrigger value="summary">Сводка</TabsTrigger>
          <TabsTrigger value="brand-history">История бренда</TabsTrigger>
          <TabsTrigger value="site-history">Динамика</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: "Видимость", value: `${visibilityPct}%`, icon: TrendingUp },
              { label: "Всего проверок", value: totalChecks, icon: CheckCircle2 },
              { label: "Упоминания", value: totalMentions, icon: CheckCircle2 },
              { label: "Позитивных", value: `${positivePct}%`, icon: TrendingUp },
            ].map((kpi, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{kpi.label}</p>
                      <kpi.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Детали по запросам</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[250px]">Запрос</TableHead>
                      {visibleModels.map(m => (
                        <TableHead key={m.key} className="text-center min-w-[100px]">{m.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map(item => {
                      const itemResults = getItemResults(item.id);
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium text-sm">{item.text}</TableCell>
                          {visibleModels.map(m => {
                            const r = itemResults.find((r: any) => r.model === m.key);
                            if (!r) return <TableCell key={m.key} className="text-center"><Minus className="h-4 w-4 text-muted-foreground mx-auto" /></TableCell>;
                            const mentioned = r.is_brand_found || r.brand_mentioned;
                            return (
                              <TableCell key={m.key} className="text-center">
                                <button
                                  onClick={() => setViewResult({ ...r, queryText: item.text, modelName: m.name })}
                                  className="flex flex-col items-center gap-1 mx-auto cursor-pointer hover:opacity-80 transition-opacity group"
                                  title="Нажмите для просмотра ответа"
                                >
                                  {mentioned ? <CheckCircle2 className="h-4 w-4 text-green-500 group-hover:scale-110 transition-transform" /> : <XCircle className="h-4 w-4 text-destructive group-hover:scale-110 transition-transform" />}
                                  <Badge variant={SENTIMENT_BADGE[r.sentiment]?.variant || "secondary"} className="text-[10px] px-1.5 cursor-pointer">
                                    {SENTIMENT_BADGE[r.sentiment]?.label || r.sentiment}
                                  </Badge>
                                </button>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
                    {filteredItems.length === 0 && (
                      <TableRow><TableCell colSpan={visibleModels.length + 1} className="text-center text-muted-foreground py-8">Добавьте промпты или запросы для анализа</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="brand-history">
          <Card>
            <CardHeader><CardTitle className="text-base">Видимость бренда по моделям</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={modelChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit="%" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Bar dataKey="visibility" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="site-history">
          <Card>
            <CardHeader><CardTitle className="text-base">Динамика позиций по дням</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[350px]">
                {historyData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={historyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit="%" />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                      <Legend />
                      {AI_MODELS.map(m => (
                        <Line key={m.key} type="monotone" dataKey={m.name} stroke={m.color} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Запустите сканирование для получения данных
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Response Detail Dialog */}
      <Dialog open={!!viewResult} onOpenChange={() => setViewResult(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Ответ {viewResult?.modelName}
              {viewResult?.sentiment && (
                <Badge variant={SENTIMENT_BADGE[viewResult.sentiment]?.variant || "secondary"} className="ml-2">
                  {SENTIMENT_BADGE[viewResult.sentiment]?.label || viewResult.sentiment}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Запрос: <span className="font-medium text-foreground">{viewResult?.queryText}</span>
              <span className="text-xs ml-2">
                {viewResult?.checked_at && new Date(viewResult.checked_at).toLocaleString()}
              </span>
            </DialogDescription>
          </DialogHeader>

          {viewResult && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant={viewResult.is_brand_found || viewResult.brand_mentioned ? "default" : "destructive"}>
                  {viewResult.is_brand_found || viewResult.brand_mentioned ? "✓ Бренд найден" : "✗ Бренд не найден"}
                </Badge>
                {(viewResult.is_domain_found || viewResult.domain_linked) && (
                  <Badge variant="default">✓ Домен найден</Badge>
                )}
                {viewResult.competitor_domains?.length > 0 && (
                  <Badge variant="secondary">Конкуренты: {viewResult.competitor_domains.join(", ")}</Badge>
                )}
              </div>

              {viewResult.matched_snippets?.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Найденные фрагменты:</p>
                  <div className="space-y-1">
                    {viewResult.matched_snippets.map((s: string, i: number) => (
                      <div key={i} className="text-sm bg-primary/10 rounded px-3 py-1.5 border-l-2 border-primary">
                        ...{s}...
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {viewResult.ai_response_text && (
                <div>
                  <p className="text-sm font-medium mb-2">Полный ответ ИИ:</p>
                  <div className="text-sm whitespace-pre-wrap bg-muted/30 rounded-lg p-4 border border-border max-h-[400px] overflow-y-auto leading-relaxed">
                    {viewResult.ai_response_text}
                  </div>
                </div>
              )}

              {viewResult.sources && Array.isArray(viewResult.sources) && viewResult.sources.length > 0 && (
                <div>
                  <p className="text-sm font-medium mb-2">Источники:</p>
                  <div className="space-y-1">
                    {viewResult.sources.map((src: any, i: number) => (
                      <a key={i} href={typeof src === "string" ? src : src.url} target="_blank" rel="noopener noreferrer"
                        className="block text-xs text-primary hover:underline truncate">
                        {typeof src === "string" ? src : src.url || src.title}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
