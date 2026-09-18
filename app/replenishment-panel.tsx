'use client';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Download,
  History,
  LoaderCircle,
  Package,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

type Inputs = {
  daily: number;
  stock: number;
  inbound: number;
  lead_days: number;
  safety_days: number;
};
type Reply = {
  id: string;
  createdAt: string;
  query: string;
  mode: 'ollama' | 'manual';
  status: 'completed' | 'not_calculated';
  message: string;
  persisted: boolean;
  arguments?: Inputs;
  result?: { target: number; reorder: number };
  trace: { step: string; ms: number; input: unknown; output: unknown }[];
};
type Services = { backend: string; ollama: string; model: string };
const fields: {
  key: keyof Inputs;
  label: string;
  unit: string;
  max: number;
  step: string;
}[] = [
  {
    key: 'daily',
    label: '日均销量',
    unit: '件 / 天',
    max: 1_000_000,
    step: 'any',
  },
  {
    key: 'stock',
    label: '当前现货',
    unit: '件',
    max: 1_000_000_000,
    step: '1',
  },
  {
    key: 'inbound',
    label: '确认在途',
    unit: '件',
    max: 1_000_000_000,
    step: '1',
  },
  { key: 'lead_days', label: '采购提前期', unit: '天', max: 365, step: 'any' },
  { key: 'safety_days', label: '安全天数', unit: '天', max: 365, step: 'any' },
];
const examples = [
  [
    '常规补货',
    '日均销量18件，现货42件，在途12件，采购提前期3天，安全天数2天，需要补货多少？',
  ],
  [
    '库存充足',
    '日均销量18件，现货100件，在途12件，采购提前期3天，安全天数2天，需要补货多少？',
  ],
];
const traceNames: Record<string, string> = {
  ollama: '本地模型提出工具调用',
  validate_arguments: '检查参数类型与范围',
  calculate_replenishment: '执行补货计算函数',
};

function isReply(value: unknown): value is Reply {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<Reply>;
  return (
    typeof r.id === 'string' &&
    typeof r.query === 'string' &&
    typeof r.message === 'string' &&
    typeof r.createdAt === 'string' &&
    ['ollama', 'manual'].includes(r.mode || '') &&
    Array.isArray(r.trace) &&
    r.trace.every(
      (t) => t && typeof t.step === 'string' && typeof t.ms === 'number',
    ) &&
    (r.status === 'not_calculated' ||
      (r.status === 'completed' &&
        !!r.arguments &&
        !!r.result &&
        fields.every(
          (f) =>
            typeof r.arguments?.[f.key] === 'number' &&
            Number.isFinite(r.arguments[f.key]),
        ) &&
        Number.isFinite(r.result.target) &&
        Number.isFinite(r.result.reorder)))
  );
}

async function readServices(): Promise<Services> {
  const res = await fetch('/api/status', {
    signal: AbortSignal.timeout(8_000),
  });
  const data: unknown = await res.json();
  if (
    !res.ok ||
    !data ||
    typeof data !== 'object' ||
    !('backend' in data) ||
    typeof data.backend !== 'string' ||
    !('ollama' in data) ||
    typeof data.ollama !== 'string' ||
    !('model' in data) ||
    typeof data.model !== 'string'
  )
    throw new Error();
  return { backend: data.backend, ollama: data.ollama, model: data.model };
}

async function readHistory(): Promise<Reply[]> {
  const res = await fetch('/api/replenishment', {
    signal: AbortSignal.timeout(8_000),
  });
  const data: unknown = await res.json();
  if (!res.ok || !Array.isArray(data) || !data.every(isReply))
    throw new Error();
  return data;
}

