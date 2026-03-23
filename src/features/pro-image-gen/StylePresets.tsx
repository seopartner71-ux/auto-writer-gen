import { cn } from "@/lib/utils";
import { Cpu, Camera, PenTool, Palette } from "lucide-react";

export type ImageStyle = "modern-tech" | "photorealistic" | "minimalist-vector" | "abstract-art";

interface StylePresetsProps {
  selected: ImageStyle;
  onSelect: (style: ImageStyle) => void;
}

const STYLES: { id: ImageStyle; label: string; icon: typeof Cpu; desc: string }[] = [
  { id: "modern-tech", label: "Modern Tech", icon: Cpu, desc: "3D неон, минимализм" },
  { id: "photorealistic", label: "Photo", icon: Camera, desc: "Бизнес-фото" },
  { id: "minimalist-vector", label: "Vector", icon: PenTool, desc: "Плоские иллюстрации" },
  { id: "abstract-art", label: "Abstract", icon: Palette, desc: "Метафоры, градиенты" },
];

export function StylePresets({ selected, onSelect }: StylePresetsProps) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {STYLES.map(({ id, label, icon: Icon, desc }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className={cn(
            "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center",
            selected === id
              ? "border-purple-500/50 bg-purple-500/10 text-purple-400"
              : "border-border bg-card hover:border-purple-500/30 text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
          <span className="text-[10px] font-medium leading-tight">{label}</span>
          <span className="text-[9px] opacity-60 leading-tight">{desc}</span>
        </button>
      ))}
    </div>
  );
}
