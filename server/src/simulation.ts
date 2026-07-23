/**
 * Background task simulation – progresses a task through all phases,
 * persisting state to PostgreSQL and broadcasting SSE updates.
 */
import type { Response } from 'express'
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

// ── static demo state ────────────────────────────────────────────────────────

const INITIAL_AGENTS: AgentRun[] = [
  { id: 'research',  name: 'Research',  role: 'Market research',        status: 'waiting', detail: '等待启动',         elapsed: '--:--' },
  { id: 'strategy',  name: 'Strategy',  role: 'Signal design',          status: 'waiting', detail: '等待研究结果',     elapsed: '--:--' },
  { id: 'backtest',  name: 'Backtest',  role: 'Out-of-sample',          status: 'waiting', detail: '等待策略生成',     elapsed: '--:--' },
  { id: 'risk',      name: 'Risk',      role: 'Independent veto',       status: 'waiting', detail: '等待回测数据',     elapsed: '--:--' },
  { id: 'evolution', name: 'Evolution', role: 'Champion challenger',    status: 'waiting', detail: '等待风险评审',     elapsed: '--:--' },
  { id: 'execution', name: 'Execution', role: 'Injective testnet',      status: 'waiting', detail: '等待风险签发',     elapsed: '--:--' },
]

const FIREWALL_RULES: FirewallRule[] = [
  { label: '总交易预算',      limit: '1,000 USDT', current: '250 USDT',    state: 'pass'   },
  { label: 'ETH 最大仓位',   limit: '30%',         current: '25%',         state: 'pass'   },
  { label: '单策略最大亏损', limit: '5%',           current: '4.2%',        state: 'pass'   },
  { label: '资产白名单',     limit: 'ETH',          current: 'ETH / USDT',  state: 'locked' },
]

const CANDIDATES: StrategyCandidate[] = [
  { id: 'v1',  name: 'V1',   status: 'rejected', note: '短周期趋势过拟合',    returnPct: 3.2, drawdownPct: 8.1, sharpe: 0.74, signal: '趋势跟随' },
  { id: 'v2a', name: 'V2-A', status: 'testing',  note: '增加波动率过滤',      returnPct: 4.0, drawdownPct: 5.7, sharpe: 1.06, signal: '过滤趋势' },
  { id: 'v2b', name: 'V2-B', status: 'rejected', note: '初始 40% 仓位超限',  returnPct: 4.6, drawdownPct: 4.2, sharpe: 1.28, signal: '状态识别' },
]

// ── helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function elapsed(startMs: number): string {
  const s = Math.round((Date.now() - startMs) / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// ── simulation ───────────────────────────────────────────────────────────────

export async function runSimulation(taskId: string): Promise<void> {
  const simStart = Date.now()

  try {
    // ── seed initial state ──
    await upsertAgents(taskId, INITIAL_AGENTS)
    await upsertFirewallRules(taskId, FIREWALL_RULES)

    // ── phase: researching ──────────────────────────────────────────────────
    await sleep(1_500)
    const researchStart = Date.now()
    await updateTaskPhase(taskId, 'researching')
    await upsertAgents(taskId, [
      { id: 'research', name: 'Research', role: 'Market research', status: 'working', detail: '调用 PandaAI 行情数据…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    await sleep(8_000)
    const tResearch: TimelineEvent = { time: nowLabel(), title: 'Research Agent 完成', detail: '趋势与流动性已归因', tone: 'success' }
    await appendTimeline(taskId, tResearch)
    await updateTaskPhase(taskId, 'strategizing')
    await upsertAgents(taskId, [
      { id: 'research', name: 'Research', role: 'Market research', status: 'complete', detail: '趋势与流动性已归因', elapsed: elapsed(researchStart) },
      { id: 'strategy', name: 'Strategy', role: 'Signal design',   status: 'working',  detail: '生成候选策略…',     elapsed: '00:00' },
    ])
    await broadcast(taskId)

    // ── phase: backtesting ──────────────────────────────────────────────────
    const strategyStart = Date.now()
    await sleep(6_000)
    await updateTaskPhase(taskId, 'backtesting')
    await upsertAgents(taskId, [
      { id: 'strategy', name: 'Strategy', role: 'Signal design',  status: 'complete', detail: '生成 2 个候选版本', elapsed: elapsed(strategyStart) },
      { id: 'backtest', name: 'Backtest', role: 'Out-of-sample',  status: 'working',  detail: '126 日滚动回测中…', elapsed: '00:00' },
    ])
    await upsertCandidates(taskId, CANDIDATES)
    await broadcast(taskId)

    // ── phase: risk_review ──────────────────────────────────────────────────
    const backtestStart = Date.now()
    await sleep(10_000)
    const tBacktest: TimelineEvent = { time: nowLabel(), title: 'Backtest 完成', detail: 'V2-B Sharpe 1.28，成为性能冠军', tone: 'success' }
    await appendTimeline(taskId, tBacktest)
    await updateTaskPhase(taskId, 'risk_review')
    await upsertAgents(taskId, [
      { id: 'backtest',  name: 'Backtest',  role: 'Out-of-sample',       status: 'complete', detail: '126 日滚动验证完成',     elapsed: elapsed(backtestStart) },
      { id: 'risk',      name: 'Risk',      role: 'Independent veto',    status: 'working',  detail: '审核 V2-B 仓位规则…',   elapsed: '00:00' },
      { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'working',  detail: 'V2-B 候选冠军验证中…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    // ── risk veto → revision ──────────────────────────────────────────────
    const riskStart = Date.now()
    await sleep(5_000)
    const tVeto: TimelineEvent = { time: nowLabel(), title: 'Risk Agent 退回初版', detail: '建议仓位 40%，超过用户上限 30%', tone: 'warning' }
    await appendTimeline(taskId, tVeto)
    await upsertCandidates(taskId, [
      { ...CANDIDATES[2], note: '初始 40% 仓位超限 → 修订为 25%' },
    ])
    await broadcast(taskId)

    await sleep(3_500)
    const tRevision: TimelineEvent = { time: nowLabel(), title: 'V2-B 提交修订计划', detail: '执行仓位调整为 25%，重新提交', tone: 'neutral' }
    await appendTimeline(taskId, tRevision)
    await broadcast(taskId)

    // ── risk passes ──────────────────────────────────────────────────────
    const evoStart = Date.now()
    await sleep(4_000)
    const tRiskPass: TimelineEvent = { time: nowLabel(), title: 'V1 实盘偏差已归档', detail: '震荡状态下连续 4 次错误趋势信号', tone: 'warning' }
    const tEvo: TimelineEvent = { time: nowLabel(), title: 'V2-B 成为性能冠军', detail: '风险调整后 Sharpe 1.28，仓位 25%', tone: 'success' }
    await appendTimeline(taskId, tRiskPass)
    await appendTimeline(taskId, tEvo)
    await updateTaskPhase(taskId, 'awaiting_approval')
    await upsertAgents(taskId, [
      { id: 'risk',      name: 'Risk',      role: 'Independent veto',    status: 'complete', detail: '审核通过，仓位合规', elapsed: elapsed(riskStart) },
      { id: 'evolution', name: 'Evolution', role: 'Champion challenger', status: 'complete', detail: 'V2-B 通过性能晋级',  elapsed: elapsed(evoStart) },
      { id: 'execution', name: 'Execution', role: 'Injective testnet',   status: 'waiting',  detail: '等待用户批准',      elapsed: '--:--' },
    ])
    await upsertCandidates(taskId, [
      { ...CANDIDATES[2], status: 'approved', note: '仓位修订为 25%，审核通过' },
    ])
    await broadcast(taskId)

    void simStart // suppress unused warning

  } catch (err) {
    console.error(`[simulation] task ${taskId} error:`, err)
    await updateTaskPhase(taskId, 'failed').catch(() => undefined)
    await broadcast(taskId)
  }
}

// ── execution (called by approve+execute routes) ──────────────────────────────

export async function runExecution(taskId: string): Promise<void> {
  try {
    await updateTaskPhase(taskId, 'executing', 'signing')
    await upsertAgents(taskId, [
      { id: 'execution', name: 'Execution', role: 'Injective testnet', status: 'working', detail: 'Capital Firewall 校验中…', elapsed: '00:00' },
    ])
    await broadcast(taskId)

    await sleep(3_500)

    // generate a mock testnet tx hash
    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
    const tExec: TimelineEvent = { time: nowLabel(), title: '链上交易已广播', detail: `Injective Testnet · V2 · 25% ETH`, tone: 'success' }
    await appendTimeline(taskId, tExec)
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
