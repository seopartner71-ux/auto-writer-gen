import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Profile, AppRole } from "@/shared/api/types";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const lastFetchedUserId = useRef<string | null>(null);
  const inFlightUserId = useRef<string | null>(null);

  const fetchUserData = useCallback(async (userId: string) => {
    if (lastFetchedUserId.current === userId || inFlightUserId.current === userId) return;

    inFlightUserId.current = userId;

    try {
      const [profileRes, roleRes] = await Promise.allSettled([
        supabase.from("profiles").select("*").eq("id", userId).single(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
      ]);

      if (profileRes.status === "fulfilled") {
        if (profileRes.value.error) {
          console.error("[useAuth] profile fetch error:", profileRes.value.error.message);
          setProfile(null);
        } else {
          setProfile(profileRes.value.data as Profile | null);
        }
      } else {
        console.error("[useAuth] profile fetch error:", profileRes.reason);
        setProfile(null);
      }

      if (roleRes.status === "fulfilled") {
        if (roleRes.value.error) {
          console.error("[useAuth] role fetch error:", roleRes.value.error.message);
          setRole(null);
          lastFetchedUserId.current = null;
        } else {
          const roles = (roleRes.value.data ?? []).map((r: any) => r.role as AppRole);
          setRole(roles.includes("admin") ? "admin" : roles[0] ?? "user");
          lastFetchedUserId.current = userId;
        }
      } else {
        console.error("[useAuth] role fetch error:", roleRes.reason);
        setRole(null);
        lastFetchedUserId.current = null;
      }

      void (async () => {
        try {
          const { error } = await supabase.from("user_stats").upsert(
            { user_id: userId, last_activity_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );

          if (error) console.error("[useAuth] user_stats upsert error:", error.message);
        } catch (error) {
          console.error("[useAuth] user_stats upsert error:", error);
        }
      })();

      // Track IP address on login — fetch real client IP first
      void (async () => {
        try {
          let clientIp = "unknown";
          try {
            const ipRes = await fetch("https://api.ipify.org?format=json");
            if (ipRes.ok) {
              const text = await ipRes.text();
              try {
                const ipData = JSON.parse(text);
                clientIp = ipData.ip || "unknown";
              } catch {
                // ipify sometimes returns plain text IP
                const cleaned = text.trim();
                if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) {
                  clientIp = cleaned;
                }
              }
            }
          } catch { /* ignore network errors */ }
          await supabase.functions.invoke("track-login", {
            body: { client_ip: clientIp },
          });
        } catch { /* ignore */ }
      })();
    } finally {
      inFlightUserId.current = null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const syncSession = async (nextSession: Session | null) => {
      if (!isMounted) return;

      setSession(nextSession);

      if (!nextSession?.user) {
        setProfile(null);
        setRole(null);
        lastFetchedUserId.current = null;
        inFlightUserId.current = null;
        setLoading(false);
        return;
      }

      setLoading(true);
      await fetchUserData(nextSession.user.id);

      if (isMounted) {
        setLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void syncSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        void syncSession(session);
      }
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchUserData]);

  const signOut = async () => {
    lastFetchedUserId.current = null;
    inFlightUserId.current = null;
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, profile, role, loading, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
