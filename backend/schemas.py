"""Pydantic request/response models for the API. Grouped by feature area below."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, EmailStr

# ---------------- Auth ----------------

# Public-safe view of a user (never includes the password hash).
class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    email: str
    created_at: datetime

class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)

# ---------------- Health / model info ----------------

class HealthResponse(BaseModel):
    status: str
    message: str
    model_loaded: bool = False

class ModelPerformance(BaseModel):
    model: str
    accuracy: float = Field(..., ge=0, le=1)
    balanced_accuracy: float = Field(..., ge=0, le=1)
    precision: float = Field(..., ge=0, le=1)
    recall: float = Field(..., ge=0, le=1)
    f1_score: float = Field(..., ge=0, le=1)
    roc_auc: float = Field(..., ge=0, le=1)
    pr_auc: float = Field(..., ge=0, le=1)

class FeatureImportance(BaseModel):
    feature: str
    importance: float

# ---------------- Analysis results ----------------

class AnalysisSummary(BaseModel):
    total_observations: int = Field(..., ge=0)
    total_vms: int = Field(..., ge=0)
    detected_anomalies: int = Field(..., ge=0)
    anomaly_rate: float = Field(..., ge=0, le=100)
    total_estimated_cost_usd: float = Field(..., ge=0)
    anomaly_cost_exposure_usd: float = Field(..., ge=0)
    anomaly_cost_percentage: float = Field(..., ge=0, le=100)

class AnomalyResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int | None = None
    timestamp: float
    vm_id: str
    vm_profile: str
    vm_sku: str
    avg_cpu: float
    anomaly_probability: float = Field(..., ge=0, le=1)
    anomaly_prediction: int = Field(..., ge=0, le=1)
    status: str
    estimated_cost_usd: float = Field(..., ge=0)
    review_status: str = "new"

class AnomalyStatusUpdate(BaseModel):
    status: Literal["new", "acknowledged", "resolved", "false_positive"]

class CostProfileSummary(BaseModel):
    vm_profile: str
    vm_sku: str
    total_cost_usd: float = Field(..., ge=0)
    anomaly_cost_usd: float = Field(..., ge=0)
    observations: int = Field(..., ge=0)
    anomalies: int = Field(..., ge=0)
    anomaly_cost_percentage: float = Field(..., ge=0, le=100)

class CostAssumptions(BaseModel):
    provider: str
    region: str
    os: str
    pricing_model: str
    currency: str
    interval_minutes: int
    note: str

# ---------------- Background job lifecycle ----------------

# Returned immediately by POST /analyze - the job has been accepted, not finished.
class AnalysisSubmitted(BaseModel):
    analysis_id: int
    status: Literal["processing"] = "processing"
    progress_percent: int = 0

# Lightweight - what the frontend polls every second or two while a job runs.
class AnalysisStatus(BaseModel):
    analysis_id: int
    status: Literal["processing", "complete", "failed"]
    progress_percent: int = Field(..., ge=0, le=100)
    error_message: str | None = None

class AnalysisResponse(BaseModel):
    analysis_id: int | None = None
    summary: AnalysisSummary
    anomalies: list[AnomalyResult] = []
    cost_by_profile: list[CostProfileSummary] = []
    cost_assumptions: CostAssumptions | None = None

class TimelinePoint(BaseModel):
    timestamp: float
    anomaly_count: int
    normal_count: int
    total_count: int

class TimelineResponse(BaseModel):
    analysis_id: int
    timeline: list[TimelinePoint]

# Row shown in the History list - one per past upload, including in-progress ones.
class AnalysisHistoryItem(BaseModel):
    analysis_id: int
    filename: str | None = None
    created_at: datetime
    status: str = "complete"
    progress_percent: int = 100
    total_records: int
    anomaly_count: int
    anomaly_rate: float
    total_estimated_cost_usd: float
    anomaly_cost_exposure_usd: float

# Full detail view for one analysis, with results recomputed at whatever
# threshold was requested (default_threshold if none was given).
class AnalysisHistoryResponse(BaseModel):
    analysis_id: int
    filename: str | None = None
    created_at: datetime
    status: str = "complete"
    progress_percent: int = 100
    error_message: str | None = None
    summary: AnalysisSummary
    anomalies: list[AnomalyResult] = []
    cost_by_profile: list[CostProfileSummary] = []
    cost_assumptions: CostAssumptions | None = None
    default_threshold: float = Field(0.80, ge=0, le=1)
    applied_threshold: float = Field(0.80, ge=0, le=1)

# ---------------- Gemini second-opinion comparison ----------------

class GeminiComparisonResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    analysis_id: int
    model_name: str
    sample_size: int
    rf_anomaly_rate: float
    gemini_anomaly_rate: float
    agreement_rate: float
    created_at: datetime
