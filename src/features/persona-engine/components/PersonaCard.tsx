import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, FlaskConical, Pencil, Copy, GitBranch, Archive, PenLine, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { ensureAuthorProfile } from "../services/personaApi";
import type { Persona } from "../types";

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  active: "Активна",
  testing: "Тестирование",
  archived: "Архив",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  testing: "secondary",
  draft: "outline",
  archived: "outline",
};

function healthColor(score: number): string {
  if (score < 30) return "text-destructive";
  if (score < 70) return "text-yellow-500";
  return "text-green-500";
}

interface Props {
  persona: Persona;
  onOpen: () => void;
  onEdit: () => void;
  onTest: () => void;
  onDuplicate: () => void;
  onNewVersion: () => void;
  onArchive: () => void;
}

export function PersonaCard({ persona, onOpen, onEdit, onTest, onDuplicate, onNewVersion, onArchive }: Props) {
  const navigate = useNavigate();
  const [linking, setLinking] = useState(false);

  const handleWrite = async () => {
    setLinking(true);
    try {
      const authorId = await ensureAuthorProfile(persona);
      navigate(`/articles?author=${authorId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось подключить автора");
    } finally {
      setLinking(false);
    }
  };
  const dna = persona.persona_dna || {};
  const topic = (dna.expertise as Record<string, unknown>)?.knowledge_domains as string[] | undefined;
  const voice = dna.voice || {};
  const voiceSummary = typeof voice.formality === "number"
    ? `формальность ${voice.formality}, авторитетность ${voice.authority ?? "-"}`
    : "не задан";

  return (
    <Card className="flex flex-col">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <button onClick={onOpen} className="text-left">
              <h3 className="font-medium truncate">{persona.name}</h3>
            </button>
            <p className="text-xs text-muted-foreground truncate">{persona.role || "Роль не указана"}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}>Открыть</DropdownMenuItem>
              <DropdownMenuItem onClick={onEdit}><Pencil className="h-4 w-4 mr-2" />Редактировать</DropdownMenuItem>
              <DropdownMenuItem onClick={onTest}><FlaskConical className="h-4 w-4 mr-2" />Тестировать</DropdownMenuItem>
              <DropdownMenuItem onClick={onDuplicate}><Copy className="h-4 w-4 mr-2" />Дублировать</DropdownMenuItem>
              <DropdownMenuItem onClick={onNewVersion}><GitBranch className="h-4 w-4 mr-2" />Создать версию</DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}><Archive className="h-4 w-4 mr-2" />Архивировать</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
          <div>
            <div className="text-muted-foreground">Сайт</div>
            <div className="truncate">{persona.site_url || "-"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Тематика</div>
            <div className="truncate">{topic?.slice(0, 2).join(", ") || "-"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Голос</div>
            <div className="truncate">{voiceSummary}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Экспертиза</div>
            <div className="truncate">{String((dna.expertise as Record<string, unknown>)?.depth || "-")}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Проектов</div>
            <div>{persona.project_ids?.length || 0}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Статей</div>
            <div>{persona.articles_generated}</div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[persona.status] || "outline"}>{STATUS_LABEL[persona.status]}</Badge>
            <span className="text-xs text-muted-foreground">v{persona.version}</span>
          </div>
          <span className={`text-xs font-medium ${healthColor(persona.health_score)}`}>
            Health {persona.health_score}
          </span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Обновлено {new Date(persona.updated_at).toLocaleDateString("ru-RU")}
        </div>

        <Button size="sm" className="w-full" disabled={linking} onClick={handleWrite}>
          {linking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <PenLine className="h-4 w-4 mr-2" />}
          Писать статью
        </Button>
      </CardContent>
    </Card>
  );
}