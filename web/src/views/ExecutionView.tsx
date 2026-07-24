import { Check, ExternalLink, Globe, Radio, ShieldCheck } from 'lucide-react'
import { FirewallPanel } from '../components/FirewallPanel'
import type { FirewallRule, InjectiveConfigStatus, TaskSnapshot } from '../domain/trading'

interface ExecutionViewProps {
  task?: TaskSnapshot
  rules: FirewallRule[]
  executionState: 'ready' | 'signing' | 'executed'
  canExecute: boolean
  transactionHash?: string
  injectiveStatus?: InjectiveConfigStatus
  onExecute: () => void
}

interface TransactionRecord {
  hash?: string
  title: string
  detail: string
  status: 'confirmed' | 'pending'
  time: string
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
  const transactionHistory: TransactionRecord[] = task?.timeline
    .filter((event) =>
      event.title.includes('执行') ||
      event.title.includes('结算') ||
      event.title.includes('批准') ||
      event.title.includes('Policy'),
    )
    .map((event) => ({
      hash: event.detail.match(/0x[0-9a-fA-F]+/)?.[0],
      title: event.title,
      detail: event.detail,
      status: 'confirmed',
      time: event.time,
    })) ?? []

  if (isExecuted && transactionHash && !transactionHistory.some((record) => record.hash === transactionHash)) {
    transactionHistory.unshift({
      hash: transactionHash,
      title: '股票策略 Action Intent 已结算',
      detail: `${task?.actionIntent?.notional ?? 250} USDT · ${task?.actionIntent?.symbol ?? '000001.SZ'} · Policy Engine 已通过`,
      status: 'confirmed',
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    })
  }

  return (
    <div className="exec-view">
      <div className={`network-status ${ready ? 'ready' : 'pending'}`}>
        <span className="status-dot" />
        <Globe size={16} />
        <span>{mode === 'mock' ? '接口预留' : ready ? '已连接' : '配置中'}</span>
        <strong>{mode === 'mock' ? 'MockInjectiveAdapter' : `Injective Testnet (${injectiveStatus?.chainId ?? 'injective-888'})`}</strong>
        <span className="network-mode">{mode === 'mock' ? '模拟执行' : '测试网'}</span>
        <span className="network-latency">{credentialsConfigured ? '密钥已配置' : '密钥未配置'}</span>
      </div>

      <FirewallPanel
        rules={rules}
        executionState={executionState}
        canExecute={canExecute}
        executionMode={mode}
        strategyVersion={task?.actionIntent?.strategyVersion}
        transactionHash={transactionHash}
        onExecute={onExecute}
      />

      <section className="panel tx-history-panel" aria-labelledby="tx-heading">
        <div className="panel-heading">
          <div><span className="eyebrow">Execution Receipts</span><h2 id="tx-heading">执行与结算记录</h2></div>
          <span className="dataset-label">{transactionHistory.length} 笔</span>
        </div>
        <div className="tx-list">
          {transactionHistory.length === 0 ? (
            <div className="tx-empty">
              <ShieldCheck size={28} />
              <p>批准并执行 Action Intent 后，适配器回执将在此显示。</p>
            </div>
          ) : (
            transactionHistory.map((record, index) => (
              <div className={`tx-item ${index === 0 ? 'new-event' : ''}`} key={`${record.hash ?? record.title}-${index}`}>
                <div className="tx-icon">{index === 0 ? <Check size={14} /> : <Radio size={14} />}</div>
                <div className="tx-body">
                  <strong>{record.title}</strong>
                  <p>{record.detail} · {record.time}</p>
                </div>
                {record.hash && <span className="tx-hash">{record.hash}</span>}
                <span className="tx-status"><Check size={12} /> {record.status === 'confirmed' ? '已确认' : '待确认'}</span>
              </div>
            ))
          )}
        </div>
        <div className="flow-loop-note">
          <ExternalLink size={14} />
          <span>{mode === 'mock' ? '当前为 Mock 模式；合约团队接入后生成可验证的 Injective Explorer 链接' : '测试网适配器将返回真实交易哈希和链上回执'}</span>
        </div>
      </section>
    </div>
  )
}
