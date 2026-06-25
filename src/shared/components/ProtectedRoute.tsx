import { Navigate } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import type { AppRole } from "@/shared/api/types";
import { Hexagon, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  children: React.ReactNode;
  requiredRole?: AppRole;
  allowedRoles?: AppRole[];
}

export function ProtectedRoute({ children, requiredRole, allowedRoles }: Props) {
  const { session, role, profile, loading } = useAuth();
  const { t } = useI18n();

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

  // Block inactive users (admins always pass). With closed registration the
  // `status` field carries the precise state (pending / blocked); fall back to
  // legacy `is_active` for safety on any profile that wasn't backfilled yet.
  const status = (profile as any)?.status as "pending" | "active" | "blocked" | undefined;
  const isBlocked = status === "blocked";
  const isPending = !profile?.is_active && !isBlocked;
  if (profile && !profile.is_active && role !== "admin") {
    const title = isBlocked
      ? (t("protected.blockedTitle") || "Доступ заблокирован")
      : t("protected.queueTitle");
    const intro = isBlocked
      ? (t("protected.blockedIntro") || "Ваш аккаунт заблокирован администратором. Свяжитесь с поддержкой, чтобы уточнить причину.")
      : (t("protected.pendingIntro") || "Ваша заявка отправлена и ожидает ручной проверки. Мы пришлём письмо, как только активируем аккаунт.");
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
            {title}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">{intro}</p>
          {isPending && (
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              {t("protected.warning")}
            </p>
          )}
          <div className="flex flex-col items-center gap-3 pt-2">
            <a
              href="https://t.me/sin0ptick"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" className="gap-2 border-primary/30 hover:bg-primary/10">
                <Send className="h-4 w-4" />
                {t("protected.contactSupportTg")}
              </Button>
            </a>
            {isPending && (
              <p className="text-[11px] text-muted-foreground/50">{t("protected.speedUp")}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  if (allowedRoles && allowedRoles.length > 0 && (!role || !allowedRoles.includes(role))) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
