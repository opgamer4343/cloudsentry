import { useAuth } from "../context/AuthContext";

export default function Profile() {
  const { user } = useAuth();
  if (!user) return <div className="empty-state"><h3>Not signed in</h3></div>;

  return (
    <div className="stack narrow">
      <div className="page-head"><h1>Profile</h1>
        <p className="page-sub">Your account information. Profile editing is not supported by the backend, so this page is read-only.</p></div>
      <div className="card profile-card">
        <div className="profile-avatar">{user.name?.[0]?.toUpperCase() || "?"}</div>
        <div className="profile-rows">
          <div className="profile-row"><span className="muted">Name</span><strong>{user.name}</strong></div>
          <div className="profile-row"><span className="muted">Email</span><strong>{user.email}</strong></div>
          <div className="profile-row"><span className="muted">Account created</span><strong>{user.created_at ? new Date(user.created_at).toLocaleString() : "—"}</strong></div>
        </div>
      </div>
    </div>
  );
}
