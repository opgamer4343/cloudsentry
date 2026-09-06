import axios from "axios";

export const BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";

const api = axios.create({ baseURL: BASE_URL });

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("cs_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && window.location.pathname !== "/login") {
      localStorage.removeItem("cs_token");
      localStorage.removeItem("cs_user");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

const getMsg = (e) => e.response?.data?.detail || e.message || "Request failed";

// ---------------- Auth ----------------
export const register = (data) => api.post("/auth/register", data).then((r) => r.data);
export const login = async (data) => {
  const res = await api.post("/auth/login", data);
  localStorage.setItem("cs_token", res.data.access_token);
  localStorage.setItem("cs_user", JSON.stringify(res.data.user));
  return res.data;
};
export const logout = () => {
  api.post("/auth/logout").catch(() => {});
  localStorage.removeItem("cs_token");
  localStorage.removeItem("cs_user");
};
export const getMe = () => api.get("/auth/me").then((r) => r.data);
export const getToken = () => localStorage.getItem("cs_token");
export const changePassword = (current_password, new_password) =>
  api.post("/auth/change-password", { current_password, new_password }).then((r) => r.data);

// ---------------- Analysis ----------------
// Submits a CSV; server responds almost instantly with {analysis_id, status:
// "processing"} and finishes the real work in the background - see getAnalysisStatus.
export const analyzeCsv = (file, onProgress) => {
  const form = new FormData();
  form.append("file", file);
  return api.post("/analyze", form, {
    onUploadProgress: (e) =>
      onProgress?.(Math.round((e.loaded * 100) / (e.total || 1))),
  }).then((r) => r.data);
};
// Poll target while a job runs: {status: "processing"|"complete"|"failed", progress_percent}.
export const getAnalysisStatus = (id) => api.get(`/analyses/${id}/status`).then((r) => r.data);
export const getTimeline = (id) => api.get(`/timeline?analysis_id=${id}`).then((r) => r.data);
export const getModelPerformance = () => api.get("/model-performance").then((r) => r.data);
export const getFeatureImportance = () => api.get("/model-feature-importance").then((r) => r.data);
export const getAnalyses = () => api.get("/analyses").then((r) => r.data);
export const getAnalysis = (id, threshold) =>
  api.get(`/analyses/${id}`, { params: threshold != null ? { threshold } : {} }).then((r) => r.data);
export const updateAnomalyStatus = (analysisId, predictionId, status) =>
  api.patch(`/analyses/${analysisId}/anomalies/${predictionId}/status`, { status }).then((r) => r.data);

// ---------------- Exports ----------------
async function download(url, filename) {
  const res = await api.get(url, { responseType: "blob" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(res.data);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}
export const exportAnalysis = (id) =>
  download(`/analyses/${id}/export`, `cloudsentrys_analysis_${id}.csv`);
export const exportAnalysisSummary = (id) =>
  download(`/analyses/${id}/summary-export`, `cloudsentrys_summary_${id}.json`);

// ---------------- Gemini second-opinion comparison ----------------
export const getGeminiComparison = (id) =>
  api.get(`/analyses/${id}/gemini-comparison`).then((r) => r.data).catch((e) => {
    if (e.response?.status === 404) return null;
    throw e;
  });
export const runGeminiComparison = (id) =>
  api.post(`/analyses/${id}/gemini-comparison`).then((r) => r.data);

export { getMsg };
