import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Database,
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
} from 'lucide-react'
import { AuthScreen } from './components/AuthScreen'
import type {
  AgentRun,
  CreateTaskInput,
  TaskPhase,
  TaskSnapshot,
} from './domain/trading'
import type { AuthUser } from './services/authClient'
import { useAuth } from './services/useAuth'
import { useInjectiveConfig } from './services/useInjectiveConfig'
import { usePandaConfig } from './services/usePandaConfig'
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
  const normalizedSymbol = symbol.trim().toUpperCase()
  const canStart = !submitting && (!task || task.phase === 'executed' || task.phase === 'failed')
  const executionReady = injective.status?.readyForExecution === true

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
          <em>Product 01</em>
        </div>
        <div className="kx-nav-actions">
          <StatusPill
            label={panda.status?.provider === 'panda-data' ? 'PandaData Live' : 'Panda Replay'}
            tone={panda.status?.provider === 'panda-data' ? 'ok' : 'review'}
          />
          <StatusPill
            label={injective.status?.mode === 'testnet' ? 'Injective Testnet' : 'Mock Adapter'}
            tone={executionReady ? 'ok' : 'review'}
          />
          <span className="kx-user-name">{user.username}</span>
          <button className="kx-icon-button" type="button" title="退出登录" onClick={() => void onLogout()}>
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="kx-main">
        <section className="kx-intro">
          <a className="kx-back" href="/"><ArrowLeft size={14} /> 返回基座</a>
          <p className="kx-kicker">PACTLEDGER PRODUCT INSTANCE · 01</p>
          <h1>把一个股票目标，变成<br />一条受控的交易意图。</h1>
          <p className="kx-intro-copy">
            KaleidoX 负责股票研究，PactLedger 负责账户、策略边界、审批和回执。
            业务 Agent 可以变化，资金控制面无需重建。
          </p>
        </section>

        <section className="kx-base-ribbon" aria-label="PactLedger 复用能力">
          <div className="kx-base-ribbon-title">
            <span>Powered by PactLedger</span>
            <strong>这个样例只新增股票 Skill，其余全部复用基座。</strong>
          </div>
          <div className="kx-primitive-list">
            <Primitive icon={Database} label="Agent Account" detail="隔离预算" />
            <Primitive icon={ShieldCheck} label="Policy Engine" detail="规则纠偏" />
            <Primitive icon={Fingerprint} label="Action Intent" detail="统一接口" />
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

        {(error || panda.error || injective.error) && (
          <div className="kx-api-error" role="alert">{error ?? panda.error ?? injective.error}</div>
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
            </StoryStep>

            <StoryStep
              number="05"
              label="人工批准"
              owner="PactLedger Base"
              state={approvalState(task)}
              title={task?.actionIntent ? '统一 Action Intent 已生成' : '高风险动作必须由用户确认'}
              summary={task?.actionIntent
                ? `${task.actionIntent.side.toUpperCase()} ${task.actionIntent.symbol} · ${task.actionIntent.notional} ${task.actionIntent.currency} · ${task.actionIntent.strategyVersion}`
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
                    {injective.status?.mode === 'testnet' ? '批准并提交 Testnet' : '批准并生成 Mock Receipt'}
                  </button>
                  <p>{executionReady ? '这是整条流程唯一需要人工确认的动作。' : 'Injective 执行适配器尚未准备好。'}</p>
                </div>
              )}
            </StoryStep>

            <StoryStep
              number="06"
              label="执行回执"
              owner="PactLedger Adapter"
              state={receiptState(task)}
              title={task?.execution.state === 'executed' ? '执行结果已写入统一账本' : '等待执行适配器返回 Receipt'}
              summary={task?.execution.state === 'executed'
                ? `${task.execution.network} · ${task.execution.transactionHash}`
                : '当前默认输出 Mock Receipt；队友接入 Injective 后只需替换 Adapter，前面的产品流程保持不变。'}
            >
              {task?.execution.state === 'executed' && (
                <div className="kx-receipt">
                  <BadgeCheck size={22} />
                  <div><span>{task.execution.network === 'Mock' ? 'DEMO RECEIPT' : 'ON-CHAIN RECEIPT'}</span><strong>{task.execution.transactionHash}</strong></div>
                  <a href="#base-proof">查看基座复用说明 <ArrowRight size={14} /></a>
                </div>
              )}
            </StoryStep>
          </div>

          <aside className="kx-base-proof" id="base-proof">
            <p className="kx-kicker">WHY THE BASE MATTERS</p>
            <h2>换一个业务，<br />不再重做资金系统。</h2>
            <p>量化案例只实现数据与策略。PactLedger 接管所有高风险、可复用的部分。</p>
            <ol>
              <li><span>01</span><div><strong>业务 Agent 输出建议</strong><small>股票策略、拼单付款都映射为 Intent</small></div></li>
              <li><span>02</span><div><strong>基座统一执行控制</strong><small>账户、预算、白名单、人工批准</small></div></li>
              <li><span>03</span><div><strong>Adapter 对接任意结算层</strong><small>Mock → Injective Testnet → Mainnet</small></div></li>
            </ol>
            <a className="kx-secondary-link" href="/poolmate.html">看第二个业务如何复用 <ArrowRight size={15} /></a>

            <details className="kx-system-details">
              <summary>当前接入状态 <ChevronDown size={14} /></summary>
              <div>
                <SystemRow label="PandaAI" value={panda.status?.provider === 'panda-data' ? 'Live' : 'Replay'} />
                <SystemRow label="Panda SDK" value={panda.status?.sdkVersion ?? '0.0.12'} />
                <SystemRow label="Quant Skill" value="pandadata-api" />
                <SystemRow label="Execution" value={injective.status?.adapter ?? 'loading'} />
                <SystemRow label="Chain" value={injective.status?.chainId ?? 'injective-888'} />
              </div>
            </details>
          </aside>
        </section>
      </main>

      <footer className="kx-footer">
        <span><strong>KaleidoX</strong> on PactLedger</span>
        <span>股票量化产品实例 · 数据证据 → Policy → Intent → Receipt</span>
      </footer>
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'review' }) {
  return <span className={`kx-status-pill ${tone}`}><i />{label}</span>
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
  return stateFor(task, ['approved', 'executing'], 'executed')
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
