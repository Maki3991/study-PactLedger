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
import { TaskFlowView } from './views/TaskFlowView'
import { StrategyLabView } from './views/StrategyLabView'
import { MemoryBankView } from './views/MemoryBankView'
import { ExecutionView } from './views/ExecutionView'
import { TreasuryView } from './views/TreasuryView'

const navigation = [
  { label: '总览', icon: LayoutDashboard, active: true },
  { label: '任务流', icon: Network },
  { label: '策略实验', icon: FlaskConical },
  { label: '记忆库', icon: Database },
  { label: '链上执行', icon: WalletCards },
  { label: '资金流', icon: Vault },
]

const viewMeta: Record<string, { title: string; subtitle: string }> = {
  '总览': { title: 'ETH 策略进化任务', subtitle: '从失败交易中生成下一代策略，并在用户风险边界内完成验证与执行。' },
  '任务流': { title: 'A2A 任务编排', subtitle: '多 Agent 协作管线的实时状态与交互记录。' },
  '策略实验': { title: '策略竞争实验室', subtitle: 'Champion–Challenger 回测对比与版本进化历史。' },
  '记忆库': { title: '双层记忆系统', subtitle: '用户偏好记忆与策略表现记忆的持久化存储。' },
  '链上执行': { title: 'Injective 测试网执行', subtitle: 'Capital Firewall 校验、交易广播与链上回执。' },
  '资金流': { title: 'Agent Treasury', subtitle: '6 个 Agent 钱包实时余额、资金流向与不可篡改审计账本。' },
}

function App() {
  const [selectedStrategy, setSelectedStrategy] = useState('v2b')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('总览')
  const { task, error, start, approveAndExecute } = useTaskWorkflow()
  const injective = useInjectiveConfig()

  const agents = task?.agents ?? demoAgents
  const candidates = task?.candidates.length ? task.candidates : initialCandidates
  const rules = task?.firewallRules ?? firewallRules
  const events = task ? task.timeline : timeline
  const executionState = task?.execution.state ?? 'ready'
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
          <div><strong>KaleidoX</strong><span>Strategy OS</span></div>
          <button className="mobile-close icon-button" title="关闭导航" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <span className="nav-label">WORKSPACE</span>
          {navigation.map(({ label, icon: Icon, active }) => (
            <button
              className={(activeNav === label || (active && activeNav === '总览')) ? 'nav-item active' : 'nav-item'}
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
          <p>6 Agents · 24 Skills</p>
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
          <div className="breadcrumb"><span>任务中心</span><i>/</i><strong>ETH Alpha Evolution</strong></div>
          <div className="topbar-actions">
            <button className="search-button"><Search size={16} /><span>搜索</span><kbd>⌘ K</kbd></button>
            <button className={`network-badge ${injective.status?.credentialsConfigured ? 'configured' : 'pending'}`} onClick={() => setConfigOpen(true)}>
              <i /> Injective Testnet
            </button>
            <button className="icon-button notification-button" title="通知"><Bell size={18} /><i /></button>
          </div>
        </header>

        <main>
          <section className="mission-header">
            <div>
              <span className="mission-id">MISSION / {task?.missionId ?? 'KX-260723-DEMO'}</span>
              <h1>{viewMeta[activeNav]?.title ?? 'ETH 策略进化任务'}</h1>
              <p>{viewMeta[activeNav]?.subtitle ?? ''}</p>
            </div>
            <div className="mission-controls">
              <button className="secondary-action"><History size={16} /> 历史快照</button>
              <button className="status-control" onClick={start} disabled={!canStart}><span className="pulse-dot" /> {runLabel} <ChevronDown size={15} /></button>
            </div>
          </section>

          {error && <div className="api-error" role="alert">{error}</div>}

          {(activeNav === '总览' || activeNav === '链上执行') && (
            <section className="constraint-strip" aria-label="任务授权范围">
              <div className="constraint-title"><ShieldCheck size={17} /><span>用户授权边界</span></div>
              <div><span>预算</span><strong>1,000 USDT</strong></div>
              <div><span>最大亏损</span><strong>5.0%</strong></div>
              <div><span>单一资产仓位</span><strong>≤ 30%</strong></div>
              <div><span>交易标的</span><strong>ETH / USDT</strong></div>
              <span className="immutable-tag">IMMUTABLE</span>
            </section>
          )}

          {activeNav === '总览' && (
            <div className="dashboard-grid">
              <AgentRail agents={agents} />
              <EvolutionPanel candidates={candidates} selectedId={selectedStrategy} onSelect={setSelectedStrategy} />
              <FirewallPanel
                rules={rules}
                executionState={executionState}
                canExecute={task?.phase === 'awaiting_approval' && injective.status?.readyForExecution === true}
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
          {activeNav === '记忆库' && <MemoryBankView task={task} />}
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
            <span><BrainCircuit size={14} /> DeepSeek V4 Pro</span>
            <span><Bot size={14} /> A2A compatible</span>
            <span><GitBranch size={14} /> Strategy v2.0-rc1</span>
            <span className="latency"><Activity size={14} /> 84ms</span>
          </footer>
        </main>
      </div>
      <InjectiveConfigDrawer open={configOpen} status={injective.status} error={injective.error} onClose={() => setConfigOpen(false)} />
    </div>
  )
}

export default App
