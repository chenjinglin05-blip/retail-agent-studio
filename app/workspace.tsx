'use client';
import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import ReplenishmentPanel from './replenishment-panel';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  ChartNoAxesCombined,
  Clock,
  Code2,
  Database,
  Download,
  FileJson,
  FlaskConical,
  Layers,
  LoaderCircle,
  Package,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  dataset,
  metrics,
  inventory,
  retrieve,
  markdown,
  type Report,
  evaluate,
} from '@/lib/engine';
const presets = [
  '分析本周销售变化，并给出补货建议',
  '哪些商品存在断货风险？',
  '拆开的盲盒可以退货吗？',
];
const money = (v: number) =>
  '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
type EvalResult = ReturnType<typeof evaluate>;
function Trend({ storeId }: { storeId: string }) {
  const store = dataset.stores.find((s) => s.id === storeId)!;
  const max = Math.max(...store.current, ...store.previous) * 1.18;
  const path = (arr: number[]) =>
    arr
      .map(
        (v, i) =>
          (i ? 'L' : 'M') + (20 + i * 80) + ',' + (130 - (v / max) * 110),
      )
      .join(' ');
  return (
    <div className="trend">
      <div className="trend-heading">
        <span>近 7 天净销售走势</span>
        <div>
          <i className="legend purple" />
          本期
          <i className="legend gray" />
          上期
        </div>
      </div>
      <svg
        aria-label={store.name + ' 本期与上期 7 天净销售额对比'}
        viewBox="0 0 520 164"
      >
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7668f1" stopOpacity=".17" />
            <stop offset="1" stopColor="#7668f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[35, 80, 125].map((y) => (
          <line
            key={y}
            x1="20"
            y1={y}
            x2="500"
            y2={y}
            stroke="#e8eaf0"
            strokeDasharray="4 4"
          />
        ))}
        <path
          d={path(store.current) + ' L500,130 L20,130 Z'}
          fill="url(#area)"
        />
        <path
          d={path(store.previous)}
          fill="none"
          stroke="#b9bfcb"
          strokeWidth="2"
          strokeDasharray="5 5"
        />
        <path
          d={path(store.current)}
          fill="none"
          stroke="#6c5ce8"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
        {store.current.map((v, i) => (
          <g key={i}>
            <circle
              cx={20 + i * 80}
              cy={130 - (v / max) * 110}
              r="3.5"
              fill="#fff"
              stroke="#6c5ce8"
              strokeWidth="2"
            />
            <text
              x={20 + i * 80}
              y="156"
              textAnchor="middle"
              fill="#8790a1"
              fontSize="12"
            >
              09/{String(i + 4).padStart(2, '0')}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
// Keep server-rendered controls disabled until React has hydrated them.
const subscribeToClient = () => () => undefined;

export default function Workspace({
  initialReport,
}: {
  initialReport: Report;
}) {
  const ready = useSyncExternalStore(
    subscribeToClient,
    () => true,
    () => false,
  );
  const [tab, setTab] = useState('workspace'),
    [storeId, setStoreId] = useState('GZ001'),
    [question, setQuestion] = useState(presets[0]),
    [report, setReport] = useState<Report | null>(initialReport),
    [running, setRunning] = useState(false),
    [error, setError] = useState(''),
    [sample, setSample] = useState(true),
    [reportTab, setReportTab] = useState('summary'),
    [search, setSearch] = useState(''),
    [evalResult, setEvalResult] = useState<EvalResult | null>(null),
    [evaluating, setEvaluating] = useState(false),
    [history, setHistory] = useState<Report[]>([]);
  const current = metrics(storeId),
    risk = inventory(storeId).filter((p) => p.reorder > 0),
    docs = search.trim() ? retrieve(search) : dataset.knowledge;
  const questionChanged =
    report !== null && report.query.trim() !== question.trim();
  function changeStore(value: string | null) {
    if (!value) return;
    setStoreId(value);
    setReport(null);
    setError('');
    setSample(false);
  }
  async function run(query = question) {
    const submittedQuery = query.trim();
    if (running || submittedQuery.length < 2) return;
    setRunning(true);
    setError('');
    setQuestion(submittedQuery);
    setReport(null);
    setSample(false);
    setReportTab('summary');
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: submittedQuery, storeId }),
        signal: AbortSignal.timeout(50_000),
      });
      const body = (await res.json()) as Report & { error?: string };
      if (!res.ok) throw new Error(body.error || '分析失败');
      setReport(body);
      setSample(false);
      setHistory((h) => [body, ...h].slice(0, 6));
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError'
          ? '分析请求超时，请确认服务仍在运行，然后点击“开始分析”重试。'
          : e instanceof Error
            ? e.message
            : '请求失败，请重试',
      );
    } finally {
      setRunning(false);
    }
  }
  async function runEval() {
    setEvaluating(true);
    setError('');
    try {
      const res = await fetch('/api/evaluate', { method: 'POST' });
      if (!res.ok) throw new Error('评测暂时不可用');
      setEvalResult(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : '评测失败');
    } finally {
      setEvaluating(false);
    }
  }
  function exportReport() {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([markdown(report)], { type: 'text/markdown;charset=utf-8' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = report.id + '.md';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <main className="shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Layers size={22} />
          </span>
          Retail<span>OS</span>
          <small>AGENT STUDIO</small>
        </Link>
        <span className="top-note">
          <i />
          演示环境<span className="divider">/</span>合成数据
        </span>
      </header>
      <section className="intro">
        <div>
          <div className="eyebrow">WORKSPACE / 运营工作台</div>
          <h1>
            从一个问题，到一份行动方案<span>。</span>
          </h1>
          <p>联动经营数据与门店知识，让每一个建议都有依据。</p>
        </div>
        <div className="intro-meta">
          <span className="version">PROJECT 01</span>
          <span>零售运营 × AI Agent</span>
        </div>
      </section>
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(String(v));
          setError('');
        }}
      >
        <TabsList className="main-tabs" variant="line">
          <TabsTrigger value="workspace">
            <ChartNoAxesCombined />
            运营工作台
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            <Database />
            知识库<span className="count">{dataset.knowledge.length}</span>
          </TabsTrigger>
          <TabsTrigger value="eval">
            <FlaskConical />
            评测实验室
          </TabsTrigger>
          <TabsTrigger value="project">
            <Code2 />
            技术说明
          </TabsTrigger>
        </TabsList>
        {error && (
          <div role="alert" className="error-message">
            {error}
            <button onClick={() => setError('')}>关闭</button>
          </div>
        )}
        <TabsContent value="workspace">
          <div className="workspace-toolbar">
            <div className="store-select">
              <span className="store-icon">
                <Package size={17} />
              </span>
              <Select
                value={storeId}
                onValueChange={changeStore}
                items={dataset.stores.map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
              >
                <SelectTrigger aria-label="选择门店" className="store-trigger">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dataset.stores.map((s) => (
                    <SelectItem value={s.id} key={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="period">
              <Clock size={14} />
              固定演示周期 · 2026.09.04—09.10
            </span>
          </div>
          <div className="workspace-grid">
            <div className="main-column">
              <div className="metric-grid">
                <div className="metric">
                  <span>本周净销售额</span>
                  <strong>{money(current.current)}</strong>
                  <small className={current.change < 0 ? 'down' : 'up'}>
                    {current.change < 0 ? (
                      <ArrowDownRight size={14} />
                    ) : (
                      <ArrowUpRight size={14} />
                    )}
                    环比 {current.change > 0 ? '+' : ''}
                    {current.change.toFixed(2)}%
                  </small>
                </div>
                <div className="metric">
                  <span>成交转化率</span>
                  <strong>
                    {current.conversion.toFixed(2)}
                    <em>%</em>
                  </strong>
                  <small>上期 {current.conversionPrevious.toFixed(2)}%</small>
                </div>
                <div className="metric">
                  <span>低于目标库存</span>
                  <strong>
                    {risk.length}
                    <em>个 SKU</em>
                  </strong>
                  <small className="down">需核对补货与在途</small>
                </div>
              </div>
              <ReplenishmentPanel ready={ready} />
              <section className="composer card">
                <div className="section-label">
                  <Sparkles size={18} />
                  交给运营助手
                  <span className="hint">⌘ / Ctrl + Enter 运行</span>
                </div>
                <textarea
                  aria-label="经营问题"
                  aria-describedby="analysis-status"
                  disabled={!ready}
                  maxLength={500}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      (e.ctrlKey || e.metaKey) &&
                      e.key === 'Enter' &&
                      !running &&
                      question.trim().length >= 2
                    )
                      void run();
                  }}
                  placeholder="描述这家门店的经营问题，例如：哪些商品需要补货？"
                />
                <output id="analysis-status" className="analysis-status">
                  {!ready
                    ? '页面正在初始化，请稍候…'
                    : running
                      ? '正在分析本次问题，请稍候…'
                      : question.trim().length < 2
                        ? '请输入至少 2 个字符后再开始分析。'
                        : questionChanged
                          ? '问题已修改，点击“开始分析”更新下方结果。'
                          : !sample && report
                            ? '本次分析已完成，结果对应的问题显示在下方。'
                            : '输入问题后，点击“开始分析”。'}
                </output>
                <div className="composer-bottom">
                  <span>工具计算 · 知识引用 · 人工复核</span>
                  <button
                    className="primary"
                    disabled={!ready || running || question.trim().length < 2}
                    onClick={() => void run()}
                  >
                    {running ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Send size={16} />
                    )}{' '}
                    {!ready ? '正在加载…' : running ? '分析中…' : '开始分析'}
                  </button>
                </div>
              </section>
              <div className="suggestions">
                <span>试一试</span>
                {presets.map((q, i) => (
                  <button
                    key={q}
                    disabled={!ready || running}
                    onClick={() => void run(q)}
                  >
                    {['销售与库存诊断', '补货风险排查', '退换货问答'][i]}
                    <ArrowUpRight size={12} />
                  </button>
                ))}
              </div>
              <section className="card report" aria-live="polite">
                <div className="section-head">
                  <div className="report-heading">
                    <span className="report-icon">
                      <FileJson size={18} />
                    </span>
                    <h2>分析结果</h2>
                    <span className="pill">
                      {running
                        ? '分析中'
                        : questionChanged
                          ? '待重新分析'
                          : sample
                            ? '示例报告'
                            : report
                              ? '已完成'
                              : error
                                ? '未完成'
                                : '等待分析'}
                    </span>
                  </div>
                  <button
                    className="icon-button"
                    disabled={!report || running}
                    title="导出 Markdown 报告"
                    aria-label="导出 Markdown 报告"
                    onClick={exportReport}
                  >
                    <Download size={17} />
                  </button>
                </div>
                {report ? (
                  <>
                    <div className="report-meta">
                      {report.storeName}
                      <span>·</span>
                      {sample ? '点击上方开始分析以创建新任务' : report.id}
                      <span className="mode-label">
                        {report.mode === 'rules'
                          ? '规则引擎'
                          : report.llm?.status === 'ok'
                            ? 'Python + LLM'
                            : 'Python 规则引擎'}
                      </span>
                    </div>
                    <p className="report-question">
                      <strong>
                        {questionChanged ? '上次问题：' : '本次问题：'}
                      </strong>
                      {report.query}
                    </p>
                    <Tabs
                      value={reportTab}
                      onValueChange={(v) => setReportTab(String(v))}
                    >
                      <TabsList variant="line" className="report-tabs">
                        <TabsTrigger value="summary">结论与行动</TabsTrigger>
                        <TabsTrigger value="sources">
                          引用来源 {report.citations.length}
                        </TabsTrigger>
                        <TabsTrigger value="trace">
                          调用记录 {report.trace.length}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="summary">
                        <h3>{report.title}</h3>
                        <p>{report.summary}</p>
                        {report.llm && (
                          <div className="llm-note">
                            <strong>LLM 补充摘要</strong>
                            <p>
                              {report.llm.status === 'ok'
                                ? report.llm.summary
                                : '模型不可用或输出校验未通过，已保留规则报告。'}
                            </p>
                            {report.llm.status === 'ok' && (
                              <small>
                                模型生成，需人工复核；引用：
                                {report.llm.citations?.join('、')}
                              </small>
                            )}
                          </div>
                        )}
                        <div className="findings">
                          {report.findings.map((f, i) => (
                            <div key={i} className="finding">
                              <span className="finding-index">
                                {String(i + 1).padStart(2, '0')}
                              </span>
                              <div>
                                <h4>{f.label}</h4>
                                <p>{f.text}</p>
                                <button
                                  className="source-link"
                                  onClick={() => setReportTab('sources')}
                                >
                                  [{f.source}]<ArrowUpRight size={11} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        {report.intents.includes('sales') && (
                          <Trend storeId={report.storeId} />
                        )}
                        {report.inventory.length > 0 && (
                          <div className="inventory-wrap">
                            <div className="mini-heading">
                              商品补货建议<span>单位：件 / 天</span>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>商品</TableHead>
                                  <TableHead>现货</TableHead>
                                  <TableHead>可售天数</TableHead>
                                  <TableHead>在途</TableHead>
                                  <TableHead>建议补货</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {report.inventory.map((p) => (
                                  <TableRow key={p.sku}>
                                    <TableCell>
                                      <span className="sku-name">{p.name}</span>
                                      <small>
                                        {p.sku} · 日均 {p.daily} 件
                                      </small>
                                    </TableCell>
                                    <TableCell>{p.stock}</TableCell>
                                    <TableCell>
                                      <span
                                        className={
                                          p.days < p.leadDays
                                            ? 'stock-warning'
                                            : ''
                                        }
                                      >
                                        {p.days.toFixed(1)} 天
                                      </span>
                                    </TableCell>
                                    <TableCell>{p.inbound}</TableCell>
                                    <TableCell>
                                      <strong>{p.reorder || '—'}</strong>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                        {report.actions.length > 0 && (
                          <div className="actions">
                            <div className="mini-heading">
                              建议行动<span>待人工确认</span>
                            </div>
                            {report.actions.map((a, i) => (
                              <div className="action" key={i}>
                                <span className="priority">{a.priority}</span>
                                <div>
                                  <h4>{a.title}</h4>
                                  <p>{a.detail}</p>
                                  <button
                                    className="source-link"
                                    onClick={() => setReportTab('sources')}
                                  >
                                    [{a.source}]<ArrowUpRight size={11} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="report-note">
                          <ShieldCheck size={17} />
                          {report.notice}
                        </div>
                      </TabsContent>
                      <TabsContent value="sources">
                        <div className="source-list">
                          {report.citations.length ? (
                            report.citations.map((c) => (
                              <article key={c.id} className="source-card">
                                <div>
                                  <span className="pill">{c.id}</span>
                                  <h4>{c.title}</h4>
                                </div>
                                <pre>{c.content}</pre>
                                {'score' in c && (
                                  <small>
                                    检索分数 {c.score} · 用于排序，不是置信概率
                                  </small>
                                )}
                              </article>
                            ))
                          ) : (
                            <p className="empty-copy">
                              本次返回拒答或资料不足，没有可引用资料。
                            </p>
                          )}
                        </div>
                      </TabsContent>
                      <TabsContent value="trace">
                        <p className="trace-note">
                          以下是实际输入、工具输出与校验记录；耗时为本次工具函数执行时间。
                        </p>
                        {report.trace.map((t, i) => (
                          <details className="trace-row" key={i}>
                            <summary>
                              <span className="trace-dot" />
                              <span>
                                <b>{t.role}</b>
                                <code>{t.tool}</code>
                              </span>
                              <small>{t.ms.toFixed(2)} ms</small>
                              <ChevronRight size={15} />
                            </summary>
                            <pre>
                              {JSON.stringify(
                                { input: t.input, output: t.output },
                                null,
                                2,
                              )}
                            </pre>
                          </details>
                        ))}
                      </TabsContent>
                    </Tabs>
                  </>
                ) : (
                  <div className="empty-state">
                    {running ? (
                      <LoaderCircle size={28} className="spin" />
                    ) : (
                      <Bot size={28} />
                    )}
                    <h3>
                      {running
                        ? '正在分析本次问题'
                        : error
                          ? '本次分析未完成'
                          : '准备好分析这家门店'}
                    </h3>
                    <p>
                      {running
                        ? '完成后将在这里显示新的结果。'
                        : error
                          ? '查看上方错误提示，修正后可再次点击“开始分析”。'
                          : '输入问题，或选择一个示例场景开始。'}
                    </p>
                  </div>
                )}
              </section>
            </div>
            <aside className="aside-column">
              <section className="workflow">
                <div className="eyebrow">AGENT WORKFLOW</div>
                <h2>协作过程，清晰可见</h2>
                <p>
                  {running
                    ? '正在执行工作流…'
                    : '有界角色编排 · 可追踪工具调用'}
                </p>
                {[
                  ['01', '任务规划', 'Planner', 'route_task'],
                  ['02', '知识检索', 'Knowledge Agent', 'search_knowledge'],
                  ['03', '数据分析', 'Data Agent', 'sales / inventory'],
                  ['04', '结果复核', 'Reviewer', 'validate_report'],
                ].map((x) => {
                  const count =
                    report?.trace.filter((t) => t.role === x[2]).length || 0;
                  return (
                    <div
                      className={'flow-step ' + (!count ? 'step-idle' : '')}
                      key={x[0]}
                    >
                      <span className="step-number">{x[0]}</span>
                      <div>
                        <h3>{x[1]}</h3>
                        <p>
                          {count
                            ? count + ' 次调用 · ' + x[2]
                            : running
                              ? '等待结果'
                              : x[3]}
                        </p>
                      </div>
                      {count ? (
                        <Check size={16} />
                      ) : (
                        <span className="idle-dot" />
                      )}
                    </div>
                  );
                })}
                <div className="workflow-foot">
                  <ShieldCheck size={17} />
                  {report?.review.passed
                    ? '复核通过 · 引用可解析'
                    : '分析建议需人工确认'}
                  <ArrowUpRight size={16} />
                </div>
              </section>
              <section className="context-card">
                <div className="mini-heading">
                  <BookOpen size={16} />
                  本次工作上下文
                </div>
                <div className="context-row">
                  <span>数据范围</span>
                  <strong>3 家门店 · 6 类商品</strong>
                </div>
                <div className="context-row">
                  <span>知识片段</span>
                  <strong>{dataset.knowledge.length} 条模拟制度</strong>
                </div>
                <div className="context-row">
                  <span>执行权限</span>
                  <strong>
                    <span className="tiny-dot" />
                    只读分析
                  </strong>
                </div>
                <div className="context-row">
                  <span>引擎状态</span>
                  <strong>
                    {report?.mode === 'python' ? 'Python API' : '内置规则编排'}
                  </strong>
                </div>
                <p>
                  门店报告基于规则与制度检索；上方补货决策台支持本地模型解析，参数可核对、修改后重算。
                </p>
                <button
                  className="text-button"
                  onClick={() => setTab('project')}
                >
                  查看技术说明
                  <ArrowRight size={14} />
                </button>
              </section>
              {history.length > 0 && (
                <section className="history-card">
                  <div className="mini-heading">
                    <Activity size={16} />
                    当前会话任务
                  </div>
                  {history.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setReport(r);
                        setStoreId(r.storeId);
                        setQuestion(r.query);
                        setSample(false);
                        setReportTab('summary');
                      }}
                    >
                      <span>{r.query}</span>
                      <small>{r.storeName}</small>
                      <ArrowUpRight size={13} />
                    </button>
                  ))}
                  <p>页面刷新后清空；Python 服务另存本地运行记录。</p>
                </section>
              )}
              <div className="aside-note">
                <Workflow size={16} />
                <span>任务规划 → 证据获取 → 工具计算 → 引用校验</span>
              </div>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="knowledge">
          <section className="page-header">
            <div>
              <div className="eyebrow">KNOWLEDGE BASE</div>
              <h2>让建议有据可查</h2>
              <p>
                {dataset.knowledge.length}{' '}
                条原创模拟制度，支持中文检索；匹配分数用于排序，不代表准确率。
              </p>
            </div>
            <label className="search-box">
              <Search size={18} />
              <input
                aria-label="搜索知识库"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索补货、退换货、陈列…"
              />
            </label>
          </section>
          <div className="knowledge-grid">
            {docs.length ? (
              docs.map((d) => (
                <article className="knowledge-card card" key={d.id}>
                  <div className="knowledge-top">
                    <span className="document-icon">
                      <BookOpen size={20} />
                    </span>
                    <span>{d.category}</span>
                    <code>{d.id}</code>
                  </div>
                  <h3>{d.title}</h3>
                  <p>{d.content}</p>
                  <div className="knowledge-tags">
                    {d.keywords.slice(0, 4).map((k) => (
                      <span key={k}>{k}</span>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    disabled={!ready || running}
                    onClick={() => {
                      setTab('workspace');
                      void run('请说明' + d.title);
                    }}
                  >
                    以此发起问答
                    <ArrowUpRight size={14} />
                  </button>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <Search size={30} />
                <h3>没有找到相关依据</h3>
                <p>尝试“补货”“退款”或“陈列”。无匹配时，助手会说明资料不足。</p>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="eval">
          <section className="page-header">
            <div>
              <div className="eyebrow">EVALUATION LAB</div>
              <h2>把效果放到同一把尺子上</h2>
              <p>在相同演示用例上，对比关键词基线与中文 BM25 + 关键词检索。</p>
            </div>
            <button
              className="primary"
              onClick={() => void runEval()}
              disabled={evaluating}
            >
              {evaluating ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Play size={16} />
              )}{' '}
              {evaluating
                ? '运行中…'
                : evalResult
                  ? '重新运行评测'
                  : `运行 ${dataset.evaluation.length} 条评测`}
            </button>
          </section>
          {evalResult ? (
            <>
              <div className="eval-metrics">
                <div className="metric">
                  <span>基线 Recall@3</span>
                  <strong>
                    {(evalResult.baselineRecall * 100).toFixed(1)}
                    <em>%</em>
                  </strong>
                  <small>关键词精确匹配</small>
                </div>
                <div className="metric accent-metric">
                  <span>改进 Recall@3</span>
                  <strong>
                    {(evalResult.recall * 100).toFixed(1)}
                    <em>%</em>
                  </strong>
                  <small>中文二元词组 + BM25</small>
                </div>
                <div className="metric">
                  <span>意图首分类准确率</span>
                  <strong>
                    {(evalResult.intentAccuracy * 100).toFixed(1)}
                    <em>%</em>
                  </strong>
                  <small>{evalResult.total} 条演示问题</small>
                </div>
                <div className="metric">
                  <span>拒答边界通过</span>
                  <strong>
                    {evalResult.safetyPass}
                    <em>/ {evalResult.safetyCount}</em>
                  </strong>
                  <small>本次计算耗时 {evalResult.ms} ms</small>
                </div>
              </div>
              <div className="eval-disclaimer">
                <FlaskConical size={18} />
                {evalResult.disclaimer} 仅含 {evalResult.retrievalCount}{' '}
                条有标准引用的问题。
              </div>
              <section className="card eval-table">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>用例 / 问题</TableHead>
                      <TableHead>预期引用</TableHead>
                      <TableHead>基线 Top 3</TableHead>
                      <TableHead>改进 Top 3</TableHead>
                      <TableHead>意图匹配</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evalResult.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <small>{r.id}</small>
                          {r.query}
                        </TableCell>
                        <TableCell>{r.expected || '应拒答'}</TableCell>
                        <TableCell>
                          <span
                            className={
                              r.expected
                                ? r.baselineHit
                                  ? 'pass'
                                  : 'fail'
                                : ''
                            }
                          >
                            {r.baseline.join(' · ') || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              r.expected
                                ? r.improvedHit
                                  ? 'pass'
                                  : 'fail'
                                : ''
                            }
                          >
                            {r.improved.join(' · ') || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={r.intentPass ? 'pass' : 'fail'}>
                            {r.intentPass
                              ? '通过'
                              : r.predicted + ' ≠ ' + r.intent}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            </>
          ) : (
            <div className="eval-empty card">
              <span className="eval-icon">
                <FlaskConical size={34} />
              </span>
              <h3>先运行，再看结果</h3>
              <p>
                {dataset.evaluation.filter((e) => e.expected).length} 条检索用例
                + {dataset.evaluation.filter((e) => !e.expected).length}{' '}
                条边界用例。
                <br />
                结果由当前代码计算，保留失败项供后续改进。
              </p>
              <div className="eval-method">
                <span>
                  01
                  <br />
                  <b>同一批问题</b>
                </span>
                <ArrowRight size={20} />
                <span>
                  02
                  <br />
                  <b>两种检索策略</b>
                </span>
                <ArrowRight size={20} />
                <span>
                  03
                  <br />
                  <b>逐条比对引用</b>
                </span>
              </div>
            </div>
          )}
        </TabsContent>
        <TabsContent value="project">
          <section className="page-header">
            <div>
              <div className="eyebrow">SYSTEM OVERVIEW</div>
              <h2>RetailOS · 零售运营分析助手</h2>
              <p>连接经营数据、制度检索和只读工具，保留可追溯的分析过程。</p>
            </div>
            <span className="pill">v0.2.0</span>
          </section>
          <div className="project-grid">
            <section className="card project-section">
              <h3>分析流程</h3>
              <div className="architecture">
                {[
                  ['Planner', '识别问题类型，确定分析范围'],
                  ['Knowledge Agent', '检索制度并读取必要规则'],
                  ['Data Agent', '计算销售指标与库存风险'],
                  ['Reviewer', '校验来源编号与操作边界'],
                ].map((item, index) => (
                  <div key={item[0]}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <b>{item[0]}</b>
                    <p>{item[1]}</p>
                  </div>
                ))}
              </div>
              <p>
                门店分析采用预定义角色编排；单商品补货由本地 Ollama
                提出工具调用，经过参数校验后执行 Python
                函数。两条流程都保留执行依据。
              </p>
            </section>
            <section className="card project-section">
              <h3>系统组成</h3>
              {[
                ['工作台', 'React / TypeScript · 分析、知识检索与评测'],
                ['业务服务', 'FastAPI · 参数校验、工具接口和运行记录'],
                ['知识检索', '中文二元词组 BM25 · 关键词加权与 Top-K 返回'],
                ['工具与技能', '销售汇总、库存风险和制度检索的独立调用入口'],
                ['验证', '业务公式、接口契约、引用校验与异常回退'],
              ].map((item) => (
                <div className="skill-row" key={item[0]}>
                  <b>{item[0]}</b>
                  <span>{item[1]}</span>
                </div>
              ))}
            </section>
            <section className="card project-section">
              <h3>数据与运行范围</h3>
              <ul>
                <li>
                  3 家模拟门店、6 类商品和 {dataset.knowledge.length}{' '}
                  条制度，均使用合成数据。
                </li>
                <li>分析基于页面所示固定周期，不连接实时门店系统。</li>
                <li>工具只读；采购、调拨、退款和改价需人工确认执行。</li>
                <li>Python 服务使用本地 SQLite 保存运行记录。</li>
                <li>
                  模型提取参数需人工复核；支持修改参数重算。引用编号有效不代表语义已经验证。
                </li>
              </ul>
            </section>
            <section className="card project-section">
              <h3>评测方法</h3>
              <p>
                对同一批固定问题分别执行关键词检索与 BM25
                检索，检查目标制度是否出现在前 3 条结果中。
              </p>
              <ul>
                <li>
                  {dataset.evaluation.filter((e) => e.expected).length}{' '}
                  条问题具有标准制度引用，计算 Recall@3。
                </li>
                <li>4 条边界问题检查资料不足与越权请求的处理。</li>
                <li>保留逐条结果，便于定位检索和意图分类问题。</li>
                <li>固定用例用于回归验证，不代表实际业务准确率。</li>
              </ul>
              <button className="primary" onClick={() => setTab('eval')}>
                打开评测实验室
                <ArrowRight size={16} />
              </button>
            </section>
          </div>
        </TabsContent>
      </Tabs>
      <footer>
        RETAILOS / RETAIL OPERATIONS
        <span>合成演示数据 · 分析建议需人工确认</span>
      </footer>
    </main>
  );
}
