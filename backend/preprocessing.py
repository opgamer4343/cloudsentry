"""CSV validation and the 14-feature engineering pipeline fed to the model.
Every feature is computed per-VM from that VM's own recent history only."""
import pandas as pd
REQUIRED_COLUMNS = ["timestamp", "vm_id", "min_cpu", "max_cpu", "avg_cpu"]
NUMERIC_COLUMNS = ["timestamp", "min_cpu", "max_cpu", "avg_cpu"]
ML_FEATURES = ["cpu_lag_1","cpu_lag_2","cpu_lag_3","cpu_change_1","cpu_change_2","rolling_mean","rolling_std","rolling_max","rolling_min","rolling_range","rolling_deviation","cpu_trend","cpu_acceleration","rolling_cv"]
ROLLING_WINDOW = 12
ROLLING_MIN_PERIODS = 3
class DataValidationError(Exception): pass

# Fails fast with a clear message if the upload is missing a required column.
def validate_columns(df):
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing: raise DataValidationError("Uploaded CSV is missing required column(s): " + ", ".join(missing) + ".")

# Drops blank VM IDs, coerces numeric columns, and drops negative/unparseable rows.
def clean_data(df):
    df=df.copy()
    if "vm_id" not in df: return df
    df["vm_id"] = df["vm_id"].astype(str).str.strip()
    df = df[df["vm_id"].ne("")]
    for c in NUMERIC_COLUMNS: df[c]=pd.to_numeric(df[c], errors="coerce")
    df=df.dropna(subset=NUMERIC_COLUMNS)
    df=df[(df.min_cpu>=0)&(df.max_cpu>=0)&(df.avg_cpu>=0)]
    return df.reset_index(drop=True)

# Builds the 14 ML features per VM: recent lags, rolling stats (computed only
# from *past* readings so the current row can't leak into its own baseline),
# deviation from that baseline, trend, and volatility.
def engineer_features(df):
    df=df.copy(); g=df.groupby("vm_id", sort=False)["avg_cpu"]
    p1=g.shift(1); p2=g.shift(2); p3=g.shift(3)
    df["cpu_lag_1"]=p1; df["cpu_lag_2"]=p2; df["cpu_lag_3"]=p3
    df["cpu_change_1"]=(df.avg_cpu-p1).abs(); df["cpu_change_2"]=(p1-p2).abs()
    shifted=g.shift(1)
    roll=shifted.groupby(df["vm_id"], sort=False).rolling(ROLLING_WINDOW, min_periods=ROLLING_MIN_PERIODS)
    df["rolling_mean"]=roll.mean().reset_index(level=0,drop=True)
    df["rolling_std"]=roll.std().reset_index(level=0,drop=True)
    df["rolling_max"]=roll.max().reset_index(level=0,drop=True)
    df["rolling_min"]=roll.min().reset_index(level=0,drop=True)
    df["rolling_range"]=df.rolling_max-df.rolling_min
    df["rolling_deviation"]=(df.avg_cpu-df.rolling_mean).abs()
    df["cpu_trend"]=p1-p3
    df["cpu_acceleration"]=df.cpu_change_1-df.cpu_change_2
    df["rolling_cv"]=df.rolling_std/(df.rolling_mean+1e-6)
    return df

# Full pipeline: validate -> clean -> sort per VM by time -> engineer features.
# Safe to call on a subset of VMs (used for chunked background processing) -
# each VM's features only ever depend on that VM's own rows.
def run_pipeline(df):
    validate_columns(df); df=clean_data(df)
    if df.empty: raise DataValidationError("No valid rows remained after cleaning.")
    df=df.sort_values(["vm_id","timestamp"]).reset_index(drop=True)
    return engineer_features(df)[REQUIRED_COLUMNS+ML_FEATURES]
