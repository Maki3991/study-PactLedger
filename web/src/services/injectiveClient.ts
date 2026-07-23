/**
 * injectiveClient.ts — Injective 测试网执行客户端
 *
 * 职责：
 *  1. Capital Firewall 规则校验（单笔仓位 ≤30%、资产白名单、日亏损熔断）
 *  2. 交易组装（Injective Spot Market Msg）
 *  3. 测试网广播与回执解析
 *  4. 导出与 demoData.ts 兼容的接口签名，供 App.tsx 平滑切换
 *
 * 依赖（需安装）：
 *   npm i @injectivelabs/sdk-ts @injectivelabs/networks @injectivelabs/utils @injectivelabs/wallet-ts
 */

import type { FirewallRule, TimelineEvent } from '../domain/trading'

// ─── 领域类型 ───────────────────────────────────────────────────────────────────

/** 用户不可变授权边界 */
export interface UserConstraints {
  /** 总交易预算 (USDT) */
  budgetUsdt: number
  /** 最大可接受亏损百分比，如 5 表示 5% */
  maxLossPct: number
  /** 单一资产最大仓位百分比，如 30 表示 30% */
  maxPositionPct: number
  /** 资产白名单 */
  allowedAssets: string[]
  /** 日亏损熔断阈值百分比，如 3 表示当日累计亏损达 3% 即停止 */
  dailyLossBreakerPct: number
}

/** 交易指令 */
export interface TradeOrder {
  /** 交易标的，如 'ETH' */
  asset: string
  /** 方向 */
  side: 'buy' | 'sell'
  /** 下单金额 (USDT) */
  amountUsdt: number
  /** 产生该指令的策略版本，如 'V2-B' */
  strategyVersion: string
  /** 限价（可选，不填则市价） */
  price?: number
}

/** 防火墙校验结果 */
export interface FirewallCheckResult {
  passed: boolean
  rules: FirewallRule[]
  violations: string[]
}

/** 链上广播回执 */
export interface BroadcastReceipt {
  txHash: string
  blockHeight: number
  timestamp: string
  gasUsed: number
  gasWanted: number
  success: boolean
  rawLog: string
}

/** 完整执行结果 */
export interface ExecutionResult {
  receipt: BroadcastReceipt | null
  firewallResult: FirewallCheckResult
  timeline: TimelineEvent[]
}

// ─── 默认约束（与 Demo 一致） ─────────────────────────────────────────────────────

export const DEFAULT_CONSTRAINTS: UserConstraints = {
  budgetUsdt: 1_000,
  maxLossPct: 5,
  maxPositionPct: 30,
  allowedAssets: ['ETH'],
  dailyLossBreakerPct: 3,
}

// ─── Injective 测试网配置 ─────────────────────────────────────────────────────────

const INJECTIVE_TESTNET = {
  chainId: 'injective-888',
  lcd: 'https://testnet.sentry.lcd.injective.network',
  rpc: 'https://testnet.sentry.tm.injective.network',
  explorer: 'https://testnet.explorer.injective.network',
} as const

/** ETH/USDT 现货市场 ID（Injective 测试网） */
const ETH_USDT_MARKET_ID = '0x06c5a306492ddc2b8dc56969766959163287ed68a6b59baa2f42330dda0aebe0'

// ─── Capital Firewall 校验 ────────────────────────────────────────────────────────

/**
 * 执行前强制校验，任何一条不通过即拒绝交易。
 * 规则：
 *  1. 单笔仓位 ≤ maxPositionPct（占预算比例）
 *  2. 资产在白名单内
 *  3. 日累计亏损未触发熔断
 *  4. 单笔金额 ≤ 剩余预算
 */
