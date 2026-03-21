import { UserPen } from "lucide-react";

export default function AuthorProfilesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserPen className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-semibold">Профили авторов</h1>
      </div>
      <p className="text-muted-foreground">
        Управление стилями авторов будет доступно здесь.
      </p>
    </div>
  );
}
