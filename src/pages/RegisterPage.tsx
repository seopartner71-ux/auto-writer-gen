import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Hexagon } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { trackActivation } from "@/shared/utils/activationTracking";

const TURNSTILE_SITE_KEY = "0x4AAAAAAC84aeQX5SSFSSdh";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [niche, setNiche] = useState("");
  const [plannedArticles, setPlannedArticles] = useState("");
  const [referralSource, setReferralSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  // Check whether public registration is enabled (admin toggle in app_settings)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("is_registration_enabled");
        if (cancelled) return;
        if (error) {
          // Fail open on RPC error - admin can still disable via UI later
          setRegistrationOpen(true);
        } else {
          setRegistrationOpen(data !== false);
        }
      } catch {
        if (!cancelled) setRegistrationOpen(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || !(window as any).turnstile) return;
    if (registrationOpen === false) return;
    // Clear previous widget
    if (widgetIdRef.current) {
      try { (window as any).turnstile.remove(widgetIdRef.current); } catch {}
      widgetIdRef.current = null;
    }
    widgetIdRef.current = (window as any).turnstile.render(turnstileRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
      theme: "dark",
      language: lang === "ru" ? "ru" : "en",
    });
  }, [lang]);

  useEffect(() => {
    if (registrationOpen !== true) return;
    // Load Turnstile script if not already loaded
    if ((window as any).turnstile) {
      renderTurnstile();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
    script.async = true;
    (window as any).onTurnstileLoad = () => renderTurnstile();
    document.head.appendChild(script);
    return () => {
      if (widgetIdRef.current) {
        try { (window as any).turnstile?.remove(widgetIdRef.current); } catch {}
      }
    };
  }, [renderTurnstile, registrationOpen]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      toast.error(t("auth.acceptTerms"));
      return;
    }
    if (!fullName.trim() || !niche.trim() || !plannedArticles.trim() || !referralSource.trim()) {
      toast.error(t("auth.fillAllFields"));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("auth.passwordsMismatch"));
      return;
    }
    if (!turnstileToken) {
      toast.error(t("auth.captchaRequired"));
      return;
    }
    setLoading(true);
    // Detect real client IP
    let registrationIp: string | null = null;
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json");
      if (ipRes.ok) {
        const text = await ipRes.text();
        try {
          const ipData = JSON.parse(text);
          registrationIp = ipData.ip || null;
        } catch {
          const cleaned = text.trim();
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
            registrationIp = cleaned;
          }
        }
      }
    } catch { /* ignore */ }

    // Check registration limits + Turnstile verification
    try {
      const { data: checkResult } = await supabase.functions.invoke("check-registration", {
        body: { email, client_ip: registrationIp, turnstile_token: turnstileToken },
      });
      if (checkResult && !checkResult.allowed) {
        toast.error(checkResult.reason || t("auth.registrationBlocked"));
        // Reset Turnstile for retry
        setTurnstileToken(null);
        if (widgetIdRef.current && (window as any).turnstile) {
          (window as any).turnstile.reset(widgetIdRef.current);
        }
        setLoading(false);
        return;
      }
      registrationIp = checkResult?.ip || registrationIp;
    } catch {
      // If check fails, allow registration to proceed
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name: fullName,
          registration_ip: registrationIp,
          onboarding_niche: niche.trim(),
          planned_articles_month: parseInt(plannedArticles) || 0,
          referral_source: referralSource.trim(),
        },
      },
    });
    setLoading(false);
    if (error) {
      const errKeyMap: Record<string, string> = {
        "Password is known to be weak and easy to guess, please choose a different one.": "auth.err.weakPassword",
        "User already registered": "auth.err.alreadyRegistered",
        "Password should be at least 6 characters.": "auth.err.passwordShort",
        "Unable to validate email address: invalid format": "auth.err.emailFormat",
        "Signup requires a valid password": "auth.err.passwordRequired",
        "Password is too weak. It has been found in a database of compromised passwords.": "auth.err.passwordCompromised",
      };
      const mapped = errKeyMap[error.message];
      toast.error(mapped ? t(mapped) : error.message);
      // Reset Turnstile
      setTurnstileToken(null);
      if (widgetIdRef.current && (window as any).turnstile) {
        (window as any).turnstile.reset(widgetIdRef.current);
      }
    } else {
      // Open registration + auto_confirm=true: session is active immediately.
      // Send new user straight into onboarding (/welcome) — not a dead-end screen.
      try { localStorage.removeItem("onboarding_skipped"); } catch {}
      try { localStorage.removeItem("first_article_wizard_shown"); } catch {}
      // Mark this browser as "just registered" so WelcomePage always shows
      // the onboarding, even if useAuth is still hydrating or the account
      // somehow has legacy articles/localStorage flags.
      try { sessionStorage.setItem("just_registered", "1"); } catch {}
      // v3 funnel: registration_completed. utm_source from URL (?utm_source=...) or 'direct'.
      try {
        const utm = new URLSearchParams(window.location.search).get("utm_source") || "direct";
        const { getAttribution, deriveSource } = await import("@/shared/utils/attribution");
        const attr = getAttribution();
        void trackActivation("registration_completed", {
          source: attr ? deriveSource(attr) : utm,
          attribution: attr ?? undefined,
        });
      } catch { /* ignore */ }
      toast.success(t("auth.registerSuccessShort"));
      navigate("/welcome", { replace: true });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Hexagon className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-brand tracking-tight">
            {lang === "ru"
              ? (<>СЕО-<span className="gradient-text inline-block whitespace-nowrap">Модуль</span></>)
              : (<span className="gradient-text inline-block whitespace-nowrap">{t("brand.name")}</span>)}
          </CardTitle>
          <CardDescription>
            {registrationOpen === false
              ? t("auth.registrationClosed")
              : t("auth.registerTitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {registrationOpen === false ? (
            <div className="space-y-4 text-center">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-4 text-sm text-amber-300/90">
                {t("auth.registrationClosedDesc")}
              </div>
              <a
                href="https://t.me/sin0ptick"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-sm text-primary hover:underline"
              >
                {t("auth.messageTelegram")}
              </a>
              <div className="text-xs text-muted-foreground">
                <Link to="/login" className="hover:text-primary">
                  {t("auth.alreadyHaveAccount")}
                </Link>
              </div>
            </div>
          ) : (
          <>
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-emerald-300/90">
            <div className="font-tech font-semibold mb-0.5">
              {t("auth.closedRegBadge")}
            </div>
            <div className="text-emerald-300/70 text-[11px]">
              {t("auth.closedRegDesc")}
            </div>
          </div>
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t("auth.name")}</Label>
              <Input
                id="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t("auth.namePlaceholder")}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.email")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")}
                minLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t("auth.confirmPassword")}
                minLength={6}
                required
              />
            </div>

            <div className="border-t border-border pt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="niche">{t("auth.onboardingNiche")}</Label>
                <Input
                  id="niche"
                  value={niche}
                  onChange={(e) => setNiche(e.target.value)}
                  placeholder={t("auth.onboardingNichePlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plannedArticles">{t("auth.plannedArticles")}</Label>
                <Input
                  id="plannedArticles"
                  type="number"
                  min={1}
                  value={plannedArticles}
                  onChange={(e) => setPlannedArticles(e.target.value)}
                  placeholder={t("auth.plannedArticlesPlaceholder")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="referralSource">{t("auth.referralSource")}</Label>
                <Input
                  id="referralSource"
                  value={referralSource}
                  onChange={(e) => setReferralSource(e.target.value)}
                  placeholder={t("auth.referralSourcePlaceholder")}
                  required
                />
              </div>
            </div>

            {/* Cloudflare Turnstile CAPTCHA */}
            <div className="flex justify-center">
              <div ref={turnstileRef} />
            </div>

            <div className="flex items-start gap-2">
              <Checkbox
                id="terms"
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                className="mt-0.5"
              />
              <label htmlFor="terms" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                {t("auth.termsAgreementRu")}{" "}
                <Link to="/offer" className="text-primary hover:underline" target="_blank">{t("auth.termsOffer")}</Link>{" "}
                {t("auth.termsAnd")}{" "}
                <Link to="/privacy" className="text-primary hover:underline" target="_blank">{t("auth.termsPrivacy")}</Link>
              </label>
            </div>

            <Button type="submit" className="w-full" disabled={loading || !agreed || !turnstileToken}>
              {loading ? t("auth.registering") : t("auth.register")}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            {t("auth.hasAccount")}{" "}
            <Link to="/login" className="text-primary hover:underline">
              {t("auth.login")}
            </Link>
          </div>
          </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
