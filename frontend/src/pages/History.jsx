import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getAnalyses, exportAnalysis, exportAnalysisSummary } from "../api";

const PAGE_SIZE = 10;
const POLL_MS = 3000;
const fmtMoney = (v) => (v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

function StatusBadge({ status, progress }) {
  if (status === "processing") return <span className="badge">Processing {progress}%</span>;
  if (status === "failed") return <span className="badge" style={{ color: "var(--danger)" }}>Failed</span>;
  return <span className="badge" style={{ color: "var(--success)" }}>Complete</span>;
}

export default function History() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");
  const [page, setPage] = useState(1);
  const pollRef = useRef(null);

  // Auto-refreshes while any analysis is still processing in the background,
  // so a job that finishes after you've navigated away shows up without a manual reload.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getAnalyses()
        .then((d) => {
          if (cancelled) return;
          const list = Array.isArray(d) ? d : d?.analyses ?? [];
          setRows(list);
          if (list.some((a) => a.status === "processing")) {
            pollRef.current = setTimeout(load, POLL_MS);
          }
        })
        .catch((e) => !cancelled && setError(e.response?.data?.detail || "Failed to load analysis history."));
    };
    load();
    return () => { cancelled = true; clearTimeout(pollRef.current); };
  }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    let list = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        (a.filename || `analysis ${a.analysis_id}`).toLowerCase().includes(q) ||
        String(a.analysis_id).includes(q));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((x, y) => {
      const a = x[sortKey], b = y[sortKey];
      if (a == null) return 1; if (b == null) return -1;
      return typeof a === "number" ? (a - b) * dir : String(a).localeCompare(String(b)) * dir;
    });
  }, [rows, search, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const toggleSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
    setPage(1);
  };
  const arrow = (k) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  if (error) return <div className="empty-state"><h3>Unable to load history</h3><p>{error}</p></div>;
  if (!rows) return <div className="page-loader"><div className="spinner" /> Loading history…</div>;

  return (
    <div className="stack">
      <div className="page-head row-between">
        <div><h1>Analysis History</h1>
          <p className="page-sub">All analyses you have run. Click View to reopen a full analysis without re-uploading the CSV.</p></div>
        <Link className="btn btn-primary" to="/new-analysis">＋ New Analysis</Link>
      </div>

      <div className="card">
        <div className="card-toolbar">
          <input className="search-input" placeholder="Search by file name or ID…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {rows.length === 0 ? (
          <div className="empty-state">
            <h3>No analyses yet</h3>
            <p>Run your first CSV analysis to build your history.</p>
            <Link className="btn btn-primary" to="/new-analysis">Run New Analysis</Link>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state small"><p>No analyses match “{search}”.</p></div>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead><tr>
                  <th className="sortable" onClick={() => toggleSort("analysis_id")}>ID{arrow("analysis_id")}</th>
                  <th className="sortable" onClick={() => toggleSort("filename")}>File name{arrow("filename")}</th>
                  <th className="sortable" onClick={() => toggleSort("created_at")}>Date{arrow("created_at")}</th>
                  <th>Status</th>
                  <th className="sortable" onClick={() => toggleSort("total_records")}>Records{arrow("total_records")}</th>
                  <th className="sortable" onClick={() => toggleSort("anomaly_count")}>Anomalies{arrow("anomaly_count")}</th>
                  <th className="sortable" onClick={() => toggleSort("anomaly_rate")}>Rate{arrow("anomaly_rate")}</th>
                  <th className="sortable" onClick={() => toggleSort("total_estimated_cost_usd")}>Est. Cost{arrow("total_estimated_cost_usd")}</th>
                  <th className="sortable" onClick={() => toggleSort("anomaly_cost_exposure_usd")}>Exposure{arrow("anomaly_cost_exposure_usd")}</th>
                  <th>Actions</th>
                </tr></thead>
                <tbody>
                  {pageRows.map((a) => (
                    <tr key={a.analysis_id}>
                      <td className="mono">#{a.analysis_id}</td>
                      <td className="ellipsis" title={a.filename}>{a.filename || "—"}</td>
                      <td className="mono">{fmtDate(a.created_at)}</td>
                      <td><StatusBadge status={a.status || "complete"} progress={a.progress_percent ?? 100} /></td>
                      <td>{(a.total_records ?? a.total_observations ?? 0).toLocaleString()}</td>
                      <td>{(a.anomaly_count ?? a.detected_anomalies ?? 0).toLocaleString()}</td>
                      <td>{a.anomaly_rate != null ? `${Number(a.anomaly_rate).toFixed(2)}%` : "—"}</td>
                      <td className="mono">{fmtMoney(a.total_estimated_cost_usd)}</td>
                      <td className="mono">{fmtMoney(a.anomaly_cost_exposure_usd)}</td>
                      <td className="row-actions-cell">
                        <Link className="btn btn-sm" to={`/analysis/${a.analysis_id}`}>View</Link>
                        <button className="btn btn-sm" disabled={a.status !== "complete"} onClick={() => exportAnalysis(a.analysis_id)}>CSV</button>
                        <button className="btn btn-sm" disabled={a.status !== "complete"} onClick={() => exportAnalysisSummary(a.analysis_id)}>JSON</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span className="muted small">Page {page} of {totalPages}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
