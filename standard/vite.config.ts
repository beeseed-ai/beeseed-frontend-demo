import path from 'path'
import fs from 'fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const sdkRoot = path.resolve(__dirname, '../../../beeseed-sdk')
const localAgentManageTab = path.resolve(__dirname, 'src/components/admin/AgentManageTab.tsx')
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version?: string }
const standardTemplateVersion = pkg.version || '0.0.0'
const standardTemplateBuildTime = new Date().toISOString()
const sdkAlias = {
  '@beeseed/beeseed-sdk/tailwind.css': path.resolve(sdkRoot, 'tailwind.css'),
  '@beeseed/beeseed-sdk': path.resolve(sdkRoot, 'src/index.ts'),
  '@standard/agent-skill-catalog': path.resolve(__dirname, 'src/agent-skill-catalog.ts'),
  '@standard/cloud-storage-panel': path.resolve(__dirname, 'src/components/CloudStoragePanel.tsx'),
}

function syncSkillIcons(): Plugin {
  return {
    name: 'beeseed-sync-skill-icons',
    buildStart() {
      const sourceRoot = path.resolve(__dirname, '../../../templates/skills')
      const targetRoot = path.resolve(__dirname, 'public/skill-icons')
      if (!fs.existsSync(sourceRoot)) return
      fs.mkdirSync(targetRoot, { recursive: true })
      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const source = path.join(sourceRoot, entry.name, 'icon.png')
        if (!fs.existsSync(source)) continue
        fs.copyFileSync(source, path.join(targetRoot, `${entry.name}.png`))
      }
    },
  }
}

function agentSkillsDialogOverlay(): Plugin {
  return {
    name: 'standard-agent-skills-dialog-overlay',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0].split(path.sep).join('/')
      if (!normalizedId.endsWith('/beeseed-sdk/src/components/layout/DetailPanel.tsx')) return null

      const agentSkillsDisplaySection = `                <div>
                  <div className="mb-1.5 flex items-center gap-2">
                    <label className="block text-xs font-medium text-muted-foreground">技能</label>
                    {!agentSkillsLoading && agentSkills.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">{agentSkills.length} 个</span>
                    )}
                  </div>
                  {agentSkillsLoading ? (
                    <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">技能加载中...</div>
                  ) : agentSkills.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">暂无关联技能</div>
                  ) : (
                    <div className="space-y-2">
                      {agentSkills.map((skill) => (
                        <div key={skill.name} className="flex items-start gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <SkillIcon name={skill.name} iconUrl={skill.icon_url} className="size-8 rounded-lg border border-border bg-background" />
                          <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="min-w-0 flex-1 truncate text-sm font-medium">{skill.display_name}</div>
                            <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">v{skill.version}</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground" title={skill.description}>{skill.description}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>`

      const replacements: Array<[string, string]> = [
        [
          "import { CloudStoragePanel } from '../storage/CloudStoragePanel.js'",
          "import { CloudStoragePanel } from '@standard/cloud-storage-panel'",
        ],
        [
          "import { useMemo, useState } from 'react'",
          "import { useMemo, useState } from 'react'\nimport { resolveAgentSkillSummaries, type AgentSkillSummary } from '@standard/agent-skill-catalog'",
        ],
        [
          "  const [agentSettingsSaving, setAgentSettingsSaving] = useState(false)",
          "  const [agentSettingsSaving, setAgentSettingsSaving] = useState(false)\n  const [agentSkills, setAgentSkills] = useState<AgentSkillSummary[]>([])\n  const [agentSkillsLoading, setAgentSkillsLoading] = useState(false)",
        ],
        [
          "    setAgentSettingsLoading(true)\n    try {",
          "    setAgentSettingsLoading(true)\n    setAgentSkills([])\n    setAgentSkillsLoading(true)\n    const agentConfigRequest = api.get(`channels/${channelId}/agents/${member.agent_id}/config`).json<unknown>().catch(() => null)\n    const agentTemplateConfigRequest = api.get(`admin/agent-templates/${member.agent_id}/config`).json<unknown>().catch(() => null)\n    const skillCatalogRequest = api.get('admin/skills').json<AgentSkillSummary[]>().catch(() => [])\n    try {",
        ],
        [
          "    } finally {\n      setAgentSettingsLoading(false)\n    }\n  }\n\n  async function saveAgentSettings() {",
          "    } finally {\n      setAgentSettingsLoading(false)\n    }\n\n    try {\n      const [agentConfig, agentTemplateConfig, skillCatalog] = await Promise.all([\n        agentConfigRequest,\n        agentTemplateConfigRequest,\n        skillCatalogRequest,\n      ])\n      setAgentSkills(resolveAgentSkillSummaries(agentTemplateConfig ?? agentConfig, skillCatalog))\n    } catch {\n      setAgentSkills([])\n    } finally {\n      setAgentSkillsLoading(false)\n    }\n  }\n\n  async function saveAgentSettings() {",
        ],
        [
          '        <DialogContent className="w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0" onClose={() => setAgentSettingsOpen(false)}>',
          '        <DialogContent className="flex max-h-[min(720px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0" onClose={() => setAgentSettingsOpen(false)}>',
        ],
        [
          '          <div className="p-4">',
          '          <div className="min-h-0 flex-1 overflow-y-auto p-4">',
        ],
        [
          `                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-xs font-medium text-muted-foreground">技能</label>
                    <Button variant="outline" size="sm" onClick={() => void openSkillModal()}>
                      <Plus className="h-3.5 w-3.5" />
                      添加技能
                    </Button>
                  </div>
                  {(agentConfig?.skills ?? []).length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                      未配置技能
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {(agentConfig?.skills ?? []).map((skill) => {
                        const meta = availableSkills.find((item) => item.name === skill)
                        return (
                          <span key={skill} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs">
                            <SkillIcon name={skill} iconUrl={meta?.icon_url} className="size-5 rounded" />
                            <span className="font-mono">{meta?.display_name || skill}</span>
                            <button type="button" onClick={() => removeAgentSkill(skill)} className="text-muted-foreground hover:text-destructive" title="移除技能">
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>`,
          "",
        ],
        [
          "                )}\n              </div>",
          "                )}\n" + agentSkillsDisplaySection + "\n              </div>",
        ],
      ]

      let nextCode = code
      for (const [from, to] of replacements) {
        if (!nextCode.includes(from)) {
          this.error(`DetailPanel overlay target changed; missing snippet: ${from.slice(0, 80)}`)
        }
        nextCode = nextCode.replace(from, to)
      }

      return { code: nextCode, map: null }
    },
  }
}

