import { cn } from "@/lib/utils";
import { Camera } from "lucide-react";

export type ImageStyle = "photorealistic";

interface StylePresetsProps {
  selected: ImageStyle;
  onSelect: (style: ImageStyle) => void;
}

export function StylePresets({ selected, onSelect }: StylePresetsProps) {
  return (
    <div className="grid grid-cols-1 gap-1.5">
      <button
        onClick={() => onSelect("photorealistic")}
        className={cn(
          "flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-center",
          "border-purple-500/50 bg-purple-500/10 text-purple-400"
        )}
      >
        <Camera className="h-4 w-4" />
        <span className="text-[10px] font-medium leading-tight">Photo</span>
        <span className="text-[9px] opacity-60 leading-tight">Реалистичное бизнес-фото</span>
      </button>
    </div>
  );
}
