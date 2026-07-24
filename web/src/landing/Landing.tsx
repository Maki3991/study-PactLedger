import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Bot,
  Check,
  CircleDollarSign,
  CircleOff,
  Database,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  Network,
  ReceiptText,
  ShieldCheck,
  Store,
  WalletCards,
  Zap,
} from 'lucide-react'
import type {
  PactLedgerBaseStatus,
  PactLedgerExecutionState,
  PactLedgerTrace,
} from '../domain/pactledger'
import {
  createPoolMateDemoIntentId,
  fetchPactLedgerBaseStatus,
  runPoolMateCheckout,
} from '../services/pactledgerClient'

const executionCopy: Record<PactLedgerExecutionState, { label: string; detail: string; tone: string }> = {
  mock_ready: {
    label: 'MOCK READY',
    detail: '当前结算为可复现 Mock；不会生成 Explorer 链接。',
    tone: 'mock',
  },
  testnet_configuration_required: {
    label: 'TESTNET CONFIG REQUIRED',
    detail: 'SDK 路径已实现；钱包、denom 或收款地址仍未配置完整。',
    tone: 'pending',
  },
  testnet_ready: {
    label: 'TESTNET READY · UNCONFIRMED',
    detail: '服务端具备广播条件，但数据库中尚无已确认 Testnet Receipt。',
    tone: 'pending',
  },
  testnet_confirmed: {
    label: 'TESTNET CONFIRMED',
    detail: '已发现持久化的 Injective Testnet Receipt，可打开 Explorer 核验。',
    tone: 'confirmed',
  },
}

const baseCapabilities = [
  {
    icon: WalletCards,
    title: 'Agent Account',
    detail: '给 Agent 分配预算与账户，但不把任意签名权交给 Agent。',
  },
  {
    icon: Fingerprint,
    title: 'Payment Intent',
    detail: 'Agent 只能提交“向谁、为何、花多少”的结构化付款意图。',
  },
  {
    icon: ShieldCheck,
    title: 'Policy Decision',
    detail: '用途、白名单、限额、有效期和人工批准逐项留下理由。',
  },
  {
    icon: Blocks,
    title: 'Injective Settlement',
    detail: '批准后的服务费或商户付款才会进入测试网结算适配器。',
  },
  {
    icon: ReceiptText,
    title: 'Receipt Ledger',
    detail: '成功、拒绝与失败都形成同一条可恢复、可审计 Trace。',
  },
]

const injectiveReasons = [
  { value: '< 1s', label: '亚秒级出块', detail: 'Agent 不必为每次小额服务采购等待漫长确认。' },
  { value: '≈ 0', label: '接近零 Gas', detail: '让高频 Agent 微支付在经济上真正可行。' },
  { value: 'L1', label: '原生结算层', detail: '交易哈希、区块高度和事件构成公开证据。' },
  { value: '24/7', label: '机器经济轨道', detail: '适合 Agent-to-Agent 与 Agent-to-Merchant 持续结算。' },
]

