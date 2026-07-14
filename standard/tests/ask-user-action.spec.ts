import { expect, test } from '@playwright/test'
import type { ChatMessage } from '@beeseed/beeseed-sdk'
import { normalizeAskUserMarkdown, questionPromptStyle } from '../../../../beeseed-sdk/src/components/chat/AskUserCard'
import {
  isPendingAskUserForUser,
  latestPendingAskUserForUser,
  pendingAskUserKey,
  readAckBeforePendingAsk,
} from '../src/ask-user-action'

function askUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'tool',
    content: '',
    timestamp: 1000,
    msgId: 42,
    toolName: 'ask_user',
    askUserData: {
      askId: 'ask-42',
      status: 'pending',
      visibility: 'target_user',
      targetUserId: 'user-1',
      questions: [{ id: 'choice', type: 'single_select', title: '请选择' }],
    },
    ...overrides,
  }
}

test.describe('ask_user action feedback', () => {
  test('normalizes escaped newlines without changing Markdown syntax', () => {
    expect(normalizeAskUserMarkdown('**方案**\\r\\n1. 第一项\\n2. 第二项')).toBe(
      '**方案**\n1. 第一项\n2. 第二项',
    )
  })

  test('does not preserve Markdown block separator text as extra visual lines', () => {
    expect(questionPromptStyle.whiteSpace).toBe('normal')
  })

  test('only treats pending questions visible to the current user as actionable', () => {
    const targeted = askUserMessage()
    expect(isPendingAskUserForUser(targeted, 'user-1')).toBe(true)
    expect(isPendingAskUserForUser(targeted, 'user-2')).toBe(false)
    expect(isPendingAskUserForUser(askUserMessage({
      askUserData: { ...targeted.askUserData!, status: 'answered' },
    }), 'user-1')).toBe(false)
    expect(isPendingAskUserForUser(askUserMessage({
      askUserData: { ...targeted.askUserData!, visibility: 'all_members' },
    }), 'user-2')).toBe(true)
  })

  test('selects the latest pending question and keeps read acknowledgement before it', () => {
    const earlier = askUserMessage({ msgId: 21, timestamp: 900 })
    const latest = askUserMessage({ msgId: 42, timestamp: 1000 })
    const selected = latestPendingAskUserForUser([earlier, latest], 'user-1')

    expect(selected).toBe(latest)
    expect(pendingAskUserKey(selected)).toBe('42:ask-42')
    expect(readAckBeforePendingAsk(selected)).toBe(41)
  })
})
