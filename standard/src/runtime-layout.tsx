import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { AlertCircle, Copy, Menu, RotateCw, X } from 'lucide-react'
import {
  AppLayout as SdkAppLayout,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DetailPanel,
  LeftNavSidebar,
  MarkdownRenderer,
  MessageBubble,
  MessageInput,
  AgentTodoRail,
  ToolGroupBubble,
  cn,
  useAppConfig,
  useAuth,
  useChannels,
  useChat,
  useDetailPanel,
  useStorage,
  useTasks,
  type AgentLoopEventItem,
  type AgentLoopState,
  type ChannelWithMeta,
  type ChannelMemberInfo,
  type ChatMessage,
  type SkillShortcutOption,
  type StreamState,
  type Task,
} from '@beeseed/beeseed-sdk'
import {
  MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE,
  isModelStreamInterruptionText,
  userFacingAgentLoopError,
} from './runtime-recovery'
import { resolveAgentSkillSummaries } from './agent-skill-catalog'
import { RuntimeAgentRunTranscript, RuntimeThinkingBlock } from './runtime-agent-run-transcript'

const CHAT_MAX_WIDTH = 820
const CHAT_UPLOAD_PREFIX = '__chat_uploads/'

function StandardTemplateVersion() {
  const version = __STANDARD_TEMPLATE_VERSION__

  return (
    <div
      className="fixed bottom-3 right-3 z-40 rounded-md border border-border/80 bg-background/95 px-2 py-1 text-[10px] leading-none text-muted-foreground shadow-sm max-md:bottom-[max(0.75rem,env(safe-area-inset-bottom))] max-md:right-[max(0.75rem,env(safe-area-inset-right))]"
      title={`标准模板版本 v${version}`}
    >
      v{version}
    </div>
  )
}

const CLIPBOARD_MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/msword': 'doc',
  'application/octet-stream': 'bin',
  'application/pdf': 'pdf',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/markdown': 'md',
  'text/plain': 'txt',
}

function storageRefFromKey(key: string) {
  return `storage://${encodeURI(key.replace(/^\/+/, ''))}`
}

function clipboardHasFileSignal(data: DataTransfer) {
  const types = Array.from(data.types ?? [])
  if (types.includes('Files')) return true
  if (types.includes('application/x-moz-file')) return true
  if (types.includes('DownloadURL')) return true
  if (types.includes('text/uri-list')) {
    try {
      if (/^file:/im.test(data.getData('text/uri-list'))) return true
    } catch {
      // Ignore unreadable URI metadata; item.kind below is the stronger signal.
    }
  }
  return Array.from(data.items ?? []).some((item) => item.kind === 'file')
}

function clipboardFileId(file: File) {
  return `${file.name}:${file.size}:${file.type}:${file.lastModified}`
}

function clipboardMimeExtension(type: string) {
  const normalized = type.trim().toLowerCase()
  if (CLIPBOARD_MIME_EXTENSIONS[normalized]) return CLIPBOARD_MIME_EXTENSIONS[normalized]
  const slash = normalized.indexOf('/')
  if (slash < 0) return 'bin'
  return normalized.slice(slash + 1).replace(/[^a-z0-9]+/g, '') || 'bin'
}

function fallbackClipboardFileName(file: File, index: number) {
  const base = file.type.startsWith('image/') ? 'clipboard-image' : 'clipboard-file'
  const ext = clipboardMimeExtension(file.type || 'application/octet-stream')
  return `${base}-${Date.now()}-${index + 1}.${ext}`
}

function fallbackClipboardFileNameForType(type: string, index: number) {
  const base = type.startsWith('image/') ? 'clipboard-image' : 'clipboard-file'
  const ext = clipboardMimeExtension(type || 'application/octet-stream')
  return `${base}-${Date.now()}-${index + 1}.${ext}`
}

function normalizeClipboardFile(file: File, index: number) {
  const name = file.name.trim() || fallbackClipboardFileName(file, index)
  if (name === file.name) return file

  try {
    return new File([file], name, {
      type: file.type || 'application/octet-stream',
      lastModified: file.lastModified || Date.now(),
    })
  } catch {
    return file
  }
}

function clipboardBlobTypeLooksLikeFile(type: string) {
  const normalized = type.trim().toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('image/')) return true
  if (normalized.startsWith('application/')) return true
  if (normalized === 'text/markdown' || normalized === 'text/csv') return true
  return false
}

async function extractAsyncClipboardFiles() {
  if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
    return { files: [] as File[], error: '当前浏览器无法读取剪贴板文件内容' }
  }

  try {
    const items = await navigator.clipboard.read()
    const files: File[] = []
    const seen = new Set<string>()

    for (const item of items) {
      const fileTypes = item.types.filter(clipboardBlobTypeLooksLikeFile)
      for (const type of fileTypes) {
        const blob = await item.getType(type)
        if (blob.size === 0) continue
        const fileType = blob.type || type || 'application/octet-stream'
        const file = normalizeClipboardFile(
          new File([blob], fallbackClipboardFileNameForType(fileType, files.length), {
            type: fileType,
            lastModified: Date.now(),
          }),
          files.length,
        )
        const id = clipboardFileId(file)
        if (seen.has(id)) continue
        seen.add(id)
        files.push(file)
      }
    }

    return { files, error: null }
  } catch (err) {
    return {
      files: [] as File[],
      error: err instanceof Error && err.message ? err.message : '剪贴板文件读取失败',
    }
  }
}

