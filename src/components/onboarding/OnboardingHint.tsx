import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";

interface OnboardingHintProps {
  message: string;
  actionLabel?: string;
  actionPath?: string;
}

export function OnboardingHint({ message, actionLabel, actionPath }: OnboardingHintProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/20 text-sm">
      <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-foreground">{message}</p>
        {actionLabel && actionPath && (
          <Button
            variant="link"
            size="sm"
            className="px-0 mt-1 text-primary"
            onClick={() => navigate(actionPath)}
          >
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
