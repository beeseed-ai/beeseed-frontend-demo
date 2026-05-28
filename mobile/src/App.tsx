import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type FormEvent, type ReactNode } from 'react'
import { useStore } from 'zustand'
import {
  BeeSeedProvider,
  AuthGuard,
  Button,
  CreateChannelDialog,
  Input,
  cn,
  applyDocumentBranding,
  resolveAppBranding,
  useAppConfig,
  useBeeSeedContext,
  useAuth,
  useChannels,
  useConnection,
  useDetailPanel,
  type AgentLoopState,
  type ChannelWithMeta,
  type ChatMessage,
  type KnowledgeEntity,
  type KnowledgeSearchResult,
  type KnowledgeSource,
  type Message,
  type StorageObject,
  type AppRuntimeConfig,
  type AgentLoopToolCall,
  type StreamState,
  type Task,
  type AskUserQuestion,
} from '@beeseed/beeseed-sdk'
import { installImagePreviewOptimizer } from './imagePreviewOptimizer'
import { RuntimeAppLayout } from './runtime-layout'
import { AgentLoopFixturePage } from './agent-loop-fixture'
import {
  MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE,
  MODEL_STREAM_INTERRUPTED_TASK_MESSAGE,
  isModelStreamInterruptionText,
  markSupersededModelErrorLoop,
  normalizeLoopForDisplay,
  normalizeTaskForDisplay,
  userFacingMessageContent,
} from './runtime-recovery'
import { installRuntimeStorageSafety } from './storage-safety'

