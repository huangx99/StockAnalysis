import { useEffect, useState } from 'react'
import { Loader2, Shield, Users } from 'lucide-react'
import { getUsers, updateUser } from '@/api/real/stockApi'
import type { UserPublic } from '@/types'

export default function UserAdmin() {
  const [users, setUsers] = useState<UserPublic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setUsers(await getUsers())
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const changeRole = async (user: UserPublic, role: 'admin' | 'user') => {
    const updated = await updateUser(user.id, { role })
    setUsers(prev => prev.map(item => item.id === user.id ? updated : item))
  }

  const toggleActive = async (user: UserPublic) => {
    const updated = await updateUser(user.id, { isActive: !user.isActive })
    setUsers(prev => prev.map(item => item.id === user.id ? updated : item))
  }

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--accent-primary)26' }}>
          <Users className="w-6 h-6" style={{ color: 'var(--accent-primary)' }} />
        </div>
        <div>
          <h1 className="font-h1" style={{ color: 'var(--text-primary)' }}>用户管理</h1>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>管理员可调整用户角色和启用状态。</p>
        </div>
      </div>

      {error && <div className="rounded-xl border p-4 mb-4" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
      <div className="rounded-xl border border-border-subtle overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
        {loading ? (
          <div className="h-40 flex items-center justify-center gap-2" style={{ color: 'var(--text-secondary)' }}><Loader2 className="w-4 h-4 animate-spin" />加载用户...</div>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
              <tr>
                <th className="text-left px-4 py-3">用户</th>
                <th className="text-left px-4 py-3">邮箱</th>
                <th className="text-left px-4 py-3">角色</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-left px-4 py-3">最后登录</th>
                <th className="text-right px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-t border-border-subtle" style={{ color: 'var(--text-primary)' }}>
                  <td className="px-4 py-3 font-medium">{user.username}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-secondary)' }}>{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded px-2 py-1" style={{ backgroundColor: user.role === 'admin' ? 'var(--accent-primary)26' : 'var(--bg-elevated)', color: user.role === 'admin' ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                      {user.role === 'admin' && <Shield className="w-3 h-3" />}{user.role === 'admin' ? '管理员' : '普通用户'}
                    </span>
                  </td>
                  <td className="px-4 py-3" style={{ color: user.isActive ? 'var(--success)' : 'var(--danger)' }}>{user.isActive ? '启用' : '禁用'}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--text-muted)' }}>{user.lastLoginAt || '--'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => void changeRole(user, user.role === 'admin' ? 'user' : 'admin')} className="px-2 py-1 rounded border border-border-subtle hover:bg-bg-surface-hover" style={{ color: 'var(--text-secondary)' }}>
                        设为{user.role === 'admin' ? '普通用户' : '管理员'}
                      </button>
                      <button onClick={() => void toggleActive(user)} className="px-2 py-1 rounded border border-border-subtle hover:bg-bg-surface-hover" style={{ color: user.isActive ? 'var(--danger)' : 'var(--success)' }}>
                        {user.isActive ? '禁用' : '启用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
