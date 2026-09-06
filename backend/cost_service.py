"""Representative Azure compute cost estimation. Deterministic and rule-based -
no ML involved. The dataset has no real VM size info, so each VM gets a
consistent simulated profile (seeded, so re-running gives the same result)."""
import numpy as np
import pandas as pd
VM_PRICING={"Small":{"vm_sku":"D2 v3","vcpus":2,"memory_gb":8,"hourly_price_usd":0.096},"Medium":{"vm_sku":"D4 v3","vcpus":4,"memory_gb":16,"hourly_price_usd":0.192},"Large":{"vm_sku":"D8 v3","vcpus":8,"memory_gb":32,"hourly_price_usd":0.384}}
PROFILE_DISTRIBUTION={"Small":0.50,"Medium":0.35,"Large":0.15}; PROFILE_SEED=42; INTERVAL_HOURS=5/60
COST_ASSUMPTIONS={"provider":"Azure","region":"East US","os":"Linux/Ubuntu","pricing_model":"Pay-as-you-go","currency":"USD","interval_minutes":5,"note":"Estimated Azure compute cost based on representative VM profiles. Not actual customer billing."}
class CostServiceError(Exception): pass

# Deterministically assigns each VM a Small/Medium/Large profile (seeded, so
# the same vm_id always gets the same profile across runs).
def assign_vm_profiles(vm_ids):
    unique=sorted(pd.Series(vm_ids).astype(str).unique()); rng=np.random.default_rng(PROFILE_SEED)
    profiles=rng.choice(list(PROFILE_DISTRIBUTION), size=len(unique), p=list(PROFILE_DISTRIBUTION.values()))
    return pd.DataFrame({"vm_id":unique,"vm_profile":profiles})

# Adds vm_profile, vm_sku, and estimated_cost_usd columns to a scored DataFrame.
def calculate_estimated_cost(df):
    req=["vm_id","timestamp","avg_cpu","anomaly_prediction"]; missing=[c for c in req if c not in df]
    if missing: raise CostServiceError("Cost calculation requires column(s): "+", ".join(missing))
    out=df.copy().merge(assign_vm_profiles(df.vm_id),on="vm_id",how="left")
    pricing=pd.DataFrame(VM_PRICING).T.reset_index().rename(columns={"index":"vm_profile"})
    out=out.merge(pricing,on="vm_profile",how="left"); out["estimated_cost_usd"]=out.hourly_price_usd*INTERVAL_HOURS
    return out

# Total cost, anomaly-attributable cost, and that as a percentage of the total.
def calculate_cost_summary(df):
    if df.empty: return {"total_estimated_cost_usd":0.0,"anomaly_cost_exposure_usd":0.0,"anomaly_cost_percentage":0.0}
    total=float(df.estimated_cost_usd.sum()); anomaly=float(df.loc[df.anomaly_prediction==1,"estimated_cost_usd"].sum())
    return {"total_estimated_cost_usd":round(total,4),"anomaly_cost_exposure_usd":round(anomaly,4),"anomaly_cost_percentage":round(anomaly/total*100 if total else 0,2)}

# Same breakdown as above, but split out per VM profile (Small/Medium/Large).
def calculate_cost_breakdown_by_profile(df):
    if df.empty: return pd.DataFrame(columns=["vm_profile","total_cost_usd","anomaly_cost_usd","observations","anomalies","anomaly_cost_percentage"])
    rows=[]
    for profile,g in df.groupby("vm_profile",sort=False):
        total=float(g.estimated_cost_usd.sum()); anomaly=float(g.loc[g.anomaly_prediction==1,"estimated_cost_usd"].sum())
        rows.append({"vm_profile":profile,"total_cost_usd":round(total,4),"anomaly_cost_usd":round(anomaly,4),"observations":len(g),"anomalies":int((g.anomaly_prediction==1).sum()),"anomaly_cost_percentage":round(anomaly/total*100 if total else 0,2)})
    return pd.DataFrame(rows)

# Bundles summary + per-profile breakdown + assumptions/pricing for the /cost-analysis endpoint.
def calculate_cost_analytics(df):
    return {"summary":calculate_cost_summary(df),"by_profile":calculate_cost_breakdown_by_profile(df).to_dict("records"),"assumptions":COST_ASSUMPTIONS,"pricing":VM_PRICING}
