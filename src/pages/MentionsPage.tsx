import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, CheckCircle2, XCircle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from "recharts";
import { MOCK_PROMPTS, MOCK_MENTIONS, AI_MODELS, PROMPT_GROUPS } from "@/shared/data/geoMockData";
import { motion } from "framer-motion";

const SENTIMENT_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  positive: { label: "Позитив", variant: "default" },
  negative: { label: "Негатив", variant: "destructive" },
  neutral: { label: "Нейтрал", variant: "secondary" },
};

export default function MentionsPage() {
  const [selectedModel, setSelectedModel] = useState("all");
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [mentionFilter, setMentionFilter] = useState("all");
  const [sentimentFilter, setSentimentFilter] = useState("all");

  const filteredPrompts = useMemo(() => {
    return MOCK_PROMPTS.filter((p) => {
      if (selectedGroup !== "all" && selectedGroup !== "unassigned" && p.groupId !== selectedGroup) return false;
      if (selectedGroup === "unassigned" && p.groupId !== null) return false;
      return true;
    });
  }, [selectedGroup]);

  const getPromptMentions = (promptId: string) => {
    return MOCK_MENTIONS.filter((m) => {
      if (m.promptId !== promptId) return false;
      if (selectedModel !== "all" && m.model !== selectedModel) return false;
      if (mentionFilter === "yes" && !m.mentioned) return false;
      if (mentionFilter === "no" && m.mentioned) return false;
      if (sentimentFilter !== "all" && m.sentiment !== sentimentFilter) return false;
      return true;
    });
  };

  const visibleModels = selectedModel === "all" ? AI_MODELS : AI_MODELS.filter((m) => m.key === selectedModel);

  // Summary stats
  const totalMentions = MOCK_MENTIONS.filter((m) => m.mentioned).length;
  const totalChecks = MOCK_MENTIONS.length;
  const visibilityPct = ((totalMentions / totalChecks) * 100).toFixed(1);
  const positivePct = ((MOCK_MENTIONS.filter((m) => m.sentiment === "positive" && m.mentioned).length / Math.max(totalMentions, 1)) * 100).toFixed(1);

  // Chart data
  const modelChartData = AI_MODELS.map((m) => {
    const modelMentions = MOCK_MENTIONS.filter((r) => r.model === m.key);
    const mentioned = modelMentions.filter((r) => r.mentioned).length;
    return { name: m.name, visibility: +((mentioned / modelMentions.length) * 100).toFixed(1), color: m.color };
  });

  const historyData = Array.from({ length: 7 }, (_, i) => {
    const day = `Jun ${i + 1}`;
    const obj: Record<string, string | number> = { day };
    AI_MODELS.forEach((m) => { obj[m.name] = Math.floor(Math.random() * 30 + 40); });
    return obj;
  });

  const handleExport = () => {
    const rows = [["Промпт", ...AI_MODELS.map((m) => `${m.name} (упоминание)`), ...AI_MODELS.map((m) => `${m.name} (тональность)`)].join(",")];
    filteredPrompts.forEach((p) => {
      const mentions = AI_MODELS.map((m) => {
        const r = MOCK_MENTIONS.find((r) => r.promptId === p.id && r.model === m.key);
        return r?.mentioned ? "Да" : "Нет";
      });
      const sents = AI_MODELS.map((m) => {
        const r = MOCK_MENTIONS.find((r) => r.promptId === p.id && r.model === m.key);
        return r ? SENTIMENT_BADGE[r.sentiment].label : "-";
      });
      rows.push([`"${p.text}"`, ...mentions, ...sents].join(","));
    });
    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "mentions_export.csv";
    link.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Позиции и Упоминания</h1>
          <p className="text-muted-foreground text-sm">Отслеживание присутствия бренда в ответах AI моделей</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-2" />Экспорт в Excel</Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-3">
            <Select value={selectedModel} onValueChange={setSelectedModel}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="AI Модель" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все модели</SelectItem>
                {AI_MODELS.map((m) => <SelectItem key={m.key} value={m.key}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Группа" /></SelectTrigger>
              <SelectContent>
                {PROMPT_GROUPS.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
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
          <TabsTrigger value="brand-history">История позиций бренда</TabsTrigger>
          <TabsTrigger value="site-history">История позиций сайта</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: "Видимость", value: `${visibilityPct}%`, icon: TrendingUp, delta: "+2.1%" },
              { label: "Всего проверок", value: totalChecks, icon: CheckCircle2, delta: "" },
              { label: "Упоминания", value: totalMentions, icon: CheckCircle2, delta: "" },
              { label: "Позитивных", value: `${positivePct}%`, icon: TrendingUp, delta: "" },
            ].map((kpi, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{kpi.label}</p>
                      <kpi.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-2xl font-bold mt-1">{kpi.value}</p>
                    {kpi.delta && <p className="text-xs text-green-500 mt-0.5">{kpi.delta}</p>}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Детали по промптам</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[250px]">Промпт</TableHead>
                      {visibleModels.map((m) => (
                        <TableHead key={m.key} className="text-center min-w-[100px]">{m.name}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPrompts.map((p) => {
                      const mentions = getPromptMentions(p.id);
                      return (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium text-sm">{p.text}</TableCell>
                          {visibleModels.map((m) => {
                            const r = mentions.find((r) => r.model === m.key);
                            if (!r) return <TableCell key={m.key} className="text-center"><Minus className="h-4 w-4 text-muted-foreground mx-auto" /></TableCell>;
                            return (
                              <TableCell key={m.key} className="text-center">
                                <div className="flex flex-col items-center gap-1">
                                  {r.mentioned
                                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    : <XCircle className="h-4 w-4 text-destructive" />}
                                  <Badge variant={SENTIMENT_BADGE[r.sentiment].variant} className="text-[10px] px-1.5">
                                    {SENTIMENT_BADGE[r.sentiment].label}
                                  </Badge>
                                </div>
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      );
                    })}
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
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} unit="%" />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                    {AI_MODELS.map((m) => (
                      <Line key={m.key} type="monotone" dataKey={m.name} stroke={m.color} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
