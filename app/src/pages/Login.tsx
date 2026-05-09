import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { BarChart3, Loader2, Lock, Mail, User } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [account, setAccount] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/'
  if (user) return <Navigate to={from} replace />

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') await login(account.trim(), password)
      else await register(username.trim(), email.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : '操作失败'
      setError(message.replace(/^API error \d+:\s*/, ''))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4" style={{ backgroundColor: 'var(--bg-base)' }}>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-24 left-1/4 w-96 h-96 rounded-full blur-3xl opacity-20" style={{ backgroundColor: 'var(--accent-primary)' }} />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full blur-3xl opacity-10" style={{ backgroundColor: 'var(--accent-secondary)' }} />
      </div>

      <div className="relative w-full max-w-[420px] rounded-2xl border border-border-subtle p-6 shadow-2xl" style={{ backgroundColor: 'var(--bg-surface)' }}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--accent-primary)26' }}>
            <BarChart3 className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <h1 className="font-h2" style={{ color: 'var(--text-primary)' }}>A-Stock AI</h1>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>登录后使用个性化分析工作台</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-5 rounded-xl p-1" style={{ backgroundColor: 'var(--bg-base)' }}>
          {(['login', 'register'] as const).map(item => (
            <button
              key={item}
              type="button"
              onClick={() => { setMode(item); setError('') }}
              className="rounded-lg py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: mode === item ? 'var(--bg-surface-hover)' : 'transparent',
                color: mode === item ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {item === 'login' ? '登录' : '注册'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' ? (
            <>
              <Field icon={<User className="w-4 h-4" />} value={username} onChange={setUsername} placeholder="用户名" autoComplete="username" />
              <Field icon={<Mail className="w-4 h-4" />} value={email} onChange={setEmail} placeholder="邮箱" type="email" autoComplete="email" />
            </>
          ) : (
            <Field icon={<User className="w-4 h-4" />} value={account} onChange={setAccount} placeholder="用户名或邮箱" autoComplete="username" />
          )}
          <Field icon={<Lock className="w-4 h-4" />} value={password} onChange={setPassword} placeholder="密码" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'register' && (
            <Field icon={<Lock className="w-4 h-4" />} value={confirmPassword} onChange={setConfirmPassword} placeholder="确认密码" type="password" autoComplete="new-password" />
          )}

          {error && (
            <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', backgroundColor: 'var(--danger)14' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'login' ? '登录系统' : '创建账号'}
          </button>
        </form>

        <p className="mt-5 text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          初始管理员账号可通过环境变量配置，默认值见后端 .env.example；上线前请务必修改密钥和密码。
        </p>
      </div>
    </div>
  )
}

function Field({
  icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  icon: ReactNode
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: string
  autoComplete?: string
}) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-border-subtle px-3 h-11" style={{ backgroundColor: 'var(--bg-base)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        autoComplete={autoComplete}
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: 'var(--text-primary)' }}
        required
      />
    </label>
  )
}
