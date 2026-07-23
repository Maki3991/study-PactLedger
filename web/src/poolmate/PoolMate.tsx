import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronRight,
  FileCheck2,
  MessagesSquare,
  RotateCcw,
  Send,
  ShieldCheck,
  Timer,
  Wallet,
  X,
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
    title: '权限被 Treasury 策略锁死',
    body: '商户白名单、单笔上限、预算总额全部进入统一策略检查。它能花的每一分钱，都在规则之内——包括它自己，谁也无法例外。',
  },
  {
    icon: Timer,
    title: '超时未凑满，自动全额退回',
    body: '拼单失败不需要任何人出面善后。截止时间一到，份额原路退回，账目当场结清。',
  },
  {
    icon: RotateCcw,
    title: '中途退出，自动重算摊派',
    body: '有人临时跳车？摊派金额实时重算、差价自动补退，不再需要群里的「热心人」人肉对账。',
  },
]

const compare = [
  {
    icon: X,
    name: '群收款工具',
    verdict: '只是一张表格',
    body: '只完成「收钱」上半程。向商户下单、分账、退差的下半程，依然靠人。',
  },
  {
    icon: X,
    name: '电商 Chatbot',
    verdict: '只推荐，不付款',
    body: '没有真实钱包，更谈不上权限约束。聊得再好，最后一步还是你自己。',
  },
  {
    icon: Check,
    name: 'PoolMate',
    verdict: '结算代理，全闭环模型',
    body: '有独立 Treasury 账户与策略边界：收份额 → 商户付款 → 分账退差，每笔都有可审计 Receipt。',
  },
]

const steps = [
  { num: '01', title: '拉它进群，@ 一下', body: '「@PoolMate 拼三箱杨梅，一箱 89」——拼单卡片即刻弹出。' },
  { num: '02', title: '群友各自确认份额', body: '每人一笔委托：金额上限、用途、截止时间，当场锁死。' },
  { num: '03', title: '凑满即向商户付款', body: 'PoolMate 在商户端生成 checkout，Treasury 校验后输出 Action Intent 与 Receipt。' },
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
        <span className="pm-nav-tag">TENANT 02 · MESSAGE-NATIVE</span>
      </header>

      {/* -------------------------------- hero ------------------------------- */}
      <section className="pm-hero">
        <Reveal className="pm-hero-copy">
          <p className="pm-eyebrow">PACTLEDGER TENANT 02 — 群聊拼单结算 AGENT</p>
          <h1 className="pm-h1">PoolMate<span className="pm-h1-dot">.</span></h1>
          <p className="pm-hero-tag">把它拉进群，<span>它替全群管钱。</span></p>
          <p className="pm-hero-sub">
            发起拼单、收齐份额、向商户下单付款、自动分账退差——每一笔都有可审计 Receipt。
            而它自己，一分钱都花不出规则之外。
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

      {/* ------------------------------ trust quote ------------------------------ */}
      <section className="pm-section pm-trust">
        <Reveal>
          <blockquote className="pm-quote">
            群友对它的信任，不来自「它是好人」，<br />
            来自 <em>「它做不了坏事」</em>。
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

      {/* -------------------------------- compare -------------------------------- */}
      <section className="pm-section">
        <Reveal className="pm-section-head">
          <p className="pm-eyebrow pm-eyebrow-center">WHY POOLMATE</p>
          <h2 className="pm-h2">不是表格，不是聊天机器人。<br />是有独立 Treasury 账户的结算主体。</h2>
        </Reveal>
        <div className="pm-compare-grid">
          {compare.map((c, i) => (
            <Reveal key={c.name} delay={i * 100}>
              <article className={`pm-compare-card ${i === compare.length - 1 ? 'is-winner' : ''}`}>
                <span className="pm-compare-mark">{c.icon === Check ? <Check size={15} /> : <X size={15} />}</span>
                <h3>{c.name}</h3>
                <span className="pm-compare-verdict">{c.verdict}</span>
                <p>{c.body}</p>
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
            <h2>现在，看它替群里管一次钱。</h2>
            <p>{TELEGRAM_GROUP_URL ? '进群发起一单拼单，亲眼看看：收份额、向商户付款、分账退差——以及那笔被拒绝的转账。' : '当前页面演示收份额、向商户付款、分账退差和策略拒绝；配置群链接后即可开放现场入口。'}</p>
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
