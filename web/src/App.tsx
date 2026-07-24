import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  BrainCircuit,
  ChevronDown,
  Command,
  Database,
  GitBranch,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  ShieldCheck,
  Vault,
  WalletCards,
  X,
} from 'lucide-react'
import { AuthScreen } from './components/AuthScreen'
import { useAuth } from './services/useAuth'
import type { AuthUser } from './services/authClient'
import { EvolutionPanel } from './components/EvolutionPanel'
import { FirewallPanel } from './components/FirewallPanel'
import { InjectiveConfigDrawer } from './components/InjectiveConfigDrawer'
import { firewallRules, initialCandidates } from './services/demoData'
import { useTaskWorkflow } from './services/useTaskWorkflow'
import { useInjectiveConfig } from './services/useInjectiveConfig'
import { TaskFlowView } from './views/TaskFlowView'
import { MemoryBankView } from './views/MemoryBankView'
import { ExecutionView } from './views/ExecutionView'
import { TreasuryView } from './views/TreasuryView'

const navigation = [
  { label: '总览', icon: LayoutDashboard, path: '/' },
  { label: '记忆库', icon: Database, path: '/memory' },
  { label: '链上执行', icon: WalletCards, path: '/execution' },
  { label: '资金流', icon: Vault, path: '/treasury' },
]

const viewMeta: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'ETH 策略进化任务', subtitle: '从失败交易中生成下一代策略，并在用户风险边界内完成验证与执行。' },
  '/memory': { title: '双层记忆系统', subtitle: '用户偏好记忆与策略表现记忆的持久化存储，以及知识库进化过程。' },
  '/execution': { title: 'Injective 测试网执行', subtitle: 'Capital Firewall 校验、交易广播与链上回执。' },
  '/treasury': { title: 'Agent Treasury', subtitle: '6 个 Agent 钱包实时余额、资金流向与不可篡改审计账本。' },
}

const failureAttribution = [
  'V1 过度依赖短期趋势信号，在震荡行情中连续产生错误入场',
  '未识别当前市场状态（震荡 vs 趋势），导致策略与环境不匹配',
  '交易频率过高（23 笔），放大错误信号影响并增加手续费损耗',
]

const mechanismSteps = [
  { step: '01', text: 'Evolution Agent 从失败交易中生成多个候选策略变体' },
  { step: '02', text: 'Backtest Agent 使用相同数据区间进行 Champion–Challenger 回测' },
  { step: '03', text: '只有风险调整后表现更好、且通过样本外验证的候选策略才能晋级' },
  { step: '04', text: 'Risk Agent 重新审核，高风险变更需用户确认' },
  { step: '05', text: '获胜策略升级为新版本，后续交易关联到明确的策略版本' },
]

function App() {
  const { session, validating, login, register, logout } = useAuth()

  if (validating) {
    return (
      <div className="app-boot">
        <Command size={28} />
        <p>正在恢复会话…</p>
      </div>
    )
  }

  if (!session) return <AuthScreen onLogin={login} onRegister={register} />
  return <Workspace user={session.user} onLogout={logout} />
}

interface WorkspaceProps {
  user: AuthUser
  onLogout: () => Promise<void>
}

function Workspace({ user, onLogout }: WorkspaceProps) {
  const [selectedStrategy, setSelectedStrategy] = useState('v2b')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const { task, error, start, approveAndExecute } = useTaskWorkflow()
  const injective = useInjectiveConfig()
  const location = useLocation()
  const currentPath = location.pathname

  const candidates = task?.candidates.length ? task.candidates : initialCandidates
  const rules = task?.firewallRules ?? firewallRules
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
          {navigation.map(({ label, icon: Icon, path }) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
              key={label}
              to={path}
              end={path === '/'}
              onClick={() => setSidebarOpen(false)}
            >
              <Icon size={17} /><span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="system-health">
          <div className="health-label"><span><i /> Systems nominal</span><strong>98.6%</strong></div>
          <div className="health-track"><span /></div>
          <p>6 Agents · 24 Skills</p>
        </div>
        <div className="profile-row">
          <span className="avatar">{user.username.slice(0, 2).toUpperCase()}</span>
          <span><strong>{user.username}</strong><small>Operator</small></span>
          <button className="icon-button" title="退出登录" onClick={() => void onLogout()}><LogOut size={16} /></button>
        </div>
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
              <h1>{viewMeta[currentPath]?.title ?? 'ETH 策略进化任务'}</h1>
              <p>{viewMeta[currentPath]?.subtitle ?? ''}</p>
            </div>
            <div className="mission-controls">
              <button className="secondary-action"><History size={16} /> 历史快照</button>
              <button className="status-control" onClick={start} disabled={!canStart}><span className="pulse-dot" /> {runLabel} <ChevronDown size={15} /></button>
            </div>
          </section>

          {error && <div className="api-error" role="alert">{error}</div>}

          {(currentPath === '/' || currentPath === '/execution') && (
            <section className="constraint-strip" aria-label="任务授权范围">
              <div className="constraint-title"><ShieldCheck size={17} /><span>用户授权边界</span></div>
              <div><span>预算</span><strong>1,000 USDT</strong></div>
              <div><span>最大亏损</span><strong>5.0%</strong></div>
              <div><span>单一资产仓位</span><strong>≤ 30%</strong></div>
              <div><span>交易标的</span><strong>ETH / USDT</strong></div>
              <span className="immutable-tag">IMMUTABLE</span>
            </section>
          )}

          <Routes>
            <Route path="/" element={
              <>
                <div className="dashboard-grid">
                  <EvolutionPanel candidates={candidates} selectedId={selectedStrategy} onSelect={setSelectedStrategy} />
                  <FirewallPanel
                    rules={rules}
                    executionState={executionState}
                    canExecute={task?.phase === 'awaiting_approval' && injective.status?.readyForExecution === true}
                    transactionHash={task?.execution.transactionHash}
                    onExecute={approveAndExecute}
                  />
                </div>

                <TaskFlowView task={task} />

                <div className="overview-insights">
                  <section className="panel attribution-panel" aria-labelledby="attribution-heading">
                    <div className="panel-heading">
                      <div><span className="eyebrow">Failure Attribution</span><h2 id="attribution-heading">V1 失败归因</h2></div>
                      <X size={18} className="attribution-icon" />
                    </div>
                    <div className="attribution-body">
                      {failureAttribution.map((text, index) => (
                        <div className="attribution-item" key={index}>
                          <AlertTriangle size={14} />
                          <p>{text}</p>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="panel mechanism-panel" aria-labelledby="mechanism-heading">
                    <div className="panel-heading">
                      <div><span className="eyebrow">Champion–Challenger</span><h2 id="mechanism-heading">晋级机制</h2></div>
                      <GitBranch size={18} className="mechanism-icon" />
                    </div>
                    <div className="mechanism-body">
                      {mechanismSteps.map((item) => (
                        <div className="mechanism-step" key={item.step}>
                          <span>{item.step}</span>
                          <p>{item.text}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            } />
            <Route path="/memory" element={<MemoryBankView task={task} />} />
            <Route path="/execution" element={
              <ExecutionView
                task={task}
                rules={rules}
                executionState={executionState}
                canExecute={task?.phase === 'awaiting_approval' && injective.status?.readyForExecution === true}
                transactionHash={task?.execution.transactionHash}
                injectiveStatus={injective.status}
                onExecute={approveAndExecute}
              />
            } />
            <Route path="/treasury" element={<TreasuryView taskId={task?.id} />} />
          </Routes>

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
