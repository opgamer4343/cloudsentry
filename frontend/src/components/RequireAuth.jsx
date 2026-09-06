import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="page-loader"><div className="spinner" /> Checking session…</div>;
  return isAuthenticated ? children : <Navigate to="/login" state={{ from: location }} replace />;
}
