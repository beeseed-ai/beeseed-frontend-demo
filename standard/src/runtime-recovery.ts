import type { AgentLoopState, Task } from '@beeseed/beeseed-sdk'

export const MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE =
  '模型服务连接临时中断，本轮处理已结束。已创建的任务会保留在任务面板中；可以打开任务详情重新执行，或重新发送请求。'

export const MODEL_STREAM_INTERRUPTED_TASK_MESSAGE =
  '模型服务连接临时中断，本次任务执行失败。任务记录已保留，可在任务详情中重新设为待处理后重试，或重新发起请求。'

export const MODEL_STREAM_INTERRUPTED_SUPERSEDED_MESSAGE =
  '此前一次模型响应中断已结束；后续处理已继续，请以任务面板和最新回复的状态为准。'

export const AGENT_BUSY_RETRY_MESSAGE =
  'Agent 正在处理中，这条消息没有被执行。请等待上一轮完成后再试。'

const MODEL_STREAM_ERROR_RE = /\b(?:read SSE|stream error|stream ID \d+|INTERNAL_ERROR|received from peer|unexpected EOF|http2: stream|ERR_HTTP2)\b/i
const AGENT_BUSY_ERROR_RE = /\bagent is busy processing another message\b/i
const ALREADY_LOCALIZED_RE = /模型服务连接临时中断|此前一次模型响应中断已结束/
const TASK_FAILURE_PREFIX_RE = /^(任务「[^」]+」执行失败：).*/s

export function isModelStreamInterruptionText(value?: string | null): boolean {
  if (!value || ALREADY_LOCALIZED_RE.test(value)) return false
  return value.includes('模型响应中断') || MODEL_STREAM_ERROR_RE.test(value)
}

export function isAgentBusyProcessingText(value?: string | null): boolean {
  if (!value) return false
  return value === AGENT_BUSY_RETRY_MESSAGE || AGENT_BUSY_ERROR_RE.test(value)
}

export function userFacingAgentLoopError(value?: string): string | undefined {
  if (!value) return value
  if (isAgentBusyProcessingText(value)) return AGENT_BUSY_RETRY_MESSAGE
  return isModelStreamInterruptionText(value) ? MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE : value
}

export function userFacingTaskFailureText(value?: string): string | undefined {
  if (!value) return value
  return isModelStreamInterruptionText(value) ? MODEL_STREAM_INTERRUPTED_TASK_MESSAGE : value
}

export function userFacingMessageContent(value?: string): string | undefined {
  if (!value) return value
  if (isAgentBusyProcessingText(value)) return AGENT_BUSY_RETRY_MESSAGE
  if (!isModelStreamInterruptionText(value)) return value
  const match = value.match(TASK_FAILURE_PREFIX_RE)
  if (match) return `${match[1]}${MODEL_STREAM_INTERRUPTED_TASK_MESSAGE}`
  return MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE
}

export function normalizeLoopForDisplay(loop: AgentLoopState): AgentLoopState {
  const error = userFacingAgentLoopError(loop.error)
  if (isAgentBusyProcessingText(loop.error)) {
    if (loop.status === 'interrupted' && loop.error === AGENT_BUSY_RETRY_MESSAGE) return loop
    return {
      ...loop,
      status: 'interrupted',
      error: AGENT_BUSY_RETRY_MESSAGE,
    }
  }
  return error !== loop.error ? { ...loop, error } : loop
}

export function markSupersededModelErrorLoop(loop: AgentLoopState): AgentLoopState {
  if (loop.status !== 'error') return loop
  if (!isModelStreamInterruptionText(loop.error) && loop.error !== MODEL_STREAM_INTERRUPTED_AGENT_MESSAGE) return loop

  return {
    ...loop,
    status: 'interrupted',
    error: MODEL_STREAM_INTERRUPTED_SUPERSEDED_MESSAGE,
  }
}

export function normalizeTaskForDisplay(task: Task): Task {
  let changed = false
  const next: Task = { ...task }
  const result = userFacingTaskFailureText(task.result)
  const failureDetail = userFacingTaskFailureText(task.failure_detail)

  if (result !== task.result) {
    next.result = result
    changed = true
  }
  if (failureDetail !== task.failure_detail) {
    next.failure_detail = failureDetail
    changed = true
  }
  if (
    task.status === 'failed'
    && (isModelStreamInterruptionText(task.result) || isModelStreamInterruptionText(task.failure_detail))
    && task.failure_code
  ) {
    next.failure_code = '模型中断'
    changed = true
  }

  return changed ? next : task
}
