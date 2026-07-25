import { useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Blocks,
  Bot,
  Check,
  CircleDollarSign,
  CircleOff,
  Fingerprint,
  Gauge,
  LoaderCircle,
  Network,
  ReceiptText,
  ShieldCheck,
  Store,
  WalletCards,
  Zap,
} from 'lucide-react'
import type { PactLedgerTrace } from '../domain/pactledger'
import {
  createPoolMateDemoIntentId,
  runPoolMateCheckout,
} from '../services/pactledgerClient'

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
  return (
    <div className="pl-page">
      <a className="pl-skip" href="#main">跳到主要内容</a>
      <header className="pl-nav">
        <a className="pl-brand" href="#top" aria-label="PactLedger 首页">
          <span className="pl-brand-mark"><img src="/pactledger-mark-light.png" alt="" /></span>
          <span><strong>PactLedger</strong><small>Agent Spend Control</small></span>
        </a>
        <nav aria-label="首页导航">
          <a href="#base">控制层</a>
          <a href="#proof">应用案例</a>
          <a href="#injective">结算</a>
        </nav>
      </header>

      <main id="main">
        <section className="pl-hero" id="top">
          <div className="pl-hero-copy">
            <img className="pl-hero-mark" src="/pactledger-mark-light.png" alt="" />
            <h1><span>PactLedger</span><strong>Agent 的资金控制层</strong></h1>
            <p className="pl-statement">Agent 可以提出花钱，规则决定是否放行</p>
            <p className="pl-lead">统一管理预算、审批、结算与可验证回执。</p>
            <div className="pl-hero-actions" aria-label="PactLedger 应用案例">
              <a className="pl-case-entry" href="/kaleidox.html">
                <span><small>应用案例 01</small><strong>KaleidoX</strong></span>
                <ArrowRight size={16} />
              </a>
              <a className="pl-case-entry" href="/poolmate.html">
                <span><small>应用案例 02</small><strong>PoolMate</strong></span>
                <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </section>

        <section className="pl-control-rail" aria-label="PactLedger 不可绕过的执行顺序">
          <div className="pl-control-rail-shell">
            <div className="pl-control-rail-title"><span>EVERY SPEND FOLLOWS</span><strong>不可绕过的执行顺序</strong></div>
            <ol>
              <li><span>01</span><strong>Intent</strong><small>提交付款意图</small></li>
              <li><span>02</span><strong>Policy</strong><small>校验预算与权限</small></li>
              <li><span>03</span><strong>Approval</strong><small>需要时由人批准</small></li>
              <li><span>04</span><strong>Settlement</strong><small>批准后才能结算</small></li>
              <li><span>05</span><strong>Receipt</strong><small>留下可审计回执</small></li>
            </ol>
          </div>
        </section>

        <section className="pl-base" id="base" aria-labelledby="base-title">
          <div className="pl-section-shell">
            <div className="pl-section-label"><span>01</span> 资金控制基座</div>
            <div className="pl-base-heading">
              <div>
                <h2 id="base-title">基座负责财务制度，<br />实例只负责业务。</h2>
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
          </div>
        </section>

        <section className="pl-proof" id="proof" aria-labelledby="proof-title">
          <div className="pl-section-shell">
            <div className="pl-section-label"><span>02</span> 两个应用案例</div>
            <div className="pl-proof-head">
              <h2 id="proof-title">两个案例，<br />同一套资金控制。</h2>
              <p>KaleidoX 与 PoolMate 共享账户、预算、策略、审批、结算与回执能力。</p>
            </div>
            <div className="pl-apps">
              <a className="pl-app pl-app-kx" href="/kaleidox.html">
                <span className="pl-app-number">01</span>
                <div className="pl-app-main">
                  <span className="pl-app-type">应用案例 · 股票研究</span>
                  <div className="pl-app-title"><Bot size={22} /><h3>KaleidoX</h3></div>
                  <p>股票 Agent 研究 A 股、比较策略并生成 Broker-ready 指令；PactLedger 约束预算、仓位、批准与 Agent 服务费。</p>
                  <span className="pl-app-link">打开 KaleidoX <ArrowRight size={14} /></span>
                </div>
                <ul>
                  <li><Check size={13} /> PandaAI 数据或明确 Replay</li>
                  <li><Check size={13} /> 40% 仓位建议被独立风控拒绝</li>
                  <li><Check size={13} /> Injective 结算 Risk / Execution 服务费</li>
                </ul>
              </a>
              <a className="pl-app pl-app-pm" href="/poolmate.html">
                <span className="pl-app-number">02</span>
                <div className="pl-app-main">
                  <span className="pl-app-type">应用案例 · 群聊拼单</span>
                  <div className="pl-app-title"><Store size={22} /><h3>PoolMate</h3></div>
                  <p>群聊 Agent 只新增消息理解、拼单状态与商户 checkout；账户、白名单、Intent、Policy 与 Receipt 全部复用。</p>
                  <span className="pl-app-link">打开 PoolMate <ArrowRight size={14} /></span>
                </div>
                <ul>
                  <li><Check size={13} /> 白名单商户付款通过</li>
                  <li><Check size={13} /> “把钱转给我”被 Policy 拒绝</li>
                  <li><Check size={13} /> 拒绝请求不会进入 Settlement Adapter</li>
                </ul>
              </a>
            </div>

            <BaseTraceLab />
          </div>
        </section>

        <section className="pl-injective" id="injective" aria-labelledby="injective-title">
          <div className="pl-section-shell">
            <div className="pl-section-label"><span>03</span> Injective 结算</div>
            <div className="pl-injective-intro">
              <h2 id="injective-title">Policy 决定能不能付，<br />Injective 证明是否真的付了。</h2>
              <p>
                区块链不是页脚上的技术标签。批准后的 Agent 服务费与商户付款才进入结算适配器，并以交易哈希、区块高度和持久化 Receipt 留下证据。
              </p>
            </div>
            <div className="pl-injective-grid">
              {injectiveReasons.map((reason, index) => (
                <article key={reason.label}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{reason.value}</strong>
                  <h3>{reason.label}</h3>
                  <p>{reason.detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="pl-close">
          <div className="pl-close-shell">
            <img src="/pactledger-mark-light.png" alt="" />
            <div>
              <BadgeCheck size={22} />
              <p>PACTLEDGER PRINCIPLE</p>
              <h2>业务 Agent 可以进化，<br />它永远不能进化自己的资金权限。</h2>
            </div>
          </div>
        </section>
      </main>

      <footer className="pl-footer" id="footer">
        <div className="pl-footer-brand">
          <strong>PactLedger</strong>
          <span>Agent Treasury · Agent Spend Control</span>
          <a className="pl-built-with" href="https://kiro.dev/" target="_blank" rel="noreferrer">
            Built with <b>Kiro</b>
          </a>
        </div>
        <div className="pl-footer-flow">
          <span>CONTROL PATH</span>
          <code>Intent → Policy → Approval → Settlement → Receipt</code>
        </div>
      </footer>
    </div>
  )
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
        <span>可操作 API 验证 · 固定 Mock 结算</span>
        <h3>十秒看懂基座：<br />合法付款通过，骗转账当场拒绝。</h3>
        <p>
          两个按钮都调用同一个 Fastify Payment Intent、Policy Engine 与 Receipt Service。
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
