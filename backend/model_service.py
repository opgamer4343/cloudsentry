"""Loads the pre-trained Random Forest artifacts and scores feature rows with them."""
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

MODEL_DIR = Path(__file__).resolve().parent.parent / "models"
class ModelServiceError(Exception): pass

# Wraps the trained model, its feature list, and its decision threshold.
# A single shared instance (model_service, below) is loaded once at startup.
class ModelService:
    def __init__(self):
        self.model=None; self.feature_list=None; self.threshold=0.80; self.is_loaded=False
    # Loads the three .pkl artifacts from models/ and sanity-checks their shape.
    def load(self):
        paths=[MODEL_DIR/"random_forest_final.pkl", MODEL_DIR/"feature_list_final.pkl", MODEL_DIR/"rf_threshold_final.pkl"]
        if not all(p.exists() for p in paths):
            self.is_loaded=False
            raise ModelServiceError("Required model files are missing from models/.")
        try:
            self.model=joblib.load(paths[0]); self.feature_list=joblib.load(paths[1]); self.threshold=float(joblib.load(paths[2]))
            if not isinstance(self.feature_list,(list,tuple)) or len(self.feature_list)!=14: raise ModelServiceError("feature_list_final.pkl must contain 14 feature names.")
            if not 0 <= self.threshold <= 1: raise ModelServiceError("rf_threshold_final.pkl must contain a value between 0 and 1.")
            self.is_loaded=True
        except ModelServiceError: raise
        except Exception as exc: self.is_loaded=False; raise ModelServiceError(f"Could not load model artifacts: {exc}") from exc
    # Scores a feature DataFrame: adds anomaly_probability, anomaly_prediction, status columns.
    def predict(self, df):
        if not self.is_loaded: raise ModelServiceError("Model is not loaded.")
        missing=[c for c in self.feature_list if c not in df.columns]
        if missing: raise ModelServiceError("Missing model feature(s): " + ", ".join(missing))
        X=df[self.feature_list].astype(float)
        try: probs=self.model.predict_proba(X)[:,1]
        except Exception as exc: raise ModelServiceError(f"Model prediction failed: {exc}") from exc
        probs=np.clip(probs,0,1); pred=(probs>=self.threshold).astype(int)
        out=df.copy(); out["anomaly_probability"]=probs; out["anomaly_prediction"]=pred; out["status"]=np.where(pred==1,"anomaly","normal")
        return out
    def feature_importances(self):
        """Global feature importances from the trained Random Forest (not per-row)."""
        if not self.is_loaded:
            raise ModelServiceError("Model is not loaded.")
        importances = self.model.feature_importances_
        pairs = sorted(zip(self.feature_list, importances), key=lambda p: p[1], reverse=True)
        return [{"feature": f, "importance": round(float(v), 4)} for f, v in pairs]
model_service=ModelService()  # shared singleton, loaded once in main.py's lifespan hook
