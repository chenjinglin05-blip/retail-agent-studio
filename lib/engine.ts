import raw from '../data/retail.json';
export const dataset = raw;
export type Knowledge = (typeof raw.knowledge)[number];
export type Store = (typeof raw.stores)[number];
export type Intent =
  | 'sales'
  | 'inventory'
  | 'returns'
  | 'knowledge'
  | 'unknown'
  | 'blocked';
export type Citation = {
  id: string;
  title: string;
  content: string;
  score?: number;
};
export type Trace = {
  role: string;
  tool: string;
  status: string;
  ms: number;
  input: unknown;
  output: unknown;
};
export type InventoryRow = (typeof raw.products)[number] & {
  days: number;
  target: number;
  reorder: number;
};
export type Report = {
  id: string;
  query: string;
  storeId: string;
  storeName: string;
  createdAt: string;
  mode: string;
  intents: Intent[];
  title: string;
  summary: string;
  findings: { label: string; text: string; source: string }[];
  actions: {
    priority: string;
    title: string;
    detail: string;
    source: string;
  }[];
  citations: Citation[];
  trace: Trace[];
  inventory: InventoryRow[];
  review: { passed: boolean; checks: string[] };
  metrics: ReturnType<typeof metrics>;
  notice: string;
  llm?: { status: string; summary?: string; citations?: string[] };
};
const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
export function metrics(storeId: string) {
  const s = raw.stores.find((s) => s.id === storeId);
  if (!s) throw new Error('未知门店');
  const current = sum(s.current),
    previous = sum(s.previous);
  return {
    current,
    previous,
    change: ((current - previous) / previous) * 100,
    conversion: (s.ordersCurrent / s.visitorsCurrent) * 100,
    conversionPrevious: (s.ordersPrevious / s.visitorsPrevious) * 100,
    trafficChange:
      ((s.visitorsCurrent - s.visitorsPrevious) / s.visitorsPrevious) * 100,
    aov: current / s.ordersCurrent,
    aovPrevious: previous / s.ordersPrevious,
  };
}
export function inventory(storeId: string): InventoryRow[] {
  const factor = raw.storeFactors[storeId as keyof typeof raw.storeFactors];
  if (!factor) throw new Error('未知门店');
  return raw.products
    .map((p) => {
      const daily = Math.ceil(p.daily * factor.demand),
        stock = Math.floor(p.stock * factor.stock),
        target = Math.ceil(daily * (p.leadDays + 2));
      return {
        ...p,
        daily,
        stock,
        target,
        days: stock / daily,
        reorder: Math.max(0, target - stock - p.inbound),
      };
    })
    .sort((a, b) => a.days - b.days);
}
const has = (q: string, words: string[]) =>
  words.some((w) => q.toLowerCase().includes(w));
