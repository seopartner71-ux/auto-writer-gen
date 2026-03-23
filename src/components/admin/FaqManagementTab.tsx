import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Plus, Trash2, Pencil, Save, X, FolderPlus, BookOpen, FileText, Loader2, GripVertical,
} from "lucide-react";
import { toast } from "sonner";

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
  created_at: string;
  updated_at: string;
}

export function FaqManagementTab() {
  const queryClient = useQueryClient();

  // Category state
  const [newCatTitle, setNewCatTitle] = useState("");
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editCatTitle, setEditCatTitle] = useState("");

  // Article state
  const [editingArticle, setEditingArticle] = useState<Partial<FaqArticle> | null>(null);
  const [isCreatingArticle, setIsCreatingArticle] = useState(false);

  const { data: categories = [], isLoading: loadingCats } = useQuery({
    queryKey: ["admin-faq-categories"],
    queryFn: async () => {
      const { data } = await supabase.from("faq_categories").select("*").order("sort_order");
      return (data || []) as FaqCategory[];
    },
  });

  const { data: articles = [], isLoading: loadingArticles } = useQuery({
    queryKey: ["admin-faq-articles"],
    queryFn: async () => {
      const { data } = await supabase.from("faq_articles").select("*").order("sort_order");
      return (data || []) as FaqArticle[];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-faq-categories"] });
    queryClient.invalidateQueries({ queryKey: ["admin-faq-articles"] });
    queryClient.invalidateQueries({ queryKey: ["faq-categories"] });
    queryClient.invalidateQueries({ queryKey: ["faq-articles"] });
  };

  // ---- Category CRUD ----
  const addCategory = async () => {
    if (!newCatTitle.trim()) return;
    const slug = newCatTitle.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "");
    const { error } = await supabase.from("faq_categories").insert({
      title: newCatTitle.trim(),
      slug,
      sort_order: categories.length,
    });
    if (error) { toast.error("Ошибка: " + error.message); return; }
    setNewCatTitle("");
    invalidate();
    toast.success("Категория создана");
  };

  const updateCategory = async (id: string) => {
    if (!editCatTitle.trim()) return;
    const { error } = await supabase.from("faq_categories").update({ title: editCatTitle.trim() }).eq("id", id);
    if (error) { toast.error("Ошибка: " + error.message); return; }
    setEditingCatId(null);
    invalidate();
    toast.success("Категория обновлена");
  };

  const deleteCategory = async (id: string) => {
    const count = articles.filter((a) => a.category_id === id).length;
    if (count > 0 && !window.confirm(`В категории ${count} статей. Удалить всё?`)) return;
    const { error } = await supabase.from("faq_categories").delete().eq("id", id);
    if (error) { toast.error("Ошибка: " + error.message); return; }
    invalidate();
    toast.success("Категория удалена");
  };

  // ---- Article CRUD ----
  const startNewArticle = () => {
    setIsCreatingArticle(true);
    setEditingArticle({
      category_id: categories[0]?.id || "",
      title: "",
      slug: "",
      content: "",
      sort_order: 0,
      is_published: true,
    });
  };

  const saveArticle = async () => {
    if (!editingArticle?.title?.trim() || !editingArticle?.category_id) {
      toast.error("Заполните название и категорию");
      return;
    }
    const slug = editingArticle.slug?.trim() ||
      editingArticle.title.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "");

    if (isCreatingArticle) {
      const { error } = await supabase.from("faq_articles").insert({
        category_id: editingArticle.category_id,
        title: editingArticle.title.trim(),
        slug,
        content: editingArticle.content || "",
        sort_order: editingArticle.sort_order || 0,
        is_published: editingArticle.is_published ?? true,
      });
      if (error) { toast.error("Ошибка: " + error.message); return; }
      toast.success("Статья создана");
    } else {
      const { error } = await supabase.from("faq_articles").update({
        category_id: editingArticle.category_id,
        title: editingArticle.title.trim(),
        slug,
        content: editingArticle.content || "",
        sort_order: editingArticle.sort_order || 0,
        is_published: editingArticle.is_published ?? true,
      }).eq("id", editingArticle.id!);
      if (error) { toast.error("Ошибка: " + error.message); return; }
      toast.success("Статья обновлена");
    }

    setEditingArticle(null);
    setIsCreatingArticle(false);
    invalidate();
  };

  const deleteArticle = async (id: string) => {
    const { error } = await supabase.from("faq_articles").delete().eq("id", id);
    if (error) { toast.error("Ошибка: " + error.message); return; }
    invalidate();
    toast.success("Статья удалена");
  };

  if (loadingCats || loadingArticles) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- Categories management ---- */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Категории
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Новая категория..."
              value={newCatTitle}
              onChange={(e) => setNewCatTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              className="flex-1"
            />
            <Button size="sm" onClick={addCategory} disabled={!newCatTitle.trim()}>
              <FolderPlus className="h-4 w-4 mr-1" /> Добавить
            </Button>
          </div>

          <div className="space-y-1.5">
            {categories.map((cat) => (
              <div key={cat.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                {editingCatId === cat.id ? (
                  <>
                    <Input
                      value={editCatTitle}
                      onChange={(e) => setEditCatTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && updateCategory(cat.id)}
                      className="h-7 text-sm flex-1"
                    />
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updateCategory(cat.id)}>
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingCatId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="text-sm flex-1">{cat.title}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {articles.filter((a) => a.category_id === cat.id).length}
                    </Badge>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => { setEditingCatId(cat.id); setEditCatTitle(cat.title); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteCategory(cat.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {categories.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">Нет категорий</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* ---- Articles management ---- */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Статьи Wiki ({articles.length})
          </CardTitle>
          <Button size="sm" onClick={startNewArticle} disabled={categories.length === 0}>
            <Plus className="h-4 w-4 mr-1" /> Новая статья
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {categories.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-3">
              Сначала создайте хотя бы одну категорию
            </p>
          )}

          {/* Article editor */}
          {editingArticle && (
            <Card className="bg-muted/30 border-primary/20">
              <CardContent className="pt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Название</Label>
                    <Input
                      value={editingArticle.title || ""}
                      onChange={(e) => setEditingArticle({ ...editingArticle, title: e.target.value })}
                      placeholder="Как создать статью"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Категория</Label>
                    <Select
                      value={editingArticle.category_id || ""}
                      onValueChange={(v) => setEditingArticle({ ...editingArticle, category_id: v })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">{"Содержание (Markdown: # ## ### - > **bold**)"}</Label>
                  <Textarea
                    value={editingArticle.content || ""}
                    onChange={(e) => setEditingArticle({ ...editingArticle, content: e.target.value })}
                    placeholder="# Заголовок&#10;&#10;Текст статьи...&#10;&#10;## Подзаголовок&#10;- Пункт 1&#10;- Пункт 2"
                    rows={12}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={editingArticle.is_published ?? true}
                      onCheckedChange={(v) => setEditingArticle({ ...editingArticle, is_published: v })}
                    />
                    <Label className="text-xs">Опубликовано</Label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost" size="sm"
                      onClick={() => { setEditingArticle(null); setIsCreatingArticle(false); }}
                    >
                      Отмена
                    </Button>
                    <Button size="sm" onClick={saveArticle}>
                      <Save className="h-4 w-4 mr-1" />
                      {isCreatingArticle ? "Создать" : "Сохранить"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Article list */}
          <div className="space-y-1.5">
            {articles.map((article) => {
              const cat = categories.find((c) => c.id === article.category_id);
              return (
                <div key={article.id} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-muted/50 group">
                  <FileText className="h-4 w-4 text-muted-foreground/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{article.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {cat?.title} · {new Date(article.updated_at).toLocaleDateString("ru-RU")}
                    </p>
                  </div>
                  {!article.is_published && (
                    <Badge variant="outline" className="text-[10px] text-warning">Черновик</Badge>
                  )}
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => { setEditingArticle(article); setIsCreatingArticle(false); }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon" variant="ghost"
                    className="h-7 w-7 text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteArticle(article.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {articles.length === 0 && categories.length > 0 && (
              <p className="text-xs text-muted-foreground text-center py-3">Нет статей</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
