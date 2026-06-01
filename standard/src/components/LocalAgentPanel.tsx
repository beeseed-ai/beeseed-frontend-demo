import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronRight, FileText, FolderOpen, Loader2, Monitor, Play, RefreshCw } from 'lucide-react'
import { Button, cn, Input, useBeeSeedContext } from '@beeseed/beeseed-sdk'

interface LocalAgentCapabilityStatus {
  version?: string
  status?: string
  reason?: string
}

interface LocalAgentDevice {
  id?: string
  app_id?: string
  device_id?: string
  display_name?: string
  platform?: string
  version?: string
  status?: string
  channel_id?: string
  connected_at?: string
  last_seen_at?: string
  revoked_at?: string | null
  capabilities?: Record<string, LocalAgentCapabilityStatus>
  runtime_health?: Record<string, string>
}

interface LocalAgentGrant {
  id?: string
  app_id?: string
  device_id: string
  channel_id?: string | null
  grant_id: string
  display_name?: string
  relative_path?: string
  kind?: string
  permissions?: string[]
  privacy_mode?: string
  lifetime?: string
  expires_at?: string | null
  revoked_at?: string | null
}

interface LocalAgentRun {
  run_id: string
  device_id: string
  channel_id: string
  skill_id?: string
  grant_id?: string
  capability: string
  status: string
  output?: unknown
  error?: unknown
  created_at?: string
  updated_at?: string
  completed_at?: string | null
}

interface LocalAgentDevicesResponse {
  devices?: LocalAgentDevice[]
}

interface LocalAgentGrantsResponse {
  grants?: LocalAgentGrant[]
}

interface LocalAgentRunsResponse {
  runs?: LocalAgentRun[]
}

interface CreateLocalAgentRunResponse {
  status: string
  run_id: string
  device_id: string
  run?: LocalAgentRun
}

interface Props {
  channelId: string | null
  channelName?: string | null
  className?: string
}

const DEFAULT_OUTPUT_PATH = 'outputs/local-agent-test.docx'

function deviceID(device: LocalAgentDevice | null | undefined) {
  return (device?.device_id || device?.id || '').trim()
}

function deviceDisplayName(device: LocalAgentDevice) {
  return device.display_name || device.platform || deviceID(device) || '本地设备'
}

function dateValue(value: string | null | undefined) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function isDeviceOnline(device: LocalAgentDevice) {
  if (device.revoked_at) return false
  const status = (device.status || '').toLowerCase()
  if (status === 'offline' || status === 'revoked' || status === 'stopped') return false
  if (status === 'ok' || status === 'ready' || status === 'degraded' || status === 'unknown') return true
  const lastSeen = dateValue(device.last_seen_at || device.connected_at)
  return lastSeen > 0 && Date.now() - lastSeen < 2 * 60 * 1000
}

function deviceStatusLabel(device: LocalAgentDevice) {
  if (device.revoked_at) return '已撤销'
  if (isDeviceOnline(device)) return '在线'
  return device.status || '离线'
}

function deviceSupportsDocx(device: LocalAgentDevice | null | undefined) {
  const capability = device?.capabilities?.docx_create
  return Boolean(capability && capability.status !== 'error' && capability.status !== 'disabled')
}

function grantMode(grant: LocalAgentGrant | null | undefined) {
  const permissions = grant?.permissions ?? []
  if (permissions.includes('write') || permissions.includes('read_write')) return 'write'
  return 'read'
}

function grantCanWrite(grant: LocalAgentGrant | null | undefined) {
  return grantMode(grant) === 'write'
}

function normalizeOutputPath(value: string) {
  let next = value.trim().replace(/\\/g, '/')
  if (!next) next = DEFAULT_OUTPUT_PATH
  if (/^[a-zA-Z]:/.test(next) || next.startsWith('/') || next.startsWith('~')) {
    return { error: '输出位置只能使用相对路径' }
  }
  const parts = next.split('/').filter(Boolean)
  if (parts.some((part) => part === '..')) {
    return { error: '输出位置不能包含上级目录' }
  }
  next = parts.join('/')
  if (!next.toLowerCase().endsWith('.docx')) next = `${next}.docx`
  return { path: next }
}

