import { Outlet, Navigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";

function AppGate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

export default AppGate;
