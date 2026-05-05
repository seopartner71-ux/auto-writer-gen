import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Map, Loader2, Search, Sparkles, Download, Rocket, Trash2, History, HelpCircle, PenLine } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { toast } from "sonner";

type ClusterKeyword = { keyword: string; volume?: string; difficulty?: string };
type Cluster = {
  name: string;
  icon?: string;
  intent?: "informational" | "commercial" | "transactional" | "navigational" | string;
  keywords: ClusterKeyword[];
};
type TopicalMap = {
  id: string;
  topic: string;
  geo: string;
  city?: string | null;
  language: string;
  clusters: Cluster[];
  total_keywords: number;
  created_at: string;
};

const CITIES: Record<string, { custom: string; list: string[] }> = {
  ru: {
    custom: "Вся Россия",
    list: [
      "Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Краснодар",
      "Нижний Новгород", "Челябинск", "Самара", "Омск", "Ростов-на-Дону", "Уфа",
      "Красноярск", "Воронеж", "Пермь", "Волгоград", "Саратов", "Тюмень",
    ],
  },
  ua: { custom: "Вся Украина", list: ["Киев", "Харьков", "Одесса", "Днепр", "Запорожье"] },
  kz: { custom: "Весь Казахстан", list: ["Алматы", "Астана"] },
  by: { custom: "Вся Беларусь", list: ["Минск", "Гомель", "Брест"] },
};

const intentMeta = (intent?: string) => {
  switch (intent) {
    case "transactional":
      return { label: "🛒 Купить", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        tip: "Пользователь готов купить. Высокая конверсия, сильная конкуренция." };
    case "commercial":
      return { label: "💰 Сравнение", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        tip: "Пользователь выбирает между вариантами. Хорошо работают обзоры и рейтинги." };
    case "navigational":
      return { label: "🔍 Навигация", cls: "bg-purple-500/15 text-purple-400 border-purple-500/30",
        tip: "Пользователь ищет конкретный сайт или бренд." };
    case "informational":
    default:
      return { label: "📚 Информация", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30",
        tip: "Пользователь изучает тему. Легче продвигать, строит авторитет сайта." };
  }
};

const difficultyMeta = (d?: string) => {
  switch (d) {
    case "high":
      return { label: "🔴 Высокая", cls: "text-red-400",
        tip: "Сильные конкуренты - крупные сайты. Сложно без авторитета домена." };
    case "medium":
      return { label: "🟡 Средняя", cls: "text-amber-400",
        tip: "Умеренная конкуренция. Нужна качественная детальная статья." };
    case "low":
      return { label: "🟢 Низкая", cls: "text-emerald-400",
        tip: "Мало конкурентов. Хорошая статья быстро попадет в топ-10." };
    default:
      return { label: "—", cls: "text-muted-foreground", tip: "" };
  }
};

