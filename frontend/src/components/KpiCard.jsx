export default function KpiCard({ label, value, tone = "default" }) {
  return (
    <div className={`card kpi-card kpi-${tone}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? "—"}</div>
    </div>
  );
}
