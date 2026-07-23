import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  CircleDollarSign,
  Database,
  FileCheck2,
  Layers,
  Lock,
  MessagesSquare,
  ReceiptText,
  Route,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'

/* ---------------------------------- utils ---------------------------------- */

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
    <div ref={ref} className={`${className} lp-reveal ${visible ? 'is-visible' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

function randomHash() {
  const hex = () => Math.floor(Math.random() * 16).toString(16)
  const seg = (n: number) => Array.from({ length: n }, hex).join('')
  return `evt_${seg(8)}`
}

function nowTime() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

/* ------------------------------- ledger stream ------------------------------ */

type LedgerEvent = {
  tenant: 'KX' | 'PM'
  primitive: '委托' | '消费' | '分配'
  desc: string
  amount: string
  hash: string
  time: string
}

const EVENT_POOL: Array<Pick<LedgerEvent, 'tenant' | 'primitive' | 'desc' | 'amount'>> = [
  { tenant: 'KX', primitive: '委托', desc: '用户 → Planner · 交易委托', amount: '1,000.00 USDT' },
  { tenant: 'KX', primitive: '消费', desc: 'Strategy → Research · 购买研究报告', amount: '12.50 USDT' },
  { tenant: 'KX', primitive: '消费', desc: 'Risk 审核 · 否决 · 费用不退', amount: '8.00 USDT' },
  { tenant: 'PM', primitive: '委托', desc: '群友确认拼单份额 · 杨梅 ×1 箱', amount: '¥89.00' },
  { tenant: 'PM', primitive: '消费', desc: 'PoolMate → 演示商户 · 组单付款', amount: '¥267.00' },
  { tenant: 'KX', primitive: '消费', desc: 'Backtest 验证服务 · 按次计费', amount: '6.25 USDT' },
  { tenant: 'PM', primitive: '分配', desc: '批量 payout · 退差价 / 摊运费', amount: '¥15.00' },
  { tenant: 'KX', primitive: '分配', desc: 'performance fee 分润 · 优胜链路', amount: '31.80 USDT' },
  { tenant: 'KX', primitive: '消费', desc: 'Research → 外部数据源 · 402 握手', amount: '2.10 USDT' },
  { tenant: 'PM', primitive: '委托', desc: '群友确认份额 · 上限锁死', amount: '¥89.00' },
]

function LedgerStream() {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const [events, setEvents] = useState<LedgerEvent[]>(() =>
    EVENT_POOL.slice(0, 6).map((e) => ({ ...e, hash: randomHash(), time: nowTime() })),
  )
  const cursor = useRef(6)

  useEffect(() => {
    if (reduced) return
    const timer = window.setInterval(() => {
      setEvents((prev) => {
        const next = EVENT_POOL[cursor.current % EVENT_POOL.length]
        cursor.current += 1
        return [{ ...next, hash: randomHash(), time: nowTime() }, ...prev].slice(0, 6)
      })
    }, 2400)
    return () => window.clearInterval(timer)
  }, [reduced])

  return (
    <div className="lp-ledger" aria-label="统一审计账本演示事件流">
      <div className="lp-ledger-chrome">
        <span className="lp-ledger-dots"><i /><i /><i /></span>
        <span className="lp-ledger-title"><Database size={12} /> UNIFIED AUDIT LEDGER · DEMO</span>
        <span className="lp-ledger-live"><i /> MOCK</span>
      </div>
      <div className="lp-ledger-body">
        {events.map((e, i) => (
          <div className="lp-ledger-row" key={`${e.time}-${e.hash}-${i}`}>
            <span className={`lp-tenant lp-tenant-${e.tenant.toLowerCase()}`}>{e.tenant}</span>
            <span className="lp-ledger-primitive">{e.primitive}</span>
            <span className="lp-ledger-desc">{e.desc}</span>
            <span className="lp-ledger-amount">{e.amount}</span>
            <span className="lp-ledger-hash">{e.hash}</span>
            <Check size={13} className="lp-ledger-check" />
          </div>
        ))}
      </div>
      <div className="lp-ledger-foot">
        <span>两个租户映射 · 同一事件模型</span>
        <span className="lp-ledger-mono">ROUTER → POLICY GATE → EXECUTION ADAPTER</span>
      </div>
    </div>
  )
}

/* --------------------------------- sections --------------------------------- */

const problems = [
  {
    num: '01',
    icon: MessagesSquare,
    kicker: '协作 = 喊话',
    title: '协作无法成为经济',
    body: 'Agent 间协作只有消息传递：研究、回测、风控的劳动没有定价、没有结算、没有凭证。干得再多，也只是一段聊天记录。',
  },
  {
    num: '02',
    icon: TrendingUp,
    kicker: '进化 = 改代码',
    title: '没有市场，就没有淘汰',
    body: '干得好的 Agent 没有回报，干得差的没有代价。团队进化靠人熬夜改代码，而不是靠市场机制自然选择。',
  },
  {
    num: '03',
    icon: Wallet,
    kicker: '花钱 = 裸奔',
    title: '没人敢把预算交给 AI',
    body: '没有钱包隔离、没有额度、没有白名单。一次幻觉就是一次真实亏损——这是 Agent 经济最大的拦路虎。',
  },
]

const capabilities = [
  {
    icon: Wallet,
    title: 'Agent Treasury 账户体系',
    body: '子账户开设、预算分配、盈亏归集。每个 Agent 对应独立账户，链上钱包由执行适配器接入。',
  },
  {
    icon: ShieldCheck,
    title: '消费策略引擎',
    body: '单笔上限 / 日限额 / 资产与收款方白名单。超限不是警告，策略引擎会直接拒绝执行。',
  },
  {
    icon: Route,
    title: 'Protocol Router 边界',
    body: '以 canonical checkout 固化协议输入输出；x402 / ACP / AP2 connector 作为后续接入点。',
  },
  {
    icon: ReceiptText,
    title: '计费与审计账本',
    body: 'Agent 间高频微支付计费，provenance 收据哈希写入成果，全事件可回放、可审计。',
  },
  {
    icon: Zap,
    title: 'Injective 执行适配器',
    body: 'Action Intent 与 Receipt 边界已经固化。当前 Demo 使用可复现 Mock，链上团队可替换适配器接入测试网。',
  },
]

const pipeline = ['Action Intent', 'Protocol Router', 'Policy Gate', 'Execution Adapter', '审计账本']

const primitives = [
  {
    name: '委托',
    dir: '人 → Agent',
    kx: '用户下达交易委托：1,000 USDT · 最大亏损 5% · 单仓 ≤ 30%',
    pm: '群友确认拼单份额：金额上限 + 用途 + 截止时间',
    proto: 'ACP / AP2',
  },
  {
    name: '消费',
    dir: 'Agent → 服务方',
    kx: 'Agent 间购买研究 / 回测 / 风控审核，外采付费数据',
    pm: '向演示商户完成组单付款（agent checkout）',
    proto: 'x402 / AP2',
  },
  {
    name: '分配',
    dir: 'Agent → 人',
    kx: '策略盈利后，performance fee 分润到各 Agent',
    pm: '退差价、摊运费，批量 payout 到每个群友',
    proto: '批量 payout',
  },
]

const tenantFlows = {
  kx: ['用户委托', '六 Agent 市场协作', 'Champion–Challenger', 'Treasury 检查', '执行适配器'],
  pm: ['群里 @它', '拼单卡片', '收齐份额', '商户组单付款', '分账退差'],
}

const stats = [
  { value: '3', label: '种资金流 · 委托 / 消费 / 分配' },
  { value: '2', label: '个演示租户 · 场景毫不相干' },
  { value: '1', label: '套事件模型 · 共享 Intent / Policy / Receipt 边界' },
  { value: '100%', label: '结算事件可审计 · Mock / 链上模式显式标注' },
]

export function Landing() {
  return (
    <div className="lp">
      {/* ------------------------------- nav ------------------------------- */}
      <header className="lp-nav">
        <a className="lp-brand" href="#top">
          <span className="lp-brand-mark"><ScrollText size={15} /></span>
          <span className="lp-brand-name">PactLedger</span>
        </a>
        <nav className="lp-nav-links" aria-label="页面导航">
          <a href="#problem">核心问题</a>
          <a href="#base">基座能力</a>
          <a href="#tenants">双租户</a>
          <a href="#demo">Demo</a>
        </nav>
        <div className="lp-nav-right">
          <a className="lp-btn lp-btn-sm lp-btn-primary" href="#demo">进入 Demo</a>
        </div>
      </header>

      <main>
        {/* ------------------------------- hero ------------------------------ */}
        <section className="lp-hero" id="top">
          <div className="lp-hero-inner">
            <Reveal>
              <span className="lp-badge"><i />AGENT FINANCIAL INFRASTRUCTURE</span>
            </Reveal>
            <Reveal delay={70}>
              <h1 className="lp-h1">
                Agent 时代的
                <br />
                <span className="lp-h1-grad">财务系统</span>
              </h1>
            </Reveal>
            <Reveal delay={140}>
              <p className="lp-hero-sub">
                今天的多 Agent 系统，协作靠消息传递，进化靠人改代码。PactLedger 给每个 Agent
                独立的 Treasury 子账户、不可越过的花钱权限、统一的结算与审计账本——
                一套基建，用两个毫不相干的场景验证同一组接入边界。
              </p>
            </Reveal>
            <Reveal delay={210}>
              <div className="lp-hero-cta">
                <a className="lp-btn lp-btn-primary lp-btn-lg" href="/kaleidox.html">进入 KaleidoX 控制台 <ArrowRight size={16} /></a>
                <a className="lp-btn lp-btn-ghost lp-btn-lg" href="/poolmate.html">PoolMate 群聊 Demo <ArrowUpRight size={16} /></a>
              </div>
            </Reveal>
            <Reveal delay={260}>
              <p className="lp-hero-meta">Model Adapter · A2A-ready · Protocol Connectors · Injective Adapter · PandaData</p>
            </Reveal>
          </div>

          <Reveal className="lp-hero-visual" delay={320}>
            <div className="lp-ledger-wrap">
              <LedgerStream />
            </div>
          </Reveal>
        </section>

        {/* ------------------------------ tracks ----------------------------- */}
        <section className="lp-tracks" aria-label="技术接入边界">
          <span>INTEGRATION TARGETS</span>
          <strong>INJECTIVE ADAPTER READY</strong>
          <strong>MODEL ADAPTER</strong>
          <strong>PANDADATA</strong>
          <strong>A2A PROTOCOL</strong>
          <strong>X402 · ACP · AP2</strong>
        </section>

        {/* ------------------------------- stats ----------------------------- */}
        <section className="lp-stats" aria-label="关键数字">
          <Reveal className="lp-stats-row">
            {stats.map((s) => (
              <div className="lp-stat" key={s.label}>
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </Reveal>
        </section>

        {/* ------------------------------ problem ----------------------------- */}
        <section className="lp-section" id="problem">
          <Reveal className="lp-section-head">
            <p className="lp-eyebrow"><span className="lp-sec-num">01</span>THE PROBLEM — 核心问题</p>
            <h2 className="lp-h2">Agent 经济缺的不是智能，<br />是财务系统。</h2>
            <p className="lp-section-sub">
              模型越来越强，但 Agent 之间的钱怎么流动，今天没有答案。三个断层，卡住了整个 Agent 经济。
            </p>
          </Reveal>
          <div className="lp-problem-grid">
            {problems.map((p, idx) => (
              <Reveal key={p.title} delay={idx * 90}>
                <article className="lp-problem-item">
                  <div className="lp-problem-top">
                    <span className="lp-problem-num">{p.num}</span>
                    <p.icon size={20} className="lp-problem-icon" />
                  </div>
                  <span className="lp-problem-kicker">{p.kicker}</span>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ------------------------------- base ------------------------------- */}
        <section className="lp-section" id="base">
          <Reveal className="lp-section-head">
            <p className="lp-eyebrow"><span className="lp-sec-num">02</span>THE BASE — 基座能力</p>
            <h2 className="lp-h2">一套 Treasury，<br />五种基座能力。</h2>
            <p className="lp-section-sub">
              不含任何业务逻辑，可单独部署给任意场景。每一笔钱，都走同一条路。
            </p>
          </Reveal>

          <div className="lp-base-grid">
            <div className="lp-cap-list">
              {capabilities.map((c, idx) => (
                <Reveal key={c.title} delay={idx * 60}>
                  <article className="lp-cap-item">
                    <c.icon size={19} className="lp-cap-icon" />
                    <div>
                      <h3>{c.title}</h3>
                      <p>{c.body}</p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>

            <div className="lp-base-side">
              <Reveal delay={100}>
                <div className="lp-pipeline">
                  <span className="lp-pipeline-label">每一笔钱的必经之路</span>
                  {pipeline.map((step, idx) => (
                    <div className="lp-pipeline-stepwrap" key={step}>
                      <div className="lp-pipeline-step">
                        <span className="lp-pipeline-idx">{String(idx + 1).padStart(2, '0')}</span>
                        <span>{step}</span>
                      </div>
                      {idx < pipeline.length - 1 && <span className="lp-pipeline-arrow" />}
                    </div>
                  ))}
                </div>
              </Reveal>
              <Reveal delay={180}>
                <div className="lp-immutable">
                  <div className="lp-immutable-head">
                    <Lock size={14} />
                    <span>不可修改边界</span>
                    <em>IMMUTABLE</em>
                  </div>
                  <div className="lp-immutable-chips">
                    {['用户总预算', '最大单笔金额', '最大仓位 / 最大亏损', '资产与收款方白名单', '人工确认门槛', 'Treasury 底层权限'].map((c) => (
                      <span key={c}>{c}</span>
                    ))}
                  </div>
                  <p className="lp-immutable-punch">AI 可以进化策略，<strong>永远不能进化自己的权限。</strong></p>
                </div>
              </Reveal>
            </div>
          </div>
        </section>

        {/* ------------------------------ tenants ----------------------------- */}
        <section className="lp-section" id="tenants">
          <Reveal className="lp-section-head">
            <p className="lp-eyebrow"><span className="lp-sec-num">03</span>PROOF — 双租户证明</p>
            <h2 className="lp-h2">一套基建，<br />两个毫不相干的场景。</h2>
            <p className="lp-section-sub">
              两个场景使用同一组 Intent / Policy / Receipt 原语：KaleidoX 已接入运行，PoolMate 展示下一租户的接入映射。
            </p>
          </Reveal>

          <div className="lp-tenant-grid">
            <Reveal>
              <article className="lp-tenant-card lp-tenant-kx">
                <div className="lp-tenant-head">
                  <span className="lp-tenant-tag">TENANT 01</span>
                  <Bot size={19} />
                </div>
                <h3>KaleidoX</h3>
                <p className="lp-tenant-role">AI 交易团队 · 股票量化</p>
                <p className="lp-tenant-why">最严苛的压力测试——AI 花错钱，立刻亏损。</p>
                <ul className="lp-flow">
                  {tenantFlows.kx.map((s) => <li key={s}>{s}</li>)}
                </ul>
                <p className="lp-tenant-note">六个 Agent 对应独立 Treasury 子账户，靠市场机制协作与进化；Injective 钱包与链上执行由适配器接入。</p>
              </article>
            </Reveal>
            <Reveal delay={110}>
              <article className="lp-tenant-card lp-tenant-pm">
                <div className="lp-tenant-head">
                  <span className="lp-tenant-tag">TENANT 02</span>
                  <Users size={19} />
                </div>
                <h3>PoolMate</h3>
                <p className="lp-tenant-role">群聊拼单 · 代购结算 Agent</p>
                <p className="lp-tenant-why">最贴近普通人的场景——AI 替一群人管钱。</p>
                <ul className="lp-flow">
                  {tenantFlows.pm.map((s) => <li key={s}>{s}</li>)}
                </ul>
                <p className="lp-tenant-note">消息原生，权限被 Treasury 策略锁死。群友的信任不来自「它是好人」，来自「它做不了坏事」。</p>
              </article>
            </Reveal>
          </div>

          <Reveal>
            <div className="lp-primitive-wrap">
              <div className="lp-primitive-head">
                <Layers size={14} />
                <span>同构资金流 — 同一组原语，两个场景的实例化</span>
              </div>
              <div className="lp-primitive-table" role="table" aria-label="同构资金流原语对照表">
                <div className="lp-primitive-row lp-primitive-header" role="row">
                  <span role="columnheader">原语</span>
                  <span role="columnheader">KaleidoX · AI 交易团队</span>
                  <span role="columnheader">PoolMate · 群聊拼单</span>
                  <span role="columnheader">协议</span>
                </div>
                {primitives.map((p) => (
                  <div className="lp-primitive-row" role="row" key={p.name}>
                    <span role="cell"><strong>{p.name}</strong><small>{p.dir}</small></span>
                    <span role="cell">{p.kx}</span>
                    <span role="cell">{p.pm}</span>
                    <span role="cell"><code>{p.proto}</code></span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>

          <Reveal>
            <blockquote className="lp-quote">
              上一幕它管的是一支 AI 交易团队，这一幕它在群里替普通人管拼单——
              <strong>同一套财务系统，明天可以管任何 Agent 的钱。</strong>
            </blockquote>
          </Reveal>
        </section>

        {/* ------------------------------- demo ------------------------------- */}
        <section className="lp-section" id="demo">
          <Reveal className="lp-section-head">
            <p className="lp-eyebrow"><span className="lp-sec-num">04</span>LIVE DEMO — 两个入口</p>
            <h2 className="lp-h2">两个入口，同一套基座模型。</h2>
            <p className="lp-section-sub">KaleidoX 已连接服务器任务与审计账本；PoolMate 用交互演示说明下一租户如何复用同一组资金原语。</p>
          </Reveal>

          <div className="lp-demo-grid">
            <Reveal>
              <a className="lp-demo-card lp-demo-kx" href="/kaleidox.html">
                <div className="lp-demo-top">
                  <span className="lp-tenant-tag">WEB CONSOLE · TENANT 01</span>
                  <span className="lp-demo-arrow-circle"><ArrowUpRight size={18} /></span>
                </div>
                <h3>KaleidoX 控制台</h3>
                <p className="lp-demo-desc">一笔失败交易，如何让一支「自己管钱」的 AI 团队进化出下一代策略。</p>
                <ul>
                  <li><CircleDollarSign size={15} /> 六个 Agent 对应独立 Treasury 子账户</li>
                  <li><TrendingUp size={15} /> 策略 V1 → V2 进化全程，风控否决实录</li>
                  <li><FileCheck2 size={15} /> 当前使用 Mock Receipt，Injective 测试网适配器接口已预留</li>
                </ul>
                <span className="lp-demo-cta">进入控制台 <ArrowRight size={15} /></span>
              </a>
            </Reveal>
            <Reveal delay={110}>
              <a className="lp-demo-card lp-demo-pm" href="/poolmate.html">
                <div className="lp-demo-top">
                  <span className="lp-tenant-tag">MESSAGE-NATIVE · TENANT 02</span>
                  <span className="lp-demo-arrow-circle"><ArrowUpRight size={18} /></span>
                </div>
                <h3>PoolMate 群聊拼单</h3>
                <p className="lp-demo-desc">把它拉进群，它替全群管钱——而它自己一分钱都花不出规则之外。</p>
                <ul>
                  <li><MessagesSquare size={15} /> 消息原生拼单卡片，零安装零学习成本</li>
                  <li><Wallet size={15} /> 收份额 → 商户付款 → 分账退差，全闭环</li>
                  <li><ShieldCheck size={15} /> 彩蛋：骗它转账？Treasury 策略当场拒绝</li>
                </ul>
                <span className="lp-demo-cta">了解 PoolMate · 进群体验 <ArrowRight size={15} /></span>
              </a>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------- final ------------------------------- */}
        <section className="lp-final">
          <Reveal>
            <p className="lp-eyebrow lp-eyebrow-center">ONE TREASURY · EVERY AGENT</p>
            <h2 className="lp-final-h">
              一套财务系统，上午管一支 AI 交易团队，<br />
              下午在群里替普通人管钱。
            </h2>
            <div className="lp-hero-cta lp-final-cta">
              <a className="lp-btn lp-btn-primary lp-btn-lg" href="/kaleidox.html">进入 KaleidoX 控制台 <ArrowRight size={16} /></a>
              <a className="lp-btn lp-btn-ghost lp-btn-lg" href="/poolmate.html">PoolMate 群聊 Demo <ArrowUpRight size={16} /></a>
            </div>
          </Reveal>
        </section>
      </main>

      {/* ------------------------------ footer ------------------------------ */}
      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <span className="lp-brand-mark"><ScrollText size={14} /></span>
          <span className="lp-brand-name">PactLedger</span>
        </div>
        <p className="lp-footer-line">Model Adapter · A2A-ready · Protocol Connectors · Injective Adapter · PandaData / Skills</p>
        <p className="lp-footer-sub">AdventureX 2026 Hackathon — Tracks: Injective / PandaAI / Photon</p>
      </footer>
    </div>
  )
}
