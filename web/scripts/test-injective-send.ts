/**
 * PactLedger — Injective Testnet 第一笔真实交易测试
 *
 * 走通 Intent → Settlement → Receipt 完整链路。
 * 金额极小（0.001 INJ），自转账（payer = payee），仅用于验证配置正确性。
 *
 * 用法: cd web && npx tsx scripts/test-injective-send.ts
 */
import { config as loadDotenv } from 'dotenv'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

async function main() {
  // 加载 web/.env.local 和 web/.env
  const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  loadDotenv({ path: [resolve(webDir, '.env.local'), resolve(webDir, '.env')], quiet: false })

  // 动态导入 — 必须在 dotenv 之后，这样 process.env 才有值
  const { readInjectiveConfig } = await import('../server/config/injective.js')
  const { InjectiveTestnetSettlementAdapter } = await import('../server/adapters/injectiveTestnet.js')

  const config = readInjectiveConfig(process.env)

  console.log('═══════════════════════════════════════════')
  console.log('PactLedger × Injective Testnet 首笔交易')
  console.log('═══════════════════════════════════════════')
  console.log('Mode:            ', config.mode)
  console.log('Network:         ', config.network)
  console.log('Chain ID:        ', config.chainId)
  console.log('Wallet:          ', config.walletAddress)
  console.log('Payment Denom:   ', config.paymentDenom)
  console.log('Payment Decimals:', config.paymentDecimals)
  console.log('Gas Price:       ', config.gasPrice)
  console.log('RPC:             ', config.rpcEndpoint)
  console.log('Explorer Base:   ', config.explorerTxBaseUrl)
  console.log('')

  const adapter = new InjectiveTestnetSettlementAdapter(config)

  const intent = {
    id: `PAY-LIVE-${Date.now()}`,
    tenantId: 'pactledger-demo',
    appId: 'kaleidox' as const,
    payerAgentId: 'strategy',
    payeeId: 'risk',
    amount: 0.001,
    currency: 'INJ',
    denom: 'inj',
    purpose: 'risk_review' as const,
    protocol: 'internal' as const,
    status: 'settling' as const,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    metadataHash: `sha256:first-tx-${Date.now()}`,
    createdAt: new Date().toISOString(),
  }

  console.log('Intent:')
  console.log('  ID:            ', intent.id)
  console.log('  App:           ', intent.appId)
  console.log('  Payer:         ', intent.payerAgentId)
  console.log('  Payee:         ', intent.payeeId)
  console.log('  Amount:        ', intent.amount, intent.currency)
  console.log('  Purpose:       ', intent.purpose)
  console.log('')

  console.log('⏳ 正在广播交易到 Injective Testnet...')
  console.log('')

  try {
    const receipt = await adapter.settle(intent)

    console.log('═══════════════════════════════════════════')
    console.log('✅ 交易已确认！Receipt 已生成')
    console.log('═══════════════════════════════════════════')
    console.log('')
    console.log('Receipt:')
    console.log('  Intent ID:     ', receipt.intentId)
    console.log('  Status:        ', receipt.status)
    console.log('  Network:       ', receipt.network)
    console.log('  Mode:          ', receipt.mode)
    console.log('  Tx Hash:       ', receipt.transactionHash)
    console.log('  Block Height:  ', receipt.blockHeight)
    console.log('  Amount (atom): ', receipt.amountAtomic, receipt.denom)
    console.log('  Gas Used:      ', receipt.gasUsed)
    console.log('  Confirmed At:  ', receipt.confirmedAt)
    console.log('  Explorer:      ', receipt.explorerUrl)
    console.log('')

    console.log('🔗 在 Explorer 中查看:')
    console.log(`   ${receipt.explorerUrl}`)
    console.log('')
    console.log('═══════════════════════════════════════════')
    console.log('🎉 PactLedger 核心论证成立！')
    console.log('   Agent Intent → Policy → Settlement → Receipt')
    console.log('═══════════════════════════════════════════')
  } catch (error: unknown) {
    const failure = error instanceof Error ? error : new Error(String(error))
    const details = typeof error === 'object' && error !== null
      ? error as { code?: unknown; retryable?: unknown }
      : {}
    console.log('')
    console.log('═══════════════════════════════════════════')
    console.log('❌ 交易失败')
    console.log('═══════════════════════════════════════════')
    console.log('Error Code:     ', details.code ?? 'UNKNOWN')
    console.log('Error Message:  ', failure.message)
    if (details.retryable !== undefined) {
      console.log('Retryable:      ', details.retryable)
    }
    console.log('')
    console.log('提示：请检查余额是否充足，网络是否可达。')
    console.log(`余额查询: https://testnet.sentry.lcd.injective.network/cosmos/bank/v1beta1/balances/${config.walletAddress}`)
    process.exit(1)
  }
}

main()
