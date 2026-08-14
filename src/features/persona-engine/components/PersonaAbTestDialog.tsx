import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { evaluatePersona, testPersona } from "../services/personaApi";
import type { Persona, PersonaEvaluation } from "../types";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  personas: Persona[];
}

interface Side {
  text: string;
  evaluation: PersonaEvaluation | null;
}

export function PersonaAbTestDialog({ open, onOpenChange, personas }: Props) {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [task, setTask] = useState("Напиши вступление к статье про выбор оборудования.");
  const [running, setRunning] = useState(false);
  const [a, setA] = useState<Side | null>(null);
  const [b, setB] = useState<Side | null>(null);

  const run = async () => {
    if (!aId || !bId || aId === bId) { toast.error("Выберите две разные персоны"); return; }
    setRunning(true); setA(null); setB(null);
    try {
      const [textA, textB] = await Promise.all([testPersona(aId, task), testPersona(bId, task)]);
      setA({ text: textA, evaluation: null });
      setB({ text: textB, evaluation: null });
      const [evalA, evalB] = await Promise.all([
        evaluatePersona({ persona_id: aId, text: textA, task, persist: false }),
        evaluatePersona({ persona_id: bId, text: textB, task, persist: false }),
      ]);
      setA({ text: textA, evaluation: evalA });
      setB({ text: textB, evaluation: evalB });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Сравнение не выполнено");
    } finally {
      setRunning(false);
    }
  };

  const renderSide = (label: string, side: Side | null) => (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="rounded-lg border p-3 text-sm whitespace-pre-wrap max-h-80 overflow-auto">
        {side?.text || "-"}
      </div>
      {side?.evaluation && (
        <div className="space-y-1 text-xs">
          <div className="font-medium">Persona Match: {side.evaluation.total_score}/100</div>
          <div>Style: {side.evaluation.scores?.style_match ?? "-"}</div>
          <div>Факты: {side.evaluation.scores?.fact_compliance ?? "-"}</div>
          <div>SEO: {side.evaluation.scores?.seo_compliance ?? "-"}</div>
          <div>GEO: {side.evaluation.scores?.geo_compliance ?? "-"}</div>
        </div>
      )}
    </div>
  );

  const options = personas.filter(p => p.status !== "archived" && p.master_prompt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Сравнение персон</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Persona A</Label>
            <Select value={aId} onValueChange={setAId}>
              <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                {options.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Persona B</Label>
            <Select value={bId} onValueChange={setBId}>
              <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
              <SelectContent>
                {options.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Задача</Label>
          <Textarea rows={3} value={task} onChange={e => setTask(e.target.value)} />
        </div>
        <Button onClick={run} disabled={running} className="w-fit">
          {running && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Сравнить
        </Button>
        <div className="grid gap-4 lg:grid-cols-2">
          {renderSide("Persona A", a)}
          {renderSide("Persona B", b)}
        </div>
      </DialogContent>
    </Dialog>
  );
}