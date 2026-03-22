import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Wand2, GripVertical, Plus, Trash2, ChevronRight, Loader2,
  Target, Lightbulb, HelpCircle, Hash, ListTree, ArrowRight,
  ExternalLink, BarChart3, FileText
} from "lucide-react";
import { ExpertInsightsBlock } from "@/components/plan/ExpertInsightsBlock";
import { toast } from "sonner";

interface InsightItem {
  id: string;
  text: string;
  type: "topic" | "gap" | "question" | "heading";
}

interface OutlineItem {
  id: string;
  text: string;
  level: "h1" | "h2" | "h3";
}

export default function PlanBuilderPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  // Fetch keywords with analysis data
  const { data: keywords = [] } = useQuery({
    queryKey: ["keywords-with-analysis"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("*")
        .not("intent", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const [selectedKeywordId, setSelectedKeywordId] = useState<string>("");
  const [insights, setInsights] = useState<InsightItem[]>([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [lsiKeywords, setLsiKeywords] = useState<string[]>([]);
  const [draggedItem, setDraggedItem] = useState<InsightItem | null>(null);
  const [newHeading, setNewHeading] = useState("");
  const [newLevel, setNewLevel] = useState<"h2" | "h3">("h2");

  const selectedKeyword = keywords.find((k: any) => k.id === selectedKeywordId);

  // Load insights when keyword changes
  useEffect(() => {
    if (!selectedKeyword) {
      setInsights([]);
      setLsiKeywords([]);
      setOutline([]);
      return;
    }

    const items: InsightItem[] = [];

    // Must-cover topics
    if (selectedKeyword.must_cover_topics) {
      (selectedKeyword.must_cover_topics as string[]).forEach((t: string, i: number) => {
        items.push({ id: `topic-${i}`, text: t, type: "topic" });
      });
    }

    // Content gaps
    if (selectedKeyword.content_gaps) {
      const gaps = selectedKeyword.content_gaps as any[];
      gaps.forEach((g: any, i: number) => {
        items.push({ id: `gap-${i}`, text: `${g.topic} — ${g.reason}`, type: "gap" });
      });
    }

    // Questions
    if (selectedKeyword.questions) {
      (selectedKeyword.questions as string[]).forEach((q: string, i: number) => {
        items.push({ id: `q-${i}`, text: q, type: "question" });
      });
    }

    // Recommended headings from AI analysis
    if (selectedKeyword.recommended_headings) {
      (selectedKeyword.recommended_headings as string[]).forEach((h: string, i: number) => {
        items.push({ id: `rec-${i}`, text: h, type: "heading" });
      });
    }

    setInsights(items);
    setLsiKeywords((selectedKeyword.lsi_keywords as string[]) || []);
    setOutline([]);
  }, [selectedKeywordId]);

  // Fetch SERP results for competitor structure
  const { data: serpResults = [] } = useQuery({
    queryKey: ["serp-results", selectedKeywordId],
    queryFn: async () => {
      if (!selectedKeywordId) return [];
      const { data, error } = await supabase
        .from("serp_results")
        .select("*")
        .eq("keyword_id", selectedKeywordId)
        .order("position", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedKeywordId,
  });

  // Drag handlers
  const handleDragStart = (item: InsightItem) => setDraggedItem(item);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedItem) return;
    const newOutlineItem: OutlineItem = {
      id: `outline-${Date.now()}`,
      text: draggedItem.text,
      level: draggedItem.type === "question" ? "h3" : "h2",
    };
    setOutline((prev) => [...prev, newOutlineItem]);
    setInsights((prev) => prev.filter((i) => i.id !== draggedItem.id));
    setDraggedItem(null);
  };

  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  const removeFromOutline = (id: string) => {
    setOutline((prev) => prev.filter((i) => i.id !== id));
  };

  const moveItem = (index: number, direction: "up" | "down") => {
    const newOutline = [...outline];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newOutline.length) return;
    [newOutline[index], newOutline[swapIndex]] = [newOutline[swapIndex], newOutline[index]];
    setOutline(newOutline);
  };

  const changeLevel = (id: string, level: "h1" | "h2" | "h3") => {
    setOutline((prev) => prev.map((i) => (i.id === id ? { ...i, level } : i)));
  };

  const addManualHeading = () => {
    if (!newHeading.trim()) return;
    setOutline((prev) => [
      ...prev,
      { id: `manual-${Date.now()}`, text: newHeading.trim(), level: newLevel },
    ]);
    setNewHeading("");
  };

  // AI Autopilot
  const autopilot = useMutation({
    mutationFn: async () => {
      if (!selectedKeywordId) throw new Error("Выберите ключевое слово");
      if (!session?.access_token) throw new Error("Сессия истекла, войдите снова");

      const { data, error } = await supabase.functions.invoke("generate-outline", {
        body: {
          keyword_id: selectedKeywordId,
          existing_outline: outline.map((o) => ({ text: o.text, level: o.level })),
          serp_titles: serpResults.map((s: any) => s.title).filter(Boolean),
          questions: selectedKeyword?.questions || [],
          lsi_keywords: lsiKeywords,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const newOutline: OutlineItem[] = data.outline.map((item: any, i: number) => ({
        id: `ai-${Date.now()}-${i}`,
        text: item.text,
        level: item.level,
      }));
      setOutline(newOutline);
      if (data.lsi_keywords) setLsiKeywords(data.lsi_keywords);
      toast.success("AI сгенерировал план статьи");
    },
    onError: (e) => toast.error(e.message),
  });

  const typeIcons: Record<string, React.ReactNode> = {
    topic: <Target className="h-3 w-3 text-success" />,
    gap: <Lightbulb className="h-3 w-3 text-warning" />,
    question: <HelpCircle className="h-3 w-3 text-info" />,
    heading: <ListTree className="h-3 w-3 text-primary" />,
  };

  const typeLabels: Record<string, string> = {
    topic: "Тема",
    gap: "Gap",
    question: "Вопрос",
    heading: "Заголовок",
  };

  const levelStyles: Record<string, string> = {
    h1: "text-base font-bold pl-0",
    h2: "text-sm font-semibold pl-4",
    h3: "text-sm pl-8 text-muted-foreground",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListTree className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Структура статьи</h1>
          <p className="text-sm text-muted-foreground">
            Построение структуры статьи на основе AI-анализа
          </p>
        </div>
      </div>

      {/* Keyword Selector */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-end gap-4">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ключевое слово (из исследования)</Label>
            <Select value={selectedKeywordId} onValueChange={setSelectedKeywordId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите исследованное ключевое слово..." />
              </SelectTrigger>
              <SelectContent>
                {keywords.map((k: any) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.seed_keyword} — {k.intent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            onClick={() => autopilot.mutate()}
            disabled={!selectedKeywordId || autopilot.isPending}
            className="gap-2"
          >
            {autopilot.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            AI Autopilot
          </Button>
        </div>
      </div>

      {selectedKeywordId ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: AI Insights */}
          <div className="space-y-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-warning" />
                  AI Insights
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    Перетащите →
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 max-h-[500px] overflow-y-auto">
                {insights.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    Нет данных. Сначала проведите Smart Research.
                  </p>
                ) : (
                  insights.map((item) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={() => handleDragStart(item)}
                      className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 cursor-grab hover:bg-muted/80 transition-colors group"
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground/50 group-hover:text-muted-foreground" />
                      {typeIcons[item.type]}
                      <span className="text-sm flex-1 truncate">{item.text}</span>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {typeLabels[item.type]}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100"
                        onClick={() => {
                          const newItem: OutlineItem = {
                            id: `outline-${Date.now()}`,
                            text: item.text,
                            level: item.type === "question" ? "h3" : "h2",
                          };
                          setOutline((prev) => [...prev, newItem]);
                          setInsights((prev) => prev.filter((i) => i.id !== item.id));
                        }}
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* LSI Keywords */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Hash className="h-4 w-4 text-primary" />
                  LSI-ключевые слова
                </CardTitle>
              </CardHeader>
              <CardContent>
                {lsiKeywords.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {lsiKeywords.map((kw, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-mono">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-2">
                    Нет LSI-ключей
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Competitor Structure from SERP */}
            {serpResults.length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    Структура конкурентов (ТОП)
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {serpResults.length} сайтов
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[350px] overflow-y-auto">
                  {serpResults.slice(0, 5).map((sr: any) => (
                    <div key={sr.id} className="rounded-md bg-muted/40 p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                            #{sr.position}
                          </span>
                          <span className="text-xs font-medium truncate">{sr.title}</span>
                        </div>
                        {sr.url && (
                          <a
                            href={sr.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0"
                          >
                            <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-primary" />
                          </a>
                        )}
                      </div>
                      {sr.snippet && (
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {sr.snippet}
                        </p>
                      )}
                      {/* Add competitor title as heading suggestion */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2 gap-1"
                        onClick={() => {
                          const newItem: OutlineItem = {
                            id: `comp-${Date.now()}-${sr.position}`,
                            text: sr.title,
                            level: "h2",
                          };
                          setOutline((prev) => [...prev, newItem]);
                        }}
                      >
                        <ArrowRight className="h-3 w-3" />
                        В план
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Expert Insights — Content Gap Analysis */}
            <ExpertInsightsBlock
              keywordId={selectedKeywordId}
              onAddToOutline={(text, level) => {
                setOutline((prev) => [
                  ...prev,
                  { id: `gap-${Date.now()}`, text, level },
                ]);
              }}
            />
          </div>

          {/* Right: Article Structure */}
          <div className="space-y-4">
            <Card
              className="bg-card border-border border-2 border-dashed min-h-[300px]"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ListTree className="h-4 w-4 text-primary" />
                  Структура статьи
                  <Badge variant="secondary" className="ml-auto text-[10px]">
                    {outline.length} элементов
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {outline.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ChevronRight className="h-8 w-8 opacity-20 mb-2" />
                    <p className="text-sm">Перетащите элементы сюда</p>
                    <p className="text-xs mt-1">или нажмите AI Autopilot</p>
                  </div>
                ) : (
                  outline.map((item, index) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 group ${levelStyles[item.level]}`}
                    >
                      <Select
                        value={item.level}
                        onValueChange={(v) => changeLevel(item.id, v as "h1" | "h2" | "h3")}
                      >
                        <SelectTrigger className="w-14 h-6 text-[10px] border-0 bg-transparent px-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="h1">H1</SelectItem>
                          <SelectItem value="h2">H2</SelectItem>
                          <SelectItem value="h3">H3</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="flex-1 text-sm">{item.text}</span>
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => moveItem(index, "up")}
                          disabled={index === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => moveItem(index, "down")}
                          disabled={index === outline.length - 1}
                        >
                          ↓
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 text-destructive"
                          onClick={() => removeFromOutline(item.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Manual add */}
            <Card className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex gap-2">
                  <Select value={newLevel} onValueChange={(v) => setNewLevel(v as "h2" | "h3")}>
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="h2">H2</SelectItem>
                      <SelectItem value="h3">H3</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Добавить заголовок вручную..."
                    value={newHeading}
                    onChange={(e) => setNewHeading(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addManualHeading()}
                  />
                  <Button size="icon" onClick={addManualHeading} disabled={!newHeading.trim()}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Navigation to Article Generator */}
          <div className="flex justify-end pt-4 lg:col-span-2">
            <Button
              size="lg"
              className="gap-2"
              disabled={outline.length === 0}
              onClick={() => navigate("/articles")}
            >
              <FileText className="h-4 w-4" />
              Перейти к генерации статьи
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <ListTree className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">Выберите исследованное ключевое слово</p>
          <p className="text-xs mt-1">Сначала проведите Smart Research в разделе «Ключевые слова»</p>
        </div>
      )}
    </div>
  );
}
