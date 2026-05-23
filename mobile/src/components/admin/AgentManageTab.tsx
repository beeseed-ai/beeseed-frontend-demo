import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react'
import { cn, SkillIcon, useBeeSeedContext } from '@beeseed/beeseed-sdk'

type ModelTierName = 'fast' | 'thinking' | 'pro'
interface ModelTierConfig {
  provider: string
  model: string
  thinking: boolean
}

interface ModelTierSettings {
  default_tier: ModelTierName
  tiers: Record<ModelTierName, ModelTierConfig>
}

interface AgentTemplateInfo {
  id: string
  name: string
  role: string
  version?: string
  is_active?: boolean
  provider: string
  model: string
  model_tier?: ModelTierName | ''
  model_tiers?: ModelTierSettings
  avatar_preset?: string
  avatar_url?: string
  tools?: string[]
  skills?: string[]
  source?: string
  usage_count?: number
  removable?: boolean
  blocked_reason?: string
}

interface IdentityData {
  name: string
  personality: string
  content: string
}

interface AgentConfig {
  role?: string
  template_version?: string
  provider?: string
  model?: string
  model_tier?: ModelTierName | ''
  model_tiers?: ModelTierSettings
  temperature?: number
  thinking?: boolean
  tools?: string[]
  skills?: string[]
  avatar_preset?: string
  [key: string]: unknown
}

interface SkillSummary {
  name: string
  display_name?: string
  icon_url?: string
  category?: string
  description?: string
  version?: string
  triggers?: string[]
}

interface ProviderOption {
  id: string
  label?: string
}

interface ModelOption {
  id: string
  label?: string
  provider: string
}

interface AgentTemplateSyncResult {
  agent_id: string
  channels_matched: number
  channels_updated: number
  skills_added: number
  tools_added: number
}

const FALLBACK_TEMPERATURE = 0.7
const MODEL_TIER_OPTIONS: { value: ModelTierName; label: string; description: string }[] = [
  { value: 'fast', label: '快速', description: '适合日常轻量任务' },
  { value: 'thinking', label: '思考', description: '适合复杂推理和多步骤任务' },
  { value: 'pro', label: '专业', description: '适合高质量研究和深度分析' },
]
const AVATAR_PRESETS = [
  'bot-amber',
  'bot-blue',
  'bot-emerald',
  'bot-rose',
  'bot-violet',
  'owl',
  'rocket',
  'star',
  'leaf',
  'lightning',
]
const TOOL_OPTIONS = [
  'http_request',
  'ask_user',
  'agent_todo',
  'knowledge_search',
  'web_search',
  'fal_generate',
  'channel_members',
  'task_management',
  'storage_list',
  'storage_info',
  'storage_read',
  'storage_write',
  'storage_delete',
  'storage_presign_download',
]
const TOOL_LABELS: Record<string, string> = {
  http_request: 'HTTP 请求',
  ask_user: '询问用户',
  agent_todo: 'Agent 待办',
  knowledge_search: '知识库搜索',
  web_search: '网页/社交搜索',
  fal_generate: '媒体生成',
  channel_members: '频道成员',
  task_management: '任务管理',
  storage_list: '云存储列表',
  storage_info: '文件信息',
  storage_read: '读取文件',
  storage_write: '写入文件',
  storage_delete: '删除文件',
  storage_presign_download: '下载链接',
}
const SKILL_LABELS: Record<string, string> = {
  'ai-search-api': 'AI 聚合搜索',
  'equity-7d-collection': '7维度信息采集',
  'equity-cross-validation': '6种交叉验证',
  'equity-research-brief': '研究简报生成',
  'med-lit-review': '医学文献阅读助手',
  'med-paper-writer': '医学论文写作助手',
  'med-research-writer': 'SCI 医学写作顾问',
  'med-study-design': '医学研究方案设计助手',
  'med-topic-finder': '医学科研选题助手',
  'media-generate': 'AI 图片/视频/音频生成',
  'moxibustion-advisor': '辨证施灸顾问',
  'moxibustion-classics': '艾灸古籍知识库',
  pdf: 'PDF 处理助手',
  pptx: 'PPTX 演示文稿',
  'volcengine-search': '火山引擎事实核查搜索',
  xlsx: 'Excel 表格助手',
  'yinyuan-skills': '月老·姻缘测算',
}

