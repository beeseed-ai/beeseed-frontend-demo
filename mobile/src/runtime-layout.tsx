import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, Hash, LogOut, Plus, Shield, Users, X } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AdminPanel,
  Button,
  ChatChannel,
  CreateChannelDialog,
  KnowledgePanel,
  cn,
  useAppConfig,
  useAuth,
  useChannels,
  useChat,
  useDetailPanel,
  type ChannelWithMeta,
  type ChannelMemberInfo,
  type FeatureView,
  type AppRuntimeConfig,
} from '@beeseed/beeseed-sdk'
import { CloudStoragePanel } from './components/CloudStoragePanel'
import { MobileTaskPanel } from './components/MobileTaskPanel'
import { AgentCharacterSheet } from './components/AgentCharacterSheet'

type MobileTab = 'chat' | 'tasks' | 'knowledge' | 'storage' | 'profile'

type GameIconName = 'chat' | 'tasks' | 'knowledge' | 'storage' | 'profile'

interface TabItem {
  id: MobileTab
  label: string
  icon: GameIconName
  tone: string
}

const BASE_TABS: TabItem[] = [
  { id: 'chat', label: '冒险', icon: 'chat', tone: 'from-[#ff7eb3] to-[#ffca3a]' },
  { id: 'tasks', label: '任务', icon: 'tasks', tone: 'from-[#7c5cff] to-[#41d7ff]' },
  { id: 'knowledge', label: '图鉴', icon: 'knowledge', tone: 'from-[#25d366] to-[#9cff6e]' },
  { id: 'storage', label: '背包', icon: 'storage', tone: 'from-[#ff9f1c] to-[#ff5f6d]' },
  { id: 'profile', label: '我的', icon: 'profile', tone: 'from-[#ff7eb3] to-[#7c5cff]' },
]

