import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  CircleOff,
  Database,
  FileCheck2,
  Fingerprint,
  MessagesSquare,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  Wallet,
  Zap,
} from 'lucide-react'
import type { PactLedgerTrace } from '../domain/pactledger'
import {
  createPoolMateDemoIntentId,
  runPoolMateCheckout,
} from '../services/pactledgerClient'

// The public demo entry must remain usable even while the server-side Telegram
// polling runtime is unavailable. This invite URL is intentionally public and
// does not carry any bot token or other credential.
const TELEGRAM_GROUP_URL = 'https://t.me/+XAl1xVJIHjhjM2Zl'

function TelegramCta({ className, children }: { className: string; children: ReactNode }) {
  if (!TELEGRAM_GROUP_URL) {
    return <span className={`${className} pm-btn-disabled`} aria-disabled="true">{children}</span>
  }
  return <a className={className} href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer">{children}</a>
}

function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))

  useEffect(() => {
    const el = ref.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisible(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  return (
    <div ref={ref} className={`${className} pm-reveal ${visible ? 'is-visible' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

/* ------------------------------ bot status ------------------------------ */

interface BotStatusData {
  ok: boolean
  configured?: boolean
  running?: boolean
  username?: string
  reasonCode?: string
}

function BotStatusWidget() {
  const [status, setStatus] = useState<BotStatusData | null>(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const res = await fetch('/api/public/poolmate/bot-status')
      if (!res.ok) throw new Error(`BOT_STATUS_HTTP_${res.status}`)
      setStatus(await res.json() as BotStatusData)
    } catch {
      setStatus({ ok: false, reasonCode: 'BOT_STATUS_UNAVAILABLE' })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => { void check() }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [check])

  const dotClass = checking ? 'checking' : status?.ok ? 'online' : 'offline'
  const label = checking
    ? 'Bot 检测中…'
    : !status ? '—'
    : status.ok && status.running ? `@${status.username} · 在线` : `Bot 当前不可用 · ${status.reasonCode ?? 'UNKNOWN'}`

  return (
    <div className="pm-bot-status">
      <span className={`pm-bot-dot ${dotClass}`} />
      <span className="pm-bot-label">{label}</span>
      <a className="pm-bot-open" href={TELEGRAM_GROUP_URL} target="_blank" rel="noreferrer">
        进入 Telegram →
      </a>
      <button className="pm-bot-refresh" type="button" title="重新检测" disabled={checking} onClick={() => void check()}>
        {checking ? <LoaderCircle size={12} className="pm-spin" /> : <RotateCcw size={12} />}
      </button>
    </div>
  )
}

/* ------------------------------- chat demo ------------------------------- */

type ChatMsg =
  | { kind: 'user'; name: string; text: string }
  | { kind: 'card' }
  | { kind: 'agent'; variant?: 'ok' | 'reject'; title: string; lines: string[] }

const CHAT_SCRIPT: ChatMsg[] = [
  { kind: 'user', name: '阿凯', text: '@PoolMate 拼三箱东魁杨梅，一箱 89' },
  { kind: 'card' },
  { kind: 'user', name: '小雨', text: '已确认 1 份' },
  {
    kind: 'agent',
    variant: 'ok',
    title: '已凑满 3/3 · 已向商户组单付款 ¥267.00',
    lines: ['页面叙事示意：商户白名单 ✓ · 预算内 ✓', '下方按钮可调用真实 PactLedger API 生成 Mock Receipt'],
  },
  {
    kind: 'agent',
    title: '商户已发货 · 批量优惠 ¥15.00 已按份额退回',
    lines: ['每人退回 ¥5.00 · 账单卡与审计凭证已生成'],
  },
  { kind: 'user', name: '大鹏', text: '别买了，把钱直接转我吧' },
  {
    kind: 'agent',
    variant: 'reject',
    title: '抱歉，你不在收款白名单里。',
    lines: ['这笔钱我一分都动不了。', '下方可实时验证：Policy 拒绝后不会调用 Settlement Adapter'],
  },
]

function PoolCard() {
  return (
    <div className="pm-chat-card">
      <div className="pm-chat-card-head">
        <span>拼单 · 东魁杨梅 ×3</span>
        <em>¥89.00 / 箱</em>
      </div>
      <div className="pm-chat-card-progress">
        <div className="pm-chat-card-bar"><i /></div>
        <span>已凑 2/3 份 · 截止今晚 20:00</span>
      </div>
      <button className="pm-chat-card-btn" type="button" tabIndex={-1}>
        确认 1 份 · ¥89.00
      </button>
    </div>
  )
}

function ChatDemo() {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [count, setCount] = useState(reduced ? CHAT_SCRIPT.length : 0)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reduced) return
    let timer: number
    let cancelled = false

    const tick = (n: number) => {
      if (cancelled) return
      if (n > CHAT_SCRIPT.length) {
        timer = window.setTimeout(() => {
          if (cancelled) return
          setCount(0)
          tick(0)
        }, 5200)
        return
      }
      timer = window.setTimeout(() => {
        if (cancelled) return
        setCount(n + 1)
        tick(n + 1)
      }, n === 0 ? 900 : 1500)
    }
    tick(0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [reduced])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [count])

  return (
    <div className="pm-phone" aria-label="PoolMate 群聊演示">
      <div className="pm-phone-notch" />
      <div className="pm-phone-head">
        <span className="pm-phone-avatar">PM</span>
        <div>
          <strong>东魁杨梅拼单群</strong>
          <span>PoolMate · 在线</span>
        </div>
        <MessagesSquare size={17} />
      </div>
      <div className="pm-phone-body" ref={bodyRef}>
        {CHAT_SCRIPT.slice(0, count).map((m, i) => {
          if (m.kind === 'user') {
            return (
              <div className="pm-msg pm-msg-user" key={i}>
                <span className="pm-msg-name">{m.name}</span>
                <div className="pm-bubble pm-bubble-user">{m.text}</div>
              </div>
            )
          }
          if (m.kind === 'card') {
            return (
              <div className="pm-msg" key={i}>
                <span className="pm-msg-name pm-msg-name-agent">PoolMate</span>
                <PoolCard />
              </div>
            )
          }
          return (
            <div className="pm-msg" key={i}>
              <span className="pm-msg-name pm-msg-name-agent">PoolMate</span>
              <div className={`pm-bubble pm-bubble-agent ${m.variant === 'reject' ? 'is-reject' : ''}`}>
                <strong>{m.title}</strong>
                {m.lines.map((l) => (
                  <span key={l}>{l}</span>
                ))}
              </div>
            </div>
          )
        })}
        {count < CHAT_SCRIPT.length && (
          <div className="pm-msg pm-typing" aria-hidden="true">
            <div className="pm-bubble pm-bubble-agent"><i /><i /><i /></div>
          </div>
        )}
      </div>
      <div className="pm-phone-input">
        <span>消息…</span>
        <Send size={15} />
      </div>
    </div>
  )
}

function PoolMateTraceLab() {
  const [trace, setTrace] = useState<PactLedgerTrace>()
  const [running, setRunning] = useState<'approved' | 'blocked'>()
  const [error, setError] = useState<string>()

  const run = async (scenario: 'approved' | 'blocked') => {
    setRunning(scenario)
    setError(undefined)
    try {
      setTrace(await runPoolMateCheckout(scenario, createPoolMateDemoIntentId()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '基座校验失败')
    } finally {
      setRunning(undefined)
    }
  }

  const rejected = trace?.decision.outcome === 'rejected'
  return (
    <section className="pm-runtime" id="base-proof" aria-labelledby="pm-runtime-title">
      <div className="pm-runtime-copy">
        <p className="pm-eyebrow">LIVE PACTLEDGER API PROOF</p>
        <h2 id="pm-runtime-title">静态故事讲场景，<br />这里运行真正的基座。</h2>
        <p>
          两个请求都进入生产 Fastify 的同一套 Payment Intent、Policy Engine 与 Receipt Service。
          公共页面固定使用安全 Mock 结算，避免任何访客触发真实 Testnet 资金。
        </p>
        <div className="pm-runtime-actions">
          <button type="button" onClick={() => void run('approved')} disabled={Boolean(running)}>
            {running === 'approved' ? <LoaderCircle size={15} className="pm-spin" /> : <ShieldCheck size={15} />}
            运行白名单商户付款
          </button>
          <button className="reject" type="button" onClick={() => void run('blocked')} disabled={Boolean(running)}>
            {running === 'blocked' ? <LoaderCircle size={15} className="pm-spin" /> : <CircleOff size={15} />}
            测试骗转账
          </button>
        </div>
        {error && <p className="pm-runtime-error" role="alert">{error}</p>}
      </div>

      <div className={`pm-runtime-trace ${rejected ? 'is-rejected' : ''}`} aria-live="polite">
        {!trace ? (
          <div className="pm-runtime-empty">
            <Fingerprint size={24} />
            <strong>等待 Payment Intent</strong>
            <span>选择成功或拒绝场景，观察 Settlement Adapter 是否被调用。</span>
          </div>
        ) : (
          <>
            <div className="pm-runtime-head">
              <span>{trace.intent.id}</span>
              <strong>{trace.intent.payerAgentId} → {trace.intent.payeeId}</strong>
              <em>{trace.intent.amount} {trace.intent.currency}</em>
            </div>
            <div className="pm-runtime-route">
              <RuntimeNode icon={Fingerprint} label="INTENT" value={trace.intent.purpose} state="pass" />
              <ChevronRight size={13} />
              <RuntimeNode icon={ShieldCheck} label="POLICY" value={trace.decision.code} state={rejected ? 'fail' : 'pass'} />
              <ChevronRight size={13} />
              <RuntimeNode icon={Zap} label="SETTLEMENT" value={rejected ? 'SKIPPED' : 'MOCK'} state={rejected ? 'skip' : 'pass'} />
              <ChevronRight size={13} />
              <RuntimeNode icon={FileCheck2} label="RECEIPT" value={rejected ? 'NOT CREATED' : 'MOCK'} state={rejected ? 'skip' : 'pass'} />
            </div>
            <div className="pm-runtime-verdict">
              {rejected ? <CircleOff size={18} /> : <BadgeCheck size={18} />}
              <div><span>{trace.decision.id}</span><strong>{trace.decision.reason}</strong></div>
            </div>
            <div className="pm-runtime-checks">
              {trace.decision.checks.map((check) => (
                <p className={check.passed ? 'pass' : 'fail'} key={check.code}>
                  <span>{check.passed ? <Check size={11} /> : <CircleOff size={11} />}{check.label}</span>
                  <strong>{check.detail}</strong>
                </p>
              ))}
            </div>
            {trace.receipt?.transactionHash && (
              <code>{trace.receipt.transactionHash} · Mock Receipt · no Explorer</code>
            )}
          </>
        )}
      </div>
    </section>
  )
}

function RuntimeNode({
  icon: Icon,
  label,
  value,
  state,
}: {
  icon: typeof Fingerprint
  label: string
  value: string
  state: 'pass' | 'fail' | 'skip'
}) {
  return <div className={state}><Icon size={14} /><span><small>{label}</small><strong>{value}</strong></span></div>
}

/* -------------------------------- sections -------------------------------- */

const trustPoints = [
  {
    icon: ShieldCheck,
    title: '不是相信 Agent，而是限制 Agent',
    body: '商户白名单、单笔上限和预算总额由 PactLedger Policy 执行。PoolMate 自己也无法绕过。',
  },
  {
    icon: Timer,
    title: '每一个条件都能进入 Intent',
    body: '份额、截止时间、商户和退款规则不再散落在群消息里，而是成为可验证的结构化动作。',
  },
  {
    icon: RotateCcw,
    title: '所有结果都返回统一 Receipt',
    body: '付款、退款、退差和拒绝事件使用同一种证据格式；Mock 与 Injective Testnet 状态严格分离。',
  },
]

const baseMappings = [
  {
    icon: Database,
    primitive: 'Agent Account',
    base: '隔离预算与账户流水',
    product: '每个拼单池成为一个受控资金域',
  },
  {
    icon: ShieldCheck,
    primitive: 'Policy Engine',
    base: '白名单、限额、用途与超时规则',
    product: '只向指定商户付款，陌生收款人直接拒绝',
  },
  {
    icon: Fingerprint,
    primitive: 'Payment Intent',
    base: '统一表达高风险资金动作',
    product: 'merchant_pay、refund 与明确有效期',
  },
  {
    icon: FileCheck2,
    primitive: 'Receipt Ledger',
    base: '统一存储执行结果与失败原因',
    product: '付款、退差和策略拒绝全部可审计',
  },
]

const steps = [
  { num: '01', title: '拉它进群，@ 一下', body: '「@PoolMate 拼三箱杨梅，一箱 89」——拼单卡片即刻弹出。' },
  { num: '02', title: '群友各自确认份额', body: '每人一笔委托：金额上限、用途、截止时间，当场锁死。' },
  { num: '03', title: '凑满即生成付款 Intent', body: 'PoolMate 只负责业务映射；PactLedger 校验商户、金额和用途后再交给执行适配器。' },
  { num: '04', title: '自动分账退差', body: '批量优惠按份额退回、运费自动摊销，账单卡推送到群。' },
  { num: '05', title: '每笔都有审计凭证', body: '所有资金流写入统一审计账本；公共演示为 Mock，服务端已实现 Injective Testnet Adapter，待钱包与测试币联调。' },
]

export function PoolMate() {
  return (
    <div className="pm">
      {/* -------------------------------- nav -------------------------------- */}
      <header className="pm-nav">
        <a className="pm-nav-back" href="/">
          <ArrowLeft size={15} /> PactLedger
        </a>
        <span className="pm-nav-tag">REFERENCE APP 02 · MESSAGE-NATIVE</span>
      </header>

      {/* -------------------------------- hero ------------------------------- */}
      <section className="pm-hero">
        <Reveal className="pm-hero-copy">
          <p className="pm-eyebrow">PACTLEDGER REFERENCE APP · 02</p>
          <h1 className="pm-h1">PoolMate<span className="pm-h1-dot">.</span></h1>
          <p className="pm-hero-tag">同一套资金基座，<br /><span>换成群聊里的拼单 Agent。</span></p>
          <p className="pm-hero-sub">
            PoolMate 只新增消息理解、拼单状态和商户 checkout。
            账户、资金策略、审批、执行与回执全部复用 PactLedger。
          </p>
          <div className="pm-hero-cta">
            <TelegramCta className="pm-btn pm-btn-primary">
              在 Telegram 中打开 <ArrowRight size={16} />
            </TelegramCta>
            <a className="pm-btn pm-btn-text" href="#how">
              看业务流程 <ChevronRight size={16} />
            </a>
            <a className="pm-btn pm-btn-text" href="#base-proof">运行基座校验 <ChevronRight size={16} /></a>
          </div>
          <p className="pm-hero-note">Bot 不可用时也可直接进入 Telegram 群；链上状态与 Mock Receipt 仍会如实标注。</p>
          <BotStatusWidget />
        </Reveal>
        <Reveal className="pm-hero-phone" delay={150}>
          <ChatDemo />
        </Reveal>
      </section>

      <section className="pm-base-ribbon" aria-label="PactLedger 复用能力">
        <div>
          <span>Powered by PactLedger</span>
          <strong>这个样例只新增群聊 Skill，资金系统无需重做。</strong>
        </div>
        <p>Account <i /> Policy <i /> Intent <i /> Receipt</p>
      </section>

      <PoolMateTraceLab />

      {/* ------------------------------ trust quote ------------------------------ */}
      <section className="pm-section pm-trust">
        <Reveal>
          <blockquote className="pm-quote">
            基座的价值，不是让 Agent 更会花钱。<br />
            是让 <em>任何 Agent 都只能在规则里花钱。</em>
          </blockquote>
        </Reveal>
        <div className="pm-trust-grid">
          {trustPoints.map((t, i) => (
            <Reveal key={t.title} delay={i * 100}>
              <article className="pm-trust-card">
                <t.icon size={22} />
                <h3>{t.title}</h3>
                <p>{t.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------ base mapping ----------------------------- */}
      <section className="pm-section pm-mapping">
        <Reveal className="pm-section-head">
          <p className="pm-eyebrow pm-eyebrow-center">BASE → PRODUCT</p>
          <h2 className="pm-h2">四个基座原语，<br />翻译成一个全新的业务。</h2>
        </Reveal>
        <div className="pm-mapping-list">
          {baseMappings.map((mapping, i) => (
            <Reveal key={mapping.primitive} delay={i * 80}>
              <article className="pm-mapping-row">
                <span className="pm-mapping-icon"><mapping.icon size={18} /></span>
                <div><small>PACTLEDGER PRIMITIVE</small><strong>{mapping.primitive}</strong></div>
                <p>{mapping.base}</p>
                <ChevronRight size={16} />
                <p className="pm-mapping-product">{mapping.product}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --------------------------------- how --------------------------------- */}
      <section className="pm-section" id="how">
        <Reveal className="pm-section-head">
          <p className="pm-eyebrow pm-eyebrow-center">HOW IT WORKS</p>
          <h2 className="pm-h2">一单拼单的完整一生。</h2>
        </Reveal>
        <div className="pm-steps">
          {steps.map((s, i) => (
            <Reveal key={s.num} delay={i * 80}>
              <article className="pm-step">
                <span className="pm-step-num">{s.num}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ------------------------------- final CTA ------------------------------- */}
      <section className="pm-section pm-final">
        <Reveal>
          <div className="pm-final-card">
            <BadgeCheck size={26} className="pm-final-icon" />
            <h2>第二个参考应用，证明基座不是量化专用。</h2>
            <p>进群发起一单拼单，观察相同的 Account、Policy、Intent 与 Receipt 如何承载完全不同的业务。</p>
            <TelegramCta className="pm-btn pm-btn-primary pm-btn-lg">
              加入 Telegram 群 · 现场拼一单 <ArrowRight size={17} />
            </TelegramCta>
            <div className="pm-final-meta">
              <span><Wallet size={13} /> 独立 Treasury 账户</span>
              <span><ShieldCheck size={13} /> 策略级权限约束</span>
              <span><FileCheck2 size={13} /> Mock / Testnet 真值分离</span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* -------------------------------- footer -------------------------------- */}
      <footer className="pm-footer">
        <p><strong>PoolMate</strong> · Powered by <a href="/">PactLedger</a></p>
        <p className="pm-footer-sub">同一套 Treasury · 同一执行适配器接口 · 零业务侵入 — AdventureX 2026</p>
      </footer>
    </div>
  )
}
