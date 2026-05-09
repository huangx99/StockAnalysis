import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getAuthToken, getCurrentUser, login as apiLogin, register as apiRegister, setAuthToken } from '@/api/real/stockApi'
import type { UserPublic } from '@/types'

interface AuthContextValue {
  user: UserPublic | null
  loading: boolean
  isAdmin: boolean
  login: (account: string, password: string) => Promise<void>
  register: (username: string, email: string, password: string) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshUser = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const current = await getCurrentUser()
      setUser(current)
    } catch {
      setAuthToken('')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const login = useCallback(async (account: string, password: string) => {
    const res = await apiLogin(account, password)
    setAuthToken(res.accessToken)
    setUser(res.user)
  }, [])

  const register = useCallback(async (username: string, email: string, password: string) => {
    const res = await apiRegister(username, email, password)
    setAuthToken(res.accessToken)
    setUser(res.user)
  }, [])

  const logout = useCallback(() => {
    setAuthToken('')
    setUser(null)
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    isAdmin: user?.role === 'admin',
    login,
    register,
    logout,
    refreshUser,
  }), [user, loading, login, register, logout, refreshUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
