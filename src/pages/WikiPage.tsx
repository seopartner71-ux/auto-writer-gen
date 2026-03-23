import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Search, BookOpen, ChevronRight, FileText, FolderOpen,
  Loader2, BookMarked,
} from "lucide-react";

interface FaqCategory {
  id: string;
  title: string;
  slug: string;
  icon: string | null;
  sort_order: number;
}

interface FaqArticle {
  id: string;
  category_id: string;
  title: string;
  slug: string;
  content: string;
  sort_order: number;
  is_published: boolean;
  updated_at: string;
}

export default function WikiPage() {
  const [search, setSearch] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);

  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ["faq-categories"],
    queryFn: async () => {
      const { data } = await supabase
        .from("faq_categories")
        .select("*")
        .order("sort_order");
      return (data || []) as FaqCategory[];
    },
  });

  const { data: articles = [], isLoading: loadingArticles } = useQuery({
    queryKey: ["faq-articles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("faq_articles")
        .select("*")
        .eq("is_published", true)
        .order("sort_order");
      return (data || []) as FaqArticle[];
    },
  });

  const filtered = useMemo(() => {
    let list = articles;
    if (selectedCategoryId) {
      list = list.filter((a) => a.category_id === selectedCategoryId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.content.toLowerCase().includes(q)
      );
    }
    return list;
  }, [articles, selectedCategoryId, search]);

  const selectedArticle = selectedArticleId
    ? articles.find((a) => a.id === selectedArticleId)
    : null;

  const articleCountByCategory = useMemo(() => {
    const map: Record<string, number> = {};
    articles.forEach((a) => {
      map[a.category_id] = (map[a.category_id] || 0) + 1;
    });
    return map;
  }, [articles]);

  const isLoading = loadingCats || loadingArticles;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  // Render article content (simple markdown-like)
  function renderContent(content: string) {
    return content.split("\n").map((line, i) => {
      if (line.startsWith("### ")) {
        return <h3 key={i} className="text-lg font-semibold mt-6 mb-2 text-foreground">{line.slice(4)}</h3>;
      }
      if (line.startsWith("## ")) {
        return <h2 key={i} className="text-xl font-bold mt-8 mb-3 text-foreground">{line.slice(3)}</h2>;
      }
      if (line.startsWith("# ")) {
        return <h1 key={i} className="text-2xl font-bold mt-8 mb-4 text-foreground">{line.slice(2)}</h1>;
      }
      if (line.startsWith("- ")) {
        return <li key={i} className="ml-4 text-sm text-muted-foreground list-disc">{line.slice(2)}</li>;
      }
      if (line.startsWith("> ")) {
        return (
          <blockquote key={i} className="border-l-4 border-primary/30 pl-4 my-3 text-sm text-muted-foreground italic">
            {line.slice(2)}
          </blockquote>
        );
      }
      if (line.trim() === "") {
        return <br key={i} />;
      }
      // Bold **text**
      const parts = line.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-1">
          {parts.map((part, j) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={j} className="text-foreground font-medium">{part.slice(2, -2)}</strong>
            ) : (
              part
            )
          )}
        </p>
      );
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BookMarked className="h-6 w-6 text-primary" />
            База знаний
          </h1>
          <p className="text-muted-foreground mt-1">
            Документация и руководства по использованию платформы
          </p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Поиск по базе знаний..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedArticleId(null);
          }}
          className="pl-9"
        />
      </div>

      {categories.length === 0 && articles.length === 0 ? (
        <Card className="bg-card border-border border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center space-y-3">
            <BookOpen className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">База знаний пока пуста</p>
            <p className="text-xs text-muted-foreground/60">
              Администратор может добавить статьи через панель управления
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Categories sidebar */}
          <div className="space-y-2">
            <button
              onClick={() => {
                setSelectedCategoryId(null);
                setSelectedArticleId(null);
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                !selectedCategoryId
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <FolderOpen className="h-4 w-4 shrink-0" />
              <span>Все разделы</span>
              <Badge variant="secondary" className="ml-auto text-[10px]">
                {articles.length}
              </Badge>
            </button>

            <Separator />

            <ScrollArea className="max-h-[60vh]">
              <div className="space-y-1">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setSelectedArticleId(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedCategoryId === cat.id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <BookOpen className="h-4 w-4 shrink-0" />
                    <span className="truncate text-left">{cat.title}</span>
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {articleCountByCategory[cat.id] || 0}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Content area */}
          <div>
            {selectedArticle ? (
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                    <button
                      onClick={() => setSelectedArticleId(null)}
                      className="hover:text-primary transition-colors"
                    >
                      {categories.find((c) => c.id === selectedArticle.category_id)?.title || "Все"}
                    </button>
                    <ChevronRight className="h-3 w-3" />
                    <span className="text-foreground">{selectedArticle.title}</span>
                  </div>
                  <CardTitle className="text-xl">{selectedArticle.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Обновлено: {new Date(selectedArticle.updated_at).toLocaleDateString("ru-RU")}
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none">
                    {renderContent(selectedArticle.content)}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {filtered.length === 0 ? (
                  <Card className="bg-card border-border border-dashed">
                    <CardContent className="py-12 text-center">
                      <Search className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">
                        {search ? "Ничего не найдено" : "В этом разделе пока нет статей"}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  filtered.map((article) => {
                    const cat = categories.find((c) => c.id === article.category_id);
                    return (
                      <button
                        key={article.id}
                        onClick={() => setSelectedArticleId(article.id)}
                        className="w-full text-left"
                      >
                        <Card className="bg-card border-border hover:border-primary/30 hover:shadow-sm transition-all cursor-pointer">
                          <CardContent className="py-4 px-5 flex items-center gap-3">
                            <FileText className="h-5 w-5 text-primary/60 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {article.title}
                              </p>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {article.content.slice(0, 120).replace(/[#*>-]/g, "")}...
                              </p>
                            </div>
                            {cat && (
                              <Badge variant="outline" className="text-[10px] shrink-0">
                                {cat.title}
                              </Badge>
                            )}
                            <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