const DEFAULT_RUNTIME_CONFIG: AppRuntimeConfig = {}
if (typeof window !== 'undefined') {
  installRuntimeStorageSafety()
}
const TOKEN_STORAGE_KEY = 'beeseed_token'
const LAUNCH_TOKEN_KEYS = ['beeseed_launch_token', 'beeseed_token', 'token', 'auth_token', 'access_token']
const TOKEN_QUERY_RE = /([?#&](?:beeseed_launch_token|beeseed_token|token|auth_token|access_token)=)[^&#\s]*/gi
const INVITE_CODE_KEYS = ['invite_code', 'invite']
const SIGNED_OUT_KEYS = ['signed_out']
const APP_SIGNED_OUT_STORAGE_KEY = 'beeseed:app-signed-out:v1'
const LAST_CHANNEL_STORAGE_PREFIX = 'beeseed:last-channel:v1'
const STORAGE_MISSING_TOOLS = new Set(['storage_read', 'storage_info'])
const STORAGE_MISSING_ERROR_RE = /\bno rows in result set\b/i
const STORAGE_DOWNLOAD_TOOL = 'storage_presign_download'
const STORAGE_DOWNLOAD_FAILURE_RE = /\b(?:failed to create download url|storage download url error)\b/i
const STORAGE_DOWNLOAD_URL_LINE_RE = /^(\s*Download URL:\s*).+$/gim
const STORAGE_PREVIEW_ERROR_TEXT_RE = /\b(?:failed to create download url|Storage Download Error|Request failed with status code 5\d\d|HTTP 5\d\d|\/storage\/presign-download)\b/i
const SENSITIVE_PRESIGN_URL_RE = /\bhttps?:\/\/[^\s<>"'`]*[?&](?:X-Amz-Credential|X-Amz-Signature|X-Amz-Security-Token|X-Tos-Credential|X-Tos-Signature|Signature|credential|signature|token)=[^\s<>"'`]*/gi
const STORAGE_DOWNLOAD_LINK_PLACEHOLDER = '<已隐藏的预签名下载链接>'
const STORAGE_DOWNLOAD_FAILURE_MESSAGE = '下载链接生成失败。请从文件卡片或右侧云存储面板重新打开该文件。'
const STORAGE_KEY_RESOLVED_EVENT = 'beeseed:storage-key-resolved'
const STORAGE_DELIVERY_NOTICE_PREFIX = '文件交付未确认：'
const STORAGE_DELIVERY_NOTICE = `${STORAGE_DELIVERY_NOTICE_PREFIX}系统没有收到云存储写入成功回执，暂时不能确认文件已经保存。请重试生成，或从右侧云存储面板确认后再下载。`
const STORAGE_DELIVERY_CLAIM_RE = /(?:云存储|云盘|文件).{0,32}(?:已|已经|自动|上传|保存|写入|下载)|(?:已|已经|自动).{0,24}(?:上传|保存|写入).{0,24}(?:云存储|云盘|文件)|可以直接下载使用/
const STORAGE_WRITE_KEY_LINE_RE = /(?:^|\n)\s*(?:key|relative_key|relative key|storage key)\s*[:：]\s*([^\n]+)/i
const STORAGE_WRITE_ACTION_RE = /^(?:Wrote|Saved|Uploaded)\s+(.+?)(?:\s+\(\d+\s+bytes\)\.?)?$/i
const STORAGE_DELIVERY_TOOL_NAMES = new Set([
  'storage_write',
  'presentation_pptx_generate',
  'web_deck_generate',
  'wechat_article_fetch_markdown',
])
const TASK_FAILURE_SYNC_WINDOW_BEFORE_MS = 2 * 60 * 1000
const TASK_FAILURE_SYNC_WINDOW_AFTER_MS = 90 * 1000
const TASK_TOOL_NAME = 'task_management'
const TASK_TOOL_REFRESH_DEBOUNCE_MS = 150
const TASK_TOOL_MUTATING_ACTIONS = new Set([
  'create_task',
  'create_plan',
  'create_scheduled_task',
  'update_task',
  'add_comment',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function arrayFromPayload<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!isRecord(payload)) return []

  for (const key of keys) {
    const value = payload[key]
    if (Array.isArray(value)) return value as T[]
  }

  return []
}

function normalizeSourcesPayload(payload: unknown): KnowledgeSource[] {
  return arrayFromPayload<KnowledgeSource>(payload, ['sources', 'items', 'data', 'results'])
}

function normalizeSearchResultsPayload(payload: unknown): KnowledgeSearchResult[] {
  return arrayFromPayload<KnowledgeSearchResult>(payload, ['results', 'searchResults', 'items', 'data'])
}

function normalizeEntitiesPayload(payload: unknown): KnowledgeEntity[] {
  return arrayFromPayload<KnowledgeEntity>(payload, ['entities', 'entityResults'])
}

function redactSensitiveUrl(value: string): string {
  return value.replace(TOKEN_QUERY_RE, '$1<redacted>')
}

function sanitizeWebSocketLogArg(arg: unknown): unknown {
  if (typeof arg === 'string') return redactSensitiveUrl(arg)

  if (
    typeof Event !== 'undefined'
    && typeof WebSocket !== 'undefined'
    && arg instanceof Event
    && arg.target instanceof WebSocket
  ) {
    return {
      type: arg.type,
      target: {
        kind: 'WebSocket',
        url: redactSensitiveUrl(arg.target.url),
        readyState: arg.target.readyState,
      },
    }
  }

  return arg
}

function installConsoleRedaction() {
  const originalError = console.error
  console.error = (...args: unknown[]) => {
    originalError(...args.map(sanitizeWebSocketLogArg))
  }
  return () => {
    console.error = originalError
  }
}

function consumeTokenParam(params: URLSearchParams): string | null {
  for (const key of LAUNCH_TOKEN_KEYS) {
    const value = params.get(key)
    if (value) return value
  }
  return null
}

function removeTokenParams(params: URLSearchParams) {
  for (const key of LAUNCH_TOKEN_KEYS) {
    params.delete(key)
  }
}

function hasAnyParam(params: URLSearchParams, keys: string[]): boolean {
  return keys.some((key) => params.has(key))
}

function removeParams(params: URLSearchParams, keys: string[]) {
  for (const key of keys) params.delete(key)
}

function setAppSignedOut(value: boolean) {
  try {
    if (value) window.localStorage.setItem(APP_SIGNED_OUT_STORAGE_KEY, '1')
    else window.localStorage.removeItem(APP_SIGNED_OUT_STORAGE_KEY)
  } catch {
    // Ignore private-mode storage failures.
  }
}

function isAppSignedOut(): boolean {
  try {
    return window.localStorage.getItem(APP_SIGNED_OUT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function clearAppToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // Ignore private-mode storage failures.
  }
}

function lastChannelStorageKey(userId: string): string {
  const appScope = typeof window === 'undefined' ? 'app' : window.location.host || 'app'
  return `${LAST_CHANNEL_STORAGE_PREFIX}:${appScope}:${encodeURIComponent(userId)}`
}

function readLastChannelId(userId: string): string | null {
  try {
    const value = window.localStorage.getItem(lastChannelStorageKey(userId))
    return value?.trim() || null
  } catch {
    return null
  }
}

function writeLastChannelId(userId: string, channelId: string) {
  try {
    window.localStorage.setItem(lastChannelStorageKey(userId), channelId)
  } catch {
    // Ignore private-mode or storage quota failures; session state still works.
  }
}

function removeLastChannelId(userId: string) {
  try {
    window.localStorage.removeItem(lastChannelStorageKey(userId))
  } catch {
    // Ignore private-mode storage failures.
  }
}

function channelActivityTime(channel: ChannelWithMeta): number {
  const value = channel.last_msg_at || channel.updated_at || channel.created_at
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function defaultChannelId(channels: ChannelWithMeta[]): string | null {
  let selected: ChannelWithMeta | null = null
  let selectedTime = -1

  for (const channel of channels) {
    const time = channelActivityTime(channel)
    if (!selected || time > selectedTime) {
      selected = channel
      selectedTime = time
    }
  }

  return selected?.id ?? null
}

function consumeLaunchTokenFromUrl() {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const searchToken = consumeTokenParam(url.searchParams)
  const hashText = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.startsWith('?') ? hashText.slice(1) : hashText)
  const hashToken = consumeTokenParam(hashParams)
  const token = searchToken || hashToken
  if (!token) return

  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    setAppSignedOut(false)
  } catch {
    return
  }

  removeTokenParams(url.searchParams)
  removeParams(url.searchParams, SIGNED_OUT_KEYS)
  if (hashToken) {
    removeTokenParams(hashParams)
    removeParams(hashParams, SIGNED_OUT_KEYS)
    const nextHash = hashParams.toString()
    url.hash = nextHash ? `#${nextHash}` : ''
  }
  window.history.replaceState(null, document.title, url.toString())
}

function syncSignedOutStateFromUrl() {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  const hashText = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.startsWith('?') ? hashText.slice(1) : hashText)
  const signedOut = hasAnyParam(url.searchParams, SIGNED_OUT_KEYS) || hasAnyParam(hashParams, SIGNED_OUT_KEYS)
  if (!signedOut) return

  clearAppToken()
  setAppSignedOut(true)
  removeParams(url.searchParams, SIGNED_OUT_KEYS)
  removeParams(hashParams, SIGNED_OUT_KEYS)
  const nextHash = hashParams.toString()
  url.hash = nextHash ? `#${nextHash}` : ''
  window.history.replaceState(null, document.title, url.toString())
}

syncSignedOutStateFromUrl()
consumeLaunchTokenFromUrl()

function sanitizeStorageMessageContent(content?: string) {
  return content?.replace(SENSITIVE_PRESIGN_URL_RE, STORAGE_DOWNLOAD_LINK_PLACEHOLDER)
}

function sanitizeStorageToolOutput(toolName?: string, output?: string) {
  if (!output) return output
  const sanitizedOutput = sanitizeStorageMessageContent(output) ?? output
  if (toolName !== STORAGE_DOWNLOAD_TOOL) {
    return sanitizedOutput
  }
  return sanitizedOutput
    .replace(STORAGE_DOWNLOAD_URL_LINE_RE, `$1${STORAGE_DOWNLOAD_LINK_PLACEHOLDER}`)
}

function isStorageDownloadFailure(toolName?: string, output?: string) {
  return toolName === STORAGE_DOWNLOAD_TOOL && !!output && STORAGE_DOWNLOAD_FAILURE_RE.test(output)
}

function normalizeRuntimeErrorText(content?: string) {
  return userFacingMessageContent(content) ?? content
}

function storageMissingMessage(toolName?: string, args?: Record<string, unknown>, output?: string) {
  const rawKey = args?.key
  const outputKey = output?.match(/(?:^|\n)key:\s*([^\n]+)/i)?.[1]?.trim() ?? ''
  const key = typeof rawKey === 'string' && rawKey.trim() ? rawKey.trim() : outputKey
  if (key) return `未找到 ${key}，将继续按新文件处理。`
  return toolName === 'storage_info' ? '文件不存在，无法读取文件信息。' : '文件不存在，将继续按新文件处理。'
}

function isStorageMissingToolResult(name?: string, output?: string) {
  return !!name && STORAGE_MISSING_TOOLS.has(name) && !!output && STORAGE_MISSING_ERROR_RE.test(output)
}

interface SkillContextItem {
  name: string
  displayName?: string
  category?: string
  description?: string
  configured?: boolean
}

function normalizeRuntimeMessageContent(message: ChatMessage): ChatMessage {
  if (message.role === 'user') return message
  const content = userFacingMessageContent(message.content) ?? message.content
  return content !== message.content ? { ...message, content } : message
}

function parseSkillSearchContext(message: ChatMessage): SkillContextItem[] {
  if (message.toolName !== 'skill_search' || message.toolKind !== 'result' || !message.content) return []

  try {
    const payload = JSON.parse(message.content) as unknown
    if (!isRecord(payload) || !Array.isArray(payload.matches)) return []
    return payload.matches
      .map((item): SkillContextItem | null => {
        if (!isRecord(item) || typeof item.name !== 'string' || item.name.trim() === '') return null
        return {
          name: item.name.trim(),
          displayName: typeof item.display_name === 'string' ? item.display_name.trim() : undefined,
          category: typeof item.category === 'string' ? item.category.trim() : undefined,
          description: typeof item.description === 'string' ? item.description.trim() : undefined,
          configured: item.configured === true,
        }
      })
      .filter((item): item is SkillContextItem => !!item)
  } catch {
    return []
  }
}

function skillCountFromTitle(title: string): number {
  const match = title.match(/(\d+)\s*个/)
  if (!match) return 3
  const count = Number(match[1])
  return Number.isFinite(count) && count > 0 ? count : 3
}

function findSkillContextBefore(messages: ChatMessage[], index: number, limit = 20): SkillContextItem[] {
  for (let i = index - 1; i >= 0 && i >= index - limit; i--) {
    const context = parseSkillSearchContext(messages[i]!)
      .filter((skill) => !skill.configured)
    if (context.length > 0) return context
  }
  return []
}

function findSkillContextNear(messages: ChatMessage[], index: number): SkillContextItem[] {
  const previous = findSkillContextBefore(messages, index)
  if (previous.length > 0) return previous

  for (let i = index + 1; i < messages.length && i <= index + 10; i++) {
    const context = parseSkillSearchContext(messages[i]!)
      .filter((skill) => !skill.configured)
    if (context.length > 0) return context
  }
  return []
}

function skillListDescription(skills: SkillContextItem[], intro: string): string {
  const lines = skills.map((skill, index) => {
    const label = skill.displayName || skill.name
    const id = skill.displayName && skill.displayName !== skill.name ? `（${skill.name}）` : ''
    const description = skill.description ? `：${skill.description}` : ''
    return `${index + 1}. ${label}${id}${description}`
  })
  return [
    intro,
    ...lines,
    '',
    '影响：启用后，仅当前频道的当前 Agent 会增加这些能力；它们可能调用对应工具或外部服务来完成本次任务。',
  ].join('\n')
}

function questionDescriptionHasSkillList(description: string | undefined, skills: SkillContextItem[]): boolean {
  if (!description) return false
  const matched = skills.filter((skill) => (
    description.includes(skill.name) || (!!skill.displayName && description.includes(skill.displayName))
  ))
  return matched.length >= Math.min(2, skills.length)
}

function normalizeSkillAskQuestion(question: AskUserQuestion, skills: SkillContextItem[]): AskUserQuestion {
  if (skills.length === 0) return question

  const title = question.title || ''
  const asksAboutAboveSkills = /上述\s*\d*\s*个.*技能|核心技能/.test(title)
  const asksAboutSkillEnable = /启用.*技能/.test(title)
  if (!asksAboutAboveSkills && !asksAboutSkillEnable) return question

  const count = Math.min(skillCountFromTitle(title), skills.length)
  const selectedSkills = skills.slice(0, count)
  const hasSkillList = questionDescriptionHasSkillList(question.description, selectedSkills)
  const mentionsSingleSkill = selectedSkills.some((skill) => title.includes(skill.name) || (!!skill.displayName && title.includes(skill.displayName)))

  if (hasSkillList && !asksAboutAboveSkills) return question

  const descriptionParts: string[] = []
  if (!hasSkillList && mentionsSingleSkill && !asksAboutAboveSkills && selectedSkills.length > 1) {
    descriptionParts.push(skillListDescription(selectedSkills, '这是多技能方案中的一个授权步骤；完整方案包含：'))
  } else if (!hasSkillList && (asksAboutAboveSkills || selectedSkills.length > 1)) {
    descriptionParts.push(skillListDescription(selectedSkills, `需要启用的 ${selectedSkills.length} 个技能：`))
  }
  if (question.description?.trim()) {
    descriptionParts.push(question.description.trim())
  }

  if (descriptionParts.length === 0 && !asksAboutAboveSkills) return question

  return {
    ...question,
    title: asksAboutAboveSkills ? `是否同意启用以下 ${selectedSkills.length} 个技能？` : question.title,
    description: descriptionParts.join('\n\n'),
  }
}

function normalizeAskUserContext(messages: ChatMessage[], message: ChatMessage, index: number): ChatMessage {
  if (!message.askUserData?.questions?.length) return message

  const skills = findSkillContextNear(messages, index)
  if (skills.length === 0) return message

  let changed = false
  const questions = message.askUserData.questions.map((question) => {
    const normalized = normalizeSkillAskQuestion(question, skills)
    if (normalized !== question) changed = true
    return normalized
  })

  return changed
    ? { ...message, askUserData: { ...message.askUserData, questions } }
    : message
}

function normalizeRuntimeMessages(messages: ChatMessage[]): ChatMessage[] {
  let changed = false
  const normalized = messages.map((message, index) => {
    let nextMessage = normalizeStorageToolMessage(message)
    nextMessage = normalizeRuntimeMessageContent(nextMessage)
    nextMessage = normalizeAskUserContext(messages, nextMessage, index)
    if (nextMessage !== message) changed = true
    return nextMessage
  })
  return changed ? normalized : messages
}

function normalizeStorageToolMessage(message: ChatMessage): ChatMessage {
  if (message.toolKind !== 'result') {
    if (message.contentType === 'image') return message
    const content = sanitizeStorageMessageContent(message.content) ?? message.content
    const normalizedContent = normalizeRuntimeErrorText(content) ?? content
    return normalizedContent !== message.content ? { ...message, content: normalizedContent } : message
  }

  if (message.toolSuccess === false) {
    if (isStorageMissingToolResult(message.toolName, message.content)) {
      return {
        ...message,
        content: storageMissingMessage(message.toolName, message.toolArgs, message.content),
        toolSuccess: true,
      }
    }

    if (isStorageDownloadFailure(message.toolName, message.content)) {
      return {
        ...message,
        content: STORAGE_DOWNLOAD_FAILURE_MESSAGE,
      }
    }
  }

  const content = sanitizeStorageToolOutput(message.toolName, message.content) ?? message.content
  const normalizedContent = normalizeRuntimeErrorText(content) ?? content
  return normalizedContent !== message.content ? { ...message, content: normalizedContent } : message
}

function normalizeAgentLoop(loop: AgentLoopState): AgentLoopState {
  let changed = false
  const turns = loop.turns.map((turn) => {
    let turnChanged = false
    const toolCalls = turn.toolCalls.map((tool) => {
      if (tool.status === 'failed') {
        if (isStorageMissingToolResult(tool.name, tool.output)) {
          turnChanged = true
          changed = true
          return {
            ...tool,
            status: 'success' as const,
            output: storageMissingMessage(tool.name, tool.args, tool.output),
          }
        }

        if (isStorageDownloadFailure(tool.name, tool.output)) {
          turnChanged = true
          changed = true
          return {
            ...tool,
            output: STORAGE_DOWNLOAD_FAILURE_MESSAGE,
          }
        }
      }

      const output = sanitizeStorageToolOutput(tool.name, tool.output)
      if (output !== tool.output) {
        turnChanged = true
        changed = true
        return { ...tool, output }
      }

      return tool
    })
    return turnChanged ? { ...turn, toolCalls } : turn
  })
  const nextLoop = changed ? { ...loop, turns } : loop
  return normalizeLoopForDisplay(nextLoop)
}

function normalizeAgentLoopMap(agentLoops: Map<string, AgentLoopState>): Map<string, AgentLoopState> {
  const normalized = new Map<string, AgentLoopState>()
  let changed = false
  const latestCompletedByAgent = new Map<string, number>()

  for (const [key, loop] of agentLoops) {
    const nextLoop = normalizeAgentLoop(loop)
    if (nextLoop !== loop) changed = true
    normalized.set(key, nextLoop)

    if (nextLoop.status === 'completed') {
      const activityAt = nextLoop.completedAt ?? nextLoop.startedAt ?? 0
      const agentKey = `${nextLoop.channelId}:${nextLoop.agentId}`
      latestCompletedByAgent.set(agentKey, Math.max(latestCompletedByAgent.get(agentKey) ?? 0, activityAt))
    }
  }

  for (const [key, loop] of normalized) {
    if (loop.status !== 'error') continue
    const agentKey = `${loop.channelId}:${loop.agentId}`
    const completedAt = loop.completedAt ?? loop.startedAt ?? 0
    if ((latestCompletedByAgent.get(agentKey) ?? 0) <= completedAt) continue
    const settled = markSupersededModelErrorLoop(loop)
    if (settled !== loop) {
      normalized.set(key, settled)
      changed = true
    }
  }

  return changed ? normalized : agentLoops
}

function normalizeStream(stream: StreamState): StreamState {
  if (!stream.agentLoop) return stream
  const agentLoop = normalizeAgentLoop(stream.agentLoop)
  return agentLoop === stream.agentLoop ? stream : { ...stream, agentLoop }
}

function StorageToolResultNormalizer() {
  const { messagesStore } = useBeeSeedContext()

  useEffect(() => {
    let applying = false

    const normalize = () => {
      if (applying) return
      const state = messagesStore.getState()
      const nextState: Partial<typeof state> = {}

      let messagesChanged = false
      const messages = new Map(state.messages)
      for (const [channelId, channelMessages] of messages) {
        const nextMessages = normalizeRuntimeMessages(channelMessages)
        if (nextMessages !== channelMessages) {
          messages.set(channelId, nextMessages)
          messagesChanged = true
        }
      }
      if (messagesChanged) nextState.messages = messages

      let loopsChanged = false
      const agentLoops = normalizeAgentLoopMap(state.agentLoops)
      if (agentLoops !== state.agentLoops) {
        loopsChanged = true
      }
      if (loopsChanged) nextState.agentLoops = agentLoops

      let streamsChanged = false
      const streams = new Map(state.streams)
      for (const [key, stream] of streams) {
        const nextStream = normalizeStream(stream)
        if (nextStream !== stream) {
          streams.set(key, nextStream)
          streamsChanged = true
        }
      }
      if (streamsChanged) nextState.streams = streams

      if (Object.keys(nextState).length === 0) return
      applying = true
      messagesStore.setState(nextState)
      applying = false
    }

    normalize()
    return messagesStore.subscribe(normalize)
  }, [messagesStore])

  return null
}

function activeTaskForModelFailure(task: Task, loop: AgentLoopState): boolean {
  if (task.channel_id !== loop.channelId) return false
  if (task.status === 'done' || task.status === 'failed' || task.status === 'blocked') return false
  if (task.scheduler_state === 'verified' || task.scheduler_state === 'failed' || task.scheduler_state === 'cancelled' || task.scheduler_state === 'template') return false
  if (task.assigned_agent_id && task.assigned_agent_id !== loop.agentId) return false

  const createdAt = Date.parse(task.created_at)
  if (!Number.isFinite(createdAt)) return false
  const loopStart = (loop.startedAt || Date.now()) - TASK_FAILURE_SYNC_WINDOW_BEFORE_MS
  const loopEnd = (loop.completedAt || Date.now()) + TASK_FAILURE_SYNC_WINDOW_AFTER_MS
  return createdAt >= loopStart && createdAt <= loopEnd
}

function chooseTaskForModelFailure(tasks: Task[], loop: AgentLoopState): Task | null {
  const candidates = tasks
    .filter((task) => activeTaskForModelFailure(task, loop))
    .sort((a, b) => {
      const aAssigned = a.assigned_agent_id === loop.agentId ? 1 : 0
      const bAssigned = b.assigned_agent_id === loop.agentId ? 1 : 0
      if (aAssigned !== bAssigned) return bAssigned - aAssigned
      return Date.parse(b.created_at) - Date.parse(a.created_at)
    })

  return candidates[0] ?? null
}

function taskToolOutputLooksMutating(output?: string): boolean {
  const text = output?.trim()
  if (!text || !text.startsWith('{')) return false

  try {
    const data = JSON.parse(text) as unknown
    if (!isRecord(data)) return false
    if (isRecord(data.task) || isRecord(data.template) || isRecord(data.schedule)) return true
    if (Array.isArray(data.tasks) && data.tasks.some(isRecord)) return true
    return (
      typeof data.id === 'string'
      && typeof data.channel_id === 'string'
      && typeof data.title === 'string'
    )
  } catch {
    return false
  }
}

function shouldRefreshAfterTaskTool(tool: AgentLoopToolCall): boolean {
  if (tool.name !== TASK_TOOL_NAME || tool.status !== 'success') return false
  const action = typeof tool.args?.action === 'string' ? tool.args.action.trim().toLowerCase() : ''
  if (action) return TASK_TOOL_MUTATING_ACTIONS.has(action)
  return taskToolOutputLooksMutating(tool.output)
}

function TaskToolResultRefreshSync() {
  const { channelsStore, messagesStore, tasksStore } = useBeeSeedContext()
  const processedRef = useRef(new Set<string>())
  const timersRef = useRef(new Map<string, ReturnType<typeof window.setTimeout>>())
  const mountedAtRef = useRef(Date.now() - 1000)

  useEffect(() => {
    const requestRefresh = (channelId: string) => {
      const existing = timersRef.current.get(channelId)
      if (existing) {
        window.clearTimeout(existing)
      }

      const timer = window.setTimeout(() => {
        timersRef.current.delete(channelId)
        if (channelsStore.getState().currentChannelId !== channelId) return

        const taskState = tasksStore.getState()
        void Promise.allSettled([
          taskState.fetchProjects(channelId),
          taskState.fetchTasks(channelId),
          taskState.fetchMetrics(channelId),
          taskState.fetchScheduledTasks(channelId),
          taskState.fetchCalendar(channelId),
        ])
      }, TASK_TOOL_REFRESH_DEBOUNCE_MS)
      timersRef.current.set(channelId, timer)
    }

    const sync = () => {
      const currentChannelId = channelsStore.getState().currentChannelId
      if (!currentChannelId) return

      const { agentLoops } = messagesStore.getState()
      for (const [loopKey, loop] of agentLoops) {
        if (loop.channelId !== currentChannelId) continue

        for (const turn of loop.turns) {
          turn.toolCalls.forEach((tool, index) => {
            if (!shouldRefreshAfterTaskTool(tool)) return
            const completedAt = tool.completedAt ?? 0
            if (completedAt > 0 && completedAt < mountedAtRef.current) return

            const key = [
              loopKey,
              turn.turnNumber,
              index,
              tool.completedAt ?? tool.startedAt,
              tool.output?.length ?? 0,
            ].join(':')
            if (processedRef.current.has(key)) return
            processedRef.current.add(key)
            requestRefresh(loop.channelId)
          })
        }
      }
    }

    sync()
    const unsubscribe = messagesStore.subscribe(sync)
    return () => {
      unsubscribe()
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [channelsStore, messagesStore, tasksStore])

  return null
}

function RuntimeTaskStateNormalizer() {
  const { tasksStore } = useBeeSeedContext()

  useEffect(() => {
    let applying = false

    const normalize = () => {
      if (applying) return
      const state = tasksStore.getState()
      let changed = false
      const tasks = state.tasks.map((task) => {
        const normalized = normalizeTaskForDisplay(task)
        if (normalized !== task) changed = true
        return normalized
      })
      if (!changed) return
      applying = true
      tasksStore.setState({ tasks })
      applying = false
    }

    normalize()
    return tasksStore.subscribe(normalize)
  }, [tasksStore])

  return null
}

function TaskFailureRecoverySync() {
  const { channelsStore, messagesStore, tasksStore } = useBeeSeedContext()
  const processedRef = useRef(new Set<string>())
  const fetchRequestedRef = useRef(new Set<string>())

  useEffect(() => {
    const sync = () => {
      const currentChannelId = channelsStore.getState().currentChannelId
      if (!currentChannelId) return

      const state = messagesStore.getState()
      for (const [key, loop] of state.agentLoops) {
        if (processedRef.current.has(key)) continue
        if (loop.channelId !== currentChannelId || loop.status !== 'error') continue
        if (!isModelStreamInterruptionText(loop.error) && loop.error !== MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE) continue

        const taskState = tasksStore.getState()
        const task = chooseTaskForModelFailure(taskState.tasks, loop)
        if (!task) {
          if (!fetchRequestedRef.current.has(loop.channelId)) {
            fetchRequestedRef.current.add(loop.channelId)
            void taskState.fetchTasks(loop.channelId)
          }
          continue
        }

        processedRef.current.add(key)
        void taskState.updateTask(loop.channelId, task.id, {
          status: 'failed',
          result: MODEL_STREAM_INTERRUPTED_TASK_MESSAGE,
          failure_code: 'model_stream_interrupted',
          failure_detail: MODEL_STREAM_INTERRUPTED_TASK_MESSAGE,
        }).then(() => {
          void tasksStore.getState().fetchMetrics(loop.channelId)
        })
      }
    }

    sync()
    const unsubMessages = messagesStore.subscribe(sync)
    const unsubTasks = tasksStore.subscribe(sync)
    return () => {
      unsubMessages()
      unsubTasks()
    }
  }, [channelsStore, messagesStore, tasksStore])

  return null
}

async function fetchRuntimeConfig(path: string): Promise<AppRuntimeConfig | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) return null
    const data = await response.json() as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data as AppRuntimeConfig
  } catch {
    return null
  }
}

async function loadRuntimeConfig(): Promise<AppRuntimeConfig> {
  return (
    await fetchRuntimeConfig('/api/app-config')
    ?? await fetchRuntimeConfig('/config.json')
    ?? DEFAULT_RUNTIME_CONFIG
  )
}

interface RuntimeErrorBoundaryState {
  error: Error | null
}

class RuntimeErrorBoundary extends Component<{ children: ReactNode }, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RuntimeErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[App] runtime render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#fafafa] px-4">
        <div className="w-full max-w-md rounded-lg border border-[#dddddd] bg-white p-6 shadow-sm">
          <p className="text-base font-medium text-[#181d26]">页面加载失败</p>
          <p className="mt-2 text-sm leading-6 text-[#41454d]">
            应用界面渲染时遇到异常。错误已写入控制台日志，可重试加载页面。
          </p>
          <button
            type="button"
            className="mt-5 rounded-lg bg-[#181d26] px-4 py-2 text-sm font-medium text-white hover:bg-[#0d1218]"
            onClick={() => this.setState({ error: null })}
          >
            重试
          </button>
        </div>
      </div>
    )
  }
}

