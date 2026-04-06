import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileText, Save } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SLUGS = ["offer", "privacy", "terms", "cookies"] as const;
const LABELS: Record<string, string> = {
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
  terms: "Пользовательское соглашение",
  cookies: "Политика Cookie",
};

export function LegalPagesTab() {
  const qc = useQueryClient();
  const [activeSlug, setActiveSlug] = useState<string>("offer");

  const { data: pages, isLoading } = useQuery({
    queryKey: ["legal-pages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("legal_pages").select("*");
      if (error) throw error;
      return data;
    },
  });

  const [edits, setEdits] = useState<Record<string, { title: string; content: string }>>({});

  const getPage = (slug: string) => pages?.find((p) => p.slug === slug);
  const getEdit = (slug: string) => edits[slug];

  const getValue = (slug: string, field: "title" | "content") => {
    const edit = getEdit(slug);
    if (edit) return edit[field];
    const page = getPage(slug);
    return page?.[field] ?? "";
  };

  const setField = (slug: string, field: "title" | "content", value: string) => {
    setEdits((prev) => ({
      ...prev,
      [slug]: {
        title: prev[slug]?.title ?? getPage(slug)?.title ?? "",
        content: prev[slug]?.content ?? getPage(slug)?.content ?? "",
        [field]: value,
      },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: async (slug: string) => {
      const edit = getEdit(slug);
      if (!edit) return;
      const { error } = await supabase
        .from("legal_pages")
        .update({ title: edit.title, content: edit.content, updated_at: new Date().toISOString() })
        .eq("slug", slug);
      if (error) throw error;
    },
    onSuccess: (_, slug) => {
      toast.success(`Страница "${LABELS[slug]}" сохранена`);
      qc.invalidateQueries({ queryKey: ["legal-pages"] });
      qc.invalidateQueries({ queryKey: ["legal-page"] });
      setEdits((prev) => {
        const copy = { ...prev };
        delete copy[slug];
        return copy;
      });
    },
    onError: () => toast.error("Ошибка сохранения"),
  });

  if (isLoading) return <p className="text-muted-foreground text-sm">Загрузка...</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Юридические страницы</h3>
      </div>
      <p className="text-sm text-muted-foreground">Редактируйте содержимое страниц /offer, /privacy, /terms, /cookies. Поддерживается HTML-разметка.</p>

      <Tabs value={activeSlug} onValueChange={setActiveSlug}>
        <TabsList className="bg-muted border border-border">
          {SLUGS.map((s) => (
            <TabsTrigger key={s} value={s}>{LABELS[s]}</TabsTrigger>
          ))}
        </TabsList>

        {SLUGS.map((slug) => (
          <TabsContent key={slug} value={slug} className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{LABELS[slug]}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">Заголовок страницы</label>
                  <Input
                    value={getValue(slug, "title")}
                    onChange={(e) => setField(slug, "title", e.target.value)}
                    placeholder={LABELS[slug]}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1 block">Содержимое (HTML)</label>
                  <Textarea
                    value={getValue(slug, "content")}
                    onChange={(e) => setField(slug, "content", e.target.value)}
                    placeholder="<h2>1. Общие положения</h2><p>Текст...</p>"
                    className="min-h-[400px] font-mono text-xs"
                  />
                </div>
                <Button
                  onClick={() => saveMutation.mutate(slug)}
                  disabled={!getEdit(slug) || saveMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Сохранить
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