function storageUploadIntegrityOverlay(): Plugin {
  return {
    name: 'standard-storage-upload-integrity-overlay',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0].split(path.sep).join('/')
      if (!normalizedId.endsWith('/beeseed-sdk/src/stores/storage.ts')) return null

      const replacements: Array<[string, string]> = [
        [
          `        const presign = await config.api.post(\`channels/\${channelId}/storage/presign-upload\`, {
          json: { file_name: file.name, content_type: contentType, size: file.size, prefix },
        }).json<{ object: StorageObject; upload_url: string; method: string; headers?: Record<string, string> }>()

        const headers = presign.headers && Object.keys(presign.headers).length > 0 ? presign.headers : undefined
        const uploadBody = await file.arrayBuffer()
        await uploadWithProgress(presign.upload_url, presign.method || 'PUT', uploadBody, headers, (progress) => {`,
          `        const uploadBody = await createStorageUploadBody(file)
        const expectedSize = uploadBody.byteLength
        if (file.size > 0 && expectedSize !== file.size) {
          throw new Error(\`上传文件读取失败：期望 \${file.size} 字节，实际读取 \${expectedSize} 字节\`)
        }

        const presign = await config.api.post(\`channels/\${channelId}/storage/presign-upload\`, {
          json: { file_name: file.name, content_type: contentType, size: expectedSize, prefix },
        }).json<{ object: StorageObject; upload_url: string; method: string; headers?: Record<string, string> }>()

        const headers = presign.headers && Object.keys(presign.headers).length > 0 ? presign.headers : undefined
        await uploadWithProgress(presign.upload_url, presign.method || 'PUT', uploadBody, headers, (progress) => {`,
        ],
        [
          `        const completed = await config.api.post(\`channels/\${channelId}/storage/complete-upload\`, {
          json: { object_id: presign.object.id },
        }).json<StorageObject>()
        set({ uploadProgress: 100 })
        await get().browse(channelId, visiblePrefix)
        return completed`,
          `        const completed = await config.api.post(\`channels/\${channelId}/storage/complete-upload\`, {
          json: { object_id: presign.object.id },
        }).json<StorageObject>()
        if (expectedSize > 0 && completed.size !== expectedSize) {
          if (completed.key) {
            await config.api.delete(\`channels/\${channelId}/storage/file/\${encodeURIComponent(completed.key)}\`).catch(() => undefined)
          }
          throw new Error(\`上传校验失败：期望 \${expectedSize} 字节，实际保存 \${completed.size ?? 0} 字节\`)
        }
        set({ uploadProgress: 100 })
        await get().browse(channelId, visiblePrefix)
        return completed`,
        ],
        [
          `function uploadWithProgress(`,
          `async function createStorageUploadBody(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer()
}

function uploadWithProgress(`,
        ],
      ]

      let nextCode = code
      for (const [from, to] of replacements) {
        if (!nextCode.includes(from)) {
          this.error(`Storage upload overlay target changed; missing snippet: ${from.slice(0, 80)}`)
        }
        nextCode = nextCode.replace(from, to)
      }

      return { code: nextCode, map: null }
    },
  }
}

