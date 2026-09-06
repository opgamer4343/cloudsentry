export default function Help() {
  return (
    <div className="stack narrow">
      <div className="page-head">
        <h1>Help &amp; About</h1>
        <p className="page-sub">How Cloudsentrys works, what it detects, and what it does not do.</p>
      </div>

      <div className="card">
        <h3 className="card-title">What is Cloudsentrys?</h3>
        <p>
          The system analyzes Azure VM CPU workload patterns and identifies anomalous behavior
          that may represent unusual compute cost exposure. You upload a CPU utilization trace
          (5-minute intervals per VM); the application scores every observation with a trained
          machine learning model and flags anomalies in real time.
        </p>
      </div>

      <div className="card">
        <h3 className="card-title">How anomaly detection works</h3>
        <ol className="help-list">
          <li>Your CSV (<span className="mono">timestamp, vm_id, min_cpu, max_cpu, avg_cpu</span>) is ingested per VM.</li>
          <li>Exactly 14 time-series features are engineered from the current and <em>previous</em> observations only — lag values, rolling statistics (window 12, min_periods 3), trend, acceleration and volatility. No future data is ever used.</li>
          <li>Each observation is scored by the production model against a fixed decision threshold of 0.80.</li>
          <li>Flagged observations are combined with deterministic VM profile assignment to estimate representative cost exposure.</li>
        </ol>
      </div>

      <div className="card">
        <h3 className="card-title">Models used</h3>
        <table className="table">
          <thead><tr><th>Model</th><th>Role</th></tr></thead>
          <tbody>
            <tr><td><strong>Random Forest</strong></td><td>Production model — final anomaly classification (400 trees, entropy criterion, balanced subsampling, threshold 0.80).</td></tr>
            <tr><td>Isolation Forest</td><td>Unsupervised comparative model — isolates rare observations.</td></tr>
            <tr><td>One-Class SVM</td><td>Unsupervised comparative model — learns the boundary of normal behavior.</td></tr>
          </tbody>
        </table>
        <p className="muted small">Trained model artifacts are loaded from <span className="mono">models/</span> via Joblib — the application never retrains at request time.</p>
      </div>

      <div className="card">
        <h3 className="card-title">Cost estimation</h3>
        <p>
          Because the dataset contains CPU telemetry rather than invoices, the application maps
          each VM to a deterministic profile (seed 42) and applies public Azure pay-as-you-go
          rates for the corresponding SKU, multiplied by the 5-minute interval:
        </p>
        <table className="table">
          <thead><tr><th>Profile</th><th>SKU</th><th>vCPU</th><th>Hourly rate</th><th>Per observation</th></tr></thead>
          <tbody>
            <tr><td>Small</td><td>D2 v3</td><td>2</td><td>0.096</td><td>0.096</td><td>0.096</td><td>0.008</td></tr>
            <tr><td>Medium</td><td>D4 v3</td><td>4</td><td>0.192</td><td>0.192</td><td>0.192</td><td>0.016</td></tr>
            <tr><td>Large</td><td>D8 v3</td><td>8</td><td>0.384</td><td>0.384</td><td>0.384</td><td>0.032</td></tr>
          </tbody>
        </table>
        <p className="muted small">Region assumption: East US · Linux/Ubuntu · Pay-as-you-go · USD.</p>
      </div>

      <div className="card callout-warning">
        <h3 className="card-title">Important limitation</h3>
        <p><strong>
          The cost values are representative Azure compute cost estimates and are not actual
          customer billing data. The system does not predict exact customer bills.
        </strong></p>
      </div>
    </div>
  );
}
