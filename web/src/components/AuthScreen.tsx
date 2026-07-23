import { useState, type FormEvent } from 'react'
import { BrainCircuit, Command, Loader2, LockKeyhole, ShieldCheck, UserRound, Workflow } from 'lucide-react'

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
    <div className="auth-screen">
      <section className="auth-hero">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Command size={18} /></div>
          <div><strong>KaleidoX</strong><span>Strategy OS</span></div>
        </div>
        <h1>可自主进化的<br />Multi-Agent 交易操作系统</h1>
        <p>研究、策略、回测、风控、执行、进化 —— 六个 Agent 在不可变的 Capital Firewall 约束下协作，让策略在竞争中持续进化。</p>
        <ul className="auth-features">
          <li><Workflow size={16} /><span>A2A 编排管线，每一步透明可审计</span></li>
          <li><ShieldCheck size={16} /><span>Capital Firewall 风险边界，越界即熔断</span></li>
          <li><BrainCircuit size={16} /><span>Champion–Challenger 策略进化闭环</span></li>
        </ul>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={handleSubmit}>
          <div className="auth-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'login'}
              className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
              onClick={() => switchMode('login')}>登录</button>
            <button type="button" role="tab" aria-selected={mode === 'register'}
              className={mode === 'register' ? 'auth-tab active' : 'auth-tab'}
              onClick={() => switchMode('register')}>注册</button>
          </div>

          <h2>{mode === 'login' ? '欢迎回来' : '创建账户'}</h2>
          <p className="auth-subtitle">{mode === 'login' ? '登录以进入你的策略工作台' : '注册一个本地演示账户，数据仅存储在本机'}</p>

          <label className="auth-field">
            <span><UserRound size={14} /> 用户名</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="3-24 位字母、数字或下划线"
              autoComplete="username"
              autoFocus
            />
          </label>

          <label className="auth-field">
            <span><LockKeyhole size={14} /> 密码</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {mode === 'register' && (
            <label className="auth-field">
              <span><LockKeyhole size={14} /> 确认密码</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入密码"
                autoComplete="new-password"
              />
            </label>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button className="auth-submit" type="submit" disabled={pending}>
            {pending && <Loader2 size={16} className="spin" />}
            {pending ? '正在处理…' : mode === 'login' ? '登录' : '注册并登录'}
          </button>

          <p className="auth-footnote">本地演示环境 · 密码经 scrypt 加盐哈希存储于本地 SQLite</p>
        </form>
      </section>
    </div>
  )
}
