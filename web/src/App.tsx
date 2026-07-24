import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Circle,
  Clock3,
  Database,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Play,
  Presentation,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  WalletCards,
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
import { useBotStatus } from './services/useBotStatus'
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

type KaleidoView = 'workspace' | 'case'

interface TaskDraft {
  symbol: string
  budgetUsdt: string
  maxLossPct: string
  maxAssetPct: string
  startDate: string
  endDate: string
}

const defaultTaskDraft: TaskDraft = {
  symbol: '000001.SZ',
  budgetUsdt: '1000',
  maxLossPct: '5',
  maxAssetPct: '30',
  startDate: '',
  endDate: '',
}

function KaleidoWorkspace({ user, onLogout }: WorkspaceProps) {
  const [view, setView] = useState<KaleidoView>(() => (
    new URLSearchParams(window.location.search).get('view') === 'workspace' ? 'workspace' : 'case'
  ))
  const [draft, setDraft] = useState<TaskDraft>(defaultTaskDraft)
  const [lastInput, setLastInput] = useState<CreateTaskInput>()
  const [inputError, setInputError] = useState<string>()
  const { task, error, submitting, actionPending, start, approveAndExecute } = useTaskWorkflow()
  const panda = usePandaConfig()
  const injective = useInjectiveConfig()
  const bot = useBotStatus()
  const normalizedSymbol = draft.symbol.trim().toUpperCase()
  const canStart = !submitting && (!task || task.phase === 'executed' || task.phase === 'failed')
  const executionReady = injective.status?.readyForExecution === true
  const injectivePresentation = getInjectivePresentation(injective.status, task)
  const pandaPresentation = getPandaPresentation(panda.status, task)
  const taskFailure = taskFailureMessage(task)
  const combinedError = error ?? panda.error ?? injective.error ?? taskFailure

  const updateDraft = <Key extends keyof TaskDraft>(key: Key, value: TaskDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setInputError(undefined)
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    if (!/^\d{6}\.(SZ|SH|BJ)$/.test(normalizedSymbol)) {
      setInputError('请输入 A 股代码，例如 000001.SZ')
      return
    }
    const budgetUsdt = Number(draft.budgetUsdt)
    const maxLossPct = Number(draft.maxLossPct)
    const maxAssetPct = Number(draft.maxAssetPct)
    if (!Number.isFinite(budgetUsdt) || budgetUsdt < 1) {
      setInputError('任务预算至少为 1 USDT')
      return
    }
    if (!Number.isFinite(maxLossPct) || maxLossPct < 0.1 || maxLossPct > 100) {
      setInputError('最大回撤需在 0.1% 到 100% 之间')
      return
    }
    if (!Number.isFinite(maxAssetPct) || maxAssetPct < 1 || maxAssetPct > 100) {
      setInputError('单股仓位上限需在 1% 到 100% 之间')
      return
    }
    if (Boolean(draft.startDate) !== Boolean(draft.endDate)) {
      setInputError('自定义数据区间需要同时填写开始和结束日期')
      return
    }
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      setInputError('开始日期不能晚于结束日期')
      return
    }
    setInputError(undefined)
    const input: CreateTaskInput = {
      objective: `使用 PandaAI 数据研究 ${normalizedSymbol}，在 ${maxLossPct}% 最大回撤和 ${maxAssetPct}% 单股仓位上限内生成可解释策略，并通过 PactLedger 完成风控、审批与服务费回执。`,
      budgetUsdt,
      maxLossPct,
      maxAssetPct,
      asset: normalizedSymbol,
      ...(draft.startDate && draft.endDate ? {
        startDate: draft.startDate.replaceAll('-', ''),
        endDate: draft.endDate.replaceAll('-', ''),
      } : {}),
    }
    setLastInput(input)
    void start(input)
  }

  const changeView = (next: KaleidoView) => {
    setView(next)
    const url = new URL(window.location.href)
    if (next === 'workspace') url.searchParams.set('view', 'workspace')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
    window.scrollTo({ top: 0, behavior: 'auto' })
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
        <ViewSwitch view={view} onChange={changeView} />
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
        {view === 'workspace' ? (
          <WorkspaceView
            actionPending={actionPending}
            canStart={canStart}
            draft={draft}
            error={combinedError}
            executionReady={executionReady}
            injective={injective.status}
            injectivePresentation={injectivePresentation}
            inputError={inputError}
            lastInput={lastInput}
            onApprove={approveAndExecute}
            onDraftChange={updateDraft}
            onOpenCase={() => changeView('case')}
            onSubmit={submit}
            pandaPresentation={pandaPresentation}
            submitting={submitting}
            task={task}
          />
        ) : (
          <CaseBoard
            actionPending={actionPending}
            bot={bot}
            error={combinedError}
            executionReady={executionReady}
            injective={injective.status}
            injectivePresentation={injectivePresentation}
            onApprove={approveAndExecute}
            onOpenWorkspace={() => changeView('workspace')}
            pandaPresentation={pandaPresentation}
            pandaSdk={panda.status?.sdkVersion ?? '0.0.12'}
            task={task}
          />
        )}
      </main>

      <footer className="kx-footer">
        <span><strong>KaleidoX</strong> on PactLedger</span>
        <span>{view === 'workspace' ? '可操作 Demo 工作区' : '风险压力测试案例展板'} · Intent → Policy → Settlement → Receipt</span>
      </footer>
    </div>
  )
}

