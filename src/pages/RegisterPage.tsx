import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Пароли не совпадают");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
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


  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <Hexagon className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl font-brand tracking-tight">SERP<span className="gradient-text">blueprint</span> <sup className="text-xs text-muted-foreground font-sans font-normal">v2.0</sup></CardTitle>
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
              <Label htmlFor="confirmPassword">Повторите пароль</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Повторите пароль"
                minLength={6}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
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
