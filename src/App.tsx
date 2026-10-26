import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { Loader2 } from "lucide-react";

const IndexRedirect = lazy(() => import("./pages/index"));
const LoginPage = lazy(() => import("./pages/login"));
const DriverPage = lazy(() => import("./pages/driver"));
const AppGate = lazy(() => import("./pages/_app"));

// Operational Pages
const DashboardPage = lazy(() => import("./pages/_app.dashboard"));
const TrackingPage = lazy(() => import("./pages/_app.tracking"));
const RoutesPlannerPage = lazy(() => import("./pages/_app.routes"));
const TripsPage = lazy(() => import("./pages/_app.trips"));
const SafetyPage = lazy(() => import("./pages/_app.safety"));
const FuelPage = lazy(() => import("./pages/_app.fuel"));
const VehiclesPage = lazy(() => import("./pages/_app.vehicles"));
const VehicleDetailPage = lazy(() => import("./pages/_app.vehicles.$id"));
const DriversPage = lazy(() => import("./pages/_app.drivers"));
const AlertsPage = lazy(() => import("./pages/_app.alerts"));
const MaintenancePage = lazy(() => import("./pages/_app.maintenance"));
const ReportsPage = lazy(() => import("./pages/_app.reports"));
const SettingsPage = lazy(() => import("./pages/_app.settings"));
const UsersPage = lazy(() => import("./pages/_app.users"));

function PageFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <Loader2 className="h-6 w-6 animate-spin text-indigo-600" />
    </div>
  );
}

function NotFound() {
  const loc = useLocation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-slate-800">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-slate-800">Page not found</h2>
        <p className="mt-2 text-sm text-slate-500">
          No route found for <code className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-800 font-mono text-xs">{loc.pathname}</code>
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 shadow-xs transition-colors"
        >
          Return to Dashboard
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

        {/* Authenticated Application Gate */}
        <Route element={<AppGate />}>
          {/* Main 12 Navigation Items */}
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/tracking" element={<TrackingPage />} />
          <Route path="/routes" element={<RoutesPlannerPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/safety" element={<SafetyPage />} />
          <Route path="/fuel" element={<FuelPage />} />
          <Route path="/vehicles" element={<VehiclesPage />} />
          <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
          <Route path="/drivers" element={<DriversPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/maintenance" element={<MaintenancePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />

          {/* Admin User Management */}
          <Route path="/users" element={<UsersPage />} />

          {/* Legacy Path Redirects for Backward Compatibility */}
          <Route path="/collection-routes" element={<Navigate to="/routes" replace />} />
          <Route path="/vehicles-management" element={<Navigate to="/vehicles" replace />} />
          <Route path="/vehicles-management/:vehicleId" element={<Navigate to="/vehicles" replace />} />
          <Route path="/compliance" element={<Navigate to="/maintenance" replace />} />
          <Route path="/engine" element={<Navigate to="/dashboard" replace />} />
          <Route path="/ai" element={<Navigate to="/reports" replace />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}