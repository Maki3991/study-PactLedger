import { useState } from 'react'
import {
  Activity,
  Bell,
  Bot,
  BrainCircuit,
  ChevronDown,
  Command,
  Database,
  FlaskConical,
  GitBranch,
  History,
  LayoutDashboard,
  Menu,
  Network,
  PanelLeftClose,
  Search,
  Settings2,
  ShieldCheck,
  Vault,
  WalletCards,
  X,
} from 'lucide-react'
import { AgentRail } from './components/AgentRail'
import { EvolutionPanel } from './components/EvolutionPanel'
import { FirewallPanel } from './components/FirewallPanel'
import { InjectiveConfigDrawer } from './components/InjectiveConfigDrawer'
import { demoAgents, firewallRules, initialCandidates, timeline } from './services/demoData'
import { useTaskWorkflow } from './services/useTaskWorkflow'
import { useInjectiveConfig } from './services/useInjectiveConfig'
import { usePandaConfig } from './services/usePandaConfig'
import { TaskFlowView } from './views/TaskFlowView'
import { StrategyLabView } from './views/StrategyLabView'
import { MemoryBankView } from './views/MemoryBankView'
import { ExecutionView } from './views/ExecutionView'
import { TreasuryView } from './views/TreasuryView'
import { TreasuryOverviewView } from './views/TreasuryOverviewView'

const navigation = [
  { label: '基座总览', icon: LayoutDashboard, active: true },
  { label: '股票量化', icon: Activity },
  { label: '任务流', icon: Network },
  { label: '策略实验', icon: FlaskConical },
  { label: '统一账本', icon: Database },
  { label: '链上执行', icon: WalletCards },
  { label: '资金流', icon: Vault },
]

const viewMeta: Record<string, { title: string; subtitle: string }> = {
  '基座总览': { title: 'Agent Treasury 控制基座', subtitle: '统一管理 Agent 账户、动作意图、资金策略、审批、执行与审计证据。' },
  '股票量化': { title: '股票策略进化任务', subtitle: '使用 PandaAI 股票数据生成、回测和验证策略，再提交统一 Action Intent。' },
  '任务流': { title: 'A2A 任务编排', subtitle: '多 Agent 协作管线的实时状态与交互记录。' },
  '策略实验': { title: '策略竞争实验室', subtitle: 'Champion–Challenger 回测对比与版本进化历史。' },
  '统一账本': { title: '统一审计账本', subtitle: '跨案例保存数据来源、策略版本、Policy 决策和执行回执。' },
  '链上执行': { title: 'Injective 执行适配器', subtitle: '为合约团队保留明确的 Intent 输入与 Receipt 输出边界。' },
  '资金流': { title: 'Agent Treasury', subtitle: '7 个 Agent 账户实时余额、资金流向与不可篡改审计账本。' },
}

