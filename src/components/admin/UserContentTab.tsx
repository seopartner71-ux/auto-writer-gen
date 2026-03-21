import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { format } from "date-fns";

export function UserContentTab() {
  const { data: articles = [], isLoading } = useQuery({
    queryKey: ["admin-all-articles"],
    queryFn: async () => {
      // Fetch articles
      const { data: arts, error } = await supabase
        .from("articles")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!arts || arts.length === 0) return [];

      // Collect unique user_ids and keyword_ids
      const userIds = [...new Set(arts.map((a) => a.user_id))];
      const keywordIds = [...new Set(arts.map((a) => a.keyword_id).filter(Boolean))];

      // Fetch profiles and keywords in parallel
      const [profilesRes, keywordsRes] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name").in("id", userIds),
        keywordIds.length > 0
          ? supabase.from("keywords").select("id, seed_keyword").in("id", keywordIds)
          : Promise.resolve({ data: [] }),
      ]);

      const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.id, p]));
      const keywordMap = new Map((keywordsRes.data || []).map((k: any) => [k.id, k]));

      return arts.map((a) => ({
        ...a,
        _profile: profileMap.get(a.user_id) || null,
        _keyword: keywordMap.get(a.keyword_id!) || null,
      }));
    },
  });

  return (
    <Card className="bg-card border-border">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-4 text-muted-foreground">Загрузка...</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Пользователь</TableHead>
                <TableHead>Заголовок</TableHead>
                <TableHead>Ключевое слово</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Дата</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {articles.map((art: any) => (
                <TableRow key={art.id} className="border-border">
                  <TableCell className="text-xs">
                    <div>{art._profile?.full_name || "—"}</div>
                    <div className="text-muted-foreground font-mono">{art._profile?.email || "—"}</div>
                  </TableCell>
                  <TableCell className="font-medium max-w-[300px] truncate">
                    {art.title || "Без заголовка"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {art._keyword?.seed_keyword || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={art.status === "published" ? "default" : "outline"}
                      className="text-xs"
                    >
                      {art.status === "published" ? "Опубликована" : art.status === "review" ? "На проверке" : "Черновик"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {art.created_at ? format(new Date(art.created_at), "dd.MM.yyyy HH:mm") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {articles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    Нет статей
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
