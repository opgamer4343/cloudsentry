"""FastAPI app: auth, CSV upload/analysis (run as a background job), history,
exports, and the Gemini second-opinion comparison. See README for the route map."""
import csv, io, json
from contextlib import asynccontextmanager
from datetime import datetime

import pandas as pd
from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from dotenv import load_dotenv
load_dotenv()

from backend import preprocessing, cost_service, gemini_service
from backend.auth import (
    create_token, get_current_user, hash_password, lockout_remaining_seconds,
    register_failed_login, register_successful_login, verify_password,
)
from backend.database import Analysis, AuthToken, GeminiComparison, Prediction, SessionLocal, User, get_db, init_db
from backend.model_service import ModelServiceError, model_service
from backend.schemas import *

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"text/csv", "application/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"}
GEMINI_SAMPLE_SIZE = 60
CHUNK_TARGET = 10  # aim for roughly this many progress updates per analysis job
MODEL_PERFORMANCE_RESULTS = [
    ModelPerformance(model="Isolation Forest", accuracy=.9578, balanced_accuracy=.8854, precision=.5487, recall=.8050, f1_score=.6526, roc_auc=.9705, pr_auc=.5855),
    ModelPerformance(model="One-Class SVM", accuracy=.9638, balanced_accuracy=.8726, precision=.6036, recall=.7714, f1_score=.6773, roc_auc=.8521, pr_auc=.6297),
    ModelPerformance(model="Random Forest", accuracy=.9848, balanced_accuracy=.9096, precision=.8596, recall=.8263, f1_score=.8426, roc_auc=.9865, pr_auc=.9201),
]

# Runs once at startup: creates tables if needed and loads the trained model into memory.
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    try:
        model_service.load()
        print("Model loaded successfully.")
    except ModelServiceError as exc:
        print(f"WARNING: {exc}")
    yield

