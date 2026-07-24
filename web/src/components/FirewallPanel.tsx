import { Check, ExternalLink, LockKeyhole, Radio, ShieldCheck } from 'lucide-react'
import type { FirewallRule } from '../domain/trading'

interface FirewallPanelProps {
  rules: FirewallRule[]
  executionState: 'ready' | 'signing' | 'executed'
  canExecute: boolean
  executionMode?: 'mock' | 'testnet'
  strategyVersion?: string
  transactionHash?: string
  onExecute: () => void
}

export function FirewallPanel({ rules, executionState, canExecute, executionMode = 'mock', strategyVersion, transactionHash, onExecute }: FirewallPanelProps) {
  const buttonCopy = executionState === 'signing'
    ? '签发交易中…'
    : executionState === 'executed'
      ? executionMode === 'mock' ? 'Mock 执行成功' : '测试网执行成功'
      : canExecute ? `批准并执行 ${strategyVersion ?? 'Action Intent'}` : '等待 Agent 复核'

  return (
    <section className="panel firewall-panel" aria-labelledby="firewall-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Capital firewall</span>
          <h2 id="firewall-heading">不可变风险边界</h2>
        </div>
        <ShieldCheck className="shield-icon" size={22} />
      </div>

      <div className="firewall-rules">
        {rules.map((rule) => (
          <div className="firewall-rule" key={rule.label}>
            <div>
              <span>{rule.label}</span>
              <strong>{rule.limit}</strong>
            </div>
            <span className="rule-current">{rule.current}</span>
            <span className={`rule-state ${rule.state}`} title={rule.state === 'locked' ? '由用户锁定' : '校验通过'}>
              {rule.state === 'locked' ? <LockKeyhole size={13} /> : <Check size={13} />}
              {rule.state === 'locked' ? '锁定' : '通过'}
            </span>
          </div>
        ))}
      </div>

      <div className={`execution-receipt ${executionState}`} aria-live="polite">
        <Radio size={15} />
        <div>
          <span>{executionMode === 'mock' ? 'Mock Execution Adapter' : 'Injective Testnet'}</span>
          <strong>{executionState === 'executed' ? transactionHash ?? '交易已确认' : '等待风险签发'}</strong>
        </div>
        {executionState === 'executed' && <ExternalLink size={14} />}
      </div>

      <button className="primary-action" onClick={onExecute} disabled={executionState !== 'ready' || !canExecute}>
        {executionState === 'executed' ? <Check size={17} /> : <ShieldCheck size={17} />}
        {buttonCopy}
      </button>
    </section>
  )
}
