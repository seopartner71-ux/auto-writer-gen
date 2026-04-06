import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Users, Save, Trash2, Coins, Clock } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
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
  const [creditsUser, setCreditsUser] = useState<{ id: string; email: string | null; credits_amount: number } | null>(null);

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
      const { data, error } = await supabase.from("user_stats").select("user_id, last_activity_at");
      if (error) throw error;
      return data as { user_id: string; last_activity_at: string | null }[];
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

  const updateUser = useMutation({
    mutationFn: async ({ userId, plan, limit }: { userId: string; plan: string; limit: number }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ plan, monthly_limit: limit })
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

      // Auto-grant 10 welcome credits when activating a new user
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

  const getUsage = (userId: string) =>
    usageData.find((u) => u.user_id === userId)?.total_tokens ?? 0;

  const getLastActivity = (userId: string) => {
    const stat = statsData.find((s) => s.user_id === userId);
    return stat?.last_activity_at ? format(new Date(stat.last_activity_at), 'dd.MM.yyyy HH:mm') : '—';
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
                <TableHead>Email</TableHead>
                <TableHead>Имя</TableHead>
                <TableHead>Регистрация</TableHead>
                <TableHead>Активность</TableHead>
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

                return (
                  <TableRow
                    key={p.id}
                    className={`border-border ${!p.is_active ? "opacity-50" : ""}`}
                  >
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
                    <TableCell>
                      {isEditing ? (
                        <Select value={editPlan} onValueChange={setEditPlan}>
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="basic">Basic</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs font-medium text-primary uppercase">
                          {p.plan}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
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
                    <TableCell className="text-right">
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
                    </TableCell>
                    <TableCell className="text-right">
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
                    <TableCell>
                      <div className="flex gap-1">
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
    </div>
  );
}
