import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Database, Monitor, Bell, Key, Info, Check, AlertCircle, Loader2 } from 'lucide-react'
import { useSettings } from '@/hooks/useSettings'
import SettingsSection from '@/components/settings/SettingsSection'
import SettingsToggle from '@/components/settings/SettingsToggle'
import SettingsSelect from '@/components/settings/SettingsSelect'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { getAIConfig, saveAIConfig } from '@/api/real/stockApi'
import type { AIConfig } from '@/api/real/stockApi'

const categories = [
  { id: 'datasource', label: '数据源配置', icon: Database },
  { id: 'display', label: '显示偏好', icon: Monitor },
  { id: 'notifications', label: '通知设置', icon: Bell },
  { id: 'ai', label: 'AI 服务配置', icon: Key },
  { id: 'about', label: '关于', icon: Info },
]

export default function Settings() {
  const { settings, update, isDirty } = useSettings()
  const [activeCategory, setActiveCategory] = useState('datasource')
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [aiConfig, setAiConfig] = useState<AIConfig | null>(null)
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  const [aiSaveMsg, setAiSaveMsg] = useState('')
  const handleTestConnection = useCallback(() => {
    setConnectionStatus('testing')
    setTimeout(() => {
      setConnectionStatus('success')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }, 1500)
  }, [])

  // Load AI config from backend when AI tab is active, sync to local settings
  useEffect(() => {
    if (activeCategory !== 'ai') return
    getAIConfig().then((config) => {
      setAiConfig(config)
      if (config.provider) update('aiProvider', config.provider)
      if (config.model) update('aiModel', config.model)
      if (config.baseUrl) update('aiBaseUrl', config.baseUrl)
    }).catch(() => {})
  }, [activeCategory])

  const handleSaveAIConfig = useCallback(async () => {
    setAiSaveStatus('saving')
    setAiSaveMsg('')
    try {
      const result = await saveAIConfig({
        provider: settings.aiProvider,
        apiKey: settings.apiKey,
        model: settings.aiModel,
        baseUrl: settings.aiBaseUrl,
      })
      setAiConfig(result)
      setAiSaveStatus('success')
      setAiSaveMsg('AI 配置已保存')
      setTimeout(() => setAiSaveStatus('idle'), 3000)
    } catch (e) {
      setAiSaveStatus('error')
      setAiSaveMsg(e instanceof Error ? e.message : '保存失败')
    }
  }, [settings.aiProvider, settings.aiModel, settings.apiKey, settings.aiBaseUrl])

  return (
    <div className="p-6 max-w-[1000px] mx-auto">
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-8"
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-h1 text-[28px]" style={{ color: 'var(--text-primary)' }}>
              系统设置
            </h1>
            <p className="font-body mt-1" style={{ color: 'var(--text-secondary)' }}>
              配置数据源、显示偏好与系统参数
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isDirty ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                <span className="font-data-sm" style={{ color: 'var(--warning)' }}>有未保存的更改</span>
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-success" />
                <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>所有更改已自动保存</span>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="flex flex-col lg:grid lg:grid-cols-[200px_1fr] gap-8">
        {/* Category Navigation */}
        <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible sticky top-20">
          {categories.map((cat, index) => {
            const Icon = cat.icon
            const isActive = activeCategory === cat.id
            return (
              <motion.button
                key={cat.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                onClick={() => setActiveCategory(cat.id)}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 whitespace-nowrap shrink-0"
                style={{
                  backgroundColor: isActive ? 'var(--bg-surface-hover)' : 'transparent',
                  color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderLeft: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{cat.label}</span>
              </motion.button>
            )
          })}
        </nav>

        {/* Settings Forms */}
        <div className="space-y-6">
          {activeCategory === 'datasource' && (
            <SettingsSection title="数据源配置" description="配置行情与财务数据来源">
              <SettingsSelect
                label="行情数据接口"
                description="选择股票行情数据的来源"
                value={settings.dataSource}
                options={[
                  { value: 'AKShare', label: 'AKShare (默认)' },
                  { value: 'Tushare', label: 'Tushare' },
                  { value: 'Baostock', label: 'Baostock' },
                  { value: 'custom', label: '自定义' },
                ]}
                onValueChange={(v) => update('dataSource', v)}
              />

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={connectionStatus === 'testing'}
                  className="h-9"
                >
                  {connectionStatus === 'testing' ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : connectionStatus === 'success' ? (
                    <Check className="w-4 h-4 mr-2" />
                  ) : connectionStatus === 'error' ? (
                    <AlertCircle className="w-4 h-4 mr-2" />
                  ) : null}
                  测试连接
                </Button>
                {connectionStatus === 'success' && (
                  <span className="font-data-sm flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                    <Check className="w-4 h-4" /> 连接正常
                  </span>
                )}
              </div>

              <div>
                <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
                  数据刷新间隔
                </label>
                <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                  设置自动刷新数据的时间间隔
                </p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[settings.refreshInterval]}
                    onValueChange={([v]) => update('refreshInterval', v)}
                    min={1}
                    max={60}
                    step={1}
                    className="w-full max-w-[300px]"
                  />
                  <span className="font-data-md shrink-0" style={{ color: 'var(--text-primary)' }}>
                    {settings.refreshInterval} 分钟
                  </span>
                </div>
              </div>
            </SettingsSection>
          )}

          {activeCategory === 'display' && (
            <SettingsSection title="显示偏好" description="自定义界面外观与数据展示方式">
              <SettingsSelect
                label="界面主题"
                value={settings.theme}
                options={[
                  { value: 'dark', label: '深色模式' },
                  { value: 'light', label: '浅色模式' },
                  { value: 'system', label: '跟随系统' },
                ]}
                onValueChange={(v) => update('theme', v as 'dark' | 'light' | 'system')}
              />

              <SettingsSelect
                label="涨跌颜色方案"
                description="A股市场默认红涨绿跌，可根据习惯调整"
                value={settings.colorScheme}
                options={[
                  { value: 'a-share', label: '红涨绿跌 (A股默认)' },
                  { value: 'global', label: '绿涨红跌 (国际)' },
                ]}
                onValueChange={(v) => update('colorScheme', v as 'a-share' | 'global')}
              />

              <SettingsSelect
                label="语言"
                value={settings.language}
                options={[
                  { value: 'zh-CN', label: '简体中文' },
                  { value: 'zh-TW', label: '繁體中文' },
                  { value: 'en', label: 'English' },
                ]}
                onValueChange={(v) => update('language', v as 'zh-CN' | 'zh-TW' | 'en')}
              />

              <SettingsSelect
                label="数据密度"
                value={settings.dataDensity}
                options={[
                  { value: 'compact', label: '紧凑' },
                  { value: 'standard', label: '标准' },
                  { value: 'loose', label: '宽松' },
                ]}
                onValueChange={(v) => update('dataDensity', v as 'compact' | 'standard' | 'loose')}
              />
            </SettingsSection>
          )}

          {activeCategory === 'notifications' && (
            <SettingsSection title="通知设置" description="配置推送通知与提醒规则">
              <SettingsToggle
                label="价格异动提醒"
                description="当股票价格出现异常波动时发送通知"
                checked={settings.priceAlert}
                onCheckedChange={(v) => update('priceAlert', v)}
              />

              <SettingsToggle
                label="公告推送"
                description="收到关注的股票重要公告时推送通知"
                checked={settings.announcementPush}
                onCheckedChange={(v) => update('announcementPush', v)}
              />

              <SettingsToggle
                label="报告生成完成提醒"
                description="AI 研究报告生成完成后通知"
                checked={settings.reportNotification}
                onCheckedChange={(v) => update('reportNotification', v)}
              />

              <div>
                <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
                  通知邮箱
                </label>
                <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                  用于接收系统通知和报告提醒
                </p>
                <Input
                  type="email"
                  placeholder="your@email.com"
                  value={settings.notificationEmail}
                  onChange={(e) => update('notificationEmail', e.target.value)}
                  className="max-w-[480px] h-10"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
            </SettingsSection>
          )}

          {activeCategory === 'ai' && (
            <SettingsSection title="AI 服务配置" description="配置任意 OpenAI 兼容的 AI 服务">
              {/* Status indicator */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: aiConfig?.configured ? 'var(--success)' : 'var(--text-muted)',
                  }}
                />
                <span className="font-data-sm" style={{ color: 'var(--text-secondary)' }}>
                  {aiConfig?.configured
                    ? `AI 服务已配置 (${aiConfig.provider} · ${aiConfig.model}${aiConfig.apiKeyMasked ? ' · ' + aiConfig.apiKeyMasked : ''})`
                    : 'AI 服务未配置 — 不影响行情、财务等基础功能'}
                </span>
              </div>

              <SettingsSelect
                label="AI 服务商"
                description="选择 API 兼容类型"
                value={settings.aiProvider}
                options={[
                  { value: 'openai', label: 'OpenAI' },
                  { value: 'claude', label: 'Claude (Anthropic)' },
                  { value: 'custom', label: '自定义 (OpenAI 兼容)' },
                ]}
                onValueChange={(v) => update('aiProvider', v)}
              />

              <div>
                <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
                  模型名称
                </label>
                <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                  输入完整的模型 ID，或从常用模型中快速选择
                </p>
                <Input
                  type="text"
                  placeholder={settings.aiProvider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                  value={settings.aiModel}
                  onChange={(e) => update('aiModel', e.target.value)}
                  className="max-w-[480px] h-10 mb-2"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
                <div className="flex flex-wrap gap-1.5">
                  {(settings.aiProvider === 'openai'
                    ? ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'o3-mini']
                    : settings.aiProvider === 'claude'
                      ? ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514']
                      : ['qwen-plus', 'deepseek-chat', 'glm-4', 'custom-model']
                  ).map((m) => (
                    <button
                      key={m}
                      onClick={() => update('aiModel', m)}
                      className="px-2 py-1 rounded text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: settings.aiModel === m ? 'var(--accent-primary)' : 'var(--bg-surface-hover)',
                        color: settings.aiModel === m ? '#fff' : 'var(--text-secondary)',
                        border: '1px solid var(--border-subtle)',
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
                  API Key
                </label>
                <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                  {settings.aiProvider === 'claude'
                    ? 'Anthropic API Key (sk-ant-...)'
                    : settings.aiProvider === 'custom'
                      ? '自定义接口的 API Key（可留空）'
                      : 'OpenAI API Key (sk-...)'}
                </p>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={settings.apiKey}
                  onChange={(e) => update('apiKey', e.target.value)}
                  className="max-w-[480px] h-10"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div>
                <label className="font-body font-medium block mb-2" style={{ color: 'var(--text-primary)' }}>
                  API Base URL
                  {settings.aiProvider !== 'custom' && (
                    <span className="font-normal text-[12px] ml-1" style={{ color: 'var(--text-muted)' }}>（可选）</span>
                  )}
                </label>
                <p className="font-body mb-3" style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5 }}>
                  {settings.aiProvider === 'custom'
                    ? 'OpenAI 兼容接口地址，如 https://api.deepseek.com/v1'
                    : settings.aiProvider === 'claude'
                      ? '留空使用默认 Anthropic API，或填入代理地址'
                      : '留空使用默认 OpenAI API，或填入代理地址'}
                </p>
                <Input
                  type="url"
                  placeholder={
                    settings.aiProvider === 'custom'
                      ? 'https://api.deepseek.com/v1'
                      : settings.aiProvider === 'claude'
                        ? 'https://api.anthropic.com'
                        : 'https://api.openai.com/v1'
                  }
                  value={settings.aiBaseUrl}
                  onChange={(e) => update('aiBaseUrl', e.target.value)}
                  className="max-w-[480px] h-10"
                  style={{
                    backgroundColor: 'var(--bg-base)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <SettingsSelect
                label="分析深度"
                description="较低的温度使分析更稳定、可预测"
                value={settings.analysisDepth}
                options={[
                  { value: 'quick', label: '快速' },
                  { value: 'standard', label: '标准' },
                  { value: 'deep', label: '深度' },
                ]}
                onValueChange={(v) => update('analysisDepth', v as 'quick' | 'standard' | 'deep')}
              />

              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleSaveAIConfig}
                  disabled={aiSaveStatus === 'saving'}
                  className="h-9"
                >
                  {aiSaveStatus === 'saving' ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4 mr-2" />
                  )}
                  保存配置
                </Button>
                {aiSaveStatus === 'success' && (
                  <span className="font-data-sm flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                    <Check className="w-4 h-4" /> {aiSaveMsg}
                  </span>
                )}
                {aiSaveStatus === 'error' && (
                  <span className="font-data-sm flex items-center gap-1.5" style={{ color: 'var(--error, #ef4444)' }}>
                    <AlertCircle className="w-4 h-4" /> {aiSaveMsg}
                  </span>
                )}
              </div>
            </SettingsSection>
          )}

          {activeCategory === 'about' && (
            <SettingsSection title="关于" description="应用信息、系统状态与开源致谢">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="font-label mb-1" style={{ color: 'var(--text-muted)' }}>应用名称</div>
                    <div className="font-body font-medium" style={{ color: 'var(--text-primary)' }}>A-Stock AI</div>
                  </div>
                  <div>
                    <div className="font-label mb-1" style={{ color: 'var(--text-muted)' }}>版本号</div>
                    <div className="font-data-md" style={{ color: 'var(--text-primary)' }}>v1.0.0</div>
                  </div>
                  <div>
                    <div className="font-label mb-1" style={{ color: 'var(--text-muted)' }}>构建时间</div>
                    <div className="font-data-sm" style={{ color: 'var(--text-muted)' }}>2026-05-03</div>
                  </div>
                  <div>
                    <div className="font-label mb-1" style={{ color: 'var(--text-muted)' }}>License</div>
                    <div className="font-body" style={{ color: 'var(--accent-primary)' }}>MIT License</div>
                  </div>
                </div>

                <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <h3 className="font-h3 text-base mb-3" style={{ color: 'var(--text-primary)' }}>
                    系统状态
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                      <span className="font-body" style={{ color: 'var(--text-primary)' }}>AKShare 正常运行</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                      <span className="font-body" style={{ color: 'var(--text-primary)' }}>OpenAI API 正常</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>数据缓存</span>
                      <span className="font-data-sm" style={{ color: 'var(--text-primary)' }}>128 MB / 512 MB</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-data-sm" style={{ color: 'var(--text-muted)' }}>最后更新</span>
                      <span className="font-data-sm" style={{ color: 'var(--text-primary)' }}>2026-05-03 15:00:00</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4 mt-4" style={{ borderColor: 'var(--border-subtle)' }}>
                  <h3 className="font-h3 text-base mb-3" style={{ color: 'var(--text-primary)' }}>
                    开源 & 致谢
                  </h3>
                  <p className="font-body mb-3" style={{ color: 'var(--text-secondary)' }}>
                    本项目基于以下开源项目构建：
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {['React', 'Tailwind CSS', 'shadcn/ui', 'Recharts', 'Framer Motion', 'Vite'].map((lib) => (
                      <span
                        key={lib}
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{
                          backgroundColor: 'var(--bg-surface-hover)',
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {lib}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button variant="outline" size="sm">
                    检查更新
                  </Button>
                  <Button variant="ghost" size="sm">
                    清除缓存
                  </Button>
                  <Button variant="ghost" size="sm">
                    导出日志
                  </Button>
                </div>
              </div>
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  )
}
