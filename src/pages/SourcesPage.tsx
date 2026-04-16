import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ExternalLink, Search, FileDown } from "lucide-react";
import { generateSourcesPdf } from "@/shared/utils/radarPdfReport";
import { toast } from "sonner";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { motion } from "framer-motion";

const PIE_COLORS = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6", "#9334e6"];

const SOURCE_TYPES: Record<string, { label: string; color: string }> = {
  service: { label: "Сервис", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  media: { label: "Медиа", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  marketplace: { label: "Маркетплейс", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  ugc: { label: "UGC", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  aggregator: { label: "Агрегатор", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  content: { label: "Контент", color: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200" },
  store: { label: "Магазин", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200" },
};

interface AggregatedSource {
  url: string;
  domain: string;
  type: string;
  occurrenceCount: number;
  favicon: string;
}

export default function SourcesPage({ projectId }: { projectId?: string }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Fetch results with sources
  const { data: results = [] } = useQuery({
    queryKey: ["radar-results-sources", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      // Get keyword IDs for this project
      const { data: kws } = await supabase.from("radar_keywords").select("id").eq("project_id", projectId);
      const kwIds = (kws || []).map((k: any) => k.id);
      // Get prompt IDs for this project
      const { data: prompts } = await supabase.from("radar_prompts" as any).select("id").eq("project_id", projectId);
      const promptIds = (prompts || []).map((p: any) => p.id);
      
      // Fetch results
      const { data } = await supabase.from("radar_results")
        .select("sources, competitor_domains, ai_response_text")
        .eq("user_id", user.id)
        .order("checked_at", { ascending: false })
        .limit(500);
      return data || [];
    },
    enabled: !!projectId,
  });

  // Aggregate sources from results
  const aggregatedSources = useMemo(() => {
    const sourceMap = new Map<string, AggregatedSource>();

    results.forEach((r: any) => {
      // From sources JSONB field
      const sources = Array.isArray(r.sources) ? r.sources : [];
      sources.forEach((s: any) => {
        if (!s?.domain) return;
        const key = s.domain;
        if (sourceMap.has(key)) {
          sourceMap.get(key)!.occurrenceCount++;
        } else {
          sourceMap.set(key, {
            url: s.url || `https://${s.domain}`,
            domain: s.domain,
            type: s.type || "service",
            occurrenceCount: 1,
            favicon: `https://www.google.com/s2/favicons?domain=${s.domain}`,
          });
        }
      });

      // From competitor_domains
      const competitors = Array.isArray(r.competitor_domains) ? r.competitor_domains : [];
      competitors.forEach((domain: string) => {
        if (!domain || domain.length < 3) return;
        const key = domain.toLowerCase();
        if (sourceMap.has(key)) {
          sourceMap.get(key)!.occurrenceCount++;
        } else {
          sourceMap.set(key, {
            url: `https://${domain}`,
            domain,
            type: categorizeSourceDomain(domain),
            occurrenceCount: 1,
            favicon: `https://www.google.com/s2/favicons?domain=${domain}`,
          });
        }
      });
    });

    return Array.from(sourceMap.values()).sort((a, b) => b.occurrenceCount - a.occurrenceCount);
  }, [results]);

  const filteredSources = useMemo(() => {
    return aggregatedSources.filter(s => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (search && !s.url.toLowerCase().includes(search.toLowerCase()) && !s.domain.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [aggregatedSources, search, typeFilter]);

  const pieData = useMemo(() => {
    const byType: Record<string, number> = {};
    aggregatedSources.forEach(s => { byType[s.type] = (byType[s.type] || 0) + s.occurrenceCount; });
    return Object.entries(byType).map(([type, value]) => ({
      name: SOURCE_TYPES[type]?.label || type,
      value,
      type,
    }));
  }, [aggregatedSources]);

  const totalOccurrences = aggregatedSources.reduce((s, x) => s + x.occurrenceCount, 0);

  if (!projectId) {
    return <div className="text-center py-12 text-muted-foreground">Выберите проект для просмотра источников</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Источники AI</h2>
        <p className="text-muted-foreground text-sm">Анализ источников информации AI моделей</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Распределение по типам источников</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={2} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  Запустите сканирование для получения данных
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 content-start">
          {[
            { label: "Всего источников", value: aggregatedSources.length },
            { label: "Всего упоминаний", value: totalOccurrences },
            { label: "Типов источников", value: new Set(aggregatedSources.map(s => s.type)).size },
            { label: "Топ источник", value: aggregatedSources[0]?.domain || "—" },
          ].map((kpi, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card>
                <CardContent className="pt-4 pb-3">
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-xl font-bold mt-1">{kpi.value}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Поиск по URL или домену..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Тип" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все типы</SelectItem>
                {Object.entries(SOURCE_TYPES).map(([key, v]) => <SelectItem key={key} value={key}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[300px]">Источник</TableHead>
                  <TableHead className="w-[120px]">Тип</TableHead>
                  <TableHead className="w-[120px] text-right">Упоминания</TableHead>
                  <TableHead className="w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSources.map((s, i) => (
                  <TableRow key={`${s.domain}-${i}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <img src={s.favicon} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />
                        <span className="text-sm font-medium truncate max-w-[280px]">{s.url}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs ${SOURCE_TYPES[s.type]?.color || ""}`}>
                        {SOURCE_TYPES[s.type]?.label || s.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{s.occurrenceCount}</TableCell>
                    <TableCell>
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredSources.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                    {aggregatedSources.length === 0 ? "Запустите сканирование для получения данных" : "Источники не найдены"}
                  </TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function categorizeSourceDomain(domain: string): string {
  const d = domain.toLowerCase();
  if (/ozon|wildberries|amazon|ebay|aliexpress/.test(d)) return "marketplace";
  if (/reddit|pikabu|quora|stackexchange|stackoverflow/.test(d)) return "ugc";
  if (/vc\.ru|habr|rb\.ru|techcrunch|forbes|wired/.test(d)) return "media";
  if (/sravni|price|compare|yandex\.ru/.test(d)) return "aggregator";
  if (/shop|store/.test(d)) return "store";
  if (/blog|wiki|medium|substack/.test(d)) return "content";
  return "service";
}
