import { Settings } from "lucide-react";
import { useAuth } from "@/shared/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const { user, profile } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Настройки</h1>
      </div>

      <Card className="bg-card border-border max-w-lg">
        <CardHeader>
          <CardTitle className="text-lg">Профиль</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Email</span>
            <span>{user?.email}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Имя</span>
            <span>{profile?.full_name ?? "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Тариф</span>
            <span className="text-primary uppercase font-medium">{profile?.plan ?? "basic"}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