function skillShortcutMenuOverlay(): Plugin {
  return {
    name: 'standard-skill-shortcut-menu-overlay',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0].split(path.sep).join('/')
      if (!normalizedId.endsWith('/beeseed-sdk/src/components/chat/MessageInput.tsx')) return null

      const from = `  useLayoutEffect(() => {
    if (!skillMenuOpen) return
    const activeItem = activeSkillItemRef.current
    const scrollContainer = skillScrollRef.current
    if (!activeItem || !scrollContainer) return

    const itemTop = activeItem.offsetTop
    const itemBottom = itemTop + activeItem.offsetHeight
    const viewTop = scrollContainer.scrollTop
    const viewBottom = viewTop + scrollContainer.clientHeight

    if (itemTop < viewTop) {
      scrollContainer.scrollTop = itemTop
    } else if (itemBottom > viewBottom) {
      scrollContainer.scrollTop = itemBottom - scrollContainer.clientHeight
    }
  }, [skillIndex, skillMenuOpen, pendingSkill, filteredSkills.length, pendingAgentChoices.length])`

      const to = `  const syncActiveSkillScroll = useCallback(() => {
    const activeItem = activeSkillItemRef.current
    const scrollContainer = skillScrollRef.current
    if (!activeItem || !scrollContainer) return

    const itemRect = activeItem.getBoundingClientRect()
    const containerRect = scrollContainer.getBoundingClientRect()
    const menuRect = skillMenuRef.current?.getBoundingClientRect()
    const visibleTop = Math.max(containerRect.top, menuRect?.top ?? containerRect.top, 0)
    const visibleBottom = Math.min(containerRect.bottom, menuRect?.bottom ?? containerRect.bottom, window.innerHeight)
    if (visibleBottom <= visibleTop) return

    if (itemRect.top < visibleTop) {
      scrollContainer.scrollTop -= visibleTop - itemRect.top
    } else if (itemRect.bottom > visibleBottom) {
      scrollContainer.scrollTop += itemRect.bottom - visibleBottom
    }
  }, [])

  useLayoutEffect(() => {
    if (!skillMenuOpen) return
    syncActiveSkillScroll()
    const frame = requestAnimationFrame(syncActiveSkillScroll)
    return () => cancelAnimationFrame(frame)
  }, [syncActiveSkillScroll, skillIndex, skillMenuOpen, pendingSkill, filteredSkills.length, pendingAgentChoices.length])`

      if (!code.includes(from)) {
        this.error('MessageInput overlay target changed; missing skill menu scroll snippet')
      }

      return { code: code.replace(from, to), map: null }
    },
  }
}

