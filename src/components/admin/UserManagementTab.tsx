import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Users, Save } from "lucide-react";
import { useState } from "react";

interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: string;
  monthly_limit: number;
  created_at: string;
}

interface UserUsage {
  user_id: string;
  total_tokens: number;
}

// Approx cost per 1K tokens
const COST_PER_1K = 0.002;

export function UserManagementTab() {
  const queryClient = useQueryClient();
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPlan, setEditPlan] = useState("");
  const [editLimit, setEditLimit] = useState("");

  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*");
      if (error) throw error;
      return data as UserProfile[];
    },
  });

  const { data: usageData = [] } = useQuery({
    queryKey: ["admin-usage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("usage_logs")
        .select("user_id, tokens_used");
      if (error) throw error;

      // Aggregate tokens per user
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

  const getUsage = (userId: string) => {
    return usageData.find((u) => u.user_id === userId)?.total_tokens ?? 0;
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
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Email</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Тариф</TableHead>
                <TableHead className="text-right">Токены</TableHead>
                <TableHead className="text-right">≈ $</TableHead>
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
                  <TableRow key={p.id} className="border-border">
                    <TableCell className="font-mono text-xs">{p.email}</TableCell>
                    <TableCell>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        user
                      </span>
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Select value={editPlan} onValueChange={setEditPlan}>
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
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
                    <TableCell className="text-right font-mono text-xs">
                      {tokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ${cost}
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
                      {isEditing ? (
                        <div className="flex gap-1">
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
                        </div>
                      ) : (
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
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
