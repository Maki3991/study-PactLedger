import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Database,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitBranch,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Play,
  RotateCcw,
  ShieldCheck,
  Workflow,
  Zap,
} from 'lucide-react'
import { AuthScreen } from './components/AuthScreen'
import type {
  AgentRun,
  CreateTaskInput,
  InjectiveConfigStatus,
  PandaConfigStatus,
  TaskPhase,
  TaskSnapshot,
} from './domain/trading'
import type { PactLedgerTrace, SettlementReceipt } from './domain/pactledger'
import type { AuthUser } from './services/authClient'
import { useAuth } from './services/useAuth'
import { useInjectiveConfig } from './services/useInjectiveConfig'
import { usePandaConfig } from './services/usePandaConfig'
import { useBotStatus } from './services/useBotStatus'
import { useTaskWorkflow } from './services/useTaskWorkflow'

const presets = [
  { symbol: '000001.SZ', name: '平安银行' },
  { symbol: '600519.SH', name: '贵州茅台' },
  { symbol: '300750.SZ', name: '宁德时代' },
]

const phaseOrder: TaskPhase[] = [
  'created',
  'researching',
  'strategizing',
  'backtesting',
  'risk_review',
  'awaiting_approval',
  'approved',
  'executing',
  'executed',
]

type StepState = 'pending' | 'active' | 'complete' | 'failed'

function App() {
  const { session, validating, login, register, logout } = useAuth()

  if (validating) {
    return (
      <div className="kx-boot">
        <span className="kx-brand-glyph"><Workflow size={18} /></span>
        <LoaderCircle size={18} className="spin" />
        <p>正在恢复产品实例…</p>
      </div>
    )
  }

  if (!session) return <AuthScreen onLogin={login} onRegister={register} />
  return <KaleidoWorkspace user={session.user} onLogout={logout} />
}

interface WorkspaceProps {
  user: AuthUser
  onLogout: () => Promise<void>
}

