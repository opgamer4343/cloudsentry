import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Home.css";

const TO_UPLOAD = { pathname: "/new-analysis" };

function TelemetryChart() {
  return (
    <div className="home-chart-card">
      <svg viewBox="0 0 560 260" width="100%" role="img" aria-label="A VM CPU chart, calm and steady, then spiking sharply and being flagged">
        <defs>
          <linearGradient id="hArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0,178 L28,182 L56,174 L84,180 L112,176 L140,183 L168,177 L196,181 L224,175 L252,180
             L280,176 L308,182 L336,178 L360,150 L380,95 L398,55 L412,40 L426,52 L442,88 L460,132
             L480,162 L505,172 L530,177 L560,175 L560,260 L0,260 Z"
          fill="url(#hArea)" stroke="none"
        />
        <path
          d="M0,178 L28,182 L56,174 L84,180 L112,176 L140,183 L168,177 L196,181 L224,175 L252,180
             L280,176 L308,182 L336,178 L360,150 L380,95"
          fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        />
        <path
          d="M380,95 L398,55 L412,40 L426,52 L442,88"
          fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
        />
        <path
          d="M442,88 L460,132 L480,162 L505,172 L530,177 L560,175"
          fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        />
        <line x1="412" y1="40" x2="412" y2="230" stroke="#232c42" strokeWidth="1" strokeDasharray="3 4" />
        <circle cx="412" cy="40" r="5" fill="#fbbf24" className="home-pulse" />

        <rect x="332" y="8" width="150" height="40" rx="8" fill="#101728" stroke="#232c42" />
        <text x="346" y="24" fill="#eaf0fb" fontSize="12" fontWeight="700">94% CPU · flagged</text>
        <text x="346" y="39" fill="#93a0be" fontSize="10.5">0.91 anomaly probability</text>

        <text x="0" y="248" fill="#93a0be" fontSize="11">00:00</text>
        <text x="270" y="248" fill="#93a0be" fontSize="11">12:00</text>
        <text x="540" y="248" fill="#93a0be" fontSize="11">24:00</text>
      </svg>
      <div className="home-chart-caption">
        <span>vm-worker-014 · avg CPU %</span>
        <span>last 24 hours</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="home-page">
      <nav className="home-nav">
        <div className="home-container">
          <div className="home-brand">☁ Cloudsentrys</div>
          <div className="home-nav-links">
            {isAuthenticated ? (
              <Link to="/dashboard" className="home-btn home-btn-primary">Go to dashboard</Link>
            ) : (
              <>
                <a href="#how-it-works" className="home-muted-link">How it works</a>
                <Link to="/login" state={{ from: TO_UPLOAD }} className="home-muted-link">Log in</Link>
                <Link to="/register" state={{ from: TO_UPLOAD }} className="home-btn home-btn-primary">Get started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <header className="home-hero">
        <div className="home-container home-hero-grid">
          <div>
            <h1>Catch the VM that's about to wreck your cloud bill.</h1>
            <p className="home-sub">
              Cloudsentrys watches your VM CPU telemetry, flags genuine anomalies with a trained
              Random Forest model, and estimates what they're costing you — before the invoice
              arrives.
            </p>
            <div className="home-hero-actions">
              {isAuthenticated ? (
                <>
                  <Link to="/new-analysis" className="home-btn home-btn-primary home-btn-lg">Analyze a new file</Link>
                  <Link to="/dashboard" className="home-btn home-btn-ghost home-btn-lg">Go to dashboard</Link>
                </>
              ) : (
                <>
                  <Link to="/register" state={{ from: TO_UPLOAD }} className="home-btn home-btn-primary home-btn-lg">
                    Create a free account
                  </Link>
                  <Link to="/login" state={{ from: TO_UPLOAD }} className="home-btn home-btn-ghost home-btn-lg">
                    Log in
                  </Link>
                </>
              )}
            </div>
          </div>
          <TelemetryChart />
        </div>
      </header>

      <section className="home-section" id="how-it-works">
        <div className="home-container">
          <h2>Three steps, no infrastructure to set up</h2>
          <p className="home-lede">
            Bring your own CPU telemetry export. Nothing to install or connect first.
          </p>
          <div className="home-steps">
            <div className="home-step">
              <div className="home-step-num">01</div>
              <h3>Upload your CPU telemetry</h3>
              <p>A CSV with timestamp, VM ID, and min/max/avg CPU — one row per VM per interval.</p>
            </div>
            <div className="home-step">
              <div className="home-step-num">02</div>
              <h3>The model scores every reading</h3>
              <p>A Random Forest trained on real Azure workload data flags genuine deviations from each VM's own recent pattern — not just high numbers.</p>
            </div>
            <div className="home-step">
              <div className="home-step-num">03</div>
              <h3>Review cost exposure and act</h3>
              <p>See estimated dollars at risk, tune the detection sensitivity, and mark anomalies resolved as you work through them.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-section">
        <div className="home-container">
          <h2>Built for actually working through anomalies</h2>
          <p className="home-lede">Not just a list of red flags — a workflow for triaging them.</p>
          <div className="home-features-grid">
            <div className="home-feature-main">
              <h3>Per-VM baseline detection</h3>
              <p>
                Every reading is judged against that specific VM's own recent behavior — 14
                engineered signals covering recent lags, rolling volatility, trend, and
                deviation — not a single fleet-wide threshold.
              </p>
              <ul className="home-feature-list">
                <li><strong>Adjustable threshold</strong> — drag a slider to see stricter or looser cutoffs recompute instantly, no retraining.</li>
                <li><strong>Model transparency</strong> — see which of the 14 features actually drive the model's decisions.</li>
                <li><strong>Second opinion</strong> — optionally compare against Gemini's independent read on a sample of rows.</li>
              </ul>
            </div>
            <div className="home-feature-side">
              <div className="home-feature-small">
                <h4>Cost exposure estimate</h4>
                <p>Representative Azure compute pricing by VM profile, broken down by anomaly vs. normal usage.</p>
              </div>
              <div className="home-feature-small">
                <h4>Review workflow</h4>
                <p>Mark each anomaly acknowledged, resolved, or false positive as your team works through it.</p>
              </div>
              <div className="home-feature-small">
                <h4>Full history</h4>
                <p>Every past analysis stays available, with CSV and JSON export.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="home-trust">
        <div className="home-container home-trust-grid">
          <div>
            <h2>Your data stays yours.</h2>
            <p>
              Every analysis is tied to your account and locked down at the API level — not just
              hidden in the interface.
            </p>
          </div>
          <div className="home-trust-check">
            <div className="home-trust-item"><span className="home-check">✓</span> No account can view, export, or edit another account's analyses.</div>
            <div className="home-trust-item"><span className="home-check">✓</span> Passwords are salted and hashed — never stored in plain text.</div>
            <div className="home-trust-item"><span className="home-check">✓</span> Repeated failed logins lock the account for 15 minutes.</div>
            <div className="home-trust-item"><span className="home-check">✓</span> Changing your password signs you out everywhere, including your current session.</div>
          </div>
        </div>
      </section>

      <section className="home-cta">
        <div className="home-container">
          <h2>Upload a CSV, see what it's costing you.</h2>
          <p>Free to create an account. Bring your own telemetry export whenever you're ready.</p>
          {isAuthenticated ? (
            <Link to="/new-analysis" className="home-btn home-btn-primary home-btn-lg">Analyze a new file</Link>
          ) : (
            <Link to="/register" state={{ from: TO_UPLOAD }} className="home-btn home-btn-primary home-btn-lg">
              Create a free account
            </Link>
          )}
        </div>
      </section>

      <footer className="home-footer">
        <div className="home-container home-footer">
          <span>Cloudsentrys — a workload anomaly detector for cloud VMs. Cost figures are representative estimates, not billing data.</span>
          {isAuthenticated && <Link to="/help">Help</Link>}
        </div>
      </footer>
    </div>
  );
}
