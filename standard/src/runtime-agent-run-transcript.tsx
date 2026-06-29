import { useId, useState, type ReactNode } from 'react'
import { AlertCircle, Check, ChevronRight, Circle, Clock3 } from 'lucide-react'
import {
  AgentRunTranscript as SdkAgentRunTranscript,
  MarkdownRenderer,
  cn,
  type AgentLoopEventItem,
  type AgentLoopState,
  type AgentLoopToolCall,
  type ChatMessage,
} from '@beeseed/beeseed-sdk'

interface RuntimeAgentRunTranscriptProps {
  loop: AgentLoopState
  finalMessage?: ChatMessage
  events?: AgentLoopEventItem[]
  showContent?: 'all' | 'intermediate' | 'none'
  showTerminal?: boolean
  displayError?: string
  terminalAction?: ReactNode
  className?: string
}

interface RuntimeThinkingBlockProps {
  content: string
  isStreaming?: boolean
  className?: string
}

function compactText(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

function sameText(a?: string, b?: string): boolean {
  const left = compactText(a)
  return left !== '' && left === compactText(b)
}

function elapsedSeconds(startedAt?: number, completedAt?: number): string | null {
  if (!startedAt || !completedAt || completedAt < startedAt) return null
  return `${((completedAt - startedAt) / 1000).toFixed(1)}s`
}

function outputSummary(value?: string): string {
  const text = compactText(value)
  if (!text) return ''
  return text.length > 120 ? `${text.slice(0, 120)}...` : text
}

function toolStatusText(tool: AgentLoopToolCall, mode: 'call' | 'result' | 'line'): string {
  if (mode === 'call') return `正在调用 ${tool.name}`
  const label =
    tool.status === 'calling' ? '调用中'
      : tool.status === 'success' ? '完成'
        : '失败'
  const summary = mode === 'result' ? outputSummary(tool.output) : ''
  return `${tool.name} ${label}${summary ? `：${summary}` : ''}`
}

function eventStatusText(item: AgentLoopEventItem, finalAnswer: string): string {
  if (item.type === 'progress') return compactText(item.summary)
  if (item.type === 'assistant_content') {
    const content = compactText(item.content)
    return sameText(content, finalAnswer) ? '' : content
  }
  if (item.type === 'skill_use' && item.skill) {
    const label = item.skill.displayName || item.skill.name
    if (item.skill.status === 'missing' || item.skill.status === 'error') return `技能不可用：${label}`
    return `启用技能 ${label}`
  }
  if (item.type === 'tool_call' && item.tool) return toolStatusText(item.tool, 'call')
  if (item.type === 'tool_result' && item.tool) return toolStatusText(item.tool, 'result')
  return ''
}

function latestEventStatus(events: AgentLoopEventItem[] | undefined, finalAnswer: string): string {
  if (!events?.length) return ''
  const ordered = events.slice().sort((a, b) => {
    const seqDiff = (a.seq ?? 0) - (b.seq ?? 0)
    if (seqDiff !== 0) return seqDiff
    return a.timestamp - b.timestamp
  })
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const text = eventStatusText(ordered[index], finalAnswer)
    if (text) return text
  }
  return ''
}

function latestTurnStatus(loop: AgentLoopState, finalAnswer: string): string {
  const turn = loop.turns[loop.turns.length - 1]
  if (!turn) return loop.status === 'running' ? '等待 LLM 响应...' : ''

  const activeTool = [...(turn.toolCalls ?? [])].reverse().find((tool) => tool.status === 'calling')
  if (activeTool) return toolStatusText(activeTool, 'call')

  const progress = compactText(turn.progress)
  if (progress && !sameText(progress, finalAnswer)) return progress

  const latestTool = [...(turn.toolCalls ?? [])].reverse()[0]
  if (latestTool) return toolStatusText(latestTool, 'line')

  const thinking = compactText(turn.thinking)
  if (thinking && !sameText(thinking, finalAnswer)) return thinking

  const content = compactText(turn.content)
  if (content && !sameText(content, finalAnswer)) return content

  if (turn.status === 'active' && loop.status === 'running') return '等待 LLM 响应...'
  return loop.currentTurn > 1 ? `继续处理 ${loop.currentTurn}` : '开始处理'
}

