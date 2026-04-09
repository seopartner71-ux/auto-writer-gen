import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Hexagon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/shared/hooks/useI18n";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: { full_name: fullName },
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

  const handleGoogleSignIn = async () => {
    if (!agreed) {
      toast.error(lang === "ru" ? "Необходимо принять условия оферты и политику конфиденциальности" : "You must accept the terms and privacy policy");
      return;
    }
    setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });

      if (result.error) {
        toast.error(result.error.message || "Ошибка входа через Google");
        setGoogleLoading(false);
        return;
      }

      if (result.redirected) {
        return;
      }

      navigate("/dashboard");
    } catch (err: any) {
      toast.error(err?.message || "Ошибка входа через Google");
      setGoogleLoading(false);
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

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">{t("common.or")}</span>
            </div>
          </div>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || !agreed}
          >
            {googleLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            )}
            {t("auth.googleSignIn")}
          </Button>

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
