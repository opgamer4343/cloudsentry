import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BASE_URL, changePassword, getMsg } from "../api";
import { useAuth } from "../context/AuthContext";

// Frontend-only preferences, persisted in localStorage. No backend settings exist.
const PREF_KEY = "cs_prefs";
const load = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) ?? {}; } catch { return {}; } };

export default function Settings() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState(load);
  const [apiStatus, setApiStatus] = useState("checking");

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState(null);
  const [pwBusy, setPwBusy] = useState(false);

  const submitPasswordChange = async (e) => {
    e.preventDefault();
    setPwError(null);
    if (newPw.length < 8) return setPwError("New password must be at least 8 characters.");
    if (newPw !== confirmPw) return setPwError("New passwords don't match.");
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      logout();
      navigate("/login", { state: { passwordChanged: true } });
    } catch (err) {
      setPwError(getMsg(err));
    } finally {
      setPwBusy(false);
    }
  };

  const save = (p) => {
    setPrefs(p);
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  };

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme || "light";
  }, [prefs.theme]);

  useEffect(() => {
    fetch(`${BASE_URL}/health`)
      .then((r) => setApiStatus(r.ok ? "online" : "degraded"))
      .catch(() => setApiStatus("offline"));
  }, []);

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Settings</h1>
        <p className="page-sub">Frontend preferences only — stored in this browser, not on the server.</p>
      </div>

      <div className="card">
        <h3 className="card-title">Appearance</h3>
        <label className="checkbox-row">
          <input type="checkbox" checked={prefs.theme === "dark"}
            onChange={(e) => save({ ...prefs, theme: e.target.checked ? "dark" : "light" })} />
          Dark mode
        </label>
      </div>

      <div className="card">
        <h3 className="card-title">Notifications</h3>
        <label className="checkbox-row">
          <input type="checkbox" checked={prefs.notifyAnomalies ?? true}
            onChange={(e) => save({ ...prefs, notifyAnomalies: e.target.checked })} />
          Highlight anomaly count changes in the dashboard header
        </label>
        <p className="muted small">These preferences affect the UI only. No email or server notifications exist.</p>
      </div>

      <div className="card">
        <h3 className="card-title">Change Password</h3>
        <form onSubmit={submitPasswordChange} className="stack" noValidate>
          <label className="field">Current password
            <input type="password" value={currentPw} autoComplete="current-password"
              onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" />
          </label>
          <label className="field">New password
            <input type="password" value={newPw} autoComplete="new-password"
              onChange={(e) => setNewPw(e.target.value)} placeholder="At least 8 characters" />
          </label>
          <label className="field">Confirm new password
            <input type="password" value={confirmPw} autoComplete="new-password"
              onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" />
          </label>
          {pwError && <div className="alert alert-error" role="alert">⚠ {pwError}</div>}
          <button className="btn btn-primary" disabled={pwBusy}>
            {pwBusy ? "Updating…" : "Change password"}
          </button>
          <p className="muted small">Changing your password signs you out everywhere, including this device.</p>
        </form>
      </div>

      <div className="card">
        <h3 className="card-title">Application</h3>
        <div className="profile-row"><span className="muted">Signed in as</span><strong>{user?.email}</strong></div>
        <div className="profile-row">
          <span className="muted">API status</span>
          <strong className={apiStatus === "online" ? "text-success" : "text-danger"}>{apiStatus}</strong>
        </div>
        <div className="profile-row"><span className="muted">API base URL</span><span className="mono small">{BASE_URL}</span></div>
        <div className="profile-row"><span className="muted">Frontend version</span><strong>1.0.0</strong></div>
        <p className="muted small">Backend version and ML model details are available on the Help page and via <span className="mono">/model-performance</span>.</p>
      </div>
    </div>
  );
}
