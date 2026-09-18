---
name: sales-diagnosis
description: 汇总固定窗口的门店销售、客流、成交与客单价。
version: 1.0.0
---

# 销售诊断

适用：销售变化、业绩诊断、客流与转化排查。
输入：store_id，必须为 GZ001、GZ002、SZ001。
允许工具：sales_summary。实现：backend/tools.py。

执行：python -m skills.run sales --store GZ001

步骤：核对演示日期；分别汇总两期销售；计算环比、转化率、客单价；引用 KB-002 和 KB-006。
输出：current、previous、change、conversion、conversionPrevious、trafficChange、aov、aovPrevious。
复核：GZ001 的本期为 87600，上期为 102000，环比约 -14.12%。
边界：没有实时连接；不能把相关性说成因果，不能承诺优化收益。零分母必须报告数据不足。
