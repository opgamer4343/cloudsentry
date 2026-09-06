"""Calls the Gemini API for the second-opinion comparison feature. Gives an
independent, non-authoritative read on a sample of rows - not a trained
classifier, so treat the result as an agreement check, not ground truth."""
import json
import os

import httpx

GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-3.5-flash"


class GeminiServiceError(Exception):
    pass


def is_configured() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def get_model_name() -> str:
    return os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)


def classify_rows(rows: list[dict]) -> dict[int, bool]:
    """
    rows: list of {"index": int, "vm_id": str, "avg_cpu": float,
                    "recent_avg": float, "recent_std": float, "deviation": float}
    Returns {index: is_anomaly} for the rows Gemini was able to classify.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise GeminiServiceError("GEMINI_API_KEY is not set on the server.")

    prompt = (
        "You are reviewing cloud VM CPU utilization readings to spot likely anomalies.\n"
        "Each row has: avg_cpu (the current reading), recent_avg and recent_std "
        "(that VM's own recent normal baseline), and deviation (how far avg_cpu sits "
        "from that baseline).\n"
        "Flag a row as anomalous only if it looks like a genuine, unusual departure from "
        "that specific VM's own recent pattern - not just a high or low number in isolation.\n\n"
        f"Rows:\n{json.dumps(rows)}\n\n"
        "Respond with ONLY a JSON array, one object per row, in this exact shape:\n"
        '[{"index": <int>, "is_anomaly": <true|false>}]\n'
        "Include every row index exactly once. No other text, no markdown fences."
    )

    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0},
    }
    url = GEMINI_API_URL.format(model=get_model_name())

    try:
        resp = httpx.post(
            url,
            headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
            json=body,
            timeout=60,
        )
    except httpx.HTTPError as exc:
        raise GeminiServiceError(f"Could not reach the Gemini API: {exc}") from exc

    if resp.status_code == 401 or resp.status_code == 403:
        raise GeminiServiceError("Gemini rejected the API key. Check GEMINI_API_KEY in your .env file.")
    if resp.status_code != 200:
        raise GeminiServiceError(f"Gemini API error ({resp.status_code}): {resp.text[:300]}")

    data = resp.json()
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(text)
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise GeminiServiceError(f"Could not parse Gemini's response: {exc}") from exc

    result: dict[int, bool] = {}
    for item in parsed:
        try:
            result[int(item["index"])] = bool(item["is_anomaly"])
        except (KeyError, TypeError, ValueError):
            continue
    return result
