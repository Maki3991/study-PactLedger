/**
 * Background task simulation – progresses a task through all phases,
 * persisting state to PostgreSQL and broadcasting SSE updates.
 * Uses DeepSeek V4 Pro when API key is configured; falls back to demo data.
 */
import type { Response } from 'express'
import { runResearch, runStrategy, runRiskCheck } from './ai/agents'
import * as treasury from './treasury/service'
import type { AgentRun, FirewallRule, StrategyCandidate, TimelineEvent } from './types'
import {
  appendTimeline,
  getTaskSnapshot,
  nowLabel,
  upsertAgents,
  upsertCandidates,
  upsertFirewallRules,
  updateTaskPhase,
} from './db/queries'

// ── SSE registry ─────────────────────────────────────────────────────────────

const subscribers = new Map<string, Set<Response>>()

export function addSubscriber(taskId: string, res: Response): void {
  if (!subscribers.has(taskId)) subscribers.set(taskId, new Set())
  subscribers.get(taskId)!.add(res)
}

export function removeSubscriber(taskId: string, res: Response): void {
  subscribers.get(taskId)?.delete(res)
}

async function broadcast(taskId: string): Promise<void> {
  const snapshot = await getTaskSnapshot(taskId)
  if (!snapshot) return
  const data = JSON.stringify({ type: 'task.snapshot', snapshot })
  subscribers.get(taskId)?.forEach((res) => {
    try { res.write(`event: task.snapshot\ndata: ${data}\n\n`) } catch { /* closed */ }
  })
}

// ── static fallback data ──────────────────────────────────────────────────────

const INITIAL_AGENTS: AgentRun[] = [
  { id: 'research',  name: 'Research',  role: 'Market research',      status: 'waiting', detail: '等待启动',      elapsed: '--:--' },
  { id: 'strategy',  name: 'Strategy',  role: 'Signal design',        status: 'waiting', detail: '等待研究结果',  elapsed: '--:--' },
  { id: 'backtest',  name: 'Backtest',  role: 'Out-of-sample',        status: 'waiting', detail: '等待策略生成',  elapsed: '--:--' },
  { id: 'risk',      name: 'Risk',      role: 'Independent veto',     status: 'waiting', detail: '等待回测数据',  elapsed: '--:--' },
  { id: 'evolution', name: 'Evolution', role: 'Champion challenger',  status: 'waiting', detail: '等待风险评审',  elapsed: '--:--' },
  { id: 'execution', name: 'Execution', role: 'Injective testnet',    status: 'waiting', detail: '等待风险签发',  elapsed: '--:--' },
]

