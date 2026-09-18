"""Optional Ollama writer: local model generates a bounded, cited supplement.
No model is downloaded automatically. Rules remain authoritative.
"""
import json
import os
import urllib.error
import urllib.request
from .rag import ROOT

def validate_output(payload, allowed_ids):
    if not isinstance(payload, dict):
        raise ValueError("model output is not an object")
    summary, citations = payload.get("summary"), payload.get("citations")
    if not isinstance(summary, str) or not 10 <= len(summary) <= 1200:
        raise ValueError("invalid summary")
    if not isinstance(citations, list) or not citations or len(citations) > 10:
        raise ValueError("missing citations")
    if not all(isinstance(c, str) and c in allowed_ids for c in citations):
        raise ValueError("unknown citation")
    # Structural validation only; it does NOT prove semantic faithfulness.
    return {"status": "ok", "summary": summary, "citations": citations}

def enrich(report):
    model = os.environ.get("OLLAMA_MODEL", "").strip()
    if not model:
        return {"status": "not_configured"}
    base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    prompt = (ROOT / "prompts/writer.v1.md").read_text(encoding="utf-8")
    evidence = {key: report[key] for key in ("query", "findings", "actions", "citations")}
    payload = {"model": model, "stream": False, "format": "json",
               "messages": [{"role": "system", "content": prompt},
                            {"role": "user", "content": json.dumps(evidence, ensure_ascii=False)}],
               "options": {"temperature": 0, "num_predict": 700}}
    request = urllib.request.Request(base + "/api/chat", data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            raw = response.read(100_001)
            if len(raw) > 100_000:
                raise ValueError("model response too large")
            response_data = json.loads(raw)
        return validate_output(json.loads(response_data["message"]["content"]),
                               {c["id"] for c in report["citations"]})
    except (OSError, ValueError, KeyError, TypeError):
        # No raw exception text or server response enters a user-visible trace.
        return {"status": "fallback", "reason": "模型不可用或输出校验未通过；保留规则报告"}
