import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Share2 } from "lucide-react";

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

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("syndication_enabled, syndication_platforms")
        .eq("id", projectId).maybeSingle();
      if (data) {
        setEnabled(!!data.syndication_enabled);
        setPlatforms(((data.syndication_platforms as Platform[] | null) || ALL_PLATFORMS).filter((p) => ALL_PLATFORMS.includes(p as Platform)));
      }
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
      </CardContent>
    </Card>
  );
}
