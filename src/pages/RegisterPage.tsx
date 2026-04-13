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
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  const renderTurnstile = useCallback(() => {
    if (!turnstileRef.current || !(window as any).turnstile) return;
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
  }, [renderTurnstile]);

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
      toast.error(lang === "ru" ? "Пожалуйста, пройдите проверку CAPTCHA" : "Please complete the CAPTCHA check");
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
        toast.error(checkResult.reason || (lang === "ru" ? "Регистрация заблокирована" : "Registration blocked"));
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
      const ruErrors: Record<string, string> = {
        "Password is known to be weak and easy to guess, please choose a different one.": "Пароль слишком простой и легко угадывается. Пожалуйста, выберите другой.",
        "User already registered": "Пользователь с таким email уже зарегистрирован.",
        "Password should be at least 6 characters.": "Пароль должен быть не менее 6 символов.",
        "Unable to validate email address: invalid format": "Неверный формат email адреса.",
        "Signup requires a valid password": "Необходимо указать пароль.",
        "Password is too weak. It has been found in a database of compromised passwords.": "Пароль обнаружен в базе скомпрометированных паролей. Выберите другой.",
      };
      toast.error(lang === "ru" ? (ruErrors[error.message] || error.message) : error.message);
      // Reset Turnstile
      setTurnstileToken(null);
      if (widgetIdRef.current && (window as any).turnstile) {
        (window as any).turnstile.reset(widgetIdRef.current);
      }
    } else {
      toast.success(t("auth.registerSuccess"), { duration: 8000 });
      navigate("/login");
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
          <CardTitle className="text-2xl font-brand tracking-tight">СЕО-<span className="gradient-text">Модуль</span></CardTitle>
          <CardDescription>{t("auth.registerTitle")}</CardDescription>
        </CardHeader>
        <CardContent>
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
                {lang === "ru" ? (
                  <>Я согласен с условиями{" "}
                    <Link to="/offer" className="text-primary hover:underline" target="_blank">Публичной оферты</Link>{" "}и{" "}
                    <Link to="/privacy" className="text-primary hover:underline" target="_blank">Политикой конфиденциальности</Link></>
                ) : (
                  <>I agree to the{" "}
                    <Link to="/offer" className="text-primary hover:underline" target="_blank">Public Offer</Link>{" "}and{" "}
                    <Link to="/privacy" className="text-primary hover:underline" target="_blank">Privacy Policy</Link></>
                )}
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
        </CardContent>
      </Card>
    </div>
  );
}
