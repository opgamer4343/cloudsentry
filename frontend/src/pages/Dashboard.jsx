import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import { getAnalyses, getAnalysis, getModelPerformance, getFeatureImportance, getTimeline } from "../api";
import KpiCard from "../components/KpiCard";

const COLORS = { normal: "#16a34a", anomaly: "#dc2626" };
const fmtMoney = (v) => `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Dashboard() {
  const [latest, setLatest] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [history, setHistory] = useState([]);
  const [perf, setPerf] = useState(null);
  const [featureImportance, setFeatureImportance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      getAnalyses(),
      getModelPerformance().catch(() => null),
      getFeatureImportance().catch(() => null),
    ])
      .then(async ([analyses, p, fi]) => {
        setPerf(p);
        setFeatureImportance(fi);
        const list = Array.isArray(analyses) ? analyses : analyses?.analyses ?? [];
        setHistory(list);
        if (list.length > 0) {
          const id = list[0].analysis_id;
          const [a, t] = await Promise.all([
            getAnalysis(id),
            getTimeline(id).catch(() => ({ timeline: [] })),
          ]);
          setLatest(a);
          setTimeline(t.timeline ?? []);
        }
      })
      .catch((e) => setError(e.response?.data?.detail || "Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loader"><div className="spinner" /> Loading dashboard…</div>;
  if (error) return (
    <div className="empty-state">
      <h3>Unable to load dashboard</h3><p>{error}</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>
    </div>
  );
  if (!latest) return (
    <div className="empty-state">
      <h3>No analyses yet</h3>
      <p>Run your first analysis to see KPIs, charts and cost exposure here.</p>
      <Link className="btn btn-primary" to="/new-analysis">Run New Analysis</Link>
    </div>
  );

  const s = latest.summary;
  const distData = [
    { name: "Normal", value: s.total_observations - s.detected_anomalies },
    { name: "Anomaly", value: s.detected_anomalies },
  ];
  const timelineData = timeline.map((p) => ({
    time: new Date(p.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    anomalies: p.anomaly_count,
  }));
  const costData = (latest.cost_by_profile ?? []).map((c) => ({
    profile: `${c.vm_profile} (${c.vm_sku})`,
    total: c.total_cost_usd,
    anomaly: c.anomaly_cost_usd,
  }));
  const productionModel = (perf ?? []).find((m) => m.model === "Random Forest");

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Cloudsentrys</h1>
        <p className="page-sub">
          Detects unusual Azure VM CPU workload patterns and estimates representative
          compute cost exposure. Cost values are estimates — not actual billing data.
        </p>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Total Observations" value={s.total_observations.toLocaleString()} />
        <KpiCard label="Total VMs" value={s.total_vms.toLocaleString()} />
        <KpiCard label="Detected Anomalies" value={s.detected_anomalies.toLocaleString()} tone="danger" />
        <KpiCard label="Anomaly Rate" value={`${s.anomaly_rate.toFixed(2)}%`} tone="warning" />
        <KpiCard label="Estimated Cost" value={fmtMoney(s.total_estimated_cost_usd)} />
        <KpiCard label="Anomaly Cost Exposure" value={fmtMoney(s.anomaly_cost_exposure_usd)} tone="danger" />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Anomaly Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={distData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                <Cell fill={COLORS.normal} /><Cell fill={COLORS.anomaly} />
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend-row">
            <span><i className="dot" style={{ background: COLORS.normal }} /> Normal ({distData[0].value.toLocaleString()})</span>
            <span><i className="dot" style={{ background: COLORS.anomaly }} /> Anomaly ({distData[1].value.toLocaleString()})</span>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Cost by VM Profile</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="profile" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => fmtMoney(v)} />
              <Bar dataKey="total" name="Total cost" fill="#2563eb" radius={[4, 4, 0, 0]} />
              <Bar dataKey="anomaly" name="Anomaly exposure" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Anomaly Timeline</h3>
        {timelineData.length === 0 ? <p className="muted">No anomaly timestamps recorded.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={timelineData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="time" minTickGap={30} tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="anomalies" stroke="#dc2626" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">What Drives the Model's Decisions</h3>
        <p className="muted small">
          Global feature importance from the trained Random Forest — which of the 14 engineered
          signals matter most across all its decisions. This is not a per-row explanation for any
          single anomaly, just an overall picture of what the model relies on.
        </p>
        {!featureImportance || featureImportance.length === 0 ? (
          <p className="muted">Feature importance unavailable.</p>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={featureImportance} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="feature" width={130} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => `${(v * 100).toFixed(2)}%`} />
              <Bar dataKey="importance" fill="#7c3aed" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Model Performance</h3>
          {!perf || perf.length === 0 ? <p className="muted">Model performance unavailable.</p> : (
            <table className="table">
              <thead><tr><th>Model</th><th>Accuracy</th><th>Precision</th><th>Recall</th><th>F1</th><th>ROC-AUC</th></tr></thead>
              <tbody>
                {perf.map((m) => (
                  <tr key={m.model}>
                    <td>{m.model}{m.model === "Random Forest" && <span className="badge" style={{ marginLeft: 6 }}>production</span>}</td>
                    <td className="mono">{(m.accuracy * 100).toFixed(2)}%</td>
                    <td className="mono">{(m.precision * 100).toFixed(2)}%</td>
                    <td className="mono">{(m.recall * 100).toFixed(2)}%</td>
                    <td className="mono">{(m.f1_score * 100).toFixed(2)}%</td>
                    <td className="mono">{(m.roc_auc * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Production model: {productionModel ? productionModel.model : "Random Forest"} · Decision threshold 0.80 · 14 engineered features.
          </p>
        </div>

        <div className="card">
          <h3 className="card-title">Recent Analyses</h3>
          {history.length === 0 ? <p className="muted">No history yet.</p> : (
            <table className="table">
              <thead><tr><th>ID</th><th>File</th><th>Status</th><th>Anomalies</th><th></th></tr></thead>
              <tbody>
                {history.slice(0, 5).map((a) => (
                  <tr key={a.analysis_id}>
                    <td>#{a.analysis_id}</td>
                    <td className="ellipsis">{a.filename || "—"}</td>
                    <td>{a.status === "processing" ? `${a.progress_percent}%` : a.status === "failed" ? "Failed" : "Complete"}</td>
                    <td>{a.status === "complete" ? (a.anomaly_count ?? "—") : "—"}</td>
                    <td><Link className="btn btn-sm" to={`/analysis/${a.analysis_id}`}>View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link className="btn btn-sm" to="/history">View all history</Link>
        </div>
      </div>
    </div>
  );
}
