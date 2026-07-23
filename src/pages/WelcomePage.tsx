import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Loader2, Rocket, Sparkles, UserCheck, PenLine, FlaskConical } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";
import { trackActivation, trackActivationOnce } from "@/shared/utils/activationTracking";

const LS_KEY = "first_article_wizard_shown";

const STYLES = [
  { id: "expert",  icon: UserCheck,    labelKey: "welcome.styleExpert",  descKey: "welcome.styleExpertDesc" },
  { id: "blogger", icon: PenLine,      labelKey: "welcome.styleBlogger", descKey: "welcome.styleBloggerDesc" },
  { id: "analyst", icon: FlaskConical, labelKey: "welcome.styleAnalyst", descKey: "welcome.styleAnalystDesc" },
];

const EXAMPLES_BY_LANG: Record<string, string[]> = {
  ru: [
    "seo аудит сайта чек-лист",
    "коммерческая недвижимость москва аренда",
    "интеграция crm с 1с",
    "лазерная эпиляция цена спб",
  ],
  en: [
    "b2b saas seo strategy",
    "commercial real estate nyc lease",
    "crm integration best practices",
    "enterprise cybersecurity checklist",
  ],
};

export default function WelcomePage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const { t, lang } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [author, setAuthor] = useState("blogger");
  const [checking, setChecking] = useState(true);
  const startedTypingRef = (globalThis as any).__welcomeTyped ||= { fired: false };
  const EXAMPLES = EXAMPLES_BY_LANG[lang] || EXAMPLES_BY_LANG.ru;

  // WelcomePage IS the onboarding surface for new users → fire the canonical
  // `onboarding_modal_shown` event on first mount (once per browser).
  useEffect(() => {
    if (!loading && user && !checking) {
      trackActivationOnce("onboarding_modal_shown", { surface: "welcome_page" });
    }
  }, [loading, user, checking]);

  // Bail out if user already has articles or already saw the wizard
  useEffect(() => {
    if (loading) return;
    const justRegistered = (() => {
      try { return sessionStorage.getItem("just_registered") === "1"; } catch { return false; }
    })();
    if (!user) {
      // Right after signUp the session may still be hydrating — don't bounce
      // to /login. Just wait for useAuth to resolve on the next tick.
      if (justRegistered) return;
      navigate("/login", { replace: true });
      return;
    }
    if (justRegistered) {
      // A brand-new user must ALWAYS see this onboarding — ignore stale
      // LS flags and any pre-existing articles from previous accounts.
      try { localStorage.removeItem(LS_KEY); } catch {}
      try { localStorage.removeItem("onboarding_skipped"); } catch {}
      setChecking(false);
      return;
    }
    if (localStorage.getItem(LS_KEY) === "true") {
      navigate("/articles", { replace: true });
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("articles")
        .select("id", { count: "exact", head: true })
        .eq("is_ab_test", false);
      if ((count ?? 0) > 0) {
        localStorage.setItem(LS_KEY, "true");
        navigate("/articles", { replace: true });
      } else {
        setChecking(false);
      }
    })();
  }, [user, loading, navigate]);

  const handleStart = () => {
    const kw = keyword.trim();
    if (kw.length < 2) return;
    localStorage.setItem(LS_KEY, "true");
    try { sessionStorage.removeItem("just_registered"); } catch {}
    void trackActivation("onboarding_quick_path_clicked", { surface: "welcome_page" });
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
    localStorage.setItem("onboarding_skipped", "true");
    try { sessionStorage.removeItem("just_registered"); } catch {}
    void trackActivation("onboarding_skipped", { surface: "welcome_page" });
    navigate("/articles", { replace: true });
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
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
              {t("welcome.eyebrow")}
            </span>
          </div>
          <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight leading-tight">
            {t("welcome.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            {t("welcome.subtitle")}
          </p>
        </div>

        <div className="space-y-3">
          <label className="text-sm font-medium">{t("welcome.aboutWhat")}</label>
          <Input
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              if (
                !startedTypingRef.fired &&
                e.target.value.trim().length > 0 &&
                !sessionStorage.getItem("kw_entered")
              ) {
                startedTypingRef.fired = true;
                sessionStorage.setItem("kw_entered", "1");
                void trackActivation("keyword_entered", {
                  source: "welcome",
                  keyword_length: e.target.value.length,
                });
              }
            }}
            onFocus={() => void trackActivation("focused_keyword_field", { source: "welcome" })}
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