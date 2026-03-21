import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Wand2, Loader2, Hash, FileText, Save, Code2,
  CheckCircle2, Circle, BarChart3, BookOpen, Copy, Check, Download
} from "lucide-react";
import { toast } from "sonner";

// Readability helpers
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+/g) || []).length || 1;
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-zа-яё]/g, "");
  if (word.length <= 3) return 1;
  // Simple heuristic for Latin
  const matches = word.match(/[aeiouyаеёиоуыэюя]+/gi);
  return matches ? matches.length : 1;
}

function fleschScore(text: string): number {
  const words = countWords(text);
  if (words < 10) return 0;
  const sentences = countSentences(text);
  const syllables = text.split(/\s+/).reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function readabilityLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Легко", color: "text-success" };
  if (score >= 50) return { label: "Средне", color: "text-warning" };
  return { label: "Сложно", color: "text-destructive" };
}

export default function ArticlesPage() {
  const queryClient = useQueryClient();

  // Data fetching
  const { data: keywords = [] } = useQuery({
    queryKey: ["keywords-for-writer"],
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

  const { data: authorProfiles = [] } = useQuery({
    queryKey: ["author-profiles-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("author_profiles")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: savedArticles = [] } = useQuery({
    queryKey: ["articles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, status, created_at, keyword_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Auto-select single author profile
  useEffect(() => {
    if (authorProfiles.length === 1 && !selectedAuthorId) {
      setSelectedAuthorId(authorProfiles[0].id);
    }
  }, [authorProfiles]);

  // State
  const [selectedKeywordId, setSelectedKeywordId] = useState("");
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [outline, setOutline] = useState<{ text: string; level: string }[]>([]);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [schemaJson, setSchemaJson] = useState<string>("");
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedKeyword = keywords.find((k: any) => k.id === selectedKeywordId);
  const lsiKeywords: string[] = (selectedKeyword?.lsi_keywords as string[]) || [];

  // LSI keyword check
  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return lsiKeywords.map((kw) => ({
      keyword: kw,
      found: lower.includes(kw.toLowerCase()),
    }));
  }, [content, lsiKeywords]);

  const lsiFoundCount = lsiStatus.filter((s) => s.found).length;

  // SEO metrics
  const wordCount = useMemo(() => countWords(content), [content]);
  const readability = useMemo(() => fleschScore(content), [content]);
  const readInfo = readabilityLabel(readability);

  // Stream article generation
  const handleGenerate = useCallback(async () => {
    if (!selectedKeywordId) {
      toast.error("Выберите ключевое слово");
      return;
    }

    setIsStreaming(true);
    setContent("");
    setSchemaJson("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          keyword_id: selectedKeywordId,
          author_profile_id: selectedAuthorId || null,
          outline,
          lsi_keywords: lsiKeywords,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setContent(fullContent);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Auto-fill title and meta from generated content
      const h1Match = fullContent.match(/^#\s+(.+)$/m);
      if (h1Match) setTitle(h1Match[1]);

      // Auto-generate meta description from first paragraph
      const paragraphs = fullContent
        .replace(/^#.+$/gm, "")
        .split(/\n\n+/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 30);
      if (paragraphs.length > 0) {
        setMetaDescription(paragraphs[0].replace(/[*_#`]/g, "").slice(0, 160));
      }

      toast.success("Статья сгенерирована");
    } catch (e: any) {
      if (e.name === "AbortError") {
        toast.info("Генерация остановлена");
      } else {
        toast.error(e.message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [selectedKeywordId, selectedAuthorId, outline, lsiKeywords]);

  const handleStop = () => abortRef.current?.abort();

  // Save article
  const saveArticle = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const payload = {
        user_id: userId,
        keyword_id: selectedKeywordId || null,
        author_profile_id: selectedAuthorId || null,
        title: title || null,
        content,
        meta_description: metaDescription || null,
        seo_score: {
          readability,
          wordCount,
          lsiCoverage: lsiKeywords.length > 0 ? Math.round((lsiFoundCount / lsiKeywords.length) * 100) : 0,
        },
        status: "draft",
      };

      if (currentArticleId) {
        const { error } = await supabase
          .from("articles")
          .update(payload)
          .eq("id", currentArticleId);
        if (error) throw error;
        return currentArticleId;
      } else {
        const { data, error } = await supabase
          .from("articles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        return data.id;
      }
    },
    onSuccess: (id) => {
      setCurrentArticleId(id);
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      toast.success("Статья сохранена");
    },
    onError: (e) => toast.error(e.message),
  });

  // Generate schema
  const generateSchema = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-schema", {
        body: { title, content, keyword: selectedKeyword?.seed_keyword },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const schemas = [];
      if (data.article_schema) schemas.push(data.article_schema);
      if (data.faq_schema) schemas.push(data.faq_schema);
      setSchemaJson(JSON.stringify(schemas, null, 2));
      toast.success("JSON-LD Schema сгенерирована");
    },
    onError: (e) => toast.error(e.message),
  });

  const copySchema = () => {
    navigator.clipboard.writeText(schemaJson);
    setSchemaCopied(true);
    setTimeout(() => setSchemaCopied(false), 2000);
  };

  // Auto-fill fields when keyword changes
  useEffect(() => {
    if (!selectedKeywordId) {
      setOutline([]);
      setTitle("");
      setMetaDescription("");
      return;
    }
    const kw = keywords.find((k: any) => k.id === selectedKeywordId);
    if (!kw) return;

    // Auto-fill title from seed keyword
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    setTitle(capitalize(kw.seed_keyword));

    // Auto-fill meta description
    const intent = kw.intent || "informational";
    setMetaDescription(
      `${capitalize(kw.seed_keyword)} — ${intent === "informational" ? "полное руководство" : intent === "transactional" ? "лучшие предложения" : intent === "commercial" ? "сравнение и обзор" : "всё что нужно знать"}. ${(kw.lsi_keywords as string[] || []).slice(0, 3).join(", ")}.`.slice(0, 160)
    );

    // Auto-fill outline from questions
    if (kw.questions) {
      const items = (kw.questions as string[]).map((q: string) => ({ text: q, level: "h2" }));
      setOutline(items);
    }
  }, [selectedKeywordId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">AI Writer</h1>
          <p className="text-sm text-muted-foreground">
            Генератор SEO-контента с динамическим выбором модели
          </p>
        </div>
      </div>

      {/* Configuration */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ключевое слово</Label>
            <Select value={selectedKeywordId} onValueChange={setSelectedKeywordId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите..." />
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
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Профиль автора</Label>
            <Select value={selectedAuthorId} onValueChange={setSelectedAuthorId}>
              <SelectTrigger>
                <SelectValue placeholder="Без стиля" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без стиля</SelectItem>
                {authorProfiles.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.niche ? `(${a.niche})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">&nbsp;</Label>
            {isStreaming ? (
              <Button variant="destructive" onClick={handleStop} className="w-full">
                Остановить
              </Button>
            ) : (
              <Button
                onClick={handleGenerate}
                disabled={!selectedKeywordId}
                className="w-full gap-2"
              >
                <Wand2 className="h-4 w-4" />
                Generate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Title & Meta */}
          <Card className="bg-card border-border">
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Заголовок (H1)</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Заголовок статьи..."
                  className="text-lg font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Meta Description
                  <span className="ml-2 text-muted-foreground/60">
                    ({metaDescription.length}/160)
                  </span>
                </Label>
                <Input
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="SEO описание страницы..."
                  maxLength={160}
                />
              </div>
            </CardContent>
          </Card>

          {/* Content Editor */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" />
                  Контент
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveArticle.mutate()}
                    disabled={!content || saveArticle.isPending}
                  >
                    <Save className="h-3 w-3 mr-1" />
                    {saveArticle.isPending ? "..." : "Сохранить"}
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isStreaming && (
                <div className="flex items-center gap-2 mb-3 text-sm text-primary">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Генерация текста...</span>
                </div>
              )}
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Нажмите Generate для создания контента или введите текст вручную..."
                className="min-h-[500px] font-mono text-sm leading-relaxed resize-y"
              />
            </CardContent>
          </Card>

          {/* JSON-LD Schema */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-primary" />
                  JSON-LD Schema
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => generateSchema.mutate()}
                    disabled={!content || generateSchema.isPending}
                  >
                    {generateSchema.isPending ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Code2 className="h-3 w-3 mr-1" />
                    )}
                    Generate Schema
                  </Button>
                  {schemaJson && (
                    <Button variant="ghost" size="sm" onClick={copySchema}>
                      {schemaCopied ? (
                        <Check className="h-3 w-3 mr-1" />
                      ) : (
                        <Copy className="h-3 w-3 mr-1" />
                      )}
                      {schemaCopied ? "Скопировано" : "Копировать"}
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            {schemaJson && (
              <CardContent>
                <pre className="bg-muted rounded-md p-4 text-xs overflow-x-auto max-h-[300px] overflow-y-auto font-mono">
                  {schemaJson}
                </pre>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right: SEO Dashboard */}
        <div className="space-y-4">
          {/* Word count & readability */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                SEO Dashboard
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Слова</span>
                  <span className="font-mono">{wordCount.toLocaleString()}</span>
                </div>
                <Progress
                  value={Math.min(100, (wordCount / 2000) * 100)}
                  className="h-2"
                />
                <p className="text-[10px] text-muted-foreground mt-1">Рекомендовано: 1500-2500</p>
              </div>

              <Separator />

              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Читаемость</span>
                  <span className={`font-semibold ${readInfo.color}`}>
                    {readability} — {readInfo.label}
                  </span>
                </div>
                <Progress value={readability} className="h-2" />
                <p className="text-[10px] text-muted-foreground mt-1">Flesch Reading Ease</p>
              </div>

              <Separator />

              <div>
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>LSI покрытие</span>
                  <span className="font-mono">
                    {lsiFoundCount}/{lsiKeywords.length}
                  </span>
                </div>
                <Progress
                  value={lsiKeywords.length > 0 ? (lsiFoundCount / lsiKeywords.length) * 100 : 0}
                  className="h-2"
                />
              </div>
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
              {lsiStatus.length > 0 ? (
                <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                  {lsiStatus.map((item, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                        item.found
                          ? "bg-success/10 text-success"
                          : "bg-muted/50 text-muted-foreground"
                      }`}
                    >
                      {item.found ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                      ) : (
                        <Circle className="h-3 w-3 shrink-0" />
                      )}
                      <span className="font-mono">{item.keyword}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  Выберите ключевое слово для отображения LSI
                </p>
              )}
            </CardContent>
          </Card>

          {/* Saved Articles */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Сохранённые статьи
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {savedArticles.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {savedArticles.length > 0 ? (
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                  {savedArticles.slice(0, 10).map((a: any) => (
                    <button
                      key={a.id}
                      className="w-full text-left text-xs rounded-md px-2 py-1.5 bg-muted/50 hover:bg-muted/80 transition-colors truncate"
                      onClick={async () => {
                        const { data } = await supabase
                          .from("articles")
                          .select("*")
                          .eq("id", a.id)
                          .single();
                        if (data) {
                          setCurrentArticleId(data.id);
                          setTitle(data.title || "");
                          setContent(data.content || "");
                          setMetaDescription(data.meta_description || "");
                          if (data.keyword_id) setSelectedKeywordId(data.keyword_id);
                          if (data.author_profile_id) setSelectedAuthorId(data.author_profile_id);
                        }
                      }}
                    >
                      <span className="font-medium">{a.title || "Без названия"}</span>
                      <span className="text-muted-foreground ml-1">({a.status})</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Нет сохранённых статей
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
