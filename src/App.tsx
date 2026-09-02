import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

const IndexRedirect = lazy(() => import("./pages/index"));
const LoginPage = lazy(() => import("./pages/login"));
const DriverPage = lazy(() => import("./pages/driver"));
const AppGate = lazy(() => import("./pages/_app"));


const DashboardPage = lazy(() => import("./pages/_app.dashboard"));
const TrackingPage = lazy(() => import("./pages/_app.tracking"));
const VehiclesPage = lazy(() => import("./pages/_app.vehicles"));
const VehicleDetailPage = lazy(() => import("./pages/_app.vehicles.$id"));
const TripsPage = lazy(() => import("./pages/_app.trips"));
const CollectionRoutesPage = lazy(() => import("./pages/_app.collection-routes"));
const FuelPage = lazy(() => import("./pages/_app.fuel"));
const SafetyPage = lazy(() => import("./pages/_app.safety"));
const EnginePage = lazy(() => import("./pages/_app.engine"));
const AlertsPage = lazy(() => import("./pages/_app.alerts"));
const MaintenancePage = lazy(() => import("./pages/_app.maintenance"));
const ReportsPage = lazy(() => import("./pages/_app.reports"));
const AiPage = lazy(() => import("./pages/_app.ai"));
const UsersPage = lazy(() => import("./pages/_app.users"));
const SettingsPage = lazy(() => import("./pages/_app.settings"));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

function NotFound() {
  const loc = useLocation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          No route for <code className="px-1">{loc.pathname}</code>
        </p>
        <Link to="/" className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Go home
        </Link>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/" element={<IndexRedirect />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/driver" element={<DriverPage />} />

        <Route element={<AppGate />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tracking" element={<TrackingPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/collection-routes" element={<CollectionRoutesPage />} />
          <Route path="/fuel" element={<FuelPage />} />
          <Route path="/safety" element={<SafetyPage />} />
          <Route path="/engine" element={<EnginePage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}