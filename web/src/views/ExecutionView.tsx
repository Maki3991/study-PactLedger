import { Check, ExternalLink, Globe, Radio } from 'lucide-react'
import type { FirewallRule } from '../domain/trading'
import { FirewallPanel } from '../components/FirewallPanel'

interface TxRecord {
  hash: string
  version: string
  action: string
  amount: string
  status: 'confirmed' | 'pending' | 'failed'
  time: string
  block: number
}

const txHistory: TxRecord[] = [
  { hash: '0x3a1b...f8e2', version: 'V1', action: '买入 ETH', amount: '200 USDT', status: 'confirmed', time: '10:28:14', block: 4821593 },
  { hash: '0x7c4d...91a3', version: 'V1', action: '卖出 ETH', amount: '180 USDT', status: 'confirmed', time: '10:31:02', block: 4821612 },
  { hash: '0x2e8f...b4c7', version: 'V1', action: '买入 ETH', amount: '150 USDT', status: 'confirmed', time: '10:33:45', block: 4821641 },
]

interface ExecutionViewProps {
  rules: FirewallRule[]
  executionState: 'ready' | 'signing' | 'executed'
  canExecute: boolean
  transactionHash?: string
  onExecute: () => void
}

export function ExecutionView({ rules, executionState, canExecute, transactionHash, onExecute }: ExecutionViewProps) {
  const isExecuted = executionState === 'executed'

  return (
    <div className="exec-view">
      <div className="network-status">
        <span className="status-dot" />
        <Globe size={16} />
        <span>已连接</span>
        <strong>Injective Testnet (injective-888)</strong>
        <span className="network-latency">84ms</span>
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
          <span className="dataset-label">{txHistory.length + (isExecuted ? 1 : 0)} 笔</span>
        </div>
        <div className="tx-list">
          {isExecuted && transactionHash && (
            <div className="tx-item new-event">
              <div className="tx-icon"><Check size={14} /></div>
              <div className="tx-body">
                <strong>V2-B · 买入 ETH</strong>
                <p>250 USDT · 策略版本 V2-B · Capital Firewall 已通过</p>
              </div>
              <span className="tx-hash">{transactionHash}</span>
              <span className="tx-status"><Check size={12} /> 已确认</span>
            </div>
          )}
          {txHistory.map((tx) => (
            <div className="tx-item" key={tx.hash}>
              <div className="tx-icon"><Radio size={14} /></div>
              <div className="tx-body">
                <strong>{tx.version} · {tx.action}</strong>
                <p>{tx.amount} · Block #{tx.block.toLocaleString()}</p>
              </div>
              <span className="tx-hash">{tx.hash}</span>
              <span className="tx-status"><Check size={12} /> 已确认</span>
            </div>
          ))}
        </div>
        <div className="flow-loop-note">
          <ExternalLink size={14} />
          <span>所有交易可在 Injective Testnet Explorer 验证</span>
        </div>
      </section>
    </div>
  )
}
