import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Share2, TrendingUp } from "lucide-react";

interface Props {
  projectId: string | null;
  lang: "ru" | "en";
}

type Platform = "blogger" | "telegraph";

const ALL_PLATFORMS: Platform[] = ["blogger", "telegraph"];

const LABELS: Record<Platform, string> = {
  blogger: "Blogger",
  telegraph: "Telegra.ph",
};

export function SyndicationSettings({ projectId, lang }: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [platforms, setPlatforms] = useState<Platform[]>([...ALL_PLATFORMS]);
  const [loading, setLoading] = useState(false);
  const [tier2Enabled, setTier2Enabled] = useState(false);
  const [tier2Count, setTier2Count] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("syndication_enabled, syndication_platforms, tier2_enabled")
        .eq("id", projectId).maybeSingle();
      if (data) {
        setEnabled(!!data.syndication_enabled);
        setPlatforms(((data.syndication_platforms as Platform[] | null) || ALL_PLATFORMS).filter((p) => ALL_PLATFORMS.includes(p as Platform)));
        setTier2Enabled(!!(data as any).tier2_enabled);
      }
      // Count published Tier-2 backlinks for this project (dashboard widget).
      const { count } = await supabase
        .from("tier2_backlinks")
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("status", "published");
      setTier2Count(count || 0);
    })();
  }, [projectId]);

  const save = async (patch: Record<string, unknown>) => {
    if (!projectId) return;
    setLoading(true);
    const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
    setLoading(false);
    if (error) {
      toast({ title: lang === "ru" ? "Не удалось сохранить" : "Save failed", description: error.message, variant: "destructive" });
    }
  };

  const togglePlatform = (p: Platform, checked: boolean) => {
    const next = checked ? Array.from(new Set([...platforms, p])) : platforms.filter((x) => x !== p);
    setPlatforms(next);
    save({ syndication_platforms: next });
  };

  if (!projectId) return null;

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Share2 className="h-4 w-4 text-primary" />
          {lang === "ru" ? "Синдикация статей" : "Article syndication"}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {lang === "ru"
            ? "После публикации каждой статьи на сайте — автоматически разместить копию на внешних площадках с canonical-ссылкой на оригинал."
            : "After each article is published on your site, copies are auto-posted to external platforms with a canonical link to the original."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">
            {lang === "ru" ? "Включить автосиндикацию" : "Enable auto-syndication"}
          </Label>
          <Switch
            checked={enabled}
            disabled={loading}
            onCheckedChange={(v) => { setEnabled(v); save({ syndication_enabled: v }); }}
          />
        </div>

        <div className="space-y-2 pt-1">
          {ALL_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={platforms.includes(p)}
                onCheckedChange={(v) => togglePlatform(p, !!v)}
                disabled={loading}
              />
              <span>{LABELS[p]}</span>
            </label>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
          {lang === "ru"
            ? "Blogger: используется ваше OAuth-подключение. Telegra.ph: публикуется без регистрации."
            : "Blogger: uses your own OAuth connection. Telegra.ph: anonymous publishing."}
        </p>

        <div className="pt-3 mt-1 border-t border-border space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <Label className="text-sm">
                {lang === "ru" ? "Tier-2 буст (Telegraph + Blogger)" : "Tier-2 boost (Telegraph + Blogger)"}
              </Label>
            </div>
            <Switch
              checked={tier2Enabled}
              disabled={loading}
              onCheckedChange={(v) => { setTier2Enabled(v); save({ tier2_enabled: v }); }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {lang === "ru"
              ? "Через 5 минут после автопубликации создаётся короткий тизер (150-220 слов) на Telegra.ph и Blogger со ссылкой на оригинал. Имитация естественного link velocity."
              : "Five minutes after each auto-publish, a short teaser (150-220 words) is posted to Telegra.ph and Blogger linking back to the original. Mimics natural link velocity."}
          </p>
          <div className="text-[11px] text-muted-foreground">
            {lang === "ru" ? "Tier-2 ссылок создано: " : "Tier-2 backlinks built: "}
            <span className="text-foreground font-medium">{tier2Count}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