function extractClipboardFiles(data: DataTransfer) {
  const files: File[] = []
  const seen = new Set<string>()
  let unreadableCount = 0

  const addFile = (file: File | null, index: number) => {
    if (!file) {
      unreadableCount += 1
      return
    }
    const rawId = clipboardFileId(file)
    if (seen.has(rawId)) return
    const normalized = normalizeClipboardFile(file, index)
    const id = clipboardFileId(normalized)
    if (seen.has(id)) return
    seen.add(rawId)
    seen.add(id)
    files.push(normalized)
  }

  Array.from(data.files ?? []).forEach((file, index) => addFile(file, index))
  Array.from(data.items ?? []).forEach((item, index) => {
    if (item.kind !== 'file') return
    addFile(item.getAsFile(), files.length + index)
  })

  return { files, hasFileSignal: clipboardHasFileSignal(data), unreadableCount }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy path for embedded or non-secure contexts.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function readableAgentName(member: ChannelMemberInfo) {
  return member.display_name || member.nickname || member.agent_id || member.user_id || 'unknown'
}

function readableMemberName(member?: ChannelMemberInfo) {
  if (!member) return ''
  return member.display_name || member.nickname || member.agent_id || member.user_id || 'unknown'
}

function normalizeExtInfo(extInfo: ChannelMemberInfo['ext_info']) {
  if (!extInfo) return {}
  if (typeof extInfo === 'string') {
    try {
      return JSON.parse(extInfo) as Record<string, unknown>
    } catch {
      return {}
    }
  }
  return extInfo
}

function buildSkillShortcutOptions(members: ChannelMemberInfo[]): SkillShortcutOption[] {
  const byName = new Map<string, SkillShortcutOption>()

  for (const member of members) {
    if (member.member_type !== 'agent' || !member.agent_id) continue
    for (const skill of resolveAgentSkillSummaries(normalizeExtInfo(member.ext_info))) {
      const current = byName.get(skill.name) ?? {
        name: skill.name,
        display_name: skill.display_name,
        description: skill.description,
        icon_url: skill.icon_url,
        source: 'agent' as const,
        agents: [],
      }
      if (!current.agents?.some((agent) => agent.agent_id === member.agent_id)) {
        current.agents = [
          ...(current.agents ?? []),
          { agent_id: member.agent_id, agent_name: readableAgentName(member) },
        ]
      }
      byName.set(skill.name, current)
    }
  }

  return [...byName.values()]
}

const TASK_STATUS_LABEL: Record<Task['status'], string> = {
  pending: '待处理',
  in_progress: '进行中',
  done: '已完成',
  failed: '失败',
  blocked: '阻塞',
}

const TASK_STATUS_CLASS: Record<Task['status'], string> = {
  pending: 'border-[#dddddd] bg-[#f8fafc] text-[#41454d]',
  in_progress: 'border-[#458fff] bg-[#eef5ff] text-[#254fad]',
  done: 'border-[#39bf45] bg-[#f0fbf1] text-[#006400]',
  failed: 'border-[#f1b29d] bg-[#fff4ef] text-[#aa2d00]',
  blocked: 'border-[#d9a441] bg-[#fff8df] text-[#6f4d00]',
}

const TASK_SORT_WEIGHT: Record<Task['status'], number> = {
  in_progress: 0,
  blocked: 1,
  pending: 2,
  failed: 3,
  done: 4,
}

function taskStatusLabel(status: Task['status']) {
  return TASK_STATUS_LABEL[status] ?? status
}

function taskStatusClass(status: Task['status']) {
  return TASK_STATUS_CLASS[status] ?? TASK_STATUS_CLASS.pending
}

function taskAssigneeLabel(task: Task, members: ChannelMemberInfo[]) {
  if (task.assigned_name?.trim()) return task.assigned_name.trim()
  if (task.assigned_agent_id) {
    const agent = members.find((member) => member.member_type === 'agent' && member.agent_id === task.assigned_agent_id)
    return readableMemberName(agent) || task.assigned_agent_id
  }
  if (task.assigned_user_id) {
    const user = members.find((member) => member.member_type === 'user' && member.user_id === task.assigned_user_id)
    return readableMemberName(user) || task.assigned_user_id
  }
  return '未分配'
}

function taskReferenceText(task: Task, assignedLabel: string) {
  const status = taskStatusLabel(task.status)
  return `任务引用：#${task.id}「${task.title}」 | 状态：${status} | 执行人：${assignedLabel}`
}

function taskSearchText(task: Task, members: ChannelMemberInfo[]) {
  return [
    task.id,
    task.title,
    task.description,
    taskStatusLabel(task.status),
    task.assigned_agent_id,
    task.assigned_user_id,
    taskAssigneeLabel(task, members),
  ].filter(Boolean).join(' ').toLowerCase()
}

function taskUpdatedAt(task: Task) {
  const value = Date.parse(task.updated_at || task.created_at)
  return Number.isFinite(value) ? value : 0
}

function compareShortcutTasks(a: Task, b: Task) {
  const statusWeight = (TASK_SORT_WEIGHT[a.status] ?? 9) - (TASK_SORT_WEIGHT[b.status] ?? 9)
  if (statusWeight !== 0) return statusWeight
  const updated = taskUpdatedAt(b) - taskUpdatedAt(a)
  if (updated !== 0) return updated
  return a.title.localeCompare(b.title, 'zh-CN')
}

function isTaskToolbarButton(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  const button = target.closest('button')
  if (!button) return false
  return button.textContent?.replace(/\s+/g, '').trim() === '任务'
}

function Check({ className }: { className?: string }) {
  return <span className={cn('inline-flex items-center justify-center text-[13px]', className)} aria-hidden>✓</span>
}

function PanelRight({ className }: { className?: string }) {
  return <span className={cn('inline-flex items-center justify-center text-sm', className)} aria-hidden>▣</span>
}

function Square({ className }: { className?: string }) {
  return <span className={cn('inline-block border border-current', className)} aria-hidden />
}

type TimelineInput =
  | { kind: 'message'; message: ChatMessage; timestamp: number; order: number; messageId?: number }
  | { kind: 'agent_event'; loop: AgentLoopState; event: AgentLoopEventItem; timestamp: number; order: number; messageId?: number }
  | { kind: 'legacy_loop'; loop: AgentLoopState; timestamp: number; order: number }

type TimelineGroup =
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'tool_group'; messages: ChatMessage[] }
  | { kind: 'agent_loop'; key: string; loop: AgentLoopState; events: AgentLoopEventItem[]; finalMessage?: ChatMessage }

function channelsForDisplay(channels: ChannelWithMeta[], currentChannelId: string | null): ChannelWithMeta[] {
  if (!currentChannelId) return channels
  let changed = false
  const nextChannels = channels.map((channel) => {
    if (channel.id !== currentChannelId || channel.unread_count === 0) return channel
    changed = true
    return { ...channel, unread_count: 0 }
  })
  return changed ? nextChannels : channels
}

function agentLoopActivityAt(loop: AgentLoopState): number {
  let latest = loop.completedAt ?? loop.startedAt ?? 0
  for (const event of loop.events ?? []) {
    latest = Math.max(latest, event.timestamp)
  }
  for (const turn of loop.turns) {
    latest = Math.max(latest, turn.completedAt ?? turn.startedAt ?? 0)
    for (const tool of turn.toolCalls) {
      latest = Math.max(latest, tool.completedAt ?? tool.startedAt ?? 0)
    }
  }
  return latest
}

function agentLoopKey(loop: AgentLoopState): string {
  return `${loop.agentId}:${loop.runId || loop.startedAt}`
}

function agentDisplayName(members: ChannelMemberInfo[] | undefined, agentId: string) {
  const member = members?.find((item) => item.agent_id === agentId)
  return member?.display_name || agentId
}

function memberDisplayName(member: ChannelMemberInfo) {
  return member.display_name || member.nickname || member.agent_id || member.user_id || 'unknown'
}

