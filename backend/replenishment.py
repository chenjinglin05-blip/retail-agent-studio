import math


def calculate_replenishment(daily, stock, inbound, lead_days, safety_days=2):
    # 先检查输入；任何一项无效，本次就不计算。
    fields = {
        "daily": ("日均销量", daily),
        "stock": ("现货数量", stock),
        "inbound": ("在途数量", inbound),
        "lead_days": ("采购提前期", lead_days),
        "safety_days": ("安全天数", safety_days),
    }
    for name, (label, value) in fields.items():
        if value is None:
            raise ValueError(f"请补充{label}（{name}）")
        # bool 在 Python 中也是 int 的子类，但不能把 True 当成 1 件。
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"{label}必须是数字，不能填写文字或布尔值")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"{label}必须是有限数值")
        if value < 0:
            raise ValueError(f"{label}不能为负数")
        if name in ("stock", "inbound") and not isinstance(value, int):
            raise ValueError(f"{label}必须按整数件填写")

    # 目标库存按整件向上取整；在途只扣减补货量，不增加现货。
    try:
        target = math.ceil(daily * (lead_days + safety_days))
    except (OverflowError, ValueError):
        raise ValueError("输入数值过大，请检查日均销量和覆盖天数") from None
    reorder = max(0, target - stock - inbound)
    return {"target": target, "reorder": reorder}
