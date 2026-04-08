import { useState, useMemo } from "react";
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
import { MOCK_PROMPTS, PROMPT_GROUPS, type GeoPrompt } from "@/shared/data/geoMockData";
import { toast } from "sonner";
import { motion } from "framer-motion";

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<GeoPrompt[]>(MOCK_PROMPTS);
  const [selectedGroup, setSelectedGroup] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");

  const filteredPrompts = useMemo(() => {
    return prompts.filter((p) => {
      if (selectedGroup !== "all" && selectedGroup !== "unassigned" && p.groupId !== selectedGroup) return false;
      if (selectedGroup === "unassigned" && p.groupId !== null) return false;
      if (search && !p.text.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [prompts, selectedGroup, search]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: prompts.length, unassigned: 0 };
    prompts.forEach((p) => {
      if (!p.groupId) counts.unassigned = (counts.unassigned || 0) + 1;
      else counts[p.groupId] = (counts[p.groupId] || 0) + 1;
    });
    return counts;
  }, [prompts]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredPrompts.length) setSelected(new Set());
    else setSelected(new Set(filteredPrompts.map((p) => p.id)));
  };

  const handleAddPrompts = () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const newPrompts: GeoPrompt[] = lines.map((text, i) => ({
      id: `p-new-${Date.now()}-${i}`,
      text,
      groupId: selectedGroup !== "all" && selectedGroup !== "unassigned" ? selectedGroup : null,
      createdAt: new Date().toISOString().split("T")[0],
    }));
    setPrompts((prev) => [...prev, ...newPrompts]);
    setBulkText("");
    setAddOpen(false);
    toast.success(`Добавлено ${lines.length} промптов`);
  };

  const handleDelete = () => {
    setPrompts((prev) => prev.filter((p) => !selected.has(p.id)));
    toast.success(`Удалено ${selected.size} промптов`);
    setSelected(new Set());
  };

  const handleMove = () => {
    if (!moveTarget) return;
    setPrompts((prev) => prev.map((p) => selected.has(p.id) ? { ...p, groupId: moveTarget === "unassigned" ? null : moveTarget } : p));
    toast.success(`Перемещено ${selected.size} промптов`);
    setSelected(new Set());
    setMoveOpen(false);
  };

  const handleCopy = () => {
    const texts = prompts.filter((p) => selected.has(p.id)).map((p) => p.text).join("\n");
    navigator.clipboard.writeText(texts);
    toast.success("Скопировано в буфер обмена");
  };

  const remainingLimits = 17750;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Промпты и Группы</h1>
          <p className="text-muted-foreground text-sm">Управление запросами для анализа AI моделей</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="gap-1.5 py-1.5 px-3">
            <CreditCard className="h-3.5 w-3.5" />
            {remainingLimits.toLocaleString()} лимитов
          </Badge>
          <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" />Добавить промпты</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
        {/* Main table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Поиск по промптам..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              {selected.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Выбрано: {selected.size}</span>
                  <Button variant="outline" size="sm" onClick={handleCopy}><Copy className="h-3.5 w-3.5" /></Button>
                  <Button variant="outline" size="sm" onClick={() => setMoveOpen(true)}><FolderInput className="h-3.5 w-3.5" /></Button>
                  <Button variant="destructive" size="sm" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPrompts.map((p) => {
                    const group = PROMPT_GROUPS.find((g) => g.id === p.groupId);
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
                        <TableCell className="text-xs text-muted-foreground">{p.createdAt}</TableCell>
                      </TableRow>
                    );
                  })}
                  {filteredPrompts.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Промпты не найдены</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Groups sidebar */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Группы</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {PROMPT_GROUPS.map((g) => (
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

      {/* Add prompts modal */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Добавить промпты</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Введите по одному промпту на строку</p>
          <Textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder="Лучшие SEO сервисы&#10;Сравни Ahrefs и SEMrush&#10;Как выбрать AI писателя" rows={8} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button onClick={handleAddPrompts} disabled={!bulkText.trim()}>Добавить {bulkText.split("\n").filter((l) => l.trim()).length} промптов</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to group modal */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Переместить в группу</DialogTitle></DialogHeader>
          <Select value={moveTarget} onValueChange={setMoveTarget}>
            <SelectTrigger><SelectValue placeholder="Выберите группу" /></SelectTrigger>
            <SelectContent>
              {PROMPT_GROUPS.filter((g) => g.id !== "all").map((g) => (
                <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Отмена</Button>
            <Button onClick={handleMove} disabled={!moveTarget}>Переместить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
