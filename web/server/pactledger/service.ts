import type { AgentPaymentIntent, PactLedgerTrace, SettlementReceipt } from '../../src/domain/pactledger.js'
import { SettlementAdapterError, type SettlementAdapter } from '../adapters/execution.js'
import { getPactLedgerPolicy } from './policies.js'
import { PolicyEngine } from './policyEngine.js'
import { PactLedgerRepository } from './repository.js'

export class PactLedgerService {
  private readonly inFlight = new Map<string, Promise<PactLedgerTrace>>()

  constructor(
    private readonly repository: PactLedgerRepository,
    private readonly policyEngine: PolicyEngine,
    private readonly settlementAdapter: SettlementAdapter,
  ) {}

  process(intent: AgentPaymentIntent, options: { humanApproved?: boolean } = {}): Promise<PactLedgerTrace> {
    const pending = this.inFlight.get(intent.id)
    if (pending) return pending
    const operation = this.processOnce(intent, options).finally(() => {
      this.inFlight.delete(intent.id)
    })
    this.inFlight.set(intent.id, operation)
    return operation
  }

  private async processOnce(
    submittedIntent: AgentPaymentIntent,
    options: { humanApproved?: boolean },
  ): Promise<PactLedgerTrace> {
    const existing = await this.repository.findTrace(submittedIntent.id)
    if (existing?.receipt || existing?.decision.outcome === 'rejected') return existing

    const intent = existing?.intent ?? submittedIntent
    if (existing?.intent.status === 'settling') {
      intent.status = 'failed'
      const receipt: SettlementReceipt = {
        intentId: intent.id,
        mode: this.settlementAdapter.mode,
        network: this.settlementAdapter.network,
        status: 'failed',
        errorCode: 'SETTLEMENT_RECOVERY_REQUIRED',
        error: '检测到未完成的结算状态。为防止重复付款，系统已停止自动重播。',
        retryable: false,
        confirmedAt: new Date().toISOString(),
      }
      await this.repository.saveIntent(intent)
      await this.repository.saveReceipt(receipt)
      return { intent, decision: existing.decision, receipt }
    }

    await this.repository.saveIntent(intent)
    const shouldReevaluate = existing?.decision.outcome === 'approval_required' && options.humanApproved
    const decision = !existing?.decision || shouldReevaluate
      ? this.policyEngine.evaluate(
          intent,
          getPactLedgerPolicy(intent.appId),
          { humanApproved: options.humanApproved },
        )
      : existing.decision
    await this.repository.saveDecision(decision)

    if (decision.outcome === 'rejected') {
      intent.status = 'policy_rejected'
      await this.repository.saveIntent(intent)
      return { intent, decision }
    }

    if (decision.outcome === 'approval_required') {
      intent.status = 'approval_required'
      await this.repository.saveIntent(intent)
      return { intent, decision }
    }

    intent.status = 'settling'
    await this.repository.saveIntent(intent)

    let receipt: SettlementReceipt
    try {
      receipt = await this.settlementAdapter.settle(intent)
      intent.status = receipt.status === 'confirmed' ? 'confirmed' : 'failed'
    } catch (error) {
      intent.status = 'failed'
      const stableError = error instanceof SettlementAdapterError
        ? error
        : new SettlementAdapterError(
            'SETTLEMENT_FAILED',
            '结算适配器未返回可验证 Receipt。',
            true,
          )
      receipt = {
        intentId: intent.id,
        mode: this.settlementAdapter.mode,
        network: this.settlementAdapter.network,
        status: 'failed',
        amountAtomic: intent.amountAtomic,
        denom: intent.denom,
        errorCode: stableError.code,
        error: stableError.message,
        retryable: stableError.retryable,
        confirmedAt: new Date().toISOString(),
      }
    }
    await this.repository.saveIntent(intent)
    await this.repository.saveReceipt(receipt)
    return { intent, decision, receipt }
  }
}