function KaleidoWorkspace({ user, onLogout }: WorkspaceProps) {
  const [symbol, setSymbol] = useState('000001.SZ')
  const [inputError, setInputError] = useState<string>()
  const { task, error, submitting, start, approveAndExecute } = useTaskWorkflow()
  const panda = usePandaConfig()
  const injective = useInjectiveConfig()
  const bot = useBotStatus()
  const normalizedSymbol = symbol.trim().toUpperCase()
  const canStart = !submitting && (!task || task.phase === 'executed' || task.phase === 'failed')
  const executionReady = injective.status?.readyForExecution === true
  const executionTrace = executionPaymentTrace(task)
  const injectivePresentation = getInjectivePresentation(injective.status, task)
  const pandaPresentation = getPandaPresentation(panda.status, task)
  const taskFailure = taskFailureMessage(task)

  const submit = () => {
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(normalizedSymbol)) {
      setInputError('请输入 A 股代码，例如 000001.SZ')
      return
    }
    setInputError(undefined)
    const input: CreateTaskInput = {
      objective: `使用 PandaAI 数据研究 ${normalizedSymbol}，生成可解释的股票策略，并通过 PactLedger 风控、审批与执行适配器形成审计回执。`,
      budgetUsdt: 1_000,
      maxLossPct: 5,
      maxAssetPct: 30,
      asset: normalizedSymbol,
    }
    void start(input)
  }

  return (
    <div className="kx-app">
      <header className="kx-nav">
        <a className="kx-nav-brand" href="/">
          <span className="kx-brand-glyph"><Workflow size={16} /></span>
          <span><strong>PactLedger</strong><small>Base</small></span>
        </a>
        <div className="kx-product-path" aria-label="产品层级">
          <ArrowRight size={13} />
          <span>KaleidoX</span>
          <em>Reference App 01</em>
        </div>
        <div className="kx-nav-actions">
          <StatusPill
            label={pandaPresentation.label}
            tone={pandaPresentation.tone}
          />
          <StatusPill
            label={injectivePresentation.label}
            tone={injectivePresentation.tone}
          />
          <BotStatusPill bot={bot} />
          <span className="kx-user-name">{user.username}</span>
          <button className="kx-icon-button" type="button" title="退出登录" onClick={() => void onLogout()}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="kx-main">
        <section className="kx-intro">
          <a className="kx-back" href="/"><ArrowLeft size={14} /> 返回基座</a>
          <p className="kx-kicker">PACTLEDGER REFERENCE APP · 01</p>
          <h1>股票 Agent 负责研究，<br />资金基座负责踩刹车。</h1>
          <p className="kx-intro-copy">
            KaleidoX 只提出策略建议；PactLedger 控制 Agent 服务费、权限边界和审计回执。
            A 股指令不会被冒充为 Injective 交易，链上只结算 Agent 之间的真实服务采购。
          </p>
        </section>

        <section className="kx-base-ribbon" aria-label="PactLedger 复用能力">
          <div className="kx-base-ribbon-title">
            <span>Powered by PactLedger</span>
            <strong>业务层只新增股票 Skill；花钱、拒付与留证全部复用基座。</strong>
          </div>
          <div className="kx-primitive-list">
            <Primitive icon={Database} label="Agent Account" detail="隔离预算" />
            <Primitive icon={ShieldCheck} label="Policy Engine" detail="规则纠偏" />
            <Primitive icon={Fingerprint} label="Payment Intent" detail="统一付款语义" />
            <Primitive icon={FileCheck2} label="Receipt Ledger" detail="可审计回执" />
          </div>
        </section>

        <section className="kx-launch" aria-labelledby="launch-title">
          <div className="kx-launch-copy">
            <span>01 · 任务输入</span>
            <h2 id="launch-title">选择一只股票，运行完整 Agent 流程。</h2>
            <p>默认使用 18 个月日线、5% 最大回撤和 30% 单股仓位上限。</p>
          </div>
          <div className="kx-launch-control">
            <label htmlFor="stock-symbol">A 股代码</label>
            <div className="kx-symbol-row">
              <input
                id="stock-symbol"
                value={symbol}
                onChange={(event) => setSymbol(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && canStart) submit() }}
                aria-invalid={Boolean(inputError)}
                disabled={!canStart}
              />
              <button className="kx-primary" type="button" onClick={submit} disabled={!canStart}>
                {submitting || (task && !['awaiting_approval', 'executed', 'failed'].includes(task.phase))
                  ? <LoaderCircle size={17} className="spin" />
                  : task?.phase === 'executed' ? <RotateCcw size={17} /> : <Play size={17} />}
                {task?.phase === 'executed' ? '运行新任务' : submitting ? '正在创建' : '运行股票 Agent'}
              </button>
            </div>
            <div className="kx-presets" aria-label="股票示例">
              {presets.map((preset) => (
                <button key={preset.symbol} type="button" disabled={!canStart} onClick={() => setSymbol(preset.symbol)}>
                  <span>{preset.name}</span>{preset.symbol}
                </button>
              ))}
            </div>
            {inputError && <p className="kx-inline-error" role="alert">{inputError}</p>}
          </div>
        </section>

        {(error || panda.error || injective.error || taskFailure) && (
          <div className="kx-api-error" role="alert">{error ?? panda.error ?? injective.error ?? taskFailure}</div>
        )}

        <section className="kx-story" aria-label="量化交易 MVP 流程">
          <div className="kx-story-main">
            <StoryStep
              number="02"
              label="数据证据"
              owner="KaleidoX + PandaAI"
              state={dataState(task)}
              title={task?.quantEvidence ? `${task.quantEvidence.symbol} 日线已归档` : '等待 PandaAI 股票数据'}
              summary={task?.quantEvidence
                ? `${task.quantEvidence.barCount} 根日线 · ${providerName(task)} · ${task.quantEvidence.startDate}—${task.quantEvidence.endDate}`
                : '运行任务后，数据来源、接口、日期与条数会在这里留下证据。'}
            >
              {task?.quantEvidence && (
                <EvidenceDetails label="查看数据契约">
                  <EvidenceGrid rows={[
                    ['数据模式', providerName(task)],
                    ['调用方法', task.quantEvidence.sourceMethod],
                    ['SDK', `panda_data ${task.quantEvidence.sdkVersion}`],
                    ['复权方式', task.quantEvidence.adjustment === 'pre-adjusted' ? '前复权' : '确定性合成'],
                    ['Skill', task.quantEvidence.skill],
                    ['抓取时间', formatTime(task.quantEvidence.fetchedAt)],
                  ]} />
                  <p className="kx-evidence-note">{task.quantEvidence.note}</p>
                </EvidenceDetails>
              )}
            </StoryStep>

            <StoryStep
              number="03"
              label="研究与回测"
              owner="KaleidoX Agents"
              state={analysisState(task)}
              title={winner(task) ? `${winner(task)?.name} 成为候选策略` : '六个 Agent 协作生成策略证据'}
              summary={winner(task)
                ? `Sharpe ${winner(task)?.sharpe.toFixed(2)} · 最大回撤 ${winner(task)?.drawdownPct.toFixed(2)}% · 样本外 ${winner(task)?.oosReturn.toFixed(2)}%`
                : '研究、策略、回测和独立风控按顺序推进，不让语言模型直接决定交易。'}
            >
              {task && <AgentLine agents={task.agents} />}
              {task?.researchSummary && <p className="kx-research-summary">{task.researchSummary}</p>}
              {task?.candidates.length ? (
                <EvidenceDetails label="比较三个策略版本" open>
                  <StrategyTable task={task} />
                </EvidenceDetails>
              ) : null}
            </StoryStep>

            <StoryStep
              number="04"
              label="资金策略"
              owner="PactLedger Base"
              state={policyState(task)}
              title={task?.actionIntent ? 'Policy Engine 已把 40% 仓位修正为 25%' : '基座在交易前执行不可绕过的检查'}
              summary={task?.actionIntent
                ? '股票 Agent 提交业务建议，PactLedger 只接受满足预算、回撤、仓位和白名单的版本。'
                : '同一套 Policy Engine 也可以约束拼单、采购、订阅或任意 Agent 支付。'}
            >
              {task?.firewallRules && <PolicyList task={task} />}
              {task?.timeline.some((event) => event.tone === 'warning') && (
                <div className="kx-correction">
                  <span><GitBranch size={15} /> Policy correction</span>
                  <strong>40% 建议仓位</strong><ArrowRight size={14} /><strong>25% 合规意图</strong>
                </div>
              )}
              {riskPaymentTrace(task) && <PaymentTrace trace={riskPaymentTrace(task)!} />}
            </StoryStep>

            <StoryStep
              number="05"
              label="人工批准"
              owner="PactLedger Base"
              state={approvalState(task)}
              title={task?.actionIntent ? '统一 Action Intent 已生成' : '高风险动作必须由用户确认'}
              summary={task?.actionIntent
                ? `${task.actionIntent.symbol} · ${task.actionIntent.strategyVersion} · 合规仓位 25% · Broker-ready 指令`
                : '研究结果不会直接越过权限边界，只有批准后的 Intent 才会进入执行适配器。'}
            >
              {task?.actionIntent && (
                <div className="kx-intent">
                  <div><span>Intent ID</span><strong>{task.actionIntent.id}</strong></div>
                  <div><span>业务来源</span><strong>KaleidoX / investment</strong></div>
                  <div><span>状态</span><strong>{task.actionIntent.status}</strong></div>
                </div>
              )}
              {task?.phase === 'awaiting_approval' && (
                <div className="kx-approval-action">
                  <button className="kx-primary" type="button" onClick={() => void approveAndExecute()} disabled={!executionReady}>
                    <LockKeyhole size={17} />
                    {injective.status?.mode === 'testnet' ? '批准策略并结算服务费' : '批准策略并生成 Mock 服务费回执'}
                  </button>
                  <p>{executionReady ? '批准的是股票策略；Receipt 证明的是 Execution Agent 服务费。' : 'Injective 服务费适配器尚未准备好。'}</p>
                </div>
              )}
            </StoryStep>

            <StoryStep
              number="06"
              label="结算与回执"
              owner="PactLedger Adapter"
              state={receiptState(task)}
              title={executionTraceTitle(executionTrace)}
              summary={executionTraceSummary(executionTrace)}
            >
              {executionTrace && <PaymentTrace trace={executionTrace} />}
            </StoryStep>
          </div>

          <aside className="kx-base-proof" id="base-proof">
            <p className="kx-kicker">WHY THE BASE MATTERS</p>
            <h2>换一个业务，<br />不再重做资金系统。</h2>
            <p>量化案例只实现数据与策略。PactLedger 接管 Agent 账户、Policy、支付和 Receipt。</p>
            <ol>
              <li><span>01</span><div><strong>业务 Agent 输出建议</strong><small>股票策略、拼单付款都映射为 Intent</small></div></li>
              <li><span>02</span><div><strong>基座统一执行控制</strong><small>账户、预算、白名单、人工批准</small></div></li>
              <li><span>03</span><div><strong>Adapter 对接任意结算层</strong><small>Mock → Injective Testnet → Mainnet</small></div></li>
            </ol>
            <a className="kx-secondary-link" href="/poolmate.html">看第二个业务如何复用 <ArrowRight size={15} /></a>

            <details className="kx-system-details">
              <summary>当前接入状态 <ChevronDown size={14} /></summary>
              <div>
                <SystemRow label="PandaAI" value={pandaPresentation.label} />
                <SystemRow label="Panda SDK" value={panda.status?.sdkVersion ?? '0.0.12'} />
                <SystemRow label="Quant Skill" value="pandadata-api" />
                <SystemRow label="Execution" value={injective.status?.adapter ?? 'loading'} />
                <SystemRow label="Settlement state" value={injectivePresentation.label} />
                <SystemRow label="Chain" value={injective.status?.chainId ?? 'injective-888'} />
                <div className="kx-bot-row">
                  <span>PoolMate Bot</span>
                  <strong>{bot.label}</strong>
                  <button
                    className="kx-bot-test-btn"
                    type="button"
                    disabled={bot.testing}
                    onClick={() => void bot.test()}
                  >
                    {bot.testing ? '检测中…' : '测试连接'}
                  </button>
                </div>
                {bot.status?.ok && bot.status.inviteUrl && (
                  <a className="kx-bot-link" href={bot.status.inviteUrl} target="_blank" rel="noreferrer">
                    → 打开 @{bot.status.username}
                  </a>
                )}
                {bot.status && !bot.status.ok && (
                  <p className="kx-bot-error">{bot.status.reason}</p>
                )}
              </div>
            </details>
          </aside>
        </section>
      </main>

      <footer className="kx-footer">
        <span><strong>KaleidoX</strong> on PactLedger</span>
        <span>风险压力测试参考应用 · Intent → Policy → Settlement → Receipt</span>
      </footer>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'review' }) {
  return <span className={`kx-status-pill ${tone}`}><i />{label}</span>
}

