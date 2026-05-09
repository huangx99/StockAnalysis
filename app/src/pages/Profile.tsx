import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Mail, Save, ShieldCheck, User } from 'lucide-react'
import { changeCurrentUserPassword, updateCurrentUserProfile } from '@/api/real/stockApi'
import { useAuth } from '@/contexts/AuthContext'

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message
  return fallback
}

export default function Profile() {
  const { user, refreshUser } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    setEmail(user?.email || '')
  }, [user])

  const saveProfile = async () => {
    if (!email.trim()) {
      setProfileError('邮箱不能为空')
      return
    }
    setProfileSaving(true)
    setProfileError('')
    setProfileMessage('')
    try {
      await updateCurrentUserProfile({ email: email.trim() })
      await refreshUser()
      setProfileMessage('个人资料已更新')
    } catch (err) {
      setProfileError(errorMessage(err, '个人资料更新失败'))
    } finally {
      setProfileSaving(false)
    }
  }

  const savePassword = async () => {
    if (!currentPassword || !newPassword) {
      setPasswordError('请填写当前密码和新密码')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('新密码至少 8 位')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    setPasswordSaving(true)
    setPasswordError('')
    setPasswordMessage('')
    try {
      await changeCurrentUserPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('密码已更新，下次登录请使用新密码')
    } catch (err) {
      setPasswordError(errorMessage(err, '密码更新失败'))
    } finally {
      setPasswordSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-[960px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--accent-primary)26' }}>
          <User className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>个人中心</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>编辑登录邮箱和重置密码，用户名注册后不可修改。</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-border-subtle p-5" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}>资料设置</h2>
          </div>
          <div className="space-y-4">
            <div className="block">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>用户名</span>
              <div
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2"
                style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-elevated)' }}
              >
                {user?.username || '--'}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>用户名用于登录标识，注册后不可修改，避免与其他用户混淆。</p>
            </div>
            <label className="block">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>邮箱</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-transparent px-3 py-2 outline-none focus:border-accent-primary"
                style={{ color: 'var(--text-primary)' }}
                autoComplete="email"
              />
            </label>
            <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              当前角色：{user?.role === 'admin' ? '管理员' : '普通用户'} · 注册时间：{user?.createdAt || '--'}
            </div>
            {profileError && <div className="text-sm" style={{ color: 'var(--danger)' }}>{profileError}</div>}
            {profileMessage && <div className="text-sm" style={{ color: 'var(--success)' }}>{profileMessage}</div>}
            <button
              onClick={() => void saveProfile()}
              disabled={profileSaving}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-70"
              style={{ backgroundColor: 'var(--accent-primary)' }}
            >
              {profileSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              保存资料
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-border-subtle p-5" style={{ backgroundColor: 'var(--bg-surface)' }}>
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5" style={{ color: 'var(--warning)' }} />
            <h2 className="font-h3" style={{ color: 'var(--text-primary)' }}>重置密码</h2>
          </div>
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>当前密码</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-transparent px-3 py-2 outline-none focus:border-accent-primary"
                style={{ color: 'var(--text-primary)' }}
                autoComplete="current-password"
              />
            </label>
            <label className="block">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>新密码</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-transparent px-3 py-2 outline-none focus:border-accent-primary"
                style={{ color: 'var(--text-primary)' }}
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>确认新密码</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-border-subtle bg-transparent px-3 py-2 outline-none focus:border-accent-primary"
                style={{ color: 'var(--text-primary)' }}
                autoComplete="new-password"
              />
            </label>
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>修改密码需要验证当前密码，新密码至少 8 位。保存后当前登录状态保持不变。</span>
            </div>
            {passwordError && <div className="text-sm" style={{ color: 'var(--danger)' }}>{passwordError}</div>}
            {passwordMessage && <div className="text-sm" style={{ color: 'var(--success)' }}>{passwordMessage}</div>}
            <button
              onClick={() => void savePassword()}
              disabled={passwordSaving}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-70"
              style={{ backgroundColor: 'var(--warning)' }}
            >
              {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              更新密码
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
