import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Search } from "lucide-react";
import { format } from "date-fns";

export function UserContentTab() {
  const { data: keywords = [], isLoading: loadingKw } = useQuery({
    queryKey: ["admin-all-keywords"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("*, profiles:user_id(email, full_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const { data: articles = [], isLoading: loadingArt } = useQuery({
    queryKey: ["admin-all-articles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*, profiles:user_id(email, full_name), keywords:keyword_id(seed_keyword)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  return (
    <Tabs defaultValue="keywords" className="w-full">
      <TabsList className="bg-muted border border-border">
        <TabsTrigger value="keywords">
          <Search className="h-4 w-4 mr-1" /> Запросы ({keywords.length})
        </TabsTrigger>
        <TabsTrigger value="articles">
          <FileText className="h-4 w-4 mr-1" /> Статьи ({articles.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="keywords" className="mt-4">
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {loadingKw ? (
              <div className="p-4 text-muted-foreground">Загрузка...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead>Пользователь</TableHead>
                    <TableHead>Ключевое слово</TableHead>
                    <TableHead>Интент</TableHead>
                    <TableHead className="text-right">Объём</TableHead>
                    <TableHead className="text-right">Сложность</TableHead>
                    <TableHead>Дата</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keywords.map((kw: any) => (
                    <TableRow key={kw.id} className="border-border">
                      <TableCell className="text-xs">
                        <div>{(kw.profiles as any)?.full_name || "—"}</div>
                        <div className="text-muted-foreground font-mono">{(kw.profiles as any)?.email}</div>
                      </TableCell>
                      <TableCell className="font-medium">{kw.seed_keyword}</TableCell>
                      <TableCell>
                        {kw.intent && (
                          <Badge variant="outline" className="text-xs">{kw.intent}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {kw.volume?.toLocaleString() ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {kw.difficulty ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {kw.created_at ? format(new Date(kw.created_at), "dd.MM.yyyy HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {keywords.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Нет данных
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="articles" className="mt-4">
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            {loadingArt ? (
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
                        <div>{(art.profiles as any)?.full_name || "—"}</div>
                        <div className="text-muted-foreground font-mono">{(art.profiles as any)?.email}</div>
                      </TableCell>
                      <TableCell className="font-medium max-w-[300px] truncate">
                        {art.title || "Без заголовка"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {(art.keywords as any)?.seed_keyword || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={art.status === "published" ? "default" : "outline"}
                          className="text-xs"
                        >
                          {art.status}
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
                        Нет данных
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