function labelOrFallback(value: string | undefined, fallback: string) {
  const text = value?.trim()
  return text || fallback
}

function toolDisplayName(tool: string) {
  return TOOL_LABELS[tool] ?? tool
}

function skillDisplayName(skill: string, catalog: SkillSummary[]) {
  return catalog.find((item) => item.name === skill)?.display_name || SKILL_LABELS[skill] || skill
}

function formatAgentVersion(value: string | undefined) {
  const text = value?.trim()
  if (!text) return '未标注'
  return text.toLowerCase().startsWith('v') ? text : `v${text}`
}

function toggleItem(items: string[], item: string) {
  return items.includes(item) ? items.filter((value) => value !== item) : [...items, item]
}

function normalizeModelTier(value: unknown): ModelTierName | '' {
  return value === 'fast' || value === 'thinking' || value === 'pro' ? value : ''
}

function modelTierLabel(value: unknown) {
  const tier = normalizeModelTier(value)
  if (!tier) return '继承默认等级'
  return MODEL_TIER_OPTIONS.find((option) => option.value === tier)?.label ?? tier
}

function emptyModelTierSettings(provider = '', model = ''): ModelTierSettings {
  return {
    default_tier: 'fast',
    tiers: {
      fast: { provider, model, thinking: false },
      thinking: { provider, model, thinking: true },
      pro: { provider, model, thinking: true },
    },
  }
}

function normalizeModelTierSettings(value: Partial<ModelTierSettings> | null | undefined, provider = '', model = ''): ModelTierSettings {
  const fallback = emptyModelTierSettings(provider, model)
  const defaultTier = normalizeModelTier(value?.default_tier) || fallback.default_tier
  return {
    default_tier: defaultTier,
    tiers: {
      fast: { ...fallback.tiers.fast, ...(value?.tiers?.fast ?? {}) },
      thinking: { ...fallback.tiers.thinking, ...(value?.tiers?.thinking ?? {}) },
      pro: { ...fallback.tiers.pro, ...(value?.tiers?.pro ?? {}) },
    },
  }
}

function avatarPresetUrl(preset: string | undefined) {
  return preset ? `/avatars/agents/${preset}.svg` : ''
}

function configAvatarPreset(template: AgentTemplateInfo, config: AgentConfig | null) {
  return config && Object.prototype.hasOwnProperty.call(config, 'avatar_preset')
    ? config.avatar_preset || ''
    : template.avatar_preset || ''
}

function templateAvatar(template: AgentTemplateInfo, config: AgentConfig | null) {
  const preset = configAvatarPreset(template, config)
  if (!config && template.avatar_url) return template.avatar_url
  return avatarPresetUrl(preset)
}

