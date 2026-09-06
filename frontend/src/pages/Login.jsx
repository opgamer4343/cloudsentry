import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const validate = () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Please enter a valid email address.";
    if (password.length < 1) return "Please enter your password.";
    return null;
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    if (v) return setError(v);
    setError(null); setBusy(true);
    try {
      await login(email, password);
      if (!remember) sessionStorage.setItem("cs_session_only", "1");
      navigate(location.state?.from?.pathname || "/dashboard", { replace: true });
    } catch (err) {
      setError(err.response?.data?.detail || "Login failed. Check your credentials.");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Link to="/" className="auth-brand">☁ Cloudsentrys</Link>
        <h1>Sign in</h1>
        <p className="auth-sub">Access your anomaly detection dashboard.</p>

        {location.state?.registered && (
          <div className="alert alert-success" role="status">✓ Account created. Please sign in.</div>
        )}
        {location.state?.passwordChanged && (
          <div className="alert alert-success" role="status">✓ Password changed. Please sign in again.</div>
        )}

        <label className="field">Email
          <input type="email" value={email} autoComplete="email"
            onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </label>

        <label className="field">Password
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>

        {error && <div className="alert alert-error" role="alert">⚠ {error}</div>}

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Signing in…" : "Login"}
        </button>
        <p className="auth-switch">No account? <Link to="/register">Register</Link></p>
      </form>
    </div>
  );
}
