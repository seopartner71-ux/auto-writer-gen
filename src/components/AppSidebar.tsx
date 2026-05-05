import {
  LayoutDashboard,
  Search,
  ListTree,
  FileText,
  BarChart3,
  UserPen,
  Settings,
  ShieldCheck,
  Hexagon,
  FolderKanban,
  CreditCard,
  Radar,
  LifeBuoy,
  Factory,
  Activity,
  Crosshair,
  Send,
  ChevronDown,
  Workflow,
  Sparkles,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { PLAN_LIMITS } from "@/shared/api/types";
import { useUnseenChangelog } from "@/shared/hooks/useChangelogNotifier";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCallback, useEffect, useState } from "react";

// Prefetch route chunks on hover
const routePrefetchMap: Record<string, () => void> = {
  "/keywords": () => import("@/pages/KeywordsPage"),
  "/plan-builder": () => import("@/pages/PlanBuilderPage"),
  "/articles": () => import("@/pages/ArticlesPage"),
  "/analytics": () => import("@/pages/AnalyticsPage"),
  "/author-profiles": () => import("@/pages/AuthorProfilesPage"),
  "/settings": () => import("@/pages/SettingsPage"),
  "/pricing": () => import("@/pages/PricingPage"),
  "/indexing": () => import("@/pages/IndexingPage"),
  "/wordpress": () => import("@/pages/WordPressPage"),
  "/radar": () => import("@/pages/RadarPage"),
  "/integrations": () => import("@/pages/IntegrationsPage"),
  "/support": () => import("@/pages/SupportPage"),
  "/admin": () => import("@/pages/AdminPage"),
  "/projects": () => import("@/pages/ProjectsPage"),
  "/site-factory": () => import("@/pages/SiteFactoryPage"),
  "/network-monitor": () => import("@/pages/NetworkMonitorPage"),
  "/domain-hunter": () => import("@/pages/DomainHunterPage"),
};

export function AppSidebar() {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, profile } = useAuth();
  const { t, lang } = useI18n();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handlePrefetch = useCallback((url: string) => {
    routePrefetchMap[url]?.();
  }, []);

  const plan = profile?.plan ?? "free";
  const isFactory = plan === "pro";

  const networkPaths = ["/site-factory", "/network-monitor", "/domain-hunter"];
  const publishPaths = ["/indexing", "/wordpress", "/integrations"];
  const [networkOpen, setNetworkOpen] = useState(networkPaths.includes(location.pathname));
  const [publishOpen, setPublishOpen] = useState(publishPaths.includes(location.pathname));

  const mainItems = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard },
    { title: t("nav.projects"), url: "/projects", icon: FolderKanban },
    { title: t("nav.keywords"), url: "/keywords", icon: Search },
    { title: t("nav.planBuilder"), url: "/plan-builder", icon: ListTree },
    { title: t("nav.articles"), url: "/articles", icon: FileText },
    ...(isFactory ? [
      { title: "AI Radar", url: "/radar", icon: Radar },
    ] : []),
    { title: t("nav.analytics"), url: "/analytics", icon: BarChart3 },
  ];

  const networkItems = isFactory ? [
    { title: lang === "ru" ? "Фабрика сайтов" : "Site Factory", url: "/site-factory", icon: Factory },
    { title: lang === "ru" ? "Мониторинг сети" : "Network Monitor", url: "/network-monitor", icon: Activity },
    { title: lang === "ru" ? "Aged домены" : "Domain Hunter", url: "/domain-hunter", icon: Crosshair },
  ] : [];

  const publishItems = isFactory ? [
    { title: t("nav.wordpress"), url: "/wordpress", icon: Send },
    { title: t("nav.integrations"), url: "/integrations", icon: Send },
    { title: t("nav.indexing"), url: "/indexing", icon: Send },
  ] : [];

  const settingsItems = [
    { title: t("nav.authorProfiles"), url: "/author-profiles", icon: UserPen },
    { title: t("nav.pricing"), url: "/pricing", icon: CreditCard },
    { title: t("nav.settings"), url: "/settings", icon: Settings },
    { title: t("nav.support"), url: "/support", icon: LifeBuoy },
  ];

  const unseenChangelog = useUnseenChangelog();
  const APP_VERSION = "v2.4";

  const [aiwriterMode, setAiwriterMode] = useState<"quick" | "expert" | null>(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem("aiwriter_mode");
    return v === "quick" ? "quick" : v === "expert" ? "expert" : null;
  });
  useEffect(() => {
    const handler = (e: any) => setAiwriterMode(e?.detail === "quick" ? "quick" : "expert");
    window.addEventListener("aiwriter-mode-changed", handler);
    return () => window.removeEventListener("aiwriter-mode-changed", handler);
  }, []);

  const adminItems = [
    { title: t("nav.admin"), url: "/admin", icon: ShieldCheck },
  ];

  const limits = PLAN_LIMITS[plan as "free" | "basic" | "pro"];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-2">
          <Hexagon className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-brand tracking-tight">{lang === "ru" ? <>СЕО-<span className="gradient-text">Модуль</span></> : <>SEO-<span className="gradient-text">Module</span></>}</span>
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
                      {!collapsed && (
                        <span className="flex-1 flex items-center justify-between gap-2">
                          <span>{item.title}</span>
                          {item.url === "/articles" && aiwriterMode && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium uppercase">
                              {aiwriterMode === "quick" ? "Старт" : "Эксперт"}
                            </span>
                          )}
                        </span>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isFactory && networkItems.length > 0 && (
          <SidebarGroup>
            <Collapsible open={networkOpen} onOpenChange={setNetworkOpen}>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer flex items-center justify-between hover:text-primary">
                  <span className="flex items-center gap-1.5">
                    <Factory className="h-3.5 w-3.5" />
                    {!collapsed && (lang === "ru" ? "Сеть сайтов" : "Site Network")}
                  </span>
                  {!collapsed && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${networkOpen ? "" : "-rotate-90"}`} />}
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {networkItems.map((item) => (
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
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        {isFactory && publishItems.length > 0 && (
          <SidebarGroup>
            <Collapsible open={publishOpen} onOpenChange={setPublishOpen}>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="cursor-pointer flex items-center justify-between hover:text-primary">
                  <span className="flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5" />
                    {!collapsed && (lang === "ru" ? "Публикация" : "Publishing")}
                  </span>
                  {!collapsed && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${publishOpen ? "" : "-rotate-90"}`} />}
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {publishItems.map((item) => (
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
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

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

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/changelog"
                    className="hover:bg-sidebar-accent/50"
                    activeClassName="bg-sidebar-accent text-primary font-medium"
                    onClick={handleNavClick}
                  >
                    <span className="relative mr-2 flex items-center">
                      <Sparkles className="h-4 w-4 shrink-0" />
                      {unseenChangelog && (
                        <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
                      )}
                    </span>
                    {!collapsed && (
                      <span className="flex-1 flex items-center justify-between">
                        <span>{lang === "ru" ? "Обновления" : "Changelog"}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">{APP_VERSION}</span>
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
