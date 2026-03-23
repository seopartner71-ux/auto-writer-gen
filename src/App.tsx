import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/shared/hooks/useAuth";
import { ThemeProvider } from "@/shared/hooks/useTheme";
import { I18nProvider } from "@/shared/hooks/useI18n";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";
import { Loader2 } from "lucide-react";

// Eagerly loaded (core pages)
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import KeywordsPage from "@/pages/KeywordsPage";
import NotFound from "@/pages/NotFound";
import Index from "@/pages/Index";

// Lazy loaded (heavy / less frequent pages)
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
const WikiPage = lazy(() => import("@/pages/WikiPage"));

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
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />

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