function ViewSwitch({ view, onChange }: { view: KaleidoView; onChange: (view: KaleidoView) => void }) {
  return (
    <nav className="kx-view-switch" aria-label="KaleidoX 页面模式">
      <button type="button" className={view === 'workspace' ? 'active' : ''} aria-current={view === 'workspace' ? 'page' : undefined} onClick={() => onChange('workspace')}>
        <LayoutDashboard size={14} /><span>任务工作区</span>
      </button>
      <button type="button" className={view === 'case' ? 'active' : ''} aria-current={view === 'case' ? 'page' : undefined} onClick={() => onChange('case')}>
        <Presentation size={14} /><span>案例展板</span>
      </button>
    </nav>
  )
}

interface WorkspaceViewProps {
  actionPending: boolean
  canStart: boolean
  draft: TaskDraft
  error?: string
  executionReady: boolean
  injective?: InjectiveConfigStatus
  injectivePresentation: { label: string; tone: 'ok' | 'review' }
  inputError?: string
  lastInput?: CreateTaskInput
  onApprove: () => Promise<void>
  onDraftChange: <Key extends keyof TaskDraft>(key: Key, value: TaskDraft[Key]) => void
  onOpenCase: () => void
  onSubmit: (event?: FormEvent) => void
  pandaPresentation: { label: string; tone: 'ok' | 'review' }
  submitting: boolean
  task?: TaskSnapshot
}

function WorkspaceView({
  actionPending,
  canStart,
  draft,
  error,
  executionReady,
  injective,
  injectivePresentation,
  inputError,
  lastInput,
  onApprove,
  onDraftChange,
  onOpenCase,
  onSubmit,
  pandaPresentation,
  submitting,
  task,
}: WorkspaceViewProps) {
  const moment = getWorkspaceMoment(task, submitting)

  return (
    <>
      <section className="kx-workspace-head">
        <div>
          <a className="kx-back" href="/"><ArrowLeft size={14} /> 返回 PactLedger</a>
          <p className="kx-kicker">LIVE DEMO WORKSPACE · REFERENCE APP 01</p>
          <h1>创建一项任务，亲自决定 Agent 能否执行。</h1>
          <p>
            设定股票、预算与风险上限；研究完成后，PactLedger 会停在人工批准，等你放行并核验 Agent 服务费回执。
          </p>
          <div className="kx-workspace-route" aria-label="用户操作路径">
            <span><b>1</b> 配置任务</span><ArrowRight size={13} />
            <span><b>2</b> 查看 Policy</span><ArrowRight size={13} />
            <span><b>3</b> 批准并核验回执</span>
          </div>
        </div>
        <aside className={`kx-workspace-now ${moment.tone}`} aria-live="polite">
          <span>{moment.label}</span>
          <h2>{moment.title}</h2>
          <p>{moment.detail}</p>
          <div>
            <small>数据</small><strong>{pandaPresentation.label}</strong>
            <small>结算</small><strong>{injectivePresentation.label}</strong>
          </div>
        </aside>
      </section>

      {error && <div className="kx-api-error" role="alert">{error}</div>}

      <section className="kx-workspace-layout" aria-label="KaleidoX 可操作工作区">
        <TaskBuilder
          canStart={canStart}
          draft={draft}
          inputError={inputError}
          onChange={onDraftChange}
          onSubmit={onSubmit}
          submitting={submitting}
          task={task}
        />
        <TaskConsole
          actionPending={actionPending}
          executionReady={executionReady}
          injective={injective}
          lastInput={lastInput}
          onApprove={onApprove}
          task={task}
        />
        <ControlRail
          draft={draft}
          injective={injective}
          lastInput={lastInput}
          onOpenCase={onOpenCase}
          task={task}
        />
      </section>

      <WorkspaceEvidence task={task} />
    </>
  )
}

