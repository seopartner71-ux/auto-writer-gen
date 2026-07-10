import { useEffect, useState } from "react";
import { Star, Loader2, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";

type ProblemType =
  | "none"
  | "factual"
  | "style"
  | "structure"
  | "length"
  | "repetition"
  | "off_topic"
  | "other";

interface Props {
  articleId: string;
  language?: "ru" | "en";
}

const PROBLEM_VALUES: ProblemType[] = [
  "none", "factual", "style", "structure", "length", "repetition", "off_topic", "other",
];

export function ArticleFeedback({ articleId, language = "ru" }: Props) {
  const { t } = useI18n();
  // `language` is kept in the API for callers, but strings resolve via the
  // global i18n so a UI-language switch takes effect immediately.
  void language;
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [problem, setProblem] = useState<ProblemType>("none");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid || !articleId) { setLoading(false); return; }
      const { data } = await supabase
        .from("article_feedback")
        .select("rating, problem_type, comment")
        .eq("article_id", articleId)
        .eq("user_id", uid)
        .maybeSingle();
      if (cancel) return;
      if (data) {
        setRating(data.rating ?? 0);
        setProblem((data.problem_type as ProblemType) ?? "none");
        setComment(data.comment ?? "");
        setSaved(true);
      }
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [articleId]);

  const submit = async () => {
    if (!rating) {
      toast.error(t("feedback.pickRating"));
      return;
    }
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) { setSaving(false); return; }
    const { error } = await supabase
      .from("article_feedback")
      .upsert(
        {
          article_id: articleId,
          user_id: uid,
          rating,
          problem_type: problem,
          comment: comment.trim() || null,
        },
        { onConflict: "article_id,user_id" }
      );
    setSaving(false);
    if (error) {
      toast.error(t("feedback.saveError"));
      return;
    }
    setSaved(true);
    setOpen(false);
    toast.success(t("feedback.thanks"));
  };

  if (loading || !articleId) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-card/50 p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {t("feedback.rateQuality")}
          </span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => { setRating(n); setOpen(true); setSaved(false); }}
                className="p-0.5"
                aria-label={`${n}`}
              >
                <Star
                  className={cn(
                    "h-4 w-4 transition-colors",
                    (hover || rating) >= n
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  )}
                />
              </button>
            ))}
          </div>
          {saved && !open && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="h-3 w-3" />
              {t("feedback.saved")}
            </span>
          )}
        </div>
        {rating > 0 && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-xs text-primary hover:underline"
          >
            {t("feedback.edit")}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {PROBLEM_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setProblem(value)}
                className={cn(
                  "px-2 py-1 rounded-md text-xs border transition-colors",
                  problem === value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                )}
              >
                {t(`feedback.problem.${value}`)}
              </button>
            ))}
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 1000))}
            placeholder={t("feedback.commentPlaceholder")}
            className="min-h-[60px] text-sm"
          />
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              {t("feedback.cancel")}
            </Button>
            <Button size="sm" onClick={submit} disabled={saving || !rating}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {t("feedback.submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ArticleFeedback;