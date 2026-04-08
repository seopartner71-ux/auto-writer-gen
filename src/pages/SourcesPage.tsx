import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Search } from "lucide-react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MOCK_SOURCES, SOURCE_TYPES, type GeoSource } from "@/shared/data/geoMockData";
import { motion } from "framer-motion";

const PIE_COLORS = ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6", "#9334e6"];

export default function SourcesPage() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const filteredSources = useMemo(() => {
    return MOCK_SOURCES.filter((s) => {
      if (typeFilter !== "all" && s.type !== typeFilter) return false;
      if (search && !s.url.toLowerCase().includes(search.toLowerCase()) && !s.domain.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [search, typeFilter]);

  const pieData = useMemo(() => {
    const byType: Record<string, number> = {};
    MOCK_SOURCES.forEach((s) => { byType[s.type] = (byType[s.type] || 0) + s.occurrenceCount; });
    return Object.entries(byType).map(([type, value]) => ({
      name: SOURCE_TYPES[type as GeoSource["type"]]?.label || type,
      value,
      type,
    }));
  }, []);

  const totalOccurrences = MOCK_SOURCES.reduce((s, x) => s + x.occurrenceCount, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Источники AI</h1>
        <p className="text-muted-foreground text-sm">Анализ источников информации, которые AI модели используют для генерации ответов</p>
      </div>

      {/* KPI + Pie */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Распределение по типам источников</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={2} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 content-start">
          {[
            { label: "Всего источников", value: MOCK_SOURCES.length },
            { label: "Всего упоминаний", value: totalOccurrences },
            { label: "Типов источников", value: Object.keys(SOURCE_TYPES).length },
            { label: "Топ источник", value: MOCK_SOURCES.sort((a, b) => b.occurrenceCount - a.occurrenceCount)[0]?.domain || "—" },
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

      {/* Sources Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Поиск по URL или домену..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                {filteredSources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <img src={s.favicon} alt="" className="h-4 w-4 rounded-sm" loading="lazy" />
                        <span className="text-sm font-medium truncate max-w-[280px]">{s.url}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-xs ${SOURCE_TYPES[s.type].color}`}>
                        {SOURCE_TYPES[s.type].label}
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
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Источники не найдены</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
