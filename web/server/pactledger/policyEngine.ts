import { randomUUID } from 'node:crypto'
import type {
  AgentPaymentIntent,
  PactLedgerPolicy,
  PolicyCheck,
  PolicyDecision,
} from '../../src/domain/pactledger.js'

interface PolicyContext {
  availableBudget?: number
  humanApproved?: boolean
}

export class PolicyEngine {
  evaluate(intent: AgentPaymentIntent, policy: PactLedgerPolicy, context: PolicyContext = {}): PolicyDecision {
    const availableBudget = context.availableBudget ?? policy.budgetLimit
    const checks: PolicyCheck[] = [
      makeCheck(
        'APP_MATCH',
        '应用边界',
        intent.appId === policy.appId,
        intent.appId === policy.appId ? `${intent.appId} 使用匹配策略` : `策略 ${policy.id} 不适用于 ${intent.appId}`,
      ),
      makeCheck(
        'INTENT_NOT_EXPIRED',
        '有效期',
        Date.parse(intent.expiresAt) > Date.now(),
        Date.parse(intent.expiresAt) > Date.now() ? `有效至 ${intent.expiresAt}` : 'Intent 已过期',
      ),
      makeCheck(
        'POSITIVE_AMOUNT',
        '金额有效',
        Number.isFinite(intent.amount) && intent.amount > 0,
        `${intent.amount} ${intent.currency}`,
      ),
      makeCheck(
        'PURPOSE_ALLOWED',
        '用途许可',
        policy.allowedPurposes.includes(intent.purpose),
        policy.allowedPurposes.includes(intent.purpose) ? intent.purpose : `${intent.purpose} 不在许可用途内`,
      ),
      makeCheck(
        'PAYEE_ALLOWED',
        '收款方白名单',
        policy.allowedPayees.includes(intent.payeeId),
        policy.allowedPayees.includes(intent.payeeId) ? intent.payeeId : `${intent.payeeId} 不在白名单`,
      ),
      makeCheck(
        'SINGLE_PAYMENT_LIMIT',
        '单笔限额',
        intent.amount <= policy.maxSinglePayment,
        `${intent.amount} / ${policy.maxSinglePayment} ${intent.currency}`,
      ),
      makeCheck(
        'BUDGET_AVAILABLE',
        '预算余额',
        intent.amount <= availableBudget,
        `${intent.amount} / ${availableBudget} ${intent.currency}`,
      ),
    ]

    const failed = checks.find((check) => !check.passed)
    if (failed) {
      return makeDecision(intent, policy, 'rejected', rejectionCode(failed.code), failed.detail, checks)
    }

    if (intent.amount >= policy.approvalThreshold && !context.humanApproved) {
      return makeDecision(
        intent,
        policy,
        'approval_required',
        'HUMAN_APPROVAL_REQUIRED',
        `金额达到 ${policy.approvalThreshold} ${intent.currency}，需要人工确认`,
        checks,
      )
    }

    return makeDecision(intent, policy, 'approved', 'POLICY_APPROVED', '全部策略检查通过', checks)
  }
}

function rejectionCode(checkCode: string): string {
  const codes: Record<string, string> = {
    APP_MATCH: 'APP_NOT_ALLOWED',
    INTENT_NOT_EXPIRED: 'INTENT_EXPIRED',
    POSITIVE_AMOUNT: 'PAYMENT_AMOUNT_INVALID',
    PURPOSE_ALLOWED: 'PURPOSE_NOT_ALLOWED',
    PAYEE_ALLOWED: 'PAYEE_NOT_ALLOWED',
    SINGLE_PAYMENT_LIMIT: 'SINGLE_PAYMENT_LIMIT_EXCEEDED',
    BUDGET_AVAILABLE: 'BUDGET_EXCEEDED',
  }
  return codes[checkCode] ?? 'POLICY_REJECTED'
}

function makeCheck(code: string, label: string, passed: boolean, detail: string): PolicyCheck {
  return { code, label, passed, detail }
}

function makeDecision(
  intent: AgentPaymentIntent,
  policy: PactLedgerPolicy,
  outcome: PolicyDecision['outcome'],
  code: string,
  reason: string,
  checks: PolicyCheck[],
): PolicyDecision {
  return {
    id: `PDEC-${randomUUID().slice(0, 8).toUpperCase()}`,
    intentId: intent.id,
    policyId: policy.id,
    outcome,
    code,
    reason,
    checks,
    evaluatedAt: new Date().toISOString(),
  }
}
