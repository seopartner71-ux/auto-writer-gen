import { Navigate } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import type { AppRole } from "@/shared/api/types";
import { Hexagon, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: React.ReactNode;
  requiredRole?: AppRole;
}

export function ProtectedRoute({ children, requiredRole }: Props) {
  const { session, role, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Block inactive users (admins always pass)
  if (profile && !profile.is_active && role !== "admin") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="text-center space-y-6 max-w-lg px-6">
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/20 blur-xl animate-pulse" />
              <div className="relative w-20 h-20 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Clock className="h-9 w-9 text-primary" />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <Hexagon className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold tracking-tight">
              СЕО-<span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-500">Модуль</span>
            </span>
          </div>
          <h2 className="text-2xl font-black text-foreground" style={{ letterSpacing: "-0.03em" }}>
            Доступ в режиме очереди
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Ваш аккаунт зарегистрирован. Чтобы гарантировать качество синтеза и 0% детекции ИИ, мы одобряем
            пользователей вручную. В течение 15 минут инженер активирует ваш профиль и начислит{" "}
            <span className="text-primary font-semibold">10 приветственных кредитов</span> на тест.
          </p>
          <div className="flex flex-col items-center gap-3 pt-2">
            <a
              href="https://t.me/sin0ptick"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="gap-2 border-primary/30 hover:bg-primary/10">
                <Send className="h-4 w-4" />
                Написать в поддержку (Telegram)
              </Button>
            </a>
            <p className="text-[11px] text-muted-foreground/50">Это ускорит процесс активации</p>
          </div>
        </div>
      </div>
    );
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