export default function ReplenishmentPanel({ ready }: { ready: boolean }) {
  const [query, setQuery] = useState(examples[0][1]);
  const [mode, setMode] = useState<'ollama' | 'manual'>('ollama');
  const [form, setForm] = useState<Record<keyof Inputs, string>>({
    daily: '18',
    stock: '42',
    inbound: '12',
    lead_days: '3',
    safety_days: '2',
  });
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState('');
  const [services, setServices] = useState<Services | null>(null);
  const [checking, setChecking] = useState(true);
  const [history, setHistory] = useState<Reply[]>([]);
  const [historyError, setHistoryError] = useState('');

  async function checkServices() {
    try {
      setServices(await readServices());
    } catch {
      setServices({ backend: 'offline', ollama: 'unknown', model: '' });
    } finally {
      setChecking(false);
    }
  }
  async function loadHistory() {
    try {
      setHistory(await readHistory());
      setHistoryError('');
    } catch {
      setHistoryError('暂时无法读取历史记录。连接后端后可刷新。');
    }
  }
  useEffect(() => {
    let active = true;
    void readServices()
      .then((data) => {
        if (active) setServices(data);
      })
      .catch(() => {
        if (active)
          setServices({ backend: 'offline', ollama: 'unknown', model: '' });
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    void readHistory()
      .then((data) => {
        if (active) setHistory(data);
      })
      .catch(() => {
        if (active) setHistoryError('暂时无法读取历史记录。连接后端后可刷新。');
      });
    return () => {
      active = false;
    };
  }, []);

  function clearResult() {
    setReply(null);
    setError('');
  }
  function fillForm(args: Inputs) {
    setForm({
      daily: String(args.daily),
      stock: String(args.stock),
      inbound: String(args.inbound),
      lead_days: String(args.lead_days),
      safety_days: String(args.safety_days),
    });
  }
  function restore(item: Reply) {
    setReply(item);
    setQuery(item.query);
    setMode(item.mode);
    setError('');
    if (item.arguments) fillForm(item.arguments);
  }
  async function calculate() {
    if (!ready || running) return;
    setError('');
    setReply(null);
    const values = Object.fromEntries(
      fields.map((f) => [f.key, Number(form[f.key])]),
    ) as Inputs;
    if (
      mode === 'manual' &&
      fields.some(
        (f) =>
          form[f.key].trim() === '' ||
          !Number.isFinite(values[f.key]) ||
          values[f.key] < 0 ||
          values[f.key] > f.max ||
          (f.step === '1' && !Number.isInteger(values[f.key])),
      )
    ) {
      setError('请完整填写非负数字。现货与在途必须为整数，天数不超过365天。');
      return;
    }
    setRunning(true);
    try {
      const res = await fetch(
        mode === 'ollama'
          ? '/api/replenishment'
          : '/api/replenishment/calculate',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'ollama' ? { query: query.trim() } : values,
          ),
          signal: AbortSignal.timeout(200_000),
        },
      );
      const data: unknown = await res.json();
      if (!res.ok) {
        const message =
          data &&
          typeof data === 'object' &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : '请求未完成，请重试。';
        throw new Error(message);
      }
      if (!isReply(data)) throw new Error('返回格式异常，请重试。');
      setReply(data);
      if (data.arguments) fillForm(data.arguments);
      await loadHistory();
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError'
          ? '请求超时。可以重试，或手动填写参数计算。'
          : e instanceof Error
            ? e.message
            : '请求失败，请重试。',
      );
    } finally {
      setRunning(false);
    }
  }
  function download() {
    if (!reply) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(reply, null, 2)], {
        type: 'application/json;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = reply.id + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  const backendLabel = !services
    ? '检查连接中'
    : services.backend === 'online'
      ? '计算服务已连接'
      : services.backend === 'demo'
        ? '当前为网页演示模式'
        : '计算服务未连接';
  const modelLabel =
    services?.ollama === 'ready'
      ? `本地模型已就绪 · ${services.model}`
      : services?.ollama === 'model_missing'
        ? `尚未安装 ${services.model}`
        : services?.ollama === 'offline'
          ? '本地模型未连接，可手动填写'
          : '';
  const args = reply?.arguments;
  const days = args && args.daily > 0 ? args.stock / args.daily : null;

  return (
    <section
      className="card replenishment"
      aria-labelledby="replenishment-title"
    >
      <div className="repl-heading">
        <span className="repl-icon">
          <Package size={21} />
        </span>
        <div>
          <div className="eyebrow">LOCAL AGENT / 单商品决策</div>
          <h2 id="replenishment-title">补货决策台</h2>
        </div>
        <span className="pill">建议 · 人工确认</span>
      </div>
      <p className="repl-description">
        描述一个商品的需求，核对参数，再查看补货建议。此处使用你本次输入的数据。
      </p>
      <output className="service-strip">
        <span
          className={services?.backend === 'online' ? 'service-online' : ''}
        >
          <i />
          {backendLabel}
        </span>
        {modelLabel && <span>{modelLabel}</span>}
        <button
          type="button"
          aria-label="刷新服务状态"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void checkServices();
          }}
        >
          <RefreshCw size={14} className={checking ? 'spin' : ''} />
        </button>
      </output>
      {services && services.backend !== 'online' && (
        <p className="repl-help">
          在项目文件夹双击“启动完整项目.cmd”，等待启动完成后刷新连接。
        </p>
      )}
      <div className="repl-modes" aria-label="补货输入方式">
        <button
          type="button"
          aria-pressed={mode === 'ollama'}
          disabled={running}
          onClick={() => {
            setMode('ollama');
            clearResult();
          }}
        >
          <Sparkles size={15} />
          自然语言
        </button>
        <button
          type="button"
          aria-pressed={mode === 'manual'}
          disabled={running}
          onClick={() => {
            setMode('manual');
            clearResult();
          }}
        >
          手动填写参数
        </button>
      </div>
      {mode === 'ollama' ? (
        <>
          <textarea
            aria-label="单商品补货问题"
            value={query}
            maxLength={500}
            disabled={!ready || running}
            onChange={(e) => {
              setQuery(e.target.value);
              clearResult();
            }}
          />
          <div className="repl-examples">
            <span>试一试</span>
            {examples.map(([label, text]) => (
              <button
                key={label}
                disabled={running}
                onClick={() => {
                  setQuery(text);
                  clearResult();
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="repl-fields">
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type="number"
                aria-label={f.label}
                min={0}
                max={f.max}
                step={f.step}
                value={form[f.key]}
                disabled={running}
                onChange={(e) => {
                  setForm({ ...form, [f.key]: e.target.value });
                  clearResult();
                }}
              />
              <small>{f.unit}</small>
            </label>
          ))}
        </div>
      )}
      <div className="repl-submit">
        <span>
          {mode === 'ollama'
            ? '本地模型提取参数，Python 工具计算'
            : '直接调用同一个计算工具，无需请求模型'}
        </span>
        <button
          type="button"
          className="primary"
          disabled={
            !ready || running || (mode === 'ollama' && query.trim().length < 2)
          }
          onClick={() => void calculate()}
        >
          {running ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <ArrowRight size={16} />
          )}
          {running
            ? '处理中…'
            : mode === 'ollama'
              ? '解析并计算'
              : '按参数计算'}
        </button>
      </div>
      <output className="analysis-status">
        {running
          ? '正在处理，本地模型首次加载可能需要一些时间…'
          : reply?.status === 'not_calculated'
            ? reply.message
            : ''}
      </output>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {reply?.result && args && (
        <div className="repl-result" aria-live="polite">
          <div className="repl-result-heading">
            <strong>
              <Check size={16} />
              {reply.mode === 'ollama'
                ? '已计算 · 请核对模型提取的参数'
                : '已按手动填写参数计算'}
            </strong>
            <button className="text-button" onClick={download}>
              <Download size={14} />
              导出记录
            </button>
          </div>
          <div className="repl-numbers">
            <div>
              <span>目标库存</span>
              <strong>
                {reply.result.target}
                <small>件</small>
              </strong>
            </div>
            <div>
              <span>建议补货</span>
              <strong>
                {reply.result.reorder}
                <small>件</small>
              </strong>
            </div>
            <div>
              <span>现货可售</span>
              <strong>
                {days === null ? '—' : days.toFixed(1)}
                <small>天</small>
              </strong>
            </div>
          </div>
          <p className="repl-formula">
            目标库存 = 向上取整({args.daily} × ({args.lead_days} +{' '}
            {args.safety_days})) = {reply.result.target}；补货 = max(0,{' '}
            {reply.result.target} − {args.stock} − {args.inbound}) ={' '}
            {reply.result.reorder}
          </p>
          {days !== null && days < args.lead_days && (
            <p className="repl-warning">
              现货可售天数短于采购提前期。请核对在途到货时间；建议补货量不能保证到货前不断货。
            </p>
          )}
          <div className="repl-args">
            {fields.map((f) => (
              <span key={f.key}>
                {f.label}
                <b>{args[f.key]}</b>
              </span>
            ))}
          </div>
          <button
            className="text-button"
            onClick={() => {
              fillForm(args);
              setMode('manual');
              clearResult();
            }}
          >
            修改这些参数并重新计算
            <ArrowRight size={14} />
          </button>
          <p className="repl-save-note">
            {reply.persisted
              ? '已保存在本机，可从下方历史记录重新打开。'
              : '结果未写入本机历史，请导出记录保存。'}{' '}
            此建议没有创建采购订单。
          </p>
        </div>
      )}
      {reply && reply.trace.length > 0 && (
        <details className="repl-trace">
          <summary>查看本次执行过程 · {reply.trace.length} 个步骤</summary>
          {reply.trace.map((t, index) => (
            <details key={`${index}-${t.step}`}>
              <summary>
                {index + 1}. {traceNames[t.step] || t.step}
                <small>{t.ms} ms</small>
              </summary>
              <pre>
                {JSON.stringify({ input: t.input, output: t.output }, null, 2)}
              </pre>
            </details>
          ))}
        </details>
      )}
      <details className="repl-history">
        <summary>
          <History size={15} />
          最近补货记录 <span>{history.length} 条</span>
        </summary>
        <button
          className="text-button"
          disabled={running}
          onClick={() => void loadHistory()}
        >
          刷新记录
        </button>
        {historyError && <p>{historyError}</p>}
        {!historyError && history.length === 0 && (
          <p>完成计算后，记录会保存在本机。</p>
        )}
        {history.map((item) => (
          <button
            type="button"
            className="repl-history-item"
            key={item.id}
            disabled={running}
            onClick={() => restore(item)}
          >
            <span>
              {item.mode === 'ollama' ? '模型解析' : '手动参数'} · 建议补货{' '}
              {item.result?.reorder ?? '—'} 件
            </span>
            <small>{new Date(item.createdAt).toLocaleString('zh-CN')}</small>
          </button>
        ))}
      </details>
    </section>
  );
}
