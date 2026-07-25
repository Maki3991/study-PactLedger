import type { ActionIntent, TaskPhase, TaskSnapshot } from '../../src/domain/trading.js'
import type { TreasuryTx } from '../treasury.js'

const PHASE_LABELS: Record<TaskPhase, string> = {
  created: '已创建',
  researching: '研究中',
  strategizing: '生成策略',
  backtesting: '回测中',
  risk_review: '风控审查',
  awaiting_approval: '等待批准',
  approved: '已批准',
  executing: '执行中',
  executed: '已执行',
  failed: '已失败',
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function phaseLabel(phase: TaskPhase): string {
  return PHASE_LABELS[phase] ?? phase
}

export function formatIntent(intent: ActionIntent): string {
  const side = intent.side === 'buy' ? '买入' : '卖出'
  return [
    `标的：<code>${escapeHtml(intent.symbol)}</code>`,
    `方向：${side} · ${intent.notional} ${escapeHtml(intent.currency)}`,
    `策略版本：<code>${escapeHtml(intent.strategyVersion)}</code>`,
    intent.policyReason ? `Policy：${escapeHtml(intent.policyReason)}` : '',
  ].filter(Boolean).join('\n')
}

export function formatTaskCard(task: TaskSnapshot): string {
  const approved = task.candidates.find((candidate) => candidate.status === 'approved')
  return [
    `<b>${escapeHtml(task.missionId)}</b> · ${phaseLabel(task.phase)}`,
    `目标：${escapeHtml(task.objective)}`,
    `ID：<code>${escapeHtml(task.id)}</code>`,
    approved ? `\n入选策略：${escapeHtml(approved.name)} · 收益 ${approved.returnPct}% · 回撤 ${approved.drawdownPct}%` : '',
    task.actionIntent ? `\n<b>支付意图</b>\n${formatIntent(task.actionIntent)}` : '',
    task.execution.transactionHash
      ? `\n交易哈希：<code>${escapeHtml(task.execution.transactionHash)}</code>`
      : '',
    task.phase === 'awaiting_approval'
      ? `\n用 <code>/approve ${escapeHtml(task.id)}</code> 批准`
      : '',
  ].filter(Boolean).join('\n')
}

export function formatTaskList(tasks: readonly TaskSnapshot[]): string {
  if (tasks.length === 0) return '还没有任务。用 /research 发起一个。'
  const lines = tasks.map((task) => {
    const marker = task.phase === 'awaiting_approval' ? ' ⏳' : ''
    return `<code>${escapeHtml(task.missionId)}</code> · ${phaseLabel(task.phase)}${marker}\n`
      + `  ${escapeHtml(task.objective.slice(0, 48))}\n`
      + `  <code>${escapeHtml(task.id)}</code>`
  })
  return [`<b>我的任务</b>（${tasks.length}）`, '', ...lines].join('\n')
}

export function formatAuditLog(
  entries: readonly TreasuryTx[],
  heading: string,
): string {
  if (entries.length === 0) return '暂无交易记录。'
  const lines = entries.map((tx) => {
    const route = `${tx.fromAgent ?? '外部'} → ${tx.toAgent ?? '外部'}`
    const state = tx.status === 'completed' ? '完成' : `拒绝${tx.rejectReason ? `（${tx.rejectReason}）` : ''}`
    return `${escapeHtml(route)} · ${tx.amount} ${escapeHtml(tx.currency)} · ${state}\n`
      + `  ${escapeHtml(tx.purpose)} · <code>${escapeHtml(tx.protocol)}</code> · ${escapeHtml(tx.createdAt.slice(0, 19))}`
  })
  return [`<b>${escapeHtml(heading)}</b>`, '', ...lines].join('\n')
}

export function formatApprovalPrompt(task: TaskSnapshot): string {
  return [
    `<b>${escapeHtml(task.missionId)} 等待批准</b>`,
    `目标：${escapeHtml(task.objective)}`,
    task.actionIntent ? `\n${formatIntent(task.actionIntent)}` : '',
    `\n批准：<code>/approve ${escapeHtml(task.id)}</code>`,
  ].filter(Boolean).join('\n')
}
