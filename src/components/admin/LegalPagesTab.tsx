import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { FileText, Save, Code, Eye } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SLUGS = ["offer", "privacy", "terms", "cookies"] as const;
const LABELS: Record<string, string> = {
  offer: "Публичная оферта",
  privacy: "Политика конфиденциальности",
  terms: "Пользовательское соглашение",
  cookies: "Политика Cookie",
};

function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"visual" | "html">("visual");
  const [htmlSource, setHtmlSource] = useState(value);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");

    if (html) {
      // Clean Word HTML — remove mso styles, classes, but keep structure
      const cleaned = cleanWordHtml(html);
      document.execCommand("insertHTML", false, cleaned);
    } else {
      // Plain text — convert newlines to <br>
      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n\n/g, "</p><p>")
        .replace(/\n/g, "<br>");
      document.execCommand("insertHTML", false, `<p>${escaped}</p>`);
    }
    handleInput();
  }, [handleInput]);

  const switchToVisual = () => {
    setMode("visual");
    setTimeout(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = htmlSource;
      }
    }, 0);
  };

  const switchToHtml = () => {
    if (editorRef.current) {
      setHtmlSource(editorRef.current.innerHTML);
    }
    setMode("html");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "visual" ? "default" : "outline"}
          onClick={switchToVisual}
        >
          <Eye className="h-3.5 w-3.5 mr-1" /> Визуальный
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "html" ? "default" : "outline"}
          onClick={switchToHtml}
        >
          <Code className="h-3.5 w-3.5 mr-1" /> HTML
        </Button>
      </div>

      {mode === "visual" ? (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="min-h-[400px] w-full rounded-md border border-input bg-background px-4 py-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 overflow-auto prose prose-sm max-w-none dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: value }}
          onInput={handleInput}
          onPaste={handlePaste}
        />
      ) : (
        <textarea
          value={htmlSource}
          onChange={(e) => {
            setHtmlSource(e.target.value);
            onChange(e.target.value);
          }}
          className="min-h-[400px] w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          placeholder="<h2>1. Общие положения</h2><p>Текст...</p>"
        />
      )}
    </div>
  );
}

function cleanWordHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Remove Word-specific elements
  doc.querySelectorAll("meta, link, style, script, o\\:p, xml").forEach((el) => el.remove());

  // Clean attributes but keep structure
  const walk = (node: Element) => {
    // Remove class/style with mso-, keep meaningful ones
    const style = node.getAttribute("style") || "";
    const cleanStyle = style
      .split(";")
      .filter((s) => {
        const prop = s.trim().toLowerCase();
        return (
          !prop.startsWith("mso-") &&
          !prop.includes("font-family") &&
          !prop.includes("font-size") &&
          !prop.includes("line-height") &&
          !prop.includes("margin") &&
          !prop.includes("text-indent") &&
          !prop.includes("tab-stops") &&
          prop.length > 0
        );
      })
      .join(";")
      .trim();

    if (cleanStyle) {
      node.setAttribute("style", cleanStyle);
    } else {
      node.removeAttribute("style");
    }

    node.removeAttribute("class");
    node.removeAttribute("lang");
    node.removeAttribute("data-mce-style");

    // Remove empty spans
    if (node.tagName === "SPAN" && !node.getAttribute("style") && !node.getAttribute("id")) {
      const parent = node.parentNode;
      while (node.firstChild) parent?.insertBefore(node.firstChild, node);
      parent?.removeChild(node);
      return;
    }

    Array.from(node.children).forEach(walk);
  };

  walk(doc.body);

  return doc.body.innerHTML;
}

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
      <p className="text-sm text-muted-foreground">
        Редактируйте содержимое страниц /offer, /privacy, /terms, /cookies.
        Вставляйте текст из Word — структура (заголовки, списки, таблицы) сохранится автоматически.
      </p>

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
                  <label className="text-sm font-medium mb-1 block">Содержимое</label>
                  <RichEditor
                    key={`${slug}-${pages?.find(p => p.slug === slug)?.updated_at}`}
                    value={getValue(slug, "content")}
                    onChange={(html) => setField(slug, "content", html)}
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
