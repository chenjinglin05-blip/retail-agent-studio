"""One bounded local model call, validated arguments, deterministic business tool."""
import os
import time
import uuid
from datetime import datetime, timezone

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .tools import call_tool


class ReplenishmentInputs(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", allow_inf_nan=False)
    daily: float = Field(ge=0, le=1_000_000, description="日均销量，件/天")
    stock: int = Field(ge=0, le=1_000_000_000, description="当前现货数量，件")
    inbound: int = Field(ge=0, le=1_000_000_000, description="已确认在途数量，件")
    lead_days: float = Field(ge=0, le=365, description="采购提前期，天")
    safety_days: float = Field(default=2, ge=0, le=365, description="安全天数")


class TraceStep(BaseModel):
    step: str
    ms: float
    input: dict
    output: dict


class ReplenishmentReply(BaseModel):
    id: str
    createdAt: str
    status: str
    mode: str
    query: str
    message: str
    arguments: ReplenishmentInputs | None = None
    result: dict | None = None
    trace: list[TraceStep] = Field(default_factory=list)
    persisted: bool = False


TOOL = {
    "type": "function",
    "function": {
        "name": "calculate_replenishment",
        "description": "根据销量、现货、在途和覆盖天数计算建议补货量。",
        "parameters": ReplenishmentInputs.model_json_schema(),
    },
}


class ModelResponseError(Exception):
    """Model response is not a supported single tool call."""


def model_settings():
    return (
        os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
        os.getenv("OLLAMA_MODEL") or "qwen3:1.7b",
    )


def make_reply(query, mode):
    return {
        "id": "repl-" + uuid.uuid4().hex,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "query": query, "mode": mode, "trace": [], "persisted": False,
    }


def calculate_validated(inputs, query="手动填写参数", reply=None):
    reply = reply if reply is not None else make_reply(query, "manual")
    arguments = inputs.model_dump()
    started = time.perf_counter()
    result = call_tool("calculate_replenishment", **arguments)
    reply["trace"].append({
        "step": "calculate_replenishment", "input": arguments, "output": result,
        "ms": round((time.perf_counter() - started) * 1000, 2),
    })
    reply.update({
        "status": "completed", "arguments": arguments, "result": result,
        "message": f"目标库存 {result['target']} 件；建议补货 {result['reorder']} 件。建议需人工确认。",
    })
    return reply


def run_replenishment(query):
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 500:
        raise ValueError("请输入2到500字的问题。")
    query = query.strip()
    reply = make_reply(query, "ollama")
    messages = [
        {"role": "system", "content": (
            "你是补货助手。根据用户提供的信息调用一次补货工具。"
            "不得自行计算，不得编造参数。"
            "日均销量、现货、在途、采购提前期缺失时先追问。"
            "安全天数未提供时可以使用默认值2。"
        )},
        {"role": "user", "content": query},
    ]
    base, model = model_settings()
    started = time.perf_counter()
    with httpx.Client(timeout=180, trust_env=False) as client:
        response = client.post(base + "/api/chat", json={
            "model": model, "messages": messages, "tools": [TOOL],
            "stream": False, "think": False,
        })
        response.raise_for_status()
        try:
            payload = response.json()
        except ValueError as error:
            raise ModelResponseError("模型返回了无法解析的内容，请重试或手动填写参数。") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("message"), dict):
        raise ModelResponseError("模型响应缺少有效消息，请重试或手动填写参数。")
    calls = payload["message"].get("tool_calls")
    if calls is None or calls == []:
        reply.update(status="not_calculated", message=(
            "模型未提出工具调用，本次没有计算。请补充日均销量、现货、在途和采购提前期，或手动填写参数。"
        ))
        reply["trace"].append({"step": "ollama", "input": {"model": model, "query": query},
                              "output": {"tool_calls": []}, "ms": round((time.perf_counter()-started)*1000, 2)})
        return reply
    if not isinstance(calls, list) or len(calls) != 1:
        raise ModelResponseError("每次只支持一个商品和一次工具调用，请拆分问题。")
    function = calls[0].get("function") if isinstance(calls[0], dict) else None
    if not isinstance(function, dict) or function.get("name") != "calculate_replenishment":
        raise ModelResponseError("模型请求了不支持的工具，本次没有执行。")
    try:
        inputs = ReplenishmentInputs.model_validate(function.get("arguments"))
    except ValidationError as error:
        raise ModelResponseError("模型提取的参数不完整或格式不符，本次没有计算。请手动核对五项参数。") from error
    reply["trace"].append({
        "step": "ollama", "input": {"model": model, "query": query},
        "output": {"tool": function["name"], "arguments": inputs.model_dump()},
        "ms": round((time.perf_counter() - started) * 1000, 2),
    })
    reply["trace"].append({
        "step": "validate_arguments", "ms": 0,
        "input": inputs.model_dump(),
        "output": {"schemaValid": True, "meaningVerified": False,
                   "note": "类型与范围已检查；提取内容是否符合原意仍需人工核对。"},
    })
    return calculate_validated(inputs, query, reply)


def service_status():
    """Read service metadata only; no inference or automatic model download."""
    base, model = model_settings()
    result = {"backend": "online", "ollama": "offline", "model": model}
    try:
        with httpx.Client(timeout=2, trust_env=False) as client:
            response = client.get(base + "/api/tags")
            response.raise_for_status()
            models = response.json().get("models", [])
        names = {m.get("name") for m in models if isinstance(m, dict)}
        result["ollama"] = "ready" if model in names or model + ":latest" in names else "model_missing"
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        pass
    return result