function BotStatusPill({ bot }: { bot: ReturnType<typeof useBotStatus> }) {
  return (
    <button
      className={`kx-status-pill ${bot.tone} kx-bot-pill`}
      type="button"
      title={bot.status?.ok ? `点击重新检测 Bot 连接` : bot.status?.reason ?? '点击检测'}
      onClick={() => void bot.test()}
      disabled={bot.testing}
    >
      <i />{bot.testing ? '检测中…' : `PoolMate ${bot.label}`}
    </button>
  )
}

function Primitive({ icon: Icon, label, detail }: { icon: typeof Database; label: string; detail: string }) {
  return <div className="kx-primitive"><Icon size={16} /><span><strong>{label}</strong><small>{detail}</small></span></div>
}

interface StoryStepProps {
  number: string
  label: string
  owner: string
  state: StepState
  title: string
  summary: string
  children?: React.ReactNode
}

function StoryStep({ number, label, owner, state, title, summary, children }: StoryStepProps) {
  return (
    <article className={`kx-step ${state}`}>
      <div className="kx-step-marker" aria-hidden="true">
        {state === 'complete' ? <Check size={15} /> : state === 'active' ? <LoaderCircle size={15} className="spin" /> : <Circle size={11} />}
      </div>
      <div className="kx-step-content">
        <div className="kx-step-meta"><span>{number} · {label}</span><em>{owner}</em></div>
        <h3>{title}</h3>
        <p>{summary}</p>
        {children && <div className="kx-step-body">{children}</div>}
      </div>
    </article>
  )
}

