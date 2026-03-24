import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Upload, Loader2, Factory, Play, Download, CheckCircle2,
  AlertTriangle, Search, Pencil, FileText, Trash2, X, Plus
} from "lucide-react";
import { toast } from "sonner";

interface BulkJobItem { id: string; seed_keyword: string; status: string; article_id: string | null; error_message: string | null; }
interface BulkJob { id: string; status: string; total_items: number; completed_items: number; author_profile_id: string | null; created_at: string; }

export function BulkGenerationMode() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [manualInput, setManualInput] = useState("");
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; className: string }> = {
    queued: { label: t("bulk.inQueue"), icon: FileText, className: "bg-muted text-muted-foreground" },
    researching: { label: "Researching", icon: Search, className: "bg-info/20 text-info" },
    writing: { label: "Writing", icon: Pencil, className: "bg-primary/20 text-primary" },
    done: { label: "Done", icon: CheckCircle2, className: "bg-purple-500/20 text-purple-400" },
    error: { label: "Error", icon: AlertTriangle, className: "bg-destructive/20 text-destructive" },
  };

  const { data: authorProfiles = [] } = useQuery({
    queryKey: ["author-profiles-bulk"],
    queryFn: async () => { const { data, error } = await supabase.from("author_profiles").select("*").order("name"); if (error) throw error; return data; },
  });

  const { data: bulkJobs = [] } = useQuery({
    queryKey: ["bulk-jobs"],
    queryFn: async () => { const { data, error } = await supabase.from("bulk_jobs").select("*").order("created_at", { ascending: false }).limit(10); if (error) throw error; return data as BulkJob[]; },
  });

  const { data: jobItems = [] } = useQuery({
    queryKey: ["bulk-job-items", activeJobId],
    queryFn: async () => { if (!activeJobId) return []; const { data, error } = await supabase.from("bulk_job_items").select("*").eq("bulk_job_id", activeJobId).order("created_at", { ascending: true }); if (error) throw error; return data as BulkJobItem[]; },
    enabled: !!activeJobId,
  });

  useEffect(() => { if (!activeJobId && bulkJobs.length > 0) { const active = bulkJobs.find((j) => j.status === "processing") || bulkJobs[0]; setActiveJobId(active.id); } }, [bulkJobs, activeJobId]);

  useEffect(() => {
    if (!activeJobId) return;
    const channel = supabase.channel(`bulk-items-${activeJobId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_job_items", filter: `bulk_job_id=eq.${activeJobId}` }, () => queryClient.invalidateQueries({ queryKey: ["bulk-job-items", activeJobId] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "bulk_jobs", filter: `id=eq.${activeJobId}` }, () => queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] }))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeJobId, queryClient]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split(/[\n\r]+/).map((l) => l.trim().replace(/^["']|["']$/g, "")).filter((l) => l.length >= 2);
      if (lines[0]?.toLowerCase().includes("keyword") || lines[0]?.toLowerCase().includes("запрос")) lines.shift();
      const unique = [...new Set(lines)].slice(0, 100);
      setKeywords(unique);
      toast.success(`${t("bulk.loaded")} ${unique.length} ${t("bulk.keywords")}`);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [t]);

  const createJob = useMutation({
    mutationFn: async () => {
      if (keywords.length === 0) throw new Error(t("bulk.uploadError"));
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("Not authenticated");
      const { data: job, error: jobErr } = await supabase.from("bulk_jobs").insert({ user_id: session.user.id, author_profile_id: selectedAuthorId || null, total_items: keywords.length, status: "pending" }).select("id").single();
      if (jobErr) throw jobErr;
      const items = keywords.map((kw) => ({ bulk_job_id: job.id, seed_keyword: kw, status: "queued" }));
      const { error: itemsErr } = await supabase.from("bulk_job_items").insert(items);
      if (itemsErr) throw itemsErr;
      return job.id;
    },
    onSuccess: (jobId) => { setActiveJobId(jobId); setKeywords([]); queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] }); toast.success(t("bulk.queueCreated")); startProcessing.mutate(jobId); },
    onError: (e) => toast.error(e.message),
  });

  const startProcessing = useMutation({
    mutationFn: async (jobId: string) => { const { data, error } = await supabase.functions.invoke("bulk-generate", { body: { bulk_job_id: jobId } }); if (error) throw error; if (data?.error) throw new Error(data.error); return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] }); queryClient.invalidateQueries({ queryKey: ["bulk-job-items", activeJobId] }); toast.success(t("bulk.processingComplete")); },
    onError: (e) => toast.error(e.message),
  });

  const deleteJob = useMutation({
    mutationFn: async (jobId: string) => { await supabase.from("bulk_job_items").delete().eq("bulk_job_id", jobId); const { error: jobErr } = await supabase.from("bulk_jobs").delete().eq("id", jobId); if (jobErr) throw jobErr; },
    onSuccess: (_, deletedJobId) => { if (activeJobId === deletedJobId) setActiveJobId(null); queryClient.invalidateQueries({ queryKey: ["bulk-jobs"] }); queryClient.invalidateQueries({ queryKey: ["bulk-job-items"] }); toast.success(t("bulk.jobDeleted")); },
    onError: (e) => toast.error(`${t("bulk.deleteError")}: ${e.message}`),
  });

  const handleDownloadAll = useCallback(async () => {
    if (!activeJobId) return;
    const doneItems = jobItems.filter((i) => i.status === "done" && i.article_id);
    if (doneItems.length === 0) { toast.error(t("bulk.noArticlesReady")); return; }
    const articleIds = doneItems.map((i) => i.article_id!);
    const { data: articles, error } = await supabase.from("articles").select("title, content").in("id", articleIds);
    if (error || !articles) { toast.error(t("bulk.noArticlesReady")); return; }
    let combined = "";
    articles.forEach((a, i) => { combined += `# ${a.title || "Untitled"}\n\n${a.content || ""}\n\n`; if (i < articles.length - 1) combined += "---\n\n"; });
    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `bulk-articles-${new Date().toISOString().slice(0, 10)}.md`;
    link.click(); URL.revokeObjectURL(url);
    toast.success(`${t("bulk.downloaded")} ${articles.length} ${t("bulk.articlesCount")}`);
  }, [activeJobId, jobItems, t]);

  const activeJob = bulkJobs.find((j) => j.id === activeJobId);
  const progressPercent = activeJob ? Math.round((activeJob.completed_items / Math.max(activeJob.total_items, 1)) * 100) : 0;
  const isProcessing = activeJob?.status === "processing" || startProcessing.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Factory className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Factory Mode</h1>
          <p className="text-sm text-muted-foreground">{t("bulk.subtitle")}</p>
        </div>
        <Badge variant="outline" className="ml-auto text-primary border-primary">PRO</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">{t("bulk.newBatch")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("bulk.csvFile")}</Label>
              <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="h-4 w-4" />{keywords.length > 0 ? `${keywords.length} ${t("bulk.queries")}` : t("bulk.uploadCsv")}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">{t("bulk.authorProfile")}</Label>
              <Select value={selectedAuthorId} onValueChange={setSelectedAuthorId}>
                <SelectTrigger className="w-[200px]"><SelectValue placeholder={t("bulk.noProfile")} /></SelectTrigger>
                <SelectContent>{authorProfiles.map((p: any) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}</SelectContent>
              </Select>
            </div>
            <Button disabled={keywords.length === 0 || createJob.isPending || isProcessing} onClick={() => createJob.mutate()} className="gap-2">
              {createJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {t("bulk.startSynthesis")} ({keywords.length})
            </Button>
          </div>

          {/* Manual keyword input */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Или введите запросы вручную (каждый с новой строки)</Label>
            <div className="flex gap-2">
              <Textarea
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={"как выбрать ноутбук\nлучшие смартфоны 2026\nсравнение iphone и samsung"}
                className="text-sm min-h-[80px] resize-y"
                rows={3}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-end gap-1.5"
                disabled={!manualInput.trim()}
                onClick={() => {
                  const lines = manualInput
                    .split(/[\n\r]+/)
                    .map((l) => l.trim())
                    .filter((l) => l.length >= 2);
                  if (lines.length === 0) return;
                  const merged = [...new Set([...keywords, ...lines])].slice(0, 100);
                  setKeywords(merged);
                  setManualInput("");
                  toast.success(`Добавлено ${lines.length} запросов`);
                }}
              >
                <Plus className="h-4 w-4" />
                Добавить
              </Button>
            </div>
          </div>

          {keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {keywords.map((kw, i) => (
                <Badge key={i} variant="secondary" className="text-xs gap-1">{kw}<X className="h-3 w-3 cursor-pointer opacity-60 hover:opacity-100" onClick={() => setKeywords((prev) => prev.filter((_, j) => j !== i))} /></Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {bulkJobs.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {bulkJobs.map((job) => (
            <Button key={job.id} variant={activeJobId === job.id ? "default" : "outline"} size="sm" onClick={() => setActiveJobId(job.id)} className="gap-1.5">
              <span className="text-xs">{new Date(job.created_at).toLocaleDateString()} ({job.total_items})</span>
              {job.status === "processing" && <Loader2 className="h-3 w-3 animate-spin" />}
              {job.status === "completed" && <CheckCircle2 className="h-3 w-3" />}
            </Button>
          ))}
        </div>
      )}

      {activeJob && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">{t("bulk.progress")}: {activeJob.completed_items} / {activeJob.total_items}</CardTitle>
              <div className="flex items-center gap-2">
                {activeJob.status === "completed" && <Button size="sm" variant="outline" onClick={handleDownloadAll} className="gap-1.5"><Download className="h-4 w-4" />{t("bulk.downloadAll")}</Button>}
                {activeJob.status !== "processing" && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => { if (confirm(t("bulk.deleteConfirm"))) deleteJob.mutate(activeJob.id); }} disabled={deleteJob.isPending}>
                    {deleteJob.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{t("bulk.delete")}
                  </Button>
                )}
                {activeJob.status === "processing" && <Badge className="bg-primary/20 text-primary border-0 animate-pulse"><Loader2 className="h-3 w-3 mr-1.5 animate-spin" />{t("bulk.processing")}</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progressPercent} className="h-2" />
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>{t("bulk.keyword")}</TableHead>
                    <TableHead className="w-32">{t("bulk.status")}</TableHead>
                    <TableHead className="w-20">{t("bulk.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobItems.map((item, i) => {
                    const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.queued;
                    const Icon = cfg.icon;
                    return (
                      <TableRow key={item.id}>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="font-medium text-sm">{item.seed_keyword}{item.error_message && <p className="text-xs text-destructive mt-0.5">{item.error_message}</p>}</TableCell>
                        <TableCell><Badge variant="secondary" className={`gap-1 ${cfg.className}`}><Icon className="h-3 w-3" />{cfg.label}</Badge></TableCell>
                        <TableCell>{item.status === "done" && item.article_id && <Button size="sm" variant="ghost" onClick={() => window.location.href = `/articles?edit=${item.article_id}`}><Pencil className="h-3.5 w-3.5" /></Button>}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {bulkJobs.length === 0 && keywords.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Factory className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">{t("bulk.uploadCsv")}</p>
        </div>
      )}
    </div>
  );
}