function formatTimeLabel(value: string | null | undefined) {
  const parsed = dateValue(value)
  if (!parsed) return '暂无记录'
  const diffMinutes = Math.floor((Date.now() - parsed) / 60_000)
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  return new Date(parsed).toLocaleDateString('zh-CN')
}

function statusTone(status: string) {
  const normalized = status.toLowerCase()
  if (normalized === 'completed' || normalized === 'succeeded' || normalized === 'dispatched' || normalized === 'running') {
    return 'border-[#39bf45] bg-[#f0fbf1] text-[#006400]'
  }
  if (normalized === 'failed' || normalized === 'denied' || normalized === 'cancelled') {
    return 'border-[#aa2d00] bg-[#fff4ef] text-[#aa2d00]'
  }
  return 'border-[#dddddd] bg-[#f8fafc] text-[#41454d]'
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  return '本地 Agent 请求失败'
}

export function LocalAgentPanel({ channelId, channelName, className }: Props) {
  const { api } = useBeeSeedContext()
  const [devices, setDevices] = useState<LocalAgentDevice[]>([])
  const [grants, setGrants] = useState<LocalAgentGrant[]>([])
  const [runs, setRuns] = useState<LocalAgentRun[]>([])
  const [expanded, setExpanded] = useState(false)
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [selectedGrantId, setSelectedGrantId] = useState('')
  const [outputPath, setOutputPath] = useState(DEFAULT_OUTPUT_PATH)
  const [documentTitle, setDocumentTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    if (!channelId) return
    setLoading(true)
    setError('')
    try {
      const [deviceData, grantData, runData] = await Promise.all([
        api.get('local-agent/devices').json<LocalAgentDevicesResponse>(),
        api.get('local-agent/grants', { searchParams: { channel_id: channelId } }).json<LocalAgentGrantsResponse>(),
        api.get('local-agent/runs', { searchParams: { channel_id: channelId } }).json<LocalAgentRunsResponse>(),
      ])
      const nextDevices = deviceData.devices ?? []
      const nextGrants = (grantData.grants ?? []).filter((grant) => !grant.revoked_at)
      setDevices(nextDevices)
      setGrants(nextGrants)
      setRuns(runData.runs ?? [])
      setSelectedDeviceId((current) => {
        if (current && nextDevices.some((device) => deviceID(device) === current)) return current
        const grantedDeviceID = nextGrants.find((grant) => grant.device_id)?.device_id
        if (grantedDeviceID && nextDevices.some((device) => deviceID(device) === grantedDeviceID)) return grantedDeviceID
        return deviceID(nextDevices[0]) || ''
      })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [api, channelId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    setDocumentTitle(`${channelName || '频道'}本地文档草稿`)
    setNotice('')
    setError('')
  }, [channelId, channelName])

  const selectedDevice = useMemo(
    () => devices.find((device) => deviceID(device) === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  )
  const availableGrants = useMemo(
    () => grants.filter((grant) => !selectedDeviceId || grant.device_id === selectedDeviceId),
    [grants, selectedDeviceId],
  )
  const selectedGrant = useMemo(
    () => availableGrants.find((grant) => grant.grant_id === selectedGrantId) ?? null,
    [availableGrants, selectedGrantId],
  )
  const recentRuns = useMemo(
    () => [...runs].sort((a, b) => dateValue(b.updated_at || b.created_at) - dateValue(a.updated_at || a.created_at)).slice(0, 3),
    [runs],
  )
  const onlineDeviceCount = useMemo(() => devices.filter(isDeviceOnline).length, [devices])
  const writableGrantCount = useMemo(() => grants.filter(grantCanWrite).length, [grants])

  useEffect(() => {
    if (selectedGrantId && availableGrants.some((grant) => grant.grant_id === selectedGrantId)) return
    setSelectedGrantId(availableGrants[0]?.grant_id ?? '')
  }, [availableGrants, selectedGrantId])

  async function createDocxRun() {
    if (!channelId || !selectedDevice || !selectedGrant) return
    const normalizedPath = normalizeOutputPath(outputPath)
    if (normalizedPath.error || !normalizedPath.path) {
      setError(normalizedPath.error || '输出位置无效')
      return
    }
    if (!grantCanWrite(selectedGrant)) {
      setError('当前目录授权不包含写入权限')
      return
    }
    setCreating(true)
    setError('')
    setNotice('')
    try {
      const title = documentTitle.trim() || `${channelName || '频道'}本地文档草稿`
      const result = await api.post('local-agent/runs', {
        json: {
          device_id: deviceID(selectedDevice),
          channel_id: channelId,
          skill_id: 'docx-write',
          grant_id: selectedGrant.grant_id,
          capability: 'docx_create',
          idempotency_key: `${channelId}:docx_create:${Date.now()}`,
          grant: {
            id: selectedGrant.grant_id,
            mode: grantMode(selectedGrant),
          },
          payload: {
            output_path: normalizedPath.path,
            overwrite_confirmed: false,
            spec: {
              title,
              sections: [
                {
                  heading: '本地资料',
                  paragraphs: [
                    `频道：${channelName || channelId}`,
                    `授权目录：${selectedGrant.display_name || selectedGrant.relative_path || selectedGrant.grant_id}`,
                  ],
                },
                {
                  heading: '草稿',
                  paragraphs: [
                    '这是 BeeSeed Local Agent 通过本地文档运行时生成的 Word 草稿，用于验证当前频道、设备和目录授权的执行闭环。',
                  ],
                },
              ],
            },
          },
        },
      }).json<CreateLocalAgentRunResponse>()
      setOutputPath(normalizedPath.path)
      setNotice(`已分配 run：${result.run_id}`)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const canRun = Boolean(channelId && selectedDevice && selectedGrant && isDeviceOnline(selectedDevice) && deviceSupportsDocx(selectedDevice) && grantCanWrite(selectedGrant))
  const selectedDeviceLabel = selectedDevice ? `${deviceDisplayName(selectedDevice)} · ${deviceStatusLabel(selectedDevice)}` : '暂无设备'
  const selectedGrantLabel = selectedGrant
    ? `${selectedGrant.display_name || selectedGrant.relative_path || selectedGrant.grant_id} · ${grantMode(selectedGrant)}`
    : '暂无授权'

  return (
    <section className={cn('border-b border-border bg-white', className)}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#777169]" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#777169]" />}
          <Monitor className="h-4 w-4 shrink-0 text-[#41454d]" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium text-[#181d26]">本地 Agent</span>
              {onlineDeviceCount > 0 && (
                <span className="shrink-0 rounded-full border border-[#39bf45]/40 bg-[#f0fbf1] px-1.5 py-0.5 text-[10px] leading-none text-[#006400]">
                  {onlineDeviceCount} 在线
                </span>
              )}
            </div>
            <div className="truncate text-[11px] text-[#6b7280]">
              {devices.length} 台设备 · {grants.length} 个授权 · {writableGrantCount} 可写
            </div>
          </div>
        </button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={refresh} disabled={loading} title="刷新本地 Agent">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {!expanded && (
        <div className="space-y-1.5 px-4 pb-3 text-[11px] leading-4 text-[#6b7280]">
          <div className="truncate">设备：{selectedDeviceLabel}</div>
          <div className="truncate">授权：{selectedGrantLabel}</div>
          {error && <div className="truncate text-[#aa2d00]">错误：{error}</div>}
          {notice && <div className="truncate text-[#006400]">{notice}</div>}
        </div>
      )}

      {expanded && (
        <div className="max-h-[min(58dvh,36rem)] space-y-3 overflow-y-auto px-4 pb-4">
          {error && (
            <div className="flex gap-2 rounded-md border border-[#aa2d00]/25 bg-[#fff4ef] px-3 py-2 text-xs leading-5 text-[#aa2d00]">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          {notice && (
            <div className="rounded-md border border-[#39bf45]/35 bg-[#f0fbf1] px-3 py-2 text-xs leading-5 text-[#006400]">
              {notice}
            </div>
          )}

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[#41454d]">设备</div>
          {devices.length > 0 ? (
            <div className="space-y-1.5">
              {devices.map((device) => {
                const id = deviceID(device)
                const selected = id === selectedDeviceId
                return (
                  <button
                    key={id || device.id}
                    type="button"
                    onClick={() => setSelectedDeviceId(id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                      selected ? 'border-[#9297a0] bg-[#f8fafc]' : 'border-[#dddddd] bg-white hover:border-[#9297a0]',
                    )}
                  >
                    <Monitor className="h-3.5 w-3.5 shrink-0 text-[#41454d]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[#181d26]">{deviceDisplayName(device)}</div>
                      <div className="truncate text-[11px] text-[#6b7280]">{formatTimeLabel(device.last_seen_at || device.connected_at)}</div>
                    </div>
                    <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', isDeviceOnline(device) ? 'border-[#39bf45] bg-[#f0fbf1] text-[#006400]' : 'border-[#dddddd] bg-[#f8fafc] text-[#41454d]')}>
                      {deviceStatusLabel(device)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[#dddddd] px-3 py-2 text-xs text-[#6b7280]">暂无设备</div>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-medium text-[#41454d]">目录授权</div>
          {availableGrants.length > 0 ? (
            <div className="space-y-1.5">
              {availableGrants.map((grant) => {
                const selected = grant.grant_id === selectedGrantId
                return (
                  <button
                    key={grant.grant_id}
                    type="button"
                    onClick={() => setSelectedGrantId(grant.grant_id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                      selected ? 'border-[#9297a0] bg-[#f8fafc]' : 'border-[#dddddd] bg-white hover:border-[#9297a0]',
                    )}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#41454d]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-[#181d26]">{grant.display_name || grant.grant_id}</div>
                      <div className="truncate text-[11px] text-[#6b7280]">{grant.relative_path || '工作目录'}</div>
                    </div>
                    <span className="rounded-full border border-[#dddddd] bg-white px-2 py-0.5 text-[10px] text-[#41454d]">
                      {grantMode(grant)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-[#dddddd] px-3 py-2 text-xs text-[#6b7280]">暂无目录授权</div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[#41454d]">标题</span>
            <Input
              value={documentTitle}
              onChange={(event) => setDocumentTitle(event.target.value)}
              className="h-8 rounded-md text-xs"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-[#41454d]">保存为</span>
            <Input
              value={outputPath}
              onChange={(event) => setOutputPath(event.target.value)}
              className="h-8 rounded-md font-mono text-xs"
            />
          </label>
          <Button type="button" className="w-full" size="sm" onClick={createDocxRun} disabled={!canRun || creating}>
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            生成 Word
          </Button>
        </div>

        {selectedDevice && !deviceSupportsDocx(selectedDevice) && (
          <div className="rounded-md border border-[#d9a441]/40 bg-[#fff9e8] px-3 py-2 text-xs leading-5 text-[#7a5200]">
            当前设备未上报 docx_create 能力
          </div>
        )}

        {recentRuns.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-[#41454d]">最近运行</div>
            <div className="space-y-1.5">
              {recentRuns.map((run) => (
                <div key={run.run_id} className="flex items-center gap-2 rounded-md border border-[#dddddd] bg-[#f8fafc] px-2.5 py-2">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-[#41454d]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-[#181d26]">{run.run_id}</div>
                    <div className="truncate text-[11px] text-[#6b7280]">{run.capability}</div>
                  </div>
                  <span className={cn('rounded-full border px-2 py-0.5 text-[10px]', statusTone(run.status))}>
                    {run.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      )}
    </section>
  )
}
