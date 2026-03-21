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
  KeyRound,
  CreditCard,
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

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, profile } = useAuth();
  const { t } = useI18n();

  const mainItems = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard },
    { title: t("nav.keywords"), url: "/keywords", icon: Search },
    { title: t("nav.planBuilder"), url: "/plan-builder", icon: ListTree },
    { title: t("nav.articles"), url: "/articles", icon: FileText },
    { title: t("nav.calendar"), url: "/calendar", icon: CalendarDays },
    { title: t("nav.analytics"), url: "/analytics", icon: BarChart3 },
  ];

  const settingsItems = [
    { title: t("nav.authorProfiles"), url: "/author-profiles", icon: UserPen },
    { title: "Тарифы", url: "/pricing", icon: CreditCard },
    { title: t("nav.settings"), url: "/settings", icon: Settings },
  ];

  const adminItems = [
    { title: t("nav.admin"), url: "/admin", icon: ShieldCheck },
  ];

  const plan = profile?.plan ?? "free";
  const limits = PLAN_LIMITS[plan as "free" | "basic" | "pro"];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-4">
          <KeyRound className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-semibold gradient-text">SEO-Synthesizer <sup className="text-[10px] text-muted-foreground">v2.0</sup></span>
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
          <div className="px-4 py-3 border-t border-sidebar-border">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>{t("nav.plan")}</span>
              <span className="font-medium text-primary uppercase">{plan}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("nav.limit")}</span>
              <span>{limits.maxGenerations} {t("nav.perMonth")}</span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
