import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/shared/hooks/useAuth";

const STORAGE_KEY = "tariff_update_seen_v2";

/**
 * One-time toast for existing users about the v2 tariff update.
 * Shows once on app entry; dismiss state stored in localStorage.
 */
export function useTariffUpdateNotifier() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => {
      toast.success("🎁 Ваш тариф стал лучше!", {
        description: "Мы добавили новые функции без изменения цены.",
        duration: 10000,
        action: {
          label: "Посмотреть что нового",
          onClick: () => {
            localStorage.setItem(STORAGE_KEY, "1");
            navigate("/changelog");
          },
        },
        onDismiss: () => localStorage.setItem(STORAGE_KEY, "1"),
        onAutoClose: () => localStorage.setItem(STORAGE_KEY, "1"),
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [user, navigate]);
}