function appRegistrationPolicy(appConfig: AppRuntimeConfig): 'open' | 'invite' | 'closed' {
  const auth = (appConfig as Record<string, unknown>).auth
  if (!auth || typeof auth !== 'object') return 'open'
  const registration = (auth as Record<string, unknown>).registration
  return registration === 'invite' || registration === 'closed' ? registration : 'open'
}

function MobileGameMascot() {
  return (
    <svg className="mobile-game-mascot" viewBox="0 0 160 140" aria-hidden>
      <defs>
        <linearGradient id="mascotBody" x1="28" x2="132" y1="24" y2="130" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff16a" />
          <stop offset="0.48" stopColor="#ff8ab3" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
        <linearGradient id="mascotWing" x1="24" x2="136" y1="48" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7ee7ff" />
          <stop offset="1" stopColor="#7ee8b5" />
        </linearGradient>
      </defs>
      <path d="M42 83c-17-6-26-17-23-30 2-9 11-11 21-6 10 6 16 16 16 26" fill="url(#mascotWing)" stroke="#5f3b93" strokeWidth="6" strokeLinecap="round" />
      <path d="M118 83c17-6 26-17 23-30-2-9-11-11-21-6-10 6-16 16-16 26" fill="url(#mascotWing)" stroke="#5f3b93" strokeWidth="6" strokeLinecap="round" />
      <path d="M46 48c0-20 15-35 34-35s34 15 34 35v33c0 25-15 43-34 43S46 106 46 81V48Z" fill="url(#mascotBody)" stroke="#5f3b93" strokeWidth="6" />
      <path d="M61 42 52 21l22 10M99 42l9-21-22 10" fill="#fff16a" stroke="#5f3b93" strokeWidth="6" strokeLinejoin="round" />
      <circle cx="67" cy="59" r="7" fill="#5f3b93" />
      <circle cx="93" cy="59" r="7" fill="#5f3b93" />
      <circle cx="69" cy="56" r="2.5" fill="#fff" />
      <circle cx="95" cy="56" r="2.5" fill="#fff" />
      <path d="M70 78c7 7 14 7 20 0" fill="none" stroke="#5f3b93" strokeWidth="5" strokeLinecap="round" />
      <path d="M55 88c-8 6-12 14-11 24M105 88c8 6 12 14 11 24" fill="none" stroke="#5f3b93" strokeWidth="6" strokeLinecap="round" />
      <path d="M58 118h44" stroke="#5f3b93" strokeWidth="6" strokeLinecap="round" />
      <circle cx="34" cy="30" r="7" fill="#ffca3a" stroke="#5f3b93" strokeWidth="4" />
      <circle cx="128" cy="24" r="6" fill="#7ee7ff" stroke="#5f3b93" strokeWidth="4" />
      <circle cx="132" cy="112" r="8" fill="#7ee8b5" stroke="#5f3b93" strokeWidth="4" />
    </svg>
  )
}

