# Cloudsentrys

A full-stack app that detects unusual Azure VM CPU workload patterns with a trained Random
Forest model and estimates representative Azure compute cost exposure. Includes user accounts
(register/login), a dashboard, upload & analyze, per-analysis detail views, history, and CSV/JSON
export — all backed by a real database.

**Scope note:** the underlying dataset (Azure Public Dataset) contains CPU telemetry, not actual
customer invoices or billing meters. The app reports workload anomalies and *representative*
compute-cost exposure, not exact customer bills.

## Features
- **Accounts & isolation** — register/login required for every analysis route; each account can
  only ever see, export, or modify its own analyses (enforced server-side, not just hidden in the UI)
- **Public home page** — the marketing/landing page is open to everyone; only actually running an
  analysis requires an account. Already logged in? `/`, `/login`, `/register` bounce you straight
  to the dashboard instead of showing the forms again.
- **Background job processing** — uploads are scored in the background in per-VM chunks, so the
  request returns in milliseconds regardless of file size, and the frontend polls for real
  progress instead of showing an indefinite spinner. Safe to close the tab; check back in History.
- **Login lockout** — 5 failed login attempts locks the account for 15 minutes
- **Change password** — from Settings; revokes all active sessions on change, including the
  current one, so you have to sign back in
- **Adjustable detection threshold** — a slider on each analysis recomputes anomalies/costs
  live from stored probabilities (no retraining) to see how a stricter or looser cutoff changes results
- **Anomaly review workflow** — mark any flagged row as acknowledged / resolved / false positive,
  filterable in the table
- **Model transparency** — a chart of which of the 14 engineered features actually drive the
  Random Forest's decisions, pulled straight from the trained model
- **Gemini second-opinion comparison** — see below

## Stack
- **Backend:** FastAPI + SQLAlchemy + SQLite (swappable for Postgres), token-based auth,
  background job processing via FastAPI `BackgroundTasks`
- **Frontend:** React + Vite + React Router + Recharts + Axios, route-level code splitting
- **ML:** scikit-learn Random Forest (pre-trained artifacts in `models/`)

## Option A: Docker Compose (fastest)

```bash
docker compose up --build
```

Open `http://localhost:5173`. The backend runs at `http://localhost:8000` with its database in a
named Docker volume, so data survives container restarts. Set `GEMINI_API_KEY` in your shell
environment first if you want the Gemini comparison feature enabled.

## Option B: Run natively

### 1. Backend setup

From the project root:

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload
```

The API runs at `http://127.0.0.1:8000`. Interactive docs: `http://127.0.0.1:8000/docs`.

The database (SQLite by default, file `cloudsentrys.db`) and its tables are created
automatically on first startup — no manual migration step needed. To use Postgres instead, set
`DATABASE_URL` in `.env` (e.g. `postgresql://user:pass@host/dbname`) before starting the server.

The trained model files must be present in `models/` (already included):
- `random_forest_final.pkl`
- `feature_list_final.pkl`
- `rf_threshold_final.pkl`

If they're missing, the API still starts but `/analyze` returns a 503 until they're added.

### Optional: Gemini second-opinion comparison

Each analysis detail page has a "Compare with Gemini" button. It sends a random sample of rows
to Google's Gemini API and gets its own independent anomaly judgment, then shows the agreement
rate alongside both models' anomaly rates. **This measures agreement, not accuracy** — an LLM's
opinion isn't ground truth, so it tells you how much the two models agree, not which one is
"more correct."

To enable it:
1. Get a free key at [aistudio.google.com](https://aistudio.google.com) → "Get API key"
2. Add it to `.env`: `GEMINI_API_KEY=your_key_here`
3. Restart the backend

Without a key, the button still shows but returns a clear "not configured" message — the rest
of the app is unaffected.

### 2. Frontend setup

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. It talks to the API at the URL in `frontend/.env`
(`VITE_API_BASE_URL`, defaults to `http://127.0.0.1:8000`).

## Using the app

1. Open `http://localhost:5173` → you'll land on the public **Home** page (no login needed to
   look around).
2. Click **Get Started** → create an account → sign in. You're taken straight to the file upload
   screen, not a generic dashboard, since that's what you came to do.
3. Upload a CSV with columns: `timestamp, vm_id, min_cpu, max_cpu, avg_cpu` (one row per VM per
   5-minute interval). The upload returns almost instantly; a progress bar tracks the actual
   background scoring job until it's done.
4. View KPIs, anomaly distribution, cost-by-profile, and a timeline on the **Dashboard** and the
   analysis detail page. Export results as CSV or JSON. Past runs are listed under **History** —
   each account only ever sees its own analyses, including ones still processing.

## Project layout

```
backend/
  main.py             API routes (auth, analyze, history, exports) + the background job
  auth.py             Password hashing + bearer-token session auth
  database.py         SQLAlchemy models (User, AuthToken, Analysis, Prediction, GeminiComparison)
  schemas.py          Pydantic request/response models
  preprocessing.py    CSV validation + feature engineering
  model_service.py    Loads and runs the trained Random Forest model
  cost_service.py     Representative Azure cost estimation
  gemini_service.py   Gemini API client for the second-opinion comparison
  Dockerfile
frontend/
  src/pages/          Home, Login, Register, Dashboard, NewAnalysis, AnalysisDetails, History,
                       Profile, Settings, Help (all but Home/Login/Register are lazy-loaded)
  src/components/      AppLayout, RequireAuth, GuestOnly, ErrorBoundary, KpiCard
  src/context/        AuthContext (session state)
  src/api.js          Axios client + all API calls
  Dockerfile, nginx.conf
models/               Trained model artifacts (.pkl)
docker-compose.yml
```

## Notes
- Auth uses opaque bearer tokens stored server-side (`auth_tokens` table), 30-day expiry,
  PBKDF2-SHA256 password hashing — no third-party auth service required.
- `.env` / `frontend/.env` are pre-filled with working local defaults; edit if you change ports
  or switch databases.
- Large uploads are processed in the background in chunks of VMs (not chunks of rows) since each
  VM's engineered features only ever depend on that VM's own history — chunking this way changes
  nothing about the results, just how progress is reported.

