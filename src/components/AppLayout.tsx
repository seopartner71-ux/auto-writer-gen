import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/shared/hooks/useAuth";
import { useTheme } from "@/shared/hooks/useTheme";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { LogOut, Sun, Moon, MessageCircle } from "lucide-react";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useTrialStatus } from "@/shared/hooks/useTrialStatus";
import { TrialBanner } from "@/components/trial/TrialBanner";
import { PaywallModal } from "@/components/trial/PaywallModal";
import { NudgeNotification } from "@/components/trial/NudgeNotification";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang, t } = useI18n();
  const { showBanner, showPaywall, paywallReason, showNudge } = useTrialStatus();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between border-b border-border px-4 bg-card/50 backdrop-blur-sm shrink-0">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                asChild
                title={t("header.support")}
              >
                <a href="https://t.me/sin0ptick" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  <span className="text-xs">{t("header.support")}</span>
                </a>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLang(lang === "ru" ? "en" : "ru")}
                title={lang === "ru" ? "Switch to English" : "Переключить на русский"}
              >
                <span className="text-xs font-bold uppercase">{lang}</span>
              </Button>
              <NotificationBell />
              <Button variant="ghost" size="icon" onClick={toggleTheme} title={theme === "dark" ? "Light mode" : "Dark mode"}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <span className="text-sm text-muted-foreground hidden sm:inline ml-2">
                {user?.email}
              </span>
              <Button variant="ghost" size="icon" onClick={signOut}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          {showNudge && <NudgeNotification />}
          {showBanner && <TrialBanner />}
          <main className="flex-1 overflow-auto p-6">
            {children}
          </main>
        </div>
      </div>
      {showPaywall && paywallReason && (
        <PaywallModal reason={paywallReason as "no_credits" | "trial_expired"} />
      )}
    </SidebarProvider>
  );
}
