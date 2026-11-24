import { Outlet, Navigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";
import { AppLayout } from "@/components/AppLayout";

function AppGate() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;

  if (REDIRECT_MAP[user.role] !== "/dashboard") {
    return <Navigate to={REDIRECT_MAP[user.role]} />;
  }

  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

export default AppGate;
