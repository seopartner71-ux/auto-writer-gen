import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, X, Globe, Layers, MapPin, Users, Tag } from "lucide-react";

export interface SitePreviewSpec {
  topic: string;
  siteName: string;
  region: string;
  services: string;
  audience: string;
  businessType: string;
  homepageStyle: "landing" | "magazine" | "news";
  templateName?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  spec: SitePreviewSpec | null;
  estimatedCostUsd?: number;
}

const HOMEPAGE_LABELS: Record<string, string> = {
  landing: "Лендинг (с формой заявки)",
  magazine: "Журнал (контент-первый)",
  news: "Новостной портал",
};

const BUSINESS_LABELS: Record<string, string> = {
  "продажа": "Продажа товаров",
  "услуги": "Услуги",
  "информационный": "Инфо-сайт / блог",
  "производство": "Производство",
};

export function SitePreviewDialog({ open, onClose, onConfirm, spec, estimatedCostUsd = 0.05 }: Props) {
  if (!spec) return null;

  const services = spec.services.split(",").map((s) => s.trim()).filter(Boolean);
  const sampleArticles = [
    `Как выбрать ${spec.topic.toLowerCase()} в ${new Date().getFullYear()} году`,
    `${spec.topic}: пошаговое руководство для новичков`,
    `Топ-7 ошибок при работе с темой «${spec.topic}»`,
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Предпросмотр сайта
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Название</div>
            <div className="text-xl font-bold text-foreground">{spec.siteName || "(будет сгенерировано AI)"}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PreviewField icon={<Tag className="h-3.5 w-3.5" />} label="Тематика" value={spec.topic} />
            <PreviewField icon={<MapPin className="h-3.5 w-3.5" />} label="Регион" value={spec.region || "—"} />
            <PreviewField icon={<Layers className="h-3.5 w-3.5" />} label="Шаблон" value={spec.templateName || "Случайный"} />
            <PreviewField icon={<Users className="h-3.5 w-3.5" />} label="Аудитория" value={spec.audience || "—"} />
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Главная страница</span>
              <Badge variant="outline" className="text-[10px]">{HOMEPAGE_LABELS[spec.homepageStyle]}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Тип бизнеса</span>
              <Badge variant="outline" className="text-[10px]">{BUSINESS_LABELS[spec.businessType] || spec.businessType}</Badge>
            </div>
          </div>

          {services.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Услуги/товары</div>
              <div className="flex flex-wrap gap-1.5">
                {services.map((s, i) => (
                  <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="text-[11px] uppercase tracking-wide text-primary mb-2">Будут сгенерированы 3 стартовые статьи</div>
            <ul className="space-y-1 text-xs text-foreground/80">
              {sampleArticles.map((title, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-primary/60">{i + 1}.</span>
                  <span>{title}</span>
                </li>
              ))}
            </ul>
            <div className="text-[10px] text-muted-foreground mt-2 italic">
              Заголовки выше — пример. AI сгенерирует уникальные тексты под вашу нишу.
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Ориентир. стоимость</div>
              <div className="text-base font-semibold text-foreground">~${estimatedCostUsd.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-muted-foreground">Ориентир. время</div>
              <div className="text-base font-semibold text-foreground">2-4 мин</div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            <X className="h-4 w-4 mr-1" /> Изменить
          </Button>
          <Button onClick={onConfirm} className="gap-2">
            <Rocket className="h-4 w-4" /> Всё хорошо — деплоить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewField({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
        {icon} {label}
      </div>
      <div className="text-sm text-foreground truncate">{value}</div>
    </div>
  );
}