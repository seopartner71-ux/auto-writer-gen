import { Navigate } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import type { AppRole } from "@/shared/api/types";

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
        <div className="text-center space-y-3 max-w-md px-6">
          <h2 className="text-xl font-semibold text-foreground">Аккаунт неактивен</h2>
          <p className="text-sm text-muted-foreground">
            Ваш аккаунт ещё не активирован администратором. Пожалуйста, обратитесь к администратору для активации.
          </p>
        </div>
      </div>
    );
  }

  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
