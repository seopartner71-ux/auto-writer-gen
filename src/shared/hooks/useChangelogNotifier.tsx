import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { CHANGELOG } from "@/data/changelog";

/**
 * Notifies the user once when a new changelog version appears.
 * Compares latest version vs localStorage["changelog_last_seen"].
 */
export function useChangelogNotifier() {
  const navigate = useNavigate();
  const { t } = useI18n();
  useEffect(() => {
    let cancelled = false;
    const data = CHANGELOG[0];
    if (!data) return;
    const seen = localStorage.getItem("changelog_last_seen");
    if (seen === data.version) return;
    if (seen && cmpVersions(seen, data.version) >= 0) return;
    if (cancelled) return;
    toast.info(`${t("notifier.changelogTitle")}${data.version}`, {
      description: data.title,
      duration: 8000,
      action: {
        label: t("notifier.changelogAction"),
        onClick: () => navigate("/changelog"),
      },
    });
    return () => { cancelled = true; };
  }, [navigate, t]);
}

function cmpVersions(a: string, b: string) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0, db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** Reads if there is an unseen latest version (for sidebar dot). */
export function useUnseenChangelog() {
  const [unseen, setUnseen] = useState(false);
  useEffect(() => {
    const data = CHANGELOG[0];
    const seen = localStorage.getItem("changelog_last_seen");
    setUnseen(!!data && seen !== data.version);
    const onSeen = () => setUnseen(false);
    window.addEventListener("changelog:seen", onSeen);
    return () => { window.removeEventListener("changelog:seen", onSeen); };
  }, []);
  return unseen;
}