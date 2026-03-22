import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Upload, Loader2, Factory, Play, Download, CheckCircle2,
  AlertTriangle, Search, Pencil, FileText, Trash2, X
} from "lucide-react";
import { toast } from "sonner";

interface BulkJobItem {
  id: string;
  seed_keyword: string;
  status: string;
  article_id: string | null;
  error_message: string | null;
}

interface BulkJob {
  id: string;
  status: string;
  total_items: number;
  completed_items: number;
  author_profile_id: string | null;
  created_at: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
  queued: { label: "В очереди", icon: FileText, className: "bg-muted text-muted-foreground" },
  researching: { label: "Researching", icon: Search, className: "bg-info/20 text-info" },
  writing: { label: "Writing", icon: Pencil, className: "bg-primary/20 text-primary" },
  done: { label: "Done", icon: CheckCircle2, className: "bg-green-500/20 text-green-400" },
  error: { label: "Error", icon: AlertTriangle, className: "bg-destructive/20 text-destructive" },
};

export function BulkGenerationMode() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Fetch author profiles
  const { data: authorProfiles = [] } = useQuery({
    queryKey: ["author-profiles-bulk"],
    queryFn: async () => {
      const { data, error } = await supabase.from("author_profiles").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch existing bulk jobs
  const { data: bulkJobs = [] } = useQuery({
    queryKey: ["bulk-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bulk_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as BulkJob[];
    },
  });

  // Fetch items for active job
  const { data: jobItems = [] } = useQuery({
    queryKey: ["bulk-job-items", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return [];
      const { data, error } = await supabase
        .from("bulk_job_items")
        .select("*")
        .eq("bulk_job_id", activeJobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as BulkJobItem[];
    },
    enabled: !!activeJobId,
  });

  // Auto-select latest active job
  useEffect(() => {
    if (!activeJobId && bulkJobs.length > 0) {
      const active = bulkJobs.find((j) => j.status === "processing") || bulkJobs[0];
      setActiveJobId(active.id);
    }
  }, [bulkJobs, activeJobId]);

  // Realtime subscription for job items
  useEffect(() => {
    if (!activeJobId) return;

    const channel = supabase
      .channel(`bulk-items-${activeJobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_job_items", filter: `bulk_job_id=eq.${activeJobId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["bulk-job-items", activeJobId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_jobs", filter: `id=eq.${activeJobId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [activeJobId, queryClient]);

  // Parse CSV
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text
        .split(/[\n\r]+/)
        .map((l) => l.trim().replace(/^["']|["']$/g, ""))
        .filter((l) => l.length >= 2);
      
      // Remove header if it looks like one
      if (lines[0]?.toLowerCase().includes("keyword") || lines[0]?.toLowerCase().includes("запрос")) {
        lines.shift();
      }

      const unique = [...new Set(lines)].slice(0, 100);
      setKeywords(unique);
      toast.success(`Загружено ${unique.length} ключевых слов`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // Create bulk job
  const createJob = useMutation({
    mutationFn: async () => {
      if (keywords.length === 0) throw new Error("Загрузите CSV с ключевыми словами");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");

      // Create job
      const { data: job, error: jobErr } = await supabase
        .from("bulk_jobs")
        .insert({
          user_id: session.user.id,
          author_profile_id: selectedAuthorId || null,
          total_items: keywords.length,
          status: "pending",
        })
        .select("id")
        .single();
      if (jobErr) throw jobErr;

      // Create items
      const items = keywords.map((kw) => ({
        bulk_job_id: job.id,
        seed_keyword: kw,
        status: "queued",
      }));
      const { error: itemsErr } = await supabase.from("bulk_job_items").insert(items);
      if (itemsErr) throw itemsErr;

      return job.id;
    },
    onSuccess: (jobId) => {
      setActiveJobId(jobId);
      setKeywords([]);
      queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] });
      toast.success("Очередь создана! Запускаем обработку...");
      // Start processing
      startProcessing.mutate(jobId);
    },
    onError: (e) => toast.error(e.message),
  });

  // Start processing
  const startProcessing = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("bulk-generate", {
        body: { bulk_job_id: jobId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-job-items", activeJobId] });
      toast.success("Обработка завершена");
    },
    onError: (e) => toast.error(e.message),
  });

  // Delete bulk job
  const deleteJob = useMutation({
    mutationFn: async (jobId: string) => {
      // Delete items first (they have FK to job)
      const { error: itemsErr } = await supabase
        .from("bulk_job_items")
        .delete()
        .eq("bulk_job_id", jobId);
      // Items may not have delete policy — use articles cleanup approach
      // Delete the job itself
      const { error: jobErr } = await supabase
        .from("bulk_jobs")
        .delete()
        .eq("id", jobId);
      if (jobErr) throw jobErr;
    },
    onSuccess: (_, deletedJobId) => {
      if (activeJobId === deletedJobId) {
        setActiveJobId(null);
      }
      queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-job-items"] });
      toast.success("Задание удалено");
    },
    onError: (e) => toast.error(`Ошибка удаления: ${e.message}`),
  });

  const handleDownloadAll = useCallback(async () => {
    if (!activeJobId) return;

    const doneItems = jobItems.filter((i) => i.status === "done" && i.article_id);
    if (doneItems.length === 0) {
      toast.error("Нет готовых статей для скачивания");
      return;
    }

    const articleIds = doneItems.map((i) => i.article_id!);
    const { data: articles, error } = await supabase
      .from("articles")
      .select("title, content")
      .in("id", articleIds);
    if (error || !articles) {
      toast.error("Ошибка загрузки статей");
      return;
    }

    // Create a combined markdown file
    let combined = "";
    articles.forEach((a, i) => {
      combined += `# ${a.title || "Untitled"}\n\n${a.content || ""}\n\n`;
      if (i < articles.length - 1) combined += "---\n\n";
    });

    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bulk-articles-${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Скачано ${articles.length} статей`);
  }, [activeJobId, jobItems]);

  const activeJob = bulkJobs.find((j) => j.id === activeJobId);
  const progressPercent = activeJob ? Math.round((activeJob.completed_items / Math.max(activeJob.total_items, 1)) * 100) : 0;
  const isProcessing = activeJob?.status === "processing" || startProcessing.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Factory className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Factory Mode</h1>
          <p className="text-sm text-muted-foreground">
            Массовая генерация контента — загрузите CSV с ключевыми словами
          </p>
        </div>
        <Badge variant="outline" className="ml-auto text-primary border-primary">PRO</Badge>
      </div>

      {/* Upload & Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Новая пачка</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            {/* CSV Upload */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">CSV-файл (до 100 запросов)</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                {keywords.length > 0 ? `${keywords.length} запросов` : "Загрузить CSV"}
              </Button>
            </div>

            {/* Author Profile */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Профиль автора</Label>
              <Select value={selectedAuthorId} onValueChange={setSelectedAuthorId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Без профиля" />
                </SelectTrigger>
                <SelectContent>
                  {authorProfiles.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Start */}
            <Button
              disabled={keywords.length === 0 || createJob.isPending || isProcessing}
              onClick={() => createJob.mutate()}
              className="gap-2"
            >
              {createJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Запустить синтез ({keywords.length})
            </Button>
          </div>

          {/* Preview keywords */}
          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {keywords.map((kw, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1">
                  {kw}
                  <X
                    className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100"
                    onClick={() => setKeywords((prev) => prev.filter((_, j) => j !== i))}
                  />
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job History Tabs */}
      {bulkJobs.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {bulkJobs.map((job) => (
            <Button
              key={job.id}
              variant={activeJobId === job.id ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveJobId(job.id)}
              className="gap-1.5"
            >
              <span className="text-xs">
                {new Date(job.created_at).toLocaleDateString("ru")} ({job.total_items})
              </span>
              {job.status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
              {job.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
            </Button>
          ))}
        </div>
      )}

      {/* Active Job Progress */}
      {activeJob && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Прогресс: {activeJob.completed_items} / {activeJob.total_items}
              </CardTitle>
              <div className="flex items-center gap-2">
                {activeJob.status === "completed" && (
                  <Button size="sm" variant="outline" onClick={handleDownloadAll} className="gap-1.5">
                    <Download className="h-4 w-4" />
                    Скачать всё (.md)
                  </Button>
                )}
                {activeJob.status !== "processing" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => {
                      if (confirm("Удалить задание и все связанные данные?")) {
                        deleteJob.mutate(activeJob.id);
                      }
                    }}
                    disabled={deleteJob.isPending}
                  >
                    {deleteJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Удалить
                  </Button>
                )}
                {activeJob.status === "processing" && (
                  <Badge className="bg-primary/20 text-primary border-0 animate-pulse">
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    Обработка...
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progressPercent} className="h-2" />

            {/* Items Table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Ключевое слово</TableHead>
                    <TableHead className="w-32">Статус</TableHead>
                    <TableHead className="w-20">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobItems.map((item, i) => {
                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.queued;
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">
                          {item.seed_keyword}
                          {item.error_message && (
                            <p className="text-xs text-destructive mt-0.5">{item.error_message}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`gap-1 ${cfg.className}`}>
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {item.status === "done" && item.article_id && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => window.location.href = `/articles?edit=${item.article_id}`}
                              title="Редактировать"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {bulkJobs.length === 0 && keywords.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Factory className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">Загрузите CSV-файл с ключевыми словами</p>
          <p className="text-xs mt-1">Система проведёт исследование и сгенерирует статьи для каждого запроса</p>
        </div>
      )}
    </div>
  );
}
