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
import { Loader2 } from "lucide-react";

// Eagerly loaded (core auth pages)
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import NotFound from "@/pages/NotFound";

// Lazy loaded
const Index = lazy(() => import("@/pages/Index"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));

// Lazy loaded (heavy / less frequent pages)
const KeywordsPage = lazy(() => import("@/pages/KeywordsPage"));
const PlanBuilderPage = lazy(() => import("@/pages/PlanBuilderPage"));
const ArticlesPage = lazy(() => import("@/pages/ArticlesPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const AuthorProfilesPage = lazy(() => import("@/pages/AuthorProfilesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const IndexingPage = lazy(() => import("@/pages/IndexingPage"));
const WordPressPage = lazy(() => import("@/pages/WordPressPage"));
const RadarPage = lazy(() => import("@/pages/RadarPage"));
const MentionsPage = lazy(() => import("@/pages/MentionsPage"));
const PromptsPage = lazy(() => import("@/pages/PromptsPage"));
const SourcesPage = lazy(() => import("@/pages/SourcesPage"));
const WikiPage = lazy(() => import("@/pages/WikiPage"));
const IntegrationsPage = lazy(() => import("@/pages/IntegrationsPage"));
const SupportPage = lazy(() => import("@/pages/SupportPage"));
const OfferPage = lazy(() => import("@/pages/OfferPage"));
const PrivacyPage = lazy(() => import("@/pages/PrivacyPage"));
const TermsPage = lazy(() => import("@/pages/TermsPage"));
const CookiesPage = lazy(() => import("@/pages/CookiesPage"));

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

                {/* All protected pages share one layout instance */}
                <Route element={<ProtectedAppLayout />}>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/keywords" element={<KeywordsPage />} />
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
                </Route>

                <Route element={<AdminLayout />}>
                  <Route path="/admin" element={<AdminPage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
