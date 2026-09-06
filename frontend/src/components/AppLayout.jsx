import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: "▤" },
  { to: "/new-analysis", label: "New Analysis", icon: "＋" },
  { to: "/history", label: "Analysis History", icon: "≡" },
  { to: "/profile", label: "Profile", icon: "◉" },
  { to: "/settings", label: "Settings", icon: "⚙" },
  { to: "/help", label: "Help", icon: "?" },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const doLogout = () => { logout(); navigate("/login"); };

  const sidebar = (
    <>
      <div className="sb-brand" onClick={() => navigate("/dashboard")}>
        ☁ {!collapsed && <span>Cloudsentrys</span>}
      </div>
      <nav className="sb-nav">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={({ isActive }) => `sb-link${isActive ? " active" : ""}`}
            onClick={() => setDrawerOpen(false)}>
            <span className="sb-icon">{n.icon}</span>
            {!collapsed && <span>{n.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sb-user">
        <div className="sb-avatar">{user?.name?.[0]?.toUpperCase() || "?"}</div>
        {!collapsed && (
          <div className="sb-user-info">
            <div className="sb-user-name">{user?.name}</div>
            <div className="sb-user-email">{user?.email}</div>
          </div>
        )}
        <button className="btn-icon" title="Logout" onClick={doLogout}>⎋</button>
      </div>
    </>
  );

  return (
    <div className={`shell ${collapsed ? "shell-collapsed" : ""}`}>
      <button className="sb-collapse desktop-only" onClick={() => setCollapsed(!collapsed)}>
        {collapsed ? "»" : "«"}
      </button>
      <aside className="sidebar desktop-only">{sidebar}</aside>

      {drawerOpen && (
        <>
          <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />
          <aside className="sidebar mobile-drawer">{sidebar}</aside>
        </>
      )}

      <div className="shell-main">
        <header className="topbar">
          <button className="btn-icon mobile-only" onClick={() => setDrawerOpen(true)}>☰</button>
          <div className="topbar-title">Cloudsentrys</div>
          <div className="topbar-right">
            <span className="topbar-avatar" title={user?.email}>
              {user?.name?.[0]?.toUpperCase() || "?"}
            </span>
          </div>
        </header>
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
