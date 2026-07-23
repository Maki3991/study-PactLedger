import { ArrowRight, Coins, TrendingDown, TrendingUp, Wallet, Zap } from 'lucide-react'
import { useTreasury, type TreasuryAccount, type TreasuryTx } from '../services/useTreasury'

// ── agent metadata ────────────────────────────────────────────────────────────

const AGENT_META: Record<string, { icon: string; color: string }> = {
  orchestrator: { icon: '⚙',  color: '#6bcbd2' },
  research:     { icon: '🔍', color: '#9bf39e' },
  strategy:     { icon: '📐', color: '#edbf68' },
  backtest:     { icon: '📊', color: '#c3a6ff' },
  risk:         { icon: '🛡',  color: '#f2837d' },
  evolution:    { icon: '🧬', color: '#6bcbd2' },
  execution:    { icon: '⚡', color: '#9bf39e' },
}

function agentColor(id: string) { return AGENT_META[id]?.color ?? '#86908d' }
function agentIcon(id: string)  { return AGENT_META[id]?.icon  ?? '●' }

// ── wallet card ───────────────────────────────────────────────────────────────

function WalletCard({ acc }: { acc: TreasuryAccount }) {
  const spentPct  = acc.allocated > 0 ? Math.min(100, (acc.spent  / acc.allocated) * 100) : 0
  const earnedPct = acc.allocated > 0 ? Math.min(100, (acc.earned / acc.allocated) * 100) : 0
  const color = agentColor(acc.agentId)
  const net = acc.earned - acc.spent

  return (
    <div className="wallet-card">
      <div className="wallet-header">
        <span className="wallet-icon" style={{ color }}>{agentIcon(acc.agentId)}</span>
        <div>
          <strong>{acc.agentName}</strong>
          <span className="wallet-id">{acc.agentId}</span>
        </div>
        <div className="wallet-balance">
          <span style={{ color }}>{acc.balance.toFixed(2)}</span>
          <small>USDT</small>
        </div>
      </div>

      <div className="wallet-bars">
        <div className="wallet-bar-row">
          <span>已花</span>
          <div className="wallet-bar-track">
            <div className="wallet-bar-fill spent" style={{ width: `${spentPct}%` }} />
          </div>
          <span className="bar-val negative">−{acc.spent.toFixed(1)}</span>
        </div>
        <div className="wallet-bar-row">
          <span>收入</span>
          <div className="wallet-bar-track">
            <div className="wallet-bar-fill earned" style={{ width: `${earnedPct}%`, backgroundColor: color }} />
          </div>
          <span className="bar-val positive">+{acc.earned.toFixed(1)}</span>
        </div>
      </div>

      <div className="wallet-footer">
        <span className="wallet-alloc">初始 {acc.allocated.toFixed(0)} USDT</span>
        <span className={`wallet-net ${net >= 0 ? 'positive' : 'negative'}`}>
          {net >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          {net >= 0 ? '+' : ''}{net.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

// ── transaction row ───────────────────────────────────────────────────────────

const PROTOCOL_TAG: Record<string, string> = {
  x402: 'x402',
  acp: 'ACP',
  ap2: 'AP2',
  internal: 'internal',
}

function TxRow({ tx }: { tx: TreasuryTx }) {
  const isRejected = tx.status === 'rejected'
  const time = new Date(tx.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className={`treasury-tx-row ${isRejected ? 'rejected' : ''}`}>
      <time>{time}</time>
      <div className="tx-flow">
        {tx.fromAgent
          ? <span className="tx-agent" style={{ color: agentColor(tx.fromAgent) }}>{tx.fromAgent}</span>
          : <span className="tx-agent muted">user</span>}
        <ArrowRight size={12} className="tx-arrow" />
        {tx.toAgent
          ? <span className="tx-agent" style={{ color: agentColor(tx.toAgent) }}>{tx.toAgent}</span>
          : <span className="tx-agent muted">user</span>}
      </div>
      <span className="tx-purpose">{tx.purpose}</span>
      <span className={`tx-proto proto-${tx.protocol}`}>{PROTOCOL_TAG[tx.protocol]}</span>
      <span className={`tx-amount ${isRejected ? 'negative' : 'positive'}`}>
        {isRejected ? '✗' : '+'}{tx.amount.toFixed(2)} USDT
      </span>
      <span className={`tx-status-tag ${isRejected ? 'rejected' : 'ok'}`}>
        {isRejected ? '拒绝' : '完成'}
      </span>
    </div>
  )
}

// ── summary strip ─────────────────────────────────────────────────────────────

function SummaryStrip({ accounts, log }: { accounts: TreasuryAccount[]; log: TreasuryTx[] }) {
  const totalAllocated = accounts.reduce((s, a) => s + a.allocated, 0)
  const totalSpent     = accounts.reduce((s, a) => s + a.spent, 0)
  const totalEarned    = accounts.reduce((s, a) => s + a.earned, 0)
  const txCount        = log.filter((t) => t.status === 'completed').length
  const rejCount       = log.filter((t) => t.status === 'rejected').length

  return (
    <div className="treasury-summary">
      <div className="treasury-stat">
        <Wallet size={15} />
        <span>总分配</span>
        <strong>{totalAllocated.toFixed(0)} USDT</strong>
      </div>
      <div className="treasury-stat">
        <TrendingDown size={15} />
        <span>已花费</span>
        <strong className="negative">{totalSpent.toFixed(2)} USDT</strong>
      </div>
      <div className="treasury-stat">
        <TrendingUp size={15} />
        <span>Agent 收入</span>
        <strong className="positive">{totalEarned.toFixed(2)} USDT</strong>
      </div>
      <div className="treasury-stat">
        <Zap size={15} />
        <span>链上结算</span>
        <strong>{txCount} 笔</strong>
      </div>
      <div className="treasury-stat">
        <Coins size={15} />
        <span>拒付</span>
        <strong className={rejCount > 0 ? 'negative' : ''}>{rejCount} 笔</strong>
      </div>
    </div>
  )
}

// ── main view ─────────────────────────────────────────────────────────────────

interface TreasuryViewProps {
  taskId?: string
}

export function TreasuryView({ taskId }: TreasuryViewProps) {
  const { accounts, log, loading } = useTreasury(taskId)
  const isEmpty = accounts.length === 0

  return (
    <div className="treasury-view">
      {isEmpty ? (
        <div className="treasury-empty">
          <Wallet size={36} />
          <p>启动任务后，Agent 钱包将在此实时显示资金流向。</p>
          {loading && <small>加载中…</small>}
        </div>
      ) : (
        <>
          <SummaryStrip accounts={accounts} log={log} />

          <section className="panel treasury-wallets-panel" aria-labelledby="wallets-heading">
            <div className="panel-heading">
              <div><span className="eyebrow">Agent Wallets</span><h2 id="wallets-heading">Agent 钱包</h2></div>
              <span className="dataset-label">{accounts.length} 个账户</span>
            </div>
            <div className="wallets-grid">
              {accounts.map((acc) => <WalletCard key={acc.id} acc={acc} />)}
            </div>
          </section>

          <section className="panel treasury-log-panel" aria-labelledby="log-heading">
            <div className="panel-heading">
              <div><span className="eyebrow">Audit Ledger</span><h2 id="log-heading">资金流水账本</h2></div>
              <span className="dataset-label">{log.length} 笔</span>
            </div>
            {log.length === 0 ? (
              <p className="treasury-log-empty">暂无交易记录</p>
            ) : (
              <div className="treasury-log">
                <div className="treasury-log-header">
                  <span>时间</span><span>资金流向</span><span>用途</span>
                  <span>协议</span><span>金额</span><span>状态</span>
                </div>
                {[...log].reverse().map((tx) => <TxRow key={tx.id} tx={tx} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