function displayMemberForMessage(members: ChannelMemberInfo[] | undefined, message: ChatMessage) {
  if (!members?.length || !message.senderId) return undefined
  if (message.senderType === 'agent' || message.isAgent) {
    return members.find((member) => member.member_type === 'agent' && member.agent_id === message.senderId)
  }
  if (message.senderType === 'user') {
    return members.find((member) => member.member_type === 'user' && member.user_id === message.senderId)
  }
  return undefined
}

function applyMemberDisplay(messages: ChatMessage[], members: ChannelMemberInfo[] | undefined) {
  if (!members?.length) return messages
  const agentNames = new Map(
    members
      .filter((member) => member.member_type === 'agent' && member.agent_id)
      .map((member) => [member.agent_id!, memberDisplayName(member)]),
  )

  return messages.map((message) => {
    const member = displayMemberForMessage(members, message)
    const selectedSkills = message.selectedSkills?.map((skill) => {
      const agentName = agentNames.get(skill.agent_id)
      return agentName && agentName !== skill.agent_name ? { ...skill, agent_name: agentName } : skill
    })
    if (!member) {
      return selectedSkills && selectedSkills !== message.selectedSkills ? { ...message, selectedSkills } : message
    }
    const senderName = memberDisplayName(member)
    const senderAvatarUrl = member.avatar_url
    if (message.senderName === senderName && message.senderAvatarUrl === senderAvatarUrl && selectedSkills === message.selectedSkills) {
      return message
    }
    return { ...message, senderName, senderAvatarUrl, selectedSkills }
  })
}

function stripStorageReferencesForAgentLoop(content: string): string {
  const lines = content.split('\n')
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (/^引用文件[:：]?$/.test(trimmed)) continue
    if (/^-?\s*storage:\/\//.test(trimmed)) continue
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function normalizedAgentLoopText(content?: string): string {
  return stripStorageReferencesForAgentLoop(content ?? '').replace(/\s+/g, ' ').trim()
}

function isAgentLoopFinalMessage(message: ChatMessage, loop: AgentLoopState): boolean {
  if (loop.status !== 'completed' || message.role !== 'assistant') return false
  if (message.senderId !== loop.agentId) return false
  if (loop.runId && message.agentRunId && message.agentRunId !== loop.runId) return false
  const finalContent = normalizedAgentLoopText(loop.finalContent)
  if (finalContent && normalizedAgentLoopText(message.content) !== finalContent) return false
  return true
}

function messageTimelineOrder(message: ChatMessage, index: number): number {
  return message.msgId ? message.msgId * 10 : Number.MAX_SAFE_INTEGER - 10_000 + index
}

function agentEventTimelineOrder(event: AgentLoopEventItem, index: number): number {
  if (event.messageId) return event.messageId * 10 + 1
  return Number.MAX_SAFE_INTEGER - 5_000 + index
}

function sortTimelineItems(items: TimelineInput[]): TimelineInput[] {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
    const aMessageId = 'messageId' in a ? a.messageId ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    const bMessageId = 'messageId' in b ? b.messageId ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER
    if (aMessageId !== bMessageId) return aMessageId - bMessageId
    return 0
  })
}

function matchingFinalLoop(message: ChatMessage, loops: AgentLoopState[], usedKeys = new Set<string>()): AgentLoopState | undefined {
  let bestMatch: AgentLoopState | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const loop of loops) {
    const key = agentLoopKey(loop)
    if (usedKeys.has(key) || !isAgentLoopFinalMessage(message, loop)) continue
    const completedAt = loop.completedAt ?? agentLoopActivityAt(loop)
    const distance = Math.abs(completedAt - message.timestamp)
    if (distance < bestDistance) {
      bestDistance = distance
      bestMatch = loop
    }
  }
  return bestMatch
}

function appendToolMessage(groups: TimelineGroup[], message: ChatMessage) {
  const last = groups[groups.length - 1]
  if (last?.kind === 'tool_group') {
    last.messages.push(message)
    return
  }
  groups.push({ kind: 'tool_group', messages: [message] })
}

function appendAgentLoopGroup(groups: TimelineGroup[], loop: AgentLoopState, events: AgentLoopEventItem[]) {
  const key = agentLoopKey(loop)
  const existing = groups.find((group) => group.kind === 'agent_loop' && group.key === key)
  if (existing?.kind === 'agent_loop') {
    existing.loop = loop
    existing.events.push(...events)
    return
  }
  groups.push({ kind: 'agent_loop', key, loop, events: [...events] })
}

function buildTimelineGroups(messages: ChatMessage[], loops: AgentLoopState[]): TimelineGroup[] {
  const inputs: TimelineInput[] = []
  const anchoredLoops = new Set<string>()
  const finalLoopByMessage = new Map<ChatMessage, AgentLoopState>()

  messages.forEach((message) => {
    const loop = matchingFinalLoop(message, loops, anchoredLoops)
    if (!loop) return
    anchoredLoops.add(agentLoopKey(loop))
    finalLoopByMessage.set(message, loop)
  })

  messages.forEach((message, index) => {
    inputs.push({
      kind: 'message',
      message,
      timestamp: message.timestamp,
      order: messageTimelineOrder(message, index),
      messageId: message.msgId,
    })
  })

  loops.forEach((loop, loopIndex) => {
    if (anchoredLoops.has(agentLoopKey(loop))) return
    if (loop.events?.length) {
      loop.events.forEach((event, eventIndex) => {
        inputs.push({
          kind: 'agent_event',
          loop,
          event,
          timestamp: event.timestamp,
          order: agentEventTimelineOrder(event, eventIndex),
          messageId: event.messageId,
        })
      })
      return
    }
    if (loop.turns.length > 0) {
      inputs.push({
        kind: 'legacy_loop',
        loop,
        timestamp: agentLoopActivityAt(loop),
        order: Number.MAX_SAFE_INTEGER - 5_000 + loopIndex,
      })
    }
  })

  const groups: TimelineGroup[] = []
  for (const item of sortTimelineItems(inputs)) {
    if (item.kind === 'agent_event') {
      appendAgentLoopGroup(groups, item.loop, [item.event])
      continue
    }

    if (item.kind === 'legacy_loop') {
      appendAgentLoopGroup(groups, item.loop, [])
      continue
    }

    const { message } = item
    const anchoredLoop = finalLoopByMessage.get(message)
    if (anchoredLoop) {
      groups.push({
        kind: 'agent_loop',
        key: agentLoopKey(anchoredLoop),
        loop: anchoredLoop,
        events: anchoredLoop.events ?? [],
        finalMessage: message,
      })
      continue
    }

    if (message.role === 'tool' && message.toolName !== 'ask_user') {
      appendToolMessage(groups, message)
      continue
    }

    groups.push({ kind: 'message', message })
  }
  return groups
}