export function validateFirewall(
  order: TradeOrder,
  constraints: UserConstraints,
  dailyPnlPct = 0,
): FirewallCheckResult {
  const violations: string[] = []
  const positionPct = (order.amountUsdt / constraints.budgetUsdt) * 100

  // Rule 1: 单笔仓位上限
  const positionPass = positionPct <= constraints.maxPositionPct
  if (!positionPass) {
    violations.push(
      `仓位 ${positionPct.toFixed(1)}% 超过上限 ${constraints.maxPositionPct}%`,
    )
  }

  // Rule 2: 资产白名单
  const whitelistPass = constraints.allowedAssets.includes(order.asset)
  if (!whitelistPass) {
    violations.push(
      `${order.asset} 不在白名单 [${constraints.allowedAssets.join(', ')}] 内`,
    )
  }

  // Rule 3: 日亏损熔断
  const breakerPass = Math.abs(Math.min(dailyPnlPct, 0)) < constraints.dailyLossBreakerPct
  if (!breakerPass) {
    violations.push(
      `日累计亏损 ${Math.abs(dailyPnlPct).toFixed(1)}% 已触发熔断阈值 ${constraints.dailyLossBreakerPct}%`,
    )
  }

  // Rule 4: 预算余额
  const budgetPass = order.amountUsdt <= constraints.budgetUsdt
  if (!budgetPass) {
    violations.push(
      `下单金额 ${order.amountUsdt} USDT 超过总预算 ${constraints.budgetUsdt} USDT`,
    )
  }

  const rules: FirewallRule[] = [
    {
      label: '总交易预算',
      limit: `${constraints.budgetUsdt.toLocaleString()} USDT`,
      current: `${order.amountUsdt.toLocaleString()} USDT`,
      state: budgetPass ? 'pass' : 'locked',
    },
    {
      label: `${order.asset} 最大仓位`,
      limit: `${constraints.maxPositionPct}%`,
      current: `${positionPct.toFixed(0)}%`,
      state: positionPass ? 'pass' : 'locked',
    },
    {
      label: '日亏损熔断',
      limit: `${constraints.dailyLossBreakerPct}%`,
      current: `${Math.abs(Math.min(dailyPnlPct, 0)).toFixed(1)}%`,
      state: breakerPass ? 'pass' : 'locked',
    },
    {
      label: '资产白名单',
      limit: constraints.allowedAssets.join(' / '),
      current: order.asset,
      state: whitelistPass ? 'pass' : 'locked',
    },
  ]

  return { passed: violations.length === 0, rules, violations }
}

// ─── 交易组装 ─────────────────────────────────────────────────────────────────────

export interface AssembledTransaction {
  marketId: string
  orderType: 'BUY' | 'SELL'
  quantity: string
  price: string
  feeRecipient: string
  subaccountId: string
}

/**
 * 将 TradeOrder 转换为 Injective Spot Market 订单参数。
 * 实际签名由钱包层完成（MetaMask / Keplr），此处仅组装消息体。
 */
export function assembleTransaction(
  order: TradeOrder,
  subaccountId: string,
  feeRecipient: string,
): AssembledTransaction {
  const price = order.price ?? 0 // 0 表示市价
  return {
    marketId: ETH_USDT_MARKET_ID,
    orderType: order.side === 'buy' ? 'BUY' : 'SELL',
    quantity: order.amountUsdt.toString(),
    price: price.toString(),
    feeRecipient,
    subaccountId,
  }
}

// ─── 测试网广播与回执解析 ──────────────────────────────────────────────────────────

/**
 * 广播已签名交易到 Injective 测试网并等待确认。
 *
 * 实际集成时需要：
 *   import { TxClient, MsgSpotMarketOrder } from '@injectivelabs/sdk-ts'
 *   import { getNetworkEndpoints, Network } from '@injectivelabs/networks'
 *
 * 当前实现通过 LCD REST 接口完成广播，避免强依赖 SDK 版本。
 */
export async function broadcastToTestnet(
  signedTxBytes: Uint8Array,
): Promise<BroadcastReceipt> {
  const endpoint = `${INJECTIVE_TESTNET.lcd}/cosmos/tx/v1beta1/txs`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes: bufferToBase64(signedTxBytes),
      mode: 'BROADCAST_MODE_SYNC',
    }),
  })

  if (!response.ok) {
    throw new Error(`Injective LCD 广播失败: ${response.status} ${response.statusText}`)
  }

  const result = await response.json() as LcdBroadcastResponse

  if (result.tx_response.code !== 0) {
    throw new Error(`链上执行失败 (code ${result.tx_response.code}): ${result.tx_response.raw_log}`)
  }

  return parseReceipt(result.tx_response)
}

/** 解析 LCD 返回的交易回执 */
function parseReceipt(txResponse: LcdTxResponse): BroadcastReceipt {
  return {
    txHash: txResponse.txhash,
    blockHeight: Number(txResponse.height),
    timestamp: txResponse.timestamp,
    gasUsed: Number(txResponse.gas_used),
    gasWanted: Number(txResponse.gas_wanted),
    success: txResponse.code === 0,
    rawLog: txResponse.raw_log,
  }
}

/** 查询交易状态（用于异步确认） */
export async function queryTxReceipt(txHash: string): Promise<BroadcastReceipt | null> {
  const endpoint = `${INJECTIVE_TESTNET.lcd}/cosmos/tx/v1beta1/txs/${txHash}`

  const response = await fetch(endpoint)
  if (!response.ok) return null

  const result = await response.json() as LcdBroadcastResponse
  return parseReceipt(result.tx_response)
}

// ─── 高层执行入口 ──────────────────────────────────────────────────────────────────