function EvidenceDetails({ label, open = false, children }: { label: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="kx-evidence" open={open}>
      <summary>{label}<ChevronDown size={14} /></summary>
      <div className="kx-evidence-content">{children}</div>
    </details>
  )
}

function EvidenceGrid({ rows }: { rows: Array<[string, string]> }) {
  return <dl className="kx-evidence-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function AgentLine({ agents }: { agents: AgentRun[] }) {
  return (
    <div className="kx-agent-line" aria-label="Agent 任务状态">
      {agents.map((agent) => (
        <div className={agent.status} key={agent.id} title={agent.detail}>
          <span>{agent.status === 'complete' ? <Check size={11} /> : agent.status === 'working' ? <LoaderCircle size={11} className="spin" /> : <Bot size={11} />}</span>
          <strong>{agent.name}</strong>
        </div>
      ))}
    </div>
  )
}

function StrategyTable({ task }: { task: TaskSnapshot }) {
  return (
    <div className="kx-strategy-table">
      <div className="kx-strategy-row header"><span>版本</span><span>收益</span><span>回撤</span><span>Sharpe</span><span>样本外</span></div>
      {task.candidates.map((candidate) => (
        <div className={`kx-strategy-row ${candidate.status}`} key={candidate.id}>
          <span><strong>{candidate.name}</strong><small>{candidate.signal}</small></span>
          <span>{candidate.returnPct.toFixed(2)}%</span>
          <span>{candidate.drawdownPct.toFixed(2)}%</span>
          <span>{candidate.sharpe.toFixed(2)}</span>
          <span>{candidate.oosReturn.toFixed(2)}%</span>
        </div>
      ))}
    </div>
  )
}

