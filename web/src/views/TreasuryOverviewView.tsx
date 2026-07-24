import { ArrowRight, Check, CircleDashed, Database, FileCheck2, Landmark, ShieldCheck, WalletCards } from 'lucide-react'
import type { InjectiveConfigStatus, PandaConfigStatus, TaskSnapshot } from '../domain/trading'

interface TreasuryOverviewViewProps {
  task?: TaskSnapshot
  panda?: PandaConfigStatus
  injective?: InjectiveConfigStatus
}

const controlPlaneSteps = [
  { label: 'Case Adapter', detail: '股票量化 / 拼单', icon: Database },
  { label: 'Action Intent', detail: '统一动作协议', icon: FileCheck2 },
  { label: 'Policy Engine', detail: '预算与白名单', icon: ShieldCheck },
  { label: 'Approval', detail: '人类最终授权', icon: Check },
  { label: 'Chain Adapter', detail: 'Injective 接口', icon: Landmark },
]

export function TreasuryOverviewView({ task, panda, injective }: TreasuryOverviewViewProps) {
  const intent = task?.actionIntent
  const evidence = task?.quantEvidence
  const pandaLive = panda?.provider === 'panda-data'
  const injectiveLive = injective?.adapter !== 'mock' && injective?.readyForExecution

  return (
    <div className="base-view">
      <section className="panel control-plane-panel" aria-labelledby="control-plane-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Shared financial control plane</span><h2 id="control-plane-heading">一条基座链路，服务不同 Agent</h2></div>
          <span className="mode-stamp">CONTROL PLANE</span>
        </div>
        <div className="control-plane-flow">
          {controlPlaneSteps.map((step, index) => (
            <div className="control-plane-fragment" key={step.label}>
              <div className="control-plane-node">
                <step.icon size={15} />
                <div><strong>{step.label}</strong><span>{step.detail}</span></div>
              </div>
              {index < controlPlaneSteps.length - 1 && <ArrowRight className="control-plane-arrow" size={14} />}
            </div>
          ))}
        </div>
        <p className="control-plane-note">案例只能生成意图；预算检查、审批、执行和审计全部由 Agent Treasury 接管。</p>
      </section>

      <section className="panel agent-accounts-panel" aria-labelledby="accounts-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Agent registry</span><h2 id="accounts-heading">Agent 账户</h2></div>
          <WalletCards size={17} />
        </div>
        <div className="base-account active-account">
          <div><span className="account-code">KX</span><div><strong>KaleidoX</strong><p>股票量化案例</p></div></div>
          <dl><div><dt>预算</dt><dd>1,000 USDT</dd></div><div><dt>协议</dt><dd>investment</dd></div><div><dt>状态</dt><dd className="positive">ACTIVE</dd></div></dl>
        </div>
        <div className="base-account reserved-account">
          <div><span className="account-code">PM</span><div><strong>PoolMate</strong><p>拼单案例接口</p></div></div>
          <dl><div><dt>预算</dt><dd>未分配</dd></div><div><dt>协议</dt><dd>group-buy</dd></div><div><dt>状态</dt><dd>RESERVED</dd></div></dl>
        </div>
      </section>

      <section className="panel current-intent-panel" aria-labelledby="intent-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Unified action intent</span><h2 id="intent-heading">当前动作意图</h2></div>
          <span className={`intent-status intent-${intent?.status ?? 'empty'}`}>{intent?.status?.replaceAll('_', ' ') ?? 'EMPTY'}</span>
        </div>
        {intent ? (
          <div className="intent-record">
            <div className="intent-id"><span>INTENT ID</span><code>{intent.id}</code></div>
            <div className="intent-grid">
              <div><span>来源</span><strong>{intent.appId}</strong></div>
              <div><span>动作</span><strong>{intent.action}</strong></div>
              <div><span>标的</span><strong>{intent.symbol}</strong></div>
              <div><span>名义金额</span><strong>{intent.notional} {intent.currency}</strong></div>
              <div><span>策略</span><strong>{intent.strategyVersion}</strong></div>
              <div><span>协议标签</span><strong>{intent.protocolTag}</strong></div>
            </div>
            {intent.policyReason && <div className="intent-reason"><ShieldCheck size={14} /><span>{intent.policyReason}</span></div>}
          </div>
        ) : (
          <div className="base-empty"><CircleDashed size={19} /><strong>尚无动作意图</strong><span>启动股票量化案例后，这里会显示同一条 Policy → Approval → Execution 轨迹。</span></div>
        )}
      </section>

      <section className="panel provenance-panel" aria-labelledby="provenance-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Provider provenance</span><h2 id="provenance-heading">能力与证据</h2></div>
        </div>
        <div className="provider-row">
          <div className={`provider-indicator ${pandaLive ? 'is-live' : 'is-replay'}`}><i /></div>
          <div><strong>PandaAI 股票数据</strong><span>{pandaLive ? 'LIVE · PandaData SDK' : 'REPLAY · 等待账号配置'}</span></div>
          <small>{evidence ? `${evidence.symbol} · ${evidence.barCount} bars` : panda?.defaultSymbol ?? '000001.SZ'}</small>
        </div>
        <div className="provider-row">
          <div className={`provider-indicator ${injectiveLive ? 'is-live' : 'is-replay'}`}><i /></div>
          <div><strong>Injective 执行适配器</strong><span>{injectiveLive ? 'TESTNET READY' : 'MOCK · 合约团队待接入'}</span></div>
          <small>{injective?.chainId ?? 'injective-888'}</small>
        </div>
        <div className="provider-row">
          <div className="provider-indicator is-live"><i /></div>
          <div><strong>统一审计账本</strong><span>PostgreSQL snapshots + SSE event stream</span></div>
          <small>{task?.timeline.length ?? 0} events</small>
        </div>
        {task?.researchSummary && <blockquote className="research-summary">{task.researchSummary}</blockquote>}
      </section>
    </div>
  )
}
