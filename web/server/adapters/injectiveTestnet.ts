import {
  Address,
  MsgBroadcasterWithPk,
  MsgSend,
  PrivateKey,
} from '@injectivelabs/sdk-ts'
import { Network } from '@injectivelabs/networks'
import { ChainId } from '@injectivelabs/ts-types'
import type { AgentPaymentIntent, SettlementReceipt } from '../../src/domain/pactledger.js'
import {
  getInjectivePayeeAddress,
  type InjectiveConfig,
} from '../config/injective.js'
import {
  SettlementAdapterError,
  type SettlementAdapter,
} from './execution.js'

interface BroadcastRequest {
  privateKey: PrivateKey
  payerAddress: string
  payeeAddress: string
  amountAtomic: string
  denom: string
  memo: string
}

interface BroadcastResult {
  txHash: string
  height: number
  code: number
  rawLog?: string
  gasUsed?: number
  timestamp?: string
}

interface InjectiveTestnetDependencies {
  broadcast?: (request: BroadcastRequest) => Promise<BroadcastResult>
  now?: () => Date
}

export class InjectiveTestnetSettlementAdapter implements SettlementAdapter {
  readonly mode = 'testnet' as const
  readonly network = 'Injective Testnet' as const
  private readonly broadcast: (request: BroadcastRequest) => Promise<BroadcastResult>
  private readonly now: () => Date

  constructor(
    private readonly config: InjectiveConfig,
    dependencies: InjectiveTestnetDependencies = {},
  ) {
    this.broadcast = dependencies.broadcast ?? ((request) => this.broadcastWithSdk(request))
    this.now = dependencies.now ?? (() => new Date())
  }

  async settle(intent: AgentPaymentIntent): Promise<SettlementReceipt> {
    const payment = this.validateAndMap(intent)
    let result: BroadcastResult
    try {
      result = await this.broadcast(payment)
    } catch (error) {
      if (error instanceof SettlementAdapterError) throw error
      throw new SettlementAdapterError(
        'INJECTIVE_BROADCAST_FAILED',
        'Injective Testnet 广播或确认失败。请检查测试币余额与网络状态。',
        true,
      )
    }

    if (result.code !== 0) {
      throw new SettlementAdapterError(
        'INJECTIVE_TX_REJECTED',
        'Injective Testnet 已拒绝该交易，请检查余额、Gas 与链上参数。',
      )
    }
    if (!result.txHash || result.height <= 0) {
      throw new SettlementAdapterError(
        'INJECTIVE_CONFIRMATION_MISSING',
        '交易未获得可验证的区块确认，未生成链上 Receipt。',
        true,
      )
    }

    return {
      intentId: intent.id,
      mode: 'testnet',
      network: 'Injective Testnet',
      status: 'confirmed',
      amountAtomic: payment.amountAtomic,
      denom: payment.denom,
      transactionHash: result.txHash,
      explorerUrl: `${this.config.explorerTxBaseUrl}${result.txHash}`,
      blockHeight: String(result.height),
      txCode: result.code,
      gasUsed: result.gasUsed,
      confirmedAt: result.timestamp || this.now().toISOString(),
    }
  }

  private validateAndMap(intent: AgentPaymentIntent): BroadcastRequest {
    const { walletAddress, privateKey, paymentDenom, paymentDecimals } = this.config
    if (!walletAddress || !privateKey || !paymentDenom || paymentDecimals === undefined) {
      throw new SettlementAdapterError(
        'INJECTIVE_CONFIGURATION_REQUIRED',
        'Injective Testnet 结算配置不完整，未进行广播。',
      )
    }
    if (this.config.chainId !== ChainId.Testnet) {
      throw new SettlementAdapterError('INJECTIVE_CHAIN_ID_INVALID', '当前只允许 Injective Testnet 链 ID。')
    }
    if (intent.status !== 'settling') {
      throw new SettlementAdapterError(
        'PAYMENT_INTENT_STATE_INVALID',
        '只有通过 Policy 并进入 settling 状态的 Payment Intent 才能结算。',
      )
    }
    if (Date.parse(intent.expiresAt) <= this.now().getTime()) {
      throw new SettlementAdapterError('PAYMENT_INTENT_EXPIRED', 'Payment Intent 已过期，未进行广播。')
    }

    const configuredPayee = getInjectivePayeeAddress(this.config, intent.payeeId)
    if (!configuredPayee) {
      throw new SettlementAdapterError(
        'INJECTIVE_PAYEE_NOT_CONFIGURED',
        '该收款方没有配置 Injective Testnet 白名单地址。',
      )
    }
    if (intent.payeeAddress && intent.payeeAddress !== configuredPayee) {
      throw new SettlementAdapterError(
        'INJECTIVE_PAYEE_ADDRESS_MISMATCH',
        'Payment Intent 收款地址与服务端白名单不一致。',
      )
    }
    if (intent.denom && intent.denom !== paymentDenom) {
      throw new SettlementAdapterError(
        'INJECTIVE_DENOM_MISMATCH',
        'Payment Intent denom 与服务端资产映射不一致。',
      )
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/:._-]{2,127}$/.test(paymentDenom)) {
      throw new SettlementAdapterError(
        'INJECTIVE_DENOM_INVALID',
        '服务端配置的 Injective denom 格式无效。',
      )
    }
    validateExplorerBaseUrl(this.config.explorerTxBaseUrl)

