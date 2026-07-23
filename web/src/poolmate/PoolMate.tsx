import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  Database,
  FileCheck2,
  Fingerprint,
  MessagesSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  Wallet,
} from 'lucide-react'

const TELEGRAM_GROUP_URL = import.meta.env.VITE_POOLMATE_TELEGRAM_URL?.trim()

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
    lines: ['Treasury 校验通过：商户白名单 ✓ · 预算内 ✓', 'Mock Receipt rcpt_pm_7f3a9cc2 · Injective 接口待接入'],
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
    lines: ['这笔钱我一分都动不了。', 'Treasury Policy 拒绝 · 审计事件 evt_pm_51bde07a'],
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
    body: '付款、退款、退差和拒绝事件使用同一种证据格式，后续可由 Injective Adapter 上链结算。',
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
    primitive: 'Action Intent',
    base: '统一表达高风险资金动作',
    product: 'group_purchase、merchant_pay、refund',
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
  { num: '05', title: '每笔都有审计凭证', body: '所有资金流写入统一审计账本；当前为 Mock Receipt，Injective 适配器接口已预留。' },
]

export function PoolMate() {
  return (
    <div className="pm">
      {/* -------------------------------- nav -------------------------------- */}
      <header className="pm-nav">
        <a className="pm-nav-back" href="/">
          <ArrowLeft size={15} /> PactLedger
        </a>
        <span className="pm-nav-tag">PRODUCT 02 · MESSAGE-NATIVE</span>
      </header>

      {/* -------------------------------- hero ------------------------------- */}
      <section className="pm-hero">
        <Reveal className="pm-hero-copy">
          <p className="pm-eyebrow">PACTLEDGER PRODUCT INSTANCE · 02</p>
          <h1 className="pm-h1">PoolMate<span className="pm-h1-dot">.</span></h1>
          <p className="pm-hero-tag">同一套资金基座，<br /><span>换成群聊里的拼单 Agent。</span></p>
          <p className="pm-hero-sub">
            PoolMate 只新增消息理解、拼单状态和商户 checkout。
            账户、资金策略、审批、执行与回执全部复用 PactLedger。
          </p>
          <div className="pm-hero-cta">
            <TelegramCta className="pm-btn pm-btn-primary">
              {TELEGRAM_GROUP_URL ? '在 Telegram 中打开' : 'Telegram 群待配置'} <ArrowRight size={16} />
            </TelegramCta>
            <a className="pm-btn pm-btn-text" href="#how">
              看看它怎么工作 <ChevronRight size={16} />
            </a>
          </div>
          <p className="pm-hero-note">{TELEGRAM_GROUP_URL ? '评委现场点击进群 · 30 秒体验完整拼单闭环' : '页面演示可直接体验 · 配置 VITE_POOLMATE_TELEGRAM_URL 后开放进群入口'}</p>
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
            <h2>第二个产品，证明基座不是量化专用。</h2>
            <p>{TELEGRAM_GROUP_URL ? '进群发起一单拼单，观察相同的 Account、Policy、Intent 与 Receipt 如何承载完全不同的业务。' : '当前页面演示相同的 Account、Policy、Intent 与 Receipt 如何承载完全不同的业务；配置群链接后即可开放现场入口。'}</p>
            <TelegramCta className="pm-btn pm-btn-primary pm-btn-lg">
              {TELEGRAM_GROUP_URL ? '加入 Telegram 群 · 现场拼一单' : 'Telegram 群入口待配置'} <ArrowRight size={17} />
            </TelegramCta>
            <div className="pm-final-meta">
              <span><Wallet size={13} /> 独立 Treasury 账户</span>
              <span><ShieldCheck size={13} /> 策略级权限约束</span>
              <span><FileCheck2 size={13} /> Injective 适配器已预留</span>
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
