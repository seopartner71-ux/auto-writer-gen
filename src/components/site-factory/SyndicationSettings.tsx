import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Share2 } from "lucide-react";

interface Props {
  projectId: string | null;
  lang: "ru" | "en";
}

type Platform = "blogger" | "hashnode" | "devto";

const ALL_PLATFORMS: Platform[] = ["blogger", "hashnode", "devto"];

const LABELS: Record<Platform, string> = {
  blogger: "Blogger (RU, без перевода)",
  hashnode: "Hashnode (EN, с переводом)",
  devto: "Dev.to (EN, с переводом)",
};

export function SyndicationSettings({ projectId, lang }: Props) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [platforms, setPlatforms] = useState<Platform[]>([...ALL_PLATFORMS]);
  const [hashnodePubId, setHashnodePubId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data } = await supabase
        .from("projects")
        .select("syndication_enabled, syndication_platforms, hashnode_publication_id")
        .eq("id", projectId).maybeSingle();
      if (data) {
        setEnabled(!!data.syndication_enabled);
        setPlatforms(((data.syndication_platforms as Platform[] | null) || ALL_PLATFORMS).filter((p) => ALL_PLATFORMS.includes(p as Platform)));
        setHashnodePubId(data.hashnode_publication_id || "");
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

        {platforms.includes("hashnode") && (
          <div className="space-y-1.5 pt-2">
            <Label className="text-xs text-muted-foreground">
              Hashnode Publication ID
            </Label>
            <Input
              value={hashnodePubId}
              onChange={(e) => setHashnodePubId(e.target.value)}
              onBlur={() => save({ hashnode_publication_id: hashnodePubId.trim() || null })}
              placeholder="65f1a2b3c4d5e6f7a8b9c0d1"
              className="h-8 text-xs"
            />
            <p className="text-[11px] text-muted-foreground">
              {lang === "ru"
                ? "ID публикации Hashnode. Найти можно в URL панели управления блогом."
                : "Hashnode publication ID. Find it in your blog dashboard URL."}
            </p>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground pt-1 border-t border-border">
          {lang === "ru"
            ? "Blogger: используется ваше OAuth-подключение. Hashnode/Dev.to: используются глобальные API-ключи системы."
            : "Blogger: uses your own OAuth connection. Hashnode/Dev.to: use system-wide API keys."}
        </p>
      </CardContent>
    </Card>
  );
}
