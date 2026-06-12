import { expect, test } from '@playwright/test'
import {
  authTokenFromMeResponse,
  authUserFromMeResponse,
  shouldClearStoredAuthOnInitError,
  type AuthMeResponse,
} from '../../../../beeseed-sdk/src/stores/auth'
import { ApiError } from '../../../../beeseed-sdk/src/core/errors'
import type { User } from '../../../../beeseed-sdk/src/core/types'

function user(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    name: 'User',
    role: 'member',
    status: 'active',
    created_at: '2026-06-10T00:00:00Z',
    updated_at: '2026-06-10T00:00:00Z',
    ...overrides,
  }
}

test.describe('auth init refresh', () => {
  test('accepts refreshed token returned by auth/me', () => {
    const response = { ...user(), token: ' refreshed-token ' } satisfies AuthMeResponse

    expect(authUserFromMeResponse(response).id).toBe('user-1')
    expect(authTokenFromMeResponse(response)).toBe('refreshed-token')
  })

  test('also accepts wrapped auth/me user responses', () => {
    const response = { user: user({ id: 'wrapped-user' }), token: 'new-token' } as AuthMeResponse

    expect(authUserFromMeResponse(response).id).toBe('wrapped-user')
    expect(authTokenFromMeResponse(response)).toBe('new-token')
  })

  test('clears stored token only for authentication failures', () => {
    expect(shouldClearStoredAuthOnInitError(new ApiError('unauthorized', 401))).toBe(true)
    expect(shouldClearStoredAuthOnInitError(new ApiError('disabled', 403, 'USER_DISABLED'))).toBe(true)
    expect(shouldClearStoredAuthOnInitError(new ApiError('temporary failure', 500))).toBe(false)
    expect(shouldClearStoredAuthOnInitError(new Error('network down'))).toBe(false)
  })
})
