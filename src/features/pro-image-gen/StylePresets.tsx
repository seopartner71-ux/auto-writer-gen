import { cn } from "@/lib/utils";
import { Camera, Package, Coffee, LayoutGrid } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export type ImageStyle = "photorealistic" | "product" | "lifestyle" | "flatlay";

interface StylePresetsProps {
  selected: ImageStyle;
  onSelect: (style: ImageStyle) => void;
}

const PRESETS: { key: ImageStyle; label: string; subKey: string; Icon: typeof Camera }[] = [
  { key: "photorealistic", label: "Photo", subKey: "stylePresets.photoSub", Icon: Camera },
  { key: "product", label: "Product", subKey: "stylePresets.productSub", Icon: Package },
  { key: "lifestyle", label: "Lifestyle", subKey: "stylePresets.lifestyleSub", Icon: Coffee },
  { key: "flatlay", label: "Flat lay", subKey: "stylePresets.flatlaySub", Icon: LayoutGrid },
];

export function StylePresets({ selected, onSelect }: StylePresetsProps) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {PRESETS.map(({ key, label, subKey, Icon }) => {
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
            <span className="text-[9px] opacity-60 leading-tight">{t(subKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
