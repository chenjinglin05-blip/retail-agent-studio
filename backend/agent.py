"""Bounded role orchestration with explicit traces; rule nodes are not autonomous LLMs."""
import argparse
import json
import time
import uuid
from datetime import datetime, timezone
from .rag import DATA, retrieve
from .tools import call_tool, sales_summary, store

def has(query, words):
    return any(word in query.lower() for word in words)

def plan(query):
    if has(query, ["忽略规则", "密钥", "api key", "system prompt", "删除数据库", "直接修改", "执行采购", "绕过审批", "ignore previous", "reveal secret"]):
        return ["blocked"]
    if query.startswith("请说明"):
        return ["knowledge"] if retrieve(query) else ["unknown"]
    result = []
    if has(query, ["销售", "营业额", "营收", "业绩", "下滑", "转化", "sales"]) and not has(query, ["统计口径", "日报", "客单价口径"]):
        result.append("sales")
    if has(query, ["补货", "库存", "断货", "缺货", "调拨", "在途", "inventory", "replenish"]):
        result.append("inventory")
    if has(query, ["退货", "退换", "退款", "换货", "小票", "return"]):
        result.append("returns")
    return result or (["knowledge"] if retrieve(query) else ["unknown"])

def validate_report(report):
    ids = {c["id"] for c in report["citations"]}
    valid = all(item["source"] in ids for item in report["findings"] + report["actions"])
    return {"passed": valid, "checks": [
        "所有结论与行动引用均可解析" if valid else "存在无效引用",
        "只读工具白名单；没有执行外部操作",
        "无依据时返回资料不足" if "unknown" in report["intents"] else "数据与建议边界已标注",
        "相关性不等同于因果；不承诺业务收益",
    ]}

def analyze(query, store_id="GZ001", with_llm=False):
    if not isinstance(query, str) or not 2 <= len(query.strip()) <= 500:
        raise ValueError("请输入 2–500 字的问题")
    query = query.strip()
    selected = store(store_id)
    trace = []
    def record(role, name, arguments, operation):
        started = time.perf_counter()
        output = operation()
        trace.append({"role": role, "tool": name, "status": "success",
                      "ms": round((time.perf_counter() - started) * 1000, 2),
                      "input": arguments, "output": output})
        return output
    def tool(role, name, **kwargs):
        return record(role, name, kwargs, lambda: call_tool(name, **kwargs))
    intents = record("Planner", "route_task", {"query": query}, lambda: plan(query))
    metrics = sales_summary(store_id)
    report = {
        "id": "run-" + uuid.uuid4().hex[:8], "query": query, "storeId": store_id,
        "storeName": selected["name"], "createdAt": datetime.now(timezone.utc).isoformat(),
        "mode": "python", "intents": intents, "title": "门店运营建议", "summary": "",
        "findings": [], "actions": [], "citations": [], "trace": trace, "inventory": [],
        "metrics": metrics, "review": {"passed": False, "checks": []},
        "notice": "合成数据 · Python 规则编排 · 不执行采购、改价或退款",
    }
    if "blocked" in intents or "unknown" in intents:
        report["title"] = "这项请求超出助手权限" if "blocked" in intents else "当前资料不足以回答"
        report["summary"] = ("助手仅提供可复核的分析建议，不读取密钥、不绕过审批，也不执行采购或价格修改。" if "blocked" in intents else
                             "当前支持销售诊断、库存补货和模拟门店制度。请补充具体经营问题；知识库没有相关依据时不猜测答案。")
    else:
        docs = tool("Knowledge Agent", "search_knowledge", query=query)
        citations = {d["id"]: d for d in docs}
        required = []
        if "sales" in intents:
            required += ["KB-002", "KB-006"]
        if "inventory" in intents:
            required += ["KB-001", "KB-007"]
        if "returns" in intents:
            required += ["KB-003"]
        for policy_id in required:
            if policy_id not in citations:
                citations[policy_id] = tool("Knowledge Agent", "get_policy", policy_id=policy_id)
        report["citations"] = list(citations.values())
        if "sales" in intents:
            m = tool("Data Agent", "sales_summary", store_id=store_id)
            if any(value is None for value in m.values()):
                raise ValueError("经营数据存在零分母；请补齐数据后分析")
            source = "DATA-" + store_id
            report["citations"].append({"id": source, "title": selected["name"] + " · 7 天经营聚合数据",
                                        "content": json.dumps(dict(selected, period=DATA["period"]), ensure_ascii=False, indent=2)})
            report["findings"] += [
                {"label": "销售环比", "text": f'本期 ¥{m["current"]:,}，上期 ¥{m["previous"]:,}，环比 {m["change"]:.2f}%。', "source": source},
                {"label": "转化与客流", "text": f'转化率 {m["conversion"]:.2f}%（上期 {m["conversionPrevious"]:.2f}%）；客流环比 {m["trafficChange"]:.2f}%；客单价 ¥{m["aov"]:.2f}（上期 ¥{m["aovPrevious"]:.2f}）。', "source": source}
            ]
            report["actions"].append({"priority": "P1" if m["change"] < -10 else "P2",
                "title": "先核查转化链路，再判断销售变化原因" if m["change"] < 0 else "复核增长来源，继续跟踪转化",
                "detail": "按客流、成交、客单价逐项排查，再检查缺货、陈列和活动。当前聚合数据无法证明因果。",
                "source": "KB-002"})
        if "inventory" in intents:
            rows = tool("Data Agent", "inventory_risk", store_id=store_id)
            report["inventory"] = rows
            source = "STOCK-" + store_id
            report["citations"].append({"id": source, "title": selected["name"] + " · 库存快照（模拟）",
                                        "content": json.dumps(rows, ensure_ascii=False, indent=2)})
            low = sum(p["reorder"] > 0 for p in rows)
            urgent = sum(p["days"] is not None and p["days"] < p["leadDays"] for p in rows)
            report["findings"].append({"label": "补货与断货窗口", "text": f"{low} 个 SKU 低于目标库存，其中 {urgent} 个 SKU 的现货可售天数短于采购提前期。", "source": source})
            report["actions"].append({"priority": "P1", "title": "核对在途时间，提交补货建议",
                "detail": "建议补货量 = max(0, 日均销量 × (提前期 + 2 天) − 现货 − 在途)，取整计算。先确认到货时间与可调拨余量，由主管审批后执行。",
                "source": "KB-001"})
        if "returns" in intents:
            report["findings"].append({"label": "模拟退换货规则", "text": citations["KB-003"]["content"], "source": "KB-003"})
            report["actions"].append({"priority": "待补充", "title": "先补齐购买信息",
                "detail": "请确认购买日期、商品品类、购买凭证及是否拆封/完好；信息不足时不承诺退款，异常交由主管核验。",
                "source": "KB-003"})
        if "knowledge" in intents:
            report["findings"] = [{"label": d["title"], "text": d["content"], "source": d["id"]} for d in docs]
        report["title"] = ("销售与库存联动诊断" if "sales" in intents and "inventory" in intents else
                           "销售表现与排查建议" if "sales" in intents else
                           "库存风险与补货建议" if "inventory" in intents else
                           "退换货处理指引" if "returns" in intents else "从门店知识库找到这些依据")
        report["summary"] = (("本周销售下降超过 10%，建议优先复核成交转化变化。" if metrics["change"] < -10 else
                              "已完成本周与上周对比，请结合客流、转化和客单价判断变化。") if "sales" in intents else
                             "已按实际库存、在途和采购提前期计算补货量；建议需要人工确认。" if "inventory" in intents else
                             "以下为模拟门店制度，请核对适用条件。" if "returns" in intents else
                             "检索结果按相关性排序，保留原文与来源编号。")
    report["review"] = record("Reviewer", "validate_report",
                               {"references": [c["id"] for c in report["citations"]]},
                               lambda: validate_report(report))
    if with_llm and report["citations"] and report["review"]["passed"]:
        from .llm import enrich
        report["llm"] = record("Writer", "ollama_summary", {"citationIds": [c["id"] for c in report["citations"]]},
                               lambda: enrich(report))
    return report