export function Landing() {
  const [baseStatus, setBaseStatus] = useState<PactLedgerBaseStatus>()
  const [statusError, setStatusError] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    fetchPactLedgerBaseStatus(controller.signal)
      .then(setBaseStatus)
      .catch((error) => {
        if (!controller.signal.aborted) {
          setStatusError(error instanceof Error ? error.message : '无法读取基座状态')
        }
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="pl-page">
      <a className="pl-skip" href="#main">跳到主要内容</a>
      <header className="pl-nav">
        <a className="pl-brand" href="#top" aria-label="PactLedger 首页">
          <span className="pl-brand-mark"><LockKeyhole size={15} /></span>
          <span><strong>PactLedger</strong><small>Agent Spend Control</small></span>
        </a>
        <nav aria-label="首页导航">
          <a href="#base">基座</a>
          <a href="#injective">Injective</a>
          <a href="#proof">实例证明</a>
        </nav>
        <a className="pl-nav-cta" href="/kaleidox.html">运行主 Demo <ArrowRight size={14} /></a>
      </header>

      <main id="main">
        <section className="pl-hero" id="top">
          <div className="pl-hero-copy">
            <p className="pl-track"><span>PRIMARY TRACK</span> INJECTIVE BLOCKCHAIN × AI</p>
            <h1>Agent 可以提出花钱。<br /><em>只有规则允许它真正花钱。</em></h1>
            <p className="pl-lead">
              PactLedger 是 Agent 的可编程财务控制层。业务 Agent 不持有自由支配的资金权限；
              每一笔服务采购或商户付款都必须经过 Intent、Policy、按需人工批准、Injective 结算与 Receipt。
            </p>
            <div className="pl-hero-actions">
              <a className="pl-button pl-button-primary" href="/kaleidox.html">
                看 KaleidoX 风险压力测试 <ArrowRight size={16} />
              </a>
              <a className="pl-button pl-button-secondary" href="/poolmate.html">
                看 PoolMate 跨场景复用
              </a>
            </div>
            <p className="pl-truth-note">
              <CircleOff size={13} /> PandaAI 提供 A 股数据；Injective 只结算 Agent 服务费与商户付款，不交易 A 股。
            </p>
          </div>

          <RuntimeConsole status={baseStatus} error={statusError} />
        </section>

        <section className="pl-injective" id="injective" aria-labelledby="injective-title">
          <div className="pl-section-label"><span>01</span> WHY INJECTIVE</div>
          <div className="pl-injective-intro">
            <h2 id="injective-title">不是把区块链贴在页脚。<br />它是 Agent 付款的结算轨道。</h2>
            <p>
              Policy 决定“能不能付”，Injective 证明“是否真的付了”。快速确认与极低费用让大量小额、自动化的 Agent 服务采购具备可行性。
            </p>
          </div>
          <div className="pl-injective-grid">
            {injectiveReasons.map((reason) => (
              <article key={reason.label}>
                <strong>{reason.value}</strong>
                <h3>{reason.label}</h3>
                <p>{reason.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pl-base" id="base" aria-labelledby="base-title">
          <div className="pl-section-label"><span>02</span> THE CONTROL PLANE</div>
          <div className="pl-base-heading">
            <div>
              <h2 id="base-title">基座负责财务制度。<br />实例只负责业务。</h2>
              <p>股票研究、群聊拼单都可以变化；下面五个金融原语保持不变。</p>
            </div>
            <code>Intent → PolicyDecision → Approval? → Settlement → Receipt</code>
          </div>
          <div className="pl-capability-list">
            {baseCapabilities.map((capability, index) => (
              <article key={capability.title}>
                <span className="pl-cap-index">{String(index + 1).padStart(2, '0')}</span>
                <capability.icon size={18} />
                <h3>{capability.title}</h3>
                <p>{capability.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pl-proof" id="proof" aria-labelledby="proof-title">
          <div className="pl-section-label"><span>03</span> TWO PROOF CASES</div>
          <div className="pl-proof-head">
            <h2 id="proof-title">业务换了，控制层没有换。</h2>
            <p>一个实例证明高风险场景下必须踩刹车；另一个证明基座不是股票专用代码。</p>
          </div>
          <div className="pl-apps">
            <a className="pl-app pl-app-kx" href="/kaleidox.html">
              <span className="pl-app-type">REFERENCE APP 01 · RISK PRESSURE TEST</span>
              <Bot size={22} />
              <h3>KaleidoX</h3>
              <p>股票 Agent 研究 A 股、比较策略并生成 Broker-ready 指令；PactLedger 约束预算、仓位、批准与 Agent 服务费。</p>
              <ul>
                <li><Check size={13} /> PandaAI 数据或明确 Replay</li>
                <li><Check size={13} /> 40% 仓位建议被独立风控拒绝</li>
                <li><Check size={13} /> Injective 结算 Risk / Execution 服务费</li>
              </ul>
              <span className="pl-app-link">打开控制台 <ArrowRight size={14} /></span>
            </a>
            <a className="pl-app pl-app-pm" href="/poolmate.html">
              <span className="pl-app-type">REFERENCE APP 02 · CROSS-DOMAIN REUSE</span>
              <Store size={22} />
              <h3>PoolMate</h3>
              <p>群聊 Agent 只新增消息理解、拼单状态与商户 checkout；账户、白名单、Intent、Policy 与 Receipt 全部复用。</p>
              <ul>
                <li><Check size={13} /> 白名单商户付款通过</li>
                <li><Check size={13} /> “把钱转给我”被 Policy 拒绝</li>
                <li><Check size={13} /> 拒绝请求不会进入 Settlement Adapter</li>
              </ul>
              <span className="pl-app-link">打开复用证明 <ArrowRight size={14} /></span>
            </a>
          </div>

          <BaseTraceLab />
        </section>

        <section className="pl-close">
          <div>
            <BadgeCheck size={22} />
            <p>评委只需要记住一句话</p>
            <h2>业务 Agent 可以进化，<br />它永远不能进化自己的资金权限。</h2>
          </div>
          <a className="pl-button pl-button-primary" href="/kaleidox.html">开始 90 秒主 Demo <ArrowRight size={16} /></a>
        </section>
      </main>

      <footer className="pl-footer">
        <span><strong>PactLedger</strong> · Agent Treasury / Agent Spend Control</span>
        <span>Injective Testnet · PandaAI · A2A · PostgreSQL</span>
      </footer>
    </div>
  )
}

function RuntimeConsole({ status, error }: { status?: PactLedgerBaseStatus; error?: string }) {
  const stateCopy = status ? executionCopy[status.execution.state] : undefined
  const flow = status?.flow ?? ['Agent Intent', 'PactLedger Policy', 'Injective Settlement', 'Verifiable Receipt']
  const icons = [Fingerprint, ShieldCheck, Blocks, FileCheck2]

  return (
    <aside className="pl-runtime" aria-label="PactLedger 实时运行状态">
      <div className="pl-runtime-head">
        <span><i /> PACTLEDGER / RUNTIME</span>
        <strong className={`pl-runtime-state ${stateCopy?.tone ?? 'loading'}`}>
          {!stateCopy && !error && <LoaderCircle size={12} className="pl-spin" />}
          {error ? 'STATUS UNAVAILABLE' : stateCopy?.label ?? 'READING STATUS'}
        </strong>
      </div>
      <div className="pl-runtime-flow">
        {flow.map((step, index) => {
          const Icon = icons[index]
          const settlementPending = index >= 2 && status?.execution.state === 'testnet_configuration_required'
          return (
            <div className={`pl-runtime-step ${settlementPending ? 'pending' : ''}`} key={step}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <Icon size={17} />
              <div>
                <strong>{step}</strong>
                <small>{flowDetail(index)}</small>
              </div>
              {index < flow.length - 1 && <ArrowRight size={14} />}
            </div>
          )
        })}
      </div>
      <div className="pl-runtime-note" role="status">
        {error ?? stateCopy?.detail ?? '正在读取服务端脱敏状态…'}
      </div>
      <dl className="pl-runtime-grid">
        <RuntimeDatum label="Chain" value={status?.execution.chainId ?? '—'} />
        <RuntimeDatum label="Signer" value={truthValue(status?.execution.walletConfigured)} />
        <RuntimeDatum label="Payment asset" value={truthValue(status?.execution.paymentAssetConfigured)} />
        <RuntimeDatum label="Payees" value={truthValue(status?.execution.payeesConfigured)} />
        <RuntimeDatum label="Receipt store" value={status?.execution.receiptPersistence ?? '—'} />
        <RuntimeDatum label="Adapter" value={status?.execution.adapter ?? '—'} />
      </dl>
      {status?.execution.latestConfirmedReceipt?.explorerUrl ? (
        <a className="pl-explorer" href={status.execution.latestConfirmedReceipt.explorerUrl} target="_blank" rel="noreferrer">
          <span><Database size={14} /> 已持久化 Testnet Receipt</span>
          <strong>{shorten(status.execution.latestConfirmedReceipt.transactionHash)}</strong>
          <ExternalLink size={14} />
        </a>
      ) : (
        <div className="pl-no-receipt"><Database size={14} /> 当前没有可公开核验的已持久化 Testnet Receipt</div>
      )}
    </aside>
  )
}

function RuntimeDatum({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}

function BaseTraceLab() {
  const [trace, setTrace] = useState<PactLedgerTrace>()
  const [running, setRunning] = useState<'approved' | 'blocked'>()
  const [error, setError] = useState<string>()

  const run = async (scenario: 'approved' | 'blocked') => {
    setRunning(scenario)
    setError(undefined)
    try {
      setTrace(await runPoolMateCheckout(scenario, createPoolMateDemoIntentId()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '基座验证失败')
    } finally {
      setRunning(undefined)
    }
  }

  const rejected = trace?.decision.outcome === 'rejected'
  return (
    <div className="pl-lab">
      <div className="pl-lab-copy">
        <span>LIVE API PROOF · SAFE MOCK SETTLEMENT</span>
        <h3>十秒看懂基座：<br />合法付款通过，骗转账当场拒绝。</h3>
        <p>
          两个按钮都调用生产 Fastify 中的同一个 Payment Intent、Policy Engine 与 Receipt Service。
          为避免公开页面触发真实资金，本验证固定使用 Mock Adapter，并明确标注。
        </p>
        <div className="pl-lab-actions">
          <button type="button" onClick={() => void run('approved')} disabled={Boolean(running)}>
            {running === 'approved' ? <LoaderCircle size={15} className="pl-spin" /> : <CircleDollarSign size={15} />}
            运行白名单付款
          </button>
          <button className="danger" type="button" onClick={() => void run('blocked')} disabled={Boolean(running)}>
            {running === 'blocked' ? <LoaderCircle size={15} className="pl-spin" /> : <CircleOff size={15} />}
            测试“把钱转给我”
          </button>
        </div>
        {error && <p className="pl-lab-error" role="alert">{error}</p>}
      </div>

      <div className={`pl-trace ${rejected ? 'rejected' : ''}`} aria-live="polite">
        {!trace ? (
          <div className="pl-trace-empty">
            <Network size={24} />
            <strong>等待一笔真实 API 请求</strong>
            <span>运行任一场景后，这里将显示完整 Intent → Policy → Settlement → Receipt。</span>
          </div>
        ) : (
          <>
            <div className="pl-trace-head">
              <span>{trace.intent.id}</span>
              <strong>{trace.intent.amount} {trace.intent.currency}</strong>
            </div>
            <div className="pl-trace-route">
              <TraceNode icon={Fingerprint} label="INTENT" value={trace.intent.purpose} state="pass" />
              <ArrowRight size={13} />
              <TraceNode icon={ShieldCheck} label="POLICY" value={trace.decision.code} state={rejected ? 'fail' : 'pass'} />
              <ArrowRight size={13} />
              <TraceNode icon={Zap} label="SETTLEMENT" value={rejected ? 'SKIPPED' : 'MOCK'} state={rejected ? 'skip' : 'pass'} />
              <ArrowRight size={13} />
              <TraceNode icon={ReceiptText} label="RECEIPT" value={rejected ? 'NOT CREATED' : 'MOCK RECEIPT'} state={rejected ? 'skip' : 'pass'} />
            </div>
            <div className="pl-trace-verdict">
              {rejected ? <CircleOff size={17} /> : <BadgeCheck size={17} />}
              <div><span>{trace.decision.id}</span><strong>{trace.decision.reason}</strong></div>
            </div>
            <div className="pl-trace-checks">
              {trace.decision.checks.map((check) => (
                <p className={check.passed ? 'pass' : 'fail'} key={check.code}>
                  <span>{check.passed ? <Check size={11} /> : <CircleOff size={11} />}{check.label}</span>
                  <strong>{check.detail}</strong>
                </p>
              ))}
            </div>
            {trace.receipt?.transactionHash && (
              <code className="pl-mock-hash">{trace.receipt.transactionHash} · no explorer</code>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TraceNode({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: typeof Gauge
  label: string
  value: string
  state: 'pass' | 'fail' | 'skip'
}) {
  return <div className={state}><Icon size={14} /><span><small>{label}</small><strong>{value}</strong></span></div>
}

function flowDetail(index: number): string {
  return [
    'Agent 只能提出付款意图',
    '预算、用途、白名单与审批',
    '批准后才进入测试网广播',
    '哈希、区块、Explorer 与持久化',
  ][index]
}

function truthValue(value: boolean | undefined): string {
  if (value === undefined) return '—'
  return value ? 'configured' : 'missing'
}

function shorten(value?: string): string {
  if (!value) return '—'
  return value.length > 22 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value
}