const FIREWALL_RULES: FirewallRule[] = [
  { label: '总交易预算',      limit: '1,000 USDT', current: '250 USDT',   state: 'pass'   },
  { label: 'ETH 最大仓位',   limit: '30%',         current: '25%',        state: 'pass'   },
  { label: '单策略最大亏损', limit: '5%',           current: '4.2%',       state: 'pass'   },
  { label: '资产白名单',     limit: 'ETH',          current: 'ETH / USDT', state: 'locked' },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── main simulation ───────────────────────────────────────────────────────────

export async function runSimulation(taskId: string): Promise<void> {
  try {
    // seed
    await upsertAgents(taskId, INITIAL_AGENTS)

    // read task metadata for AI calls
    const initial = await getTaskSnapshot(taskId)
    const asset       = 'ETH'
    const objective   = initial?.objective ?? ''
    const budgetUsdt  = 1000
    const maxAssetPct = 30
    const maxLossPct  = 5

    // ── Treasury: allocate budget to all agents ───────────────────────────────
    // tenantId = taskId so each task gets isolated accounts
    await treasury.allocate(taskId, [
      { agentId: 'orchestrator', agentName: 'Orchestrator', amount: 500,
        policy: { maxSingle: 500, dailyLimit: 1000, whitelist: [], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'research',     agentName: 'Research',     amount: 50,
        policy: { maxSingle: 30, dailyLimit: 100, whitelist: [], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'strategy',     agentName: 'Strategy',     amount: 70,
        policy: { maxSingle: 30, dailyLimit: 150, whitelist: ['research', 'backtest'], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'backtest',     agentName: 'Backtest',     amount: 40,
        policy: { maxSingle: 40, dailyLimit: 100, whitelist: [], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'risk',         agentName: 'Risk',         amount: 30,
        policy: { maxSingle: 30, dailyLimit: 60,  whitelist: [], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'evolution',    agentName: 'Evolution',    amount: 20,
        policy: { maxSingle: 20, dailyLimit: 40,  whitelist: [], assetWhitelist: ['ETH', 'USDT'] } },
      { agentId: 'execution',    agentName: 'Execution',    amount: 250,
        policy: { maxSingle: 250, dailyLimit: 250, whitelist: [], assetWhitelist: ['ETH'] } },
    ])

    // ── researching ───────────────────────────────────────────────────────────
    await sleep(1_200)
    const researchStart = Date.now()
    await updateTaskPhase(taskId, 'researching')
    await upsertFirewallRules(taskId, FIREWALL_RULES)
    await upsertAgents(taskId, [
      { id: 'research', name: 'Research', role: 'Market research', status: 'working', detail: '调用 DeepSeek V4 分析市场…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    const research = await runResearch(asset, objective, budgetUsdt)

    await appendTimeline(taskId, {
      time: nowLabel(), title: 'Research Agent 完成',
      detail: research.summary.slice(0, 80), tone: 'success',
    })

    // ── Treasury: Strategy 向 Research 购买研究报告 (x402) ────────────────────
    const researchPayment = await treasury.transfer({
      tenantId: taskId, fromAgent: 'strategy', toAgent: 'research',
      amount: 20, purpose: '购买市场研究报告', protocol: 'x402',
    })
    await appendTimeline(taskId, {
      time: nowLabel(),
      title: researchPayment.ok ? 'Strategy → Research 支付 20 USDT' : '支付被拒：余额不足',
      detail: researchPayment.ok
        ? `x402 · 研究报告采购 · TxID: ${researchPayment.txId.slice(0, 8)}…`
        : researchPayment.rejectReason ?? '',
      tone: researchPayment.ok ? 'success' : 'warning',
    })

    await updateTaskPhase(taskId, 'strategizing')
    await upsertAgents(taskId, [
      { id: 'research', name: 'Research', role: 'Market research', status: 'complete', detail: research.summary.slice(0, 60), elapsed: elapsed(researchStart) },
      { id: 'strategy', name: 'Strategy', role: 'Signal design',   status: 'working',  detail: '生成候选策略…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    // ── strategizing ──────────────────────────────────────────────────────────
    const strategyStart = Date.now()
    const [candA, candB] = await runStrategy(asset, research, maxAssetPct, maxLossPct)

    await updateTaskPhase(taskId, 'backtesting')
    await upsertAgents(taskId, [
      { id: 'strategy', name: 'Strategy', role: 'Signal design',  status: 'complete', detail: `生成 ${candA.name} / ${candB.name}`, elapsed: elapsed(strategyStart) },
      { id: 'backtest', name: 'Backtest', role: 'Out-of-sample',  status: 'working',  detail: '126 日滚动回测中…',                   elapsed: '00:00' },
    ])

    const mapCandidate = (c: typeof candA, status: StrategyCandidate['status']): StrategyCandidate => ({
      id: c.name.toLowerCase().replace('-', ''),
      name: c.name,
      status,
      note: c.note,
      returnPct: c.expectedReturnPct,
      drawdownPct: c.maxDrawdownPct,
      sharpe: c.sharpe,
      signal: c.signal,
    })

    await upsertCandidates(taskId, [
      mapCandidate(candA, 'testing'),
      mapCandidate(candB, 'testing'),
    ])

    // ── Treasury: Strategy 向 Backtest 购买验证服务 (x402) ──────────────────
    const backtestPayment = await treasury.transfer({
      tenantId: taskId, fromAgent: 'strategy', toAgent: 'backtest',
      amount: 25, purpose: 'Champion-Challenger 回测服务', protocol: 'x402',
    })
    await appendTimeline(taskId, {
      time: nowLabel(),
      title: `Strategy → Backtest 支付 25 USDT`,
      detail: `x402 · 回测验证服务 · 余额: Strategy ${(backtestPayment.fromBalance ?? 0).toFixed(2)} USDT`,
      tone: 'neutral',
    })
    await broadcast(taskId)

    // simulate backtest delay
    await sleep(6_000)
    const backtestStart = Date.now()
    const winner = candB.sharpe >= candA.sharpe ? candB : candA
    await appendTimeline(taskId, {
      time: nowLabel(), title: 'Backtest 完成',
      detail: `${winner.name} Sharpe ${winner.sharpe.toFixed(2)} 胜出`,  tone: 'success',
    })

    // ── risk_review ───────────────────────────────────────────────────────────
    await updateTaskPhase(taskId, 'risk_review')
    await upsertAgents(taskId, [
      { id: 'backtest',  name: 'Backtest',  role: 'Out-of-sample',      status: 'complete', detail: '126 日滚动验证完成',     elapsed: elapsed(backtestStart) },
      { id: 'risk',      name: 'Risk',      role: 'Independent veto',   status: 'working',  detail: `审核 ${winner.name}…`,  elapsed: '00:00' },
      { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'working',  detail: '竞争验证中…',           elapsed: '00:00' },
    ])
    await broadcast(taskId)

    const riskStart = Date.now()

    // ── Treasury: Strategy 向 Risk 支付审核费（拒绝不退款）────────────────────
    const riskFee = await treasury.transfer({
      tenantId: taskId, fromAgent: 'strategy', toAgent: 'risk',
      amount: 15, purpose: `${winner.name} 独立风控审核`, protocol: 'internal',
    })
    await appendTimeline(taskId, {
      time: nowLabel(),
      title: `Strategy → Risk 支付 15 USDT（审核费，不退款）`,
      detail: `internal · 风控审核费用 · TxID: ${riskFee.txId.slice(0, 8)}…`,
      tone: 'neutral',
    })

    const riskResult = await runRiskCheck(winner, maxAssetPct, maxLossPct)

    if (!riskResult.approved) {
      await appendTimeline(taskId, {
        time: nowLabel(), title: `Risk Agent 退回 ${winner.name}`,
        detail: riskResult.reason, tone: 'warning',
      })
      await broadcast(taskId)

      // revision
      await sleep(2_500)
      const revised = riskResult.revisedPositionPct ?? Math.floor(maxAssetPct * 0.85)
      winner.positionPct = revised
      const revisedNote = `仓位修订为 ${revised}%`
      await upsertCandidates(taskId, [
        mapCandidate(winner, 'testing'),
      ])
      await appendTimeline(taskId, {
        time: nowLabel(), title: `${winner.name} 提交修订`,
        detail: revisedNote, tone: 'neutral',
      })
      await broadcast(taskId)
      await sleep(2_000)
    }

    // final approval
    await appendTimeline(taskId, {
      time: nowLabel(), title: 'V1 实盘偏差已归档',
      detail: '历史失败策略归因完成，进化路径锁定', tone: 'warning',
    })
    await appendTimeline(taskId, {
      time: nowLabel(), title: `${winner.name} 成为性能冠军`,
      detail: `风险调整后 Sharpe ${winner.sharpe.toFixed(2)}，仓位 ${winner.positionPct}%`, tone: 'success',
    })

    const evoStart = Date.now()
    await updateTaskPhase(taskId, 'awaiting_approval')
    await upsertAgents(taskId, [
      { id: 'risk',      name: 'Risk',      role: 'Independent veto',    status: 'complete', detail: '审核通过，仓位合规',         elapsed: elapsed(riskStart) },
      { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'complete', detail: `${winner.name} 通过性能晋级`, elapsed: elapsed(evoStart) },
      { id: 'execution', name: 'Execution', role: 'Injective testnet',   status: 'waiting',  detail: '等待用户批准',              elapsed: '--:--' },
    ])
    await upsertCandidates(taskId, [
      mapCandidate(winner, 'approved'),
    ])
    await broadcast(taskId)

  } catch (err) {
    console.error(`[simulation] task ${taskId} error:`, err)
    await updateTaskPhase(taskId, 'failed').catch(() => undefined)
    await broadcast(taskId)
  }
}

// ── execution ─────────────────────────────────────────────────────────────────

export async function runExecution(taskId: string): Promise<void> {
  try {
    await updateTaskPhase(taskId, 'executing', 'signing')
    await upsertAgents(taskId, [
      { id: 'execution', name: 'Execution', role: 'Injective testnet', status: 'working', detail: 'Capital Firewall 校验中…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    await sleep(3_500)

    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    await appendTimeline(taskId, {
      time: nowLabel(), title: '链上交易已广播',
      detail: `Injective Testnet · V2 · 25% ETH`, tone: 'success',
    })
    await updateTaskPhase(taskId, 'executed', 'executed', txHash)
    await upsertAgents(taskId, [
      { id: 'execution', name: 'Execution', role: 'Injective testnet', status: 'complete', detail: `Tx 已确认`, elapsed: '00:03' },
    ])
    await broadcast(taskId)

  } catch (err) {
    console.error(`[execution] task ${taskId} error:`, err)
    await updateTaskPhase(taskId, 'failed').catch(() => undefined)
    await broadcast(taskId)
  }
}
