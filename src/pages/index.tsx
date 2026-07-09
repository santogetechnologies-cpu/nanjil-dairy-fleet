import { Navigate } from "react-router-dom";
import { useAuth, REDIRECT_MAP } from "@/lib/auth";

function IndexRedirect() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" />;
  return <Navigate to={REDIRECT_MAP[user.role]} />;
}

export default IndexRedirect;
