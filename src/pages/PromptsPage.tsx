import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, FolderInput, Search, Copy, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function PromptsPage({ projectId }: { projectId?: string }) {
  const queryClient = useQueryClient();
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  // Fetch groups
  const { data: groups = [] } = useQuery({
    queryKey: ["radar-prompt-groups", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_prompt_groups" as any).select("*").eq("project_id", projectId).order("sort_order");
      return (data || []) as any[];
    },
    enabled: !!projectId,
  });

  // Fetch prompts
  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ["radar-prompts", projectId],
    queryFn: async () => {
      if (!projectId) return [];
      const { data } = await supabase.from("radar_prompts" as any).select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!projectId,
  });

  // Fetch credits
  const { data: profile } = useQuery({
    queryKey: ["user-profile-credits"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("profiles").select("credits_amount").eq("id", user.id).single();
      return data;
    },
  });

  const filteredPrompts = useMemo(() => {
    return prompts.filter((p: any) => {
      if (selectedGroup !== "all" && selectedGroup !== "unassigned" && p.group_id !== selectedGroup) return false;
      if (selectedGroup === "unassigned" && p.group_id !== null) return false;
      if (search && !p.text.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [prompts, selectedGroup, search]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: prompts.length, unassigned: 0 };
    prompts.forEach((p: any) => {
      if (!p.group_id) counts.unassigned = (counts.unassigned || 0) + 1;
      else counts[p.group_id] = (counts[p.group_id] || 0) + 1;
    });
    return counts;
  }, [prompts]);

  const toggleSelect = (id: string) => {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const toggleAll = () => {
    if (selected.size === filteredPrompts.length) setSelected(new Set());
    else setSelected(new Set(filteredPrompts.map((p: any) => p.id)));
  };

  // Add prompts mutation
  const addPrompts = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !projectId) throw new Error("Not authenticated");
      const lines = bulkText.split("\n").map(l => l.trim()).filter(Boolean);
      if (!lines.length) throw new Error("No prompts");
      const groupId = selectedGroup !== "all" && selectedGroup !== "unassigned" ? selectedGroup : null;
      const rows = lines.map(text => ({
        user_id: user.id,
        project_id: projectId,
        text,
        group_id: groupId,
      }));
      const { error } = await supabase.from("radar_prompts" as any).insert(rows);
      if (error) throw error;
      return lines.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["radar-prompts"] });
      setBulkText("");
      setAddOpen(false);
      toast.success(`Добавлено ${count} промптов`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Delete prompts mutation (bulk)
  const deletePrompts = useMutation({
    mutationFn: async () => {
      const ids = Array.from(selected);
      const { error } = await supabase.from("radar_prompts" as any).delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-prompts"] });
      toast.success(`Удалено ${selected.size} промптов`);
      setSelected(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Delete single prompt
  const deleteSingle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("radar_prompts" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-prompts"] });
      toast.success("Промпт удалён");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Move prompts mutation
  const movePrompts = useMutation({
    mutationFn: async () => {
      if (!moveTarget) return;
      const ids = Array.from(selected);
      const groupId = moveTarget === "unassigned" ? null : moveTarget;
      const { error } = await supabase.from("radar_prompts" as any).update({ group_id: groupId }).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["radar-prompts"] });
      toast.success(`Перемещено ${selected.size} промптов`);
      setSelected(new Set());
      setMoveOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleCopy = () => {
    const texts = prompts.filter((p: any) => selected.has(p.id)).map((p: any) => p.text).join("\n");
    navigator.clipboard.writeText(texts);
    toast.success("Скопировано в буфер обмена");
  };

  if (!projectId) {
    return <div className="text-center py-12 text-muted-foreground">Выберите проект для управления промптами</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Промпты и Группы</h2>
          <p className="text-muted-foreground text-sm">Управление запросами для анализа AI моделей</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3">
            <CreditCard className="h-3.5 w-3.5" />
            {profile?.credits_amount?.toLocaleString() || 0} кредитов
          </Badge>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Добавить промпты</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Поиск по промптам..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Выбрано: {selected.size}</span>
                  <Button variant="outline" size="sm" onClick={handleCopy}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}><FolderInput className="h-3.5 w-3.5" /></Button>
                  <Button variant="destructive" size="sm" onClick={() => deletePrompts.mutate()}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={selected.size === filteredPrompts.length && filteredPrompts.length > 0} onCheckedChange={toggleAll} />
                    </TableHead>
                     <TableHead>Промпт</TableHead>
                     <TableHead className="w-[150px]">Группа</TableHead>
                     <TableHead className="w-[100px]">Дата</TableHead>
                     <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrompts.map((p: any) => {
                    const group = groups.find((g: any) => g.id === p.group_id);
                    return (
                      <TableRow key={p.id}>
                        <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} /></TableCell>
                        <TableCell className="font-medium text-sm">{p.text}</TableCell>
                        <TableCell>
                          {group ? (
                            <Badge variant="secondary" className="cursor-pointer text-xs" onClick={() => setSelectedGroup(group.id)}>
                              {group.name}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(p.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredPrompts.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      {isLoading ? "Загрузка..." : "Промпты не найдены"}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Группы</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {[
              { id: "all", name: "Все" },
              { id: "unassigned", name: "Без группы" },
              ...groups,
            ].map((g: any) => (
              <motion.button
                key={g.id}
                whileTap={{ scale: 0.98 }}
                onClick={() => setSelectedGroup(g.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedGroup === g.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-foreground"
                }`}
              >
                <span>{g.name}</span>
                <Badge variant="secondary" className="text-xs">{groupCounts[g.id] || 0}</Badge>
              </motion.button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить промпты</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Введите по одному промпту на строку</p>
          <Textarea value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder="Лучшие SEO сервисы&#10;Сравни Ahrefs и SEMrush&#10;Как выбрать AI писателя" rows={8} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={() => addPrompts.mutate()} disabled={!bulkText.trim() || addPrompts.isPending}>
              Добавить {bulkText.split("\n").filter(l => l.trim()).length} промптов
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Переместить в группу</DialogTitle></DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger><SelectValue placeholder="Выберите группу" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Без группы</SelectItem>
              {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Отмена</Button>
            <Button onClick={() => movePrompts.mutate()} disabled={!moveTarget || movePrompts.isPending}>Переместить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
