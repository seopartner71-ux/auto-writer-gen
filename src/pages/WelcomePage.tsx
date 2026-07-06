import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Rocket, Sparkles, UserCheck, PenLine, FlaskConical } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const LS_KEY = "first_article_wizard_shown";

const STYLES = [
  { id: "expert",  icon: UserCheck,    labelKey: "welcome.styleExpert",  descKey: "welcome.styleExpertDesc" },
  { id: "blogger", icon: PenLine,      labelKey: "welcome.styleBlogger", descKey: "welcome.styleBloggerDesc" },
  { id: "analyst", icon: FlaskConical, labelKey: "welcome.styleAnalyst", descKey: "welcome.styleAnalystDesc" },
];

const EXAMPLES_BY_LANG: Record<string, string[]> = {
  ru: ["купить диван недорого", "стоматология Москва цены", "как похудеть за месяц"],
  en: ["buy cheap sofa", "dentist New York prices", "how to lose weight in a month"],
};

export default function WelcomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t, lang } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [author, setAuthor] = useState("blogger");
  const [checking, setChecking] = useState(true);
  const EXAMPLES = EXAMPLES_BY_LANG[lang] || EXAMPLES_BY_LANG.ru;

  // Bail out if user already has articles or already saw the wizard
  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/login", { replace: true }); return; }
    if (localStorage.getItem(LS_KEY) === "true") {
      navigate("/dashboard", { replace: true });
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("is_ab_test", false);
      if ((count ?? 0) > 0) {
        localStorage.setItem(LS_KEY, "true");
        navigate("/dashboard", { replace: true });
      } else {
        setChecking(false);
      }
    })();
  }, [user, loading, navigate]);

  const handleStart = () => {
    const kw = keyword.trim();
    if (kw.length < 2) return;
    localStorage.setItem(LS_KEY, "true");
    const params = new URLSearchParams({
      keyword: kw,
      author,
      mode: "quick",
      autostart: "true",
    });
    navigate(`/quick-start?${params.toString()}`);
  };

  const handleSkip = () => {
    localStorage.setItem(LS_KEY, "true");
    navigate("/dashboard", { replace: true });
  };

  if (loading || checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-2xl p-8 space-y-6 border-border">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">{t("welcome.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("welcome.subtitle")}</p>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">{t("welcome.aboutWhat")}</label>
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("welcome.placeholder")}
            className="h-12 text-base"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleStart(); }}
          />
          <div className="text-xs text-muted-foreground">
            <div className="mb-1">{t("welcome.examples")}</div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setKeyword(ex)}
                  className="px-2 py-1 rounded-md bg-muted hover:bg-muted/70 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">{t("welcome.chooseStyle")}</label>
          <div className="grid grid-cols-3 gap-3">
            {STYLES.map((s) => {
              const Icon = s.icon;
              const active = author === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setAuthor(s.id)}
                  className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                    active
                      ? "border-primary bg-primary/5 shadow-[0_0_20px_-8px_hsl(var(--primary)/0.5)]"
                      : "border-border hover:border-border/80 bg-card"
                  }`}
                >
                  <Icon className={`h-6 w-6 ${active ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="text-sm font-medium">{t(s.labelKey)}</div>
                  <div className="text-[11px] text-muted-foreground text-center">{t(s.descKey)}</div>
                </button>
              );
            })}
          </div>
        </div>

        <Button
          size="lg"
          className="w-full h-12 text-base"
          onClick={handleStart}
          disabled={keyword.trim().length < 2}
        >
          <Rocket className="h-5 w-5" />
          {t("welcome.startCta")}
        </Button>

        <div className="border-t border-border pt-4 text-center">
          <button
            type="button"
            onClick={handleSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("welcome.skip")}
          </button>
        </div>
      </Card>
    </div>
  );
}