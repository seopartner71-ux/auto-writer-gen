import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Save } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { edgeErrorMessage } from "@/shared/utils/edgeError";

interface Props {
  articleId: string | null;
  hasContent: boolean;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
}

type Tone = "ok" | "warn" | "fail" | "muted";
type LabelInfo = { key: string; tone: Tone };

function aiLabel(s: number | null | undefined): LabelInfo {
  if (s == null) return { key: "", tone: "muted" };
  if (s >= 80) return { key: "tone.excellent", tone: "ok" };
  if (s >= 60) return { key: "tone.good", tone: "ok" };
  if (s >= 40) return { key: "tone.average", tone: "warn" };
  return { key: "tone.bad", tone: "fail" };
}
function burstLabel(s: number | null | undefined): LabelInfo {
  if (s == null) return { key: "", tone: "muted" };
  if (s >= 10) return { key: "tone.excellent", tone: "ok" };
  if (s >= 7) return { key: "tone.good", tone: "ok" };
  return { key: "tone.monotone", tone: "warn" };
}
function densityLabel(status: string | null | undefined): LabelInfo {
  if (!status) return { key: "", tone: "muted" };
  if (status === "ok") return { key: "tone.normal", tone: "ok" };
  if (status === "overuse") return { key: "tone.overuse", tone: "fail" };
  if (status === "underuse") return { key: "tone.underuse", tone: "warn" };
  return { key: "", tone: "muted" };
}
function turgLabel(s: number | null | undefined): LabelInfo {
  if (s == null) return { key: "", tone: "muted" };
  if (s <= 5) return { key: "tone.safe", tone: "ok" };
  if (s <= 10) return { key: "tone.riskSome", tone: "warn" };
  return { key: "tone.riskHigh", tone: "fail" };
}

const TONE_CLS: Record<string, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  fail: "text-rose-400",
  muted: "text-muted-foreground",
};

function overallStatusKey(rows: { tone: string }[]): { key: string; cls: string } {
  const hasFail = rows.some(r => r.tone === "fail");
  const hasWarn = rows.some(r => r.tone === "warn");
  const allMuted = rows.every(r => r.tone === "muted");
  if (allMuted) return { key: "status.checking", cls: "text-muted-foreground" };
  if (hasFail) return { key: "status.needsWork", cls: "text-rose-400" };
  if (hasWarn) return { key: "status.recommendImprove", cls: "text-amber-400" };
  return { key: "status.readyToPublish", cls: "text-emerald-400" };
}

export function QuickStartSummary({ articleId, hasContent, onSave, saveDisabled, saving }: Props) {
  const { t, lang } = useI18n();
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
        .select("quality_status,ai_score,burstiness_score,burstiness_status,keyword_density,keyword_density_status,turgenev_score,turgenev_status,language")
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
      if (!token) throw new Error(t("qss.sessionExpired"));
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
      const httpOk = resp.ok || resp.status === 202;
      if (!httpOk) throw new Error(edgeErrorMessage(payload, lang, t("qss.improveFailed")));
      if (payload?.cooldown) {
        toast.warning(payload.message || t("qss.cooldown"));
        return;
      }
      // Async: 202 accepted. Result will arrive via realtime on quality_status.
      toast.info(t("qss.improveStarted"));
      setData((d: any) => ({ ...d, quality_status: "improving" }));
    } catch (e: any) {
      toast.error(e?.message || t("qss.requestFailed"));
    } finally {
      setImproving(false);
    }
  }

  if (!hasContent) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center space-y-3">
        <div className="text-4xl">🚀</div>
        <p className="text-sm font-medium">{t("qss.pickKeyword")}</p>
        <p className="text-xs text-muted-foreground">{t("qss.weDoRest")}</p>
      </div>
    );
  }

  const ai = aiLabel(data.ai_score);
  const burst = burstLabel(data.burstiness_score);
  const dens = densityLabel(data.keyword_density_status);
  const turg = turgLabel(data.turgenev_score);

  const allEmpty =
    data.ai_score == null &&
    data.burstiness_score == null &&
    data.keyword_density == null &&
    data.turgenev_score == null;

  if (allEmpty) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center space-y-3">
        <div className="text-3xl">⏳</div>
        <p className="text-sm font-medium">{t("qss.checking")}</p>
        <p className="text-xs text-muted-foreground">{t("qss.willArrive")}</p>
        {onSave && (
          <Button variant="outline" className="w-full gap-2 mt-2" disabled={saveDisabled || saving} onClick={onSave}>
            <Save className="h-4 w-4" />
            {saving ? "..." : t("qss.save")}
          </Button>
        )}
      </div>
    );
  }

  const status = overallStatusKey([ai, burst, dens, turg]);

  const hasIssues = [ai, burst, dens, turg].some(r => r.tone === "warn" || r.tone === "fail");

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="text-xs text-muted-foreground">{t("qss.qualityTitle")}</div>
      <div className={`text-base font-semibold ${status.cls}`}>
        {t(status.key)}
      </div>
      <div className="border-t border-border pt-3 space-y-2 text-sm">
        <Row
          label={data.ai_score != null ? t("qss.humanWithVal", { n: data.ai_score }) : t("qss.humanScore")}
          value={ai}
          t={t}
        />
        {data.ai_score != null && (
          <div className="text-[11px] text-muted-foreground pl-4">
            {t("qss.aiLikeness", { n: Math.max(0, Math.min(100, 100 - Number(data.ai_score))) })}
          </div>
        )}
        <Row label={t("qss.rhythm")} value={burst} t={t} />
        <Row label={t("qss.density")} value={dens} t={t} />
        {data.language !== "en" && (
          <Row
            label={data.turgenev_score != null ? t("qss.turgenevWithVal", { n: data.turgenev_score }) : t("qss.turgenev")}
            value={turg}
            t={t}
          />
        )}
      </div>
      <div className="space-y-2 pt-2">
        {hasIssues && articleId && (
          <Button
            className="w-full gap-2 bg-purple-600 hover:bg-purple-500 text-white"
            disabled={improving}
            onClick={runImprove}
          >
            {improving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("qss.improveAuto")}
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
            {saving ? "..." : t("qss.save")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, t }: { label: string; value: LabelInfo; t: (k: string) => string }) {
  const ok = value.tone === "ok";
  const text = value.key ? t(value.key) : "-";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{ok ? "✓" : "·"} {label}</span>
      <span className={TONE_CLS[value.tone] || "text-muted-foreground"}>{text}</span>
    </div>
  );
}