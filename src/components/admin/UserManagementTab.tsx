import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users, Save, Trash2, Coins, Clock, Mail, ChevronDown, ChevronUp, FileText, Target, Calendar, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { useAuth } from "@/shared/hooks/useAuth";
import { AddCreditsDialog } from "./AddCreditsDialog";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: string;
  monthly_limit: number;
  is_active: boolean;
  credits_amount: number;
  created_at: string;
  last_ip: string | null;
  last_login_at: string | null;
  onboarding_niche: string | null;
  referral_source: string | null;
  planned_articles_month: number | null;
}

interface UserUsage {
  user_id: string;
  total_tokens: number;
}

const COST_PER_1K = 0.002;

export function UserManagementTab() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editLimit, setEditLimit] = useState("");
  const [editCredits, setEditCredits] = useState("");
  const [creditsUser, setCreditsUser] = useState<{ id: string; email: string | null; credits_amount: number } | null>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [messageUser, setMessageUser] = useState<{ id: string; email: string | null } | null>(null);
  const [messageSubject, setMessageSubject] = useState("");
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const { data: planNames = {} } = useQuery({
    queryKey: ["admin-plan-names"],
    queryFn: async () => {
      const { data, error } = await supabase.from("subscription_plans").select("id, name");
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data || []) map[row.id] = row.name;
      return map;
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      return data as UserProfile[];
    },
  });

  const { data: statsData = [] } = useQuery({
    queryKey: ["admin-user-stats"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_stats").select("user_id, last_activity_at, total_articles_created, total_words_generated");
      if (error) throw error;
      return data as { user_id: string; last_activity_at: string | null; total_articles_created: number | null; total_words_generated: number | null }[];
    },
  });

  const { data: usageData = [] } = useQuery({
    queryKey: ["admin-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_logs")
        .select("user_id, tokens_used");
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data) {
        map.set(row.user_id, (map.get(row.user_id) || 0) + (row.tokens_used || 0));
      }
      return Array.from(map.entries()).map(([user_id, total_tokens]) => ({
        user_id,
        total_tokens,
      })) as UserUsage[];
    },
  });

  // Fetch articles for expanded user stats
  const { data: allArticles = [] } = useQuery({
    queryKey: ["admin-all-articles-keywords"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("user_id, keywords, created_at");
      if (error) throw error;
      return data as { user_id: string; keywords: string[] | null; created_at: string | null }[];
    },
  });

  const userArticleStats = useMemo(() => {
    const map = new Map<string, { count: number; keywordMap: Map<string, number>; lastArticle: string | null }>();
    for (const a of allArticles) {
      const entry = map.get(a.user_id) || { count: 0, keywordMap: new Map(), lastArticle: null };
      entry.count++;
      if (a.keywords) {
        for (const kw of a.keywords) {
          entry.keywordMap.set(kw, (entry.keywordMap.get(kw) || 0) + 1);
        }
      }
      if (!entry.lastArticle || (a.created_at && a.created_at > entry.lastArticle)) {
        entry.lastArticle = a.created_at;
      }
      map.set(a.user_id, entry);
    }
    return map;
  }, [allArticles]);

  const updateUser = useMutation({
    mutationFn: async ({ userId, plan, limit, credits }: { userId: string; plan: string; limit: number; credits: number }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ plan, monthly_limit: limit, credits_amount: credits })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      setEditingUser(null);
      toast.success("Пользователь обновлён");
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const user = profiles.find((p) => p.id === userId);
      const wasInactive = user && !user.is_active;

      const { error } = await supabase
        .from("profiles")
        .update({ is_active: isActive })
        .eq("id", userId);
      if (error) throw error;

      if (isActive && wasInactive && user && user.credits_amount === 0) {
        await supabase.rpc("admin_add_credits", {
          p_user_id: userId,
          p_amount: 10,
          p_notify: true,
          p_comment: "Приветственные кредиты — добро пожаловать в СЕО-Модуль! 🎉",
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast.success("Статус обновлён");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: userId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast.success("Пользователь удалён");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSendMessage = async () => {
    if (!messageUser || !messageSubject.trim() || !messageText.trim()) {
      toast.error("Заполните тему и текст сообщения");
      return;
    }
    setSendingMessage(true);
    try {
      const { error } = await supabase.from("notifications").insert({
        user_id: messageUser.id,
        title: messageSubject.trim(),
        message: messageText.trim(),
      });
      if (error) throw error;
      toast.success(`Уведомление отправлено пользователю ${messageUser.email}`);
      setMessageUser(null);
      setMessageSubject("");
      setMessageText("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSendingMessage(false);
    }
  };

  const getUsage = (userId: string) =>
    usageData.find((u) => u.user_id === userId)?.total_tokens ?? 0;

  const getLastActivity = (userId: string) => {
    const stat = statsData.find((s) => s.user_id === userId);
    return stat?.last_activity_at ? format(new Date(stat.last_activity_at), 'dd.MM.yyyy HH:mm') : '—';
  };

  const getUserStats = (userId: string) => statsData.find((s) => s.user_id === userId);

  const getTopKeywords = (userId: string, limit = 5) => {
    const stats = userArticleStats.get(userId);
    if (!stats || stats.keywordMap.size === 0) return [];
    return Array.from(stats.keywordMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([kw, count]) => ({ keyword: kw, count }));
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Загрузка...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <span className="text-sm text-muted-foreground">
          {profiles.length} пользователей
        </span>
        <Badge variant="outline" className="text-xs">
          {profiles.filter((p) => p.is_active).length} активных
        </Badge>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead></TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead>Регистрация</TableHead>
                <TableHead>Активность</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead className="text-center">Активен</TableHead>
                <TableHead className="text-right">Токены</TableHead>
                <TableHead className="text-right">≈ $</TableHead>
                <TableHead className="text-right">Кредиты</TableHead>
                <TableHead className="text-right">Лимит</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map((p) => {
                const tokens = getUsage(p.id);
                const cost = ((tokens / 1000) * COST_PER_1K).toFixed(4);
                const isEditing = editingUser === p.id;
                const isExpanded = expandedUser === p.id;
                const articleStats = userArticleStats.get(p.id);
                const topKws = getTopKeywords(p.id);
                const userStat = getUserStats(p.id);

                return (
                  <>
                    <TableRow
                      key={p.id}
                      className={`border-border ${!p.is_active ? "opacity-50" : ""} cursor-pointer hover:bg-muted/30`}
                      onClick={() => setExpandedUser(isExpanded ? null : p.id)}
                    >
                      <TableCell className="w-8 px-2">
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-1.5">
                          {p.email}
                          {!p.is_active && (
                            <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-500 gap-1 px-1.5 py-0">
                              <Clock className="h-2.5 w-2.5" />
                              Ожидает
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.full_name || '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.created_at ? format(new Date(p.created_at), 'dd.MM.yyyy') : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {getLastActivity(p.id)}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {p.last_ip || '—'}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <Select value={editPlan} onValueChange={setEditPlan}>
                            <SelectTrigger className="h-8 w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="free">{planNames["free"] || "Free"}</SelectItem>
                              <SelectItem value="basic">{planNames["basic"] || "Basic"}</SelectItem>
                              <SelectItem value="pro">{planNames["pro"] || "Pro"}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs font-medium text-primary uppercase">
                            {planNames[p.plan] || p.plan}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={p.is_active}
                          onCheckedChange={(checked) =>
                            toggleActive.mutate({ userId: p.id, isActive: checked })
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {tokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        ${cost}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <Input
                            type="number"
                            className="h-8 w-20 text-right"
                            value={editCredits}
                            onChange={(e) => setEditCredits(e.target.value)}
                          />
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <span className="font-mono text-xs">{p.credits_amount}</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 text-primary"
                              title="Начислить кредиты"
                              onClick={() => setCreditsUser({ id: p.id, email: p.email, credits_amount: p.credits_amount })}
                            >
                              <Coins className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <Input
                            type="number"
                            className="h-8 w-20 text-right"
                            value={editLimit}
                            onChange={(e) => setEditLimit(e.target.value)}
                          />
                        ) : (
                          <span className="font-mono text-xs">{p.monthly_limit}</span>
                        )}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-primary"
                            title="Написать пользователю"
                            onClick={() => setMessageUser({ id: p.id, email: p.email })}
                          >
                            <Mail className="h-3.5 w-3.5" />
                          </Button>
                          {isEditing ? (
                            <>
                             <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  updateUser.mutate({
                                    userId: p.id,
                                    plan: editPlan,
                                    limit: parseInt(editLimit) || 30,
                                    credits: parseInt(editCredits) || 0,
                                  })
                                }
                              >
                                <Save className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingUser(null)}
                              >
                                ✕
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                              onClick={() => {
                                  setEditingUser(p.id);
                                  setEditPlan(p.plan);
                                  setEditLimit(String(p.monthly_limit));
                                  setEditCredits(String(p.credits_amount));
                                }}
                              >
                                Изменить
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Пользователь <strong>{p.email}</strong> и все его данные будут удалены безвозвратно.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => deleteUser.mutate(p.id)}
                                    >
                                      Удалить
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expanded stats row */}
                    {isExpanded && (
                      <TableRow key={`${p.id}-details`} className="border-border bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={13} className="py-4 px-6">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {/* Registration info */}
                            <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
                              <h4 className="text-xs font-semibold text-primary flex items-center gap-1.5">
                                <Target className="h-3.5 w-3.5" />
                                Данные регистрации
                              </h4>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Ниша:</span>
                                  <span className="font-medium">{p.onboarding_niche || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Откуда узнал:</span>
                                  <span className="font-medium">{p.referral_source || '—'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">План статей/мес:</span>
                                  <span className="font-medium">{p.planned_articles_month ?? '—'}</span>
                                </div>
                              </div>
                            </div>

                            {/* Article stats */}
                            <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
                              <h4 className="text-xs font-semibold text-primary flex items-center gap-1.5">
                                <FileText className="h-3.5 w-3.5" />
                                Статистика контента
                              </h4>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Статей создано:</span>
                                  <span className="font-medium">{articleStats?.count ?? userStat?.total_articles_created ?? 0}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Слов сгенерировано:</span>
                                  <span className="font-medium">{(userStat?.total_words_generated ?? 0).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Последняя активность:</span>
                                  <span className="font-medium">{getLastActivity(p.id)}</span>
                                </div>
                              </div>
                            </div>

                            {/* Credits & keywords */}
                            <div className="space-y-2 rounded-lg border border-border p-3 bg-card">
                              <h4 className="text-xs font-semibold text-primary flex items-center gap-1.5">
                                <CreditCard className="h-3.5 w-3.5" />
                                Кредиты и тематики
                              </h4>
                              <div className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Остаток кредитов:</span>
                                  <span className="font-medium">{p.credits_amount}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-muted-foreground">Лимит/мес:</span>
                                  <span className="font-medium">{p.monthly_limit}</span>
                                </div>
                                {topKws.length > 0 && (
                                  <div className="pt-1">
                                    <span className="text-muted-foreground">Топ ключевые слова:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {topKws.map((kw) => (
                                        <Badge key={kw.keyword} variant="secondary" className="text-[10px] px-1.5 py-0">
                                          {kw.keyword} ({kw.count})
                                        </Badge>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddCreditsDialog
        open={!!creditsUser}
        onOpenChange={(open) => !open && setCreditsUser(null)}
        user={creditsUser}
      />

      {/* Send message dialog */}
      <Dialog open={!!messageUser} onOpenChange={(open) => { if (!open) { setMessageUser(null); setMessageSubject(""); setMessageText(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              Написать пользователю
            </DialogTitle>
            <DialogDescription>
              Уведомление будет доставлено пользователю {messageUser?.email} в приложение.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Тема</Label>
              <Input
                placeholder="Тема сообщения..."
                value={messageSubject}
                onChange={(e) => setMessageSubject(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Сообщение</Label>
              <Textarea
                placeholder="Текст сообщения..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                rows={5}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setMessageUser(null); setMessageSubject(""); setMessageText(""); }}>
              Отмена
            </Button>
            <Button onClick={handleSendMessage} disabled={sendingMessage || !messageSubject.trim() || !messageText.trim()}>
              <Mail className="h-4 w-4 mr-2" />
              {sendingMessage ? "Отправка..." : "Отправить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}