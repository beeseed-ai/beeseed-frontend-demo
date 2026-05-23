type NativeFetch = typeof window.fetch

interface StorageObject {
  key?: string
  name?: string
  display_name?: string
  status?: string
}

interface StorageListResponse {
  objects?: StorageObject[]
  common_prefixes?: string[]
}

const GENERATED_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi
const SENSITIVE_QUERY_FRAGMENT_RE = /(?:[?&#]|\b)(?:X-Amz-Algorithm|X-Amz-Credential|X-Amz-Date|X-Amz-Expires|X-Amz-Security-Token|X-Amz-Signature|X-Amz-SignedHeaders|X-Amz-Content-Sha256|beeseed_launch_token|beeseed_token|token|auth_token|access_token|signature|credential)=[^&#\s<>"'`)]+/gi
const FALLBACK_ERROR = '无法生成下载链接。请稍后重试，或从右侧云存储面板重新打开该文件。'
const STORAGE_KEY_RESOLVED_EVENT = 'beeseed:storage-key-resolved'
const SENSITIVE_QUERY_KEYS = new Set([
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-security-token',
  'x-amz-signature',
  'x-amz-signedheaders',
  'x-amz-content-sha256',
  'token',
  'beeseed_launch_token',
  'beeseed_token',
  'auth_token',
  'access_token',
  'signature',
  'credential',
])

let installed = false

export function installRuntimeStorageSafety() {
  if (installed) return () => {}
  installed = true

  const cleanupConsole = installConsoleRedaction()
  const cleanupFetch = installFetchSafety()

  return () => {
    cleanupFetch()
    cleanupConsole()
    installed = false
  }
}

export function redactSensitiveUrl(value: string): string {
  const redactedUrls = value.replace(URL_RE, (rawUrl) => {
    const trailing = rawUrl.match(/[),.;:!?，。；：！？]+$/)?.[0] ?? ''
    const cleanUrl = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl

    try {
      const parsed = new URL(cleanUrl)
      const hasSensitiveQuery = Array.from(parsed.searchParams.keys()).some(isSensitiveQueryKey)
      if (!hasSensitiveQuery) return rawUrl
      return `${parsed.origin}${parsed.pathname}?<redacted-query>${parsed.hash}${trailing}`
    } catch {
      return cleanUrl.replace(/([?&])([^=&#\s]+)=([^&#\s]*)/g, (match, prefix: string, key: string) => {
        return isSensitiveQueryKey(key) ? `${prefix}${key}=<redacted>` : match
      }) + trailing
    }
  })
  return redactedUrls.replace(SENSITIVE_QUERY_FRAGMENT_RE, '<redacted-query-param>')
}

function installConsoleRedaction() {
  const originals = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  }

  console.debug = (...args: unknown[]) => originals.debug(...args.map(sanitizeLogArg))
  console.error = (...args: unknown[]) => originals.error(...args.map(sanitizeLogArg))
  console.info = (...args: unknown[]) => originals.info(...args.map(sanitizeLogArg))
  console.log = (...args: unknown[]) => originals.log(...args.map(sanitizeLogArg))
  console.warn = (...args: unknown[]) => originals.warn(...args.map(sanitizeLogArg))

  return () => {
    console.debug = originals.debug
    console.error = originals.error
    console.info = originals.info
    console.log = originals.log
    console.warn = originals.warn
  }
}

function installFetchSafety() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => {}

  const nativeFetch = window.fetch.bind(window)

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url, window.location.href)
    const presignMatch = matchStoragePresignDownload(url, request.method)

    if (presignMatch) {
      return fetchStoragePresignWithFallback(nativeFetch, request, url, presignMatch.channelId)
    }

    return nativeFetch(request)
  }

  return () => {
    window.fetch = nativeFetch
  }
}

async function fetchStoragePresignWithFallback(nativeFetch: NativeFetch, request: Request, url: URL, channelId: string) {
  const body = await readJsonBody(request)
  const requestedKey = typeof body.key === 'string' ? normalizeStorageKey(body.key) : ''
  const response = await nativeFetch(request)

  if (response.ok || !requestedKey) return response

  const resolvedKey = await resolveStorageKey(nativeFetch, url, channelId, requestedKey, request.headers)
  if (!resolvedKey || resolvedKey === requestedKey) {
    return localizedStorageErrorResponse(response.status)
  }
  dispatchStorageKeyResolved(channelId, requestedKey, resolvedKey)

  const retryHeaders = new Headers(request.headers)
  retryHeaders.set('content-type', 'application/json')
  const retryResponse = await nativeFetch(request.url, {
    body: JSON.stringify({ ...body, key: resolvedKey }),
    credentials: request.credentials,
    headers: retryHeaders,
    method: 'POST',
    mode: request.mode,
    redirect: request.redirect,
    signal: request.signal,
  })
  return retryResponse.ok ? retryResponse : localizedStorageErrorResponse(retryResponse.status)
}

