import { useState, useEffect, useCallback } from 'react'

export interface SettingsState {
  dataSource: string
  refreshInterval: number
  theme: 'dark' | 'light' | 'system'
  colorScheme: 'a-share' | 'global'
  language: 'zh-CN' | 'zh-TW' | 'en'
  dataDensity: 'compact' | 'standard' | 'loose'
  priceAlert: boolean
  announcementPush: boolean
  reportNotification: boolean
  notificationEmail: string
  aiProvider: string
  aiModel: string
  aiBaseUrl: string
  apiKey: string
  analysisDepth: 'quick' | 'standard' | 'deep'
}

const STORAGE_KEY = 'a-stock-ai-settings'

const defaultSettings: SettingsState = {
  dataSource: 'default',
  refreshInterval: 15,
  theme: 'dark',
  colorScheme: 'a-share',
  language: 'zh-CN',
  dataDensity: 'standard',
  priceAlert: true,
  announcementPush: true,
  reportNotification: true,
  notificationEmail: '',
  aiProvider: 'openai',
  aiModel: 'gpt-4o',
  aiBaseUrl: '',
  apiKey: '',
  analysisDepth: 'standard',
}

function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>
      return { ...defaultSettings, ...parsed }
    }
  } catch {
    // ignore parse errors
  }
  return { ...defaultSettings }
}

function saveSettings(settings: SettingsState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore storage errors
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(loadSettings)
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    saveSettings(settings)
    setIsDirty(false)
  }, [settings])

  const update = useCallback(<K extends keyof SettingsState>(
    key: K,
    value: SettingsState[K]
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }, [])

  const reset = useCallback(() => {
    setSettings({ ...defaultSettings })
    setIsDirty(true)
  }, [])

  return { settings, update, reset, isDirty }
}