app = FastAPI(title="Cloudsentrys API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173", "http://127.0.0.1:4173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- Helpers ----------------

# Fetches an analysis and 404s (not 403) if it doesn't belong to this user -
# so a guess at another account's ID can't even confirm the ID exists.
def require_analysis(analysis_id: int, db: Session, user: User) -> Analysis:
    a = db.get(Analysis, analysis_id)
    if not a or a.user_id != user.id:
        raise HTTPException(404, "Analysis not found.")
    return a

# Same as above, but also blocks actions that only make sense on a finished job.
def require_complete_analysis(analysis_id: int, db: Session, user: User) -> Analysis:
    a = require_analysis(analysis_id, db, user)
    if a.status != "complete":
        raise HTTPException(409, f"Analysis is still {a.status}. Wait for it to finish first.")
    return a

# Validates and parses an uploaded file into a DataFrame before any real work starts.
def read_csv(file: UploadFile) -> pd.DataFrame:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted.")
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(400, "Unsupported file type. Please upload a CSV.")
    data = file.file.read()
    if not data:
        raise HTTPException(400, "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the 100 MB upload limit.")
    try:
        df = pd.read_csv(io.BytesIO(data))
    except Exception:
        raise HTTPException(400, "The file could not be parsed as a CSV.")
    if df.empty:
        raise HTTPException(400, "The CSV contains no data rows.")
    return df

# Recomputes an analysis's full detail view (summary, anomaly list, cost breakdown)
# straight from its stored predictions, at whatever threshold is requested. Also
# doubles as a live partial view while a job is still processing.
def history_detail(a: Analysis, db: Session, threshold: float | None = None) -> AnalysisHistoryResponse:
    rows = db.query(Prediction).filter(Prediction.analysis_id == a.id).all()
    applied_threshold = threshold if threshold is not None else model_service.threshold
    by = {}
    anomalies = []
    detected = 0
    anomaly_cost_exposure = 0.0
    total_cost = 0.0
    for r in rows:
        is_anom = r.anomaly_probability >= applied_threshold
        total_cost += r.estimated_cost_usd
        d = by.setdefault(r.vm_profile, {"total": 0.0, "anomaly": 0.0, "obs": 0, "anomalies": 0, "sku": r.vm_sku})
        d["total"] += r.estimated_cost_usd
        d["obs"] += 1
        if is_anom:
            d["anomaly"] += r.estimated_cost_usd
            d["anomalies"] += 1
            detected += 1
            anomaly_cost_exposure += r.estimated_cost_usd
            anomalies.append(AnomalyResult(
                id=r.id, timestamp=r.timestamp, vm_id=r.vm_id, vm_profile=r.vm_profile, vm_sku=r.vm_sku,
                avg_cpu=r.avg_cpu, anomaly_probability=r.anomaly_probability, anomaly_prediction=1,
                status="anomaly", estimated_cost_usd=r.estimated_cost_usd, review_status=r.review_status,
            ))
    anomalies.sort(key=lambda x: x.anomaly_probability, reverse=True)
    profiles = [
        CostProfileSummary(
            vm_profile=k, vm_sku=v["sku"], total_cost_usd=round(v["total"], 4),
            anomaly_cost_usd=round(v["anomaly"], 4), observations=v["obs"], anomalies=v["anomalies"],
            anomaly_cost_percentage=round(v["anomaly"] / v["total"] * 100 if v["total"] else 0, 2),
        )
        for k, v in by.items()
    ]
    total_obs = len(rows)
    summary = AnalysisSummary(
        total_observations=total_obs, total_vms=a.total_vms, detected_anomalies=detected,
        anomaly_rate=round(detected / total_obs * 100, 2) if total_obs else 0.0,
        total_estimated_cost_usd=round(total_cost, 4),
        anomaly_cost_exposure_usd=round(anomaly_cost_exposure, 4),
        anomaly_cost_percentage=round(anomaly_cost_exposure / total_cost * 100, 2) if total_cost else 0.0,
    )
    return AnalysisHistoryResponse(
        analysis_id=a.id, filename=a.filename, created_at=a.created_at,
        status=a.status, progress_percent=a.progress_percent, error_message=a.error_message,
        summary=summary, anomalies=anomalies, cost_by_profile=profiles,
        cost_assumptions=CostAssumptions(**cost_service.COST_ASSUMPTIONS),
        default_threshold=model_service.threshold, applied_threshold=applied_threshold,
    )

# Reconstructs a per-VM recent-baseline context for a random sample of rows,
# so Gemini has something comparable to what the trained model sees.
def build_gemini_sample(analysis_id: int, db: Session):
    rows = db.query(Prediction).filter(Prediction.analysis_id == analysis_id).all()
    if not rows:
        return [], []
    df = pd.DataFrame([
        {"vm_id": r.vm_id, "timestamp": r.timestamp, "avg_cpu": r.avg_cpu, "rf_anomaly": r.anomaly_prediction}
        for r in rows
    ]).sort_values(["vm_id", "timestamp"]).reset_index(drop=True)

    shifted = df.groupby("vm_id")["avg_cpu"].shift(1)
    grouped_shift = shifted.groupby(df["vm_id"])
    df["recent_avg"] = grouped_shift.rolling(12, min_periods=3).mean().reset_index(level=0, drop=True)
    df["recent_std"] = grouped_shift.rolling(12, min_periods=3).std().reset_index(level=0, drop=True)
    df["recent_avg"] = df["recent_avg"].fillna(df["avg_cpu"])
    df["recent_std"] = df["recent_std"].fillna(0.0)
    df["deviation"] = df["avg_cpu"] - df["recent_avg"]

    n = min(GEMINI_SAMPLE_SIZE, len(df))
    sample = df.sample(n=n, random_state=42).reset_index(drop=True)
    payload = [
        {
            "index": i, "vm_id": str(r.vm_id), "avg_cpu": round(float(r.avg_cpu), 2),
            "recent_avg": round(float(r.recent_avg), 2), "recent_std": round(float(r.recent_std), 2),
            "deviation": round(float(r.deviation), 2),
        }
        for i, r in enumerate(sample.itertuples())
    ]
    rf_flags = [bool(v) for v in sample["rf_anomaly"].astype(int).tolist()]
    return payload, rf_flags

# ---------------- Background analysis job ----------------

# The actual work of /analyze, run AFTER the request already returned. Processes
# one batch of VMs at a time - feature-engineer, score, cost, bulk-insert, commit,
# update progress - so a huge file can't time out the request or block other users,
# and the frontend has a real percentage to show instead of an indefinite spinner.
# Uses its own DB session since the request's session is long gone by the time
# this runs.
def process_analysis_job(analysis_id: int, raw: pd.DataFrame):
    db = SessionLocal()
    try:
        a = db.get(Analysis, analysis_id)
        if not a:
            return

        vm_ids = raw["vm_id"].unique().tolist()
        chunk_size = max(1, -(-len(vm_ids) // CHUNK_TARGET))  # ceil division
        chunks = [vm_ids[i:i + chunk_size] for i in range(0, len(vm_ids), chunk_size)]

        total_obs = anomalies_count = 0
        total_cost = anomaly_cost = 0.0

        for i, vm_chunk in enumerate(chunks):
            subset = raw[raw["vm_id"].isin(vm_chunk)]
            features = preprocessing.run_pipeline(subset).dropna(subset=model_service.feature_list)
            if not features.empty:
                predicted = model_service.predict(features)
                enriched = cost_service.calculate_estimated_cost(predicted)
                db.bulk_insert_mappings(Prediction, [
                    {
                        "analysis_id": analysis_id, "timestamp": float(r.timestamp), "vm_id": str(r.vm_id),
                        "avg_cpu": float(r.avg_cpu), "anomaly_prediction": int(r.anomaly_prediction),
                        "anomaly_probability": float(r.anomaly_probability), "status": str(r.status),
                        "vm_profile": str(r.vm_profile), "vm_sku": str(r.vm_sku),
                        "estimated_cost_usd": float(r.estimated_cost_usd), "review_status": "new",
                    }
                    for r in enriched.itertuples(index=False)
                ])
                total_obs += len(enriched)
                anomalies_count += int(enriched["anomaly_prediction"].sum())
                total_cost += float(enriched["estimated_cost_usd"].sum())
                anomaly_cost += float(enriched.loc[enriched.anomaly_prediction == 1, "estimated_cost_usd"].sum())

            a.progress_percent = round((i + 1) / len(chunks) * 100)
            db.commit()

        if total_obs == 0:
            raise preprocessing.DataValidationError("Not enough observations per VM to build ML features.")

        a.status = "complete"
        a.progress_percent = 100
        a.total_observations = total_obs
        a.total_vms = len(vm_ids)
        a.detected_anomalies = anomalies_count
        a.anomaly_rate = round(anomalies_count / total_obs * 100, 2)
        a.total_estimated_cost_usd = round(total_cost, 4)
        a.anomaly_cost_exposure_usd = round(anomaly_cost, 4)
        a.anomaly_cost_percentage = round(anomaly_cost / total_cost * 100, 2) if total_cost else 0.0
        db.commit()
    except preprocessing.DataValidationError as exc:
        db.rollback()
        a = db.get(Analysis, analysis_id)
        if a:
            a.status, a.error_message = "failed", str(exc)[:500]
            db.commit()
    except Exception as exc:  # model/cost errors, or anything unexpected
        db.rollback()
        a = db.get(Analysis, analysis_id)
        if a:
            a.status, a.error_message = "failed", f"Unexpected error: {exc}"[:500]
            db.commit()
    finally:
        db.close()

# ---------------- Auth ----------------

# Creates an account. Emails are stored lowercased so lookups are case-insensitive.
@app.post("/auth/register", response_model=UserOut, status_code=201)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.query(User).filter(func.lower(User.email) == email).first():
        raise HTTPException(409, "An account with this email already exists.")
    user = User(name=body.name.strip(), email=email, password_hash=hash_password(body.password), created_at=datetime.utcnow())
    db.add(user)
    db.commit()
    db.refresh(user)
    return user

# Verifies credentials and issues a bearer token. Locks the account for a
# while after too many failed attempts (see backend/auth.py).
@app.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if not user:
        raise HTTPException(401, "Incorrect email or password.")

    remaining = lockout_remaining_seconds(user)
    if remaining > 0:
        minutes = max(1, remaining // 60)
        raise HTTPException(429, f"Too many failed login attempts. Try again in {minutes} minute(s).")

    if not verify_password(body.password, user.password_hash):
        register_failed_login(db, user)
        raise HTTPException(401, "Incorrect email or password.")

    register_successful_login(db, user)
    token = create_token(db, user)
    db.commit()
    return TokenResponse(access_token=token.token, user=user)

# Returns the current user - used by the frontend to validate a stored token on load.
@app.get("/auth/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user

# Changes the password and revokes every session (including this one) as a
# precaution, so the user has to log back in everywhere.
@app.post("/auth/change-password", status_code=204)
def change_password(body: ChangePasswordRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(401, "Current password is incorrect.")
    current_user.password_hash = hash_password(body.new_password)
    db.add(current_user)
    db.query(AuthToken).filter(AuthToken.user_id == current_user.id).delete()
    db.commit()
    return None

# Deletes all of this user's bearer tokens, logging them out everywhere.
@app.post("/auth/logout", status_code=204)
def logout(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(AuthToken).filter(AuthToken.user_id == current_user.id).delete()
    db.commit()
    return None

# ---------------- Health / model info (public) ----------------

# Simple liveness check - also reports whether the trained model actually loaded.
@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(
        status="ok" if model_service.is_loaded else "degraded",
        message="API is running and model is loaded." if model_service.is_loaded else "API is running, but model artifacts are missing.",
        model_loaded=model_service.is_loaded,
    )

# Static reference metrics comparing the three candidate models evaluated offline.
@app.get("/model-performance", response_model=list[ModelPerformance])
def model_performance():
    return MODEL_PERFORMANCE_RESULTS

# Global feature importances straight from the trained Random Forest.
@app.get("/model-feature-importance", response_model=list[FeatureImportance])
def model_feature_importance():
    if not model_service.is_loaded:
        raise HTTPException(503, "Model is unavailable.")
    return model_service.feature_importances()

# ---------------- Analysis (protected) ----------------

# Accepts a CSV, does fast validation inline, then hands the actual scoring off
# to a background job and returns immediately (202) with the analysis id.
# Poll GET /analyses/{id}/status for progress instead of waiting on this call.
@app.post("/analyze", response_model=AnalysisSubmitted, status_code=202)
def analyze(background_tasks: BackgroundTasks, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not model_service.is_loaded:
        raise HTTPException(503, "Model is unavailable. Place the trained .pkl files in models/ and restart the API.")
    raw = read_csv(file)
    if "vm_id" not in raw.columns:
        raise HTTPException(400, "Missing required column: vm_id")

    a = Analysis(
        user_id=current_user.id, filename=(file.filename or "upload.csv")[:255], created_at=datetime.utcnow(),
        status="processing", progress_percent=0, total_vms=int(raw["vm_id"].nunique()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)

    background_tasks.add_task(process_analysis_job, a.id, raw)
    return AnalysisSubmitted(analysis_id=a.id, status="processing", progress_percent=0)

# Lightweight poll target for the frontend while a job is running.
@app.get("/analyses/{analysis_id}/status", response_model=AnalysisStatus)
def get_analysis_status(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = require_analysis(analysis_id, db, current_user)
    return AnalysisStatus(analysis_id=a.id, status=a.status, progress_percent=a.progress_percent, error_message=a.error_message)

# Fast summary using the analysis's own stored totals (no per-row recompute).
@app.get("/summary", response_model=AnalysisSummary)
def summary(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    a = require_analysis(analysis_id, db, current_user)
    return AnalysisSummary(total_observations=a.total_observations, total_vms=a.total_vms, detected_anomalies=a.detected_anomalies, anomaly_rate=a.anomaly_rate, total_estimated_cost_usd=a.total_estimated_cost_usd, anomaly_cost_exposure_usd=a.anomaly_cost_exposure_usd, anomaly_cost_percentage=a.anomaly_cost_percentage)

# All flagged rows for one analysis, most confident first.
@app.get("/anomalies", response_model=list[AnomalyResult])
def anomalies(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_analysis(analysis_id, db, current_user)
    rows = db.query(Prediction).filter(Prediction.analysis_id == analysis_id, Prediction.anomaly_prediction == 1).order_by(Prediction.anomaly_probability.desc()).all()
    return [AnomalyResult.model_validate(r, from_attributes=True) for r in rows]

# Marks one anomaly as acknowledged / resolved / false positive / new.
@app.patch("/analyses/{analysis_id}/anomalies/{prediction_id}/status", response_model=AnomalyResult)
def update_anomaly_status(analysis_id: int, prediction_id: int, body: AnomalyStatusUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_analysis(analysis_id, db, current_user)
    row = db.query(Prediction).filter(Prediction.id == prediction_id, Prediction.analysis_id == analysis_id).first()
    if not row:
        raise HTTPException(404, "Anomaly not found.")
    row.review_status = body.status
    db.add(row)
    db.commit()
    db.refresh(row)
    return AnomalyResult.model_validate(row, from_attributes=True)

# Per-timestamp anomaly vs. normal counts, for the timeline chart.
@app.get("/timeline", response_model=TimelineResponse)
def timeline(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_analysis(analysis_id, db, current_user)
    rows = db.query(Prediction.timestamp, func.sum(Prediction.anomaly_prediction).label("anom"), func.count(Prediction.id).label("total")).filter(Prediction.analysis_id == analysis_id).group_by(Prediction.timestamp).order_by(Prediction.timestamp).all()
    return TimelineResponse(analysis_id=analysis_id, timeline=[TimelinePoint(timestamp=float(ts), anomaly_count=int(anom or 0), normal_count=int(total - (anom or 0)), total_count=int(total)) for ts, anom, total in rows])

# Ad-hoc cost analytics computed from the raw prediction rows.
@app.get("/cost-analysis")
def cost_analysis(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_analysis(analysis_id, db, current_user)
    rows = db.query(Prediction).filter(Prediction.analysis_id == analysis_id).all()
    df = pd.DataFrame([{"vm_id": r.vm_id, "vm_profile": r.vm_profile, "anomaly_prediction": r.anomaly_prediction, "anomaly_probability": r.anomaly_probability, "estimated_cost_usd": r.estimated_cost_usd} for r in rows])
    return cost_service.calculate_cost_analytics(df)

# This user's past analyses, newest first - including ones still processing.
@app.get("/analyses", response_model=list[AnalysisHistoryItem])
def analyses(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Analysis).filter(Analysis.user_id == current_user.id).order_by(Analysis.created_at.desc()).all()
    return [
        AnalysisHistoryItem(analysis_id=a.id, filename=a.filename, created_at=a.created_at, status=a.status, progress_percent=a.progress_percent, total_records=a.total_observations, anomaly_count=a.detected_anomalies, anomaly_rate=a.anomaly_rate, total_estimated_cost_usd=a.total_estimated_cost_usd, anomaly_cost_exposure_usd=a.anomaly_cost_exposure_usd)
        for a in rows
    ]

# Full detail view, optionally recomputed at a custom detection threshold.
@app.get("/analyses/{analysis_id}", response_model=AnalysisHistoryResponse)
def get_analysis(analysis_id: int, threshold: float | None = Query(default=None, ge=0, le=1), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return history_detail(require_analysis(analysis_id, db, current_user), db, threshold)

# Downloads every scored row as CSV. Only available once the job has finished.
@app.get("/analyses/{analysis_id}/export")
def export_analysis(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_complete_analysis(analysis_id, db, current_user)
    rows = db.query(Prediction).filter(Prediction.analysis_id == analysis_id).order_by(Prediction.timestamp, Prediction.vm_id).all()
    buf = io.StringIO()
    fields = ["timestamp", "vm_id", "avg_cpu", "anomaly_probability", "prediction", "status", "vm_profile", "vm_sku", "estimated_cost_usd", "anomaly_cost_usd", "review_status"]
    w = csv.DictWriter(buf, fieldnames=fields)
    w.writeheader()
    for p in rows:
        w.writerow({"timestamp": p.timestamp, "vm_id": p.vm_id, "avg_cpu": p.avg_cpu, "anomaly_probability": p.anomaly_probability, "prediction": p.anomaly_prediction, "status": p.status, "vm_profile": p.vm_profile, "vm_sku": p.vm_sku, "estimated_cost_usd": p.estimated_cost_usd, "anomaly_cost_usd": p.estimated_cost_usd if p.anomaly_prediction else 0, "review_status": p.review_status})
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="cloudsentrys_analysis_{analysis_id}.csv"'})

# Downloads the full summary (KPIs, anomalies, cost breakdown) as JSON.
@app.get("/analyses/{analysis_id}/summary-export")
def export_summary(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    data = history_detail(require_complete_analysis(analysis_id, db, current_user), db).model_dump(mode="json")
    return StreamingResponse(iter([json.dumps(data, indent=2)]), media_type="application/json", headers={"Content-Disposition": f'attachment; filename="cloudsentrys_summary_{analysis_id}.json"'})

# ---------------- Gemini second-opinion comparison ----------------
# This measures AGREEMENT between the trained Random Forest and Gemini's
# independent judgment on the same sample of rows. It is not a ground-truth
# accuracy check - only real labeled anomalies could tell you which model
# is actually correct.

# Samples rows, asks Gemini to independently classify them, and stores the
# agreement rate against the Random Forest's own calls on the same sample.
@app.post("/analyses/{analysis_id}/gemini-comparison", response_model=GeminiComparisonResult)
def compare_with_gemini(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_complete_analysis(analysis_id, db, current_user)
    if not gemini_service.is_configured():
        raise HTTPException(503, "Gemini isn't configured. Set GEMINI_API_KEY in the backend .env file and restart the API.")

    payload, rf_flags = build_gemini_sample(analysis_id, db)
    if not payload:
        raise HTTPException(400, "No data available to compare.")

    try:
        gemini_flags_by_index = gemini_service.classify_rows(payload)
    except gemini_service.GeminiServiceError as exc:
        raise HTTPException(502, str(exc))

    n = len(payload)
    gemini_flags = [gemini_flags_by_index.get(row["index"], False) for row in payload]
    agreement = sum(1 for a, b in zip(rf_flags, gemini_flags) if a == b) / n
    rf_rate = sum(rf_flags) / n * 100
    gemini_rate = sum(gemini_flags) / n * 100

    db.query(GeminiComparison).filter(GeminiComparison.analysis_id == analysis_id).delete()
    row = GeminiComparison(
        analysis_id=analysis_id, model_name=gemini_service.get_model_name(), sample_size=n,
        rf_anomaly_rate=round(rf_rate, 2), gemini_anomaly_rate=round(gemini_rate, 2),
        agreement_rate=round(agreement * 100, 2), created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row

# Returns the cached comparison for an analysis, if one has been run.
@app.get("/analyses/{analysis_id}/gemini-comparison", response_model=GeminiComparisonResult)
def get_gemini_comparison(analysis_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    require_analysis(analysis_id, db, current_user)
    row = db.query(GeminiComparison).filter(GeminiComparison.analysis_id == analysis_id).first()
    if not row:
        raise HTTPException(404, "No Gemini comparison has been run for this analysis yet.")
    return row
