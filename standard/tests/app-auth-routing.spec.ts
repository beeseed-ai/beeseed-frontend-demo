import { expect, test } from '@playwright/test'
import {
  appReturnToWithoutInviteCodeFromURL,
  readInviteCodeFromURL,
  readShareTokenFromURL,
} from '../src/appAuthRouting'

test.describe('app auth routing', () => {
  test('reads invite code from search or hash parameters', () => {
    expect(readInviteCodeFromURL('https://app-demo.imwork.ai/?invite_code=bi_v1_abc')).toBe('bi_v1_abc')
    expect(readInviteCodeFromURL('https://app-demo.imwork.ai/#?invite=legacy')).toBe('legacy')
  })

  test('keeps return_to clean while preserving normal app route parameters', () => {
    const returnTo = appReturnToWithoutInviteCodeFromURL(
      'https://app-demo.imwork.ai/channels/general?invite_code=bi_v1_abc&share_id=s1&beeseed_launch_token=token&signed_out=1#?invite=legacy&tab=chat',
    )
    const parsed = new URL(returnTo)

    expect(parsed.searchParams.get('invite_code')).toBeNull()
    expect(parsed.searchParams.get('beeseed_launch_token')).toBeNull()
    expect(parsed.searchParams.get('signed_out')).toBeNull()
    expect(parsed.searchParams.get('share_id')).toBe('s1')
    expect(parsed.hash).toBe('#tab=chat')
  })

  test('reads share token without confusing it with invite token', () => {
    expect(readShareTokenFromURL('https://app-demo.imwork.ai/?invite_code=bi_v1_abc&share_id=owner-1')).toBe('owner-1')
  })
})
