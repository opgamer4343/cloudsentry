import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function GuestOnly({ children }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="page-loader"><div className="spinner" /> Checking session…</div>;
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : children;
}
