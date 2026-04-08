import {
  LayoutDashboard,
  Search,
  ListTree,
  FileText,
  CalendarDays,
  BarChart3,
  UserPen,
  Settings,
  ShieldCheck,
  Hexagon,
  CreditCard,
  Zap,
  Globe,
  Radar,
  BookMarked,
  Plug,
  LifeBuoy,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { PLAN_LIMITS } from "@/shared/api/types";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCallback } from "react";

// Prefetch route chunks on hover
const routePrefetchMap: Record<string, () => void> = {
  "/keywords": () => import("@/pages/KeywordsPage"),
  "/plan-builder": () => import("@/pages/PlanBuilderPage"),
  "/articles": () => import("@/pages/ArticlesPage"),
  "/calendar": () => import("@/pages/CalendarPage"),
  "/analytics": () => import("@/pages/AnalyticsPage"),
  "/author-profiles": () => import("@/pages/AuthorProfilesPage"),
  "/settings": () => import("@/pages/SettingsPage"),
  "/pricing": () => import("@/pages/PricingPage"),
  "/indexing": () => import("@/pages/IndexingPage"),
  "/wordpress": () => import("@/pages/WordPressPage"),
  "/radar": () => import("@/pages/RadarPage"),
  "/mentions": () => import("@/pages/MentionsPage"),
  "/prompts": () => import("@/pages/PromptsPage"),
  "/sources": () => import("@/pages/SourcesPage"),
  "/wiki": () => import("@/pages/WikiPage"),
  "/integrations": () => import("@/pages/IntegrationsPage"),
  "/support": () => import("@/pages/SupportPage"),
  "/admin": () => import("@/pages/AdminPage"),
};

export function AppSidebar() {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, profile } = useAuth();
  const { t } = useI18n();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handlePrefetch = useCallback((url: string) => {
    routePrefetchMap[url]?.();
  }, []);

  const mainItems = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard },
    { title: t("nav.keywords"), url: "/keywords", icon: Search },
    { title: t("nav.planBuilder"), url: "/plan-builder", icon: ListTree },
    { title: t("nav.articles"), url: "/articles", icon: FileText },
    { title: t("nav.calendar"), url: "/calendar", icon: CalendarDays },
    { title: "AI Radar", url: "/radar", icon: Radar },
    { title: "Позиции", url: "/mentions", icon: Crosshair },
    { title: "Промпты", url: "/prompts", icon: MessageSquareText },
    { title: "Источники", url: "/sources", icon: Link2 },
    { title: t("nav.analytics"), url: "/analytics", icon: BarChart3 },
    { title: t("nav.wiki"), url: "/wiki", icon: BookMarked },
  ];

  const settingsItems = [
    { title: t("nav.authorProfiles"), url: "/author-profiles", icon: UserPen },
    { title: t("nav.wordpress"), url: "/wordpress", icon: Globe },
    { title: "Интеграции", url: "/integrations", icon: Plug },
    { title: t("nav.indexing"), url: "/indexing", icon: Zap },
    { title: t("nav.pricing"), url: "/pricing", icon: CreditCard },
    { title: t("nav.settings"), url: "/settings", icon: Settings },
    { title: "Поддержка", url: "/support", icon: LifeBuoy },
  ];

  const adminItems = [
    { title: t("nav.admin"), url: "/admin", icon: ShieldCheck },
  ];

  const plan = profile?.plan ?? "free";
  const limits = PLAN_LIMITS[plan as "free" | "basic" | "pro"];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-2">
          <Hexagon className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-brand tracking-tight">СЕО-<span className="gradient-text">Модуль</span></span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.main")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                      onClick={handleNavClick}
                      onMouseEnter={() => handlePrefetch(item.url)}
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.tools")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                      onClick={handleNavClick}
                      onMouseEnter={() => handlePrefetch(item.url)}
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>{t("nav.administration")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent/50"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                        onClick={handleNavClick}
                        onMouseEnter={() => handlePrefetch(item.url)}
                      >
                        <item.icon className="mr-2 h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter>
          <div className="px-4 py-3 border-t border-sidebar-border space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("nav.plan")}</span>
              <span className="font-medium text-primary uppercase">{plan}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("sidebar.credits")}</span>
              <span className={`font-bold ${(profile?.credits_amount ?? 0) > 0 ? "text-success" : "text-destructive"}`}>
                {profile?.credits_amount ?? 0} {t("sidebar.articles")}
              </span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