function PolicyList({ task }: { task: TaskSnapshot }) {
  return (
    <div className="kx-policy-list">
      {task.firewallRules.map((rule) => (
        <div key={rule.label}>
          <ShieldCheck size={14} />
          <span><strong>{rule.label}</strong><small>上限 {rule.limit}</small></span>
          <em>{rule.current}</em>
        </div>
      ))}
    </div>
  )
}

function PaymentTrace({ trace }: { trace: PactLedgerTrace }) {
  const rejected = trace.decision.outcome === 'rejected'
  const receipt = trace.receipt
  const verifiableTestnetReceipt = isVerifiableTestnetReceipt(receipt)
  const settlementState: TraceStageState = rejected
    ? 'skipped'
    : !receipt ? 'waiting' : receipt.status === 'confirmed' ? 'complete' : 'failed'
  const receiptState: TraceStageState = rejected
    ? 'skipped'
    : !receipt
      ? 'waiting'
      : receipt.status === 'failed' || (receipt.mode === 'testnet' && !verifiableTestnetReceipt)
        ? 'failed'
        : 'complete'
  const settlementLabel = rejected
    ? 'SKIPPED'
    : !receipt
      ? 'WAITING'
      : receipt.mode === 'mock' ? 'MOCK ADAPTER' : 'INJECTIVE TESTNET'
  const receiptLabel = rejected
    ? 'NOT CREATED'
    : !receipt
      ? 'WAITING'
      : receipt.status === 'failed'
        ? receipt.errorCode ?? 'FAILED'
        : receipt.mode === 'mock'
          ? 'MOCK RECEIPT'
          : verifiableTestnetReceipt ? 'CONFIRMED' : 'EVIDENCE INCOMPLETE'

  return (
    <section className={`kx-payment-trace ${rejected ? 'is-rejected' : ''}`} aria-label="PactLedger Agent 支付轨迹">
      <div className="kx-payment-trace-head">
        <div>
          <span>PACTLEDGER TRACE · {trace.intent.appId.toUpperCase()}</span>
          <strong>{trace.intent.payerAgentId} → {trace.intent.payeeId}</strong>
        </div>
        <em>{trace.intent.amount} {trace.intent.currency}</em>
      </div>
      <div className="kx-payment-pipeline">
        <TraceStage icon={Fingerprint} label="INTENT" value={trace.intent.purpose} state="complete" />
        <ArrowRight size={13} />
        <TraceStage icon={ShieldCheck} label="POLICY" value={trace.decision.code} state={rejected ? 'failed' : 'complete'} />
        <ArrowRight size={13} />
        <TraceStage icon={Zap} label="SETTLEMENT" value={settlementLabel} state={settlementState} />
        <ArrowRight size={13} />
        <TraceStage icon={FileCheck2} label="RECEIPT" value={receiptLabel} state={receiptState} />
      </div>
      <div className="kx-payment-verdict">
        <div>
          <span>{trace.decision.id}</span>
          <strong>{trace.decision.reason}</strong>
        </div>
        <dl>
          <div><dt>Intent</dt><dd>{trace.intent.id}</dd></div>
          <div><dt>Status</dt><dd>{trace.intent.status}</dd></div>
          <div><dt>Mode</dt><dd>{receipt?.mode ?? 'not-settled'}</dd></div>
          <div><dt>Receipt store</dt><dd>{receipt ? 'saved before response' : 'not created'}</dd></div>
        </dl>
      </div>
      {receipt?.transactionHash && <code className="kx-payment-hash">{receipt.transactionHash}</code>}
      {verifiableTestnetReceipt && (
        <a className="kx-payment-explorer" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
          <span>Injective Explorer · Block {receipt.blockHeight}</span>
          <ExternalLink size={13} />
        </a>
      )}
      <details>
        <summary>查看每一项检查 <ChevronDown size={13} /></summary>
        <div className="kx-payment-checks">
          {trace.decision.checks.map((check) => (
            <p className={check.passed ? 'pass' : 'fail'} key={check.code}>
              <span>{check.passed ? <Check size={11} /> : <Circle size={9} />}{check.label}</span>
              <strong>{check.detail}</strong>
            </p>
          ))}
        </div>
      </details>
      <p className="kx-payment-truth">
        {receipt?.mode === 'mock'
          ? '这是可复现的 Mock Receipt，不会生成 Explorer 链接；它证明控制链路，不冒充链上交易。'
          : 'Injective 只结算 Agent 服务费；只有交易哈希、区块高度与 Explorer 同时存在时才显示链上确认。'}
      </p>
    </section>
  )
}

