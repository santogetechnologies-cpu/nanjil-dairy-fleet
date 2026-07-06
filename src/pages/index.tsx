import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

function IndexRedirect() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;
  if (user.role === "driver") return <Navigate to="/driver" />;
  return <Navigate to="/dashboard" />;
}

export default IndexRedirect;
