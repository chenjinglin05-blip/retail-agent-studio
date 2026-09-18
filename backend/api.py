"""Run: python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000"""
import os
import sqlite3
import httpx
from .replenishment_agent import (run_replenishment, calculate_validated, ReplenishmentInputs,
                                  ReplenishmentReply, ModelResponseError, service_status)
from typing import Literal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from .agent import analyze, evaluate
from .rag import DATA, retrieve
from .storage import history, save, save_replenishment, replenishment_history

app = FastAPI(title="RetailOS Agent API", version="1.0.0",
              description="合成数据；只读经营分析。默认规则引擎，可选本地 Ollama。")

class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    query: str = Field(min_length=2, max_length=500)
    storeId: Literal["GZ001", "GZ002", "SZ001"] = "GZ001"

    @field_validator("query")
    @classmethod
    def not_empty(cls, value):
        if len(value.strip()) < 2:
            raise ValueError("问题过短")
        return value

@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "python", "llmConfigured": bool(os.getenv("OLLAMA_MODEL")), "dataset": "synthetic"}

@app.post("/api/run")
def run(body: RunRequest):
    try:
        report = analyze(body.query, body.storeId, with_llm=os.getenv("OLLAMA_SUMMARY", "0") == "1")
        save(report)
        return report
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.post("/api/evaluate")
def evaluation():
    return evaluate()

@app.get("/api/knowledge")
def knowledge(q: str = ""):
    if len(q) > 500:
        raise HTTPException(status_code=400, detail="检索文本过长")
    return retrieve(q) if q.strip() else DATA["knowledge"]

@app.get("/api/runs")
def runs(storeId: Literal["GZ001", "GZ002", "SZ001"] = "GZ001", limit: int = 20):
    return history(storeId, limit)

class ReplenishmentRequest(BaseModel):
    model_config = ConfigDict(
        extra="forbid", str_strip_whitespace=True
    )
    query: str = Field(min_length=2, max_length=500)


@app.post("/api/replenishment", response_model=ReplenishmentReply)
def replenishment(body: ReplenishmentRequest):
    try:
        return persist_replenishment(run_replenishment(body.query))
    except httpx.TimeoutException as error:
        raise HTTPException(
            status_code=504,
            detail="本地模型响应超时，请稍后重试。",
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=503,
            detail="无法正常调用 Ollama，请检查服务和模型是否可用。",
        ) from error
    except ModelResponseError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(
            status_code=400, detail=str(error),
        ) from error
    except (KeyError, TypeError, AttributeError) as error:
        raise HTTPException(
            status_code=502,
            detail="模型返回格式异常，请重新提交问题。",
        ) from error


def persist_replenishment(reply):
    if reply["status"] == "completed":
        try:
            save_replenishment(dict(reply, persisted=True))
            reply["persisted"] = True
        except (OSError, sqlite3.Error):
            # A local storage failure must not hide a valid business calculation.
            reply["persisted"] = False
    return reply


@app.get("/api/services")
def services():
    return service_status()


@app.post("/api/replenishment/calculate", response_model=ReplenishmentReply)
def calculate_replenishment_api(body: ReplenishmentInputs):
    return persist_replenishment(calculate_validated(body))


@app.get("/api/replenishment/history", response_model=list[ReplenishmentReply])
def recent_replenishment():
    return replenishment_history()