interface TaskBuilderProps {
  canStart: boolean
  draft: TaskDraft
  inputError?: string
  onChange: <Key extends keyof TaskDraft>(key: Key, value: TaskDraft[Key]) => void
  onSubmit: (event?: FormEvent) => void
  submitting: boolean
  task?: TaskSnapshot
}

function TaskBuilder({ canStart, draft, inputError, onChange, onSubmit, submitting, task }: TaskBuilderProps) {
  const taskRunning = Boolean(task && !['executed', 'failed'].includes(task.phase))
  const submitLabel = submitting
    ? '正在创建任务…'
    : taskRunning
      ? task?.phase === 'awaiting_approval' ? '等待你的批准' : 'Agent 正在运行'
      : task
        ? '运行下一项任务'
        : `启动 ${draft.symbol.trim().toUpperCase() || '股票'} 研究`

  return (
    <aside className="kx-task-builder">
      <div className="kx-builder-title">
        <span><SlidersHorizontal size={14} /> STEP 1 · TASK SETUP</span>
        <h2>配置研究任务</h2>
        <p>这些不是演示文案：预算、回撤和仓位上限会真实进入任务与 Policy Engine。</p>
      </div>
      <form onSubmit={onSubmit}>
        <label className="kx-builder-field" htmlFor="workspace-symbol">
          <span>A 股代码</span>
          <input
            id="workspace-symbol"
            value={draft.symbol}
            onChange={(event) => onChange('symbol', event.target.value)}
            aria-invalid={Boolean(inputError)}
            aria-describedby={inputError ? 'workspace-input-error' : undefined}
            disabled={!canStart}
          />
        </label>
        <div className="kx-builder-presets" aria-label="股票示例">
          {presets.map((preset) => (
            <button
              key={preset.symbol}
              className={draft.symbol.trim().toUpperCase() === preset.symbol ? 'active' : ''}
              type="button"
              disabled={!canStart}
              onClick={() => onChange('symbol', preset.symbol)}
            >
              <strong>{preset.name}</strong><span>{preset.symbol}</span>
            </button>
          ))}
        </div>

        <div className="kx-builder-grid">
          <label className="kx-builder-field">
            <span>任务预算</span>
            <div><input type="number" min="1" step="1" value={draft.budgetUsdt} onChange={(event) => onChange('budgetUsdt', event.target.value)} disabled={!canStart} /><em>USDT</em></div>
          </label>
          <label className="kx-builder-field">
            <span>最大回撤</span>
            <div><input type="number" min="0.1" max="100" step="0.1" value={draft.maxLossPct} onChange={(event) => onChange('maxLossPct', event.target.value)} disabled={!canStart} /><em>%</em></div>
          </label>
          <label className="kx-builder-field">
            <span>单股仓位上限</span>
            <div><input type="number" min="1" max="100" step="1" value={draft.maxAssetPct} onChange={(event) => onChange('maxAssetPct', event.target.value)} disabled={!canStart} /><em>%</em></div>
          </label>
        </div>

        <details className="kx-builder-advanced">
          <summary><Clock3 size={13} /> 自定义数据区间（可选） <ChevronDown size={13} /></summary>
          <div>
            <label className="kx-builder-field"><span>开始日期</span><input type="date" value={draft.startDate} onChange={(event) => onChange('startDate', event.target.value)} disabled={!canStart} /></label>
            <label className="kx-builder-field"><span>结束日期</span><input type="date" value={draft.endDate} onChange={(event) => onChange('endDate', event.target.value)} disabled={!canStart} /></label>
          </div>
        </details>

        {inputError && <p className="kx-builder-error" id="workspace-input-error" role="alert">{inputError}</p>}

        <button className="kx-builder-submit" type="submit" disabled={!canStart}>
          {submitting || taskRunning ? <LoaderCircle size={16} className={taskRunning ? undefined : 'spin'} /> : task ? <RotateCcw size={16} /> : <Play size={16} />}
          {submitLabel}
        </button>
        <p className="kx-builder-note">启动后可继续浏览证据，但在任务完成前不能改写本次规则。</p>
      </form>
    </aside>
  )
}

interface TaskConsoleProps {
  actionPending: boolean
  executionReady: boolean
  injective?: InjectiveConfigStatus
  lastInput?: CreateTaskInput
  onApprove: () => Promise<void>
  task?: TaskSnapshot
}

