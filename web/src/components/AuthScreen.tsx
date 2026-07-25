import { useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Database,
  FileCheck2,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react'

interface AuthScreenProps {
  onLogin: (username: string, password: string) => Promise<void>
  onRegister: (username: string, password: string) => Promise<void>
}

type AuthMode = 'login' | 'register'

export function AuthScreen({ onLogin, onRegister }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string>()
  const [pending, setPending] = useState(false)

  const switchMode = (next: AuthMode) => {
    setMode(next)
    setError(undefined)
    setConfirmPassword('')
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (pending) return
    const name = username.trim()
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(name)) {
      setError('用户名需为 3-24 位字母、数字或下划线')
      return
    }
    if (password.length < 6) {
      setError('密码长度至少 6 位')
      return
    }
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setError(undefined)
    setPending(true)
    try {
      if (mode === 'login') await onLogin(name, password)
      else await onRegister(name, password)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请稍后重试')
      setPending(false)
    }
  }

  return (
    <div className="kx-auth">
      <a className="kx-auth-back" href="/"><ArrowLeft size={14} /> 返回 PactLedger</a>
      <section className="kx-auth-story">
        <div className="kx-auth-brand">
          <span className="kx-brand-glyph kx-brand-glyph-pact"><img src="/pactledger-mark.png" alt="" /></span>
          <span><strong>PactLedger</strong><small>KaleidoX · Reference App 01</small></span>
        </div>
        <p className="kx-kicker">REFERENCE APP · 01</p>
        <h1>股票 Agent，<br />有能力，也有边界。</h1>
        <p className="kx-auth-lead">
          PandaAI 负责数据，量化 Agent 负责研究，PactLedger 负责每一笔钱能不能动。
        </p>
        <div className="kx-auth-proof">
          <div><Database size={17} /><span><strong>真实数据证据</strong><small>PandaData / Replay 明确标识</small></span></div>
          <div><ShieldCheck size={17} /><span><strong>统一资金策略</strong><small>越界建议先纠正，再批准</small></span></div>
          <div><FileCheck2 size={17} /><span><strong>可审计回执</strong><small>Mock 与 Injective 状态不混淆</small></span></div>
        </div>
      </section>

      <section className="kx-auth-panel">
        <form className="kx-auth-form" onSubmit={handleSubmit}>
          <div className="kx-auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>登录</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>注册</button>
          </div>

          <div className="kx-auth-title">
            <span>KALEIDOX DEMO</span>
            <h2>{mode === 'login' ? '进入 KaleidoX Demo' : '创建一个演示账户'}</h2>
            <p>{mode === 'login' ? '登录后可查看案例展板，并进入工作区创建任务、亲自批准执行。' : '账户、任务和审计证据将持久化到 PostgreSQL。'}</p>
          </div>

          <label className="kx-auth-field">
            <span><UserRound size={14} /> 用户名</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-24 位字母、数字或下划线" autoComplete="username" autoFocus />
          </label>

          <label className="kx-auth-field">
            <span><LockKeyhole size={14} /> 密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 6 位" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          </label>

          {mode === 'register' && (
            <label className="kx-auth-field">
              <span><LockKeyhole size={14} /> 确认密码</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入密码" autoComplete="new-password" />
            </label>
          )}

          {error && <p className="kx-auth-error" role="alert">{error}</p>}

          <button className="kx-auth-submit" type="submit" disabled={pending}>
            {pending ? <Loader2 size={16} className="spin" /> : null}
            {pending ? '正在处理…' : mode === 'login' ? '进入 KaleidoX Demo' : '注册并进入 Demo'}
            {!pending && <ArrowRight size={16} />}
          </button>

          <p className="kx-auth-footnote">密码经 scrypt 加盐哈希 · 会话与任务存储于 PostgreSQL</p>
        </form>
      </section>
    </div>
  )
}
