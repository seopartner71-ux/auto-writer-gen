import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Loader2, Save, Building2, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  PROFILE_FIELDS, PROFILE_GROUPS, coverageOf, fieldValue, requirementStatus, type ProfileValues,
} from "./profileSpec";

export function CompanyProfilePanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<Record<string, unknown>>({});
  const [values, setValues] = useState<ProfileValues>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("projects")
      .select("id, site_about, site_positioning, company_name, company_phone, company_email, company_address, work_hours, region, founding_year, juridical_inn, clients_count_text, commercial_profile")
      .eq("id", projectId).maybeSingle();
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setProject((data || {}) as Record<string, unknown>);
    const raw = (data?.commercial_profile || {}) as ProfileValues;
    const seeded: ProfileValues = { ...raw };
    for (const f of PROFILE_FIELDS) {
      if (seeded[f.key] === undefined || seeded[f.key] === "") {
        const legacy = f.legacy ? String((data as Record<string, unknown>)?.[f.legacy] ?? "").trim() : "";
        if (legacy) seeded[f.key] = f.type === "list" ? legacy.split(/[,;]\s*/) : legacy;
      }
    }
    setValues(seeded);
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const coverage = useMemo(() => coverageOf(values, project), [values, project]);
  const req = useMemo(() => requirementStatus(values, project), [values, project]);

  const save = async () => {
    setSaving(true);
    const clean: ProfileValues = {};
    for (const f of PROFILE_FIELDS) {
      const v = values[f.key];
      if (f.type === "list") {
        const arr = (Array.isArray(v) ? v : String(v ?? "").split(/[,;]\s*/)).map((x) => String(x).trim()).filter(Boolean);
        if (arr.length) clean[f.key] = arr;
      } else {
        const t = String(v ?? "").trim();
        if (t) clean[f.key] = t;
      }
    }
    const { error } = await supabase.from("projects").update({ commercial_profile: clean }).eq("id", projectId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(ru ? "Профиль сохранен" : "Profile saved");
    load();
  };

  if (loading) return <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Building2 className="h-4 w-4" />
            {ru ? "Коммерческий профиль проекта" : "Commercial project profile"}
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={coverage.score >= 70 ? "default" : coverage.score >= 30 ? "secondary" : "destructive"}>
              {coverage.score}%
            </Badge>
            <span className="text-xs text-muted-foreground">
              {coverage.filled}/{coverage.total} {ru ? "полей" : "fields"}
            </span>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              <span className="ml-1">{ru ? "Сохранить" : "Save"}</span>
            </Button>
          </div>
        </div>
        <Progress value={coverage.score} className="h-1.5" />
        <p className="text-xs text-muted-foreground">
          {ru
            ? "Это единственный источник фактов о компании. Генератор контента не выдумывает то, чего здесь нет."
            : "This is the only source of company facts. The content engine never invents what is not here."}
        </p>
      </div>

      <div className={`rounded-lg border p-4 space-y-2 ${req.ready ? "" : "border-destructive/50"}`}>
        <div className="flex items-center gap-2 text-sm font-medium">
          {req.ready
            ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            : <AlertTriangle className="h-4 w-4 text-destructive" />}
          {ru
            ? `Обязательные поля: ${req.requiredFilled}/${req.requiredTotal}`
            : `Required fields: ${req.requiredFilled}/${req.requiredTotal}`}
        </div>
        <p className="text-xs text-muted-foreground">
          {ru
            ? "Без обязательных полей коммерческие страницы получают статус FAIL в слое качества (missing_required_factor)."
            : "Without required fields commercial pages get FAIL in the quality layer (missing_required_factor)."}
        </p>
        {req.missingRequired.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {req.missingRequired.map((f) => (
              <Badge key={f.key} variant="destructive" className="text-[11px] font-normal">{f.label}</Badge>
            ))}
          </div>
        )}
        {req.missingImportant.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {ru ? "Желательно заполнить:" : "Recommended to fill:"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {req.missingImportant.map((f) => (
                <Badge key={f.key} variant="secondary" className="text-[11px] font-normal">{f.label}</Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {PROFILE_GROUPS.map((group) => {
        const fields = PROFILE_FIELDS.filter((f) => f.group === group);
        if (!fields.length) return null;
        return (
          <div key={group} className="rounded-lg border p-4 space-y-3">
            <div className="text-sm font-medium">{group}</div>
            <div className="grid gap-3 md:grid-cols-2">
              {fields.map((f) => {
                const v = values[f.key];
                const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                const inherited = !text && fieldValue(f, values, project);
                return (
                  <div key={f.key} className={f.type === "textarea" ? "md:col-span-2 space-y-1" : "space-y-1"}>
                    <label className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span className={f.req === "required" ? "text-foreground font-medium" : ""}>{f.label}</span>
                      {f.req === "required" && <span className="text-destructive" title={ru ? "Обязательное поле" : "Required"}>*</span>}
                      {f.req === "required" && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal border-destructive/40 text-destructive">
                          {ru ? "обязательно" : "required"}
                        </Badge>
                      )}
                      {f.req === "important" && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal text-muted-foreground">
                          {ru ? "желательно" : "recommended"}
                        </Badge>
                      )}
                      {!text && !inherited && f.req !== "required" && <span className="text-muted-foreground">•</span>}
                    </label>
                    {f.type === "textarea" ? (
                      <Textarea
                        rows={2}
                        value={text}
                        placeholder={inherited || f.hint || ""}
                        className={f.req === "required" && !text && !inherited ? "border-destructive/50" : ""}
                        onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        value={text}
                        placeholder={inherited || f.hint || (f.type === "list" ? (ru ? "через запятую" : "comma separated") : "")}
                        className={f.req === "required" && !text && !inherited ? "border-destructive/50" : ""}
                        onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                      />
                    )}
                    {f.hint && f.req === "required" && (
                      <p className="text-[10px] text-muted-foreground">{f.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
