import type { CreateTaskInput, TaskSnapshot } from '../src/domain/trading.js'

export function parseA2AInput(text: string): CreateTaskInput {
  const symbol = text.match(/\b\d{6}\.(?:SZ|SH|BJ)\b/i)?.[0]?.toUpperCase() ?? '000001.SZ'
  const budget = numberBeforeLabel(text, /(?:USDT|预算|budget)/i) ?? 1_000
  const maxLoss = numberBeforeLabel(text, /(?:最大亏损|最大回撤|drawdown|loss)/i, true) ?? 5
  const maxAsset = numberBeforeLabel(text, /(?:仓位|position)/i, true) ?? 30
  return {
    objective: text.trim() || `研究 ${symbol}，输出可解释策略、风险边界与审计证据。`,
    budgetUsdt: budget,
    maxLossPct: maxLoss,
    maxAssetPct: maxAsset,
    asset: symbol,
  }
}

export function toA2ATask(snapshot: TaskSnapshot) {
  const latestTimelineEvent = snapshot.timeline.at(-1)
  return {
    kind: 'task',
    id: snapshot.id,
    contextId: snapshot.missionId,
    status: {
      state: phaseToA2AState(snapshot.phase),
      message: latestTimelineEvent
        ? {
            kind: 'message',
            messageId: `${snapshot.id}-status-${snapshot.timeline.length}`,
            role: 'agent',
            parts: [{ kind: 'text', text: latestTimelineEvent.title }],
          }
        : undefined,
      timestamp: snapshot.updatedAt,
    },
    artifacts: buildArtifacts(snapshot),
    metadata: {
      appId: 'kaleidox',
      phase: snapshot.phase,
      dataProvider: snapshot.quantEvidence?.provider,
      paymentReceipts: snapshot.paymentTraces
        .filter((trace) => trace.receipt?.status === 'confirmed')
        .map((trace) => ({
          intentId: trace.intent.id,
          purpose: trace.intent.purpose,
          network: trace.receipt?.network,
          transactionHash: trace.receipt?.transactionHash,
        })),
    },
  }
}

export function buildAgentCard(baseUrl: string, authenticationRequired = false) {
  return {
    protocolVersion: '0.3.0',
    name: 'KaleidoX on PactLedger',
    description: 'A stock research reference agent that produces evidence-backed strategy recommendations while PactLedger controls Agent spending, policy decisions and settlement receipts.',
    url: `${baseUrl}/a2a`,
    version: '1.1.0',
    preferredTransport: 'JSONRPC',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    securitySchemes: authenticationRequired ? {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    } : undefined,
    security: authenticationRequired ? [{ bearerAuth: [] }] : undefined,
    skills: [
      {
        id: 'stock-research-with-controlled-spend',
        name: 'Risk-controlled stock research',
        description: 'Research an A-share symbol, compare deterministic strategies, apply an independent policy veto and return auditable Agent-payment evidence.',
        tags: ['panda-data', 'stock-research', 'risk-control', 'agent-payments'],
        examples: [
          '研究 000001.SZ，最大回撤 5%，单股仓位不超过 30%',
          'Analyze 600519.SH with a 1000 USDT Agent-service budget and explain the risk decision',
        ],
      },
    ],
  }
}

function phaseToA2AState(phase: TaskSnapshot['phase']): string {
  if (phase === 'executed') return 'completed'
  if (phase === 'failed') return 'failed'
  if (phase === 'awaiting_approval') return 'input-required'
  if (phase === 'created') return 'submitted'
  return 'working'
}

function buildArtifacts(snapshot: TaskSnapshot) {
  if (!snapshot.quantEvidence) return []
  return [{
    artifactId: `artifact-${snapshot.id}`,
    name: 'research-and-policy-evidence',
    parts: [{
      kind: 'data',
      data: {
        symbol: snapshot.quantEvidence.symbol,
        provider: snapshot.quantEvidence.provider,
        barCount: snapshot.quantEvidence.barCount,
        researchSummary: snapshot.researchSummary,
        candidates: snapshot.candidates,
        policyIntent: snapshot.actionIntent,
        paymentTraces: snapshot.paymentTraces,
      },
    }],
  }]
}

function numberBeforeLabel(text: string, label: RegExp, percent = false): number | undefined {
  const source = label.source
  const before = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${percent ? '%?' : ''}\\s*(?:${source})`, 'i'))
  if (before) return Number(before[1])
  const after = text.match(new RegExp(`(?:${source})[^\\d]{0,8}(\\d+(?:\\.\\d+)?)`, 'i'))
  return after ? Number(after[1]) : undefined
}