function escapeCsv(s: string) {
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// Cleans noisy SERP titles into a pure search query.
function cleanKeyword(raw: string): string {
  let s = String(raw || "").trim();
  // Remove trailing intent labels
  s = s.replace(/\s*[—–-]\s*(commercial|transactional|informational|navigational)\s*$/i, "");
  // Remove known site-name tails after dash
  s = s.replace(/\s*[—–-]\s*(профи\.ру|profi\.ru|ozon|avito|wildberries|wb|dns|эльдорадо|mvideo|м\.видео|ситилинк|яндекс[^—–-]*|google[^—–-]*)\b.*$/i, "");
  // Remove tail after dash if it contains a domain or starts with capital + brand-ish word
  s = s.replace(/\s*[—–-]\s*[^—–-]*?\.(ru|com|рф|net|org|ua|by|kz)\b.*$/i, "");
  // Strip surrounding quotes
  s = s.replace(/^["'«»]+|["'«»]+$/g, "");
  // Collapse whitespace
  s = s.replace(/\s{2,}/g, " ").trim();
  // If still too long, take part before first " - " / em-dash
  if (s.length > 60) {
    const parts = s.split(/\s*[—–-]\s*/);
    if (parts[0] && parts[0].length >= 3) s = parts[0].trim();
  }
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
  const [citySel, setCitySel] = useState<string>("__all__"); // __all__ | __custom__ | city name
  const [customCity, setCustomCity] = useState("");
  const [activeMap, setActiveMap] = useState<TopicalMap | null>(null);
  const [bulkDialogCluster, setBulkDialogCluster] = useState<Cluster | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    setCitySel("__all__");
    setCustomCity("");
  }, [geo]);

  const cityValue = citySel === "__all__" ? "" : citySel === "__custom__" ? customCity.trim() : citySel;

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
        body: { topic: topic.trim(), geo, city: cityValue, language },
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
        city: cityValue || null,
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
        ? cluster.keywords.map((k) => cleanKeyword(k.keyword))
        : (activeMap?.clusters || []).flatMap((c) => c.keywords.map((k) => cleanKeyword(k.keyword)));
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
    navigate(`/keywords?seed=${encodeURIComponent(cleanKeyword(kw))}`);
  };

  const totalInActive = useMemo(
    () => (activeMap?.clusters || []).reduce((s, c) => s + (c.keywords?.length || 0), 0),
    [activeMap],
  );

  const cityOptions = CITIES[geo];

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6 max-w-5xl mx-auto">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
              <Map className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Карта тем</h1>
              <p className="text-sm text-muted-foreground">
                Кластеризация ключевых слов и планирование контента
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setHelpOpen(true)} className="text-muted-foreground hover:text-foreground">
            <HelpCircle className="h-4 w-4 mr-1.5" /> Как это работает?
          </Button>
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label>Страна</Label>
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
              {cityOptions && (
                <div className="space-y-2">
                  <Label>Город</Label>
                  <Select value={citySel} onValueChange={setCitySel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-64">
                      <SelectItem value="__all__">{cityOptions.custom}</SelectItem>
                      {cityOptions.list.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                      <SelectItem value="__custom__">Или введите свой город...</SelectItem>
                    </SelectContent>
                  </Select>
                  {citySel === "__custom__" && (
                    <Input
                      placeholder="Например, Сочи"
                      value={customCity}
                      onChange={(e) => setCustomCity(e.target.value)}
                    />
                  )}
                </div>
              )}
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

        {/* Empty state */}
        {!activeMap && !build.isPending && (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center space-y-4">
              <div className="text-5xl">🗺️</div>
              <div>
                <p className="text-base font-medium">Введите тему и постройте карту контента для сайта</p>
                <p className="text-sm text-muted-foreground mt-2">Например:</p>
                <ul className="text-sm text-muted-foreground mt-1 space-y-0.5">
                  <li>- газовые колонки</li>
                  <li>- стоматология</li>
                  <li>- ремонт квартир</li>
                  <li>- юридические услуги</li>
                </ul>
                <p className="text-xs text-muted-foreground mt-4">
                  Найдем все запросы по теме и сгруппируем по смыслу
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Clusters */}
        {activeMap && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base">Карта тем: "{activeMap.topic}"</CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Найдено {totalInActive} ключевых слов в {activeMap.clusters.length} тематических кластерах
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={() => downloadCsv(activeMap)}>
                  <Download className="h-4 w-4 mr-1.5" /> Excel
                </Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" onClick={() => setBulkDialogCluster({ name: "Все кластеры", keywords: activeMap.clusters.flatMap(c => c.keywords) } as Cluster)}>
                      <Rocket className="h-4 w-4 mr-1.5" /> Сгенерировать все ({totalInActive})
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Добавить все ключи в очередь генерации статей</TooltipContent>
                </Tooltip>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeMap.clusters.map((cluster, idx) => {
                const im = intentMeta(cluster.intent);
                const count = cluster.keywords?.length || 0;
                return (
                  <div key={idx} className="rounded-xl border border-border p-4 bg-card/50">
                    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xl shrink-0">{cluster.icon || "🎯"}</span>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{cluster.name}</div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge variant="outline" className={`cursor-help ${im.cls}`}>{im.label}</Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">{im.tip}</TooltipContent>
                            </Tooltip>
                            <span className="text-xs text-muted-foreground">{count} запросов</span>
                          </div>
                        </div>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="sm" onClick={() => setBulkDialogCluster(cluster)} className="shrink-0">
                            <Rocket className="h-4 w-4 mr-1.5" /> Генерировать ({count} статей)
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Добавить все ключи кластера в очередь генерации статей</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Keywords table header */}
                    <div className="hidden sm:grid grid-cols-[1fr_120px_140px_auto] gap-2 px-2 pb-1 text-xs text-muted-foreground border-b border-border/50 mb-1">
                      <span>Ключевое слово</span>
                      <span>Объем</span>
                      <span>Сложность</span>
                      <span></span>
                    </div>

                    <ul className="space-y-1">
                      {(cluster.keywords || []).map((kw, ki) => {
                        const dm = difficultyMeta(kw.difficulty);
                        const vol = kw.volume === "high" ? "Высокий" : kw.volume === "medium" ? "Средний" : kw.volume === "low" ? "Низкий" : "—";
                        return (
                          <li key={ki} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_auto] items-center gap-2 text-sm py-1 px-2 rounded hover:bg-muted/30 group">
                            <span className="truncate text-foreground/90">{kw.keyword}</span>
                            <span className="text-xs text-muted-foreground">{vol}</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={`text-xs cursor-help ${dm.cls}`}>{dm.label}</span>
                              </TooltipTrigger>
                              {dm.tip && <TooltipContent className="max-w-xs">{dm.tip}</TooltipContent>}
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 sm:opacity-0 sm:group-hover:opacity-100 transition justify-self-end"
                                  onClick={() => handleGenerateOne(kw.keyword)}
                                >
                                  <PenLine className="h-3.5 w-3.5 mr-1" /> Написать статью
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Перейти к генерации статьи по этому ключевому слову</TooltipContent>
                            </Tooltip>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
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
                      {m.city ? `${m.city} • ` : ""}{m.total_keywords} запросов • {(m.clusters?.length || 0)} кластеров • {new Date(m.created_at).toLocaleDateString("ru-RU")}
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

        {/* Help dialog */}
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Как работает Карта тем</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-medium">🔍 Что делает инструмент</p>
                <p className="text-muted-foreground mt-1">
                  Анализирует поисковую выдачу и группирует запросы по смыслу - вы видите полную картину что ищут ваши потенциальные клиенты.
                </p>
              </div>
              <div>
                <p className="font-medium">📊 Что такое кластер</p>
                <p className="text-muted-foreground mt-1">
                  Группа похожих запросов под одну статью. Одна статья может ранжироваться по 10-50 запросам из одного кластера.
                </p>
              </div>
              <div>
                <p className="font-medium">🎯 Типы запросов</p>
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  <li>🛒 Купить - готов купить</li>
                  <li>💰 Сравнение - выбирает варианты</li>
                  <li>📚 Информация - изучает тему</li>
                </ul>
              </div>
              <div>
                <p className="font-medium">🟢 Сложность продвижения</p>
                <ul className="text-muted-foreground mt-1 space-y-0.5">
                  <li>Низкая - легко попасть в топ</li>
                  <li>Средняя - нужна хорошая статья</li>
                  <li>Высокая - сильные конкуренты</li>
                </ul>
              </div>
              <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
                <p className="font-medium">💡 Совет</p>
                <p className="text-muted-foreground mt-1">
                  Начинайте с кластеров "📚 Информация" + "🟢 Низкая" - быстрее получите первый трафик.
                </p>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Понятно!</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}