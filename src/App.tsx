import { lazy, Suspense, useTransition, useDeferredValue, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet, useNavigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/shared/hooks/useAuth";
import { ThemeProvider } from "@/shared/hooks/useTheme";
import { I18nProvider } from "@/shared/hooks/useI18n";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { SEOManager } from "@/components/SEOManager";
import { AIAssistantFab } from "@/components/AIAssistantFab";
import { Loader2 } from "lucide-react";

/**
 * Wraps React.lazy with automatic recovery from stale chunk errors.
 * After a new deploy, old tabs request chunks by outdated hashes — import() rejects
 * and Suspense hangs forever. We retry once, then force a hard reload (one time only)
 * so the user gets the new index.html with fresh chunk URLs instead of a frozen page.
 */
function lazyWithRetry<T extends { default: React.ComponentType<any> }>(
  factory: () => Promise<T>
) {
  return lazy(async () => {
    const RELOAD_KEY = "lovable_chunk_reloaded";
    try {
      return await factory();
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isChunkError =
        err?.name === "ChunkLoadError" ||
        /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg);
      if (isChunkError) {
        // Retry once in-memory (might be a transient network blip)
        try {
          return await factory();
        } catch {
          // Still failing — almost certainly a stale deploy. Hard-reload once.
          if (!sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, "1");
            window.location.reload();
            // Return a placeholder so React doesn't throw before reload kicks in.
            return { default: () => null } as unknown as T;
          }
        }
      }
      throw err;
    }
  });
}

// Eagerly loaded (core auth pages)
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "@/pages/NotFound";

// Lazy loaded
const Index = lazyWithRetry(() => import("@/pages/Index"));
const DashboardPage = lazyWithRetry(() => import("@/pages/DashboardPage"));

// Lazy loaded (heavy / less frequent pages)
const KeywordsPage = lazyWithRetry(() => import("@/pages/KeywordsPage"));
const PlanBuilderPage = lazyWithRetry(() => import("@/pages/PlanBuilderPage"));
const ArticlesPage = lazyWithRetry(() => import("@/pages/ArticlesPage"));
const CalendarPage = lazyWithRetry(() => import("@/pages/CalendarPage"));
const AnalyticsPage = lazyWithRetry(() => import("@/pages/AnalyticsPage"));
const AuthorProfilesPage = lazyWithRetry(() => import("@/pages/AuthorProfilesPage"));
const SettingsPage = lazyWithRetry(() => import("@/pages/SettingsPage"));
const AdminPage = lazyWithRetry(() => import("@/pages/AdminPage"));
const PricingPage = lazyWithRetry(() => import("@/pages/PricingPage"));
const IndexingPage = lazyWithRetry(() => import("@/pages/IndexingPage"));
const WordPressPage = lazyWithRetry(() => import("@/pages/WordPressPage"));
const RadarPage = lazyWithRetry(() => import("@/pages/RadarPage"));
const WikiPage = lazyWithRetry(() => import("@/pages/WikiPage"));
const IntegrationsPage = lazyWithRetry(() => import("@/pages/IntegrationsPage"));
const SupportPage = lazyWithRetry(() => import("@/pages/SupportPage"));
const ProjectsPage = lazyWithRetry(() => import("@/pages/ProjectsPage"));
const SiteFactoryPage = lazyWithRetry(() => import("@/pages/SiteFactoryPage"));
const NetworkMonitorPage = lazyWithRetry(() => import("@/pages/NetworkMonitorPage"));
const DomainHunterPage = lazyWithRetry(() => import("@/pages/DomainHunterPage"));
const OfferPage = lazyWithRetry(() => import("@/pages/OfferPage"));
const QuickStartPage = lazyWithRetry(() => import("@/pages/QuickStartPage"));
const PrivacyPage = lazyWithRetry(() => import("@/pages/PrivacyPage"));
const TermsPage = lazyWithRetry(() => import("@/pages/TermsPage"));
const CookiesPage = lazyWithRetry(() => import("@/pages/CookiesPage"));
const PaymentSuccessPage = lazyWithRetry(() => import("@/pages/PaymentSuccessPage"));
const ChangelogPage = lazyWithRetry(() => import("@/pages/ChangelogPage"));
const TopicalMapPage = lazyWithRetry(() => import("@/pages/TopicalMapPage"));
const ArticleAuditPage = lazyWithRetry(() => import("@/pages/ArticleAuditPage"));
const WelcomePage = lazyWithRetry(() => import("@/pages/WelcomePage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

/** Shared layout — mounts once, children swap via <Outlet /> */
function ProtectedAppLayout() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppLayout>
    </ProtectedRoute>
  );
}

function AdminLayout() {
  return (
    <ProtectedRoute requiredRole="admin">
      <AppLayout>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </AppLayout>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <SEOManager />
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<Suspense fallback={<PageLoader />}><Index /></Suspense>} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/offer" element={<Suspense fallback={<PageLoader />}><OfferPage /></Suspense>} />
                <Route path="/privacy" element={<Suspense fallback={<PageLoader />}><PrivacyPage /></Suspense>} />
                <Route path="/terms" element={<Suspense fallback={<PageLoader />}><TermsPage /></Suspense>} />
                <Route path="/cookies" element={<Suspense fallback={<PageLoader />}><CookiesPage /></Suspense>} />
                <Route path="/payment-success" element={<Suspense fallback={<PageLoader />}><PaymentSuccessPage /></Suspense>} />
                {/* All protected pages share one layout instance */}
                <Route element={<ProtectedAppLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/quick-start" element={<QuickStartPage />} />
                  <Route path="/welcome" element={<WelcomePage />} />
                  <Route path="/keywords" element={<KeywordsPage />} />
                  <Route path="/topical-map" element={<TopicalMapPage />} />
                  <Route path="/article-audit" element={<ArticleAuditPage />} />
                  <Route path="/plan-builder" element={<PlanBuilderPage />} />
                  <Route path="/articles" element={<ArticlesPage />} />
                  <Route path="/calendar" element={<CalendarPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/author-profiles" element={<AuthorProfilesPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/indexing" element={<IndexingPage />} />
                  <Route path="/wordpress" element={<WordPressPage />} />
                  <Route path="/radar" element={<RadarPage />} />
                  <Route path="/wiki" element={<WikiPage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/support" element={<SupportPage />} />
                  <Route path="/projects" element={<ProjectsPage />} />
                  <Route path="/my-articles" element={<Navigate to="/articles" replace />} />
                  <Route path="/site-factory" element={<SiteFactoryPage />} />
                  <Route path="/network-monitor" element={<NetworkMonitorPage />} />
                  <Route path="/domain-hunter" element={<DomainHunterPage />} />
                  <Route path="/changelog" element={<ChangelogPage />} />
                </Route>

                <Route element={<AdminLayout />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              <AIAssistantFab />
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