function taskCalendarDisplayOverlay(): Plugin {
  const calendarHelpers = `
function filterCalendarEventsForSelectedDate(events: CalendarEvent[], schedules: TaskSchedule[], selectedDate: Date) {
  const scheduleStartDays = buildScheduleStartDayMap(schedules)
  const projectedDays = new Set<string>()
  return events.filter((event) => {
    if (!event.schedule_id || !event.is_recurring) return true
    if (isBeforeScheduleStartDay(event, scheduleStartDays)) return false
    if (event.type !== 'projected_occurrence') return true
    if (!isSameCalendarDay(new Date(event.start_at), selectedDate)) return false
    const key = scheduleOccurrenceDayKey(event)
    if (projectedDays.has(key)) return false
    projectedDays.add(key)
    return true
  })
}

function filterCalendarEventsForCurrentDay(events: CalendarEvent[], schedules: TaskSchedule[], now: number) {
  const currentDate = new Date(now)
  const scheduleStartDays = buildScheduleStartDayMap(schedules)
  const projectedDays = new Set<string>()
  return events.filter((event) => {
    if (!event.schedule_id || !event.is_recurring) return true
    if (isBeforeScheduleStartDay(event, scheduleStartDays)) return false
    if (event.type !== 'projected_occurrence') return true
    if (!isSameCalendarDay(new Date(event.start_at), currentDate)) return false
    const key = scheduleOccurrenceDayKey(event)
    if (projectedDays.has(key)) return false
    projectedDays.add(key)
    return true
  })
}

function buildScheduleStartDayMap(schedules: TaskSchedule[]) {
  const map = new Map<string, number>()
  for (const schedule of schedules) {
    const createdDay = localDayTime(schedule.created_at)
    const runDay = localDayTime(schedule.run_at)
    const startDay = Math.max(createdDay ?? Number.NEGATIVE_INFINITY, runDay ?? Number.NEGATIVE_INFINITY)
    if (Number.isFinite(startDay)) {
      map.set(schedule.id, startDay)
    }
  }
  return map
}

function isBeforeScheduleStartDay(event: CalendarEvent, scheduleStartDays: Map<string, number>) {
  if (!event.schedule_id) return false
  const startDay = scheduleStartDays.get(event.schedule_id)
  if (startDay === undefined) {
    return event.type === 'projected_occurrence'
  }
  const eventDay = localDayTime(event.occurrence_at || event.start_at)
  return eventDay !== null && eventDay < startDay
}

function scheduleOccurrenceDayKey(event: CalendarEvent) {
  const day = localDayTime(event.occurrence_at || event.start_at) ?? 0
  return \`\${event.schedule_id || event.id}:\${day}\`
}

function isSameCalendarDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function localDayTime(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
`

  return {
    name: 'standard-task-calendar-display-overlay',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0].split(path.sep).join('/')
      if (normalizedId.endsWith('/beeseed-sdk/src/components/tasks/TaskPanel.tsx')) {
        const replacements: Array<[string, string]> = [
          [
            "import type { CalendarEvent, ChannelMemberInfo, Task, TaskSchedulerMetrics } from '../../core/types.js'",
            "import type { CalendarEvent, ChannelMemberInfo, Task, TaskSchedule, TaskSchedulerMetrics } from '../../core/types.js'",
          ],
          [
            "  const selectedEvents = calendarEvents.filter((event) => isSameLocalDay(new Date(event.start_at), selectedDate))",
            "  const visibleCalendarEvents = filterCalendarEventsForSelectedDate(calendarEvents, scheduledTasks, selectedDate)\n  const selectedEvents = visibleCalendarEvents.filter((event) => isSameLocalDay(new Date(event.start_at), selectedDate))",
          ],
          [
            "            events={calendarEvents}",
            "            events={visibleCalendarEvents}",
          ],
          [
            `function formatDayTitle(value: Date) {`,
            `${calendarHelpers}
function formatDayTitle(value: Date) {`,
          ],
        ]

        let nextCode = code
        for (const [from, to] of replacements) {
          if (!nextCode.includes(from)) {
            this.error(`TaskPanel calendar overlay target changed; missing snippet: ${from.slice(0, 80)}`)
          }
          nextCode = nextCode.replace(from, to)
        }

        return { code: nextCode, map: null }
      }

      if (normalizedId.endsWith('/beeseed-sdk/src/components/layout/DetailPanel.tsx')) {
        const replacements: Array<[string, string]> = [
          [
            "import type { CalendarEvent, ChannelMemberInfo, ModelTierName, Task, StorageObject } from '../../core/types.js'",
            "import type { CalendarEvent, ChannelMemberInfo, ModelTierName, Task, TaskSchedule, StorageObject } from '../../core/types.js'",
          ],
          [
            `  const upcomingEvents = useMemo(() => [...calendarEvents]
    .filter((event) => new Date(event.start_at).getTime() >= now - 60_000)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 6), [calendarEvents, now])`,
            `  const upcomingEvents = useMemo(() => filterCalendarEventsForCurrentDay(calendarEvents, scheduledTasks, now)
    .filter((event) => new Date(event.start_at).getTime() >= now - 60_000)
    .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
    .slice(0, 6), [calendarEvents, scheduledTasks, now])`,
          ],
          [
            `function CompactCalendarRow({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {`,
            `${calendarHelpers}
function CompactCalendarRow({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {`,
          ],
        ]

        let nextCode = code
        for (const [from, to] of replacements) {
          if (!nextCode.includes(from)) {
            this.error(`DetailPanel calendar overlay target changed; missing snippet: ${from.slice(0, 80)}`)
          }
          nextCode = nextCode.replace(from, to)
        }

        return { code: nextCode, map: null }
      }

      return null
    },
  }
}

