import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Layers, Plus, Trash2, FolderTree, Loader2 } from "lucide-react";

interface Silo { id: string; name: string; slug: string; position: number | null; }
interface Cluster { id: string; silo_id: string; parent_id: string | null; name: string; slug: string; position: number | null; }
interface ArticleLite { id: string; title: string | null; silo_id: string | null; site_cluster_id: string | null; url_path: string | null; }

function slugify(v: string) {
  const map: Record<string, string> = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",
    р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
  };
  return String(v || "").toLowerCase().split("").map((c) => map[c] ?? c).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

export function SiloStructurePanel({ projectId, lang }: { projectId: string; lang: string }) {
  const ru = lang === "ru";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheme, setScheme] = useState<string>("legacy");
  const [silos, setSilos] = useState<Silo[]>([]);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [articles, setArticles] = useState<ArticleLite[]>([]);
  const [newSilo, setNewSilo] = useState("");
  const [newCluster, setNewCluster] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: proj }, { data: s }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("projects").select("url_scheme").eq("id", projectId).maybeSingle(),
      supabase.from("site_silos").select("id, name, slug, position").eq("project_id", projectId).order("position"),
      supabase.from("site_clusters").select("id, silo_id, parent_id, name, slug, position").eq("project_id", projectId).order("position"),
      supabase.from("articles").select("id, title, silo_id, site_cluster_id, url_path").eq("project_id", projectId).order("created_at", { ascending: false }).limit(300),
    ]);
    setScheme(String((proj as any)?.url_scheme || "legacy"));
    setSilos((s || []) as Silo[]);
    setClusters((c || []) as Cluster[]);
    setArticles((a || []) as ArticleLite[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const toggleScheme = async (on: boolean) => {
    const next = on ? "silo" : "legacy";
    setScheme(next);
    const { error } = await supabase.from("projects").update({ url_scheme: next } as any).eq("id", projectId);
    if (error) { toast.error(error.message); return; }
    toast.success(ru
      ? (on ? "SILO-схема URL включена. Примените деплоем." : "Возвращена схема /posts/{slug}.html")
      : (on ? "SILO URL scheme enabled. Redeploy to apply." : "Reverted to /posts/{slug}.html"));
  };

  const addSilo = async () => {
    const name = newSilo.trim();
    if (!name) return;
    setSaving(true);
    const { error } = await supabase.from("site_silos").insert({
      project_id: projectId, name, slug: slugify(name) || `silo-${silos.length + 1}`, position: silos.length,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setNewSilo("");
    void load();
  };

  const addCluster = async (siloId: string) => {
    const name = (newCluster[siloId] || "").trim();
    if (!name) return;
    setSaving(true);
    const siblings = clusters.filter((c) => c.silo_id === siloId);
    const { error } = await supabase.from("site_clusters").insert({
      project_id: projectId, silo_id: siloId, name,
      slug: slugify(name) || `cluster-${siblings.length + 1}`, position: siblings.length,
    } as any);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setNewCluster((p) => ({ ...p, [siloId]: "" }));
    void load();
  };

  const removeSilo = async (id: string) => {
    const { error } = await supabase.from("site_silos").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const removeCluster = async (id: string) => {
    const { error } = await supabase.from("site_clusters").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    void load();
  };

  const assign = async (articleId: string, value: string) => {
    let patch: any = { silo_id: null, site_cluster_id: null };
    if (value.startsWith("c:")) {
      const cl = clusters.find((c) => c.id === value.slice(2));
      if (cl) patch = { silo_id: cl.silo_id, site_cluster_id: cl.id };
    } else if (value.startsWith("s:")) {
      patch = { silo_id: value.slice(2), site_cluster_id: null };
    }
    const { error } = await supabase.from("articles").update(patch).eq("id", articleId);
    if (error) { toast.error(error.message); return; }
    setArticles((prev) => prev.map((a) => a.id === articleId ? { ...a, ...patch } : a));
  };

  const unassigned = useMemo(() => articles.filter((a) => !a.silo_id).length, [articles]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderTree className="h-5 w-5 text-primary" />
            {ru ? "Структура сайта (SILO)" : "Site structure (SILO)"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {ru ? "SILO-URL" : "SILO URLs"}
            </span>
            <Switch checked={scheme === "silo"} onCheckedChange={toggleScheme} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {scheme === "silo"
            ? (ru ? "Адреса: /{силос}/{кластер}/{статья}. Хабы и хлебные крошки создаются при деплое." : "URLs: /{silo}/{cluster}/{article}. Hubs and breadcrumbs are generated on deploy.")
            : (ru ? "Сейчас используется старая схема /posts/{slug}.html - существующие сайты не затрагиваются." : "Legacy scheme /posts/{slug}.html is active - existing sites stay untouched.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {ru ? "Загрузка..." : "Loading..."}
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                value={newSilo}
                onChange={(e) => setNewSilo(e.target.value)}
                placeholder={ru ? "Новый раздел (силос), например: Ремонт квартир" : "New silo, e.g. Apartment renovation"}
                onKeyDown={(e) => { if (e.key === "Enter") void addSilo(); }}
              />
              <Button onClick={() => void addSilo()} disabled={saving || !newSilo.trim()}>
                <Plus className="h-4 w-4 mr-1" /> {ru ? "Раздел" : "Silo"}
              </Button>
            </div>

            {silos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {ru ? "Разделов пока нет. Создайте первый раздел, чтобы построить силосную структуру." : "No silos yet. Create the first one to build the structure."}
              </p>
            )}

            <div className="space-y-3">
              {silos.map((s) => {
                const kids = clusters.filter((c) => c.silo_id === s.id);
                const count = articles.filter((a) => a.silo_id === s.id).length;
                return (
                  <div key={s.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium truncate">{s.name}</span>
                        <code className="text-xs text-muted-foreground">/{s.slug}/</code>
                        <Badge variant="secondary">{count}</Badge>
                      </div>
                      <Button variant="ghost" size="icon" aria-label={ru ? "Удалить раздел" : "Delete silo"} onClick={() => void removeSilo(s.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="pl-6 space-y-1">
                      {kids.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{c.name}</span>
                            <code className="text-xs text-muted-foreground">/{s.slug}/{c.slug}/</code>
                            <Badge variant="outline">{articles.filter((a) => a.site_cluster_id === c.id).length}</Badge>
                          </div>
                          <Button variant="ghost" size="icon" aria-label={ru ? "Удалить кластер" : "Delete cluster"} onClick={() => void removeCluster(c.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                      <div className="flex gap-2 pt-1">
                        <Input
                          className="h-8"
                          value={newCluster[s.id] || ""}
                          onChange={(e) => setNewCluster((p) => ({ ...p, [s.id]: e.target.value }))}
                          placeholder={ru ? "Подраздел (кластер)" : "Cluster"}
                          onKeyDown={(e) => { if (e.key === "Enter") void addCluster(s.id); }}
                        />
                        <Button size="sm" variant="outline" onClick={() => void addCluster(s.id)} disabled={saving}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {silos.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{ru ? "Привязка статей" : "Article mapping"}</p>
                  {unassigned > 0 && (
                    <Badge variant="outline">{ru ? `Без раздела: ${unassigned}` : `Unassigned: ${unassigned}`}</Badge>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
                  {articles.map((a) => {
                    const value = a.site_cluster_id ? `c:${a.site_cluster_id}` : a.silo_id ? `s:${a.silo_id}` : "none";
                    return (
                      <div key={a.id} className="flex items-center gap-2">
                        <span className="text-sm truncate flex-1">{a.title || "-"}</span>
                        <Select value={value} onValueChange={(v) => void assign(a.id, v)}>
                          <SelectTrigger className="h-8 w-[240px] shrink-0">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{ru ? "Без раздела" : "Unassigned"}</SelectItem>
                            {silos.map((s) => [
                              <SelectItem key={`s-${s.id}`} value={`s:${s.id}`}>{s.name}</SelectItem>,
                              ...clusters.filter((c) => c.silo_id === s.id).map((c) => (
                                <SelectItem key={`c-${c.id}`} value={`c:${c.id}`}>{`${s.name} / ${c.name}`}</SelectItem>
                              )),
                            ])}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
