import type { ChatMessage } from '@beeseed/beeseed-sdk'

export function isPendingAskUserForUser(message: ChatMessage, currentUserId?: string): boolean {
  const data = message.askUserData
  if (message.role !== 'tool' || message.toolName !== 'ask_user' || data?.status !== 'pending') return false
  if (data.visibility === 'all_members') return true

  const targetUserIds = data.targetUserIds ?? (data.targetUserId ? [data.targetUserId] : [])
  if (currentUserId && targetUserIds.includes(currentUserId)) return true

  const isLegacySingleTarget = !data.visibility || data.visibility === 'target_user'
  return isLegacySingleTarget && targetUserIds.length === 0
}

export function latestPendingAskUserForUser(
  messages: ChatMessage[] | undefined,
  currentUserId?: string,
): ChatMessage | undefined {
  if (!messages?.length) return undefined
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (isPendingAskUserForUser(message, currentUserId)) return message
  }
  return undefined
}

export function pendingAskUserKey(message: ChatMessage | undefined): string | null {
  if (!message) return null
  return `${message.msgId ?? message.timestamp}:${message.askUserData?.askId ?? ''}`
}

export function readAckBeforePendingAsk(message: ChatMessage | undefined): number {
  const msgId = message?.msgId
  return typeof msgId === 'number' && Number.isFinite(msgId) ? Math.max(0, msgId - 1) : 0
}