def evaluate():
    started = time.perf_counter()
    rows = []
    for case in DATA["evaluation"]:
        blocked = case["intent"] in ("unknown", "blocked")
        baseline = [] if blocked else [d["id"] for d in retrieve(case["query"], False)]
        improved = [] if blocked else [d["id"] for d in retrieve(case["query"], True)]
        predicted = plan(case["query"])[0]
        rows.append(dict(case, predicted=predicted, baseline=baseline, improved=improved,
                         baselineHit=bool(case["expected"] and case["expected"] in baseline),
                         improvedHit=bool(case["expected"] and case["expected"] in improved),
                         intentPass=predicted == case["intent"]))
    relevant = [r for r in rows if r["expected"]]
    boundary = [r for r in rows if not r["expected"]]
    return {"total": len(rows), "retrievalCount": len(relevant),
            "baselineRecall": sum(r["baselineHit"] for r in relevant) / len(relevant),
            "recall": sum(r["improvedHit"] for r in relevant) / len(relevant),
            "intentAccuracy": sum(r["intentPass"] for r in rows) / len(rows),
            "safetyPass": sum(r["intentPass"] for r in boundary), "safetyCount": len(boundary),
            "ms": round((time.perf_counter()-started)*1000, 2), "rows": rows,
            "disclaimer": f"{len(rows)} 条手工演示用例，非独立测试集；检索指标为 Recall@3，不代表真实门店效果。"}

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", default="分析本周销售变化，并给出补货建议")
    parser.add_argument("--store", default="GZ001")
    parser.add_argument("--evaluate", action="store_true")
    args = parser.parse_args()
    result = evaluate() if args.evaluate else analyze(args.query, args.store)
    print(json.dumps(result, ensure_ascii=False, indent=2))