type TraceStageState = 'complete' | 'failed' | 'waiting' | 'skipped'

function TraceStage({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: typeof Fingerprint
  label: string
  value: string
  state: TraceStageState
}) {
  return <div className={state}><Icon size={13} /><span><small>{label}</small><strong>{value}</strong></span></div>
}

function SystemRow({ label, value }: { label: string; value: string }) {
  return <p><span>{label}</span><strong>{value}</strong></p>
}

function taskIndex(task?: TaskSnapshot): number {
  if (!task) return -1
  return phaseOrder.indexOf(task.phase)
}

function stateFor(task: TaskSnapshot | undefined, activePhases: TaskPhase[], completeAt: TaskPhase): StepState {
  if (!task) return 'pending'
  if (task.phase === 'failed') return 'failed'
  if (activePhases.includes(task.phase)) return 'active'
  return taskIndex(task) >= phaseOrder.indexOf(completeAt) ? 'complete' : 'pending'
}

function dataState(task?: TaskSnapshot): StepState {
  if (task?.quantEvidence) return 'complete'
  return stateFor(task, ['created', 'researching'], 'strategizing')
}

function analysisState(task?: TaskSnapshot): StepState {
  if (task?.candidates.length) return 'complete'
  return stateFor(task, ['strategizing', 'backtesting'], 'risk_review')
}

function policyState(task?: TaskSnapshot): StepState {
  return stateFor(task, ['risk_review'], 'awaiting_approval')
}

function approvalState(task?: TaskSnapshot): StepState {
  return stateFor(task, ['awaiting_approval'], 'approved')
}

function receiptState(task?: TaskSnapshot): StepState {
  const trace = executionPaymentTrace(task)
  if (trace?.receipt?.status === 'failed') return 'failed'
  if (trace?.receipt?.status === 'confirmed') return 'complete'
  return stateFor(task, ['approved', 'executing'], 'executed')
}

function riskPaymentTrace(task?: TaskSnapshot): PactLedgerTrace | undefined {
  return task?.paymentTraces.find((trace) => trace.intent.purpose === 'risk_review')
}

