import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { register } from "../api";

function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s; // 0..4
}
const LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = strength(form.password);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError("Please enter your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return setError("Please enter a valid email.");
    if (form.password.length < 8) return setError("Password must be at least 8 characters.");
    if (form.password !== form.confirm) return setError("Passwords do not match.");
    setError(null); setBusy(true);
    try {
      await register({ name: form.name.trim(), email: form.email, password: form.password });
      navigate("/login", { state: { registered: true, from: location.state?.from } });
    } catch (err) {
      setError(err.response?.data?.detail || "Registration failed.");
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <Link to="/" className="auth-brand">☁ Cloudsentrys</Link>
        <h1>Create account</h1>
        <p className="auth-sub">Register to run and manage analyses.</p>

        <label className="field">Name
          <input value={form.name} onChange={set("name")} placeholder="Jane Doe" />
        </label>
        <label className="field">Email
          <input type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" />
        </label>
        <label className="field">Password
          <div className="pw-wrap">
            <input type={showPw ? "text" : "password"} value={form.password} onChange={set("password")} />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}>
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
        </label>
        {form.password && (
          <div className="pw-strength">
            <div className={`pw-bar pw-${s}`} />
            <span>{LABELS[s]}</span>
          </div>
        )}
        <label className="field">Confirm password
          <input type="password" value={form.confirm} onChange={set("confirm")} />
        </label>

        {error && <div className="alert alert-error" role="alert">⚠ {error}</div>}

        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Creating account…" : "Register"}
        </button>
        <p className="auth-switch">Already registered? <Link to="/login">Login</Link></p>
      </form>
    </div>
  );
}