function TaskConsole({ actionPending, executionReady, injective, lastInput, onApprove, task }: TaskConsoleProps) {
  if (!task) {
    return (
      <section className="kx-task-console is-empty" aria-labelledby="task-console-title">
        <header>
          <div><span>STEP 2 · LIVE TASK</span><h2 id="task-console-title">任务控制台</h2></div>
          <em>等待任务</em>
        </header>
        <div className="kx-console-empty">
          <span><Play size={22} /></span>
          <h3>先从左侧启动一项任务</h3>
          <p>启动后，这里会实时显示 Agent 进度。研究完成时页面会停在人工批准，不会替你自动放行。</p>
          <ol>
            <li><b>01</b><div><strong>Agent 研究与回测</strong><small>记录数据来源、区间和候选策略</small></div></li>
            <li><b>02</b><div><strong>PactLedger 执行 Policy</strong><small>40% 越界建议会被退回并修订</small></div></li>
            <li><b>03</b><div><strong>你批准，再生成回执</strong><small>Mock 与 Testnet 状态始终明确区分</small></div></li>
          </ol>
        </div>
      </section>
    )
  }

  const moment = getWorkspaceMoment(task, false)
  const asset = task.quantEvidence?.symbol ?? task.actionIntent?.symbol ?? lastInput?.asset ?? 'A 股任务'
  const currentAgent = task.agents.find((agent) => agent.status === 'working')
    ?? task.agents.find((agent) => agent.status === 'blocked')
  const trace = executionPaymentTrace(task)
  const receipt = trace?.receipt
  const verifiableReceipt = isVerifiableTestnetReceipt(receipt)

  return (
    <section className="kx-task-console" aria-labelledby="task-console-title">
      <header>
        <div>
          <span>{task.missionId}</span>
          <h2 id="task-console-title">{asset} 研究任务</h2>
          <p>{task.objective}</p>
        </div>
        <em className={task.phase}>{taskPhaseLabel(task.phase)}</em>
      </header>

      <WorkspaceStageRail task={task} />

      <div className={`kx-console-moment ${moment.tone}`} aria-live="polite">
        <span>{moment.label}</span>
        <h3>{moment.title}</h3>
        <p>{moment.detail}</p>
      </div>

      {task.phase === 'awaiting_approval' && task.actionIntent && (
        <section className="kx-decision-panel" aria-label="人工批准操作">
          <div className="kx-decision-head">
            <span><LockKeyhole size={15} /> 轮到你操作</span>
            <strong>批准的是股票策略；结算的是 Execution Agent 服务费。</strong>
          </div>
          <div className="kx-decision-intent">
            <div><span>Action Intent</span><strong>{task.actionIntent.id}</strong></div>
            <div><span>策略</span><strong>{task.actionIntent.strategyVersion}</strong></div>
            <div><span>合规名义金额</span><strong>{task.actionIntent.notional} {task.actionIntent.currency}</strong></div>
          </div>
          <button className="kx-primary" type="button" onClick={() => void onApprove()} disabled={!executionReady || actionPending}>
            {actionPending ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />}
            {actionPending
              ? '正在批准并结算…'
              : injective?.mode === 'testnet'
                ? '批准策略并结算服务费'
                : '批准策略并生成 Mock 回执'}
          </button>
          <p className={executionReady ? 'kx-decision-note' : 'kx-decision-note warning'}>
            {executionReady
              ? '批准后将调用服务端执行路径；相同 Payment Intent 重试不会重复付款。'
              : '结算适配器尚未准备好，请先补齐服务端 Injective 配置或切回 Mock。'}
          </p>
        </section>
      )}

      {!['awaiting_approval', 'executed', 'failed'].includes(task.phase) && (
        <section className="kx-agent-focus" aria-label="当前 Agent 进度">
          <div>
            <span>当前处理者</span>
            <strong>{currentAgent?.name ?? 'Orchestrator'}</strong>
            <p>{currentAgent?.detail ?? '任务已创建，正在分配 Agent。'}</p>
          </div>
          <AgentLine agents={task.agents} />
        </section>
      )}

      {task.phase === 'executed' && (
        <section className={`kx-console-receipt ${receipt?.mode ?? 'unknown'}`}>
          <FileCheck2 size={20} />
          <div>
            <span>{receipt?.mode === 'testnet' ? 'INJECTIVE TESTNET RECEIPT' : 'MOCK RECEIPT'}</span>
            <strong>{receipt?.transactionHash ?? '回执已持久化，但没有交易哈希'}</strong>
            <small>{receipt?.mode === 'mock' ? '本次仅证明控制链路，不生成 Explorer 链接。' : `Block ${receipt?.blockHeight ?? '未返回'}`}</small>
          </div>
          {verifiableReceipt && <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">打开 Explorer <ExternalLink size={13} /></a>}
        </section>
      )}

      {task.phase === 'failed' && (
        <section className="kx-console-failure">
          <AlertTriangle size={18} />
          <div><strong>任务已安全停止</strong><p>{taskFailureMessage(task)}</p></div>
        </section>
      )}

      {task.timeline.length > 0 && (
        <section className="kx-console-log" aria-label="最新任务事件">
          <div className="kx-console-log-title"><span>最新事件</span><small>{task.timeline.length} 条审计记录</small></div>
          <ol>
            {task.timeline.slice(-4).reverse().map((event, index) => (
              <li className={event.tone} key={`${event.time}-${event.title}-${index}`}>
                <time>{event.time}</time><div><strong>{event.title}</strong><small>{event.detail}</small></div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </section>
  )
}

function WorkspaceStageRail({ task }: { task: TaskSnapshot }) {
  const stages = [
    { key: 'research', label: '研究证据', detail: 'PandaAI + 回测' },
    { key: 'policy', label: 'Policy 纠偏', detail: '预算与仓位' },
    { key: 'approval', label: '人工批准', detail: '一次性授权' },
    { key: 'receipt', label: '服务费回执', detail: 'Mock / Testnet' },
  ] as const

  return (
    <div className="kx-stage-rail" aria-label="任务阶段">
      {stages.map((stage, index) => {
        const state = workspaceStageState(task, stage.key)
        return (
          <div className={`kx-stage ${state}`} key={stage.key}>
            <span>{state === 'complete' ? <Check size={12} /> : state === 'active' ? <LoaderCircle size={12} className="spin" /> : state === 'failed' ? <AlertTriangle size={12} /> : index + 1}</span>
            <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
          </div>
        )
      })}
    </div>
  )
}

interface ControlRailProps {
  draft: TaskDraft
  injective?: InjectiveConfigStatus
  lastInput?: CreateTaskInput
  onOpenCase: () => void
  task?: TaskSnapshot
}

function ControlRail({ draft, injective, lastInput, onOpenCase, task }: ControlRailProps) {
  const asset = lastInput?.asset ?? (draft.symbol.trim().toUpperCase() || '未设置')
  const budget = lastInput?.budgetUsdt ?? Number(draft.budgetUsdt || 0)
  const maxLoss = lastInput?.maxLossPct ?? Number(draft.maxLossPct || 0)
  const maxAsset = lastInput?.maxAssetPct ?? Number(draft.maxAssetPct || 0)

  return (
    <aside className="kx-control-rail" aria-label="本次任务资金规则">
      <div className="kx-control-title"><WalletCards size={17} /><div><span>PACTLEDGER CONTROL</span><h2>本次规则</h2></div></div>
      <dl>
        <div><dt>标的白名单</dt><dd>{asset}</dd></div>
        <div><dt>任务预算</dt><dd>{budget.toLocaleString()} USDT</dd></div>
        <div><dt>最大回撤</dt><dd>{maxLoss}%</dd></div>
        <div><dt>单股仓位</dt><dd>{maxAsset}%</dd></div>
        <div><dt>结算模式</dt><dd>{injective?.mode === 'testnet' ? 'Injective Testnet' : 'Mock · No Chain'}</dd></div>
      </dl>

      <div className="kx-control-pipeline">
        <span>资金动作必须经过</span>
        <ol>
          <li className={task ? 'complete' : 'active'}><Fingerprint size={13} /><strong>Intent</strong></li>
          <li className={task?.actionIntent ? 'complete' : task ? 'active' : ''}><ShieldCheck size={13} /><strong>Policy</strong></li>
          <li className={task?.phase === 'awaiting_approval' ? 'active' : ['approved', 'executing', 'executed'].includes(task?.phase ?? '') ? 'complete' : ''}><LockKeyhole size={13} /><strong>Approval</strong></li>
          <li className={executionPaymentTrace(task)?.receipt ? 'complete' : ['approved', 'executing'].includes(task?.phase ?? '') ? 'active' : ''}><FileCheck2 size={13} /><strong>Receipt</strong></li>
        </ol>
      </div>

      <p className="kx-control-truth"><AlertTriangle size={14} /> A 股业务指令不会发送到 Injective。链上只结算 Agent 服务费，并且只有完整证据才显示“已确认”。</p>
      <button className="kx-control-link" type="button" onClick={onOpenCase}><Presentation size={14} /> 查看评委版案例展板 <ArrowRight size={13} /></button>
      <a className="kx-control-link secondary" href="/poolmate.html"><Workflow size={14} /> 查看 PoolMate 复用 <ArrowRight size={13} /></a>
    </aside>
  )
}

function WorkspaceEvidence({ task }: { task?: TaskSnapshot }) {
  if (!task) return null
  const riskTrace = riskPaymentTrace(task)
  const executionTrace = executionPaymentTrace(task)

  return (
    <section className="kx-workspace-evidence" aria-labelledby="workspace-evidence-title">
      <header>
        <div><span>LIVE EVIDENCE LEDGER</span><h2 id="workspace-evidence-title">本次任务留下的可核验证据</h2></div>
        <p>这里不是另一张故事海报。每一行都来自当前任务快照、PolicyDecision 或 SettlementReceipt。</p>
      </header>
      <div className="kx-evidence-ledger">
        <EvidenceLedgerRow number="01" title="数据与策略" state={analysisState(task)} owner="KaleidoX + PandaAI">
          {task.quantEvidence ? (
            <>
              <EvidenceGrid rows={[
                ['数据模式', providerName(task)],
                ['股票代码', task.quantEvidence.symbol],
                ['数据区间', `${task.quantEvidence.startDate}—${task.quantEvidence.endDate}`],
                ['日线条数', String(task.quantEvidence.barCount)],
                ['调用方法', task.quantEvidence.sourceMethod],
                ['抓取时间', formatTime(task.quantEvidence.fetchedAt)],
              ]} />
              {task.researchSummary && <p className="kx-research-summary">{task.researchSummary}</p>}
              {task.candidates.length > 0 && <StrategyTable task={task} />}
            </>
          ) : <EvidenceWaiting text="Agent 正在获取行情与生成确定性回测证据。" />}
        </EvidenceLedgerRow>

        <EvidenceLedgerRow number="02" title="Policy 与纠偏" state={policyState(task)} owner="PactLedger Base">
          <PolicyList task={task} />
          {task.timeline.some((event) => event.tone === 'warning') && (
            <div className="kx-correction"><span><GitBranch size={15} /> Policy correction</span><strong>40% 建议仓位</strong><ArrowRight size={14} /><strong>25% 合规意图</strong></div>
          )}
          {riskTrace ? <PaymentTrace trace={riskTrace} /> : <EvidenceWaiting text="等待 Risk Agent 提交审核服务费 Payment Intent。" />}
        </EvidenceLedgerRow>

        <EvidenceLedgerRow number="03" title="批准与回执" state={receiptState(task)} owner="PactLedger + Injective">
          {task.actionIntent ? (
            <div className="kx-intent">
              <div><span>Action Intent</span><strong>{task.actionIntent.id}</strong></div>
              <div><span>业务动作</span><strong>{task.actionIntent.action} · {task.actionIntent.symbol}</strong></div>
              <div><span>状态</span><strong>{task.actionIntent.status}</strong></div>
            </div>
          ) : <EvidenceWaiting text="等待合规策略生成 Action Intent。" />}
          {executionTrace ? <PaymentTrace trace={executionTrace} /> : <EvidenceWaiting text="人工批准后才会创建 Execution Agent 服务费回执。" />}
        </EvidenceLedgerRow>
      </div>
    </section>
  )
}

interface EvidenceLedgerRowProps {
  children: React.ReactNode
  number: string
  owner: string
  state: StepState
  title: string
}

function EvidenceLedgerRow({ children, number, owner, state, title }: EvidenceLedgerRowProps) {
  return (
    <article className={`kx-evidence-ledger-row ${state}`}>
      <div className="kx-evidence-ledger-label"><span>{number}</span><h3>{title}</h3><small>{owner}</small><em>{stepStateLabel(state)}</em></div>
      <div className="kx-evidence-ledger-content">{children}</div>
    </article>
  )
}

function EvidenceWaiting({ text }: { text: string }) {
  return <p className="kx-evidence-waiting"><Circle size={10} /> {text}</p>
}

interface CaseBoardProps {
  actionPending: boolean
  bot: ReturnType<typeof useBotStatus>
  error?: string
  executionReady: boolean
  injective?: InjectiveConfigStatus
  injectivePresentation: { label: string; tone: 'ok' | 'review' }
  onApprove: () => Promise<void>
  onOpenWorkspace: () => void
  pandaPresentation: { label: string; tone: 'ok' | 'review' }
  pandaSdk: string
  task?: TaskSnapshot
}

function CaseBoard({
  actionPending,
  bot,
  error,
  executionReady,
  injective,
  injectivePresentation,
  onApprove,
  onOpenWorkspace,
  pandaPresentation,
  pandaSdk,
  task,
}: CaseBoardProps) {
  const executionTrace = executionPaymentTrace(task)

  return (
    <>
      <section className="kx-intro">
        <a className="kx-back" href="/"><ArrowLeft size={14} /> 返回基座</a>
        <p className="kx-kicker">CASE BOARD · PACTLEDGER REFERENCE APP 01</p>
        <h1>股票 Agent 负责研究，<br />资金基座负责踩刹车。</h1>
        <p className="kx-intro-copy">
          这张展板用于讲清完整案例；真实操作请进入任务工作区。KaleidoX 只提出策略建议，PactLedger 控制 Agent 服务费、权限边界和审计回执。
        </p>
        <div className="kx-intro-actions">
          <button className="kx-primary" type="button" onClick={onOpenWorkspace}><LayoutDashboard size={16} /> 进入工作区亲自运行</button>
          <a className="kx-secondary-button" href="/poolmate.html">查看第二个业务 <ArrowRight size={15} /></a>
        </div>
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

      {error && <div className="kx-api-error" role="alert">{error}</div>}

      <section className="kx-story" aria-label="KaleidoX 案例展板与运行证据">
        <div className="kx-story-main">
          <StoryStep
            number="01"
            label="用户发起"
            owner="KaleidoX Workspace"
            state={task ? 'complete' : 'pending'}
            title={task ? `${task.missionId} 已从工作区提交` : '用户先在工作区设定预算和风险上限'}
            summary={task
              ? `${task.quantEvidence?.symbol ?? task.actionIntent?.symbol ?? '股票任务'} · ${task.firewallRules[0]?.limit ?? '预算已锁定'} · 所有规则随任务快照保存。`
              : '案例不是自动播放动画。用户需要亲自选择股票、设置规则并启动任务。'}
          >
            {task ? (
              <div className="kx-intent">
                <div><span>Task ID</span><strong>{task.id}</strong></div>
                <div><span>当前阶段</span><strong>{taskPhaseLabel(task.phase)}</strong></div>
                <div><span>创建时间</span><strong>{formatTime(task.createdAt)}</strong></div>
              </div>
            ) : (
              <button className="kx-primary" type="button" onClick={onOpenWorkspace}><Play size={16} /> 去工作区发起任务</button>
            )}
          </StoryStep>

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
            {task?.candidates.length ? <EvidenceDetails label="比较三个策略版本" open><StrategyTable task={task} /></EvidenceDetails> : null}
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
            {task && <PolicyList task={task} />}
            {task?.timeline.some((event) => event.tone === 'warning') && (
              <div className="kx-correction"><span><GitBranch size={15} /> Policy correction</span><strong>40% 建议仓位</strong><ArrowRight size={14} /><strong>25% 合规意图</strong></div>
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
                <button className="kx-primary" type="button" onClick={() => void onApprove()} disabled={!executionReady || actionPending}>
                  {actionPending ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={17} />}
                  {actionPending ? '正在批准并结算…' : injective?.mode === 'testnet' ? '批准策略并结算服务费' : '批准策略并生成 Mock 服务费回执'}
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
          <button className="kx-secondary-link button" type="button" onClick={onOpenWorkspace}>进入可操作工作区 <ArrowRight size={15} /></button>
          <a className="kx-secondary-link" href="/poolmate.html">看第二个业务如何复用 <ArrowRight size={15} /></a>

          <details className="kx-system-details">
            <summary>当前接入状态 <ChevronDown size={14} /></summary>
            <div>
              <SystemRow label="PandaAI" value={pandaPresentation.label} />
              <SystemRow label="Panda SDK" value={pandaSdk} />
              <SystemRow label="Quant Skill" value="pandadata-api" />
              <SystemRow label="Execution" value={injective?.adapter ?? 'loading'} />
              <SystemRow label="Settlement state" value={injectivePresentation.label} />
              <SystemRow label="Chain" value={injective?.chainId ?? 'injective-888'} />
              <div className="kx-bot-row">
                <span>PoolMate Bot</span>
                <strong title={bot.reason}>{bot.label}</strong>
                <button
                  className="kx-bot-test-btn"
                  type="button"
                  disabled={bot.testing}
                  onClick={() => void bot.test()}
                >
                  {bot.testing ? '检测中…' : '重新检测'}
                </button>
              </div>
              <SystemRow label="Bot settlement" value="Mock · No Chain" />
              {bot.status?.ok && bot.status.inviteUrl && (
                <a className="kx-bot-link" href={bot.status.inviteUrl} target="_blank" rel="noreferrer">
                  打开 @{bot.status.username}
                </a>
              )}
              {bot.reason && <p className="kx-bot-error">{bot.reason}</p>}
            </div>
          </details>
        </aside>
      </section>
    </>
  )
}

interface WorkspaceMoment {
  detail: string
  label: string
  title: string
  tone: 'idle' | 'running' | 'attention' | 'complete' | 'failed'
}

function getWorkspaceMoment(task: TaskSnapshot | undefined, submitting: boolean): WorkspaceMoment {
  if (submitting) {
    return {
      label: '正在创建任务',
      title: 'PactLedger 正在锁定本次规则',
      detail: '预算、风险上限和标的白名单会随任务一起保存。',
      tone: 'running',
    }
  }
  if (!task) {
    return {
      label: '下一步 · 配置任务',
      title: '先决定 Agent 能做什么',
      detail: '从左侧选择股票并设置预算、回撤和仓位上限，然后启动真实任务。',
      tone: 'idle',
    }
  }
  if (task.phase === 'awaiting_approval') {
    return {
      label: '需要你的决定',
      title: '修订策略已通过 Policy，等待人工批准',
      detail: '系统已经拦下 40% 越界建议并修订为 25%；只有你可以放行下一步。',
      tone: 'attention',
    }
  }
  if (task.phase === 'executed') {
    return {
      label: '任务闭环完成',
      title: '策略指令与 Agent 服务费回执均已生成',
      detail: executionTraceSummary(executionPaymentTrace(task)),
      tone: 'complete',
    }
  }
  if (task.phase === 'failed') {
    return {
      label: '已安全停止',
      title: '任务没有越过失败边界',
      detail: taskFailureMessage(task) ?? '失败原因已写入任务审计轨迹。',
      tone: 'failed',
    }
  }
  if (task.phase === 'approved' || task.phase === 'executing') {
    return {
      label: '正在执行批准结果',
      title: 'Execution Agent 正在生成指令与服务费回执',
      detail: '业务 Action Intent 与 AgentPaymentIntent 保持分离，结算结果将写回 Receipt Ledger。',
      tone: 'running',
    }
  }
  const activeAgent = task.agents.find((agent) => agent.status === 'working')
  return {
    label: `正在进行 · ${taskPhaseLabel(task.phase)}`,
    title: activeAgent ? `${activeAgent.name} Agent 正在处理` : 'Orchestrator 正在推进任务',
    detail: activeAgent?.detail ?? '等待下一条任务快照。',
    tone: task.phase === 'risk_review' ? 'attention' : 'running',
  }
}

type WorkspaceStageKey = 'research' | 'policy' | 'approval' | 'receipt'

function workspaceStageState(task: TaskSnapshot, stage: WorkspaceStageKey): StepState {
  if (stage === 'research') {
    if (task.candidates.length > 0) return 'complete'
    return task.phase === 'failed' ? 'failed' : 'active'
  }
  if (stage === 'policy') {
    if (task.actionIntent && task.phase !== 'risk_review') return 'complete'
    if (task.phase === 'risk_review') return 'active'
    return task.phase === 'failed' && task.candidates.length > 0 ? 'failed' : 'pending'
  }
  if (stage === 'approval') {
    if (['approved', 'executing', 'executed'].includes(task.phase)) return 'complete'
    if (task.phase === 'awaiting_approval') return 'active'
    return task.phase === 'failed' && Boolean(task.actionIntent) ? 'failed' : 'pending'
  }
  const receipt = executionPaymentTrace(task)?.receipt
  if (receipt?.status === 'confirmed') return 'complete'
  if (receipt?.status === 'failed' || task.phase === 'failed') return 'failed'
  if (task.phase === 'approved' || task.phase === 'executing') return 'active'
  return 'pending'
}

const taskPhaseLabels: Record<TaskPhase, string> = {
  created: '任务已创建',
  researching: '数据研究中',
  strategizing: '策略生成中',
  backtesting: '回测中',
  risk_review: 'Policy 审核中',
  awaiting_approval: '等待人工批准',
  approved: '已批准',
  executing: '执行与结算中',
  executed: '已完成',
  failed: '已安全停止',
}

function taskPhaseLabel(phase: TaskPhase): string {
  return taskPhaseLabels[phase]
}

function stepStateLabel(state: StepState): string {
  if (state === 'complete') return '已留证'
  if (state === 'active') return '进行中'
  if (state === 'failed') return '已停止'
  return '等待中'
}

function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'review' }) {
  return <span className={`kx-status-pill ${tone}`}><i />{label}</span>
}

function BotStatusPill({ bot }: { bot: ReturnType<typeof useBotStatus> }) {
  return (
    <button
      className={`kx-status-pill ${bot.tone} kx-bot-pill`}
      type="button"
      title={bot.reason ?? '重新检测 PoolMate Bot'}
      onClick={() => void bot.test()}
      disabled={bot.testing}
    >
      <i />PoolMate {bot.label}
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
