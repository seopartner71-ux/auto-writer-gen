import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";

interface Props {
  articleId: string | null;
  hasContent: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
}

function aiLabel(s: number | null | undefined) {
  if (s == null) return { text: "—", tone: "muted" as const };
  if (s >= 80) return { text: "отлично", tone: "ok" as const };
  if (s >= 60) return { text: "хорошо", tone: "ok" as const };
  if (s >= 40) return { text: "средне", tone: "warn" as const };
  return { text: "плохо", tone: "fail" as const };
}
function burstLabel(s: number | null | undefined) {
  if (s == null) return { text: "—", tone: "muted" as const };
  if (s >= 10) return { text: "отлично", tone: "ok" as const };
  if (s >= 7) return { text: "хорошо", tone: "ok" as const };
  return { text: "монотонно", tone: "warn" as const };
}
function densityLabel(status: string | null | undefined) {
  if (!status) return { text: "—", tone: "muted" as const };
  if (status === "ok") return { text: "в норме", tone: "ok" as const };
  if (status === "overuse") return { text: "переспам↑", tone: "fail" as const };
  if (status === "underuse") return { text: "мало↓", tone: "warn" as const };
  return { text: status, tone: "muted" as const };
}
function turgLabel(s: number | null | undefined) {
  if (s == null) return { text: "—", tone: "muted" as const };
  if (s <= 5) return { text: "безопасно", tone: "ok" as const };
  if (s <= 10) return { text: "есть риск", tone: "warn" as const };
  return { text: "высокий риск", tone: "fail" as const };
}

const TONE_CLS: Record<string, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  fail: "text-rose-400",
  muted: "text-muted-foreground",
};

function overallStatus(rows: { tone: string }[]): { label: string; emoji: string; cls: string } {
  const hasFail = rows.some(r => r.tone === "fail");
  const hasWarn = rows.some(r => r.tone === "warn");
  const allMuted = rows.every(r => r.tone === "muted");
  if (allMuted) return { label: "ПРОВЕРЯЕТСЯ", emoji: "⏳", cls: "text-muted-foreground" };
  if (hasFail) return { label: "ТРЕБУЕТ ДОРАБОТКИ", emoji: "🔴", cls: "text-rose-400" };
  if (hasWarn) return { label: "РЕКОМЕНДУЕМ УЛУЧШИТЬ", emoji: "🟡", cls: "text-amber-400" };
  return { label: "ГОТОВО К ПУБЛИКАЦИИ", emoji: "🟢", cls: "text-emerald-400" };
}

export function QuickStartSummary({ articleId, hasContent, onSave, saveDisabled, saving }: Props) {
  const [data, setData] = useState<any>({});
  const [improving, setImproving] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    setData({});
    if (!articleId) return;
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from("articles")
        .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status,turgenev_score,turgenev_status")
        .eq("id", articleId)
        .maybeSingle();
      if (!cancelled && row) setData(row);
    })();
    const ch = supabase
      .channel(`quickstart-quality-${articleId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "articles", filter: `id=eq.${articleId}` },
        (payload: any) => {
          const r = payload?.new || {};
          setData((d: any) => ({
            ...d,
            quality_status: r.quality_status,
            ai_score: r.ai_score,
            burstiness_score: r.burstiness_score,
            burstiness_status: r.burstiness_status,
            keyword_density: r.keyword_density,
            keyword_density_status: r.keyword_density_status,
            turgenev_score: r.turgenev_score,
            turgenev_status: r.turgenev_status,
          }));
        }
      )
      .subscribe();
    channelRef.current = ch;
    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [articleId]);

  async function runImprove() {
    if (!articleId) return;
    setImproving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Сессия истекла. Войдите заново");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/improve-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ article_id: articleId }),
      });
      const payload = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(payload?.error || "Не удалось улучшить");
      if (payload?.cooldown) {
        toast.warning(payload.message || "Подождите перед повторной доработкой");
        return;
      }
      toast.success("Готово ✓ Статья улучшена");
      setData((d: any) => ({ ...d, quality_status: "checking" }));
    } catch (e: any) {
      toast.error(e?.message || "Не удалось выполнить запрос");
    } finally {
      setImproving(false);
    }
  }

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center space-y-3">
        <div className="text-4xl">🚀</div>
        <p className="text-sm font-medium">Выберите ключевое слово и нажмите Generate</p>
        <p className="text-xs text-muted-foreground">Остальное сделаем сами</p>
      </div>
    );
  }

  const ai = aiLabel(data.ai_score);
  const burst = burstLabel(data.burstiness_score);
  const dens = densityLabel(data.keyword_density_status);
  const turg = turgLabel(data.turgenev_score);
  const status = overallStatus([ai, burst, dens, turg]);

  const hasIssues = [ai, burst, dens, turg].some(r => r.tone === "warn" || r.tone === "fail");

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="text-xs text-muted-foreground">Качество статьи</div>
      <div className={`text-base font-semibold ${status.cls}`}>
        {status.emoji} {status.label}
      </div>
      <div className="border-t border-border pt-3 space-y-2 text-sm">
        <Row label="AI-детектор" value={ai} />
        <Row label="Ритм текста" value={burst} />
        <Row label="Плотность" value={dens} />
        <Row label="Тургенев" value={turg} />
      </div>
      <div className="space-y-2 pt-2">
        {hasIssues && articleId && (
          <Button
            className="w-full gap-2 bg-purple-600 hover:bg-purple-500 text-white"
            disabled={improving}
            onClick={runImprove}
          >
            {improving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Улучшить автоматически
          </Button>
        )}
        {onSave && (
          <Button
            variant="outline"
            className="w-full gap-2"
            disabled={saveDisabled || saving}
            onClick={onSave}
          >
            <Save className="h-4 w-4" />
            {saving ? "..." : "Сохранить статью"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: { text: string; tone: string } }) {
  const ok = value.tone === "ok";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{ok ? "✓" : "·"} {label}</span>
      <span className={TONE_CLS[value.tone] || "text-muted-foreground"}>{value.text}</span>
    </div>
  );
}