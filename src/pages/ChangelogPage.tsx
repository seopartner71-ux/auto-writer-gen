import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Sparkles, Wrench, Bug, AlertTriangle, Cog, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru, enUS } from "date-fns/locale";

type ChangeType = "new" | "improvement" | "fix" | "breaking" | "tech";
type ChangeItem = { type: ChangeType; text: string; feature?: string };
type Release = {
  id: string;
  version: string;
  title: string;
  release_date: string;
  is_major: boolean;
  items: ChangeItem[];
};

const TYPE_META: Record<ChangeType, { label: string; labelEn: string; cls: string; Icon: typeof Sparkles }> = {
  new:         { label: "НОВОЕ",       labelEn: "NEW",         cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", Icon: Sparkles },
  improvement: { label: "УЛУЧШЕНИЕ",   labelEn: "IMPROVEMENT", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30",         Icon: Wrench },
  fix:         { label: "ИСПРАВЛЕНИЕ", labelEn: "FIX",         cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",   Icon: Bug },
  breaking:    { label: "ВАЖНОЕ",      labelEn: "BREAKING",    cls: "bg-red-500/15 text-red-400 border-red-500/30",            Icon: AlertTriangle },
  tech:        { label: "ТЕХНИЧЕСКОЕ", labelEn: "TECH",        cls: "bg-muted text-muted-foreground border-border",            Icon: Cog },
};

const FILTERS: { key: "all" | ChangeType; ru: string; en: string }[] = [
  { key: "all",         ru: "Все",         en: "All" },
  { key: "new",         ru: "Новое",       en: "New" },
  { key: "improvement", ru: "Улучшение",   en: "Improvement" },
  { key: "fix",         ru: "Исправление", en: "Fix" },
  { key: "breaking",    ru: "Важное",      en: "Breaking" },
];

export default function ChangelogPage() {
  const { role } = useAuth();
  const { lang } = useI18n();
  const isAdmin = role === "admin";
  const [filter, setFilter] = useState<typeof FILTERS[number]["key"]>("all");

  const { data: releases = [], isLoading } = useQuery({
    queryKey: ["changelog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("changelog")
        .select("*")
        .order("release_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Release[];
    },
  });

  // Mark latest version as seen
  useEffect(() => {
    if (releases.length) {
      localStorage.setItem("changelog_last_seen", releases[0].version);
      window.dispatchEvent(new Event("changelog:seen"));
    }
  }, [releases]);

  const latest = releases[0];
  const filtered = useMemo(() => {
    if (filter === "all") return releases;
    return releases
      .map((r) => ({ ...r, items: r.items.filter((i) => i.type === filter) }))
      .filter((r) => r.items.length > 0);
  }, [releases, filter]);

  const fmtDate = (d: string) =>
    format(new Date(d), lang === "ru" ? "d MMMM yyyy" : "MMMM d, yyyy", { locale: lang === "ru" ? ru : enUS });

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {lang === "ru" ? "История обновлений" : "Changelog"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {lang === "ru" ? "Что нового в СЕО-Модуле" : "What's new in SEO-Module"}
          </p>
          {latest && (
            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-4xl font-bold gradient-text">v{latest.version}</span>
              <span className="text-sm text-muted-foreground">{fmtDate(latest.release_date)}</span>
            </div>
          )}
        </div>
        {isAdmin && <AddVersionDialog />}
      </header>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.key)}
          >
            {lang === "ru" ? f.ru : f.en}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-4">
          {filtered.map((r) => (
            <ReleaseCard key={r.id} release={r} lang={lang} fmtDate={fmtDate} isAdmin={isAdmin} />
          ))}
          {filtered.length === 0 && (
            <Card className="p-12 text-center text-muted-foreground">
              {lang === "ru" ? "Нет записей по выбранному фильтру" : "No entries for this filter"}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ReleaseCard({ release, lang, fmtDate, isAdmin }: { release: Release; lang: string; fmtDate: (d: string) => string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const grouped = useMemo(() => {
    const g: Partial<Record<ChangeType, ChangeItem[]>> = {};
    for (const it of release.items) (g[it.type] ||= []).push(it);
    return g;
  }, [release.items]);

  const order: ChangeType[] = ["breaking", "new", "improvement", "fix", "tech"];

  const handleDelete = async () => {
    if (!confirm(lang === "ru" ? `Удалить версию v${release.version}?` : `Delete version v${release.version}?`)) return;
    const { error } = await supabase.from("changelog").delete().eq("id", release.id);
    if (error) toast.error(error.message);
    else {
      toast.success(lang === "ru" ? "Версия удалена" : "Version deleted");
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
    }
  };

  return (
    <Card className={`p-6 ${release.is_major ? "border-primary/40 shadow-lg shadow-primary/5" : ""}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className={`font-bold ${release.is_major ? "text-2xl" : "text-xl"}`}>v{release.version}</h2>
            <span className="text-sm text-muted-foreground">— {fmtDate(release.release_date)}</span>
            {release.is_major && (
              <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">
                {lang === "ru" ? "Важное" : "Major"}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1">{release.title}</p>
        </div>
        {isAdmin && (
          <Button size="icon" variant="ghost" onClick={handleDelete} className="text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="space-y-4 mt-4">
        {order.map((type) => {
          const items = grouped[type];
          if (!items?.length) return null;
          const meta = TYPE_META[type];
          const Icon = meta.Icon;
          return (
            <div key={type}>
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border mb-2 ${meta.cls}`}>
                <Icon className="h-3 w-3" />
                {lang === "ru" ? meta.label : meta.labelEn}
              </div>
              <ul className="space-y-1.5 pl-4">
                {items.map((it, i) => (
                  <li key={i} className="text-sm leading-relaxed list-disc text-foreground/90">
                    {it.feature && <span className="font-medium">{it.feature}: </span>}
                    {it.text}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AddVersionDialog() {
  const queryClient = useQueryClient();
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [isMajor, setIsMajor] = useState(false);
  const [items, setItems] = useState<ChangeItem[]>([{ type: "new", text: "" }]);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setVersion(""); setTitle(""); setDate(new Date().toISOString().slice(0, 10));
    setIsMajor(false); setItems([{ type: "new", text: "" }]);
  };

  const submit = async () => {
    if (!version.trim() || !title.trim()) {
      toast.error(lang === "ru" ? "Укажите версию и заголовок" : "Version and title required");
      return;
    }
    const cleanItems = items.filter((i) => i.text.trim());
    if (cleanItems.length === 0) {
      toast.error(lang === "ru" ? "Добавьте хотя бы один пункт" : "Add at least one item");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("changelog").insert({
      version: version.trim(),
      title: title.trim(),
      release_date: date,
      is_major: isMajor,
      items: cleanItems as any,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(lang === "ru" ? "Версия опубликована" : "Version published");
    queryClient.invalidateQueries({ queryKey: ["changelog"] });
    setOpen(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4 mr-1" /> {lang === "ru" ? "Добавить версию" : "Add version"}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{lang === "ru" ? "Новая версия" : "New version"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="2.5.0" value={version} onChange={(e) => setVersion(e.target.value)} />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <Input placeholder={lang === "ru" ? "Заголовок версии" : "Version title"} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={isMajor} onCheckedChange={(v) => setIsMajor(!!v)} />
            {lang === "ru" ? "Мажорный релиз" : "Major release"}
          </label>

          <div className="space-y-2">
            <div className="text-sm font-medium">{lang === "ru" ? "Изменения" : "Changes"}</div>
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-start">
                <Select value={it.type} onValueChange={(v) => {
                  const next = [...items]; next[i] = { ...next[i], type: v as ChangeType }; setItems(next);
                }}>
                  <SelectTrigger className="w-40 shrink-0"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_META) as ChangeType[]).map((k) => (
                      <SelectItem key={k} value={k}>{lang === "ru" ? TYPE_META[k].label : TYPE_META[k].labelEn}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  className="flex-1 min-h-[60px]"
                  placeholder={lang === "ru" ? "Описание изменения" : "Change description"}
                  value={it.text}
                  onChange={(e) => { const next = [...items]; next[i] = { ...next[i], text: e.target.value }; setItems(next); }}
                />
                <Button size="icon" variant="ghost" onClick={() => setItems(items.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setItems([...items, { type: "new", text: "" }])}>
              <Plus className="h-4 w-4 mr-1" /> {lang === "ru" ? "Добавить пункт" : "Add item"}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{lang === "ru" ? "Отмена" : "Cancel"}</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {lang === "ru" ? "Опубликовать" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}