function AgentLoopBlock({ loop, members, finalMessage, events, showTerminal = true, onStop }: {
  loop: AgentLoopState
  members?: ChannelMemberInfo[]
  finalMessage?: ChatMessage
  events?: AgentLoopEventItem[]
  showTerminal?: boolean
  onStop?: (agentId: string, reason?: string, runId?: string) => void
}) {
  const [stopOpen, setStopOpen] = useState(false)
  const [stopReason, setStopReason] = useState('')
  const member = members?.find((item) => item.agent_id === loop.agentId)
  const agentName = agentDisplayName(members, loop.agentId)
  const { setActiveFeature, setPanel } = useDetailPanel()
  const displayError = userFacingAgentLoopError(loop.error)
  const recoverableModelError = loop.status === 'error'
    && (isModelStreamInterruptionText(loop.error) || displayError === MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE)
  const canStop = loop.status === 'running' && !!onStop
  const handleStop = () => {
    onStop?.(loop.agentId, stopReason, loop.runId)
    setStopOpen(false)
    setStopReason('')
  }
  const openTaskRecovery = () => {
    setActiveFeature('tasks')
    setPanel(true)
  }

  return (
    <div className="flex gap-2.5 py-2.5">
      <Avatar className="mt-0.5 size-9 shrink-0">
        {member?.avatar_url ? <AvatarImage src={member.avatar_url} /> : null}
        <AvatarFallback className="text-xs">AI</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs text-[#777169]">{agentName}</span>
          {canStop && (
            <button
              type="button"
              title="停止任务"
              aria-label="停止任务"
              onClick={() => setStopOpen(true)}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3" />
            </button>
          )}
        </div>
        {canStop && (
          <StopAgentDialog
            open={stopOpen}
            reason={stopReason}
            onReasonChange={setStopReason}
            onCancel={() => setStopOpen(false)}
            onConfirm={handleStop}
          />
        )}
        <RuntimeAgentRunTranscript
          loop={loop}
          finalMessage={finalMessage}
          events={events}
          showTerminal={showTerminal}
          displayError={displayError}
          terminalAction={recoverableModelError ? (
            <div className="ml-5 mt-1 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <span className="min-w-0 flex-1">已结束当前处理状态。任务已创建时，可在任务详情中重新设为待处理后重试。</span>
              <Button type="button" size="sm" variant="outline" onClick={openTaskRecovery}>
                打开任务面板
              </Button>
            </div>
          ) : undefined}
        />
      </div>
    </div>
  )
}

function StopAgentDialog({
  open,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: {
  open: boolean
  reason: string
  onReasonChange: (value: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-lg border border-[#dddddd] bg-white p-5 shadow-xl">
        <h2 className="text-base font-medium text-[#181d26]">停止任务</h2>
        <p className="mt-1 text-sm leading-5 text-[#41454d]">可以补充一句原因，团队成员会在时间线里看到。</p>
        <textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          placeholder="例如：方向不对，先停一下"
          maxLength={120}
          autoFocus
          className="mt-4 min-h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>停止任务</Button>
        </div>
      </div>
    </div>
  )
}

function StreamRenderer({
  stream,
  agentLoop,
  agentAvatarUrl,
  agentDisplayName: displayNameFromMember,
  onStop,
  className,
}: {
  stream: StreamState
  agentLoop?: AgentLoopState
  agentAvatarUrl?: string
  agentDisplayName?: string
  onStop?: (agentId: string, reason?: string, runId?: string) => void
  className?: string
}) {
  const [stopOpen, setStopOpen] = useState(false)
  const [stopReason, setStopReason] = useState('')
  const hasContent = stream.content || stream.thinking || stream.toolCall || agentLoop
  const displayName = displayNameFromMember || stream.agentId

  const handleStop = () => {
    onStop?.(stream.agentId, stopReason, stream.runId || agentLoop?.runId)
    setStopOpen(false)
    setStopReason('')
  }

  return (
    <div className={cn('flex gap-2.5 py-2.5', className)}>
      <Avatar className="mt-0.5 size-9 shrink-0">
        {agentAvatarUrl ? <AvatarImage src={agentAvatarUrl} /> : null}
        <AvatarFallback className="text-xs">AI</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{displayName}</span>
          {onStop && (
            <button
              type="button"
              title="停止任务"
              aria-label="停止任务"
              onClick={() => setStopOpen(true)}
              className="inline-flex size-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <Square className="size-3" />
            </button>
          )}
        </div>

        <StopAgentDialog
          open={stopOpen}
          reason={stopReason}
          onReasonChange={setStopReason}
          onCancel={() => setStopOpen(false)}
          onConfirm={handleStop}
        />

        {agentLoop && agentLoop.turns.length > 0 && <RuntimeAgentRunTranscript loop={agentLoop} showContent="all" />}

        {!agentLoop && stream.thinking && <RuntimeThinkingBlock content={stream.thinking} isStreaming />}

        {!agentLoop && stream.toolCall && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <span className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              stream.toolCall.status === 'success' ? 'bg-green-500'
                : stream.toolCall.status === 'failed' ? 'bg-red-500'
                  : 'animate-pulse bg-yellow-500',
            )} />
            <span className="font-mono">{stream.toolCall.name}</span>
          </div>
        )}

        {stream.content && !agentLoop && (
          <div className="break-words rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
            <MarkdownRenderer content={stream.content} />
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-foreground/60 align-text-bottom" />
          </div>
        )}

        {!hasContent && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            <span>正在处理...</span>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageList({
  channelId,
  messages,
  streams,
  agentLoops,
  members,
  typings,
  onQuote,
  currentUserId,
  onSubmitAnswer,
  onStopAgent,
  welcomeMessage,
}: {
  channelId: string
  messages: ChatMessage[]
  streams?: StreamState[]
  agentLoops?: AgentLoopState[]
  members?: ChannelMemberInfo[]
  typings?: string[]
  onQuote?: (message: ChatMessage) => void
  currentUserId?: string
  onSubmitAnswer?: (askId: string, answers: Record<string, unknown>) => void
  onStopAgent?: (agentId: string, reason?: string, runId?: string) => void
  welcomeMessage?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const visibleLoops = useMemo(() => agentLoops ?? [], [agentLoops])
  const displayMessages = useMemo(() => applyMemberDisplay(messages, members), [messages, members])
  const timelineGroups = useMemo(() => buildTimelineGroups(displayMessages, visibleLoops), [displayMessages, visibleLoops])
  const loopGroupLastIndexes = useMemo(() => {
    const indexes = new Map<string, number>()
    timelineGroups.forEach((group, index) => {
      if (group.kind === 'agent_loop') indexes.set(group.key, index)
    })
    return indexes
  }, [timelineGroups])
  const runningTimelineLoops = useMemo(() => timelineGroups.some((group) => (
    group.kind === 'agent_loop' && group.loop.status === 'running'
  )), [timelineGroups])
  const visibleStreams = useMemo(() => (
    (streams ?? [])
      .filter((activeStream) => {
        if (activeStream.agentLoop && activeStream.agentLoop.status !== 'running') return false
        if (activeStream.agentLoop?.status === 'completed' && activeStream.agentLoop.finalContent) return false
        if (activeStream.agentLoop?.events?.length) return false
        return true
      })
  ), [streams])
  const visibleTypings = useMemo(() => typings ?? [], [typings])

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (shouldAutoScroll.current) {
      scrollToBottom()
      requestAnimationFrame(scrollToBottom)
    }
  }, [
    timelineGroups.length,
    visibleLoops.map((loop) => `${agentLoopKey(loop)}:${agentLoopActivityAt(loop)}:${loop.events?.length ?? 0}`).join('|'),
    visibleStreams.map((stream) => `${stream.runId || stream.agentId}:${stream.content.length}:${stream.agentLoop ? agentLoopActivityAt(stream.agentLoop) : 0}`).join('|'),
    visibleTypings.join('|'),
    scrollToBottom,
  ])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    shouldAutoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }, [])

  const handleScrollToMessage = useCallback((msgId: number) => {
    const el = document.getElementById(`msg-${msgId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('bg-yellow-50')
      setTimeout(() => el.classList.remove('bg-yellow-50'), 1500)
    }
  }, [])

  return (
    <div ref={containerRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#fafafa]">
      <div className="mx-auto w-full" style={{ maxWidth: CHAT_MAX_WIDTH }}>
        {timelineGroups.length === 0 && visibleStreams.length === 0 && visibleTypings.length === 0 && (
          <div className="flex min-h-[calc(100dvh-190px)] items-center justify-center px-6 text-center">
            <p className="max-w-md rounded-xl border border-border bg-white px-6 py-5 text-sm leading-6 text-muted-foreground shadow-sm">{welcomeMessage}</p>
          </div>
        )}

        {timelineGroups.length > 0 && (
          <div className="flex min-h-full max-w-full flex-col justify-end gap-1 overflow-x-hidden px-4 py-3">
            {timelineGroups.map((group, index) => {
              if (group.kind === 'tool_group') return <ToolGroupBubble key={`tg-${index}`} messages={group.messages} />
              if (group.kind === 'agent_loop') {
                const isLastLoopGroup = loopGroupLastIndexes.get(group.key) === index
                const hasSeparateFinalMessage = group.loop.status === 'completed'
                  && !!group.loop.finalContent
                  && !group.finalMessage
                return (
                  <AgentLoopBlock
                    key={`loop-${group.key}-${index}`}
                    loop={group.loop}
                    members={members}
                    finalMessage={group.finalMessage}
                    events={group.events}
                    showTerminal={!!group.finalMessage || (isLastLoopGroup && !hasSeparateFinalMessage)}
                    onStop={onStopAgent}
                  />
                )
              }
              const item = group.message
              return (
                <MessageBubble
                  key={item.msgId ?? `m-${index}`}
                  message={item}
                  isOwn={item.role === 'user'}
                  channelId={channelId}
                  currentUserId={currentUserId}
                  onQuote={onQuote}
                  onScrollToMessage={handleScrollToMessage}
                  onSubmitAnswer={onSubmitAnswer}
                />
              )
            })}
          </div>
        )}

        {visibleStreams.map((activeStream) => {
          const activeLoop = activeStream.agentLoop ?? visibleLoops.find((loop) => (
            loop.agentId === activeStream.agentId
            && (activeStream.runId ? loop.runId === activeStream.runId : true)
            && loop.status === 'running'
          ))
          const agent = members?.find((member) => member.agent_id === activeStream.agentId)
          return (
            <div key={`stream-${activeStream.agentId}-${activeStream.runId || activeStream.agentLoop?.runId || 'legacy'}`} className="mx-auto px-4 pb-3" style={{ maxWidth: CHAT_MAX_WIDTH }}>
              <StreamRenderer
                stream={activeStream}
                agentLoop={activeLoop}
                agentAvatarUrl={agent?.avatar_url}
                agentDisplayName={agent?.display_name}
                onStop={onStopAgent}
              />
            </div>
          )
        })}

        {visibleTypings.length > 0 && visibleStreams.length === 0 && !runningTimelineLoops && visibleTypings.map((text, index) => (
          <div key={`typing-${index}-${text}`} className="mx-auto flex items-center gap-2 px-16 py-2 text-xs text-[#999]" style={{ maxWidth: CHAT_MAX_WIDTH }}>
            <span className="inline-flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#999] [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#999] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#999] [animation-delay:300ms]" />
            </span>
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface PasteAwareMessageInputProps {
  channelId: string
  onSend: (content: string, metadata?: Record<string, unknown>) => void
  disabled?: boolean
  disabledNotice?: string
  placeholder?: string
  members?: ChannelMemberInfo[]
  skillOptions?: SkillShortcutOption[]
  tasks?: Task[]
  tasksLoading?: boolean
  quotedMessage?: ChatMessage | null
  onClearQuote?: () => void
  insertText?: string | null
  onInsertTextConsumed?: () => void
}

interface PasteUploadError {
  message: string
  retryFiles?: File[]
}

function PasteAwareMessageInput({
  channelId,
  onSend,
  disabled,
  disabledNotice,
  placeholder,
  members,
  skillOptions,
  tasks = [],
  tasksLoading = false,
  quotedMessage,
  onClearQuote,
  insertText,
  onInsertTextConsumed,
}: PasteAwareMessageInputProps) {
  const { uploadFile, uploading, uploadProgress, canUpload } = useStorage(channelId)
  const taskMenuRef = useRef<HTMLDivElement>(null)
  const taskSearchRef = useRef<HTMLInputElement>(null)
  const taskScrollRef = useRef<HTMLDivElement>(null)
  const activeTaskItemRef = useRef<HTMLButtonElement>(null)
  const [pastedInsertText, setPastedInsertText] = useState<string | null>(null)
  const activePastedInsertRef = useRef<string | null>(null)
  const pendingPastedRefsRef = useRef<string[]>([])
  const uploadingPastedFilesRef = useRef(false)
  const [pasteStatus, setPasteStatus] = useState<{ current: number; total: number; name: string } | null>(null)
  const [pasteError, setPasteError] = useState<PasteUploadError | null>(null)
  const [taskMenuOpen, setTaskMenuOpen] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [taskIndex, setTaskIndex] = useState(0)
  const [taskInsertText, setTaskInsertText] = useState<string | null>(null)
  const activeTaskInsertRef = useRef<string | null>(null)

  const channelTasks = useMemo(() => (
    tasks.filter((task) => task.channel_id === channelId).sort(compareShortcutTasks)
  ), [channelId, tasks])

  const filteredTasks = useMemo(() => {
    const query = taskQuery.trim().toLowerCase()
    if (!query) return channelTasks
    return channelTasks.filter((task) => taskSearchText(task, members ?? []).includes(query))
  }, [channelTasks, members, taskQuery])

  useEffect(() => {
    setTaskIndex((index) => {
      if (filteredTasks.length === 0) return 0
      return Math.min(index, filteredTasks.length - 1)
    })
  }, [filteredTasks.length])

  useEffect(() => {
    if (!taskMenuOpen) return
    const frame = window.requestAnimationFrame(() => {
      taskSearchRef.current?.focus()
      taskSearchRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [taskMenuOpen])

  useEffect(() => {
    if (!taskMenuOpen) return
    activeTaskItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [filteredTasks.length, taskIndex, taskMenuOpen])

  const closeTaskMenu = useCallback(() => {
    setTaskMenuOpen(false)
    setTaskQuery('')
    setTaskIndex(0)
  }, [])

  useEffect(() => {
    if (!taskMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (taskMenuRef.current?.contains(target)) return
      if (isTaskToolbarButton(target)) return
      closeTaskMenu()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [closeTaskMenu, taskMenuOpen])

  const insertTaskReference = useCallback((task: Task) => {
    const text = taskReferenceText(task, taskAssigneeLabel(task, members ?? []))
    activeTaskInsertRef.current = text
    setTaskInsertText(text)
    closeTaskMenu()
  }, [closeTaskMenu, members])

  const handleTaskTriggerClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!isTaskToolbarButton(event.target)) return
    event.preventDefault()
    event.stopPropagation()
    if (disabled) return
    if (taskMenuOpen) {
      closeTaskMenu()
      return
    }
    setTaskQuery('')
    setTaskIndex(0)
    setTaskMenuOpen(true)
  }, [closeTaskMenu, disabled, taskMenuOpen])

  const handleTaskMenuKeyDownCapture = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!taskMenuOpen) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setTaskIndex((index) => (index + 1) % Math.max(filteredTasks.length, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setTaskIndex((index) => (index - 1 + Math.max(filteredTasks.length, 1)) % Math.max(filteredTasks.length, 1))
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const task = filteredTasks[taskIndex]
      if (!task) return
      event.preventDefault()
      insertTaskReference(task)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTaskMenu()
    }
  }, [closeTaskMenu, filteredTasks, insertTaskReference, taskIndex, taskMenuOpen])

  const showNextPastedRef = useCallback(() => {
    const next = pendingPastedRefsRef.current.shift() ?? null
    activePastedInsertRef.current = next
    setPastedInsertText(next)
  }, [])

  const enqueuePastedRef = useCallback((refText: string) => {
    pendingPastedRefsRef.current.push(refText)
    if (!activePastedInsertRef.current) showNextPastedRef()
  }, [showNextPastedRef])

  const uploadPastedFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return

    uploadingPastedFilesRef.current = true
    setPasteError(null)

    const failedFiles: File[] = []
    let lastError = ''

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i]
      setPasteStatus({ current: i + 1, total: files.length, name: file.name })
      try {
        const uploaded = await uploadFile(file, CHAT_UPLOAD_PREFIX)
        if (uploaded?.key) {
          enqueuePastedRef(storageRefFromKey(uploaded.key))
        } else {
          failedFiles.push(file)
          lastError = '上传完成后没有返回文件信息'
        }
      } catch (err) {
        failedFiles.push(file)
        lastError = err instanceof Error ? err.message : '上传失败'
      }
    }

    setPasteStatus(null)
    uploadingPastedFilesRef.current = false

    if (failedFiles.length > 0) {
      setPasteError({
        message: failedFiles.length === files.length
          ? `粘贴附件上传失败：${lastError || '请重试'}`
          : `${failedFiles.length} 个粘贴附件上传失败：${lastError || '请重试'}`,
        retryFiles: failedFiles,
      })
    }
  }, [enqueuePastedRef, uploadFile])

  const pastedUploadBlockReason = useCallback(() => {
    if (disabled) return '当前输入框不可用，暂时不能粘贴附件。'
    if (!canUpload) return '当前对话不允许上传附件。'
    if (uploading || uploadingPastedFilesRef.current) return '附件正在上传，请完成后再粘贴新的文件。'
    return null
  }, [canUpload, disabled, uploading])

  const handlePasteCapture = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const result = extractClipboardFiles(event.clipboardData)

    if (result.files.length === 0) {
      if (result.hasFileSignal || result.unreadableCount > 0) {
        event.preventDefault()
        event.stopPropagation()
        const blockReason = pastedUploadBlockReason()
        if (blockReason) {
          setPasteError({ message: blockReason })
          return
        }
        const pendingClipboardRead = extractAsyncClipboardFiles()
        void pendingClipboardRead.then((asyncResult) => {
          if (asyncResult.files.length > 0) {
            const asyncBlockReason = pastedUploadBlockReason()
            if (asyncBlockReason) {
              setPasteError({ message: asyncBlockReason })
              return
            }
            void uploadPastedFiles(asyncResult.files)
            return
          }

          setPasteError({
            message: asyncResult.error
              ? `剪贴板中的文件无法读取：${asyncResult.error}`
              : '剪贴板中的文件无法读取，请使用上传按钮选择文件。',
          })
        })
      }
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const blockReason = pastedUploadBlockReason()
    if (blockReason) {
      setPasteError({ message: blockReason })
      return
    }

    void uploadPastedFiles(result.files)
  }, [pastedUploadBlockReason, uploadPastedFiles])

  const handleRetryPasteUpload = useCallback(() => {
    const files = pasteError?.retryFiles
    if (!files || files.length === 0 || uploading || uploadingPastedFilesRef.current) return
    setPasteError(null)
    void uploadPastedFiles(files)
  }, [pasteError, uploadPastedFiles, uploading])

  const handleInsertTextConsumed = useCallback(() => {
    if (activePastedInsertRef.current) {
      showNextPastedRef()
      return
    }
    if (activeTaskInsertRef.current) {
      activeTaskInsertRef.current = null
      setTaskInsertText(null)
      return
    }
    onInsertTextConsumed?.()
  }, [onInsertTextConsumed, showNextPastedRef])

  return (
    <div onPasteCapture={handlePasteCapture}>
      {disabledNotice && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#d8dde6] bg-white px-3 py-2 text-xs text-[#333840] shadow-sm">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#254fad]" />
          <span className="min-w-0 flex-1 truncate">{disabledNotice}</span>
        </div>
      )}

      {pasteStatus && (
        <div className="mb-2 rounded-lg border border-[#d8dde6] bg-white px-3 py-2 text-xs text-[#333840] shadow-sm">
          <div className="mb-1.5 flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">
              正在上传粘贴附件 {pasteStatus.current}/{pasteStatus.total} · {pasteStatus.name}
            </span>
            <span className="shrink-0 text-[#777169]">{uploadProgress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e0e2e6]">
            <div className="h-full rounded-full bg-[#181d26] transition-all" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {pasteError && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{pasteError.message}</span>
          {pasteError.retryFiles && pasteError.retryFiles.length > 0 && (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-red-700 hover:bg-red-100"
              onClick={handleRetryPasteUpload}
              disabled={uploading}
            >
              <RotateCw className="h-3 w-3" />
              重试
            </button>
          )}
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-red-700 hover:bg-red-100"
            onClick={() => setPasteError(null)}
            aria-label="关闭粘贴上传错误"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className="relative"
        onClickCapture={handleTaskTriggerClickCapture}
        onKeyDownCapture={handleTaskMenuKeyDownCapture}
      >
        {taskMenuOpen && (
          <div
            ref={taskMenuRef}
            className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[min(24rem,62dvh)] w-full overflow-hidden rounded-lg border border-[#dddddd] bg-white shadow-lg"
          >
            <div className="border-b border-[#eeeeee] px-3 py-2">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[#181d26]">选择任务</div>
                  <div className="mt-0.5 truncate text-[11px] text-[#777169]">点击或按 Enter 插入任务引用</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-md p-1 text-[#777169] hover:bg-[#f8fafc] hover:text-[#181d26]"
                  onClick={closeTaskMenu}
                  aria-label="关闭任务列表"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                ref={taskSearchRef}
                value={taskQuery}
                onChange={(event) => {
                  setTaskQuery(event.target.value)
                  setTaskIndex(0)
                }}
                placeholder="搜索标题、状态或执行人"
                className="h-8 w-full rounded-md border border-[#dddddd] bg-white px-2 text-xs text-[#181d26] outline-none placeholder:text-[#aaa] focus:border-[#9297a0]"
              />
            </div>
            <div ref={taskScrollRef} className="max-h-[min(18rem,48dvh)] overflow-y-auto py-1">
              {tasksLoading && channelTasks.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[#777169]">正在加载任务...</div>
              ) : channelTasks.length === 0 ? (
                <div className="px-3 py-4 text-xs text-[#777169]">
                  当前频道暂无任务。你可以在右侧详情面板或任务页创建任务。
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[#777169]">没有匹配的任务</div>
              ) : filteredTasks.map((task, index) => {
                const assignedLabel = taskAssigneeLabel(task, members ?? [])
                const selected = index === taskIndex
                return (
                  <button
                    key={task.id}
                    ref={selected ? activeTaskItemRef : undefined}
                    type="button"
                    className={cn(
                      'flex w-full min-w-0 items-start gap-3 px-3 py-2 text-left transition-colors',
                      selected ? 'bg-[#181d26] text-white' : 'text-[#181d26] hover:bg-[#f8fafc]',
                    )}
                    onMouseEnter={() => setTaskIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      insertTaskReference(task)
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-medium', selected ? 'text-white' : 'text-[#181d26]')}>
                        {task.title}
                      </span>
                      <span className={cn('mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]', selected ? 'text-white/75' : 'text-[#777169]')}>
                        <span className="min-w-0 truncate">执行人：{assignedLabel}</span>
                        <span className="font-mono">#{task.id}</span>
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                        selected ? 'border-white/35 bg-white/10 text-white' : taskStatusClass(task.status),
                      )}
                    >
                      {taskStatusLabel(task.status)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <MessageInput
          channelId={channelId}
          onSend={onSend}
          disabled={disabled}
          members={members}
          quotedMessage={quotedMessage}
          onClearQuote={onClearQuote}
          insertText={pastedInsertText ?? taskInsertText ?? insertText}
          onInsertTextConsumed={handleInsertTextConsumed}
          placeholder={placeholder}
          skillOptions={skillOptions}
        />
        {disabled && <div className="absolute inset-0 cursor-not-allowed rounded-xl bg-white/30" aria-hidden />}
      </div>
    </div>
  )
}

function ChatChannel({ channelId, className, header, tasks = [], tasksLoading = false }: {
  channelId: string
  className?: string
  header?: ReactNode
  tasks?: Task[]
  tasksLoading?: boolean
}) {
  const { user } = useAuth()
  const { branding } = useAppConfig()
  const { messages, streams, agentLoops, members, typings, send, sendWithQuote, submitAnswer, stopAgent, loading } = useChat(channelId)
  const { composerInsertText, consumeComposerInsert } = useDetailPanel()
  const [quotedMessage, setQuotedMessage] = useState<ChatMessage | null>(null)
  const skillOptions = useMemo(() => buildSkillShortcutOptions(members), [members])

  const handleSend = useCallback((content: string, metadata?: Record<string, unknown>) => {
    if (quotedMessage) {
      sendWithQuote(content, quotedMessage, metadata)
      setQuotedMessage(null)
    } else {
      send(content, metadata)
    }
  }, [quotedMessage, send, sendWithQuote])

  return (
    <div className={cn('flex h-full flex-col bg-[#fafafa]', className)}>
      {header}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <AgentTodoRail
          loops={agentLoops}
          streams={streams}
          members={members}
          className="absolute left-3 top-3 z-20 md:left-4 md:top-4"
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {loading ? (
            <div className="flex flex-1 items-center justify-center">
              <span className="text-sm text-[#777169]">加载消息中...</span>
            </div>
          ) : (
            <MessageList
              channelId={channelId}
              messages={messages}
              streams={streams}
              agentLoops={agentLoops}
              members={members}
              typings={typings}
              onQuote={setQuotedMessage}
              currentUserId={user?.id}
              onSubmitAnswer={submitAnswer}
              onStopAgent={stopAgent}
              welcomeMessage={branding.welcomeMessage}
            />
          )}

          <div className="mx-auto w-full shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:pb-4" style={{ maxWidth: CHAT_MAX_WIDTH + 32 }}>
            <PasteAwareMessageInput
              channelId={channelId}
              onSend={handleSend}
              members={members}
              quotedMessage={quotedMessage}
              onClearQuote={() => setQuotedMessage(null)}
              insertText={composerInsertText}
              onInsertTextConsumed={consumeComposerInsert}
              placeholder={branding.inputPlaceholder}
              skillOptions={skillOptions}
              tasks={tasks}
              tasksLoading={tasksLoading}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function RuntimeChannelHeader({
  channel,
  leading,
  trailing,
}: {
  channel: ChannelWithMeta | null
  leading?: ReactNode
  trailing?: ReactNode
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const resetTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  useEffect(() => {
    setCopyStatus('idle')
  }, [channel?.id])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
    }
  }, [])

  const copyChannelId = useCallback(async () => {
    if (!channel) return

    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current)
    const ok = await copyTextToClipboard(channel.id)
    setCopyStatus(ok ? 'success' : 'error')
    resetTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle')
      resetTimerRef.current = null
    }, 1600)
  }, [channel])

  const copyTitle = copyStatus === 'success'
    ? '已复制频道 ID'
    : copyStatus === 'error'
      ? '复制失败'
      : '复制频道 ID'

  return (
    <div className="flex min-h-12 items-center gap-2 border-b border-border bg-white px-3 py-2.5 sm:gap-3 sm:px-4">
      {leading}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h3 className="min-w-0 truncate text-sm font-semibold">{channel?.name || '对话'}</h3>
        {channel && (
          <button
            type="button"
            data-beeseed-channel-id={channel.id}
            onClick={copyChannelId}
            className={cn(
              'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[#dddddd] bg-white text-[#41454d] transition-colors hover:border-[#9297a0] hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35',
              copyStatus === 'success' && 'border-[#39bf45] bg-[#f0fbf1] text-[#006400]',
              copyStatus === 'error' && 'border-[#aa2d00] bg-[#fff4ef] text-[#aa2d00]',
            )}
            title={copyTitle}
            aria-label={copyTitle}
          >
            {copyStatus === 'success' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        )}
        {channel && (
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{channel.member_count}位成员</span>
        )}
      </div>
      {trailing}
    </div>
  )
}

export function RuntimeAppLayout({ className }: { className?: string }) {
  const { channels, currentChannelId, loading, setCurrentChannel } = useChannels()
  const { user } = useAuth()
  const { activeFeature, setActiveFeature, panelVisible, togglePanel, setPanel } = useDetailPanel()
  const { members, refreshMembers } = useChat(currentChannelId)
  const { tasks, loading: tasksLoading } = useTasks(currentChannelId)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
  const isAdmin = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin'
  const displayChannels = useMemo(
    () => channelsForDisplay(channels, currentChannelId),
    [channels, currentChannelId],
  )

  useEffect(() => {
    if (activeFeature === 'admin' && !isAdmin) {
      setActiveFeature('chat')
    }
  }, [activeFeature, isAdmin, setActiveFeature])

  const handleChannelSelect = (channelId: string) => {
    setCurrentChannel(channelId)
    setActiveFeature('chat')
    setPanel(true)
    setMobileNavOpen(false)
    setMobileDetailOpen(false)
  }

  const currentChannel = displayChannels.find((channel) => channel.id === currentChannelId)
  const chatEmptyText = loading
    ? '正在加载频道...'
    : displayChannels.length > 0
      ? '正在进入频道...'
      : '暂无可访问频道，请先创建或加入频道'
  const openTaskCreator = () => {
    setActiveFeature('tasks')
  }
  const handleFeatureChange = (feature: Parameters<typeof setActiveFeature>[0]) => {
    setActiveFeature(feature)
    setMobileNavOpen(false)
  }

  if (activeFeature !== 'chat') {
    return (
      <>
        <SdkAppLayout className={className} />
        <StandardTemplateVersion />
      </>
    )
  }

  return (
    <div className={cn('flex h-[100dvh] bg-[#fafafa]', className)}>
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-label="关闭导航"
        />
      )}
      <LeftNavSidebar
        className={mobileNavOpen
          ? 'fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] max-w-[18rem] shadow-xl md:static md:w-[200px] md:max-w-none md:shadow-none'
          : 'hidden md:flex'}
        activeFeature={activeFeature}
        onFeatureChange={handleFeatureChange}
        channels={displayChannels}
        currentChannelId={currentChannelId}
        onChannelSelect={handleChannelSelect}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {activeFeature === 'chat' && currentChannelId ? (
          <ChatChannel
            channelId={currentChannelId}
            tasks={tasks}
            tasksLoading={tasksLoading}
            header={
              <RuntimeChannelHeader
                channel={currentChannel ?? null}
                leading={
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#dddddd] bg-white text-[#41454d] transition-colors hover:border-[#9297a0] hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35 md:hidden"
                    onClick={() => setMobileNavOpen(true)}
                    aria-label="打开导航"
                  >
                    <Menu className="h-4 w-4" />
                  </button>
                }
                trailing={
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setPanel(true)
                        setMobileDetailOpen(true)
                      }}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35 lg:hidden"
                      title="详情面板"
                    >
                      <PanelRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePanel}
                      className={cn('hidden h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35 lg:inline-flex', panelVisible && 'bg-black/5')}
                      title="详情面板"
                    >
                      <PanelRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </>
                }
              />
            }
          />
        ) : activeFeature === 'chat' ? (
          <div className="flex min-h-0 flex-1 flex-col bg-[#fafafa]">
            <div className="flex min-h-12 items-center border-b border-border bg-white px-3 py-2.5 md:hidden">
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#dddddd] bg-white text-[#41454d] transition-colors hover:border-[#9297a0] hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35"
                onClick={() => setMobileNavOpen(true)}
                aria-label="打开导航"
              >
                <Menu className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 p-4 sm:p-8">
              <div className="mx-auto flex h-full max-w-5xl items-center justify-center rounded-xl border border-border bg-white px-4 text-center text-sm text-muted-foreground shadow-sm">
                {chatEmptyText}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {activeFeature === 'chat' && mobileDetailOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/25 lg:hidden"
          onClick={() => setMobileDetailOpen(false)}
          aria-label="关闭详情面板"
        />
      )}
      {activeFeature === 'chat' && (
        <DetailPanel
          className={cn(
            mobileDetailOpen ? 'fixed inset-y-0 right-0 z-40 flex w-[min(22rem,calc(100vw-2rem))] max-w-[22rem] shadow-xl' : 'hidden',
            'lg:static lg:z-auto lg:flex lg:w-[300px] lg:max-w-none lg:shadow-none',
          )}
          channelId={currentChannelId}
          members={members}
          tasks={tasks}
          onCreateTask={openTaskCreator}
          onMembersChanged={refreshMembers}
        />
      )}
      <StandardTemplateVersion />
    </div>
  )
}
