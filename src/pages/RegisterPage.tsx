import { useState } from "react";
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

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const navigate = useNavigate();
  const { t, lang } = useI18n();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      toast.error(lang === "ru" ? "Необходимо принять условия оферты и политику конфиденциальности" : "You must accept the terms and privacy policy");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    setLoading(true);
    // Check registration limits (email aliases + IP)
    try {
      const { data: checkResult } = await supabase.functions.invoke("check-registration", {
        body: { email },
      });
      if (checkResult && !checkResult.allowed) {
        toast.error(checkResult.reason || "Регистрация заблокирована");
        setLoading(false);
        return;
      }
      // Store IP for registration tracking
      var registrationIp = checkResult?.ip || null;
    } catch {
      // If check fails, allow registration to proceed
      var registrationIp = null;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { full_name: fullName, registration_ip: registrationIp },
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
      };
      toast.error(ruErrors[error.message] || error.message);
    } else {
      toast.success("Вы успешно зарегистрированы! Проверьте вашу почту для подтверждения аккаунта.", { duration: 8000 });
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
              <Label htmlFor="confirmPassword">{lang === "ru" ? "Повторите пароль" : "Confirm password"}</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={lang === "ru" ? "Повторите пароль" : "Confirm password"}
                minLength={6}
                required
              />
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

            <Button type="submit" className="w-full" disabled={loading || !agreed}>
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
