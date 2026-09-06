"""Database layer: SQLAlchemy models, engine/session setup, and table creation."""
import os
from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey, create_engine
from sqlalchemy.orm import sessionmaker, declarative_base, relationship

# Defaults to a local SQLite file; set DATABASE_URL to point at Postgres etc.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./cloudsentrys.db")
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()

# A registered account. Owns analyses and auth tokens.
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), nullable=False, unique=True, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(DateTime, nullable=True)
    analyses = relationship("Analysis", back_populates="owner", cascade="all, delete-orphan")
    tokens = relationship("AuthToken", back_populates="user", cascade="all, delete-orphan")

# An opaque bearer token issued at login; deleted on logout/password change/expiry.
class AuthToken(Base):
    __tablename__ = "auth_tokens"
    id = Column(Integer, primary_key=True, index=True)
    token = Column(String(64), nullable=False, unique=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    user = relationship("User", back_populates="tokens")

# One uploaded CSV's analysis run. Processed in the background; status/progress_percent
# track that job so the frontend can poll instead of blocking on one long request.
class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    filename = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    status = Column(String(20), nullable=False, default="processing")  # processing | complete | failed
    progress_percent = Column(Integer, nullable=False, default=0)
    error_message = Column(String(500), nullable=True)
    total_observations = Column(Integer, nullable=False, default=0)
    total_vms = Column(Integer, nullable=False, default=0)
    detected_anomalies = Column(Integer, nullable=False, default=0)
    anomaly_rate = Column(Float, nullable=False, default=0.0)
    total_estimated_cost_usd = Column(Float, nullable=False, default=0.0)
    anomaly_cost_exposure_usd = Column(Float, nullable=False, default=0.0)
    anomaly_cost_percentage = Column(Float, nullable=False, default=0.0)
    owner = relationship("User", back_populates="analyses")
    predictions = relationship("Prediction", back_populates="analysis", cascade="all, delete-orphan")

# One scored CSV row: a VM's reading, the model's verdict, and its estimated cost.
class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, index=True)
    timestamp = Column(Float, nullable=False)
    vm_id = Column(String(255), nullable=False, index=True)
    avg_cpu = Column(Float, nullable=False)
    anomaly_prediction = Column(Integer, nullable=False)
    anomaly_probability = Column(Float, nullable=False)
    status = Column(String(32), nullable=False)
    vm_profile = Column(String(32), nullable=False)
    vm_sku = Column(String(64), nullable=False)
    estimated_cost_usd = Column(Float, nullable=False)
    review_status = Column(String(32), nullable=False, default="new")
    analysis = relationship("Analysis", back_populates="predictions")

# Cached result of comparing the Random Forest against Gemini's second opinion.
class GeminiComparison(Base):
    __tablename__ = "gemini_comparisons"
    id = Column(Integer, primary_key=True, index=True)
    analysis_id = Column(Integer, ForeignKey("analyses.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    model_name = Column(String(100), nullable=False)
    sample_size = Column(Integer, nullable=False)
    rf_anomaly_rate = Column(Float, nullable=False)
    gemini_anomaly_rate = Column(Float, nullable=False)
    agreement_rate = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

# Request-scoped DB session (FastAPI dependency) - closed automatically after each request.
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Creates all tables if they don't exist yet. Called once on app startup.
def init_db():
    Base.metadata.create_all(bind=engine)