async function resolveStorageKey(
  nativeFetch: NativeFetch,
  presignUrl: URL,
  channelId: string,
  requestedKey: string,
  headers: Headers,
) {
  const targetName = basename(requestedKey)
  const prefixes = unique([dirnamePrefix(requestedKey), ''])
  const seenPrefixes = new Set<string>()
  const queue = [...prefixes]
  let visited = 0

  while (queue.length > 0 && visited < 64) {
    const prefix = queue.shift() ?? ''
    if (seenPrefixes.has(prefix)) continue
    seenPrefixes.add(prefix)
    visited++

    const data = await fetchStorageList(nativeFetch, presignUrl, channelId, prefix, headers)
    if (!data) continue

    const match = (data.objects ?? []).find((obj) => storageObjectMatches(obj, requestedKey, targetName))
    if (match?.key) return match.key

    for (const dir of data.common_prefixes ?? []) {
      const cleanDir = normalizeStorageKey(dir)
      if (cleanDir && !seenPrefixes.has(cleanDir)) queue.push(ensureTrailingSlash(cleanDir))
    }
  }

  return null
}

async function fetchStorageList(
  nativeFetch: NativeFetch,
  presignUrl: URL,
  channelId: string,
  prefix: string,
  headers: Headers,
): Promise<StorageListResponse | null> {
  const listUrl = new URL(presignUrl.href)
  const encodedChannel = encodeURIComponent(channelId)
  listUrl.pathname = listUrl.pathname.replace(
    new RegExp(`/channels/${escapeRegExp(encodedChannel)}/storage/presign-download$`),
    `/channels/${encodedChannel}/storage`,
  )
  listUrl.search = ''
  if (prefix) listUrl.searchParams.set('prefix', prefix)

  try {
    const response = await nativeFetch(listUrl.href, {
      credentials: 'same-origin',
      headers,
      method: 'GET',
    })
    if (!response.ok) return null
    return await response.json() as StorageListResponse
  } catch {
    return null
  }
}

function storageObjectMatches(obj: StorageObject, requestedKey: string, targetName: string) {
  if (!obj.key) return false
  const key = normalizeStorageKey(obj.key)
  const objName = obj.name || obj.display_name || basename(key)
  const keyName = basename(key)
  const unprefixedKeyName = stripGeneratedPrefix(keyName)
  const requestedDir = dirnamePrefix(requestedKey)

  return (
    key === requestedKey
    || objName === targetName
    || keyName === targetName
    || unprefixedKeyName === targetName
    || (requestedDir !== '' && key === `${requestedDir}${targetName}`)
    || (requestedDir !== '' && key === `${requestedDir}${keyName}` && stripGeneratedPrefix(keyName) === targetName)
  )
}

function sanitizeValue(value: unknown): unknown {
	if (typeof value === 'string') return redactSensitiveUrl(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, sanitizeValue(nested)]),
    )
  }
  return value
}

function sanitizeLogArg(arg: unknown): unknown {
  if (typeof arg === 'string') return redactSensitiveUrl(arg)

  if (
    typeof Event !== 'undefined'
    && typeof WebSocket !== 'undefined'
    && arg instanceof Event
    && arg.target instanceof WebSocket
  ) {
    return {
      target: {
        kind: 'WebSocket',
        readyState: arg.target.readyState,
        url: redactSensitiveUrl(arg.target.url),
      },
      type: arg.type,
    }
  }

  return sanitizeValue(arg)
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.clone().json() as Record<string, unknown>
  } catch {
    return {}
  }
}

function localizedStorageErrorResponse(status: number) {
  return new Response(JSON.stringify({ error: FALLBACK_ERROR }), {
    headers: { 'content-type': 'application/json' },
    status: status >= 400 ? status : 500,
    statusText: 'Storage Download Error',
  })
}

function dispatchStorageKeyResolved(channelId: string, requestedKey: string, resolvedKey: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(STORAGE_KEY_RESOLVED_EVENT, {
    detail: { channelId, requestedKey, resolvedKey },
  }))
}

function matchStoragePresignDownload(url: URL, method: string) {
  if (method.toUpperCase() !== 'POST') return null
  const match = url.pathname.match(/\/channels\/([^/]+)\/storage\/presign-download$/)
  return match ? { channelId: decodeURIComponent(match[1] ?? '') } : null
}

function isSensitiveQueryKey(key: string) {
  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase())
}

function normalizeStorageKey(key: string) {
  const trimmed = key.trim().replace(/^storage:\/\//, '').replace(/^\/+/, '')
  try {
    return decodeURI(trimmed)
  } catch {
    return trimmed
  }
}

function basename(key: string) {
  return normalizeStorageKey(key).split('/').filter(Boolean).pop() || normalizeStorageKey(key)
}

function dirnamePrefix(key: string) {
  const clean = normalizeStorageKey(key)
  const index = clean.lastIndexOf('/')
  return index >= 0 ? clean.slice(0, index + 1) : ''
}

function ensureTrailingSlash(prefix: string) {
  return prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix
}

function stripGeneratedPrefix(name: string) {
  return name.match(GENERATED_PREFIX_RE)?.[1] ?? name
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
