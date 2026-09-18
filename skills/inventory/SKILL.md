---
name: inventory-risk
description: 计算指定合成门店的库存风险与补货建议；仅用于只读运营分析。
version: 1.0.0
---

# 库存风险

适用：补货、缺货、现货可售天数、在途检查。
输入：store_id，必须为 GZ001、GZ002、SZ001。
允许工具：inventory_risk。实现：backend/tools.py。

执行：python -m skills.run inventory --store GZ001

规则：读取现货、日均销量、在途和提前期。安全天数为 2；目标库存向上取整；补货量不小于 0。在途不能计入现货可售天数。
输出：每个 SKU 的 daily、stock、inbound、leadDays、days、target、reorder。
复核：P001 在 GZ001 的目标为 90、补货为 54、现货可售 1.33 天。
边界：只返回建议。不得执行采购或调拨；到货时间需人工核对。