/**
 * 完整执行管线：Firewall 校验 → 组装 → 广播 → 回执。
 * 与 App.tsx 中 handleExecute 对应，替换 Demo 的 setTimeout 模拟。
 *
 * @param order        交易指令
 * @param constraints  用户授权边界
 * @param signer       签名函数（由钱包层注入，如 MetaMask / Keplr）
 * @param dailyPnlPct  当日累计盈亏百分比
 */
export async function executeOnTestnet(
  order: TradeOrder,
  constraints: UserConstraints,
  signer: (tx: AssembledTransaction) => Promise<Uint8Array>,
  dailyPnlPct = 0,
): Promise<ExecutionResult> {
  const now = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })
  const timeline: TimelineEvent[] = []

  // Step 1: Capital Firewall
  const firewallResult = validateFirewall(order, constraints, dailyPnlPct)
  timeline.push({
    time: now(),
    title: firewallResult.passed ? 'Capital Firewall 校验通过' : 'Capital Firewall 拒绝交易',
    detail: firewallResult.passed
      ? `${order.asset} ${order.side === 'buy' ? '买入' : '卖出'} ${order.amountUsdt} USDT · 策略 ${order.strategyVersion}`
      : firewallResult.violations.join('；'),
    tone: firewallResult.passed ? 'success' : 'warning',
  })

  if (!firewallResult.passed) {
    return { receipt: null, firewallResult, timeline }
  }

  // Step 2: 组装交易
  const subaccountId = `${order.strategyVersion}-subaccount` // 实际由钱包派生
  const feeRecipient = 'inj1testnetfeerecipient000000000000000000000'
  const assembled = assembleTransaction(order, subaccountId, feeRecipient)
  timeline.push({
    time: now(),
    title: '交易已组装',
    detail: `Market ${assembled.marketId.slice(0, 10)}… · ${assembled.orderType} ${assembled.quantity} USDT`,
    tone: 'neutral',
  })

  // Step 3: 签名 + 广播
  try {
    const signedBytes = await signer(assembled)
    const receipt = await broadcastToTestnet(signedBytes)

    timeline.push({
      time: now(),
      title: `${order.strategyVersion} 已在测试网执行`,
      detail: `交易哈希 ${receipt.txHash.slice(0, 6)}...${receipt.txHash.slice(-4)}`,
      tone: 'success',
    })

    return { receipt, firewallResult, timeline }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    timeline.push({
      time: now(),
      title: '链上执行失败',
      detail: message,
      tone: 'warning',
    })
    return { receipt: null, firewallResult, timeline }
  }
}

// ─── 兼容 demoData.ts 的接口签名 ──────────────────────────────────────────────────

/**
 * 获取当前防火墙规则快照（与 demoData.firewallRules 同类型）。
 * App.tsx 可将 `import { firewallRules } from './services/demoData'`
 * 替换为 `const firewallRules = await fetchFirewallRules(order, constraints)`。
 */
export function fetchFirewallRules(
  order: TradeOrder,
  constraints: UserConstraints = DEFAULT_CONSTRAINTS,
  dailyPnlPct = 0,
): FirewallRule[] {
  return validateFirewall(order, constraints, dailyPnlPct).rules
}

/**
 * 获取执行时间线（与 demoData.timeline 同类型）。
 * 在真实模式下由 executeOnTestnet 返回；
 * 此函数提供独立的只读查询入口。
 */
export function buildExecutionTimeline(
  order: TradeOrder,
  firewallResult: FirewallCheckResult,
  receipt: BroadcastReceipt | null,
): TimelineEvent[] {
  const events: TimelineEvent[] = []

  if (!firewallResult.passed) {
    events.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      title: 'Risk Agent 拒绝执行',
      detail: firewallResult.violations.join('；'),
      tone: 'warning',
    })
    return events
  }

  events.push({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    title: 'Capital Firewall 已通过',
    detail: `${order.asset} ${order.amountUsdt} USDT · 策略 ${order.strategyVersion}`,
    tone: 'success',
  })

  if (receipt) {
    events.push({
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      title: `${order.strategyVersion} 已在测试网执行`,
      detail: `交易哈希 ${receipt.txHash.slice(0, 6)}...${receipt.txHash.slice(-4)}`,
      tone: 'success',
    })
  }

  return events
}

/** 生成交易浏览器链接 */
export function explorerTxUrl(txHash: string): string {
  return `${INJECTIVE_TESTNET.explorer}/transaction/${txHash}`
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────────────

function bufferToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

// ─── LCD 响应类型 ──────────────────────────────────────────────────────────────────

interface LcdTxResponse {
  height: string
  txhash: string
  code: number
  raw_log: string
  gas_wanted: string
  gas_used: string
  timestamp: string
}

interface LcdBroadcastResponse {
  tx_response: LcdTxResponse
}