function observedEndAt(loop: AgentLoopState, finalMessage: ChatMessage | undefined, events: AgentLoopEventItem[] | undefined): number | undefined {
  if (loop.completedAt) return loop.completedAt
  if (loop.status === 'running') return undefined

  let latest = finalMessage?.timestamp ?? 0
  for (const event of events ?? []) {
    latest = Math.max(latest, event.timestamp)
  }
  for (const turn of loop.turns) {
    latest = Math.max(latest, turn.completedAt ?? turn.startedAt ?? 0)
    for (const tool of turn.toolCalls ?? []) {
      latest = Math.max(latest, tool.completedAt ?? tool.startedAt ?? 0)
    }
  }
  return latest > loop.startedAt ? latest : undefined
}

function statusLabel(loop: AgentLoopState, completedAt: number | undefined, displayError?: string): string {
  const duration = elapsedSeconds(loop.startedAt, completedAt)
  if (loop.status === 'completed') return `完成${duration ? ` ${duration}` : ''}`
  if (loop.status === 'running') return '处理中'
  if (loop.status === 'max_turns_reached') return `已达到最大轮次 (${loop.currentTurn})`
  if (loop.status === 'waiting_for_user') return '等待用户回答'
  if (loop.status === 'waiting_expired') return '等待已超时'
  if (loop.status === 'stopped') return '已停止'
  if (loop.status === 'interrupted') return '已中断'
  if (loop.status === 'error') return displayError ? '错误' : '处理失败'
  return loop.status
}

function statusSummary(loop: AgentLoopState, events: AgentLoopEventItem[] | undefined, finalAnswer: string, displayError?: string): string {
  if (loop.status === 'completed') {
    return latestEventStatus(events, finalAnswer) || '已生成最终回复'
  }
  if (loop.status === 'error') return displayError || loop.error || latestEventStatus(events, finalAnswer) || '处理失败'
  if (loop.status === 'stopped') return latestEventStatus(events, finalAnswer) || '用户已停止本次处理'
  if (loop.status === 'interrupted') return displayError || loop.error || latestEventStatus(events, finalAnswer) || '本次处理已中断'
  if (loop.status === 'waiting_for_user') return latestEventStatus(events, finalAnswer) || '等待用户补充信息'
  if (loop.status === 'waiting_expired') return latestEventStatus(events, finalAnswer) || '等待用户回答已超时'
  if (loop.status === 'max_turns_reached') return latestEventStatus(events, finalAnswer) || latestTurnStatus(loop, finalAnswer)
  return latestEventStatus(events, finalAnswer) || latestTurnStatus(loop, finalAnswer)
}

function statusTone(loop: AgentLoopState): string {
  if (loop.status === 'completed') return 'text-[#006400]'
  if (loop.status === 'error') return 'text-red-700'
  if (loop.status === 'interrupted' || loop.status === 'waiting_expired' || loop.status === 'max_turns_reached') return 'text-amber-700'
  if (loop.status === 'waiting_for_user') return 'text-amber-700'
  return 'text-[#181d26]'
}

function StatusIcon({ loop }: { loop: AgentLoopState }) {
  if (loop.status === 'running') {
    return (
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span className="absolute inline-flex size-3 rounded-full bg-[#181d26]/15 animate-ping" />
        <span className="relative inline-flex size-2 rounded-full bg-[#181d26]" />
      </span>
    )
  }
  if (loop.status === 'completed') return <Check className="size-3.5 shrink-0 text-[#006400]" />
  if (loop.status === 'error') return <AlertCircle className="size-3.5 shrink-0 text-red-700" />
  if (loop.status === 'waiting_for_user') return <Clock3 className="size-3.5 shrink-0 text-amber-700" />
  return <Circle className="size-3.5 shrink-0 fill-zinc-400 text-zinc-400" />
}

function agentRunIdentity(loop: AgentLoopState): string {
  return `${loop.channelId}:${loop.agentId}:${loop.runId ?? loop.startedAt}`
}

function FinalAnswerPreview({ content }: { content: string }) {
  return (
    <div className="ml-5 pt-1 text-sm leading-6 text-[#181d26]">
      <MarkdownRenderer
        content={content}
        className="prose prose-sm max-w-none break-words [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_code.inline-code]:rounded [&_code.inline-code]:bg-[#e8f5f8] [&_code.inline-code]:px-1 [&_code.inline-code]:py-0.5 [&_code.inline-code]:text-[#0f5267]"
      />
    </div>
  )
}