export function AgentManageTab() {
  const { api } = useBeeSeedContext()
  const [templates, setTemplates] = useState<AgentTemplateInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [identity, setIdentity] = useState<IdentityData | null>(null)
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [availableTemplates, setAvailableTemplates] = useState<AgentTemplateInfo[]>([])
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([])
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [skillModalOpen, setSkillModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AgentTemplateInfo | null>(null)
  const [availableQuery, setAvailableQuery] = useState('')
  const [skillQuery, setSkillQuery] = useState('')
  const [templateActionError, setTemplateActionError] = useState('')
  const [templateActionLoading, setTemplateActionLoading] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [syncingChannels, setSyncingChannels] = useState(false)
  const [syncResult, setSyncResult] = useState<AgentTemplateSyncResult | null>(null)
  const [syncError, setSyncError] = useState('')
  const loadSeqRef = useRef(0)
  const detailSeqRef = useRef(0)

  const loadTemplates = useCallback(async () => {
    const loadSeq = loadSeqRef.current + 1
    loadSeqRef.current = loadSeq
    setLoading(true)

    try {
      const data = await api.get('admin/agent-templates').json<AgentTemplateInfo[]>()
      if (loadSeqRef.current !== loadSeq) return

      const nextTemplates = data ?? []
      setTemplates(nextTemplates)
      setSelectedId((current) => (
        current && nextTemplates.some((template) => template.id === current)
          ? current
          : nextTemplates[0]?.id ?? null
      ))
    } catch {
      if (loadSeqRef.current === loadSeq) {
        setTemplates([])
        setSelectedId(null)
      }
    } finally {
      if (loadSeqRef.current === loadSeq) {
        setLoading(false)
      }
    }
  }, [api])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const loadAvailableTemplates = useCallback(async () => {
    const data = await api.get('admin/agent-templates/available').json<AgentTemplateInfo[]>()
    setAvailableTemplates((data ?? []).filter((template) => template.is_active !== false))
  }, [api])

  useEffect(() => {
    let active = true
    Promise.all([
      api.get('providers').json<ProviderOption[]>().catch(() => []),
      api.get('models').json<ModelOption[]>().catch(() => []),
    ]).then(([providerData, modelData]) => {
      if (!active) return
      setProviders([...providerData].sort((a, b) => a.id.localeCompare(b.id)))
      setModels([...modelData].sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id)))
    })
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    let active = true
    api.get('admin/skills').json<SkillSummary[]>()
      .then((data) => {
        if (active) setAvailableSkills(data ?? [])
      })
      .catch(() => {
        if (active) setAvailableSkills([])
      })
    return () => {
      active = false
    }
  }, [api])

  useEffect(() => {
    if (!selectedId) {
      setIdentity(null)
      setAgentConfig(null)
      return
    }

    const detailSeq = detailSeqRef.current + 1
    detailSeqRef.current = detailSeq
    setIdentity(null)
    setAgentConfig(null)
    setDirty(false)
    setSaved(false)
    setSaveError('')
    setSyncResult(null)
    setSyncError('')

    Promise.all([
      api.get(`admin/agent-templates/${selectedId}/identity`).json<IdentityData>().catch(() => null),
      api.get(`admin/agent-templates/${selectedId}/config`).json<AgentConfig>().catch(() => null),
    ]).then(([id, cfg]) => {
      if (detailSeqRef.current !== detailSeq) return
      setIdentity(id)
      setAgentConfig(cfg ? {
        ...cfg,
        model_tier: normalizeModelTier(cfg.model_tier),
        model_tiers: normalizeModelTierSettings(cfg.model_tiers, cfg.provider, cfg.model),
        tools: cfg.tools ?? [],
        skills: cfg.skills ?? [],
      } : null)
    })
  }, [api, selectedId])

  const updateIdentity = (patch: Partial<IdentityData>) => {
    setIdentity((current) => ({ name: '', personality: '', content: '', ...(current ?? {}), ...patch }))
    setDirty(true)
    setSaved(false)
    setSaveError('')
    setSyncResult(null)
    setSyncError('')
  }

  const updateConfig = (patch: Partial<AgentConfig>) => {
    setAgentConfig((current) => ({ ...(current ?? {}), ...patch }))
    setDirty(true)
    setSaved(false)
    setSaveError('')
    setSyncResult(null)
    setSyncError('')
  }

  const updateModelTierSettings = (patch: Partial<ModelTierSettings>) => {
    setAgentConfig((current) => {
      const provider = current?.provider ?? selectedTemplate?.provider ?? ''
      const model = current?.model ?? selectedTemplate?.model ?? ''
      const currentSettings = normalizeModelTierSettings(current?.model_tiers, provider, model)
      return { ...(current ?? {}), model_tiers: { ...currentSettings, ...patch } }
    })
    setDirty(true)
    setSaved(false)
    setSaveError('')
    setSyncResult(null)
    setSyncError('')
  }

  const updateModelTierConfig = (tier: ModelTierName, patch: Partial<ModelTierSettings['tiers'][ModelTierName]>) => {
    setAgentConfig((current) => {
      const provider = current?.provider ?? selectedTemplate?.provider ?? ''
      const model = current?.model ?? selectedTemplate?.model ?? ''
      const currentSettings = normalizeModelTierSettings(current?.model_tiers, provider, model)
      return {
        ...(current ?? {}),
        model_tiers: {
          ...currentSettings,
          tiers: {
            ...currentSettings.tiers,
            [tier]: { ...currentSettings.tiers[tier], ...patch },
          },
        },
      }
    })
    setDirty(true)
    setSaved(false)
    setSaveError('')
  }

  const updateTierProvider = (tier: ModelTierName, provider: string) => {
    const currentSettings = normalizeModelTierSettings(agentConfig?.model_tiers, agentConfig?.provider, agentConfig?.model)
    const nextModels = models.filter((item) => item.provider === provider)
    const currentModel = currentSettings.tiers[tier].model
    const nextModel = nextModels.some((item) => item.id === currentModel) ? currentModel : nextModels[0]?.id ?? currentModel
    updateModelTierConfig(tier, { provider, model: nextModel })
  }

  const saveTemplate = async () => {
    if (!selectedId || !identity || !agentConfig || !dirty) return
    setSaving(true)
    setSaved(false)
    setSaveError('')
    try {
      const identityPayload = {
        name: identity.name.trim(),
        personality: identity.personality.trim(),
        content: identity.content,
      }
      const configPayload = {
        ...agentConfig,
        model_tier: '',
        role: selectedId,
        identity: {
          ...((agentConfig.identity as Record<string, unknown> | undefined) ?? {}),
          ...identityPayload,
        },
      }
      await api.put(`admin/agent-templates/${selectedId}/config`, { json: configPayload })
      await api.put(`admin/agent-templates/${selectedId}/identity`, { json: identityPayload })
      setTemplates((current) => current.map((template) => (
        template.id === selectedId
          ? {
              ...template,
              name: identityPayload.name || template.name,
              role: String(configPayload.role || template.role),
              provider: String(configPayload.provider || template.provider),
              model: String(configPayload.model || template.model),
              model_tier: '',
              model_tiers: configPayload.model_tiers ?? template.model_tiers,
              tools: configPayload.tools ?? template.tools,
              skills: configPayload.skills ?? template.skills,
              avatar_preset: configPayload.avatar_preset || '',
              avatar_url: avatarPresetUrl(configPayload.avatar_preset),
            }
          : template
      )))
      setDirty(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 1800)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const syncTemplateChannels = async () => {
    if (!selectedId || dirty || syncingChannels) return
    setSyncingChannels(true)
    setSyncError('')
    setSyncResult(null)
    try {
      const result = await api.post(`admin/agent-templates/${selectedId}/sync-channels`).json<AgentTemplateSyncResult>()
      setSyncResult(result)
      void loadTemplates()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : '同步失败')
    } finally {
      setSyncingChannels(false)
    }
  }

  const openAddModal = async () => {
    setTemplateActionError('')
    setAvailableQuery('')
    setAddModalOpen(true)
    try {
      await loadAvailableTemplates()
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : '加载可添加模板失败')
      setAvailableTemplates([])
    }
  }

  const addTemplate = async (templateId: string) => {
    setTemplateActionLoading(templateId)
    setTemplateActionError('')
    try {
      const template = await api.post(`admin/agent-templates/${templateId}/enable`).json<AgentTemplateInfo>()
      setTemplates((current) => [...current.filter((item) => item.id !== template.id), template].sort((a, b) => a.id.localeCompare(b.id)))
      setSelectedId(template.id)
      setAddModalOpen(false)
      setAvailableTemplates((current) => current.filter((item) => item.id !== template.id))
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : '添加模板失败')
    } finally {
      setTemplateActionLoading('')
    }
  }

  const openSkillModal = async () => {
    setSkillQuery('')
    setSkillModalOpen(true)
    setTemplateActionError('')
    try {
      const data = await api.get('admin/skills').json<SkillSummary[]>()
      setAvailableSkills(data ?? [])
    } catch (err) {
      setAvailableSkills([])
      setTemplateActionError(err instanceof Error ? err.message : '加载技能失败')
    }
  }

  const addSkill = (skillName: string) => {
    if (!skillName || skills.includes(skillName)) return
    updateConfig({ skills: [...skills, skillName] })
  }

  const removeSkill = (skillName: string) => {
    updateConfig({ skills: skills.filter((skill) => skill !== skillName) })
  }

  const deleteTemplate = async (template: AgentTemplateInfo) => {
    if (template.removable === false) return
    setTemplateActionLoading(template.id)
    setTemplateActionError('')
    try {
      await api.delete(`admin/agent-templates/${template.id}`)
      setTemplates((current) => {
        const next = current.filter((item) => item.id !== template.id)
        setSelectedId((selected) => selected === template.id ? next[0]?.id ?? null : selected)
        return next
      })
      setIdentity(null)
      setAgentConfig(null)
      setDirty(false)
      setDeleteTarget(null)
    } catch (err) {
      setTemplateActionError(err instanceof Error ? err.message : '删除模板失败')
    } finally {
      setTemplateActionLoading('')
    }
  }

  const selectedTemplate = selectedId ? templates.find((template) => template.id === selectedId) ?? null : null
  const displayName = labelOrFallback(identity?.name || selectedTemplate?.name, selectedTemplate?.id || 'Agent')
  const role = labelOrFallback(agentConfig?.role || selectedTemplate?.role, selectedTemplate?.id || 'agent')
  const modelTierSettings = normalizeModelTierSettings(agentConfig?.model_tiers ?? selectedTemplate?.model_tiers, agentConfig?.provider ?? selectedTemplate?.provider, agentConfig?.model ?? selectedTemplate?.model)
  const temperature = typeof agentConfig?.temperature === 'number' ? agentConfig.temperature : FALLBACK_TEMPERATURE
  const tools = agentConfig?.tools ?? selectedTemplate?.tools ?? []
  const skills = agentConfig?.skills ?? selectedTemplate?.skills ?? []
  const extraTools = tools.filter((tool) => !TOOL_OPTIONS.includes(tool))
  const selectedAvatarPreset = selectedTemplate ? configAvatarPreset(selectedTemplate, agentConfig) : ''
  const avatarUrl = selectedTemplate ? templateAvatar(selectedTemplate, agentConfig) : ''
  const filteredAvailableTemplates = availableTemplates.filter((template) => template.is_active !== false).filter((template) => {
    const query = availableQuery.trim().toLowerCase()
    if (!query) return true
    return [template.id, template.name, template.role, template.version, template.model, template.provider]
      .some((value) => (value ?? '').toLowerCase().includes(query))
  })
  const filteredSkills = availableSkills.filter((skill) => {
    const query = skillQuery.trim().toLowerCase()
    if (!query) return true
    return [skill.name, skill.display_name, skill.category, skill.description, ...(skill.triggers ?? [])]
      .some((value) => (value ?? '').toLowerCase().includes(query))
  })

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-[#999]">加载中...</div>
  }

  return (
    <div className="flex h-full overflow-hidden bg-[#fafafa]">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 p-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#1a1a1a]">Agent 管理</h1>
              <p className="mt-1 text-sm text-muted-foreground">{templates.length} 个 Agent 模板</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h3 className="text-sm font-semibold text-[#1a1a1a]">Agent 模板</h3>
                <button
                  type="button"
                  onClick={() => void openAddModal()}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-[#181d26] transition-colors hover:bg-muted"
                  title="添加 Agent 模板"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              {templateActionError && (
                <div className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {templateActionError}
                </div>
              )}
              <div className="max-h-[640px] space-y-2 overflow-y-auto p-3">
                {templates.length === 0 ? (
                  <div className="rounded-lg border border-border p-3 text-xs leading-5 text-muted-foreground">
                    暂无 Agent 模板
                  </div>
                ) : templates.map((template) => (
                  <div
                    key={template.id}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border p-2 transition-colors',
                      selectedId === template.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#181d26]/10">
                        {templateAvatar(template, selectedId === template.id ? agentConfig : null) ? (
                          <img src={templateAvatar(template, selectedId === template.id ? agentConfig : null)} alt="" className="h-8 w-8 rounded-full object-cover" />
                        ) : (
                          <Bot className="h-4 w-4 text-[#181d26]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#1a1a1a]">{labelOrFallback(template.name, template.id)}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {labelOrFallback(template.role, template.id)} · 版本：{formatAgentVersion(template.version)}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">默认：{modelTierLabel(template.model_tiers?.default_tier)}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(template)}
                      disabled={templateActionLoading === template.id}
                      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-red-600 disabled:pointer-events-none disabled:opacity-40"
                      title={template.blocked_reason || '删除模板'}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
              {selectedTemplate ? (
                <>
                  <div className="flex items-center justify-between border-b border-border px-5 py-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-[#1a1a1a]">{displayName}</h3>
                      <span className="text-xs text-muted-foreground">
                        {role} · Template ID: {selectedTemplate.id} · 版本：{formatAgentVersion(selectedTemplate.version)}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void syncTemplateChannels()}
                        disabled={syncingChannels || dirty || !selectedId}
                        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-medium text-[#181d26] transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        title={dirty ? '请先保存当前模板，再同步到已有频道' : '把技能和工具同步到已有频道'}
                      >
                        <RefreshCw className={cn('h-4 w-4', syncingChannels && 'animate-spin')} />
                        {syncingChannels ? '同步中...' : '同步到已有频道'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveTemplate()}
                        disabled={saving || !dirty || !identity || !agentConfig}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#181d26] px-3 text-sm font-medium text-white transition-colors hover:bg-[#0d1218] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        {saving ? '保存中...' : saved ? '已保存' : '保存'}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-5 p-5">
                    {saveError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {saveError}
                      </div>
                    )}
                    {syncError && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {syncError}
                      </div>
                    )}
                    {syncResult && (
                      <div className="rounded-lg border border-[#39bf45]/40 bg-[#39bf45]/10 px-3 py-2 text-sm text-[#006400]">
                        已检查 {syncResult.channels_matched} 个频道，更新 {syncResult.channels_updated} 个频道，新增 {syncResult.skills_added} 个技能引用、{syncResult.tools_added} 个工具引用。
                      </div>
                    )}

                    <div>
                      <label className="mb-2 block text-xs font-medium text-[#555]">头像</label>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateConfig({ avatar_preset: '' })}
                          className={cn(
                            'flex h-10 w-10 items-center justify-center rounded-full border bg-white transition-colors hover:bg-muted',
                            selectedAvatarPreset === '' ? 'border-[#181d26] ring-2 ring-[#181d26]/15' : 'border-border',
                          )}
                          title="默认头像"
                        >
                          <Bot className="h-4 w-4 text-[#181d26]" />
                        </button>
                        {AVATAR_PRESETS.map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => updateConfig({ avatar_preset: preset })}
                            className={cn(
                              'h-10 w-10 overflow-hidden rounded-full border bg-white transition-colors hover:bg-muted',
                              selectedAvatarPreset === preset ? 'border-[#181d26] ring-2 ring-[#181d26]/15' : 'border-border',
                            )}
                            title={preset}
                          >
                            <img src={avatarPresetUrl(preset)} alt="" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex h-10 w-10 overflow-hidden rounded-full border border-border bg-[#181d26]/10">
                          {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Bot className="m-auto h-4 w-4 text-[#181d26]" />
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">{selectedAvatarPreset || '默认'}</span>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[#555]">名字</label>
                        <input
                          type="text"
                          value={identity?.name ?? displayName}
                          onChange={(event) => updateIdentity({ name: event.target.value })}
                          className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                        />
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-[#555]">默认等级</label>
                        <select
                          value={modelTierSettings.default_tier}
                          onChange={(event) => updateModelTierSettings({ default_tier: normalizeModelTier(event.target.value) || 'fast' })}
                          className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                        >
                          {MODEL_TIER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} - {option.description}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-[#555]">性格特点</label>
                      <input
                        type="text"
                        value={identity?.personality ?? ''}
                        onChange={(event) => updateIdentity({ personality: event.target.value })}
                        className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                      />
                    </div>

                    <div className="space-y-3 rounded-lg border border-border bg-[#fafafa] p-3">
                      <div>
                        <div className="text-sm font-medium text-[#181d26]">模型等级映射</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">为当前 Agent 单独配置快速、思考、专业三档对应的底层模型。</div>
                      </div>
                      {MODEL_TIER_OPTIONS.map((option) => {
                        const tierConfig = modelTierSettings.tiers[option.value]
                        const providerOptions = providers.length > 0 || !tierConfig.provider ? providers : [{ id: tierConfig.provider, label: tierConfig.provider }]
                        const filteredModels = models.filter((item) => item.provider === tierConfig.provider)
                        const modelOptions = filteredModels.some((item) => item.id === tierConfig.model) || !tierConfig.model
                          ? filteredModels
                          : [{ id: tierConfig.model, label: tierConfig.model, provider: tierConfig.provider }, ...filteredModels]

                        return (
                          <div key={option.value} className="grid gap-3 rounded-lg border border-border bg-white p-3 md:grid-cols-[96px_1fr_1fr_auto] md:items-end">
                            <div>
                              <div className="text-sm font-medium text-[#181d26]">{option.label}</div>
                              <div className="mt-0.5 text-xs text-muted-foreground">{option.description}</div>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-[#555]">Provider</label>
                              <select
                                value={tierConfig.provider}
                                onChange={(event) => updateTierProvider(option.value, event.target.value)}
                                className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                              >
                                {providerOptions.length === 0 ? (
                                  <option value={tierConfig.provider}>{tierConfig.provider || '-'}</option>
                                ) : providerOptions.map((provider) => (
                                  <option key={provider.id} value={provider.id}>{provider.label || provider.id}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="mb-1.5 block text-xs font-medium text-[#555]">模型</label>
                              <select
                                value={tierConfig.model}
                                onChange={(event) => updateModelTierConfig(option.value, { model: event.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                              >
                                {modelOptions.length === 0 ? (
                                  <option value={tierConfig.model}>{tierConfig.model || '-'}</option>
                                ) : modelOptions.map((model) => (
                                  <option key={`${model.provider}:${model.id}`} value={model.id}>{model.label || model.id}</option>
                                ))}
                              </select>
                            </div>
                            <label className="flex h-9 items-center gap-2 text-sm text-[#555]">
                              <input
                                type="checkbox"
                                checked={tierConfig.thinking}
                                onChange={(event) => updateModelTierConfig(option.value, { thinking: event.target.checked })}
                                className="h-4 w-4 rounded border-border"
                              />
                              Thinking
                            </label>
                          </div>
                        )
                      })}
                    </div>

                    <div>
                        <label className="mb-1.5 block text-xs font-medium text-[#555]">
                          Temperature: {temperature.toFixed(1)}
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={temperature}
                          onChange={(event) => updateConfig({ temperature: Number(event.target.value) })}
                          className="h-9 w-full"
                        />
                    </div>

                    <div>
                      <label className="mb-2 block text-xs font-medium text-[#555]">工具</label>
                      <div className="flex flex-wrap gap-2">
                        {TOOL_OPTIONS.map((tool) => {
                          const active = tools.includes(tool)
                          return (
                            <button
                              key={tool}
                              type="button"
                              title={tool}
                              onClick={() => updateConfig({ tools: toggleItem(tools, tool) })}
                              className={cn(
                                'rounded-md border px-2.5 py-1 text-xs transition-colors',
                                active
                                  ? 'border-[#181d26] bg-[#181d26] text-white'
                                  : 'border-border bg-white text-[#555] hover:border-[#9297a0] hover:bg-muted',
                              )}
                            >
                              {toolDisplayName(tool)}
                            </button>
                          )
                        })}
                        {extraTools.map((tool) => (
                          <button
                            key={tool}
                            type="button"
                            title={tool}
                            onClick={() => updateConfig({ tools: tools.filter((value) => value !== tool) })}
                            className="rounded-md border border-[#181d26] bg-[#181d26] px-2.5 py-1 text-xs text-white transition-colors hover:bg-[#0d1218]"
                          >
                            {toolDisplayName(tool)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="block text-xs font-medium text-[#555]">技能</label>
                        <button
                          type="button"
                          onClick={() => void openSkillModal()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 text-xs font-medium text-[#181d26] transition-colors hover:bg-muted"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          添加技能
                        </button>
                      </div>
                      {skills.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                          未配置技能
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {skills.map((skill) => {
                            const meta = availableSkills.find((item) => item.name === skill)
                            return (
                            <span key={skill} title={skill} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1 text-xs text-[#181d26]">
                              <SkillIcon name={skill} iconUrl={meta?.icon_url} className="size-5 rounded" />
                              {skillDisplayName(skill, availableSkills)}
                              <button
                                type="button"
                                onClick={() => removeSkill(skill)}
                                className="rounded-sm text-muted-foreground hover:text-red-600"
                                title="移除技能"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </span>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    <details className="text-xs">
                      <summary className="mb-1.5 cursor-pointer select-none text-muted-foreground">Identity 原始内容（高级）</summary>
                      <textarea
                        value={identity?.content ?? ''}
                        onChange={(event) => updateIdentity({ content: event.target.value })}
                        className="h-36 w-full resize-y rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                      />
                    </details>
                  </div>
                </>
              ) : (
                <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
                  选择一个 Agent 模板
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">添加 Agent 模板</h3>
                <p className="mt-1 text-xs text-muted-foreground">从平台模板库添加到当前 App</p>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-[#181d26]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-border p-4">
              <input
                type="text"
                value={availableQuery}
                onChange={(event) => setAvailableQuery(event.target.value)}
                placeholder="搜索模板名称、ID、模型..."
                className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {templateActionError && (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {templateActionError}
                </div>
              )}
              {filteredAvailableTemplates.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  暂无可添加模板
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredAvailableTemplates.map((template) => (
                    <div key={template.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#181d26]/10">
                        {templateAvatar(template, null) ? (
                          <img src={templateAvatar(template, null)} alt="" className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <Bot className="h-4 w-4 text-[#181d26]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#1a1a1a]">{labelOrFallback(template.name, template.id)}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {template.id} · 版本：{formatAgentVersion(template.version)} · {template.model || '-'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void addTemplate(template.id)}
                        disabled={templateActionLoading === template.id}
                        className="inline-flex h-8 items-center rounded-lg bg-[#181d26] px-3 text-sm font-medium text-white transition-colors hover:bg-[#0d1218] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {templateActionLoading === template.id ? '添加中...' : '添加'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">删除 Agent 模板</h3>
                <p className="mt-1 text-xs text-muted-foreground">{deleteTarget.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-[#181d26]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#181d26]/10">
                  {templateAvatar(deleteTarget, null) ? (
                    <img src={templateAvatar(deleteTarget, null)} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <Bot className="h-4 w-4 text-[#181d26]" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[#1a1a1a]">{labelOrFallback(deleteTarget.name, deleteTarget.id)}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{deleteTarget.model || '-'}</div>
                </div>
              </div>

              {deleteTarget.removable === false ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-800">
                  {deleteTarget.blocked_reason || '当前模板仍在使用，暂时不能删除。'}
                  {typeof deleteTarget.usage_count === 'number' && deleteTarget.usage_count > 0 && (
                    <span> 已有 {deleteTarget.usage_count} 个频道使用该模板。</span>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-[#fafafa] px-3 py-2 text-sm leading-5 text-[#555]">
                  删除后将无法在新频道中选择该模板，已有频道不受影响。
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-medium text-[#181d26] transition-colors hover:bg-muted"
                >
                  关闭
                </button>
                {deleteTarget.removable !== false && (
                  <button
                    type="button"
                    onClick={() => void deleteTemplate(deleteTarget)}
                    disabled={templateActionLoading === deleteTarget.id}
                    className="inline-flex h-9 items-center rounded-lg bg-red-600 px-3 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {templateActionLoading === deleteTarget.id ? '删除中...' : '确认删除'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {skillModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[#1a1a1a]">添加技能</h3>
                <p className="mt-1 text-xs text-muted-foreground">技能会写入当前 Agent 配置</p>
              </div>
              <button
                type="button"
                onClick={() => setSkillModalOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-[#181d26]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-border p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={skillQuery}
                  onChange={(event) => setSkillQuery(event.target.value)}
                  placeholder="搜索技能名称、分类、触发词..."
                  className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-[#1a1a1a] outline-none focus:border-[#9297a0] focus:ring-2 focus:ring-[#9297a0]/20"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {filteredSkills.length === 0 ? (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  暂无可添加技能
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSkills.map((skill) => {
                    const added = skills.includes(skill.name)
                    return (
                      <div key={skill.name} className="flex items-start gap-3 rounded-lg border border-border p-3">
                        <SkillIcon name={skill.name} iconUrl={skill.icon_url} className="size-10 rounded-lg border border-border" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-[#1a1a1a]">{skill.display_name || skill.name}</span>
                            {skill.category && <span className="rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">{skill.category}</span>}
                          </div>
                          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{skill.name}</div>
                          {skill.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{skill.description}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => addSkill(skill.name)}
                          disabled={added}
                          className="inline-flex h-8 items-center rounded-lg bg-[#181d26] px-3 text-sm font-medium text-white transition-colors hover:bg-[#0d1218] disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                        >
                          {added ? '已添加' : '添加'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
