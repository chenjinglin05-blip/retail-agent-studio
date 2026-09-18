"""Only allowlisted, read-only business tools. No arbitrary SQL or filesystem tool."""
import math
from .rag import DATA, retrieve
from .replenishment import calculate_replenishment

def store(store_id):
    found = next((s for s in DATA["stores"] if s["id"] == store_id), None)
    if not found:
        raise ValueError("未知门店")
    return found

def sales_summary(store_id):
    s = store(store_id)
    current, previous = sum(s["current"]), sum(s["previous"])
    def ratio(a, b):
        return a / b if b else None
    return {
        "current": current, "previous": previous,
        "change": (current - previous) / previous * 100 if previous else None,
        "conversion": ratio(s["ordersCurrent"] * 100, s["visitorsCurrent"]),
        "conversionPrevious": ratio(s["ordersPrevious"] * 100, s["visitorsPrevious"]),
        "trafficChange": (s["visitorsCurrent"] - s["visitorsPrevious"]) / s["visitorsPrevious"] * 100 if s["visitorsPrevious"] else None,
        "aov": ratio(current, s["ordersCurrent"]), "aovPrevious": ratio(previous, s["ordersPrevious"])
    }

def inventory_risk(store_id):
    store(store_id)
    factor = DATA["storeFactors"][store_id]
    result = []

    for product in DATA["products"]:
        daily = math.ceil(product["daily"] * factor["demand"])
        stock = math.floor(product["stock"] * factor["stock"])

        calculation = calculate_replenishment(
            daily=daily,
            stock=stock,
            inbound=product["inbound"],
            lead_days=product["leadDays"],
            safety_days=2,
        )

        result.append(dict(
            product,
            daily=daily,
            stock=stock,
            target=calculation["target"],
            reorder=calculation["reorder"],
            days=stock / daily if daily else None,
        ))

    return sorted(
        result,
        key=lambda p: p["days"] if p["days"] is not None else float("inf"),
    )
def get_policy(policy_id):
    return next(d for d in DATA["knowledge"] if d["id"] == policy_id)

TOOL_REGISTRY = {
    "calculate_replenishment": calculate_replenishment,
    "sales_summary": sales_summary,
    "inventory_risk": inventory_risk,
    "search_knowledge": retrieve,
    "get_policy": get_policy,
}

def call_tool(name, **arguments):
    if name not in TOOL_REGISTRY:
        raise ValueError("工具不在只读白名单")
    return TOOL_REGISTRY[name](**arguments)
