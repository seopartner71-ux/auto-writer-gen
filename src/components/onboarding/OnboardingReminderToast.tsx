import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  show: boolean;
  onShown: () => void;
}

export function OnboardingReminderToast({ show, onShown }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();

  useEffect(() => {
    if (!show) return;
    onShown();
    toast(t("onboarding.reminderTitle"), {
      description: t("onboarding.reminderDesc"),
      action: {
        label: "→",
        onClick: () => navigate("/keywords"),
      },
      duration: 10000,
    });
  }, [show]);

  return null;
}
