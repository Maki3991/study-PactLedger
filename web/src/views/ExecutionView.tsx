import { Check, ExternalLink, Globe, Radio, ShieldCheck } from 'lucide-react'
import type { FirewallRule, TaskSnapshot, InjectiveConfigStatus } from '../domain/trading'
import { FirewallPanel } from '../components/FirewallPanel'

interface ExecutionViewProps {
  task?: TaskSnapshot
  rules: FirewallRule[]
  executionState: 'ready' | 'signing' | 'executed'
  canExecute: boolean
  transactionHash?: string
  injectiveStatus?: InjectiveConfigStatus
  onExecute: () => void
}

export function ExecutionView({
  task,
  rules,
  executionState,
  canExecute,
  transactionHash,
  injectiveStatus,
  onExecute,
}: ExecutionViewProps) {
  const isExecuted = executionState === 'executed'
  const mode = injectiveStatus?.mode ?? 'mock'
  const ready = injectiveStatus?.readyForExecution ?? true
  const credentialsConfigured = injectiveStatus?.credentialsConfigured ?? false

  // Build transaction history from task timeline
  const txHistory = task?.timeline
    .filter((e) =>
      e.title.includes('测试网') ||
      e.title.includes('执行') ||
      e.title.includes('广播') ||
      e.title.includes('Firewall'),
    )
    .map((e) => ({
      hash: e.detail.includes('0x') ? e.detail.match(/0x[0-9a-fA-F]+/)?.[0] ?? transactionHash : transactionHash,
      title: e.title,
      detail: e.detail,
      status: 'confirmed' as const,
      time: e.time,
    })) ?? []

  if (isExecuted && transactionHash && !txHistory.some((t) => t.hash === transactionHash)) {
    txHistory.unshift({
      hash: transactionHash,
      title: 'V2-B · 买入 ETH',
      detail: '250 USDT · 策略版本 V2-B · Capital Firewall 已通过',
      status: 'confirmed',
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    })
  }

  return (
    <div className="exec-view">
      <div className={`network-status ${ready ? 'ready' : 'pending'}`}>
        <span className="status-dot" />
        <Globe size={16} />
        <span>{ready ? '已连接' : '配置中'}</span>
        <strong>Injective Testnet ({injectiveStatus?.chainId ?? 'injective-888'})</strong>
        <span className="network-mode">{mode === 'mock' ? '模拟执行' : '测试网'}</span>
        <span className="network-latency">{credentialsConfigured ? '密钥已配置' : '密钥未配置'}</span>
      </div>

      <FirewallPanel
        rules={rules}
        executionState={executionState}
        canExecute={canExecute}
        transactionHash={transactionHash}
        onExecute={onExecute}
      />

      <section className="panel tx-history-panel" aria-labelledby="tx-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Transaction History</span><h2 id="tx-heading">链上交易记录</h2></div>
          <span className="dataset-label">{txHistory.length} 笔</span>
        </div>
        <div className="tx-list">
          {txHistory.length === 0 ? (
            <div className="tx-empty">
              <ShieldCheck size={28} />
              <p>任务执行后，链上交易记录将在此显示。</p>
            </div>
          ) : (
            txHistory.map((tx, index) => (
              <div className={`tx-item ${index === 0 ? 'new-event' : ''}`} key={`${tx.hash ?? tx.title}-${index}`}>
                <div className="tx-icon">{index === 0 ? <Check size={14} /> : <Radio size={14} />}</div>
                <div className="tx-body">
                  <strong>{tx.title}</strong>
                  <p>{tx.detail}</p>
                </div>
                {tx.hash && <span className="tx-hash">{tx.hash}</span>}
                <span className="tx-status"><Check size={12} /> {tx.status === 'confirmed' ? '已确认' : '待确认'}</span>
              </div>
            ))
          )}
        </div>
        <div className="flow-loop-note">
          <ExternalLink size={14} />
          <span>所有交易可在 Injective Testnet Explorer 验证</span>
        </div>
      </section>
    </div>
  )
}
