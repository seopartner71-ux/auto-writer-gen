import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Rocket, X, Globe, Layers, MapPin, Users, Tag, Palette, FileText, Search, Wallet, Settings2 } from "lucide-react";

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
    { title: `Как выбрать ${spec.topic.toLowerCase()} в ${new Date().getFullYear()} году`, author: "Мария И.", days: 14, mins: 4 },
    { title: `${spec.topic}: пошаговое руководство для новичков`, author: "Андрей К.", days: 60, mins: 6 },
    { title: `Топ-7 ошибок при работе с темой «${spec.topic}»`, author: "Ольга С.", days: 120, mins: 5 },
  ];

  // Cost breakdown — matches the cost_log pricing table.
  const siteGenCost = 0.05;     // Gemini 2.5 Flash for site profile
  const articlesCost = 0.09;    // 3 starter articles via streaming Claude/Gemini
  const falImagesCost = 9 * 0.003; // ~9 FAL images: hero, why, guarantee, about, 3 team, 1 logo + buffer
  const totalCost = siteGenCost + articlesCost + falImagesCost;

  // Tech preview placeholders — actual values are picked at deploy time.
  const wpVersion = "6.4.2";
  const wpTheme = "Astra";
  const seed = Math.random().toString(16).slice(2, 8);

  const accentColor = "#f97316";
  const fonts = "Inter + Playfair";
  const titleTag = `${spec.siteName || spec.topic} — ${spec.topic}${spec.region ? ` в ${spec.region}` : ""}`;
  const metaDesc = `Профессиональные решения по теме «${spec.topic}»${spec.region ? ` в ${spec.region}` : ""}. Опыт, гарантия, индивидуальный подход.`;

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

          {/* Design tokens */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              <Palette className="h-3.5 w-3.5" /> Дизайн
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="inline-block h-4 w-4 rounded border border-border" style={{ background: accentColor }} />
                <span className="text-muted-foreground">Акцент:</span>
                <span className="font-mono">{accentColor}</span>
              </div>
              <div><span className="text-muted-foreground">Шрифты:</span> <span className="font-medium">{fonts}</span></div>
            </div>
          </div>

          {/* Articles preview */}
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary mb-2">
              <FileText className="h-3.5 w-3.5" /> Статьи (3 шт.)
            </div>
            <ul className="space-y-2 text-xs text-foreground/80">
              {sampleArticles.map((a, i) => (
                <li key={i} className="border-l-2 border-primary/40 pl-2">
                  <div className="font-medium">{i + 1}. {a.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    Автор: {a.author} · {a.days} дн. назад · ~{a.mins} мин чтения
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-[10px] text-muted-foreground mt-2 italic">
              Заголовки и авторы выше — пример. AI сгенерирует реальные тексты под вашу нишу.
            </div>
          </div>

          {/* SEO */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
              <Search className="h-3.5 w-3.5" /> SEO
            </div>
            <div className="text-xs"><span className="text-muted-foreground">Title:</span> <span className="font-medium">{titleTag}</span></div>
            <div className="text-xs"><span className="text-muted-foreground">Description:</span> <span className="text-foreground/80">{metaDesc}</span></div>
            <div className="text-xs"><span className="text-muted-foreground">Schema:</span> <span className="font-medium">LocalBusiness, Article, BreadcrumbList</span></div>
          </div>

          {/* Cost breakdown */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              <Wallet className="h-3.5 w-3.5" /> Прогноз стоимости
            </div>
            <div className="space-y-1 text-xs">
              <CostRow label="Генерация сайта (Gemini)" value={`~$${siteGenCost.toFixed(2)}`} />
              <CostRow label="3 статьи (Claude/Gemini)" value={`~$${articlesCost.toFixed(2)}`} />
              <CostRow label="9 фото FAL AI" value={`~$${falImagesCost.toFixed(3)}`} />
              <CostRow label="Cloudflare Pages" value="$0" />
              <div className="border-t border-border/60 my-1.5" />
              <CostRow label="ИТОГО" value={`~$${totalCost.toFixed(2)}`} bold />
              <CostRow label="Время деплоя" value="2-4 мин" />
            </div>
          </div>

          {/* Tech */}
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
              <Settings2 className="h-3.5 w-3.5" /> Технические детали
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground">WP:</span> <span className="font-medium">{wpVersion}</span></div>
              <div><span className="text-muted-foreground">Тема:</span> <span className="font-medium">{wpTheme}</span></div>
              <div><span className="text-muted-foreground">Seed:</span> <span className="font-mono">{seed}</span></div>
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

function CostRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${bold ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={bold ? "font-mono text-base" : "font-mono"}>{value}</span>
    </div>
  );
}