function agentManageTabOverride(): Plugin {
  return {
    name: 'beeseed-standard-admin-overrides',
    enforce: 'pre',
    resolveId(source, importer) {
      if (
        source === './AgentManageTab.js'
        && importer
        && path.normalize(importer) === path.join(sdkRoot, 'src/components/admin/AdminPanel.tsx')
      ) {
        return localAgentManageTab
      }
      return null
    },
  }
}

function hideKnowledgeNavOverlay(): Plugin {
  return {
    name: 'standard-hide-knowledge-nav-overlay',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.split('?')[0].split(path.sep).join('/')
      if (!normalizedId.endsWith('/beeseed-sdk/src/components/layout/LeftNavSidebar.tsx')) return null

      const from = `const BASE_NAV_ITEMS: NavItem[] = [
  { id: 'knowledge', label: '知识库', icon: BookOpen },
  { id: 'tasks', label: '任务', icon: ListChecks },
]`
      const to = `const BASE_NAV_ITEMS: NavItem[] = [
  { id: 'tasks', label: '任务', icon: ListChecks },
]`

      if (!code.includes(from)) {
        this.error('LeftNavSidebar overlay target changed; missing BASE_NAV_ITEMS snippet')
      }

      return { code: code.replace(from, to), map: null }
    },
  }
}

export default defineConfig({
  plugins: [syncSkillIcons(), agentSkillsDialogOverlay(), storageUploadIntegrityOverlay(), taskCalendarDisplayOverlay(), skillShortcutMenuOverlay(), agentManageTabOverride(), hideKnowledgeNavOverlay(), react(), tailwindcss()],
  define: {
    __STANDARD_TEMPLATE_VERSION__: JSON.stringify(standardTemplateVersion),
    __STANDARD_TEMPLATE_BUILD_TIME__: JSON.stringify(standardTemplateBuildTime),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: sdkAlias,
  },
  build: {
    outDir: 'dist',
    assetsDir: '.',
    rollupOptions: {
      output: {
        entryFileNames: 'app-[hash].js',
        assetFileNames: (info) => {
          if (info.names?.[0]?.endsWith('.css') || info.name?.endsWith('.css')) return 'app.css'
          return '[name][extname]'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': { target: 'http://localhost:9092', changeOrigin: true },
      '/ws': { target: 'ws://localhost:9092', ws: true, timeout: 0 },
      '/avatars': { target: 'http://localhost:9092', changeOrigin: true },
      '/uploads': { target: 'http://localhost:9092', changeOrigin: true },
    },
  },
})
