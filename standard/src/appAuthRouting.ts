const APP_INVITE_CODE_KEYS = ['invite_code', 'invite']
const APP_SHARE_TOKEN_KEYS = ['share_id', 'share']
export const APP_SIGNED_OUT_KEYS = ['signed_out']
const APP_LAUNCH_TOKEN_KEYS = ['beeseed_launch_token', 'beeseed_token', 'token', 'auth_token', 'access_token']

export function readInviteCodeFromURL(rawURL: string): string {
  return readSearchOrHashValue(rawURL, APP_INVITE_CODE_KEYS)
}

export function readShareTokenFromURL(rawURL: string): string {
  return readSearchOrHashValue(rawURL, APP_SHARE_TOKEN_KEYS)
}

export function appReturnToWithoutInviteCodeFromURL(rawURL: string): string {
  const url = new URL(rawURL)
  removeParams(url.searchParams, APP_INVITE_CODE_KEYS)
  removeParams(url.searchParams, APP_LAUNCH_TOKEN_KEYS)
  removeParams(url.searchParams, APP_SIGNED_OUT_KEYS)

  const hashParams = hashSearchParams(url)
  let changedHash = false
  for (const key of [...APP_INVITE_CODE_KEYS, ...APP_LAUNCH_TOKEN_KEYS, ...APP_SIGNED_OUT_KEYS]) {
    if (hashParams.has(key)) changedHash = true
    hashParams.delete(key)
  }
  if (changedHash) {
    const nextHash = hashParams.toString()
    url.hash = nextHash ? `#${nextHash}` : ''
  }
  return url.toString()
}

function readSearchOrHashValue(rawURL: string, keys: string[]): string {
  const url = new URL(rawURL)
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim()
    if (value) return value
  }
  const hashParams = hashSearchParams(url)
  for (const key of keys) {
    const value = hashParams.get(key)?.trim()
    if (value) return value
  }
  return ''
}

function hashSearchParams(url: URL): URLSearchParams {
  const hashText = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash
  return new URLSearchParams(hashText.charAt(0) === '?' ? hashText.slice(1) : hashText)
}

function removeParams(params: URLSearchParams, keys: string[]) {
  for (const key of keys) params.delete(key)
}