export function RuntimeAgentRunTranscript({
  loop,
  finalMessage,
  events,
  showContent = 'all',
  showTerminal = true,
  displayError,
  terminalAction,
  className,
}: RuntimeAgentRunTranscriptProps) {
  const detailsId = useId()
  const runIdentity = agentRunIdentity(loop)
  const [expandedState, setExpandedState] = useState({ runIdentity, expanded: false })
  const expanded = expandedState.runIdentity === runIdentity ? expandedState.expanded : false
  const finalAnswer = loop.finalContent || finalMessage?.content || ''
  const orderedEvents = events?.length ? events : loop.events
  const label = statusLabel(loop, observedEndAt(loop, finalMessage, orderedEvents), displayError)
  const summary = statusSummary(loop, orderedEvents, finalAnswer, displayError)
  const hasFinalAnswer = loop.status === 'completed' && finalAnswer.trim() !== ''
  const toggleExpanded = () => {
    setExpandedState((state) => ({
      runIdentity,
      expanded: state.runIdentity === runIdentity ? !state.expanded : true,
    }))
  }

  return (
    <div className={cn('space-y-1', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        title={summary ? `${label} · ${summary}` : label}
        onClick={toggleExpanded}
        className="group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md border border-[#dddddd] bg-white px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[#f8fafc]"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-[#777169] transition-transform', expanded && 'rotate-90')} />
        <StatusIcon loop={loop} />
        <span className={cn('shrink-0 font-medium', statusTone(loop))}>{label}</span>
        {summary && (
          <span
            className="min-w-0 flex-1 truncate text-[#555]"
            aria-live={loop.status === 'running' ? 'polite' : undefined}
            aria-atomic={loop.status === 'running' ? 'true' : undefined}
          >
            {summary}
          </span>
        )}
      </button>

      {expanded && (
        <div id={detailsId} className="ml-5 border-l border-[#dddddd] pl-2 pt-1">
          <SdkAgentRunTranscript
            loop={loop}
            finalMessage={finalMessage}
            events={events}
            showContent={showContent}
            showTerminal={showTerminal}
            displayError={displayError}
            terminalAction={terminalAction}
          />
        </div>
      )}

      {!expanded && showTerminal && hasFinalAnswer && <FinalAnswerPreview content={finalAnswer} />}
      {!expanded && loop.status !== 'running' && terminalAction}
    </div>
  )
}

export function RuntimeThinkingBlock({ content, isStreaming, className }: RuntimeThinkingBlockProps) {
  const detailsId = useId()
  const [expanded, setExpanded] = useState(false)
  const summary = compactText(content) || (isStreaming ? '等待 LLM 响应...' : '')

  if (!content && !isStreaming) return null

  return (
    <div className={cn('space-y-1', className)}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={detailsId}
        title={summary ? `思考过程 · ${summary}` : '思考过程'}
        onClick={() => setExpanded((open) => !open)}
        className="group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md border border-[#dddddd] bg-white px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[#f8fafc]"
      >
        <ChevronRight className={cn('size-3 shrink-0 text-[#777169] transition-transform', expanded && 'rotate-90')} />
        {isStreaming ? (
          <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-[#777169]/30 border-t-[#777169]" />
        ) : (
          <Clock3 className="size-3.5 shrink-0 text-[#777169]" />
        )}
        <span className="shrink-0 font-medium text-[#181d26]">思考过程</span>
        {summary && (
          <span className="min-w-0 flex-1 truncate text-[#555]" aria-live={isStreaming ? 'polite' : undefined} aria-atomic={isStreaming ? 'true' : undefined}>
            {summary}
          </span>
        )}
      </button>

      {expanded && content && (
        <div id={detailsId} className="ml-5 max-h-[220px] overflow-y-auto whitespace-pre-wrap border-l border-[#dddddd] pl-2 pt-1 text-xs leading-5 text-[#555]">
          {content}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[#777169]/50 align-text-bottom" />
          )}
        </div>
      )}
    </div>
  )
}