function App() {
  const [selectedStrategy, setSelectedStrategy] = useState<string>()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('基座总览')
  const { task, error, start, approveAndExecute } = useTaskWorkflow()
  const injective = useInjectiveConfig()
  const panda = usePandaConfig()

  const agents = task?.agents ?? demoAgents
  const candidates = task?.candidates.length ? task.candidates : initialCandidates
  const rules = task?.firewallRules ?? firewallRules
  const events = task ? task.timeline : timeline
  const executionState = task?.execution.state ?? 'ready'
  const activeStrategyId = selectedStrategy
    ?? candidates.find((candidate) => candidate.status === 'approved')?.id
    ?? candidates[0]?.id
    ?? 'v1'
  const canStart = !task || task.phase === 'executed' || task.phase === 'failed'
  const runLabel = !task
    ? '启动演示'
    : task.phase === 'awaiting_approval'
      ? '等待批准'
      : task.phase === 'executed' ? '已完成' : 'Live run'

  return (
    <div className="app-shell">
      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Command size={18} /></div>
          <div><strong>Agent Treasury</strong><span>CONTROL PLANE</span></div>
          <button className="mobile-close icon-button" title="关闭导航" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <span className="nav-label">WORKSPACE</span>
          {navigation.map(({ label, icon: Icon, active }) => (
            <button
              className={(activeNav === label || (active && activeNav === '基座总览')) ? 'nav-item active' : 'nav-item'}
              key={label}
              onClick={() => { setActiveNav(label); setSidebarOpen(false) }}
            >
              <Icon size={17} /><span>{label}</span>
              {label === '任务流' && <small>1</small>}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="system-health">
          <div className="health-label"><span><i /> Systems nominal</span><strong>98.6%</strong></div>
          <div className="health-track"><span /></div>
          <p>7 Accounts · 24 Skills</p>
        </div>
        <button className="profile-row">
          <span className="avatar">HX</span>
          <span><strong>Heping</strong><small>Operator</small></span>
          <Settings2 size={16} />
        </button>
      </aside>

      {sidebarOpen && <button className="sidebar-backdrop" aria-label="关闭导航" onClick={() => setSidebarOpen(false)} />}

      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu icon-button" title="打开导航" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>任务中心</span><i>/</i><strong>Stock Quant Evolution</strong></div>
          <div className="topbar-actions">
            <button className="search-button"><Search size={16} /><span>搜索</span><kbd>⌘ K</kbd></button>
            <button className={`network-badge ${injective.status?.credentialsConfigured ? 'configured' : 'pending'}`} onClick={() => setConfigOpen(true)}>
              <i /> Injective Testnet
            </button>
            <span className={`network-badge passive-badge ${panda.status?.provider === 'panda-data' ? 'configured' : 'pending'}`}>
              <i /> PandaAI {panda.status?.provider === 'panda-data' ? 'Live' : 'Replay'}
            </span>
            <button className="icon-button notification-button" title="通知"><Bell size={18} /><i /></button>
          </div>
        </header>

        <main>
          <section className="mission-header">
            <div>
              <span className="mission-id">MISSION / {task?.missionId ?? 'KX-260723-DEMO'}</span>
              <h1>{viewMeta[activeNav]?.title ?? 'Agent Treasury 控制基座'}</h1>
              <p>{viewMeta[activeNav]?.subtitle ?? ''}</p>
            </div>
            <div className="mission-controls">
              <button className="secondary-action"><History size={16} /> 历史快照</button>
              <button className="status-control" onClick={start} disabled={!canStart}><span className="pulse-dot" /> {runLabel} <ChevronDown size={15} /></button>
            </div>
          </section>

          {error && <div className="api-error" role="alert">{error}</div>}

          {(activeNav === '股票量化' || activeNav === '链上执行') && (
            <section className="constraint-strip" aria-label="任务授权范围">
              <div className="constraint-title"><ShieldCheck size={17} /><span>用户授权边界</span></div>
              <div><span>预算</span><strong>1,000 USDT</strong></div>
              <div><span>最大亏损</span><strong>5.0%</strong></div>
              <div><span>单一股票仓位</span><strong>≤ 30%</strong></div>
              <div><span>研究标的</span><strong>000001.SZ</strong></div>
              <span className="immutable-tag">IMMUTABLE</span>
            </section>
          )}

          {activeNav === '基座总览' && <TreasuryOverviewView task={task} panda={panda.status} injective={injective.status} />}

          {activeNav === '股票量化' && (
            <div className="dashboard-grid">
              <AgentRail agents={agents} />
              <EvolutionPanel candidates={candidates} selectedId={activeStrategyId} onSelect={setSelectedStrategy} />
              <FirewallPanel
                rules={rules}
                executionState={executionState}
                canExecute={task?.phase === 'awaiting_approval' && injective.status?.readyForExecution === true}
                executionMode={injective.status?.mode}
                strategyVersion={task?.actionIntent?.strategyVersion}
                transactionHash={task?.execution.transactionHash}
                onExecute={approveAndExecute}
              />

              <section className="panel timeline-panel" aria-labelledby="timeline-heading">
                <div className="panel-heading">
                  <div><span className="eyebrow">Decision ledger</span><h2 id="timeline-heading">决策证据链</h2></div>
                  <button className="icon-button" title="筛选记录"><PanelLeftClose size={17} /></button>
                </div>
                <div className="timeline-list">
                  {events.map((event, index) => (
                    <div className={`timeline-event ${event.tone}`} key={`${event.time}-${index}`}>
                      <time>{event.time}</time><i />
                      <div><strong>{event.title}</strong><span>{event.detail}</span></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeNav === '任务流' && <TaskFlowView task={task} />}
          {activeNav === '策略实验' && <StrategyLabView task={task} />}
          {activeNav === '统一账本' && <MemoryBankView task={task} />}
          {activeNav === '链上执行' && (
            <ExecutionView
              task={task}
              rules={rules}
              executionState={executionState}
              canExecute={task?.phase === 'awaiting_approval' && injective.status?.readyForExecution === true}
              transactionHash={task?.execution.transactionHash}
              injectiveStatus={injective.status}
              onExecute={approveAndExecute}
            />
          )}
          {activeNav === '资金流' && <TreasuryView taskId={task?.id} />}

          <footer className="workspace-footer">
            <span><BrainCircuit size={14} /> PandaAI {panda.status?.provider === 'panda-data' ? 'Data Live' : 'Replay'}</span>
            <span><Bot size={14} /> Unified Action Intent</span>
            <span><GitBranch size={14} /> Treasury API v0.2</span>
            <span className="latency"><Activity size={14} /> 84ms</span>
          </footer>
        </main>
      </div>
      <InjectiveConfigDrawer open={configOpen} status={injective.status} error={injective.error} onClose={() => setConfigOpen(false)} />
    </div>
  )
}

export default App
