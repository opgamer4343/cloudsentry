import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
  BarChart, Bar,
} from "recharts";
import {
  getAnalysis, getTimeline, exportAnalysis, exportAnalysisSummary,
  getGeminiComparison, runGeminiComparison, updateAnomalyStatus, getMsg,
} from "../api";
import KpiCard from "../components/KpiCard";

const PAGE_SIZE = 10;
const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "false_positive", label: "False positive" },
];
const fmtMoney = (v) => `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtTs = (t) => (t == null ? "—" : new Date(t * 1000).toLocaleString());

export default function AnalysisDetails() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState("All");
  const [reviewFilter, setReviewFilter] = useState("All");
  const [sortKey, setSortKey] = useState("timestamp");
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);

  const [threshold, setThreshold] = useState(null);
  const [thresholdLoading, setThresholdLoading] = useState(false);
  const isFirstThresholdRun = useRef(true);

  const [statusUpdating, setStatusUpdating] = useState(null);
  const [statusError, setStatusError] = useState(null);

  const [gemini, setGemini] = useState(null);
  const [geminiLoading, setGeminiLoading] = useState(false);
  const [geminiError, setGeminiError] = useState(null);

  useEffect(() => {
    getGeminiComparison(id).then(setGemini).catch(() => {});
  }, [id]);

  const runComparison = () => {
    setGeminiLoading(true);
    setGeminiError(null);
    runGeminiComparison(id)
      .then(setGemini)
      .catch((e) => setGeminiError(getMsg(e)))
      .finally(() => setGeminiLoading(false));
  };

  useEffect(() => {
    isFirstThresholdRun.current = true;
    setLoading(true);
    Promise.all([getAnalysis(id), getTimeline(id).catch(() => ({ timeline: [] }))])
      .then(([a, t]) => { setData(a); setTimeline(t.timeline ?? []); setThreshold(a.default_threshold); })
      .catch((e) => setError(getMsg(e)))
      .finally(() => setLoading(false));
  }, [id]);

  // If the job is still running (e.g. you clicked in from History before it
  // finished), keep re-fetching until it completes or fails.
  useEffect(() => {
    if (data?.status !== "processing") return;
    const handle = setTimeout(() => {
      getAnalysis(id, threshold ?? undefined).then(setData).catch(() => {});
    }, 1500);
    return () => clearTimeout(handle);
  }, [data?.status, data?.progress_percent, id, threshold]);

  useEffect(() => {
    if (threshold == null) return;
    if (isFirstThresholdRun.current) { isFirstThresholdRun.current = false; return; }
    setThresholdLoading(true);
    const handle = setTimeout(() => {
      getAnalysis(id, threshold)
        .then((a) => setData((prev) => ({ ...prev, summary: a.summary, anomalies: a.anomalies, cost_by_profile: a.cost_by_profile, applied_threshold: a.applied_threshold })))
        .catch((e) => setError(getMsg(e)))
        .finally(() => setThresholdLoading(false));
    }, 300);
    return () => clearTimeout(handle);
  }, [threshold, id]);

  const handleStatusChange = (predictionId, status) => {
    setStatusUpdating(predictionId);
    setStatusError(null);
    updateAnomalyStatus(data.analysis_id, predictionId, status)
      .then((updated) => {
        setData((prev) => ({
          ...prev,
          anomalies: prev.anomalies.map((a) => (a.id === predictionId ? { ...a, review_status: updated.review_status } : a)),
        }));
      })
      .catch((e) => setStatusError(getMsg(e)))
      .finally(() => setStatusUpdating(null));
  };


  const anomalies = data?.anomalies ?? [];

  const profiles = useMemo(
    () => ["All", ...new Set(anomalies.map((a) => a.vm_profile).filter(Boolean))],
    [anomalies]
  );

  const filtered = useMemo(() => {
    let rows = anomalies;
    if (profileFilter !== "All") rows = rows.filter((a) => a.vm_profile === profileFilter);
    if (reviewFilter !== "All") rows = rows.filter((a) => (a.review_status || "new") === reviewFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((a) =>
        String(a.vm_id).toLowerCase().includes(q) ||
        fmtTs(a.timestamp).toLowerCase().includes(q) ||
        String(a.avg_cpu).includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = x[sortKey], b = y[sortKey];
      if (a == null) return 1; if (b == null) return -1;
      return typeof a === "number" && typeof b === "number"
        ? (a - b) * dir
        : String(a).localeCompare(String(b)) * dir;
    });
  }, [anomalies, profileFilter, reviewFilter, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
    setPage(1);
  };
  const arrow = (k) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  if (loading) return <div className="page-loader"><div className="spinner" /> Loading analysis #{id}…</div>;
  if (error) return (
    <div className="empty-state">
      <h3>Analysis not available</h3><p>{error}</p>
      <Link className="btn btn-primary" to="/history">Back to history</Link>
    </div>
  );
  if (data.status === "processing") return (
    <div className="empty-state">
      <h3>Still analyzing… {data.progress_percent}%</h3>
      <div className="progress" style={{ maxWidth: 320, margin: "12px auto" }}>
        <div className="progress-bar" style={{ width: `${data.progress_percent}%` }} />
      </div>
      <p className="muted">This page will update on its own — feel free to leave and come back.</p>
      <Link className="btn" to="/history">Back to history</Link>
    </div>
  );
  if (data.status === "failed") return (
    <div className="empty-state">
      <h3>Analysis failed</h3>
      <p>{data.error_message || "Something went wrong while processing this file."}</p>
      <Link className="btn btn-primary" to="/new-analysis">Try another file</Link>
    </div>
  );

  const s = data.summary;
  const timelineData = timeline.map((p) => ({
    time: new Date(p.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    anomalies: p.anomaly_count,
  }));
  const costData = (data.cost_by_profile ?? []).map((c) => ({
    profile: c.vm_profile,
    total: c.total_cost_usd,
    anomaly: c.anomaly_cost_usd,
  }));

  return (
    <div className="stack">
      <div className="page-head row-between">
        <div>
          <div className="breadcrumb"><Link to="/history">Analysis History</Link> / #{data.analysis_id}</div>
          <h1>Analysis #{data.analysis_id}</h1>
          <p className="page-sub">{data.filename || "Unnamed file"} · {new Date(data.created_at).toLocaleString()}</p>
        </div>
        <div className="row-actions">
          <button className="btn" onClick={() => exportAnalysis(data.analysis_id)}>⬇ Download CSV</button>
          <button className="btn" onClick={() => exportAnalysisSummary(data.analysis_id)}>⬇ Download Summary</button>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard label="Total Observations" value={s.total_observations.toLocaleString()} />
        <KpiCard label="Total VMs" value={s.total_vms.toLocaleString()} />
        <KpiCard label="Detected Anomalies" value={s.detected_anomalies.toLocaleString()} tone="danger" />
        <KpiCard label="Anomaly Rate" value={`${s.anomaly_rate.toFixed(2)}%`} tone="warning" />
        <KpiCard label="Estimated Cost" value={fmtMoney(s.total_estimated_cost_usd)} />
        <KpiCard label="Anomaly Cost Exposure" value={fmtMoney(s.anomaly_cost_exposure_usd)} tone="danger" />
      </div>

      <div className="card">
        <div className="card-toolbar">
          <h3 className="card-title">Detection Threshold</h3>
          {thresholdLoading && <span className="muted small">Recalculating…</span>}
        </div>
        <p className="muted small">
          The trained model flags a row as anomalous when its probability is ≥ {data.default_threshold.toFixed(2)}.
          Move the slider to see how a stricter or looser cutoff changes the results — this recomputes
          instantly from stored probabilities, no retraining involved.
        </p>
        <div className="row-actions" style={{ alignItems: "center", gap: 12 }}>
          <input
            type="range" min="0" max="1" step="0.01"
            value={threshold ?? data.default_threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            style={{ flex: 1 }}
          />
          <span className="mono">{(threshold ?? data.default_threshold).toFixed(2)}</span>
          <button className="btn btn-sm" onClick={() => setThreshold(data.default_threshold)}>
            Reset to trained ({data.default_threshold.toFixed(2)})
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <h3 className="card-title">Compare with Gemini</h3>
          <button className="btn btn-sm" disabled={geminiLoading} onClick={runComparison}>
            {geminiLoading ? "Asking Gemini…" : gemini ? "Run again" : "Compare with Gemini"}
          </button>
        </div>
        <p className="muted small">
          Gemini reviews an independent random sample of rows and gives its own anomaly
          judgment. This shows how much the two models <em>agree</em> — it isn't a ground-truth
          accuracy check, since only real labeled anomalies could tell us which one is right.
        </p>
        {geminiError && <div className="alert alert-error" role="alert">⚠ {geminiError}</div>}
        {gemini && (
          <div className="kpi-grid">
            <KpiCard label="Your model's rate" value={`${gemini.rf_anomaly_rate.toFixed(2)}%`} />
            <KpiCard label={`${gemini.model_name}'s rate`} value={`${gemini.gemini_anomaly_rate.toFixed(2)}%`} />
            <KpiCard label="Agreement" value={`${gemini.agreement_rate.toFixed(2)}%`} tone="warning" />
            <KpiCard label="Sample size" value={`${gemini.sample_size} rows`} />
          </div>
        )}
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

      <div className="card">
        <div className="card-toolbar">
          <h3 className="card-title">Anomalies ({filtered.length.toLocaleString()})</h3>
          <div className="toolbar-controls">
            <input className="search-input" placeholder="Search VM / time / CPU…"
              value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <select value={profileFilter}
              onChange={(e) => { setProfileFilter(e.target.value); setPage(1); }}>
              {profiles.map((p) => <option key={p} value={p}>{p === "All" ? "All profiles" : p}</option>)}
            </select>
            <select value={reviewFilter}
              onChange={(e) => { setReviewFilter(e.target.value); setPage(1); }}>
              <option value="All">All statuses</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {statusError && <div className="alert alert-error" role="alert">⚠ {statusError}</div>}

        {pageRows.length === 0 ? (
          <div className="empty-state small"><p>No anomalies match the current filters.</p></div>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th className="sortable" onClick={() => toggleSort("timestamp")}>Timestamp{arrow("timestamp")}</th>
                <th className="sortable" onClick={() => toggleSort("vm_id")}>VM ID{arrow("vm_id")}</th>
                <th className="sortable" onClick={() => toggleSort("avg_cpu")}>Avg CPU %{arrow("avg_cpu")}</th>
                <th className="sortable" onClick={() => toggleSort("anomaly_probability")}>Probability{arrow("anomaly_probability")}</th>
                <th className="sortable" onClick={() => toggleSort("vm_profile")}>Profile{arrow("vm_profile")}</th>
                <th className="sortable" onClick={() => toggleSort("estimated_cost_usd")}>Est. Cost{arrow("estimated_cost_usd")}</th>
                <th>Review Status</th>
              </tr></thead>
              <tbody>
                {pageRows.map((a, i) => (
                  <tr key={`${a.vm_id}-${a.timestamp}-${i}`}>
                    <td className="mono">{fmtTs(a.timestamp)}</td>
                    <td className="mono">{a.vm_id}</td>
                    <td>{Number(a.avg_cpu).toFixed(2)}</td>
                    <td className="mono">{Number(a.anomaly_probability).toFixed(4)}</td>
                    <td><span className="badge">{a.vm_profile || "—"}</span></td>
                    <td className="mono">{fmtMoney(a.estimated_cost_usd)}</td>
                    <td>
                      <select
                        value={a.review_status || "new"}
                        disabled={statusUpdating === a.id}
                        onChange={(e) => handleStatusChange(a.id, e.target.value)}
                      >
                        {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="pagination">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="muted small">Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Cost Assumptions</h3>
          <pre className="code">{JSON.stringify(data.cost_assumptions ?? {}, null, 2)}</pre>
        </div>
        <div className="card">
          <h3 className="card-title">Model Information</h3>
          <p><strong>Production model:</strong> Random Forest (threshold 0.80, 14 engineered features)</p>
          <p><strong>Secondary:</strong> Isolation Forest, One-Class SVM (comparative)</p>
          <p className="muted small">Cost values are representative Azure compute estimates — not actual customer billing data.</p>
        </div>
      </div>
    </div>
  );
}
