import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Eye, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PbnTemplate {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  html_structure: string;
  css_styles: string;
  font_pairs: [string, string][];
  is_active: boolean;
  is_builtin: boolean;
  sort_order: number;
}

const SAMPLE_POSTS = [
  { title: "Как выбрать кофейную машину для дома", excerpt: "Рассказываем про типы кофемашин, отличия рожковых и автоматических моделей, на что смотреть при покупке.", url: "/posts/sample-1.html", date: "2025-04-12" },
  { title: "Топ-5 ошибок новичков в горном велоспорте", excerpt: "Опыт показывает: большинство травм связаны с неправильной посадкой и плохой экипировкой. Разбираем по пунктам.", url: "/posts/sample-2.html", date: "2025-04-08" },
  { title: "Криптокошельки 2026: что выбрать", excerpt: "Холодные и горячие, hardware и mobile. Сравниваем популярные решения и объясняем разницу.", url: "/posts/sample-3.html", date: "2025-04-01" },
];

function escAttr(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
function fontUrl(n: string) { return n.replace(/\s+/g, "+"); }

function renderPreview(tpl: PbnTemplate): string {
  const accent = "#0ea5e9";
  const fontPair = (tpl.font_pairs?.[0] || ["Inter", "Inter"]) as [string, string];
  const vars: Record<string, string> = {
    site_name: "Демо-Сайт",
    site_about: "Полезные статьи на тему ниши - готовый превью шаблона.",
    topic: "демо",
    accent,
    heading_font: fontPair[0],
    body_font: fontPair[1],
    heading_font_url: fontUrl(fontPair[0]),
    body_font_url: fontUrl(fontPair[1]),
    lang: "ru",
    year: String(new Date().getFullYear()),
    title: "Демо-Сайт",
    description: "Превью шаблона",
  };
  const looped = tpl.html_structure.replace(/\{\{#posts\}\}([\s\S]*?)\{\{\/posts\}\}/g, (_m, body) => {
    return SAMPLE_POSTS.map((p) =>
      body
        .replace(/\{\{title\}\}/g, escAttr(p.title))
        .replace(/\{\{url\}\}/g, p.url)
        .replace(/\{\{excerpt\}\}/g, escAttr(p.excerpt))
        .replace(/\{\{date\}\}/g, p.date)
    ).join("");
  });
  let html = looped.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  // Inline CSS instead of /style.css link
  const css = tpl.css_styles.replace(/\{\{(\w+)\}\}/g, (_m, k) => vars[k] ?? "");
  html = html.replace(/<link[^>]+href=["']\/style\.css["'][^>]*>/g, `<style>${css}</style>`);
  return html;
}

const EMPTY: Partial<PbnTemplate> = {
  template_key: "",
  name: "",
  description: "",
  html_structure: "",
  css_styles: "",
  font_pairs: [["Inter", "Inter"]],
  is_active: true,
};

export function PbnTemplatesTab() {
  const { toast } = useToast();
  const [list, setList] = useState<PbnTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewOf, setPreviewOf] = useState<PbnTemplate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Partial<PbnTemplate>>(EMPTY);
  const [fontPairsRaw, setFontPairsRaw] = useState("");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pbn_templates")
      .select("*")
      .order("sort_order")
      .order("created_at");
    if (error) toast({ title: "Ошибка загрузки", description: error.message, variant: "destructive" });
    setList((data || []) as PbnTemplate[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setDraft(EMPTY);
    setFontPairsRaw("Inter,Inter");
    setEditingId(null);
    setCreating(true);
  };
  const openEdit = (tpl: PbnTemplate) => {
    setDraft({ ...tpl });
    setFontPairsRaw((tpl.font_pairs || []).map((p) => p.join(",")).join("\n"));
    setEditingId(tpl.id);
    setCreating(true);
  };

  const save = async () => {
    if (!draft.template_key || !draft.name || !draft.html_structure) {
      toast({ title: "Заполните ключ, имя и HTML", variant: "destructive" });
      return;
    }
    const fontPairs = fontPairsRaw
      .split("\n")
      .map((l) => l.split(",").map((s) => s.trim()).filter(Boolean))
      .filter((p) => p.length === 2) as [string, string][];

    const payload = {
      template_key: draft.template_key,
      name: draft.name,
      description: draft.description || null,
      html_structure: draft.html_structure,
      css_styles: draft.css_styles || "",
      font_pairs: fontPairs.length ? fontPairs : [["Inter", "Inter"]],
      is_active: draft.is_active ?? true,
    };

    const { error } = editingId
      ? await supabase.from("pbn_templates").update(payload).eq("id", editingId)
      : await supabase.from("pbn_templates").insert(payload);
    if (error) {
      toast({ title: "Ошибка", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Шаблон обновлен" : "Шаблон создан" });
    setCreating(false);
    load();
  };

  const toggleActive = async (tpl: PbnTemplate) => {
    const { error } = await supabase
      .from("pbn_templates")
      .update({ is_active: !tpl.is_active })
      .eq("id", tpl.id);
    if (error) toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    else load();
  };

  const remove = async (tpl: PbnTemplate) => {
    if (tpl.is_builtin) {
      toast({ title: "Встроенный шаблон нельзя удалить", description: "Можно только отключить", variant: "destructive" });
      return;
    }
    if (!confirm(`Удалить шаблон "${tpl.name}"?`)) return;
    const { error } = await supabase.from("pbn_templates").delete().eq("id", tpl.id);
    if (error) toast({ title: "Ошибка", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Шаблоны сайтов (PBN)</h2>
          <p className="text-xs text-muted-foreground">
            Шаблоны для генерации сетки. При создании сетки случайно выбирается один из активных.
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="h-4 w-4" /> Добавить шаблон
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {list.map((tpl) => (
            <Card key={tpl.id} className={tpl.is_active ? "border-primary/30" : "opacity-60"}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm">{tpl.name}</CardTitle>
                  {tpl.is_builtin && <Badge variant="outline" className="text-[10px]">встроенный</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{tpl.description || tpl.template_key}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="aspect-[4/3] border rounded overflow-hidden bg-white">
                  <iframe
                    srcDoc={renderPreview(tpl)}
                    className="w-full h-full pointer-events-none"
                    style={{ transform: "scale(0.5)", transformOrigin: "0 0", width: "200%", height: "200%" }}
                    sandbox=""
                    title={tpl.name}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Switch checked={tpl.is_active} onCheckedChange={() => toggleActive(tpl)} />
                    <span className="text-xs text-muted-foreground">{tpl.is_active ? "активен" : "выключен"}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => setPreviewOf(tpl)} title="Превью">
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(tpl)} title="Редактировать">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {!tpl.is_builtin && (
                      <Button variant="ghost" size="icon" onClick={() => remove(tpl)} title="Удалить">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Full preview */}
      <Dialog open={!!previewOf} onOpenChange={(o) => !o && setPreviewOf(null)}>
        <DialogContent className="max-w-5xl h-[80vh]">
          <DialogHeader>
            <DialogTitle>{previewOf?.name}</DialogTitle>
          </DialogHeader>
          {previewOf && (
            <iframe
              srcDoc={renderPreview(previewOf)}
              className="w-full h-full border rounded bg-white"
              sandbox=""
              title="Полное превью"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Create / Edit */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Редактировать шаблон" : "Добавить шаблон"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Ключ (латиница, уникальный)</Label>
                <Input
                  value={draft.template_key || ""}
                  onChange={(e) => setDraft({ ...draft, template_key: e.target.value })}
                  placeholder="my-template"
                  disabled={!!editingId}
                />
              </div>
              <div>
                <Label className="text-xs">Название</Label>
                <Input value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Описание</Label>
              <Input
                value={draft.description || ""}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">
                Пары шрифтов (Heading,Body — по одной на строку)
              </Label>
              <Textarea
                rows={3}
                value={fontPairsRaw}
                onChange={(e) => setFontPairsRaw(e.target.value)}
                placeholder={"Inter,Inter\nLora,Inter"}
              />
            </div>
            <div>
              <Label className="text-xs">
                HTML структура (плейсхолдеры: {"{{site_name}}"}, {"{{site_about}}"}, {"{{accent}}"},{" "}
                {"{{heading_font}}"}, {"{{body_font}}"}, {"{{year}}"}, {"{{lang}}"}, цикл {"{{#posts}}...{{/posts}}"} с{" "}
                {"{{title}}"}, {"{{url}}"}, {"{{excerpt}}"}, {"{{date}}"})
              </Label>
              <Textarea
                rows={12}
                className="font-mono text-xs"
                value={draft.html_structure || ""}
                onChange={(e) => setDraft({ ...draft, html_structure: e.target.value })}
              />
            </div>
            <div>
              <Label className="text-xs">CSS</Label>
              <Textarea
                rows={10}
                className="font-mono text-xs"
                value={draft.css_styles || ""}
                onChange={(e) => setDraft({ ...draft, css_styles: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={draft.is_active ?? true}
                onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
              />
              <span className="text-sm">Активен</span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Отмена</Button>
            <Button onClick={save}>Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
