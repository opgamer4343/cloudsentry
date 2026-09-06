import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeCsv, getAnalysisStatus } from "../api";

const REQUIRED = ["timestamp", "vm_id", "min_cpu", "max_cpu", "avg_cpu"];
const POLL_MS = 800;
const fmtSize = (b) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(1)} KB`);

export default function NewAnalysis() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const pollRef = useRef(null);
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [jobProgress, setJobProgress] = useState(0);
  const [phase, setPhase] = useState(null); // null | 'uploading' | 'processing'
  const [error, setError] = useState(null);

  // Stop polling if the user navigates away mid-analysis.
  useEffect(() => () => clearTimeout(pollRef.current), []);

  const pick = (f) => {
    setError(null);
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) return setError("Please select a .csv file.");
    if (f.size === 0) return setError("The selected file is empty.");
    setFile(f);
  };

  const remove = () => {
    setFile(null);
    setUploadProgress(0);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Polls the job's status until it's done, updating the real progress bar as it goes.
  const pollUntilDone = (analysisId) => {
    getAnalysisStatus(analysisId)
      .then((s) => {
        setJobProgress(s.progress_percent);
        if (s.status === "complete") {
          navigate(`/analysis/${analysisId}`);
        } else if (s.status === "failed") {
          setError(s.error_message || "Analysis failed. Please check the file and try again.");
          setPhase(null);
        } else {
          pollRef.current = setTimeout(() => pollUntilDone(analysisId), POLL_MS);
        }
      })
      .catch((e) => {
        setError(e.response?.data?.detail || "Lost track of the analysis. Please try again.");
        setPhase(null);
      });
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    setUploadProgress(0);
    setJobProgress(0);
    try {
      // The server responds almost instantly here (before the real work is
      // done) with an analysis id - the heavy lifting happens in the
      // background, so we switch to polling its status for real progress.
      const result = await analyzeCsv(file, setUploadProgress);
      setPhase("processing");
      pollUntilDone(result.analysis_id);
    } catch (e) {
      setError(e.response?.data?.detail || "Upload failed. Please check the file and try again.");
      setPhase(null);
    }
  };

  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Run New Analysis</h1>
        <p className="page-sub">
          Upload an Azure VM CPU utilization trace CSV. Detection and cost estimation run on the
          backend with the production Random Forest model.
        </p>
      </div>

      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${file ? "has-file" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
        onClick={() => !file && inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {!file ? (
          <>
            <div className="drop-icon">⬆</div>
            <p><strong>Drag &amp; drop your CSV here</strong> or click to browse</p>
            <p className="muted small">Required columns: {REQUIRED.join(", ")}</p>
          </>
        ) : (
          <div className="file-chip">
            <span className="file">{file.name}</span>
            <span className="muted">{fmtSize(file.size)}</span>
            <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); remove(); }}>Remove</button>
          </div>
        )}
        <input ref={inputRef} type="file" accept=".csv" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>

      {error && <div className="alert alert-error" role="alert">⚠ {error}</div>}

      {phase && (
        <div className="card">
          <div className="progress-label">
            {phase === "uploading" ? `Uploading… ${uploadProgress}%` : `Analyzing… ${jobProgress}%`}
          </div>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${phase === "uploading" ? uploadProgress : jobProgress}%` }} />
          </div>
          {phase === "processing" && (
            <p className="muted small">Large files run in the background — safe to leave this tab, your analysis will still finish.</p>
          )}
        </div>
      )}

      <div className="row-actions">
        <button className="btn btn-primary" disabled={!file || !!phase} onClick={run}>Analyze CSV</button>
        <button className="btn" disabled={!file || !!phase} onClick={remove}>Reset</button>
      </div>

      <div className="card">
        <h3 className="card-title">Supported format</h3>
        <p className="muted small">Comma-separated, one row per 5-minute interval per VM. Example header:</p>
        <pre className="code">{REQUIRED.join(",")}</pre>
        <p className="muted small">Cost values are representative Azure compute estimates — not actual customer billing data.</p>
      </div>
    </div>
  );
}