function MobileAuthBrand() {
  const { branding } = useAppConfig()
  const [logoFailed, setLogoFailed] = useState(false)
  const hasLogo = Boolean(branding.logo && !logoFailed)
  const initial = Array.from(branding.title)[0] || 'B'

  return (
    <div className="mobile-game-auth-brand flex shrink-0 flex-col items-center px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))] text-center">
      <div className="flex max-w-[18rem] flex-col items-center">
        {hasLogo ? (
          <img
            src={branding.logo}
            alt={branding.title}
            className="mobile-game-auth-logo mb-3 h-12 w-auto max-w-[12rem] rounded-2xl object-contain drop-shadow-[0_4px_0_rgba(95,59,147,0.25)]"
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <div className="mobile-game-logo mobile-game-auth-logo mb-3 flex h-14 w-14 items-center justify-center text-xl font-black text-white">
            {initial}
          </div>
        )}
        <MobileGameMascot />
        <h1 className="mobile-game-title text-[1.85rem] font-black leading-tight">{branding.title}</h1>
        <p className="mobile-game-auth-desc mt-2 rounded-full border-2 border-[#6a4c93]/30 bg-white/60 px-3 py-1 text-xs font-bold leading-5 text-[#6a4c93]">{branding.description}</p>
      </div>
    </div>
  )
}

function MobileAuthPanel({ mode, onModeChange }: {
  mode: 'login' | 'register'
  onModeChange: (mode: 'login' | 'register') => void
}) {
  const { signIn, signUp } = useAuth()
  const { appConfig } = useAppConfig()
  const registrationPolicy = appRegistrationPolicy(appConfig)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isRegister = mode === 'register'
  const registrationClosed = isRegister && registrationPolicy === 'closed'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (registrationClosed) return
    if (isRegister && !name.trim()) {
      setError('请填写昵称')
      return
    }
    if (!email.trim() || !password) {
      setError('请填写邮箱和密码')
      return
    }
    if (isRegister && registrationPolicy === 'invite' && !inviteCode.trim()) {
      setError('请填写邀请码')
      return
    }

    setLoading(true)
    setError('')
    const result = isRegister
      ? await signUp(email.trim(), password, name.trim(), inviteCode.trim() || undefined)
      : await signIn(email.trim(), password)
    if (result.error) setError(result.error)
    setLoading(false)
  }

  return (
    <div className="mobile-game-auth-card shrink-0 px-4 pb-4 pt-4">
      <div className="mb-3 flex rounded-[1.15rem] border-2 border-[#6a4c93] bg-[#fff7cf] p-1 shadow-[0_4px_0_rgba(106,76,147,0.2)]" role="tablist" aria-label="账号操作">
        <button
          type="button"
          className={cn(
            'h-10 flex-1 rounded-[0.9rem] text-sm font-black transition-colors',
            mode === 'login' ? 'bg-gradient-to-br from-[#ff7eb3] to-[#ffca3a] text-white shadow-[0_3px_0_rgba(95,59,147,0.25)]' : 'text-[#6a4c93]',
          )}
          onClick={() => {
            setError('')
            onModeChange('login')
          }}
          aria-selected={mode === 'login'}
          role="tab"
        >
          登录
        </button>
        <button
          type="button"
          className={cn(
            'h-10 flex-1 rounded-[0.9rem] text-sm font-black transition-colors',
            mode === 'register' ? 'bg-gradient-to-br from-[#7c5cff] to-[#41d7ff] text-white shadow-[0_3px_0_rgba(95,59,147,0.25)]' : 'text-[#6a4c93]',
          )}
          onClick={() => {
            setError('')
            onModeChange('register')
          }}
          aria-selected={mode === 'register'}
          role="tab"
        >
          注册
        </button>
      </div>

      <div className="mb-3">
        <h2 className="text-lg font-black text-[#5f3b93]">{isRegister ? '创建勇者档案' : '欢迎回来'}</h2>
        <p className="mt-0.5 text-xs font-bold text-[#9b6ccf]">
          {registrationClosed ? '当前应用暂不开放注册。' : isRegister ? '注册后即可开始对话。' : '登录后继续使用你的对话空间。'}
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-2xl border-2 border-[#ff5f6d]/40 bg-[#fff4ef] px-3 py-2 text-sm font-bold text-[#aa2d00]">
          {error}
        </div>
      )}

      {registrationClosed ? (
        <Button type="button" className="h-12 w-full" onClick={() => onModeChange('login')}>
          返回登录
        </Button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {isRegister && (
            <div className="space-y-1">
              <label htmlFor="mobile-auth-name" className="text-sm font-black text-[#5f3b93]">昵称</label>
              <Input
                id="mobile-auth-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="你的昵称"
                autoComplete="name"
                className="mobile-game-input h-11"
              />
            </div>
          )}
          <div className="space-y-1">
            <label htmlFor="mobile-auth-email" className="text-sm font-black text-[#5f3b93]">邮箱</label>
            <Input
              id="mobile-auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
              className="mobile-game-input h-11"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="mobile-auth-password" className="text-sm font-black text-[#5f3b93]">密码</label>
            <Input
              id="mobile-auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入密码"
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              className="mobile-game-input h-11"
            />
          </div>
          {isRegister && registrationPolicy === 'invite' && (
            <div className="space-y-1">
              <label htmlFor="mobile-auth-invite" className="text-sm font-black text-[#5f3b93]">邀请码</label>
              <Input
                id="mobile-auth-invite"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
                placeholder="输入邀请码"
                autoComplete="one-time-code"
                className="mobile-game-input h-11"
              />
            </div>
          )}
          <Button className="mobile-game-primary-button h-11 w-full text-base" disabled={loading}>
            {loading ? (isRegister ? '注册中...' : '登录中...') : (isRegister ? '注册' : '登录')}
          </Button>
        </form>
      )}
    </div>
  )
}

