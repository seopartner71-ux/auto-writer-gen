import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { proxyAssetUrl } from "@/shared/utils/proxyAsset";
import {
  Image as ImageIcon, Wand2, Loader2, Download, Copy, RefreshCw, Lock,
  Trash2, ChevronDown, Sparkles, FileText, MessageSquare, Layers, FileEdit, X, Maximize2, FileCode,
} from "lucide-react";

type Mode = "prompt" | "h2" | "cover" | "edit";

interface GenImage {
  url: string;
  storage_path: string;
  label: string;
  prompt: string;
  enhanced_prompt?: string;
  raw_prompt?: string;
  index: number;
}

const ASPECT_RATIOS = ["16:9", "4:3", "1:1", "9:16", "3:2"];
const STYLES = ["Реалистичный бизнес", "Студийное фото", "Фото товара", "Редакционный", "Инфографика", "Flat-иллюстрация"];
const COUNTS = [1, 2, 4, 6];
const MOODS = ["Деловое", "Динамичное", "Минимализм"];

export default function ImageGeneratorPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const plan = (profile?.plan || "basic") as string;
  const isPro = plan === "pro" || plan === "factory";

  const [mode, setMode] = useState<Mode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [articleId, setArticleId] = useState<string>("");
  const [selectedH2, setSelectedH2] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mood, setMood] = useState(MOODS[0]);

  // EDIT mode state
  const [editFileName, setEditFileName] = useState<string>("");
  const [editSourceData, setEditSourceData] = useState<string>(""); // data: URL
  const [editInstruction, setEditInstruction] = useState<string>("");

  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [style, setStyle] = useState(STYLES[0]);
  const [count, setCount] = useState(1);
  const [model, setModel] = useState<"schnell" | "flux-pro">("schnell");

  // Prefill from query string (e.g. coming from /commercial: ?mode=cover&keyword=...)
  useEffect(() => {
    const qMode = searchParams.get("mode");
    const qPrompt = searchParams.get("prompt");
    const qKeyword = searchParams.get("keyword");
    const qTopic = searchParams.get("topic");
    if (qMode === "prompt" || qMode === "h2" || qMode === "cover" || qMode === "edit") setMode(qMode);
    if (qPrompt) setPrompt(qPrompt);
    if (qKeyword) setKeyword(qKeyword);
    if (qTopic) setTopic(qTopic);
    if (qMode || qPrompt || qKeyword || qTopic) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [images, setImages] = useState<GenImage[]>([]);
  const [inserting, setInserting] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label?: string; prompt?: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);
  const [promptView, setPromptView] = useState<{ raw?: string; enhanced?: string } | null>(null);

  // In H2 mode, effective count = selected H2 count (one image per heading)
  const effectiveCount = mode === "h2" ? Math.max(selectedH2.length, 1) : count;

  // Articles list for h2 mode
  const { data: articles = [] } = useQuery({
    queryKey: ["images-articles", profile?.id],
    enabled: !!profile?.id && mode === "h2",
    queryFn: async () => {
      const { data } = await supabase
        .from("articles")
        .select("id, title, content")
        .eq("user_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    },
  });

  // Session history
  const { data: history = [] } = useQuery({
    queryKey: ["images-history", profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("article_images")
        .select("id, public_url, prompt, created_at, mode")
        .eq("user_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(24);
      return data || [];
    },
  });

  const selectedArticle = useMemo(
    () => articles.find((a: any) => a.id === articleId),
    [articles, articleId],
  );

  const h2List = useMemo(() => {
    if (!selectedArticle?.content) return [] as string[];
    const lines = String(selectedArticle.content).split("\n");
    const out: string[] = [];
    for (const ln of lines) {
      const m = ln.match(/^##\s+(.+?)\s*$/);
      if (m) out.push(m[1].trim());
      const mh = ln.match(/^<h2[^>]*>(.+?)<\/h2>/i);
      if (mh) out.push(mh[1].replace(/<[^>]+>/g, "").trim());
    }
    return Array.from(new Set(out));
  }, [selectedArticle]);

  useEffect(() => { setSelectedH2([]); }, [articleId]);

  const toggleH2 = (h: string) => {
    setSelectedH2((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]);
  };

  const canGenerate = () => {
    if (generating) return false;
    if (mode === "prompt") return prompt.trim().length > 3;
    if (mode === "h2") return selectedH2.length > 0;
    if (mode === "cover") return topic.trim().length > 1;
    if (mode === "edit") return !!editSourceData && editInstruction.trim().length > 2;
    return false;
  };

  const callGenerate = async (overrideCount?: number, slotIndex?: number, customPrompt?: string) => {
    setGenerating(true);
    setProgress({ done: 0, total: overrideCount ?? count });
    try {
      const payload: any = {
        mode: customPrompt ? "prompt" : mode,
        aspect_ratio: aspectRatio,
        style,
        count: overrideCount ?? effectiveCount,
        model,
        article_id: articleId || null,
      };
      if (customPrompt) payload.prompt = customPrompt;
      else if (mode === "prompt") payload.prompt = prompt;
      else if (mode === "h2") { payload.h2_headings = selectedH2; payload.article_id = articleId; }
      else if (mode === "cover") { payload.topic = topic; payload.keyword = keyword; payload.mood = mood; }
      else if (mode === "edit") {
        payload.source_image = editSourceData;
        payload.edit_prompt = editInstruction;
        payload.count = 1;
      }

      const { data, error } = await supabase.functions.invoke("generate-image", { body: payload });
      if (error) throw error;
      if (!data?.images) throw new Error("Нет изображений в ответе");

      if (slotIndex !== undefined) {
        setImages((prev) => prev.map((img, i) => i === slotIndex ? { ...data.images[0], index: i } : img));
      } else {
        setImages(data.images);
      }
      toast.success("Изображение готово ✓");
      qc.invalidateQueries({ queryKey: ["images-history"] });
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Ошибка генерации - кредиты возвращены");
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const handleDownload = async (url: string, name: string) => {
    try {
      const r = await fetch(url);
      const blob = await r.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${name.replace(/[^a-z0-9-]+/gi, "_").slice(0, 40)}.jpg`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      toast.error("Не удалось скачать");
    }
  };

  const handleDownloadAll = async () => {
    for (let i = 0; i < images.length; i++) {
      await handleDownload(images[i].url, images[i].label || `image_${i + 1}`);
    }
  };

  const handleCopyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url);
    toast.success("URL скопирован");
  };

  const handleDeleteHistoryItem = async (id: string) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from("article_images").delete().eq("id", id);
      if (error) throw error;
      toast.success("Удалено из истории");
      qc.invalidateQueries({ queryKey: ["images-history"] });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось удалить");
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAllHistory = async () => {
    if (!profile?.id) return;
    setClearingAll(true);
    try {
      const { error } = await supabase.from("article_images").delete().eq("user_id", profile.id);
      if (error) throw error;
      toast.success("История очищена");
      qc.invalidateQueries({ queryKey: ["images-history"] });
    } catch (e: any) {
      toast.error(e?.message || "Не удалось очистить историю");
    } finally {
      setClearingAll(false);
    }
  };

  // Insert generated H2 images into the article content right before matching H2 headings.
  const handleInsertIntoArticle = async () => {
    if (!articleId || images.length === 0) return;
    setInserting(true);
    try {
      const { data: art, error: fetchErr } = await supabase
        .from("articles")
        .select("content")
        .eq("id", articleId)
        .maybeSingle();
      if (fetchErr || !art) throw fetchErr || new Error("Статья не найдена");

      let content = String(art.content || "");
      let inserted = 0;

      for (const img of images) {
        const heading = (img.label || "").trim();
        if (!heading) continue;
        const imgTag = `<img src="${img.url}" alt="${heading.replace(/"/g, "&quot;")}" loading="lazy" />\n\n`;
        const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const mdRe = new RegExp(`(^|\\n)(##\\s+${escaped}\\s*\\n)`, "i");
        const htmlRe = new RegExp(`(<h2[^>]*>\\s*${escaped}\\s*</h2>)`, "i");

        if (mdRe.test(content)) {
          content = content.replace(mdRe, (_m, p1, p2) => `${p1}${imgTag}${p2}`);
          inserted++;
        } else if (htmlRe.test(content)) {
          content = content.replace(htmlRe, (m) => `${imgTag}${m}`);
          inserted++;
        }
      }

      if (inserted === 0) {
        toast.error("Не нашёл H2-заголовков в статье");
        return;
      }

      const { error: upErr } = await supabase
        .from("articles")
        .update({ content })
        .eq("id", articleId);
      if (upErr) throw upErr;

      toast.success(`Вставлено ${inserted} изображени${inserted === 1 ? "е" : "й"} в статью`);
    } catch (e: any) {
      toast.error(e?.message || "Не удалось обновить статью");
    } finally {
      setInserting(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Topbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ImageIcon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Генератор изображений</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                FAL Flux
              </Badge>
              <span className="text-xs text-muted-foreground">{plan.toUpperCase()}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-medium">{profile?.credits_amount ?? 0}</span>
          <span className="text-muted-foreground">кредитов</span>
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { id: "prompt" as Mode, icon: MessageSquare, title: "По запросу", desc: "Свободное описание" },
          { id: "h2" as Mode, icon: FileText, title: "По H2-заголовкам", desc: "Из вашей статьи" },
          { id: "cover" as Mode, icon: Layers, title: "Обложка статьи", desc: "Тема + ключ + настроение" },
          { id: "edit" as Mode, icon: Wand2, title: "Редактировать фото", desc: "Загрузите и доработайте" },
        ].map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`text-left rounded-xl border p-4 transition-all ${
                active
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <m.icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium">{m.title}</div>
                  <div className="text-xs text-muted-foreground">{m.desc}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: settings */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Параметры</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {mode === "prompt" && (
                <div>
                  <Label className="text-xs">Описание</Label>
                  <Textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Реалистичное фото, деловая атмосфера, 4K, без AI-арта, без текста на изображении..."
                    rows={5}
                    className="mt-1.5"
                  />
                </div>
              )}

              {mode === "h2" && (
                <>
                  <div>
                    <Label className="text-xs">Статья</Label>
                    <Select value={articleId} onValueChange={setArticleId}>
                      <SelectTrigger className="mt-1.5">
                        <SelectValue placeholder="Выберите статью" />
                      </SelectTrigger>
                      <SelectContent>
                        {articles.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.title || "Без названия"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {h2List.length > 0 && (
                    <div>
                      <Label className="text-xs">H2-заголовки ({selectedH2.length} выбрано)</Label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-48 overflow-y-auto scrollbar-hide">
                        {h2List.map((h) => {
                          const sel = selectedH2.includes(h);
                          return (
                            <button
                              key={h}
                              onClick={() => toggleH2(h)}
                              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                                sel
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-card border-border hover:border-primary/40"
                              }`}
                            >
                              {h.slice(0, 50)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {articleId && h2List.length === 0 && (
                    <div className="text-xs text-muted-foreground">В статье не найдены H2-заголовки.</div>
                  )}
                </>
              )}

              {mode === "cover" && (
                <>
                  <div>
                    <Label className="text-xs">Тема статьи</Label>
                    <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="SEO для интернет-магазина" className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">Главное ключевое слово</Label>
                    <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="продвижение сайта" className="mt-1.5" />
                  </div>
                  <div>
                    <Label className="text-xs">Настроение</Label>
                    <Tabs value={mood} onValueChange={setMood} className="mt-1.5">
                      <TabsList className="grid grid-cols-3 w-full">
                        {MOODS.map((m) => <TabsTrigger key={m} value={m} className="text-xs">{m}</TabsTrigger>)}
                      </TabsList>
                    </Tabs>
                  </div>
                </>
              )}

              {mode === "edit" && (
                <>
                  <div>
                    <Label className="text-xs">Исходное фото</Label>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="mt-1.5 block w-full text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-primary file:text-primary-foreground file:cursor-pointer file:text-xs hover:file:bg-primary/90"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        if (f.size > 8 * 1024 * 1024) {
                          toast.error("Файл больше 8 МБ");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onload = () => {
                          setEditSourceData(String(reader.result || ""));
                          setEditFileName(f.name);
                        };
                        reader.onerror = () => toast.error("Не удалось прочитать файл");
                        reader.readAsDataURL(f);
                      }}
                    />
                    {editFileName && (
                      <div className="mt-1.5 text-[11px] text-muted-foreground truncate">{editFileName}</div>
                    )}
                    {editSourceData && (
                      <img
                        src={editSourceData}
                        alt="источник"
                        className="mt-2 rounded-md border w-full max-h-40 object-contain bg-muted/30"
                      />
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Что изменить</Label>
                    <Textarea
                      value={editInstruction}
                      onChange={(e) => setEditInstruction(e.target.value)}
                      placeholder="Например: убери фон, замени на белый студийный, добавь мягкий свет, сделай теплее, уменьши блики на товаре"
                      rows={4}
                      className="mt-1.5"
                    />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Редактирование через Nano Banana - 1 кредит за фото.
                    </div>
                  </div>
                </>
              )}

              {mode !== "edit" && (
              <div className="border-t pt-4 space-y-4">
                <div>
                  <Label className="text-xs">Соотношение сторон</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ASPECT_RATIOS.map((r) => (
                      <button
                        key={r}
                        onClick={() => setAspectRatio(r)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${
                          aspectRatio === r ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/40"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Стиль</Label>
                  <Select value={style} onValueChange={setStyle}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STYLES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-xs">Количество фото</Label>
                  <Select
                    value={String(effectiveCount)}
                    onValueChange={(v) => setCount(Number(v))}
                    disabled={mode === "h2"}
                  >
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(mode === "h2" ? [effectiveCount] : COUNTS).map((c) => (
                        <SelectItem key={c} value={String(c)}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {mode === "h2" && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Авто: 1 фото на каждый выбранный H2
                    </div>
                  )}
                </div>

                <div>
                  <Label className="text-xs">Модель</Label>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => setModel("schnell")}
                      className={`text-xs px-3 py-2 rounded-lg border transition ${
                        model === "schnell" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/40"
                      }`}
                    >
                      Schnell
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => {
                            if (!isPro) { toast.error("Flux Pro доступен на тарифе PRO и выше"); return; }
                            setModel("flux-pro");
                          }}
                          className={`text-xs px-3 py-2 rounded-lg border transition flex items-center justify-center gap-1.5 ${
                            model === "flux-pro" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border hover:border-primary/40"
                          } ${!isPro ? "opacity-60" : ""}`}
                        >
                          {!isPro && <Lock className="h-3 w-3" />}
                          Flux Pro
                        </button>
                      </TooltipTrigger>
                      {!isPro && <TooltipContent>Доступно на PRO и выше</TooltipContent>}
                    </Tooltip>
                  </div>
                </div>
              </div>
              )}

              <Button
                className="w-full"
                disabled={!canGenerate()}
                onClick={() => callGenerate()}
              >
                {generating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Генерация...</>
                ) : (
                  <><Wand2 className="mr-2 h-4 w-4" />{mode === "edit" ? "Применить правку" : "Сгенерировать"}</>
                )}
              </Button>
              <div className="text-center text-xs text-muted-foreground">
                Стоимость: {mode === "edit" ? 1 : effectiveCount} кредит{(mode === "edit" ? 1 : effectiveCount) === 1 ? "" : (mode === "edit" ? 1 : effectiveCount) < 5 ? "а" : "ов"}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: gallery */}
        <div className="lg:col-span-2 space-y-4">
          {generating && progress && (
            <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              Генерация изображения {progress.done + 1} / {progress.total}...
            </div>
          )}

          {images.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{images.length} изображени{images.length === 1 ? "е" : "й"}</div>
              <div className="flex gap-2">
                {mode === "h2" && articleId && (
                  <Button size="sm" variant="default" onClick={handleInsertIntoArticle} disabled={inserting}>
                    {inserting
                      ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      : <FileEdit className="h-3.5 w-3.5 mr-1.5" />}
                    Вставить в статью
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleDownloadAll}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />Скачать все
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setImages([])}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />Очистить
                </Button>
              </div>
            </div>
          )}

          {images.length === 0 && !generating ? (
            <Card className="border-dashed">
              <CardContent className="py-16 flex flex-col items-center text-center gap-3 text-muted-foreground">
                <ImageIcon className="h-12 w-12 opacity-40" />
                <div className="text-sm">Изображения появятся здесь</div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(generating && images.length === 0 ? Array.from({ length: count }) : images).map((img: any, i: number) => (
                <div key={i} className="group relative rounded-lg overflow-hidden border bg-card aspect-video">
                  {img?.url ? (
                    <>
                      <img
                        src={proxyAssetUrl(img.url)}
                        alt={img.label || "generated"}
                        className="w-full h-full object-cover cursor-zoom-in"
                        loading="lazy"
                        onClick={() => setPreview({ url: img.url, label: img.label, prompt: img.prompt })}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3 gap-2">
                        <div className="text-xs text-white truncate">{img.label}</div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setPreview({ url: img.url, label: img.label, prompt: img.prompt })}>
                            <Maximize2 className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="secondary" className="h-7 text-xs flex-1" onClick={() => handleDownload(img.url, img.label || `image_${i + 1}`)}>
                            <Download className="h-3 w-3 mr-1" />Скачать
                          </Button>
                          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => handleCopyUrl(img.url)}>
                            <Copy className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="secondary" className="h-7 text-xs" title="Промпт" onClick={() => setPromptView({ raw: img.raw_prompt, enhanced: img.enhanced_prompt || img.prompt })}>
                            <FileCode className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => callGenerate(1, i, img.prompt)} disabled={generating}>
                            <RefreshCw className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <Skeleton className="w-full h-full" />
                  )}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" className="w-full justify-between">
                  <span className="text-sm">История сессии ({history.length})</span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <div className="flex justify-end mb-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={clearingAll}>
                        {clearingAll ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                        Очистить историю
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Очистить всю историю?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Все сгенерированные изображения будут удалены из истории. Это действие нельзя отменить.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={handleClearAllHistory}>Удалить</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                  {history.map((h: any) => (
                    <div key={h.id} className="group relative aspect-square rounded-md overflow-hidden border hover:border-primary/40 transition">
                      <img
                        src={proxyAssetUrl(h.public_url)}
                        alt={h.prompt || ""}
                        className="w-full h-full object-cover cursor-zoom-in"
                        loading="lazy"
                        onClick={() => setPreview({ url: h.public_url, prompt: h.prompt })}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteHistoryItem(h.id); }}
                        disabled={deletingId === h.id}
                        className="absolute top-1 right-1 h-6 w-6 rounded-md bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
                        title="Удалить"
                      >
                        {deletingId === h.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </button>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>

      {/* Preview lightbox */}
      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl p-0 overflow-hidden bg-background/95 backdrop-blur">
          {preview && (
            <div className="relative">
              <img src={proxyAssetUrl(preview.url)} alt={preview.label || preview.prompt || ""} className="w-full h-auto max-h-[85vh] object-contain" />
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 flex items-end justify-between gap-3">
                <div className="text-xs text-white/90 line-clamp-2">
                  {preview.label && <div className="font-medium">{preview.label}</div>}
                  {preview.prompt && <div className="text-white/60">{preview.prompt}</div>}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" variant="secondary" onClick={() => handleCopyUrl(preview.url)}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" />URL
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => handleDownload(preview.url, preview.label || "image")}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />Скачать
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Prompt reveal dialog - shows the enhanced prompt actually sent to FAL */}
      <Dialog open={!!promptView} onOpenChange={(o) => !o && setPromptView(null)}>
        <DialogContent className="max-w-2xl">
          <div className="space-y-4">
            <div>
              <div className="text-sm font-medium mb-1">Промпт, отправленный в FAL</div>
              <div className="text-xs text-muted-foreground">
                Автоматически улучшен AI для максимального качества изображения.
              </div>
            </div>
            {promptView?.raw && (
              <div>
                <Label className="text-xs text-muted-foreground">Ваш ввод</Label>
                <Textarea readOnly value={promptView.raw} rows={2} className="mt-1.5 font-mono text-xs resize-none" />
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Улучшенный промпт</Label>
              <Textarea readOnly value={promptView?.enhanced || ""} rows={8} className="mt-1.5 font-mono text-xs" />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (promptView?.enhanced) {
                    navigator.clipboard.writeText(promptView.enhanced);
                    toast.success("Промпт скопирован");
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5 mr-1.5" />Копировать промпт
              </Button>
              <Button size="sm" onClick={() => setPromptView(null)}>Закрыть</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}