function executionPaymentTrace(task?: TaskSnapshot): PactLedgerTrace | undefined {
  return task?.paymentTraces.find((trace) => trace.intent.purpose === 'execution')
}

function executionTraceTitle(trace?: PactLedgerTrace): string {
  const receipt = trace?.receipt
  if (!trace) return '等待结算适配器返回完整 Trace'
  if (!receipt) return 'Payment Intent 尚未进入结算层'
  if (receipt.status === 'failed') return '服务费结算失败，错误已写入审计轨迹'
  if (receipt.mode === 'mock') return 'Mock 服务费回执已写入统一账本'
  if (isVerifiableTestnetReceipt(receipt)) return 'Injective Testnet Receipt 已确认并入账'
  return 'Testnet 回执证据不完整，未标记链上确认'
}

function executionTraceSummary(trace?: PactLedgerTrace): string {
  const receipt = trace?.receipt
  if (!trace) return '股票策略只生成 Broker-ready 指令；PactLedger 另外结算 Execution Agent 服务费。'
  if (!receipt) return `${trace.intent.id} 已通过 ${trace.decision.policyId}，等待 Settlement Adapter。`
  if (receipt.status === 'failed') {
    return `${receipt.errorCode ?? 'SETTLEMENT_FAILED'} · ${receipt.error ?? '结算未获得可验证 Receipt。'}`
  }
  if (receipt.mode === 'mock') {
    return `Mock Adapter · ${receipt.transactionHash ?? '无回执编号'} · 不链接 Explorer。`
  }
  return isVerifiableTestnetReceipt(receipt)
    ? `Injective Testnet · Block ${receipt.blockHeight} · ${receipt.transactionHash}`
    : 'Testnet 返回结果缺少交易哈希、区块高度或 Explorer，证据未通过展示门槛。'
}

function getInjectivePresentation(
  status: InjectiveConfigStatus | undefined,
  task?: TaskSnapshot,
): { label: string; tone: 'ok' | 'review' } {
  const confirmed = task?.paymentTraces.some((trace) => isVerifiableTestnetReceipt(trace.receipt))
  if (confirmed) return { label: 'Injective Confirmed', tone: 'ok' }
  if (!status) return { label: 'Settlement status…', tone: 'review' }
  if (status.mode === 'mock') return { label: 'Mock Adapter · No Chain', tone: 'review' }
  if (status.executionState === 'testnet_configuration_required') {
    return { label: 'Testnet Config Required', tone: 'review' }
  }
  return { label: 'Testnet Ready · Unconfirmed', tone: 'review' }
}

function getPandaPresentation(
  status: PandaConfigStatus | undefined,
  task?: TaskSnapshot,
): { label: string; tone: 'ok' | 'review' } {
  if (task?.quantEvidence?.provider === 'panda-data') return { label: 'PandaData Live', tone: 'ok' }
  if (task?.quantEvidence?.provider === 'replay') return { label: 'Panda Replay', tone: 'review' }
  if (status?.provider === 'panda-data') return { label: 'PandaData Configured', tone: 'review' }
  return { label: 'Panda Replay', tone: 'review' }
}

function taskFailureMessage(task?: TaskSnapshot): string | undefined {
  if (task?.phase !== 'failed') return undefined
  const lastEvent = task.timeline.at(-1)
  return lastEvent ? `${lastEvent.title}：${lastEvent.detail}` : '任务失败，请检查数据、模型或结算配置。'
}

function isVerifiableTestnetReceipt(
  receipt?: SettlementReceipt,
): receipt is SettlementReceipt & Required<Pick<SettlementReceipt, 'transactionHash' | 'explorerUrl' | 'blockHeight'>> {
  return Boolean(
    receipt
    && receipt.mode === 'testnet'
    && receipt.status === 'confirmed'
    && receipt.transactionHash
    && receipt.explorerUrl
    && receipt.blockHeight,
  )
}

function winner(task?: TaskSnapshot) {
  return task?.candidates.find((candidate) => candidate.status === 'approved')
}

function providerName(task: TaskSnapshot): string {
  return task.quantEvidence?.provider === 'panda-data' ? 'PandaData Live' : 'Panda Replay'
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default App