function GameIcon({ name, active = false }: { name: GameIconName; active?: boolean }) {
  const common = 'drop-shadow-[0_2px_0_rgba(84,45,133,0.25)]'
  if (name === 'chat') {
    return (
      <svg viewBox="0 0 48 48" className={common} aria-hidden>
        <path d="M9 16c0-6 5-10 15-10s15 4 15 10v7c0 6-5 10-15 10h-5l-8 6 2-8c-3-2-4-5-4-8v-7Z" fill={active ? '#fff16a' : '#ff8ab3'} stroke="#5f3b93" strokeWidth="3" />
        <circle cx="19" cy="19" r="2.4" fill="#5f3b93" />
        <circle cx="29" cy="19" r="2.4" fill="#5f3b93" />
        <path d="M19 26c3 2 7 2 10 0" fill="none" stroke="#5f3b93" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'tasks') {
    return (
      <svg viewBox="0 0 48 48" className={common} aria-hidden>
        <path d="M13 8h22c3 0 5 2 5 5v24c0 3-2 5-5 5H13c-3 0-5-2-5-5V13c0-3 2-5 5-5Z" fill={active ? '#7ee7ff' : '#b8a7ff'} stroke="#5f3b93" strokeWidth="3" />
        <path d="m16 21 4 4 8-9M16 32h16" fill="none" stroke="#5f3b93" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'knowledge') {
    return (
      <svg viewBox="0 0 48 48" className={common} aria-hidden>
        <path d="M10 12c0-3 2-5 5-5h8c3 0 5 2 5 5v28H15c-3 0-5-2-5-5V12Z" fill={active ? '#b7ff7a' : '#7ee8b5'} stroke="#286b5f" strokeWidth="3" />
        <path d="M28 12c0-3 2-5 5-5h1c3 0 5 2 5 5v23c0 3-2 5-5 5h-6V12Z" fill="#fff6a8" stroke="#286b5f" strokeWidth="3" />
        <path d="M17 18h6M17 26h5" stroke="#286b5f" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'storage') {
    return (
      <svg viewBox="0 0 48 48" className={common} aria-hidden>
        <path d="M10 19h28l-3 20H13L10 19Z" fill={active ? '#ffd36a' : '#ff9f6e'} stroke="#7a3f38" strokeWidth="3" strokeLinejoin="round" />
        <path d="M16 19c1-7 5-11 9-11s8 4 9 11" fill="none" stroke="#7a3f38" strokeWidth="3" strokeLinecap="round" />
        <path d="M19 29h10" stroke="#7a3f38" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 48 48" className={common} aria-hidden>
      <circle cx="24" cy="17" r="8" fill={active ? '#fff16a' : '#91d7ff'} stroke="#4d4aa8" strokeWidth="3" />
      <path d="M10 41c2-8 8-12 14-12s12 4 14 12H10Z" fill="#ff8ab3" stroke="#4d4aa8" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  )
}

function MobileTopBar({
  title,
  subtitle,
  leading,
  trailing,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <div className="mobile-game-topbar flex min-h-14 shrink-0 items-center gap-2 px-3 py-2">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-black text-[#5f3b93]">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-[11px] font-bold text-[#9b6ccf]">{subtitle}</div>}
      </div>
      {trailing}
    </div>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="mobile-game-stage flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm font-bold text-[#6a4c93]">
      {children}
    </div>
  )
}

function ChannelPicker({
  open,
  channels,
  currentChannelId,
  onClose,
  onSelect,
  onCreate,
}: {
  open: boolean
  channels: ChannelWithMeta[]
  currentChannelId: string | null
  onClose: () => void
  onSelect: (channelId: string) => void
  onCreate: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/30" role="dialog" aria-modal="true" aria-label="选择对话">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="关闭对话列表" />
      <div className="absolute inset-x-3 bottom-3 max-h-[min(78dvh,36rem)] overflow-hidden rounded-3xl border-4 border-[#6a4c93] bg-[#fff7cf] shadow-[0_12px_0_rgba(106,76,147,0.18)]">
        <div className="flex items-center gap-2 border-b-4 border-[#ffd166] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-[#5f3b93]">冒险地图</div>
            <div className="mt-0.5 text-[11px] font-bold text-[#9b6ccf]">{channels.length} 个频道</div>
          </div>
          <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" onClick={onCreate}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新建
          </Button>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(min(78dvh,36rem)-3.5rem)] overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          {channels.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">暂无可访问频道</div>
          ) : (
            channels.map((channel) => {
              const active = channel.id === currentChannelId
              return (
                <button
                  key={channel.id}
                  type="button"
                  data-testid="mobile-channel-item"
                  onClick={() => onSelect(channel.id)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-[#ffd166]/70 px-4 py-3 text-left transition-colors last:border-b-0',
                    active ? 'bg-white/70' : 'hover:bg-white/45',
                  )}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border-2 border-[#6a4c93] bg-[#7ee7ff]">
                    <Hash className="h-4 w-4 text-[#5f3b93]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-black text-[#5f3b93]">{channel.name || '对话'}</div>
                    <div className="mt-0.5 text-[11px] font-bold text-[#9b6ccf]">{channel.member_count || 0} 位成员</div>
                  </div>
                  {channel.unread_count > 0 && (
                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#181d26] px-1.5 text-[10px] font-medium text-white">
                      {channel.unread_count > 99 ? '99+' : channel.unread_count}
                    </span>
                  )}
                  {active && <Check className="h-4 w-4 shrink-0 text-[#181d26]" />}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function memberLabel(member: ChannelMemberInfo): string {
  return member.display_name || member.nickname || member.agent_id || member.user_id || '成员'
}

function memberKindLabel(member: ChannelMemberInfo): string {
  if (member.member_type === 'agent') return member.is_coordinator ? '协调 Agent' : 'Agent'
  if (member.member_type === 'system') return '系统'
  return member.role === 'owner' ? '群主' : '成员'
}

function MemberList({
  currentChannel,
  members,
  onAgentSelect,
}: {
  currentChannel: ChannelWithMeta | null
  members: ChannelMemberInfo[]
  onAgentSelect?: (member: ChannelMemberInfo) => void
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-[#5f3b93]">群成员</div>
          <div className="mt-0.5 text-[11px] font-bold text-[#9b6ccf]">
            {currentChannel ? `${members.length || currentChannel.member_count || 0} 位成员` : '未选择频道'}
          </div>
        </div>
        {currentChannel && (
          <div className="rounded-full border-2 border-[#6a4c93]/30 bg-white/60 px-2.5 py-1 text-[11px] font-black text-[#6a4c93]">
            #{currentChannel.name || '对话'}
          </div>
        )}
      </div>
      {members.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-[#6a4c93]/35 bg-white/50 px-3 py-5 text-center text-sm font-bold text-[#9b6ccf]">
          暂无成员列表数据
        </div>
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <button
              key={member.id}
              type="button"
              className={cn('mobile-game-member-row w-full text-left', member.member_type === 'agent' && 'is-agent')}
              onClick={() => {
                if (member.member_type === 'agent') onAgentSelect?.(member)
              }}
              disabled={member.member_type !== 'agent'}
            >
              <Avatar className="h-10 w-10 shrink-0 border-2 border-[#6a4c93] bg-[#fff16a]">
                {member.avatar_url ? <AvatarImage src={member.avatar_url} /> : null}
                <AvatarFallback className="bg-transparent text-xs font-black text-[#5f3b93]">
                  {memberLabel(member)[0] || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-black text-[#5f3b93]">{memberLabel(member)}</div>
                <div className="mt-0.5 truncate text-[11px] font-bold text-[#9b6ccf]">{memberKindLabel(member)}</div>
              </div>
              {member.is_coordinator && (
                <span className="rounded-full bg-[#fff16a] px-2 py-1 text-[10px] font-black text-[#5f3b93]">队长</span>
              )}
              {member.member_type === 'agent' && (
                <span className="mobile-game-member-detail-badge">详情</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MemberSheet({
  open,
  currentChannel,
  members,
  onClose,
  onAgentSelect,
}: {
  open: boolean
  currentChannel: ChannelWithMeta | null
  members: ChannelMemberInfo[]
  onClose: () => void
  onAgentSelect?: (member: ChannelMemberInfo) => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/30" role="dialog" aria-modal="true" aria-label="群成员列表">
      <button type="button" className="absolute inset-0 h-full w-full cursor-default" onClick={onClose} aria-label="关闭群成员列表" />
      <div className="absolute inset-x-3 bottom-3 max-h-[min(78dvh,36rem)] overflow-hidden rounded-3xl border-4 border-[#6a4c93] bg-[#fff7cf] shadow-[0_12px_0_rgba(106,76,147,0.18)]">
        <div className="flex items-center gap-2 border-b-4 border-[#ffd166] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-black text-[#5f3b93]">队伍成员</div>
            <div className="mt-0.5 truncate text-[11px] font-bold text-[#9b6ccf]">{currentChannel?.name || '当前频道'}</div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9297a0]/35"
            onClick={onClose}
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[calc(min(78dvh,36rem)-3.5rem)] overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <MemberList
            currentChannel={currentChannel}
            members={members}
            onAgentSelect={(member) => {
              onClose()
              onAgentSelect?.(member)
            }}
          />
        </div>
      </div>
    </div>
  )
}

function ProfilePage({
  onAdmin,
}: {
  onAdmin: () => void
}) {
  const { user, signOut, init } = useAuth()
  const { appConfig } = useAppConfig()
  const [loadingProfile, setLoadingProfile] = useState(true)
  const profileURL = useMemo(() => buildHiveProfileURL(appConfig), [appConfig])
  const profileOrigin = useMemo(() => {
    if (!profileURL) return ''
    try {
      return new URL(profileURL).origin
    } catch {
      return ''
    }
  }, [profileURL])
  const isAdmin = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin'

  useEffect(() => {
    setLoadingProfile(true)
  }, [profileURL])

  useEffect(() => {
    if (!profileOrigin) return

    function handleMessage(event: MessageEvent) {
      if (event.origin !== profileOrigin) return
      const data = typeof event.data === 'object' && event.data !== null
        ? event.data as { type?: string }
        : null
      if (data?.type === 'beeseed:hive-profile-updated') void init()
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [init, profileOrigin])

  return (
    <div className="mobile-game-panel flex h-full min-h-0 flex-col">
      <MobileTopBar title="个人中心" subtitle="Hive 账户" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mobile-game-profile-card mobile-game-profile-embed-card mb-4">
          {profileURL ? (
            <div className="mobile-game-profile-embed-frame">
              {loadingProfile && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm font-black text-[#6a4c93]">
                  正在加载 Hive 个人中心...
                </div>
              )}
              <iframe
                title="Hive 个人中心"
                src={profileURL}
                className="h-full w-full border-0"
                onLoad={() => setLoadingProfile(false)}
                allow="clipboard-write"
              />
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm font-bold leading-6 text-[#6a4c93]">
              当前应用缺少 Hive 平台入口配置，暂时无法打开个人中心。
            </div>
          )}
        </div>

        <div className="mobile-game-profile-card">
          {isAdmin && (
            <button
              type="button"
              className="mobile-game-profile-action mb-2"
              onClick={onAdmin}
            >
              <Shield className="h-4 w-4 text-muted-foreground" />
              管理后台
            </button>
          )}
          <button
            type="button"
            className="mobile-game-profile-action text-[#aa2d00]"
            onClick={() => signOut({ scope: 'global' })}
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  )
}

const PROFILE_TOKEN_QUERY_KEYS = ['beeseed_launch_token', 'beeseed_token', 'token', 'auth_token', 'access_token']
const PROFILE_SIGNED_OUT_KEYS = ['signed_out', 'logout', 'logged_out']

function buildHiveProfileURL(appConfig?: AppRuntimeConfig | null): string {
  const platformURL = profilePlatformExternalURL(appConfig)
  if (!platformURL || typeof window === 'undefined') return ''

  const profileURL = new URL('/profile', platformURL)
  profileURL.searchParams.set('embed', '1')
  profileURL.searchParams.set('return_to', appProfileReturnTo())
  profileURL.searchParams.set('origin', window.location.origin)
  return profileURL.toString()
}

function profilePlatformExternalURL(appConfig?: AppRuntimeConfig | null): string {
  const configured = appConfig?.platform?.external_url?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  if (typeof window === 'undefined') return ''
  const { protocol, hostname } = window.location
  if (hostname === 'localhost' || hostname === '127.0.0.1') return ''
  const parts = hostname.split('.').filter(Boolean)
  if (parts.length < 2) return ''
  parts[0] = 'hive'
  return `${protocol}//${parts.join('.')}`
}

function appProfileReturnTo(): string {
  const url = new URL(window.location.href)
  removeProfileParams(url.searchParams, PROFILE_TOKEN_QUERY_KEYS)
  removeProfileParams(url.searchParams, PROFILE_SIGNED_OUT_KEYS)

  const hashText = url.hash.charAt(0) === '#' ? url.hash.slice(1) : url.hash
  const hashParams = new URLSearchParams(hashText.charAt(0) === '?' ? hashText.slice(1) : hashText)
  let changedHash = false
  for (const key of [...PROFILE_TOKEN_QUERY_KEYS, ...PROFILE_SIGNED_OUT_KEYS]) {
    if (hashParams.has(key)) changedHash = true
    hashParams.delete(key)
  }
  if (changedHash) {
    const nextHash = hashParams.toString()
    url.hash = nextHash ? '#' + nextHash : ''
  }

  return url.toString()
}

function removeProfileParams(params: URLSearchParams, keys: string[]) {
  for (const key of keys) params.delete(key)
}

function BottomNav({
  activeTab,
  onSelect,
}: {
  activeTab: MobileTab
  onSelect: (feature: MobileTab) => void
}) {
  return (
    <nav className="mobile-game-nav shrink-0 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2" aria-label="主导航">
      <div className="grid h-[4.75rem] grid-cols-5 gap-1.5 rounded-[1.6rem] border-4 border-[#6a4c93] bg-[#fff7cf]/95 p-1.5 shadow-[0_6px_0_rgba(106,76,147,0.25)]">
        {BASE_TABS.map((tab) => {
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              className={cn(
                'relative flex min-w-0 -translate-y-0 flex-col items-center justify-center gap-0.5 rounded-[1.15rem] border-2 text-[11px] font-black transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#fff16a]',
                active ? `-translate-y-1 border-[#5f3b93] bg-gradient-to-br ${tab.tone} text-white shadow-[0_4px_0_rgba(95,59,147,0.35)]` : 'border-[#e7c96a] bg-white/80 text-[#7c5cff]',
              )}
              onClick={() => onSelect(tab.id)}
              aria-current={active ? 'page' : undefined}
            >
              <span className="h-7 w-7"><GameIcon name={tab.icon} active={active} /></span>
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function RuntimeAppLayout({ className }: { className?: string }) {
  const { branding } = useAppConfig()
  const { user } = useAuth()
  const { channels, currentChannelId, loading, setCurrentChannel } = useChannels()
  const { members } = useChat(currentChannelId)
  const { activeFeature, setActiveFeature } = useDetailPanel()
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('chat')
  const [channelSheetOpen, setChannelSheetOpen] = useState(false)
  const [memberSheetOpen, setMemberSheetOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<ChannelMemberInfo | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const isAdmin = user?.role === 'owner' || user?.role === 'admin' || user?.role === 'super_admin'
  const currentChannel = useMemo(
    () => channels.find((channel) => channel.id === currentChannelId) ?? null,
    [channels, currentChannelId],
  )

  useEffect(() => {
    if (activeFeature === 'admin' && !isAdmin) setActiveFeature('chat')
  }, [activeFeature, isAdmin, setActiveFeature])

  useEffect(() => {
    if (activeFeature === 'chat' || activeFeature === 'tasks' || activeFeature === 'knowledge' || activeFeature === 'storage') {
      setActiveMobileTab(activeFeature)
    }
  }, [activeFeature])

  function selectChannel(channelId: string) {
    setCurrentChannel(channelId)
    setActiveFeature('chat')
    setActiveMobileTab('chat')
    setChannelSheetOpen(false)
  }

  function selectFeature(feature: MobileTab) {
    setActiveMobileTab(feature)
    if (feature !== 'profile') setActiveFeature(feature)
    if (feature === 'profile' && activeFeature === 'admin') setActiveFeature('chat')
  }

  function openAdmin() {
    setActiveMobileTab('profile')
    setActiveFeature('admin')
  }

  function openAgentCharacter(member: ChannelMemberInfo) {
    if (member.member_type !== 'agent') return
    setSelectedAgent(member)
  }

  useEffect(() => {
    function handleOpenAgentCharacter(event: Event) {
      const agentId = (event as CustomEvent<{ agentId?: string }>).detail?.agentId
      if (!agentId) return
      const member = members.find((item) => item.member_type === 'agent' && item.agent_id === agentId)
      if (member) setSelectedAgent(member)
    }

    window.addEventListener('beeseed-mobile-open-agent', handleOpenAgentCharacter)
    return () => window.removeEventListener('beeseed-mobile-open-agent', handleOpenAgentCharacter)
  }, [members])

  const topSubtitle = currentChannel
    ? `${currentChannel.member_count || 0} 位成员`
    : loading
      ? '正在加载频道'
      : '选择一个频道'

  return (
    <div className={cn('mobile-game-shell flex h-[100dvh] min-w-0 flex-col overflow-hidden', className)}>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeFeature === 'admin' && isAdmin ? (
          <div className="flex h-full min-h-0 flex-col">
            <MobileTopBar title="管理后台" subtitle={branding.title} />
            <div className="mobile-game-admin min-h-0 flex-1 overflow-hidden">
              <AdminPanel />
            </div>
          </div>
        ) : activeMobileTab === 'chat' ? (
          currentChannelId ? (
            <ChatChannel
              channelId={currentChannelId}
              header={
                <MobileTopBar
                  title={currentChannel?.name || '对话'}
                  subtitle={topSubtitle}
                  leading={
                    <button
                      type="button"
                      className="mobile-game-icon-button inline-flex h-10 w-10 shrink-0 items-center justify-center"
                      onClick={() => setChannelSheetOpen(true)}
                      aria-label="选择对话"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  }
                  trailing={
                    <button
                      type="button"
                      className="mobile-game-icon-button inline-flex h-10 w-10 shrink-0 items-center justify-center"
                      onClick={() => setMemberSheetOpen(true)}
                      aria-label="群成员列表"
                    >
                      <Users className="h-4 w-4" />
                    </button>
                  }
                />
              }
            />
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <MobileTopBar
                title={branding.title}
                subtitle={topSubtitle}
              />
              <EmptyState>
                {loading ? '正在加载频道...' : '暂无可访问频道，请新建或加入一个频道。'}
              </EmptyState>
            </div>
          )
        ) : activeMobileTab === 'tasks' ? (
          <div className="mobile-game-tasks flex h-full min-h-0 flex-col">
            <MobileTaskPanel channelId={currentChannelId} members={members} />
          </div>
        ) : activeMobileTab === 'knowledge' ? (
          <KnowledgePanel />
        ) : activeMobileTab === 'storage' ? (
          <div className="mobile-game-panel flex h-full min-h-0 flex-col">
            <MobileTopBar title="背包" subtitle={currentChannel?.name || '当前频道'} />
            <CloudStoragePanel channelId={currentChannelId} />
          </div>
        ) : activeMobileTab === 'profile' ? (
          <ProfilePage onAdmin={openAdmin} />
        ) : (
          <EmptyState>当前功能暂不可用</EmptyState>
        )}
      </div>

      <BottomNav
        activeTab={activeFeature === 'admin' ? 'profile' : activeMobileTab}
        onSelect={selectFeature}
      />

      <ChannelPicker
        open={channelSheetOpen}
        channels={channels}
        currentChannelId={currentChannelId}
        onClose={() => setChannelSheetOpen(false)}
        onSelect={selectChannel}
        onCreate={() => {
          setChannelSheetOpen(false)
          setCreateDialogOpen(true)
        }}
      />
      <MemberSheet
        open={memberSheetOpen}
        currentChannel={currentChannel}
        members={members}
        onClose={() => setMemberSheetOpen(false)}
        onAgentSelect={openAgentCharacter}
      />
      <AgentCharacterSheet
        open={!!selectedAgent}
        channelId={currentChannelId}
        member={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
      <CreateChannelDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </div>
  )
}
