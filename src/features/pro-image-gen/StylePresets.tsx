import { cn } from "@/lib/utils";
import { Camera, Package, Coffee, LayoutGrid } from "lucide-react";

export type ImageStyle = "photorealistic" | "product" | "lifestyle" | "flatlay";

interface StylePresetsProps {
  selected: ImageStyle;
  onSelect: (style: ImageStyle) => void;
}

const PRESETS: { key: ImageStyle; label: string; sub: string; Icon: typeof Camera }[] = [
  { key: "photorealistic", label: "Photo", sub: "Бизнес-фото", Icon: Camera },
  { key: "product", label: "Product", sub: "Белый фон", Icon: Package },
  { key: "lifestyle", label: "Lifestyle", sub: "В использовании", Icon: Coffee },
  { key: "flatlay", label: "Flat lay", sub: "Сверху, плоско", Icon: LayoutGrid },
];

export function StylePresets({ selected, onSelect }: StylePresetsProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {PRESETS.map(({ key, label, sub, Icon }) => {
        const active = selected === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onSelect(key)}
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center",
              active
                ? "border-purple-500/60 bg-purple-500/10 text-purple-300"
                : "border-border bg-card/40 text-muted-foreground hover:border-purple-500/30 hover:text-purple-300",
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="text-[10px] font-medium leading-tight">{label}</span>
            <span className="text-[9px] opacity-60 leading-tight">{sub}</span>
          </button>
        );
      })}
    </div>
  );
}
