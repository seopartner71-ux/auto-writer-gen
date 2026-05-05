import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Notifies the user once when a new changelog version appears.
 * Compares latest version vs localStorage["changelog_last_seen"].
 */
export function useChangelogNotifier() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("changelog")
        .select("version,title")
        .order("release_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) return;
      const seen = localStorage.getItem("changelog_last_seen");
      if (seen === data.version) return;
      // Compare to avoid downgrading
      if (seen && cmpVersions(seen, data.version) >= 0) return;
      toast.info(`Обновление v${data.version}`, {
        description: data.title,
        duration: 8000,
        action: {
          label: "Что нового",
          onClick: () => navigate("/changelog"),
        },
      });
    })();
    return () => { cancelled = true; };
  }, [navigate]);
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
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from("changelog")
        .select("version")
        .order("release_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const seen = localStorage.getItem("changelog_last_seen");
      setUnseen(!!data && seen !== data.version);
    };
    check();
    const onSeen = () => setUnseen(false);
    window.addEventListener("changelog:seen", onSeen);
    return () => { cancelled = true; window.removeEventListener("changelog:seen", onSeen); };
  }, []);
  return unseen;
}