function appLaunchSubdomain(appConfig?: AppRuntimeConfig | null): string {
  if (appConfig?.platform?.subdomain) return appConfig.platform.subdomain
  if (typeof window === 'undefined') return ''
  return window.location.hostname.split('.')[0] || ''
}

function platformExternalURL(appConfig?: AppRuntimeConfig | null): string {
  if (appConfig?.platform?.external_url) return appConfig.platform.external_url
  if (typeof window === 'undefined') return ''
  return ''
}

function readInviteCodeFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  for (const key of INVITE_CODE_KEYS) {
    const value = url.searchParams.get(key)?.trim()
    if (value) return value
  }
  const hashText = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.charAt(0) === '?' ? hashText.slice(1) : hashText)
  for (const key of INVITE_CODE_KEYS) {
    const value = hashParams.get(key)?.trim()
    if (value) return value
  }
  return ''
}

function appReturnToWithoutInviteCode(): string {
  const url = new URL(window.location.href)
  for (const key of INVITE_CODE_KEYS) url.searchParams.delete(key)
  removeTokenParams(url.searchParams)
  removeParams(url.searchParams, SIGNED_OUT_KEYS)
  const hashText = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.charAt(0) === '?' ? hashText.slice(1) : hashText)
  let changedHash = false
  for (const key of INVITE_CODE_KEYS) {
    if (hashParams.has(key)) changedHash = true
    hashParams.delete(key)
  }
  for (const key of LAUNCH_TOKEN_KEYS) {
    if (hashParams.has(key)) changedHash = true
    hashParams.delete(key)
  }
  for (const key of SIGNED_OUT_KEYS) {
    if (hashParams.has(key)) changedHash = true
    hashParams.delete(key)
  }
  if (changedHash) {
    const nextHash = hashParams.toString()
    url.hash = nextHash ? '#' + nextHash : ''
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function appSignedOutReturnTo(): string {
  const url = new URL(window.location.href)
  for (const key of INVITE_CODE_KEYS) url.searchParams.delete(key)
  removeTokenParams(url.searchParams)
  removeParams(url.searchParams, SIGNED_OUT_KEYS)
  const hashText = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.charAt(0) === '?' ? hashText.slice(1) : hashText)
  for (const key of INVITE_CODE_KEYS) hashParams.delete(key)
  removeTokenParams(hashParams)
  removeParams(hashParams, SIGNED_OUT_KEYS)
  const nextHash = hashParams.toString()
  url.hash = nextHash ? '#' + nextHash : ''
  url.searchParams.set('signed_out', '1')
  return url.toString()
}

function buildHiveAppLaunchURL(appConfig?: AppRuntimeConfig | null): string {
  const platformURL = platformExternalURL(appConfig)
  const subdomain = appLaunchSubdomain(appConfig)
  if (!platformURL || !subdomain || typeof window === 'undefined') return ''

  const launchURL = new URL('/app-launch', platformURL)
  launchURL.searchParams.set('subdomain', subdomain)
  launchURL.searchParams.set('return_to', appReturnToWithoutInviteCode())
  const inviteCode = readInviteCodeFromLocation()
  if (inviteCode) launchURL.searchParams.set('invite_code', inviteCode)
  return launchURL.toString()
}

function buildHiveLogoutURL(appConfig?: AppRuntimeConfig | null): string {
  const platformURL = platformExternalURL(appConfig)
  if (!platformURL || typeof window === 'undefined') return ''
  const logoutURL = new URL('/logout', platformURL)
  logoutURL.searchParams.set('return_to', appSignedOutReturnTo())
  return logoutURL.toString()
}

function beginHiveLogout(appConfig?: AppRuntimeConfig | null) {
  clearAppToken()
  setAppSignedOut(true)
  const logoutURL = buildHiveLogoutURL(appConfig)
  window.location.assign(logoutURL || appSignedOutReturnTo())
}

function AuthScreen() {
  const { appConfig } = useAppConfig()
  const [signedOut, setSignedOut] = useState(() => isAppSignedOut())
  const launchURL = useMemo(() => signedOut ? '' : buildHiveAppLaunchURL(appConfig), [appConfig, signedOut])

  useEffect(() => {
    if (launchURL) window.location.replace(launchURL)
  }, [launchURL])

  function handleSignInAgain() {
    setAppSignedOut(false)
    setSignedOut(false)
    const nextURL = buildHiveAppLaunchURL(appConfig)
    if (nextURL) window.location.replace(nextURL)
  }

  if (signedOut) {
    return (
      <div className="mobile-game-auth-screen flex h-[100dvh] min-h-[100dvh] flex-col items-center justify-center overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
        <MobileAuthBrand />
        <div className="mx-auto mt-4 w-full max-w-sm rounded-[28px] border-4 border-[#2a1854] bg-white p-5 shadow-[0_10px_0_rgba(42,24,84,0.18)]">
          <p className="text-base font-black text-[#2a1854]">已退出登录</p>
          <p className="mt-2 text-sm leading-6 text-[#5f3b93]">
            当前应用会话和 Hive 登录态已清理。重新登录后可以继续进入应用。
          </p>
          <Button className="mt-5 w-full" onClick={handleSignInAgain}>
            重新登录
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mobile-game-auth-screen flex h-[100dvh] min-h-[100dvh] flex-col items-center justify-center overflow-y-auto px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
      <MobileAuthBrand />
      <div className="mx-auto mt-4 w-full max-w-sm rounded-[28px] border-4 border-[#2a1854] bg-white p-5 shadow-[0_10px_0_rgba(42,24,84,0.18)]">
        <p className="text-base font-black text-[#2a1854]">正在进入应用</p>
        <p className="mt-2 text-sm leading-6 text-[#5f3b93]">
          {launchURL ? '请稍候，正在前往 Hive 完成身份校验。' : '当前应用缺少 Hive 入口配置，暂时无法进入。'}
        </p>
      </div>
    </div>
  )
}

function latestWireMessageId(messages: Message[]): number {
  return messages.reduce((latest, message) => {
    return Number.isFinite(message.id) ? Math.max(latest, message.id) : latest
  }, 0)
}

function latestChatMessageId(messages: ChatMessage[] | undefined): number {
  if (!messages) return 0
  return messages.reduce((latest, message) => {
    return typeof message.msgId === 'number' && Number.isFinite(message.msgId)
      ? Math.max(latest, message.msgId)
      : latest
  }, 0)
}

function ChannelUnreadSync() {
  const { api, channelsStore, messagesStore, ws } = useBeeSeedContext()
  const { currentChannelId, updateUnread } = useChannels()
  const currentUnreadCount = useStore(channelsStore, (state) => {
    if (!state.currentChannelId) return 0
    return state.channels.find((channel) => channel.id === state.currentChannelId)?.unread_count ?? 0
  })
  const latestLocalMsgId = useStore(messagesStore, (state) => {
    const channelId = channelsStore.getState().currentChannelId
    return latestChatMessageId(channelId ? state.messages.get(channelId) : undefined)
  })
  const ackedMessageIdsRef = useRef(new Map<string, number>())
  const syncKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!currentChannelId) return

    let active = true
    const syncKey = `${currentChannelId}:${currentUnreadCount}:${latestLocalMsgId}`
    if (syncKeyRef.current === syncKey) {
      updateUnread(currentChannelId, 0)
      return
    }
    syncKeyRef.current = syncKey

    updateUnread(currentChannelId, 0)

    void api.get(`channels/${currentChannelId}/messages`).json<Message[]>().then((messages) => {
      if (!active) return

      const latestMsgId = latestWireMessageId(messages)

      if (latestMsgId > 0 && (ackedMessageIdsRef.current.get(currentChannelId) ?? 0) < latestMsgId) {
        ackedMessageIdsRef.current.set(currentChannelId, latestMsgId)
        ws.send({ type: 'read_ack', channel_id: currentChannelId, msg_id: latestMsgId })
      }

      updateUnread(currentChannelId, 0)
    }).catch(() => {
      if (active) syncKeyRef.current = null
    })

    return () => {
      active = false
    }
  }, [api, currentChannelId, currentUnreadCount, latestLocalMsgId, updateUnread, ws])

  return null
}

function ConnectionFallback() {
  const { ws } = useBeeSeedContext()
  const { state } = useConnection()
  const [visible, setVisible] = useState(false)
  const unhealthy = state === 'disconnected' || state === 'reconnecting'

  useEffect(() => {
    if (!unhealthy) {
      setVisible(false)
      return
    }

    const timer = window.setTimeout(() => setVisible(true), 1200)
    return () => window.clearTimeout(timer)
  }, [unhealthy])

  if (!visible) return null

  return (
    <div className="fixed left-1/2 top-4 z-[60] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-lg border border-[#dddddd] bg-white px-4 py-3 text-[#181d26] shadow-lg">
      <div className="flex items-start gap-3">
        <div className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#aa2d00]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">实时连接暂时不可用</p>
          <p className="mt-1 text-sm leading-5 text-[#41454d]">
            页面已保留当前界面，消息和协作状态可能延迟更新。请重试连接，或稍后再试。
          </p>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-lg bg-[#181d26] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#0d1218]"
          onClick={() => {
            ws.disconnect()
            window.setTimeout(() => ws.connect(), 0)
          }}
        >
          重试
        </button>
      </div>
    </div>
  )
}

const STORAGE_WRITE_PREFIX = 'Wrote '
const STORAGE_WRITE_SUFFIX_RE = /\s+\(\d+\s+bytes\)\.?$/
const STORAGE_REF_RE = /storage:\/\/[^\s)\]}>，。；：！？,;:!?]+/g
const GENERATED_STORAGE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i

function storageRefFromKey(key: string) {
  return `storage://${encodeURI(key.replace(/^\/+/, ''))}`
}

function storageDisplayName(obj: StorageObject): string {
  if (obj.display_name) return obj.display_name
  if (obj.name) return obj.name
  const base = obj.key.split('/').filter(Boolean).pop() || obj.key
  return base.match(GENERATED_STORAGE_NAME_RE)?.[1] || base
}