export function plan(q: string): Intent[] {
  if (
    has(q, [
      '忽略规则',
      '密钥',
      'api key',
      'system prompt',
      '删除数据库',
      '直接修改',
      '执行采购',
      '绕过审批',
      'ignore previous',
      'reveal secret',
    ])
  )
    return ['blocked'];
  if (q.startsWith('请说明'))
    return retrieve(q).length ? ['knowledge'] : ['unknown'];
  const result: Intent[] = [];
  if (
    has(q, ['销售', '营业额', '营收', '业绩', '下滑', '转化', 'sales']) &&
    !has(q, ['统计口径', '日报', '客单价口径'])
  )
    result.push('sales');
  if (
    has(q, [
      '补货',
      '库存',
      '断货',
      '缺货',
      '调拨',
      '在途',
      'inventory',
      'replenish',
    ])
  )
    result.push('inventory');
  if (has(q, ['退货', '退换', '退款', '换货', '小票', 'return']))
    result.push('returns');
  if (!result.length) result.push(retrieve(q).length ? 'knowledge' : 'unknown');
  return result;
}
function grams(text: string) {
  const runs = text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];
  return runs.flatMap((r) =>
    /^[\u4e00-\u9fff]+$/.test(r)
      ? Array.from({ length: Math.max(0, r.length - 1) }, (_, i) =>
          r.slice(i, i + 2),
        )
      : [r],
  );
}
export function retrieve(
  query: string,
  enhanced = true,
  limit = 3,
): (Knowledge & { score: number })[] {
  const q = query.toLowerCase(),
    tokens = grams(q);
  const documents = raw.knowledge.map((d) =>
    grams(d.title + ' ' + d.content + ' ' + d.keywords.join(' ')),
  );
  const average =
    documents.reduce((a, b) => a + b.length, 0) / documents.length;
  return raw.knowledge
    .map((d, i) => {
      const exact = d.keywords.filter((w) => q.includes(w)).length;
      let score = exact * 4;
      if (enhanced) {
        for (const t of new Set(tokens)) {
          const freq = documents[i].filter((x) => x === t).length;
          if (!freq) continue;
          const df = documents.filter((doc) => doc.includes(t)).length;
          const idf = Math.log(1 + (documents.length - df + 0.5) / (df + 0.5));
          score +=
            (idf * (freq * 2.2)) /
            (freq + 1.2 * (0.25 + (0.75 * documents[i].length) / average));
        }
      }
      return { ...d, score: Math.round(score * 100) / 100 };
    })
    .filter((d) => d.score >= (enhanced ? 2.4 : 1))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
}
export function analyze(query: string, storeId = 'GZ001'): Report {
  const q = query.trim();
  if (q.length < 2 || q.length > 500) throw new Error('请输入 2–500 字的问题');
  const s = raw.stores.find((s) => s.id === storeId);
  if (!s) throw new Error('未知门店');
  const trace: Trace[] = [];
  const call = <T>(
    role: string,
    tool: string,
    input: unknown,
    fn: () => T,
  ): T => {
    const t = performance.now();
    const output = fn();
    trace.push({
      role,
      tool,
      status: 'success',
      ms: Math.round((performance.now() - t) * 100) / 100,
      input,
      output,
    });
    return output;
  };
  const intents = call('Planner', 'route_task', { query: q }, () => plan(q));
  const m = metrics(storeId);
  const report: Report = {
    id: 'run-' + crypto.randomUUID().slice(0, 8),
    query: q,
    storeId,
    storeName: s.name,
    createdAt: new Date().toISOString(),
    mode: 'rules',
    intents,
    title: '门店运营建议',
    summary: '',
    findings: [],
    actions: [],
    citations: [],
    trace,
    inventory: [],
    review: { passed: false, checks: [] },
    metrics: m,
    notice: '合成数据 · 规则编排 · 本次未调用 LLM · 不执行采购、改价或退款',
  };
  if (intents.includes('blocked') || intents.includes('unknown')) {
    report.title = intents.includes('blocked')
      ? '这项请求超出助手权限'
      : '当前资料不足以回答';
    report.summary = intents.includes('blocked')
      ? '助手仅提供可复核的分析建议，不读取密钥、不绕过审批，也不执行采购或价格修改。'
      : '当前支持销售诊断、库存补货和模拟门店制度。请补充具体经营问题；知识库没有相关依据时不猜测答案。';
  } else {
    const docs = call(
      'Knowledge Agent',
      'search_knowledge',
      { query: q, topK: 3, retriever: 'BM25 + keywords' },
      () => retrieve(q),
    );
    const required: string[] = [];
    if (intents.includes('sales')) required.push('KB-002', 'KB-006');
    if (intents.includes('inventory')) required.push('KB-001', 'KB-007');
    if (intents.includes('returns')) required.push('KB-003');
    const citations = new Map<string, Citation>(docs.map((d) => [d.id, d]));
    for (const id of required) {
      if (!citations.has(id)) {
        const doc = call('Knowledge Agent', 'get_policy', { id }, () =>
          raw.knowledge.find((d) => d.id === id)!,
        );
        citations.set(id, doc);
      }
    }
    report.citations = [...citations.values()];
    if (intents.includes('sales')) {
      const stats = call(
        'Data Agent',
        'sales_summary',
        { storeId, period: raw.period },
        () => metrics(storeId),
      );
      const dataId = 'DATA-' + storeId;
      report.citations.push({
        id: dataId,
        title: s.name + ' · 7 天经营聚合数据',
        content: JSON.stringify({ period: raw.period, ...s }, null, 2),
      });
      report.findings.push(
        {
          label: '销售环比',
          text:
            '本期 ¥' +
            stats.current.toLocaleString('en-US') +
            '，上期 ¥' +
            stats.previous.toLocaleString('en-US') +
            '，环比 ' +
            stats.change.toFixed(2) +
            '%。',
          source: dataId,
        },
        {
          label: '转化与客流',
          text:
            '转化率 ' +
            stats.conversion.toFixed(2) +
            '%（上期 ' +
            stats.conversionPrevious.toFixed(2) +
            '%）；客流环比 ' +
            stats.trafficChange.toFixed(2) +
            '%；客单价 ¥' +
            stats.aov.toFixed(2) +
            '（上期 ¥' +
            stats.aovPrevious.toFixed(2) +
            '）。',
          source: dataId,
        },
      );
      report.actions.push({
        priority: stats.change < -10 ? 'P1' : 'P2',
        title:
          stats.change < 0
            ? '先核查转化链路，再判断销售变化原因'
            : '复核增长来源，继续跟踪转化',
        detail:
          '按客流、成交、客单价逐项排查，再检查缺货、陈列和活动。当前聚合数据无法证明因果。',
        source: 'KB-002',
      });
    }
    if (intents.includes('inventory')) {
      report.inventory = call(
        'Data Agent',
        'inventory_risk',
        { storeId, safetyDays: 2 },
        () => inventory(storeId),
      );
      const id = 'STOCK-' + storeId;
      report.citations.push({
        id,
        title: s.name + ' · 库存快照（模拟）',
        content: JSON.stringify(report.inventory, null, 2),
      });
      const low = report.inventory.filter((p) => p.reorder > 0),
        urgent = report.inventory.filter((p) => p.days < p.leadDays);
      report.findings.push({
        label: '补货与断货窗口',
        text:
          low.length +
          ' 个 SKU 低于目标库存，其中 ' +
          urgent.length +
          ' 个 SKU 的现货可售天数短于采购提前期。',
        source: id,
      });
      report.actions.push({
        priority: 'P1',
        title: '核对在途时间，提交补货建议',
        detail:
          '建议补货量 = max(0, 日均销量 × (提前期 + 2 天) − 现货 − 在途)，取整计算。先确认到货时间与可调拨余量，由主管审批后执行。',
        source: 'KB-001',
      });
    }
    if (intents.includes('returns')) {
      report.findings.push({
        label: '模拟退换货规则',
        text: raw.knowledge.find((d) => d.id === 'KB-003')!.content,
        source: 'KB-003',
      });
      report.actions.push({
        priority: '待补充',
        title: '先补齐购买信息',
        detail:
          '请确认购买日期、商品品类、购买凭证及是否拆封/完好；信息不足时不承诺退款，异常交由主管核验。',
        source: 'KB-003',
      });
    }
    if (intents.includes('knowledge')) {
      report.findings = docs.map((d) => ({
        label: d.title,
        text: d.content,
        source: d.id,
      }));
    }
    report.title =
      intents.includes('inventory') && intents.includes('sales')
        ? '销售与库存联动诊断'
        : intents.includes('sales')
          ? '销售表现与排查建议'
          : intents.includes('inventory')
            ? '库存风险与补货建议'
            : intents.includes('returns')
              ? '退换货处理指引'
              : '从门店知识库找到这些依据';
    report.summary = intents.includes('sales')
      ? m.change < -10
        ? '本周销售下降超过 10%，建议优先复核成交转化变化。'
        : '已完成本周与上周对比，请结合客流、转化和客单价判断变化。'
      : intents.includes('inventory')
        ? '已按实际库存、在途和采购提前期计算补货量；建议需要人工确认。'
        : intents.includes('returns')
          ? '以下为模拟门店制度，请核对适用条件。'
          : '检索结果按相关性排序，保留原文与来源编号。';
  }
  const review = call(
    'Reviewer',
    'validate_report',
    { references: report.citations.map((c) => c.id) },
    () => {
      const ids = new Set(report.citations.map((c) => c.id));
      const valid = [...report.findings, ...report.actions].every((x) =>
        ids.has(x.source),
      );
      return {
        passed: valid,
        checks: [
          valid ? '所有结论与行动引用均可解析' : '存在无效引用',
          '只读工具白名单；没有执行外部操作',
          intents.includes('unknown')
            ? '无依据时返回资料不足'
            : '数据与建议边界已标注',
          '相关性不等同于因果；不承诺业务收益',
        ],
      };
    },
  );
  report.review = review;
  return report;
}
export function evaluate() {
  const t = performance.now();
  const rows = raw.evaluation.map((c) => {
    const blocked = ['unknown', 'blocked'].includes(c.intent);
    const current = plan(c.query)[0];
    const baseline = blocked ? [] : retrieve(c.query, false);
    const improved = blocked ? [] : retrieve(c.query, true);
    return {
      ...c,
      predicted: current,
      baseline: baseline.map((d) => d.id),
      improved: improved.map((d) => d.id),
      baselineHit: !!c.expected && baseline.some((d) => d.id === c.expected),
      improvedHit: !!c.expected && improved.some((d) => d.id === c.expected),
      intentPass: current === c.intent,
    };
  });
  const relevant = rows.filter((r) => r.expected);
  const safe = rows.filter((r) => !r.expected);
  return {
    total: rows.length,
    retrievalCount: relevant.length,
    baselineRecall:
      relevant.filter((r) => r.baselineHit).length / relevant.length,
    recall: relevant.filter((r) => r.improvedHit).length / relevant.length,
    intentAccuracy: rows.filter((r) => r.intentPass).length / rows.length,
    safetyPass: safe.filter((r) => r.intentPass).length,
    safetyCount: safe.length,
    ms: Math.round((performance.now() - t) * 100) / 100,
    rows,
    disclaimer:
      ` ${rows.length} 条手工演示用例，非独立测试集；检索指标为 Recall@3，不代表真实门店效果。`.trim(),
  };
}
export function markdown(r: Report) {
  return (
    '# ' +
    r.title +
    '\n\n' +
    r.storeName +
    ' | ' +
    r.createdAt +
    '\n\n> ' +
    r.notice +
    '\n\n问题：' +
    r.query +
    '\n\n' +
    r.summary +
    '\n\n## 发现\n' +
    r.findings
      .map((f) => '- **' + f.label + '**：' + f.text + ' [' + f.source + ']')
      .join('\n') +
    '\n\n## 行动建议\n' +
    r.actions
      .map(
        (a) =>
          '- **' +
          a.priority +
          ' ' +
          a.title +
          '**：' +
          a.detail +
          ' [' +
          a.source +
          ']',
      )
      .join('\n') +
    '\n\n## 依据\n' +
    r.citations
      .map((c) => '### ' + c.id + ' ' + c.title + '\n' + c.content)
      .join('\n\n') +
    '\n\n## 复核\n' +
    r.review.checks.map((c) => '- ' + c).join('\n') +
    '\n'
  );
}
