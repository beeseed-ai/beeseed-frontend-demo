import { expect, test } from '@playwright/test'
import {
  channelAgentPanelState,
  channelCreationBlockedMessage,
  channelPolicyLoadErrorMessage,
} from '../../../../beeseed-sdk/src/components/channels/channelPolicyState'
import { ApiError } from '../../../../beeseed-sdk/src/core/errors'

test.describe('channel policy state', () => {
  test('does not keep the Agent panel in loading state after policy loading fails', () => {
    expect(channelAgentPanelState({ status: 'failed', policy: null, agentCount: 0 })).toBe('failed')
  })

  test('formats policy load failures as actionable Chinese messages', () => {
    expect(channelPolicyLoadErrorMessage(new ApiError('admin only', 403))).toContain('没有权限')
    expect(channelPolicyLoadErrorMessage(new ApiError('missing', 404))).toContain('未启用频道策略接口')
  })

  test('formats channel creation policy denial reasons for normal users', () => {
    expect(channelCreationBlockedMessage('admin only')).toBe('仅管理员可以创建频道，请联系管理员协助。')
    expect(channelCreationBlockedMessage('channel limit reached')).toBe('已达到当前账号可创建的频道数量上限。')
  })
})