    const payerAddress = validateInjectiveAddress(walletAddress, '付款钱包')
    const payeeAddress = validateInjectiveAddress(configuredPayee, '收款地址')
    const normalizedPrivateKey = normalizePrivateKey(privateKey)
    let signer: PrivateKey
    try {
      signer = PrivateKey.fromHex(normalizedPrivateKey)
    } catch {
      throw new SettlementAdapterError('INJECTIVE_PRIVATE_KEY_INVALID', 'Injective 私钥格式无效。')
    }
    if (signer.toBech32() !== payerAddress) {
      throw new SettlementAdapterError(
        'INJECTIVE_SIGNER_ADDRESS_MISMATCH',
        '服务端私钥与配置的钱包地址不匹配。',
      )
    }

    const amountAtomic = decimalToAtomicAmount(intent.amount, paymentDecimals)
    if (intent.amountAtomic && intent.amountAtomic !== amountAtomic) {
      throw new SettlementAdapterError(
        'INJECTIVE_ATOMIC_AMOUNT_MISMATCH',
        'Payment Intent 原子金额与服务端资产精度映射不一致。',
      )
    }

    return {
      privateKey: signer,
      payerAddress,
      payeeAddress,
      amountAtomic,
      denom: paymentDenom,
      memo: `PactLedger:${intent.id}`,
    }
  }

  private async broadcastWithSdk(request: BroadcastRequest): Promise<BroadcastResult> {
    const broadcaster = new MsgBroadcasterWithPk({
      network: Network.TestnetSentry,
      chainId: ChainId.Testnet,
      privateKey: request.privateKey,
      endpoints: {
        indexer: this.config.indexerEndpoint,
        grpc: this.config.grpcEndpoint,
        rest: this.config.restEndpoint,
      },
      simulateTx: true,
      loggingEnabled: false,
      txTimeout: 30_000,
    })
    const response = await broadcaster.broadcast({
      msgs: MsgSend.fromJSON({
        srcInjectiveAddress: request.payerAddress,
        dstInjectiveAddress: request.payeeAddress,
        amount: { denom: request.denom, amount: request.amountAtomic },
      }),
      memo: request.memo,
      gas: { gasPrice: this.config.gasPrice },
    })
    return response
  }
}

export function decimalToAtomicAmount(amount: number, decimals: number): string {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SettlementAdapterError('PAYMENT_AMOUNT_INVALID', '付款金额必须是大于零的有限数值。')
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new SettlementAdapterError('PAYMENT_DECIMALS_INVALID', '资产精度配置无效。')
  }

  const value = amount.toString()
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new SettlementAdapterError(
      'PAYMENT_AMOUNT_PRECISION_INVALID',
      '付款金额必须使用普通十进制表示。',
    )
  }
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new SettlementAdapterError(
      'PAYMENT_AMOUNT_PRECISION_INVALID',
      `付款金额超过资产允许的 ${decimals} 位精度。`,
    )
  }
  const scale = 10n ** BigInt(decimals)
  const fractional = (fraction.slice(0, decimals).padEnd(decimals, '0') || '0')
  const atomic = BigInt(whole) * scale + BigInt(fractional)
  if (atomic <= 0n) {
    throw new SettlementAdapterError('PAYMENT_AMOUNT_TOO_SMALL', '付款金额小于链上最小单位。')
  }
  return atomic.toString()
}

function validateInjectiveAddress(address: string, label: string): string {
  try {
    return Address.fromBech32(address, 'inj').toAccountAddress()
  } catch {
    throw new SettlementAdapterError('INJECTIVE_ADDRESS_INVALID', `${label}不是有效的 Injective 地址。`)
  }
}

function normalizePrivateKey(privateKey: string): string {
  const normalized = privateKey.trim().replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new SettlementAdapterError('INJECTIVE_PRIVATE_KEY_INVALID', 'Injective 私钥格式无效。')
  }
  return normalized
}

function validateExplorerBaseUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('unsupported protocol')
  } catch {
    throw new SettlementAdapterError(
      'INJECTIVE_EXPLORER_URL_INVALID',
      'Injective Explorer 交易链接配置无效。',
    )
  }
}