function normalizeStorageKey(key: string) {
  const trimmed = key.trim().replace(/^storage:\/\//, '').replace(/^\/+/, '')
  try {
    return decodeURI(trimmed)
  } catch {
    return trimmed
  }
}

function storageBasename(key: string) {
  const clean = normalizeStorageKey(key)
  return clean.split('/').filter(Boolean).pop() || clean
}

function storageDirnamePrefix(key: string) {
  const clean = normalizeStorageKey(key)
  const index = clean.lastIndexOf('/')
  return index >= 0 ? clean.slice(0, index + 1) : ''
}

function stripGeneratedStoragePrefix(name: string) {
  return name.match(GENERATED_STORAGE_NAME_RE)?.[1] ?? name
}

function addStorageCandidate(candidates: Set<string>, value: string) {
  const key = normalizeStorageKey(value)
  if (key) candidates.add(key)
}

function storageObjectCandidates(obj: StorageObject) {
  const key = normalizeStorageKey(obj.key)
  const keyName = storageBasename(key)
  const displayName = storageDisplayName(obj)
  const unprefixedKeyName = stripGeneratedStoragePrefix(keyName)
  const dir = storageDirnamePrefix(key)
  const candidates = new Set<string>()

  addStorageCandidate(candidates, key)
  addStorageCandidate(candidates, keyName)
  addStorageCandidate(candidates, displayName)
  addStorageCandidate(candidates, unprefixedKeyName)
  if (dir) {
    addStorageCandidate(candidates, `${dir}${displayName}`)
    addStorageCandidate(candidates, `${dir}${unprefixedKeyName}`)
  }

  return candidates
}

function buildStorageKeyResolutionMap(objects: StorageObject[]) {
  const map = new Map<string, string | null>()

  for (const obj of objects) {
    if (!obj.key || (obj.status && obj.status !== 'available')) continue
    const key = normalizeStorageKey(obj.key)
    if (!key) continue

    for (const candidate of storageObjectCandidates(obj)) {
      const previous = map.get(candidate)
      if (previous && previous !== key) {
        map.set(candidate, null)
      } else if (previous === undefined) {
        map.set(candidate, key)
      }
    }
  }

  return map
}

function resolveStorageKeyFromMap(key: string, resolutionMap: Map<string, string | null>) {
  const clean = normalizeStorageKey(key)
  const resolved = resolutionMap.get(clean)
  return resolved && resolved !== clean ? resolved : null
}

function rewriteStorageRefsInText(
  text: string,
  channelId: string,
  resolveKey: (channelId: string, key: string) => string | null,
) {
  STORAGE_REF_RE.lastIndex = 0
  return text.replace(STORAGE_REF_RE, (ref) => {
    const key = normalizeStorageKey(ref)
    const resolvedKey = resolveKey(channelId, key)
    return resolvedKey ? storageRefFromKey(resolvedKey) : ref
  })
}

function textHasStorageRef(text: string) {
  STORAGE_REF_RE.lastIndex = 0
  return STORAGE_REF_RE.test(text)
}

function storageRefsInText(text: string): string[] {
  STORAGE_REF_RE.lastIndex = 0
  return text.match(STORAGE_REF_RE) ?? []
}

function stripStorageDeliveryNotice(content: string) {
  return content
    .split('\n')
    .filter((line) => !line.trim().replace(/^>\s*/, '').startsWith(STORAGE_DELIVERY_NOTICE_PREFIX))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()
}

function messageClaimsStorageDelivery(content: string) {
  const visibleContent = stripStorageDeliveryNotice(content)
  return !textHasStorageRef(visibleContent) && STORAGE_DELIVERY_CLAIM_RE.test(visibleContent)
}

function appendStorageDeliveryNotice(content: string) {
  if (content.includes(STORAGE_DELIVERY_NOTICE_PREFIX)) return content
  return `${content.trimEnd()}\n\n> ${STORAGE_DELIVERY_NOTICE}`
}

function cleanStorageWriteCandidate(value: string | undefined | null): string | null {
  if (!value) return null
  const key = normalizeStorageKey(value)
  if (!key || key === '.' || key.includes('\n') || key.includes('\r')) return null
  return key
}

function extractKeyFromStorageWriteJSON(value: unknown): string | null {
  if (!isRecord(value)) return null
  for (const key of ['key', 'relative_key', 'relativeKey', 'storage_key', 'storageKey']) {
    const candidate = value[key]
    if (typeof candidate === 'string') {
      const clean = cleanStorageWriteCandidate(candidate)
      if (clean) return clean
    }
  }
  for (const key of ['object', 'file', 'data']) {
    const nested = extractKeyFromStorageWriteJSON(value[key])
    if (nested) return nested
  }
  return null
}

function storageWriteFileNameArg(args?: Record<string, unknown>) {
  const raw = args?.file_name ?? args?.fileName ?? args?.name
  return typeof raw === 'string' ? cleanStorageWriteCandidate(raw) : null
}

function extractStorageWriteKey(
  output: unknown,
  args?: Record<string, unknown>,
  options: { allowArgsFallback?: boolean } = {},
): string | null {
  const allowArgsFallback = options.allowArgsFallback ?? true
  if (typeof output !== 'string') return allowArgsFallback ? storageWriteFileNameArg(args) : null
  const trimmed = output.trim()

  try {
    const parsed = JSON.parse(trimmed) as unknown
    const jsonKey = extractKeyFromStorageWriteJSON(parsed)
    if (jsonKey) return jsonKey
  } catch {
    // Tool output is usually plain text; JSON is only a compatibility path.
  }

  STORAGE_REF_RE.lastIndex = 0
  const ref = STORAGE_REF_RE.exec(trimmed)?.[0]
  const refKey = cleanStorageWriteCandidate(ref)
  if (refKey) return refKey

  const lineKey = cleanStorageWriteCandidate(trimmed.match(STORAGE_WRITE_KEY_LINE_RE)?.[1])
  if (lineKey) return lineKey

  if (trimmed.startsWith(STORAGE_WRITE_PREFIX)) {
    const key = cleanStorageWriteCandidate(
      trimmed
        .slice(STORAGE_WRITE_PREFIX.length)
        .replace(STORAGE_WRITE_SUFFIX_RE, '')
        .trim(),
    )
    if (key) return key
  }

  const actionKey = cleanStorageWriteCandidate(trimmed.match(STORAGE_WRITE_ACTION_RE)?.[1])
  return actionKey ?? (allowArgsFallback ? storageWriteFileNameArg(args) : null)
}

interface StorageWriteRef {
  channelId: string
  agentId: string
  key: string
  ref: string
  completedAt: number
  loopStatus: AgentLoopState['status']
  finalContent?: string
}

function collectStorageWrites(agentLoops: Map<string, AgentLoopState>): StorageWriteRef[] {
  const refs: StorageWriteRef[] = []
  const seen = new Set<string>()

  for (const loop of agentLoops.values()) {
    for (const turn of loop.turns) {
      for (const tool of turn.toolCalls) {
        if (!STORAGE_DELIVERY_TOOL_NAMES.has(tool.name) || tool.status !== 'success') continue
        const key = extractStorageWriteKey(tool.output, tool.args, { allowArgsFallback: tool.name === 'storage_write' })
        if (!key) continue

        const id = `${loop.channelId}:${loop.agentId}:${key}`
        if (seen.has(id)) continue
        seen.add(id)
        refs.push({
          channelId: loop.channelId,
          agentId: loop.agentId,
          key,
          ref: storageRefFromKey(key),
          completedAt: tool.completedAt ?? loop.completedAt ?? turn.completedAt ?? turn.startedAt ?? loop.startedAt,
          loopStatus: loop.status,
          finalContent: loop.finalContent,
        })
      }
    }
  }

  return refs
}

function storageWriteIsTerminal(write: StorageWriteRef) {
  return write.loopStatus !== 'running' && write.loopStatus !== 'waiting_for_user'
}

function channelHasStorageDelivery(messages: ChatMessage[], write: StorageWriteRef, ref: string) {
  return messages.some((message) => {
    if (message.role !== 'assistant' || message.senderId !== write.agentId) return false
    const refs = storageRefsInText(message.content)
    return refs.includes(ref) || refs.includes(write.ref)
  })
}

function fallbackStorageDeliveryMessage(write: StorageWriteRef, ref: string): ChatMessage {
  return {
    role: 'assistant',
    content: `文件已保存到云存储：\n\n引用文件：\n- ${ref}`,
    timestamp: write.completedAt + 1,
    senderId: write.agentId,
    senderType: 'agent',
    isAgent: true,
  }
}

function useStorageWriteDeliverySync() {
  const { channelsStore, messagesStore, storageStore } = useBeeSeedContext()
  const currentChannelId = useStore(channelsStore, (state) => state.currentChannelId)
  const messages = useStore(messagesStore, (state) => state.messages)
  const agentLoops = useStore(messagesStore, (state) => state.agentLoops)
  const storageObjects = useStore(storageStore, (state) => state.objects)
  const storageWrites = useMemo(() => collectStorageWrites(agentLoops), [agentLoops])
  const storageKeyResolutionMap = useMemo(() => buildStorageKeyResolutionMap(storageObjects), [storageObjects])
  const refreshedWritesRef = useRef(new Set<string>())

  useEffect(() => {
    const timers: number[] = []
    for (const write of storageWrites) {
      const id = `${write.channelId}:${write.agentId}:${write.key}:${write.completedAt}`
      if (refreshedWritesRef.current.has(id)) continue
      refreshedWritesRef.current.add(id)

      const storageState = storageStore.getState()
      void storageState.browse(write.channelId, storageState.currentPrefix || '')
      timers.push(window.setTimeout(() => {
        const latestStorageState = storageStore.getState()
        void latestStorageState.browse(write.channelId, latestStorageState.currentPrefix || '')
      }, 1200))
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [storageStore, storageWrites])

  useEffect(() => {
    const writesByChannel = new Map<string, StorageWriteRef[]>()
    for (const write of storageWrites) {
      writesByChannel.set(write.channelId, [...(writesByChannel.get(write.channelId) ?? []), write])
    }

    const nextMessages = new Map(messages)
    let changed = false

    for (const channelId of new Set([...nextMessages.keys(), ...writesByChannel.keys()])) {
      const writes = writesByChannel.get(channelId) ?? []
      const channelMessages = nextMessages.get(channelId)
      if (!channelMessages || channelMessages.length === 0) continue

      let nextChannelMessages = channelMessages
      let channelChanged = false
      for (const write of writes) {
        const resolvedKey = write.channelId === currentChannelId
          ? resolveStorageKeyFromMap(write.key, storageKeyResolutionMap)
          : null
        const ref = storageRefFromKey(resolvedKey ?? write.key)
        let delivered = false

        if (write.finalContent) {
          const targetIndex = findLastAssistantMessageIndex(nextChannelMessages, write)
          if (targetIndex >= 0) {
            const target = nextChannelMessages[targetIndex]
            if (target) {
              const baseContent = stripStorageDeliveryNotice(target.content)
              const existingRefs = storageRefsInText(baseContent)
              const hasCurrentRef = existingRefs.includes(ref) || existingRefs.includes(write.ref)
              const appended = hasCurrentRef
                ? baseContent
                : `${baseContent.trimEnd()}\n\n引用文件：\n- ${ref}`
              delivered = hasCurrentRef || storageRefsInText(appended).includes(ref)
              if (appended !== target.content) {
                nextChannelMessages = [
                  ...nextChannelMessages.slice(0, targetIndex),
                  { ...target, content: appended },
                  ...nextChannelMessages.slice(targetIndex + 1),
                ]
                channelChanged = true
                changed = true
              }
            }
          }
        }

        if (!delivered && storageWriteIsTerminal(write) && !channelHasStorageDelivery(nextChannelMessages, write, ref)) {
          nextChannelMessages = [...nextChannelMessages, fallbackStorageDeliveryMessage(write, ref)]
          channelChanged = true
          changed = true
        }
      }

      nextChannelMessages = nextChannelMessages.map((message) => {
        if (message.role !== 'assistant') return message
        if (!messageClaimsStorageDelivery(message.content)) return message
        const content = appendStorageDeliveryNotice(message.content)
        if (content === message.content) return message
        channelChanged = true
        changed = true
        return { ...message, content }
      })

      if (channelChanged) {
        nextMessages.set(channelId, nextChannelMessages)
      }
    }

    if (changed) {
      messagesStore.setState({ messages: nextMessages })
    }
  }, [currentChannelId, messages, messagesStore, storageKeyResolutionMap, storageWrites])
}

function findLastAssistantMessageIndex(messages: ChatMessage[], write: StorageWriteRef) {
  const expectedContent = write.finalContent?.trim()
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    if (message.contentType === 'image') continue
    if (message.senderId !== write.agentId) continue
    if (expectedContent && message.content.trim() === expectedContent) return i
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    if (message.contentType === 'image') continue
    if (message.senderId !== write.agentId) continue
    if (message.timestamp < write.completedAt - 30_000) continue
    return i
  }
  return -1
}

function storageResolutionId(channelId: string, key: string) {
  return `${channelId}\u0000${normalizeStorageKey(key)}`
}

function isStorageKeyResolvedDetail(value: unknown): value is { channelId: string; requestedKey: string; resolvedKey: string } {
  return (
    isRecord(value)
    && typeof value.channelId === 'string'
    && typeof value.requestedKey === 'string'
    && typeof value.resolvedKey === 'string'
  )
}

function useStorageReferenceMetadataSync() {
  const { channelsStore, messagesStore, storageStore } = useBeeSeedContext()
  const currentChannelId = useStore(channelsStore, (state) => state.currentChannelId)
  const messages = useStore(messagesStore, (state) => state.messages)
  const storageObjects = useStore(storageStore, (state) => state.objects)
  const storageKeyResolutionMap = useMemo(() => buildStorageKeyResolutionMap(storageObjects), [storageObjects])
  const [resolvedKeys, setResolvedKeys] = useState<Map<string, string>>(() => new Map())

  useEffect(() => {
    function handleStorageKeyResolved(event: Event) {
      const detail = (event as CustomEvent<unknown>).detail
      if (!isStorageKeyResolvedDetail(detail)) return

      const requestedKey = normalizeStorageKey(detail.requestedKey)
      const resolvedKey = normalizeStorageKey(detail.resolvedKey)
      if (!requestedKey || !resolvedKey || requestedKey === resolvedKey) return

      setResolvedKeys((current) => {
        const id = storageResolutionId(detail.channelId, requestedKey)
        if (current.get(id) === resolvedKey) return current
        const next = new Map(current)
        next.set(id, resolvedKey)
        return next
      })
    }

    window.addEventListener(STORAGE_KEY_RESOLVED_EVENT, handleStorageKeyResolved)
    return () => window.removeEventListener(STORAGE_KEY_RESOLVED_EVENT, handleStorageKeyResolved)
  }, [])

  useEffect(() => {
    const resolveKey = (channelId: string, key: string) => {
      const cleanKey = normalizeStorageKey(key)
      const resolvedFromEvent = resolvedKeys.get(storageResolutionId(channelId, cleanKey))
      if (resolvedFromEvent) return resolvedFromEvent
      if (channelId !== currentChannelId) return null
      return resolveStorageKeyFromMap(cleanKey, storageKeyResolutionMap)
    }

    const nextMessages = new Map(messages)
    let changed = false

    for (const [channelId, channelMessages] of nextMessages) {
      let channelChanged = false
      const rewritten = channelMessages.map((message) => {
        if (!message.content.includes('storage://')) return message
        const content = rewriteStorageRefsInText(message.content, channelId, resolveKey)
        if (content === message.content) return message
        channelChanged = true
        return { ...message, content }
      })

      if (channelChanged) {
        nextMessages.set(channelId, rewritten)
        changed = true
      }
    }

    if (changed) {
      messagesStore.setState({ messages: nextMessages })
    }
  }, [currentChannelId, messages, messagesStore, resolvedKeys, storageKeyResolutionMap])
}

function useStorageFileOpenEnhancer() {
  const { channelsStore, storageStore } = useBeeSeedContext()
  const currentChannelId = useStore(channelsStore, (state) => state.currentChannelId)
  const objects = useStore(storageStore, (state) => state.filteredObjects())

  useEffect(() => {
    function storageRows() {
      return Array.from(document.querySelectorAll<HTMLElement>('div.group.flex.items-center.gap-3.px-4.py-2'))
        .filter((row) => row.querySelector('button[title="下载"]') && row.querySelector('button[title="引用到聊天"]'))
    }

    function markRows() {
      for (const row of storageRows()) {
        row.classList.add('beeseed-storage-file-row')
        row.setAttribute('role', 'button')
        row.setAttribute('tabindex', '0')
        row.setAttribute('aria-label', '打开文件')
      }
    }

    markRows()
    const observer = new MutationObserver(markRows)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [objects])

  useEffect(() => {
    function resolveObjectFromRow(row: HTMLElement): StorageObject | null {
      const rows = Array.from(document.querySelectorAll<HTMLElement>('div.beeseed-storage-file-row'))
      const byIndex = objects[rows.indexOf(row)]
      if (byIndex) return byIndex

      const name = row.querySelector<HTMLElement>('.text-sm.truncate')?.textContent?.trim()
      return objects.find((obj) => storageDisplayName(obj) === name) ?? null
    }

    async function openRow(row: HTMLElement) {
      if (!currentChannelId) return
      const obj = resolveObjectFromRow(row)
      if (!obj) return
      const url = await storageStore.getState().downloadFile(currentChannelId, obj.key)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    }

    function isInteractiveTarget(target: EventTarget | null) {
      return target instanceof HTMLElement && Boolean(target.closest('button, a, input, textarea, select'))
    }

    function handleClick(event: MouseEvent) {
      if (isInteractiveTarget(event.target)) return
      const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('div.beeseed-storage-file-row') : null
      if (!row) return
      event.preventDefault()
      void openRow(row)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('div.beeseed-storage-file-row') : null
      if (!row || event.target !== row) return
      event.preventDefault()
      void openRow(row)
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [currentChannelId, objects, storageStore])
}

function StoragePreviewErrorLocalizer() {
  useEffect(() => {
    function localize() {
      document.querySelectorAll<HTMLElement>('div, p, span, pre').forEach((node) => {
        if (node.children.length > 0) return
        const text = node.textContent ?? ''
        if (!STORAGE_PREVIEW_ERROR_TEXT_RE.test(text)) return
        node.textContent = STORAGE_DOWNLOAD_FAILURE_MESSAGE
      })
    }

    localize()
    const observer = new MutationObserver(localize)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [])

  return null
}

function StorageDeliveryBridge() {
  useStorageWriteDeliverySync()
  useStorageReferenceMetadataSync()
  useStorageFileOpenEnhancer()
  return <StoragePreviewErrorLocalizer />
}

function WelcomeGuide() {
  const { user } = useAuth()
  const { channels, currentChannelId, loading, fetchChannels, joinChannel } = useChannels()
  const { branding } = useAppConfig()
  const { activeFeature, setActiveFeature } = useDetailPanel()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [checkedChannels, setCheckedChannels] = useState(false)
  const dialogWasOpenRef = useRef(false)

  useEffect(() => {
    if (activeFeature !== 'chat') return

    let active = true
    setCheckedChannels(false)
    void fetchChannels().finally(() => {
      if (active) setCheckedChannels(true)
    })

    return () => {
      active = false
    }
  }, [activeFeature, fetchChannels])

  useEffect(() => {
    if (dialogWasOpenRef.current && !createDialogOpen && !currentChannelId && channels.length > 0) {
      joinChannel(channels[0].id)
    }
    dialogWasOpenRef.current = createDialogOpen
  }, [channels, createDialogOpen, currentChannelId, joinChannel])

  if (activeFeature !== 'chat' || loading || !checkedChannels || channels.length > 0) return null

  const userName = user?.name?.trim()
  const appTitle = branding.title || 'BeeSeed'

  return (
    <>
      <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-30 overflow-y-auto bg-white p-5 md:left-[200px] md:p-8">
        <div className="flex h-full min-h-0 items-center justify-center">
          <section className="pointer-events-auto grid w-full max-w-5xl gap-6 py-[max(1rem,env(safe-area-inset-top))] md:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)] md:gap-8 md:py-0">
            <div className="flex min-w-0 flex-col justify-center">
              <div className="mb-5 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#aa2d00]" aria-hidden />
                <span className="text-sm font-medium text-[#41454d]">首次开始</span>
              </div>
              <h1 className="max-w-2xl text-2xl font-medium leading-tight tracking-[0] text-[#181d26] sm:text-3xl md:text-4xl">
                {userName ? `${userName}，欢迎进入 ${appTitle}` : `欢迎进入 ${appTitle}`}
              </h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-[#41454d] md:text-base">
                你可以先创建一个频道，把成员、Agent、任务和知识上下文放在同一个工作空间里；也可以先进入知识库或任务视图整理资料与行动项。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button type="button" onClick={() => setCreateDialogOpen(true)}>
                  新建频道
                </Button>
                <Button type="button" variant="outline" onClick={() => setActiveFeature('knowledge')}>
                  进入知识库
                </Button>
              </div>
            </div>

            <div className="grid content-center gap-3">
              <GuideStep
                tone="dark"
                label="频道"
                title="从一个主题开始协作"
                description="为项目、客户或工作流创建频道，后续对话和上下文都会聚合在这里。"
              />
              <GuideStep
                tone="forest"
                label="Agent"
                title="让 Agent 加入执行"
                description="频道创建后，默认 Agent 会按当前策略加入，你也可以在管理后台继续配置。"
              />
              <GuideStep
                tone="coral"
                label="知识库"
                title="把资料变成可检索上下文"
                description="上传或整理知识后，Agent 可以在对话和任务中引用这些内容。"
              />
            </div>
          </section>
        </div>
      </div>
      <CreateChannelDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </>
  )
}

function ChannelSelectionPersistence() {
  const { authStore, channelsStore } = useBeeSeedContext()
  const user = useStore(authStore, (state) => state.user)
  const channels = useStore(channelsStore, (state) => state.channels)
  const currentChannelId = useStore(channelsStore, (state) => state.currentChannelId)
  const loading = useStore(channelsStore, (state) => state.loading)
  const fetchRequestedForUserRef = useRef<string | null>(null)
  const activeUserRef = useRef<string | null>(null)
  const [checkedChannelsForUser, setCheckedChannelsForUser] = useState<string | null>(null)
  const channelIds = useMemo(() => new Set(channels.map((channel) => channel.id)), [channels])
  const channelListReady = channels.length > 0 || (checkedChannelsForUser === user?.id && !loading)

  useLayoutEffect(() => {
    const userId = user?.id ?? null
    if (activeUserRef.current === userId) return

    activeUserRef.current = userId
    setCheckedChannelsForUser(null)
    fetchRequestedForUserRef.current = null

    if (!userId) return
    if (channelsStore.getState().currentChannelId) {
      channelsStore.getState().setCurrentChannel(null)
    }
  }, [channelsStore, user?.id])

  useLayoutEffect(() => {
    if (!user?.id) {
      fetchRequestedForUserRef.current = null
      return
    }
    if (checkedChannelsForUser === user.id || fetchRequestedForUserRef.current === user.id) return
    fetchRequestedForUserRef.current = user.id
    let active = true
    void channelsStore.getState().fetchChannels().finally(() => {
      if (active && activeUserRef.current === user.id) {
        setCheckedChannelsForUser(user.id)
      }
    })

    return () => {
      active = false
    }
  }, [checkedChannelsForUser, channelsStore, user?.id])

  useEffect(() => {
    if (!user?.id || !currentChannelId || !channelListReady) return
    if (!channelIds.has(currentChannelId)) return
    writeLastChannelId(user.id, currentChannelId)
  }, [channelIds, channelListReady, currentChannelId, user?.id])

  useLayoutEffect(() => {
    if (!user?.id || !channelListReady || loading) return

    const savedChannelId = readLastChannelId(user.id)
    const hasLoadedChannels = channels.length > 0
    const currentChannelIsValid = currentChannelId ? channelIds.has(currentChannelId) : false

    if (currentChannelId && currentChannelIsValid) {
      writeLastChannelId(user.id, currentChannelId)
      return
    }

    if (!hasLoadedChannels) {
      if (currentChannelId) {
        channelsStore.getState().setCurrentChannel(null)
      }
      if (savedChannelId) {
        removeLastChannelId(user.id)
      }
      return
    }

    if (savedChannelId && hasLoadedChannels && channelIds.has(savedChannelId)) {
      if (currentChannelId !== savedChannelId) {
        channelsStore.getState().setCurrentChannel(savedChannelId)
      }
      return
    }

    if (savedChannelId && hasLoadedChannels && !channelIds.has(savedChannelId)) {
      removeLastChannelId(user.id)
    }

    const fallbackChannelId = defaultChannelId(channels)
    if (fallbackChannelId && currentChannelId !== fallbackChannelId) {
      channelsStore.getState().setCurrentChannel(fallbackChannelId)
    }
  }, [channelIds, channelListReady, channels, channels.length, channelsStore, currentChannelId, loading, user?.id])

  return null
}

function GuideStep({
  tone,
  label,
  title,
  description,
}: {
  tone: 'dark' | 'forest' | 'coral'
  label: string
  title: string
  description: string
}) {
  const toneClass = {
    dark: 'bg-[#181d26] text-white',
    forest: 'bg-[#0a2e0e] text-white',
    coral: 'bg-[#aa2d00] text-white',
  }[tone]

  return (
    <div className="rounded-lg border border-[#dddddd] bg-[#f8fafc] p-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-medium ${toneClass}`}>
          {label.slice(0, 1)}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#181d26]">{title}</p>
          <p className="mt-1 text-sm leading-5 text-[#41454d]">{description}</p>
        </div>
      </div>
    </div>
  )
}

function normalizeKnowledgeState(state: Record<string, unknown>): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}

  if (!Array.isArray(state.sources)) patch.sources = []
  if (!Array.isArray(state.searchResults)) patch.searchResults = []
  if (!Array.isArray(state.entityResults)) patch.entityResults = []

  return Object.keys(patch).length > 0 ? patch : null
}

function KnowledgeStoreStabilizer() {
  const { api, knowledgeStore } = useBeeSeedContext()
  const { activeFeature } = useDetailPanel()
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const stabilize = () => {
      const patch = normalizeKnowledgeState(knowledgeStore.getState() as unknown as Record<string, unknown>)
      if (patch) knowledgeStore.setState(patch)
    }

    stabilize()
    return knowledgeStore.subscribe(stabilize)
  }, [knowledgeStore])

  useEffect(() => {
    const original = knowledgeStore.getState()

    knowledgeStore.setState({
      loadSources: async () => {
        knowledgeStore.setState({ loading: true })
        try {
          const payload = await api.get('knowledge').json<unknown>()
          knowledgeStore.setState({ sources: normalizeSourcesPayload(payload), loading: false })
          setNotice(null)
        } catch (error) {
          console.error('[Knowledge] load sources failed', error)
          knowledgeStore.setState({ sources: [], loading: false })
          setNotice('知识库加载失败，请稍后重试')
        }
      },
      search: async (query: string) => {
        knowledgeStore.setState({ searching: true, searchQuery: query })
        try {
          const payload = await api.post('knowledge/search', { json: { query } }).json<unknown>()
          knowledgeStore.setState({
            searchResults: normalizeSearchResultsPayload(payload),
            entityResults: normalizeEntitiesPayload(payload),
            searching: false,
          })
          setNotice(null)
        } catch (error) {
          console.error('[Knowledge] search failed', error)
          knowledgeStore.setState({ searchResults: [], entityResults: [], searching: false })
          setNotice('知识库搜索失败，请稍后重试')
        }
      },
    })

    return () => {
      knowledgeStore.setState({
        loadSources: original.loadSources,
        search: original.search,
      })
    }
  }, [api, knowledgeStore])

  if (!notice || activeFeature !== 'knowledge') return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-lg border border-[#dddddd] bg-white px-4 py-3 text-sm text-[#181d26] shadow-lg">
      {notice}
    </div>
  )
}

export function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null)
  const showAgentLoopFixture = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('agent-loop-fixture')

  useEffect(() => installConsoleRedaction(), [])
  useEffect(() => installImagePreviewOptimizer(), [])

  useEffect(() => {
    let active = true
    void loadRuntimeConfig().then((config) => {
      if (!active) return
      applyDocumentBranding(resolveAppBranding(config))
      setRuntimeConfig(config)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    function handleConfigUpdate(event: Event) {
      const nextConfig = (event as CustomEvent<AppRuntimeConfig>).detail
      if (!nextConfig || typeof nextConfig !== 'object') return
      applyDocumentBranding(resolveAppBranding(nextConfig))
      setRuntimeConfig(nextConfig)
    }

    window.addEventListener('beeseed:app-config-updated', handleConfigUpdate)
    return () => window.removeEventListener('beeseed:app-config-updated', handleConfigUpdate)
  }, [])

  if (showAgentLoopFixture) return <AgentLoopFixturePage />

  if (!runtimeConfig) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#fafafa] text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  return (
    <RuntimeErrorBoundary>
      <BeeSeedProvider config={{ workerUrl: '', appConfig: runtimeConfig, onSignOut: () => beginHiveLogout(runtimeConfig) }}>
        <AuthGuard fallback={<AuthScreen />}>
          <StorageToolResultNormalizer />
          <RuntimeTaskStateNormalizer />
          <TaskToolResultRefreshSync />
          <TaskFailureRecoverySync />
          <ChannelUnreadSync />
          <ChannelSelectionPersistence />
          <ConnectionFallback />
          <StorageDeliveryBridge />
          <KnowledgeStoreStabilizer />
          <div className="relative h-[100dvh]">
            <RuntimeAppLayout />
            <WelcomeGuide />
          </div>
        </AuthGuard>
      </BeeSeedProvider>
    </RuntimeErrorBoundary>
  )
}
