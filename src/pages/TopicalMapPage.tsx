import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map, Loader2, Search, Sparkles, Download, Rocket, ChevronRight, Trash2, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { toast } from "sonner";

type ClusterKeyword = { keyword: string; volume?: string; difficulty?: string };
type Cluster = {
  name: string;
  icon?: string;
  intent?: "informational" | "commercial" | "transactional" | string;
  keywords: ClusterKeyword[];
};
type TopicalMap = {
  id: string;
  topic: string;
  geo: string;
  language: string;
  clusters: Cluster[];
  total_keywords: number;
  created_at: string;
};

const intentColor = (intent?: string) => {
  switch (intent) {
    case "transactional": return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "commercial":   return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "informational":
    default:             return "bg-sky-500/15 text-sky-400 border-sky-500/30";
  }
};

const volumeLabel = (v?: string) =>
  v === "high" ? "Высокая" : v === "medium" ? "Средняя" : v === "low" ? "Низкая" : "—";

function escapeCsv(s: string) {
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(map: TopicalMap) {
  const rows: string[] = ["Кластер,Ключевое слово,Интент,Объем,Сложность"];
  for (const c of map.clusters || []) {
    for (const kw of c.keywords || []) {
      rows.push(
        [c.name, kw.keyword, c.intent || "", kw.volume || "", kw.difficulty || ""]
          .map((v) => escapeCsv(String(v ?? "")))
          .join(","),
      );
    }
  }
  // BOM for Excel UTF-8
  const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `topical-map-${map.topic.replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TopicalMapPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [topic, setTopic] = useState("");
  const [geo, setGeo] = useState("ru");
  const [language, setLanguage] = useState("ru");
  const [activeMap, setActiveMap] = useState<TopicalMap | null>(null);
  const [bulkDialogCluster, setBulkDialogCluster] = useState<Cluster | null>(null);

  const history = useQuery({
    queryKey: ["topical-maps", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topical_maps")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data as unknown as TopicalMap[]) ?? [];
    },
  });

  const build = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("topical-map", {
        body: { topic: topic.trim(), geo, language },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { map_id: string; clusters: Cluster[]; total_keywords: number; main_topic: string };
    },
    onSuccess: (data) => {
      const newMap: TopicalMap = {
        id: data.map_id,
        topic: topic.trim(),
        geo,
        language,
        clusters: data.clusters,
        total_keywords: data.total_keywords,
        created_at: new Date().toISOString(),
      };
      setActiveMap(newMap);
      qc.invalidateQueries({ queryKey: ["topical-maps"] });
      toast.success(`Найдено ${data.total_keywords} запросов в ${data.clusters.length} кластерах`);
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось построить карту"),
  });

  const removeMap = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("topical_maps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["topical-maps"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const queueBulk = useMutation({
    mutationFn: async (cluster: Cluster | null) => {
      if (!user) throw new Error("Не авторизован");
      const kws = cluster
        ? cluster.keywords.map((k) => k.keyword)
        : (activeMap?.clusters || []).flatMap((c) => c.keywords.map((k) => k.keyword));
      if (kws.length === 0) throw new Error("Нет ключевых слов");

      const { data: job, error: jobErr } = await supabase
        .from("bulk_jobs")
        .insert({ user_id: user.id, total_items: kws.length, status: "pending" })
        .select("id")
        .single();
      if (jobErr) throw jobErr;
      const items = kws.map((kw) => ({ bulk_job_id: job.id, seed_keyword: kw, status: "queued" }));
      const { error: itemsErr } = await supabase.from("bulk_job_items").insert(items);
      if (itemsErr) throw itemsErr;
      const { error } = await supabase.functions.invoke("bulk-generate", { body: { bulk_job_id: job.id } });
      if (error) throw error;
      return kws.length;
    },
    onSuccess: (n) => {
      toast.success(`Добавлено ${n} статей в очередь генерации`);
      navigate("/articles");
    },
    onError: (e: Error) => toast.error(e.message || "Не удалось поставить в очередь"),
  });

  const handleGenerateOne = (kw: string) => {
    navigate(`/keywords?seed=${encodeURIComponent(kw)}`);
  };

  const totalInActive = useMemo(
    () => (activeMap?.clusters || []).reduce((s, c) => s + (c.keywords?.length || 0), 0),
    [activeMap],
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
          <Map className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Карта тем</h1>
          <p className="text-sm text-muted-foreground">
            Кластеризация ключевых слов и планирование контента
          </p>
        </div>
      </header>

      {/* Step 1: Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Введите основную тему
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="topic">Тема</Label>
            <Input
              id="topic"
              placeholder="например, газовые колонки"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && topic.trim().length >= 2) build.mutate(); }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Регион</Label>
              <Select value={geo} onValueChange={setGeo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Россия</SelectItem>
                  <SelectItem value="ua">Украина</SelectItem>
                  <SelectItem value="kz">Казахстан</SelectItem>
                  <SelectItem value="by">Беларусь</SelectItem>
                  <SelectItem value="us">США</SelectItem>
                  <SelectItem value="gb">Великобритания</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Язык</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ru">Русский</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="uk">Украинский</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="w-full"
            disabled={topic.trim().length < 2 || build.isPending}
            onClick={() => build.mutate()}
          >
            {build.isPending ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Анализирую SERP и кластеризую...</>
            ) : (
              <><Search className="h-4 w-4 mr-2" /> Построить карту тем</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Step 2: Clusters */}
      {activeMap && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Карта тем: "{activeMap.topic}"</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Найдено {totalInActive} запросов в {activeMap.clusters.length} кластерах
              </p>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => downloadCsv(activeMap)}>
                <Download className="h-4 w-4 mr-1.5" /> Excel
              </Button>
              <Button size="sm" onClick={() => setBulkDialogCluster({ name: "Все кластеры", keywords: activeMap.clusters.flatMap(c => c.keywords) } as Cluster)}>
                <Rocket className="h-4 w-4 mr-1.5" /> Сгенерировать все
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeMap.clusters.map((cluster, idx) => (
              <div key={idx} className="rounded-xl border border-border p-4 bg-card/50">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl shrink-0">{cluster.icon || "🎯"}</span>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{cluster.name}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge variant="outline" className={intentColor(cluster.intent)}>
                          {cluster.intent || "informational"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {cluster.keywords?.length || 0} запросов
                        </span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setBulkDialogCluster(cluster)}
                    className="shrink-0"
                  >
                    Генерировать <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
                <ul className="space-y-1.5">
                  {(cluster.keywords || []).map((kw, ki) => (
                    <li key={ki} className="flex items-center justify-between gap-2 text-sm group">
                      <span className="truncate text-foreground/90">{kw.keyword}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground hidden sm:inline">{volumeLabel(kw.volume)}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition"
                          onClick={() => handleGenerateOne(kw.keyword)}
                        >
                          В работу
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* History */}
      {(history.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Последние карты
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(history.data ?? []).map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-muted/30 transition">
                <div className="min-w-0">
                  <div className="font-medium truncate">{m.topic}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.total_keywords} запросов • {(m.clusters?.length || 0)} кластеров • {new Date(m.created_at).toLocaleDateString("ru-RU")}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={() => setActiveMap(m)}>Открыть</Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeMap.mutate(m.id)}
                    title="Удалить"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Bulk confirm dialog */}
      <AlertDialog open={!!bulkDialogCluster} onOpenChange={(o) => !o && setBulkDialogCluster(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Поставить в очередь генерации?</AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDialogCluster && (
                <>
                  Будет добавлено {bulkDialogCluster.keywords?.length ?? 0} статей. Это займет
                  примерно {Math.max(1, Math.ceil((bulkDialogCluster.keywords?.length ?? 0) * 1.2))} минут.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const c = bulkDialogCluster;
                setBulkDialogCluster(null);
                if (c) queueBulk.mutate(c);
              }}
            >
              Добавить в очередь
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}