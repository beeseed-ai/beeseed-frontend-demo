import {
  Component,
  type CSSProperties,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from 'react'
import {
  Application as PixiApplication,
  Assets as PixiAssets,
  Container as PixiContainer,
  Graphics as PixiGraphics,
  Rectangle as PixiRectangle,
  Sprite as PixiSprite,
  Text as PixiText,
  Texture as PixiTexture,
} from 'pixi.js'
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ClipboardList,
  Copy,
  FolderOpen,
  Minus,
  Monitor,
  PanelRightOpen,
  Pause,
  Play,
  Plus,
  Radio,
  StepBack,
  StepForward,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import {
  AuthGuard,
  BeeSeedProvider,
  Button,
  ChatChannel,
  CreateChannelDialog,
  LoginForm,
  RegisterForm,
  applyDocumentBranding,
  resolveAppBranding,
  useAppConfig,
  useAuth,
  useChannels,
  useChat,
  useConnection,
  type AppRuntimeConfig,
  type AgentLoopState,
  type AgentLoopToolCall,
  type ChannelMemberInfo,
  type ChannelWithMeta,
} from '@beeseed/beeseed-sdk'

const DEFAULT_RUNTIME_CONFIG: AppRuntimeConfig = {}
const TOKEN_STORAGE_KEY = 'beeseed_token'
const LAST_CHANNEL_STORAGE_PREFIX = 'beeseed:game-room:last-channel:v1'
const IDLE_TO_SLEEP_DELAY = 120000
const AGENT_MOVE_SPEED = 90
const AGENT_RETURN_SPEED = 105
const TOOL_SETTLE_MS = 180
const TOOL_FINISH_MS = 420
const ASSISTANT_SPRITE_BASE = '/assets/characters/assistant'
const ASSISTANT_REVIEW_BASE = '/assets/review/assistant'
const ASSISTANT_WALK_VIDEO_BASE = '/assets/review/assistant/videos'
const ROOM_SCENE_BASE = '/assets/rooms/agent-room'
const ROOM_SCENE_AGENT_SCALE = 1.4
const CYCLE_REVIEW_SOURCE_FRAMES = 75
const CYCLE_REVIEW_SOURCE_DURATION_SECONDS = 3.162667
const CYCLE_REVIEW_SOURCE_FPS = CYCLE_REVIEW_SOURCE_FRAMES / CYCLE_REVIEW_SOURCE_DURATION_SECONDS
const CYCLE_REVIEW_VIDEO_ELEMENT_VERSION = 2
const APPROVED_WALK_RUNTIME_FRAMES = 23

type AgentMood = 'idle' | 'running' | 'tool' | 'waiting' | 'error'
type ToolKind = 'time' | 'web' | 'tasks' | 'storage' | 'knowledge' | 'console'
type Facing = 'front_right' | 'front_left' | 'back_right' | 'back_left'
type SpriteAction = 'idle' | 'walk' | 'use' | 'sleep'
type SpriteDirection = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
type AgentMode =
  | 'idle'
  | 'walk'
  | 'sleep'
  | 'ask_user'
  | 'error'
  | 'use_clock'
  | 'use_computer'
  | 'use_whiteboard'
  | 'use_storage'
  | 'use_knowledge'
  | 'use_console'

interface Point {
  x: number
  y: number
}

interface ToolScene {
  kind: ToolKind
  label: string
  detail: string
  icon: typeof Clock3
}

interface RoomToolTarget {
  standPoint: Point
  face: Facing
  mode: AgentMode
}

interface RoomPropConfig extends ToolScene {
  id: ToolKind
  position: Point
  z: number
  toolNames: string[]
  toolKind: ToolKind
  standPoint: Point
  face: Facing
  mode: AgentMode
}

interface RoomLayout {
  width: number
  height: number
  idlePoint: Point
  sleepPoint: Point
  props: RoomPropConfig[]
}

interface AnimationSpec {
  frames: number
  fps: number
}

interface AgentCommandWalk {
  type: 'walk'
  to: Point
  face: Facing
  speed: number
  toolCallId?: string
}

interface AgentCommandPlay {
  type: 'play'
  mode: AgentMode
  toolCallId?: string
  minMs?: number
  maxMs?: number
  requireResult?: boolean
}

interface AgentCommandPause {
  type: 'pause'
  mode: AgentMode
  durationMs: number
  face?: Facing
}

interface AgentCommandSleep {
  type: 'sleep'
}

type AgentCommand = AgentCommandWalk | AgentCommandPlay | AgentCommandPause | AgentCommandSleep

interface AgentRuntimeState {
  x: number
  y: number
  facing: Facing
  mode: AgentMode
  frame: number
  frameAccumulator: number
  queue: AgentCommand[]
  active?: AgentCommand
  activeStartedAt: number
  lastActionAt: number
  isSleeping: boolean
}

interface RoomAgentView {
  key: string
  name: string
  runtime: AgentRuntimeState
  variant: number
  active: boolean
}

interface SpriteFrameMeta {
  action: SpriteAction
  direction: SpriteDirection
  frame: number
  rect: {
    x: number
    y: number
    w: number
    h: number
  }
  anchor: {
    x: number
    y: number
  }
}

interface SpriteSheetMeta {
  image: string
  action: SpriteAction
  directions: SpriteDirection[]
  framesPerDirection: number
  framesPerDirectionByDirection?: Partial<Record<SpriteDirection, number>>
  frameWidth: number
  frameHeight: number
  fps?: number
  anchor: {
    x: number
    y: number
  }
  frames: SpriteFrameMeta[]
}

interface RoomSceneAssetImage {
  type: 'image'
  src: string
}

interface RoomSceneAssetSprite {
  type: 'sprite'
  manifest: string
}

type RoomSceneAsset = RoomSceneAssetImage | RoomSceneAssetSprite

interface RoomSceneLayer {
  asset: string
  x: number
  y: number
  z: number
  scale?: number
}

interface RoomScenePad extends Point {
  id: string
  z: number
  scale?: number
}

interface RoomSceneLabel extends Point {
  text: string
  targetX: number
  targetY: number
}

interface RoomSceneNavNode extends Point {
  id: string
}

interface RoomSceneNavigation {
  nodes: RoomSceneNavNode[]
  edges: Array<[string, string]>
  route: string[]
}

interface RoomSceneManifest {
  kind: string
  version: number
  size: {
    width: number
    height: number
  }
  assetBase: string
  assets: Record<string, RoomSceneAsset>
  layers: RoomSceneLayer[]
  pads: RoomScenePad[]
  labels: RoomSceneLabel[]
  agentRoute: Point[]
  navigation?: RoomSceneNavigation
}

interface RoomPropFrameMeta {
  frame: number
  rect: {
    x: number
    y: number
    w: number
    h: number
  }
  anchor: Point
}

interface RoomPropSpriteMeta {
  kind: string
  image: string
  action: 'idle' | 'active'
  frameWidth: number
  frameHeight: number
  framesPerDirection: number
  fps: number
  anchor: Point
  frames: RoomPropFrameMeta[]
}

interface LoadedRoomPropSheet {
  meta: RoomPropSpriteMeta
  texture: PixiTexture
  frames: PixiTexture[]
}

interface LoadedSpriteSheet {
  meta: SpriteSheetMeta
  texture: PixiTexture
}

type AssistantSpriteSheets = Record<SpriteAction, LoadedSpriteSheet>

interface ReviewSpriteAsset {
  id: string
  title: string
  description: string
  baseUrl: string
  metaFile: string
  scale: number
}

interface CycleSelection {
  start: number
  end: number
}

const TOOL_SCENES: Record<ToolKind, ToolScene> = {
  time: { kind: 'time', label: '时钟', detail: 'current_time', icon: Clock3 },
  web: { kind: 'web', label: '电脑', detail: 'http_request', icon: Monitor },
  tasks: { kind: 'tasks', label: '白板', detail: 'task_management', icon: ClipboardList },
  storage: { kind: 'storage', label: '文件柜', detail: 'storage tools', icon: FolderOpen },
  knowledge: { kind: 'knowledge', label: '资料台', detail: 'knowledge_search', icon: BookOpen },
  console: { kind: 'console', label: '控制台', detail: 'other tools', icon: Wrench },
}

const ROOM_LAYOUT: RoomLayout = {
  width: 520,
  height: 332,
  idlePoint: { x: 252, y: 215 },
  sleepPoint: { x: 178, y: 258 },
  props: [
    {
      id: 'time',
      kind: 'time',
      label: '时钟',
      detail: 'current_time',
      icon: Clock3,
      position: { x: 170, y: 104 },
      z: 40,
      toolNames: ['current_time', 'time'],
      toolKind: 'time',
      standPoint: { x: 146, y: 206 },
      face: 'back_left',
      mode: 'use_clock',
    },
    {
      id: 'web',
      kind: 'web',
      label: '电脑',
      detail: 'http_request',
      icon: Monitor,
      position: { x: 228, y: 178 },
      z: 70,
      toolNames: ['http_request', 'request', 'fetch'],
      toolKind: 'web',
      standPoint: { x: 268, y: 238 },
      face: 'back_left',
      mode: 'use_computer',
    },
    {
      id: 'tasks',
      kind: 'tasks',
      label: '白板',
      detail: 'task_management',
      icon: ClipboardList,
      position: { x: 305, y: 154 },
      z: 64,
      toolNames: ['task_management', 'todo_list', 'todo'],
      toolKind: 'tasks',
      standPoint: { x: 322, y: 224 },
      face: 'back_left',
      mode: 'use_whiteboard',
    },
    {
      id: 'storage',
      kind: 'storage',
      label: '文件柜',
      detail: 'storage_*',
      icon: FolderOpen,
      position: { x: 366, y: 182 },
      z: 60,
      toolNames: [
        'storage_list',
        'storage_read',
        'storage_write',
        'storage_delete',
        'storage_presign_download',
        'storage',
      ],
      toolKind: 'storage',
      standPoint: { x: 382, y: 232 },
      face: 'back_right',
      mode: 'use_storage',
    },
    {
      id: 'knowledge',
      kind: 'knowledge',
      label: '资料台',
      detail: 'knowledge_search',
      icon: BookOpen,
      position: { x: 132, y: 244 },
      z: 90,
      toolNames: ['knowledge_search', 'knowledge'],
      toolKind: 'knowledge',
      standPoint: { x: 156, y: 248 },
      face: 'front_right',
      mode: 'use_knowledge',
    },
    {
      id: 'console',
      kind: 'console',
      label: '控制台',
      detail: 'other tools',
      icon: Wrench,
      position: { x: 442, y: 246 },
      z: 94,
      toolNames: ['*'],
      toolKind: 'console',
      standPoint: { x: 420, y: 252 },
      face: 'front_left',
      mode: 'use_console',
    },
  ],
}

const ANIMATION_MAP: Record<AgentMode, AnimationSpec> = {
  idle: { frames: 8, fps: 4 },
  walk: { frames: APPROVED_WALK_RUNTIME_FRAMES, fps: CYCLE_REVIEW_SOURCE_FPS },
  sleep: { frames: 8, fps: 2 },
  ask_user: { frames: 8, fps: 4 },
  error: { frames: 6, fps: 8 },
  use_clock: { frames: 8, fps: 7 },
  use_computer: { frames: 12, fps: 8 },
  use_whiteboard: { frames: 12, fps: 8 },
  use_storage: { frames: 10, fps: 7 },
  use_knowledge: { frames: 10, fps: 6 },
  use_console: { frames: 8, fps: 6 },
}

const DEFAULT_AGENT_RUNTIME: AgentRuntimeState = {
  x: ROOM_LAYOUT.idlePoint.x,
  y: ROOM_LAYOUT.idlePoint.y,
  facing: 'front_right',
  mode: 'idle',
  frame: 0,
  frameAccumulator: 0,
  queue: [],
  active: undefined,
  activeStartedAt: 0,
  lastActionAt: Date.now(),
  isSleeping: false,
}

const ROOM_TOOL_MAP: Record<ToolKind, RoomToolTarget> = Object.fromEntries(
  ROOM_LAYOUT.props.map((prop) => [prop.toolKind, { standPoint: prop.standPoint, face: prop.face, mode: prop.mode }]),
) as Record<ToolKind, RoomToolTarget>

const ASK_USER_POINT: Point = { x: ROOM_LAYOUT.idlePoint.x + 22, y: ROOM_LAYOUT.idlePoint.y + 8 }
const COMPANION_AGENT_POINTS: Array<Point & { facing: Facing }> = [
  { x: 210, y: 246, facing: 'front_right' },
  { x: 334, y: 248, facing: 'front_left' },
  { x: 202, y: 214, facing: 'front_right' },
  { x: 358, y: 216, facing: 'front_left' },
]
const AGENT_ACCENTS = ['#a8d8c4', '#f4d35e', '#fcab79', '#f5e9d4']

function toolKindForName(name?: string): ToolKind {
  const value = (name || '').toLowerCase()
  if (value.includes('current_time') || value.includes('time')) return 'time'
  if (value.includes('http') || value.includes('request') || value.includes('fetch')) return 'web'
  if (value.includes('task') || value.includes('todo')) return 'tasks'
  if (value.startsWith('storage_') || value.includes('file') || value.includes('cloud')) return 'storage'
  if (value.includes('knowledge') || value.includes('search')) return 'knowledge'
  return 'console'
}

function resolveToolTarget(name?: string): RoomToolTarget {
  const kind = toolKindForName(name)
  const direct = ROOM_TOOL_MAP[kind]
  if (direct) return direct
  return { standPoint: ROOM_LAYOUT.idlePoint, face: 'front_right', mode: 'use_console' }
}

type RuntimeAction =
  | { type: 'reset'; now: number }
  | { type: 'enqueue'; commands: AgentCommand[]; replace?: boolean }
  | { type: 'tick'; now: number; dt: number; completedTools: Set<string> }

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

function buildRuntimeCommandsFromTool(toolCall: AgentLoopToolCall): AgentCommand[] {
  const target = resolveToolTarget(toolCall.name)
  return [
    { type: 'walk', to: target.standPoint, face: target.face, speed: AGENT_MOVE_SPEED, toolCallId: toolCall.id },
    { type: 'pause', mode: 'idle', face: target.face, durationMs: TOOL_SETTLE_MS },
    {
      type: 'play',
      mode: target.mode,
      toolCallId: toolCall.id,
      requireResult: true,
      minMs: 700,
      maxMs: 9000,
    },
    { type: 'pause', mode: target.mode, face: target.face, durationMs: TOOL_FINISH_MS },
  ]
}

function buildSleepCommands() {
  return [
    { type: 'walk', to: ROOM_LAYOUT.sleepPoint, face: 'front_right', speed: AGENT_MOVE_SPEED } as AgentCommand,
    { type: 'sleep' } as AgentCommand,
  ]
}

function buildReturnIdleCommands(): AgentCommand[] {
  return [
    { type: 'walk', to: ROOM_LAYOUT.idlePoint, face: 'front_right', speed: AGENT_RETURN_SPEED },
    { type: 'pause', mode: 'idle', face: 'front_right', durationMs: 360 },
  ]
}

function buildAskUserCommands(): AgentCommand[] {
  return [
    { type: 'walk', to: ASK_USER_POINT, face: 'front_right', speed: AGENT_RETURN_SPEED },
    { type: 'play', mode: 'ask_user', minMs: 1600, maxMs: 3200 },
  ]
}

function buildErrorCommands(): AgentCommand[] {
  return [
    { type: 'play', mode: 'error', minMs: 1400, maxMs: 1800 },
    ...buildReturnIdleCommands(),
  ]
}

function buildPreviewToolCommands(toolName: string, id: string): AgentCommand[] {
  const target = resolveToolTarget(toolName)
  return [
    { type: 'walk', to: target.standPoint, face: target.face, speed: AGENT_MOVE_SPEED, toolCallId: id },
    { type: 'pause', mode: 'idle', face: target.face, durationMs: TOOL_SETTLE_MS },
    { type: 'play', mode: target.mode, toolCallId: id, minMs: 1700, maxMs: 2200, requireResult: false },
    { type: 'pause', mode: target.mode, face: target.face, durationMs: TOOL_FINISH_MS },
    ...buildReturnIdleCommands(),
  ]
}

function toolKindForAgentMode(mode: AgentMode): ToolKind | undefined {
  if (mode === 'use_clock') return 'time'
  if (mode === 'use_computer') return 'web'
  if (mode === 'use_whiteboard') return 'tasks'
  if (mode === 'use_storage') return 'storage'
  if (mode === 'use_knowledge') return 'knowledge'
  if (mode === 'use_console') return 'console'
  return undefined
}

function agentDisplayName(agent?: ChannelMemberInfo, fallback = 'Agent') {
  return agent?.display_name || agent?.agent_id || fallback
}

function staticAgentRuntime(index: number): AgentRuntimeState {
  const point = COMPANION_AGENT_POINTS[index % COMPANION_AGENT_POINTS.length] || COMPANION_AGENT_POINTS[0]
  return {
    ...DEFAULT_AGENT_RUNTIME,
    x: point.x,
    y: point.y,
    facing: point.facing,
    mode: index % 3 === 0 ? 'sleep' : 'idle',
    frame: index % 8,
    lastActionAt: 0,
    isSleeping: index % 3 === 0,
  }
}

function roomAgentViews(agents: ChannelMemberInfo[], activeRuntime: AgentRuntimeState, active: boolean): RoomAgentView[] {
  const members = agents.length > 0
    ? agents.slice(0, 4)
    : [{ id: 'placeholder-agent', agent_id: 'Agent', display_name: 'Agent' } as ChannelMemberInfo]

  return members.map((agent, index) => ({
    key: agent.id || agent.agent_id || `agent-${index}`,
    name: agentDisplayName(agent, index === 0 ? 'Agent' : `Agent ${index + 1}`),
    runtime: active && index === 0 ? activeRuntime : staticAgentRuntime(index),
    variant: index,
    active: active && index === 0,
  }))
}

function faceFromDelta(dx: number, dy: number): Facing {
  if (dx >= 0 && dy >= 0) return 'front_right'
  if (dx < 0 && dy >= 0) return 'front_left'
  if (dx >= 0 && dy < 0) return 'back_right'
  return 'back_left'
}

function agentRuntimeReducer(state: AgentRuntimeState, action: RuntimeAction): AgentRuntimeState {
  if (action.type === 'reset') {
    return {
      ...DEFAULT_AGENT_RUNTIME,
      x: ROOM_LAYOUT.idlePoint.x,
      y: ROOM_LAYOUT.idlePoint.y,
      lastActionAt: action.now,
    }
  }

  if (action.type === 'enqueue') {
    return {
      ...state,
      queue: action.replace ? action.commands.slice() : [...state.queue, ...action.commands],
      active: action.replace ? undefined : state.active,
      activeStartedAt: action.replace ? 0 : state.activeStartedAt,
      isSleeping: action.replace ? false : state.isSleeping,
      mode: action.replace ? state.mode : state.mode,
      frameAccumulator: action.replace ? 0 : state.frameAccumulator,
      frame: action.replace ? 0 : state.frame,
    }
  }

  if (action.type === 'tick') {
    const next: AgentRuntimeState = {
      ...state,
      queue: state.queue.slice(),
      frameAccumulator: state.frameAccumulator,
      frame: state.frame,
      x: clamp01(state.x),
      y: clamp01(state.y),
    }

    let activeCommand = next.active

    if (!activeCommand && next.queue.length > 0) {
      activeCommand = next.queue.shift()
      if (activeCommand) {
        next.active = activeCommand
        next.activeStartedAt = action.now
        next.frameAccumulator = 0
        next.frame = 0
        if (activeCommand.type === 'walk') {
          next.mode = 'walk'
          next.facing = activeCommand.face
          next.isSleeping = false
        } else if (activeCommand.type === 'sleep') {
          next.mode = 'sleep'
          next.isSleeping = true
        } else if (activeCommand.type === 'pause') {
          next.mode = activeCommand.mode
          if (activeCommand.face) next.facing = activeCommand.face
          next.isSleeping = false
        } else {
          next.mode = activeCommand.mode
        }
      }
    }

    if (activeCommand) {
      if (activeCommand.type === 'walk') {
        const dx = activeCommand.to.x - next.x
        const dy = activeCommand.to.y - next.y
        const distance = Math.hypot(dx, dy)
        const step = action.dt * activeCommand.speed
        if (distance <= 1 || step >= distance) {
          next.x = activeCommand.to.x
          next.y = activeCommand.to.y
          next.facing = activeCommand.face
          next.active = undefined
          next.activeStartedAt = 0
          next.lastActionAt = action.now
          next.mode = next.isSleeping ? 'sleep' : 'idle'
        } else {
          const ratio = step / distance
          next.x = Math.round(next.x + dx * ratio)
          next.y = Math.round(next.y + dy * ratio)
          next.facing = faceFromDelta(dx, dy)
        }
      } else if (activeCommand.type === 'play') {
        const elapsed = action.now - next.activeStartedAt
        const reachedMin = elapsed >= (activeCommand.minMs ?? 1200)
        const reachedMax = elapsed >= (activeCommand.maxMs ?? 9000)
        const toolDone = !activeCommand.requireResult || !activeCommand.toolCallId || action.completedTools.has(activeCommand.toolCallId)
        if (reachedMax || (reachedMin && toolDone)) {
          next.active = undefined
          next.activeStartedAt = 0
          next.lastActionAt = action.now
          next.mode = next.isSleeping ? 'sleep' : 'idle'
        }
      } else if (activeCommand.type === 'pause') {
        if (action.now - next.activeStartedAt >= activeCommand.durationMs) {
          next.active = undefined
          next.activeStartedAt = 0
          next.lastActionAt = action.now
          next.mode = next.isSleeping ? 'sleep' : 'idle'
        }
      } else {
        next.mode = 'sleep'
        next.isSleeping = true
      }
    } else {
      next.mode = next.isSleeping ? 'sleep' : 'idle'
    }

    const animation = ANIMATION_MAP[next.mode] || ANIMATION_MAP.idle
    next.frameAccumulator = next.frameAccumulator + action.dt * animation.fps
    next.frame = Math.floor(next.frameAccumulator % animation.frames)

    return next
  }

  return state
}

function appScope() {
  return typeof window === 'undefined' ? 'app' : window.location.host || 'app'
}

function lastChannelStorageKey(userId: string) {
  return `${LAST_CHANNEL_STORAGE_PREFIX}:${appScope()}:${encodeURIComponent(userId)}`
}

function readLastChannelId(userId: string): string | null {
  try {
    return window.localStorage.getItem(lastChannelStorageKey(userId)) || null
  } catch {
    return null
  }
}

function writeLastChannelId(userId: string, channelId: string) {
  try {
    window.localStorage.setItem(lastChannelStorageKey(userId), channelId)
  } catch {
    // Session state still works without local storage.
  }
}

function consumeLaunchTokenFromUrl() {
  if (typeof window === 'undefined') return

  const tokenKeys = ['beeseed_launch_token', 'beeseed_token', 'token', 'auth_token', 'access_token']
  const url = new URL(window.location.href)
  let token: string | null = null

  for (const key of tokenKeys) {
    token = url.searchParams.get(key)
    if (token) break
  }
  if (!token) return

  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    return
  }

  for (const key of tokenKeys) {
    url.searchParams.delete(key)
  }
  window.history.replaceState(null, document.title, url.toString())
}

consumeLaunchTokenFromUrl()

async function fetchRuntimeConfig(path: string): Promise<AppRuntimeConfig | null> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    if (!response.ok) return null
    const data = (await response.json()) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null
    return data as AppRuntimeConfig
  } catch {
    return null
  }
}

async function loadRuntimeConfig(): Promise<AppRuntimeConfig> {
  return (
    await fetchRuntimeConfig('/api/app-config')
    ?? await fetchRuntimeConfig('/config.json')
    ?? DEFAULT_RUNTIME_CONFIG
  )
}

interface RuntimeErrorBoundaryState {
  error: Error | null
}

class RuntimeErrorBoundary extends Component<{ children: ReactNode }, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RuntimeErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GameRoom] runtime render failed', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="game-auth-surface">
        <div className="game-error-panel">
          <p className="game-error-title">页面加载失败</p>
          <p className="game-error-copy">游戏化房间界面渲染时遇到异常。错误已写入控制台，可点击重试。</p>
          <button type="button" className="game-primary-button" onClick={() => this.setState({ error: null })}>
            重试
          </button>
        </div>
      </div>
    )
  }
}

function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login')

  return (
    <div className="game-auth-surface">
      <div className="game-auth-shell">
        <div className="game-auth-copy">
          <span className="game-auth-dot" aria-hidden />
          <p>Game Room</p>
        </div>
        {mode === 'login' ? (
          <LoginForm onSwitchToRegister={() => setMode('register')} />
        ) : (
          <RegisterForm onSwitchToLogin={() => setMode('login')} />
        )}
      </div>
    </div>
  )
}

function latestTool(loop?: AgentLoopState): AgentLoopToolCall | undefined {
  if (!loop) return undefined
  for (let turnIndex = loop.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = loop.turns[turnIndex]
    if (!turn) continue
    for (let toolIndex = turn.toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const tool = turn.toolCalls[toolIndex]
      if (tool) return tool
    }
  }
  return undefined
}

function latestActiveLoop(loops: AgentLoopState[]): AgentLoopState | undefined {
  return [...loops].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0]
}

function deriveMood(loop: AgentLoopState | undefined, activeTool: AgentLoopToolCall | undefined, typing: string): AgentMood {
  if (!loop && !typing) return 'idle'
  if (loop?.status === 'waiting_for_user' || loop?.status === 'waiting_expired') return 'waiting'
  if (loop?.status === 'error' || loop?.status === 'stopped' || loop?.status === 'interrupted') return 'error'
  if (activeTool && activeTool.status !== 'failed' && activeTool.status !== 'success') return 'tool'
  if (loop?.status === 'running' || typing) return 'running'
  return 'idle'
}

function roomStatusLabel(mood: AgentMood, activeTool?: AgentLoopToolCall) {
  if (mood === 'tool') return activeTool?.name ? `正在使用 ${activeTool.name}` : '正在使用工具'
  if (mood === 'running') return '正在处理'
  if (mood === 'waiting') return '等待用户'
  if (mood === 'error') return '需要查看'
  return '空闲'
}

function latestChannelTime(channel: ChannelWithMeta): number {
  const value = channel.last_msg_at || channel.updated_at || channel.created_at
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(time) ? time : 0
}

function latestChannelId(channels: ChannelWithMeta[]): string | null {
  let selected: ChannelWithMeta | null = null
  let selectedTime = -1
  for (const channel of channels) {
    const time = latestChannelTime(channel)
    if (!selected || time > selectedTime) {
      selected = channel
      selectedTime = time
    }
  }
  return selected?.id ?? null
}

function agentMembers(members: ChannelMemberInfo[]) {
  return members.filter((member) => member.member_type === 'agent')
}

function ChannelBootstrap() {
  const { user } = useAuth()
  const { channels, currentChannelId, loading, fetchChannels, joinChannel } = useChannels()
  const channelIds = useMemo(() => new Set(channels.map((channel) => channel.id)), [channels])

  useEffect(() => {
    if (!user?.id) return
    void fetchChannels()
  }, [fetchChannels, user?.id])

  useEffect(() => {
    if (!user?.id || loading || channels.length === 0) return
    if (currentChannelId && channelIds.has(currentChannelId)) {
      writeLastChannelId(user.id, currentChannelId)
      return
    }

    const savedChannelId = readLastChannelId(user.id)
    const fallbackChannelId = savedChannelId && channelIds.has(savedChannelId)
      ? savedChannelId
      : latestChannelId(channels)

    if (fallbackChannelId) joinChannel(fallbackChannelId)
  }, [currentChannelId, channelIds, channels, loading, joinChannel, user?.id])

  return null
}

function ToolObject({ scene, active, style }: { scene: ToolScene; active?: boolean; style?: CSSProperties }) {
  const Icon = scene.icon
  return (
    <span
      className={`tool-object tool-${scene.kind} ${active ? 'is-active' : ''}`}
      style={style}
      title={`${scene.label}：${scene.detail}`}
    >
      <span className="tool-shadow" aria-hidden />
      <span className="tool-body" aria-hidden>
        <span className="tool-surface" />
        <Icon className="tool-icon" size={17} aria-hidden />
      </span>
    </span>
  )
}

function RoomSetDressing() {
  return (
    <div className="room-set-dressing" aria-hidden>
      <span className="room-wall-panel room-wall-panel-left" />
      <span className="room-wall-panel room-wall-panel-right" />
      <span className="room-wall-shelf">
        <span />
        <span />
        <span />
      </span>
      <span className="room-pinboard">
        <span />
        <span />
        <span />
      </span>
      <span className="room-desk-surface" />
      <span className="room-desk-leg room-desk-leg-left" />
      <span className="room-desk-leg room-desk-leg-right" />
      <span className="room-rug" />
      <span className="room-floor-lamp" />
      <span className="room-plant" />
      <span className="room-side-cabinet" />
      <span className="room-book-stack room-book-stack-left" />
      <span className="room-book-stack room-book-stack-right" />
    </div>
  )
}

function spriteActionForMode(mode: AgentMode): SpriteAction {
  if (mode === 'walk') return 'walk'
  if (mode === 'sleep') return 'sleep'
  if (mode === 'ask_user' || mode.startsWith('use_')) return 'use'
  return 'idle'
}

function spriteDirectionForFacing(facing: Facing): SpriteDirection {
  if (facing === 'back_right') return 'NE'
  if (facing === 'back_left') return 'NW'
  if (facing === 'front_left') return 'SW'
  return 'SE'
}

async function loadAssistantSpriteSheets(): Promise<AssistantSpriteSheets> {
  const actions: SpriteAction[] = ['idle', 'walk', 'use', 'sleep']
  const entries = await Promise.all(actions.map(async (action) => {
    const metaFile = action === 'walk' ? 'walk-8dir-approved-packed.json' : `${action}-8dir-4f-packed.json`
    const metaUrl = `${ASSISTANT_SPRITE_BASE}/${metaFile}`
    const meta = await fetch(metaUrl).then((response) => {
      if (!response.ok) throw new Error(`Failed to load ${metaUrl}`)
      return response.json() as Promise<SpriteSheetMeta>
    })
    const texture = await PixiAssets.load<PixiTexture>(`${ASSISTANT_SPRITE_BASE}/${meta.image}`)
    return [action, { meta, texture }] as const
  }))
  return Object.fromEntries(entries) as AssistantSpriteSheets
}

function frameMetaFor(sheet: LoadedSpriteSheet, direction: SpriteDirection, runtimeFrame: number) {
  const frameCount = sheet.meta.framesPerDirectionByDirection?.[direction] ?? sheet.meta.framesPerDirection
  const frame = Math.abs(runtimeFrame) % frameCount
  return sheet.meta.frames.find((item) => item.direction === direction && item.frame === frame)
    ?? sheet.meta.frames.find((item) => item.direction === direction)
    ?? sheet.meta.frames[0]
}

function PixiAgentLayer({ agents }: { agents: RoomAgentView[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const appRef = useRef<PixiApplication | null>(null)
  const sheetsRef = useRef<AssistantSpriteSheets | null>(null)
  const layerRef = useRef<PixiContainer | null>(null)
  const [, refresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    let initialized = false
    const app = new PixiApplication()
    appRef.current = app

    async function setup() {
      await app.init({
        width: ROOM_LAYOUT.width,
        height: ROOM_LAYOUT.height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      initialized = true
      if (cancelled) {
        app.destroy(true)
        return
      }

      app.canvas.className = 'pixi-agent-canvas'
      hostRef.current?.appendChild(app.canvas)
      const layer = new PixiContainer()
      layer.sortableChildren = true
      app.stage.addChild(layer)
      layerRef.current = layer
      sheetsRef.current = await loadAssistantSpriteSheets()
      if (!cancelled) refresh((value) => value + 1)
    }

    void setup()

    return () => {
      cancelled = true
      if (initialized) app.destroy(true)
      appRef.current = null
      sheetsRef.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const layer = layerRef.current
    const sheets = sheetsRef.current
    if (!layer || !sheets) return

    for (const child of layer.removeChildren()) {
      child.destroy()
    }
    for (const agent of agents) {
      const action = spriteActionForMode(agent.runtime.mode)
      const direction = spriteDirectionForFacing(agent.runtime.facing)
      const sheet = sheets[action]
      const frame = frameMetaFor(sheet, direction, agent.runtime.frame)
      if (!frame) continue

      const texture = new PixiTexture({
        source: sheet.texture.source,
        frame: new PixiRectangle(frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h),
      })
      const sprite = new PixiSprite(texture)
      const scale = agent.active ? 0.72 : 0.58
      sprite.anchor.set(frame.anchor.x / frame.rect.w, frame.anchor.y / frame.rect.h)
      sprite.scale.set(scale)
      sprite.x = agent.runtime.x
      sprite.y = agent.runtime.y + 10
      sprite.zIndex = agent.runtime.isSleeping ? 1 : Math.max(2, agent.runtime.y)
      sprite.alpha = agent.active ? 1 : 0.82
      layer.addChild(sprite)
    }
  }, [agents])

  return <div ref={hostRef} className="pixi-agent-layer" aria-hidden />
}

function AgentSprite({
  runtime,
  name,
  variant,
  active,
}: {
  runtime: AgentRuntimeState
  name: string
  variant: number
  active?: boolean
}) {
  const spriteStyle = {
    left: `${runtime.x}px`,
    top: `${runtime.y}px`,
    zIndex: runtime.isSleeping ? 1 : Math.max(2, runtime.y),
    '--agent-frame': `${runtime.frame}`,
    '--agent-accent': AGENT_ACCENTS[variant % AGENT_ACCENTS.length],
  } as CSSProperties & { '--agent-frame'?: string; '--agent-accent'?: string }

  return (
    <span
      className={`agent-sprite agent-variant-${variant % AGENT_ACCENTS.length} mode-${runtime.mode} face-${runtime.facing} ${active ? 'is-active-agent' : 'is-companion-agent'}`}
      style={spriteStyle}
    >
      <span className="agent-shadow" aria-hidden />
      <span className="agent-sheet" aria-hidden>
        <span className="agent-core">
          <span className="agent-pack" />
          <span className="agent-arm agent-arm-left" />
          <span className="agent-arm agent-arm-right" />
        </span>
      </span>
      <span className="agent-label" title={name}>{name}</span>
    </span>
  )
}

function RoomIsland({
  channel,
  index,
  activeIndex,
  isActive,
  mood,
  activeToolKind,
  activeTool,
  agents,
  runtime,
  onSelect,
}: {
  channel: ChannelWithMeta
  index: number
  activeIndex: number
  isActive: boolean
  mood: AgentMood
  activeToolKind?: ToolKind
  activeTool?: AgentLoopToolCall
  agents: ChannelMemberInfo[]
  runtime?: AgentRuntimeState
  onSelect: () => void
}) {
  const offset = index - activeIndex
  const transform = `translateX(${offset * 31}rem) scale(${isActive ? 1 : 0.74})`
  const status = roomStatusLabel(mood, activeTool)
  const activeRuntime = runtime ?? {
    x: ROOM_LAYOUT.idlePoint.x,
    y: ROOM_LAYOUT.idlePoint.y,
    facing: 'front_right',
    mode: 'idle',
    frame: 0,
    frameAccumulator: 0,
    queue: [],
    active: undefined,
    activeStartedAt: 0,
    lastActionAt: 0,
    isSleeping: false,
  } as AgentRuntimeState
  const visibleAgents = roomAgentViews(agents, activeRuntime, isActive)

  return (
    <button
      type="button"
      className={`room-island mood-${mood} ${isActive ? 'is-active' : 'is-visible'}`}
      style={{ transform, '--room-offset': offset } as CSSProperties & { '--room-offset': number }}
      onClick={onSelect}
      aria-label={`进入频道 ${channel.name}`}
    >
      <div className="room-shadow" aria-hidden />
      <div className="room-body">
        <div className="room-back-wall">
          <div className={`room-status-pill mood-${mood}`}>{status}</div>
          <div className="room-window" />
          <RoomSetDressing />
        </div>
        <div className="room-floor">
          <RoomSetDressing />
          {ROOM_LAYOUT.props.map((prop) => {
            return (
              <ToolObject
                key={prop.id}
                scene={TOOL_SCENES[prop.toolKind]}
                active={activeToolKind === prop.toolKind}
                style={{ left: `${prop.position.x}px`, top: `${prop.position.y}px`, zIndex: prop.z }}
              />
            )
          })}
          <PixiAgentLayer agents={visibleAgents} />
          {visibleAgents.map((agent) => (
            <span
              key={agent.key}
              className={`agent-label-proxy ${agent.active ? 'is-active-agent' : 'is-companion-agent'}`}
              style={{
                left: `${agent.runtime.x}px`,
                top: `${agent.runtime.y + 28}px`,
                zIndex: agent.runtime.isSleeping ? 3 : Math.max(4, agent.runtime.y + 1),
              }}
              title={agent.name}
            >
              {agent.name}
            </span>
          ))}
        </div>
      </div>
      <div className="room-label">
        <span className="room-beacon" aria-hidden />
        <span>{channel.name}</span>
        {channel.unread_count > 0 ? <strong>{channel.unread_count}</strong> : null}
      </div>
    </button>
  )
}

function WorldStatus({
  channel,
  mood,
  activeTool,
  activeToolKind,
  agents,
}: {
  channel?: ChannelWithMeta
  mood: AgentMood
  activeTool?: AgentLoopToolCall
  activeToolKind: ToolKind
  agents: ChannelMemberInfo[]
}) {
  const scene = TOOL_SCENES[activeToolKind]
  const Icon = mood === 'error' ? AlertTriangle : scene.icon
  const agentCount = agents.length || (channel ? 1 : 0)

  return (
    <footer className="world-status">
      <div className="world-status-main">
        <Icon size={18} aria-hidden />
        <div>
          <p>{roomStatusLabel(mood, activeTool)}</p>
          <span>{channel ? `${agentCount} 个 Agent · ${activeTool?.name || scene.detail}` : '频道会显示为漂浮的小房间'}</span>
        </div>
      </div>
      <div className="world-status-tools" aria-label="工具物件">
        {Object.values(TOOL_SCENES).map((item) => {
          const ItemIcon = item.icon
          return (
            <span key={item.kind} className={item.kind === activeToolKind && mood === 'tool' ? 'is-active' : ''} title={item.detail}>
              <ItemIcon size={15} aria-hidden />
              {item.label}
            </span>
          )
        })}
      </div>
    </footer>
  )
}

function defaultChatOpen() {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(min-width: 981px)').matches
}

function GameRoomRuntime() {
  const { branding } = useAppConfig()
  const { channels, currentChannelId, joinChannel, loading } = useChannels()
  const { state: connectionState } = useConnection()
  const connected = connectionState === 'connected'
  const activeChannel = channels.find((channel) => channel.id === currentChannelId) ?? channels[0]
  const activeChannelId = activeChannel?.id ?? null
  const chat = useChat(activeChannelId)
  const activeLoop = latestActiveLoop(chat.agentLoops)
  const activeTool = latestTool(activeLoop)
  const activeToolKind = toolKindForName(activeTool?.name)
  const mood = deriveMood(activeLoop, activeTool, chat.typing)
  const activeAgents = agentMembers(chat.members)
  const [chatOpen, setChatOpen] = useState(defaultChatOpen)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [agentRuntime, dispatchRuntime] = useReducer(agentRuntimeReducer, {
    ...DEFAULT_AGENT_RUNTIME,
    x: ROOM_LAYOUT.idlePoint.x,
    y: ROOM_LAYOUT.idlePoint.y,
    lastActionAt: Date.now(),
  })

  const completedToolIdsRef = useRef<Set<string>>(new Set())
  const startedToolIdsRef = useRef<Set<string>>(new Set())
  const waitingRef = useRef(false)
  const errorToolRef = useRef<string | null>(null)
  const terminalLoopRef = useRef<string | null>(null)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)

  const activeIndex = Math.max(0, channels.findIndex((channel) => channel.id === activeChannelId))
  const canGoPrev = channels.length > 0 && activeIndex > 0
  const canGoNext = channels.length > 0 && activeIndex < channels.length - 1
  const runtimeToolKind = toolKindForAgentMode(agentRuntime.mode)
  const highlightedToolKind = runtimeToolKind ?? (mood === 'tool' ? activeToolKind : undefined)

  useEffect(() => {
    const now = Date.now()
    if (!activeChannelId) return
    dispatchRuntime({ type: 'reset', now })
    startedToolIdsRef.current.clear()
    waitingRef.current = false
    errorToolRef.current = null
    terminalLoopRef.current = null
    completedToolIdsRef.current.clear()
  }, [activeChannelId])

  useEffect(() => {
    let lastFrame = performance.now()
    const update = (now: number) => {
      const dt = Math.min(0.2, Math.max(0.006, (now - lastFrame) / 1000))
      dispatchRuntime({
        type: 'tick',
        now,
        dt,
        completedTools: new Set(completedToolIdsRef.current),
      })
      lastFrame = now
      requestRef.current = requestAnimationFrame(update)
    }
    const requestRef = { current: requestAnimationFrame(update) } as { current: number }
    return () => {
      cancelAnimationFrame(requestRef.current)
    }
  }, [dispatchRuntime])

  useEffect(() => {
    if (!activeTool) return
    if (activeTool.status === 'calling' && !startedToolIdsRef.current.has(activeTool.id)) {
      const commands = buildRuntimeCommandsFromTool(activeTool)
      dispatchRuntime({ type: 'enqueue', commands, replace: true })
      startedToolIdsRef.current.add(activeTool.id)
      waitingRef.current = false
      errorToolRef.current = null
    }

    if (activeTool.status === 'failed' || activeTool.status === 'success') {
      completedToolIdsRef.current.add(activeTool.id)
      if (activeTool.status === 'failed' && errorToolRef.current !== activeTool.id) {
        dispatchRuntime({
          type: 'enqueue',
          commands: buildErrorCommands(),
          replace: false,
        })
        errorToolRef.current = activeTool.id
      }
    }
  }, [activeTool?.id, activeTool?.status, activeTool?.name])

  useEffect(() => {
    const waiting = activeLoop?.status === 'waiting_for_user' || activeLoop?.status === 'waiting_expired'
    if (waiting && !waitingRef.current && activeTool?.status !== 'calling') {
      dispatchRuntime({
        type: 'enqueue',
        commands: buildAskUserCommands(),
        replace: true,
      })
      waitingRef.current = true
    }
    if (!waiting) waitingRef.current = false
  }, [activeLoop?.status, activeTool?.status])

  useEffect(() => {
    if (!activeLoop) return
    if (activeLoop.status === 'running' || activeLoop.status === 'waiting_for_user') {
      terminalLoopRef.current = null
      return
    }

    const loopKey = `${activeLoop.runId || activeLoop.agentId}:${activeLoop.startedAt}:${activeLoop.completedAt || activeLoop.status}`
    if (terminalLoopRef.current === loopKey) return
    terminalLoopRef.current = loopKey

    const failed = activeLoop.status === 'error'
      || activeLoop.status === 'interrupted'
      || activeLoop.status === 'stopped'
      || activeLoop.status === 'max_turns_reached'
    dispatchRuntime({
      type: 'enqueue',
      commands: failed ? buildErrorCommands() : buildReturnIdleCommands(),
      replace: false,
    })
  }, [activeLoop?.agentId, activeLoop?.completedAt, activeLoop?.runId, activeLoop?.startedAt, activeLoop?.status])

  useEffect(() => {
    if (agentRuntime.mode !== 'idle' || agentRuntime.active || agentRuntime.queue.length > 0) return
    const timer = window.setTimeout(() => {
      dispatchRuntime({ type: 'enqueue', commands: buildSleepCommands(), replace: true })
    }, IDLE_TO_SLEEP_DELAY)
    return () => clearTimeout(timer)
  }, [agentRuntime.mode, agentRuntime.active, agentRuntime.queue.length, activeTool?.status, activeLoop?.status, activeLoop?.agentId])

  function switchBy(delta: number) {
    if (channels.length === 0) return
    const next = channels[Math.min(channels.length - 1, Math.max(0, activeIndex + delta))]
    if (next) joinChannel(next.id)
  }

  function handleRoomKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      switchBy(-1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      switchBy(1)
    }
  }

  function handleRoomTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }

  function handleRoomTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = touchStartRef.current
    touchStartRef.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch) return

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    if (elapsed > 700 || Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.3) return
    switchBy(dx > 0 ? -1 : 1)
  }

  return (
    <main className={`game-shell ${chatOpen ? 'is-chat-open' : ''}`}>
      <section className="game-world" aria-label="游戏化频道房间">
        <div className="star-field" aria-hidden />

        <header className="game-topbar">
          <div className="game-brand">
            <div className="game-mark">
              <Sparkles aria-hidden size={18} />
            </div>
            <div>
              <p className="game-kicker">BeeSeed Game Room</p>
              <h1>{branding.title || 'Agent 房间'}</h1>
            </div>
          </div>
          <div className="game-actions">
            <span className={`game-connection ${connected ? 'is-connected' : ''}`}>
              <Radio size={14} aria-hidden />
              {connected ? '已连接' : '未连接'}
            </span>
            <button type="button" className="game-icon-button" onClick={() => setCreateDialogOpen(true)} aria-label="新建频道">
              <Plus size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="game-icon-button"
              onClick={() => setChatOpen((value) => !value)}
              aria-label={chatOpen ? '收起聊天' : '打开聊天'}
            >
              {chatOpen ? <X size={18} aria-hidden /> : <PanelRightOpen size={18} aria-hidden />}
            </button>
          </div>
        </header>

        <div
          className="room-switcher"
          tabIndex={0}
          aria-label="切换频道房间"
          onKeyDown={handleRoomKeyDown}
          onTouchStart={handleRoomTouchStart}
          onTouchEnd={handleRoomTouchEnd}
        >
          <button type="button" className="game-nav-button" onClick={() => switchBy(-1)} disabled={!canGoPrev} aria-label="上一个房间">
            <ChevronLeft size={22} aria-hidden />
          </button>
          <div className="room-rail">
            {loading && channels.length === 0 ? (
              <div className="room-loading">正在同步房间...</div>
            ) : channels.length === 0 ? (
              <EmptyWorld onCreate={() => setCreateDialogOpen(true)} />
            ) : (
              channels.map((channel, index) => (
                <RoomIsland
                  key={channel.id}
                  channel={channel}
                  index={index}
                  activeIndex={activeIndex}
                  isActive={channel.id === activeChannelId}
                  mood={channel.id === activeChannelId ? mood : channel.unread_count > 0 ? 'running' : 'idle'}
                  activeToolKind={channel.id === activeChannelId ? highlightedToolKind : undefined}
                  activeTool={channel.id === activeChannelId ? activeTool : undefined}
                  agents={channel.id === activeChannelId ? activeAgents : []}
                  runtime={channel.id === activeChannelId ? agentRuntime : undefined}
                  onSelect={() => joinChannel(channel.id)}
                />
              ))
            )}
          </div>
          <button type="button" className="game-nav-button" onClick={() => switchBy(1)} disabled={!canGoNext} aria-label="下一个房间">
            <ChevronRight size={22} aria-hidden />
          </button>
        </div>

        <WorldStatus
          channel={activeChannel}
          mood={mood}
          activeTool={activeTool}
          activeToolKind={activeToolKind}
          agents={activeAgents}
        />
      </section>

      <aside className="chat-dock" aria-label="频道聊天">
        <div className="chat-dock-header">
          <div>
            <p className="game-kicker">当前频道</p>
            <h2>{activeChannel?.name || '未选择频道'}</h2>
          </div>
          <button type="button" className="game-icon-button" onClick={() => setChatOpen(false)} aria-label="收起聊天">
            <X size={18} aria-hidden />
          </button>
        </div>
        {activeChannelId ? (
          <ChatChannel channelId={activeChannelId} className="game-chat-channel" />
        ) : (
          <div className="chat-empty">创建或选择一个频道后开始对话。</div>
        )}
      </aside>

      <CreateChannelDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />
    </main>
  )
}

function EmptyWorld({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-world">
      <div className="empty-room-plate" aria-hidden />
      <h2>还没有频道房间</h2>
      <p>先创建一个频道，Agent 会在房间里待命。</p>
      <Button type="button" onClick={onCreate}>新建频道</Button>
    </div>
  )
}

const MOCK_CHANNELS: ChannelWithMeta[] = [
  {
    id: 'preview-research',
    name: '研究室',
    created_by: 'preview',
    settings: '{}',
    created_at: new Date(Date.now() - 5400000).toISOString(),
    updated_at: new Date(Date.now() - 120000).toISOString(),
    member_count: 2,
    unread_count: 0,
    last_message: '正在整理资料',
    last_msg_at: new Date(Date.now() - 120000).toISOString(),
  },
  {
    id: 'preview-build',
    name: '执行间',
    created_by: 'preview',
    settings: '{}',
    created_at: new Date(Date.now() - 3600000).toISOString(),
    updated_at: new Date(Date.now() - 45000).toISOString(),
    member_count: 3,
    unread_count: 2,
    last_message: 'Agent 正在调用工具',
    last_msg_at: new Date(Date.now() - 45000).toISOString(),
  },
  {
    id: 'preview-review',
    name: '验收舱',
    created_by: 'preview',
    settings: '{}',
    created_at: new Date(Date.now() - 2400000).toISOString(),
    updated_at: new Date(Date.now() - 900000).toISOString(),
    member_count: 1,
    unread_count: 0,
    last_message: '等待回答',
    last_msg_at: new Date(Date.now() - 900000).toISOString(),
  },
]

const MOCK_AGENT: ChannelMemberInfo = {
  id: 'preview-agent-member',
  channel_id: 'preview-build',
  member_type: 'agent',
  agent_id: 'assistant',
  display_name: 'Mira',
  role: 'member',
  is_coordinator: false,
  joined_at: new Date().toISOString(),
}

const MOCK_ROOM_AGENTS: ChannelMemberInfo[] = [
  MOCK_AGENT,
  {
    ...MOCK_AGENT,
    id: 'preview-agent-analyst',
    agent_id: 'analyst',
    display_name: 'Nova',
    is_coordinator: false,
  },
  {
    ...MOCK_AGENT,
    id: 'preview-agent-writer',
    agent_id: 'writer',
    display_name: 'Kira',
    is_coordinator: false,
  },
]

function PreviewGameRoom() {
  const [activeIndex, setActiveIndex] = useState(1)
  const [chatOpen, setChatOpen] = useState(defaultChatOpen)
  const [previewToolKind, setPreviewToolKind] = useState<ToolKind>('web')
  const [previewRuntime, dispatchPreviewRuntime] = useReducer(agentRuntimeReducer, {
    ...DEFAULT_AGENT_RUNTIME,
    x: ROOM_LAYOUT.idlePoint.x,
    y: ROOM_LAYOUT.idlePoint.y,
    lastActionAt: Date.now(),
  })
  const activeChannel = MOCK_CHANNELS[activeIndex]
  const previewToolIndexRef = useRef(0)
  const previewTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const previewToolNames = useMemo(
    () => ['http_request', 'current_time', 'todo_list', 'knowledge_search', 'storage_list'] as const,
    [],
  )

  function switchPreviewBy(delta: number) {
    setActiveIndex((value) => Math.min(MOCK_CHANNELS.length - 1, Math.max(0, value + delta)))
  }

  function handlePreviewRoomKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      switchPreviewBy(-1)
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      switchPreviewBy(1)
    }
  }

  function handlePreviewRoomTouchStart(event: TouchEvent<HTMLDivElement>) {
    const touch = event.touches[0]
    if (!touch) return
    previewTouchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
  }

  function handlePreviewRoomTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const start = previewTouchStartRef.current
    previewTouchStartRef.current = null
    const touch = event.changedTouches[0]
    if (!start || !touch) return

    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    if (elapsed > 700 || Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.3) return
    switchPreviewBy(dx > 0 ? -1 : 1)
  }

  useEffect(() => {
    let lastFrame = performance.now()
    const update = (now: number) => {
      const dt = Math.min(0.2, Math.max(0.006, (now - lastFrame) / 1000))
      dispatchPreviewRuntime({
        type: 'tick',
        now,
        dt,
        completedTools: new Set(),
      })
      lastFrame = now
      requestRef.current = requestAnimationFrame(update)
    }
    const requestRef = { current: requestAnimationFrame(update) } as { current: number }
    return () => cancelAnimationFrame(requestRef.current)
  }, [])

  useEffect(() => {
    dispatchPreviewRuntime({ type: 'reset', now: Date.now() })
    previewToolIndexRef.current = 0
  }, [activeIndex])

  useEffect(() => {
    const playNext = () => {
      const name = previewToolNames[previewToolIndexRef.current % previewToolNames.length]
      previewToolIndexRef.current += 1
      setPreviewToolKind(toolKindForName(name))
      dispatchPreviewRuntime({
        type: 'enqueue',
        commands: buildPreviewToolCommands(name, `preview-${name}-${Date.now()}`),
        replace: true,
      })
    }

    playNext()
    const timer = window.setInterval(playNext, 6400)
    return () => clearInterval(timer)
  }, [previewToolNames])

  return (
    <main className={`game-shell ${chatOpen ? 'is-chat-open' : ''}`}>
      <section className="game-world" aria-label="游戏化频道房间预览">
        <div className="star-field" aria-hidden />
        <header className="game-topbar">
          <div className="game-brand">
            <div className="game-mark">
              <Sparkles aria-hidden size={18} />
            </div>
            <div>
              <p className="game-kicker">Preview</p>
              <h1>游戏化房间模板</h1>
            </div>
          </div>
          <div className="game-actions">
            <span className="game-connection is-connected">
              <Radio size={14} aria-hidden />
              预览模式
            </span>
            <button type="button" className="game-icon-button" onClick={() => setChatOpen((value) => !value)} aria-label={chatOpen ? '收起聊天' : '打开聊天'}>
              {chatOpen ? <X size={18} aria-hidden /> : <PanelRightOpen size={18} aria-hidden />}
            </button>
          </div>
        </header>
        <div
          className="room-switcher"
          tabIndex={0}
          aria-label="切换频道房间"
          onKeyDown={handlePreviewRoomKeyDown}
          onTouchStart={handlePreviewRoomTouchStart}
          onTouchEnd={handlePreviewRoomTouchEnd}
        >
          <button type="button" className="game-nav-button" onClick={() => switchPreviewBy(-1)} disabled={activeIndex === 0} aria-label="上一个房间">
            <ChevronLeft size={22} aria-hidden />
          </button>
          <div className="room-rail">
            {MOCK_CHANNELS.map((channel, index) => (
              <RoomIsland
                key={channel.id}
                channel={channel}
                index={index}
                activeIndex={activeIndex}
                isActive={index === activeIndex}
                mood={index === activeIndex ? 'tool' : channel.unread_count > 0 ? 'running' : 'idle'}
                activeToolKind={index === activeIndex ? toolKindForAgentMode(previewRuntime.mode) ?? previewToolKind : undefined}
                activeTool={index === activeIndex ? {
                  id: 'preview-tool',
                  name: TOOL_SCENES[previewToolKind].detail,
                  status: 'calling',
                  args: { url: 'https://example.com/api' },
                  startedAt: Date.now() - 16000,
                } as AgentLoopToolCall : undefined}
                agents={index === activeIndex ? MOCK_ROOM_AGENTS : []}
                runtime={index === activeIndex ? previewRuntime : undefined}
                onSelect={() => setActiveIndex(index)}
              />
            ))}
          </div>
          <button type="button" className="game-nav-button" onClick={() => switchPreviewBy(1)} disabled={activeIndex === MOCK_CHANNELS.length - 1} aria-label="下一个房间">
            <ChevronRight size={22} aria-hidden />
          </button>
        </div>
        <WorldStatus
          channel={activeChannel}
          mood="tool"
          activeTool={{
            id: 'preview-tool',
            name: TOOL_SCENES[previewToolKind].detail,
            status: 'calling',
            args: { url: 'https://example.com/api' },
            startedAt: Date.now() - 16000,
          }}
          activeToolKind={previewToolKind}
          agents={MOCK_ROOM_AGENTS}
        />
      </section>
      <aside className="chat-dock" aria-label="频道聊天预览">
        <div className="chat-dock-header">
          <div>
            <p className="game-kicker">当前频道</p>
            <h2>{activeChannel?.name}</h2>
          </div>
          <button type="button" className="game-icon-button" onClick={() => setChatOpen(false)} aria-label="收起聊天">
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="preview-chat">
          <p className="preview-chat-agent">Mira 正在调用 `{TOOL_SCENES[previewToolKind].detail}`。</p>
          <p className="preview-chat-user">请查一下这个接口返回了什么。</p>
          <p className="preview-chat-agent">我已经开始请求，完成后会把结果整理在这里。</p>
        </div>
      </aside>
    </main>
  )
}

const REVIEW_SPRITE_ASSETS: ReviewSpriteAsset[] = [
  {
    id: 'review-walk-approved',
    title: 'Walk approved cycle',
    description: '按已确认首尾帧从原视频解码生成。',
    baseUrl: ASSISTANT_REVIEW_BASE,
    metaFile: 'walk-8dir-approved-256-packed.json',
    scale: 0.52,
  },
  {
    id: 'review-walk-13f-adaptive-loop',
    title: 'Walk 13f adaptive loop',
    description: '每个方向单独识别循环段，再固定取景框采样。',
    baseUrl: ASSISTANT_REVIEW_BASE,
    metaFile: 'walk-8dir-13f-adaptive-loop-256-packed.json',
    scale: 0.52,
  },
  {
    id: 'runtime-idle-4f',
    title: 'Idle 4f runtime',
    description: '当前运行时 idle 动作。',
    baseUrl: ASSISTANT_SPRITE_BASE,
    metaFile: 'idle-8dir-4f-packed.json',
    scale: 0.68,
  },
  {
    id: 'runtime-walk-approved',
    title: 'Walk approved runtime',
    description: '当前运行时 walk 动作，使用已确认循环段。',
    baseUrl: ASSISTANT_SPRITE_BASE,
    metaFile: 'walk-8dir-approved-packed.json',
    scale: 0.68,
  },
  {
    id: 'runtime-use-4f',
    title: 'Use 4f runtime',
    description: '当前运行时 use/tool 动作。',
    baseUrl: ASSISTANT_SPRITE_BASE,
    metaFile: 'use-8dir-4f-packed.json',
    scale: 0.68,
  },
  {
    id: 'runtime-sleep-4f',
    title: 'Sleep 4f runtime',
    description: '当前运行时 sleep 动作。',
    baseUrl: ASSISTANT_SPRITE_BASE,
    metaFile: 'sleep-8dir-4f-packed.json',
    scale: 0.68,
  },
]

function assetUrl(asset: ReviewSpriteAsset, file: string) {
  return `${asset.baseUrl}/${file}`
}

function SpriteReviewCard({ asset }: { asset: ReviewSpriteAsset }) {
  const [meta, setMeta] = useState<SpriteSheetMeta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    let active = true
    setMeta(null)
    setError(null)
    void fetch(assetUrl(asset, asset.metaFile), { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        return response.json() as Promise<SpriteSheetMeta>
      })
      .then((nextMeta) => {
        if (!active) return
        setMeta(nextMeta)
        setFrame(0)
      })
      .catch((nextError: unknown) => {
        if (!active) return
        setError(nextError instanceof Error ? nextError.message : '加载失败')
      })
    return () => {
      active = false
    }
  }, [asset])

  useEffect(() => {
    if (!meta) return undefined
    const fps = Math.max(1, meta.fps ?? 10)
    const timer = window.setInterval(() => {
      setFrame((value) => (value + 1) % meta.framesPerDirection)
    }, 1000 / fps)
    return () => window.clearInterval(timer)
  }, [meta])

  return (
    <article className="asset-review-card">
      <header className="asset-review-card-header">
        <div>
          <h2>{asset.title}</h2>
          <p>{asset.description}</p>
        </div>
        {meta ? <span>{meta.framesPerDirection}f · {meta.fps ?? 10}fps</span> : null}
      </header>
      {error ? (
        <div className="asset-review-error" role="alert">无法加载素材：{error}</div>
      ) : null}
      {!meta && !error ? <div className="asset-review-loading">加载素材...</div> : null}
      {meta ? (
        <div className="asset-direction-grid">
          {meta.directions.map((direction) => {
            const frameMeta = frameMetaFor({ meta, texture: {} as PixiTexture }, direction, frame)
            if (!frameMeta) return null
            const displayWidth = frameMeta.rect.w * asset.scale
            const displayHeight = frameMeta.rect.h * asset.scale
            const imageWidth = meta.frameWidth * meta.framesPerDirection * asset.scale
            const imageHeight = meta.frameHeight * meta.directions.length * asset.scale

            return (
              <div key={direction} className="asset-direction-cell">
                <div
                  className="asset-sprite-frame"
                  style={{
                    width: `${displayWidth}px`,
                    height: `${displayHeight}px`,
                    backgroundImage: `url("${assetUrl(asset, meta.image)}")`,
                    backgroundSize: `${imageWidth}px ${imageHeight}px`,
                    backgroundPosition: `${-frameMeta.rect.x * asset.scale}px ${-frameMeta.rect.y * asset.scale}px`,
                  }}
                  aria-label={`${asset.title} ${direction} 第 ${frame + 1} 帧`}
                />
                <span>{direction}</span>
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}

function AssetReviewPage() {
  return (
    <main className="asset-review-page">
      <header className="asset-review-hero">
        <div>
          <p className="game-kicker">Asset Review</p>
          <h1>Assistant 动作审核</h1>
        </div>
        <span>所有方向同步循环播放</span>
      </header>
      <section className="asset-review-stack" aria-label="动作素材循环播放">
        {REVIEW_SPRITE_ASSETS.map((asset) => (
          <SpriteReviewCard key={asset.id} asset={asset} />
        ))}
      </section>
    </main>
  )
}

const CYCLE_REVIEW_DIRECTIONS: SpriteDirection[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const CYCLE_REVIEW_TOTAL_FRAMES = CYCLE_REVIEW_SOURCE_FRAMES
const CYCLE_REVIEW_DEFAULTS: Record<SpriteDirection, CycleSelection> = {
  N: { start: 22, end: 42 },
  NE: { start: 17, end: 39 },
  E: { start: 13, end: 33 },
  SE: { start: 16, end: 37 },
  S: { start: 16, end: 35 },
  SW: { start: 16, end: 37 },
  W: { start: 11, end: 28 },
  NW: { start: 25, end: 46 },
}

function videoUrl(direction: SpriteDirection) {
  return `${ASSISTANT_WALK_VIDEO_BASE}/assistant-walk-${direction}-happyhorse-720p-faststart.mp4`
}

function frameToSeconds(frame: number) {
  return Math.max(0, (frame - 1) / CYCLE_REVIEW_SOURCE_FPS)
}

function frameEndToSeconds(frame: number) {
  return frameToSeconds(frame + 1)
}

function secondsToFrame(seconds: number) {
  return Math.min(CYCLE_REVIEW_TOTAL_FRAMES, Math.max(1, Math.round(seconds * CYCLE_REVIEW_SOURCE_FPS) + 1))
}

function clampCycleSelection(next: CycleSelection): CycleSelection {
  const start = Math.min(CYCLE_REVIEW_TOTAL_FRAMES - 1, Math.max(1, Math.round(next.start)))
  const end = Math.min(CYCLE_REVIEW_TOTAL_FRAMES, Math.max(start + 1, Math.round(next.end)))
  return { start, end }
}

function CycleDirectionCard({
  direction,
  selection,
  active,
  playing,
  onSelect,
  onChange,
}: {
  direction: SpriteDirection
  selection: CycleSelection
  active: boolean
  playing: boolean
  onSelect: () => void
  onChange: (selection: CycleSelection) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [currentFrame, setCurrentFrame] = useState(selection.start)
  const stepStart = (delta: number) => {
    onChange(clampCycleSelection({ ...selection, start: selection.start + delta }))
  }
  const stepEnd = (delta: number) => {
    onChange(clampCycleSelection({ ...selection, end: selection.end + delta }))
  }
  const stepVideo = (delta: number) => {
    const video = videoRef.current
    if (!video) return
    const nextFrame = Math.min(selection.end, Math.max(selection.start, currentFrame + delta))
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      video.currentTime = frameToSeconds(nextFrame)
    }
    setCurrentFrame(nextFrame)
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    video.playbackRate = 1
    video.loop = false
    video.autoplay = playing
    video.muted = true
    let animationFrame = 0
    let retryTimer = 0
    let disposed = false
    let hasAppliedStart = false
    const startSeconds = frameToSeconds(selection.start)
    const endSeconds = Math.min(
      frameEndToSeconds(selection.end),
      CYCLE_REVIEW_SOURCE_DURATION_SECONDS - 0.001,
    )

    const seekToFrame = (frame: number, time = frameToSeconds(frame)) => {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) return
      const targetTime = Math.min(Math.max(time, startSeconds), endSeconds - 0.001)
      if (Math.abs(video.currentTime - targetTime) > 0.002) {
        video.currentTime = targetTime
      }
      setCurrentFrame(Math.min(selection.end, Math.max(selection.start, frame)))
    }

    const ensureMetadata = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return true
      if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load()
      return false
    }

    const requestPlayback = () => {
      if (!playing || disposed) return
      window.clearTimeout(retryTimer)
      let attempts = 0
      const tryPlay = () => {
        if (!playing || disposed) return
        if (!ensureMetadata()) {
          retryTimer = window.setTimeout(tryPlay, 80)
          return
        }
        void video.play().catch(() => {
          attempts += 1
          if (attempts <= 10) retryTimer = window.setTimeout(tryPlay, 100)
        })
      }
      retryTimer = window.setTimeout(tryPlay, 0)
    }

    const restartSegment = () => {
      if (!ensureMetadata()) return
      seekToFrame(selection.start, startSeconds)
      hasAppliedStart = true
      requestPlayback()
    }

    const tick = () => {
      if (disposed) return
      if (!ensureMetadata()) {
        animationFrame = requestAnimationFrame(tick)
        return
      }

      if (!playing) {
        video.pause()
        setCurrentFrame(selection.start)
        return
      }

      if (!hasAppliedStart || video.currentTime < startSeconds - 0.01) {
        restartSegment()
      } else if (video.ended || video.currentTime >= endSeconds) {
        restartSegment()
      } else if (video.paused) {
        requestPlayback()
      } else {
        const frame = Math.min(selection.end, Math.max(selection.start, secondsToFrame(video.currentTime)))
        setCurrentFrame(frame)
      }
      animationFrame = requestAnimationFrame(tick)
    }

    const recoverPlayback = () => {
      if (!playing) return
      requestPlayback()
    }

    setCurrentFrame(selection.start)
    if (ensureMetadata()) {
      restartSegment()
    } else {
      video.load()
    }
    animationFrame = requestAnimationFrame(tick)
    video.addEventListener('ended', restartSegment)
    video.addEventListener('pause', recoverPlayback)
    video.addEventListener('loadedmetadata', restartSegment)
    video.addEventListener('canplay', recoverPlayback)
    video.addEventListener('stalled', recoverPlayback)
    video.addEventListener('waiting', recoverPlayback)

    return () => {
      disposed = true
      window.clearTimeout(retryTimer)
      cancelAnimationFrame(animationFrame)
      video.loop = false
      video.autoplay = false
      video.removeEventListener('ended', restartSegment)
      video.removeEventListener('pause', recoverPlayback)
      video.removeEventListener('loadedmetadata', restartSegment)
      video.removeEventListener('canplay', recoverPlayback)
      video.removeEventListener('stalled', recoverPlayback)
      video.removeEventListener('waiting', recoverPlayback)
    }
  }, [direction, playing, selection.end, selection.start])

  return (
    <article className={`cycle-direction-card ${active ? 'is-active' : ''}`} onClick={onSelect}>
      <header>
        <div>
          <h2>{direction}</h2>
          <p>{selection.start} - {selection.end} · 当前 {currentFrame}</p>
        </div>
        <div className="cycle-step-controls">
          <span className="cycle-active-pill">{active ? (playing ? '循环中' : '首帧') : '待选'}</span>
          <button type="button" onClick={() => stepVideo(-1)} aria-label={`${direction} 上一帧`}>
            <StepBack size={16} aria-hidden />
          </button>
          <button type="button" onClick={() => stepVideo(1)} aria-label={`${direction} 下一帧`}>
            <StepForward size={16} aria-hidden />
          </button>
        </div>
      </header>
      <div className="cycle-frame-stage">
        <video
          key={`${direction}-cycle-video-${CYCLE_REVIEW_VIDEO_ELEMENT_VERSION}`}
          ref={videoRef}
          src={videoUrl(direction)}
          muted
          playsInline
          autoPlay={active && playing}
          loop={false}
          preload={active ? 'auto' : 'metadata'}
          aria-label={`${direction} walk video`}
        />
      </div>
      <div className="cycle-range-stack">
        <label>
          <span>首帧</span>
          <button type="button" onClick={() => stepStart(-1)} disabled={selection.start <= 1} aria-label={`${direction} 首帧减 1`}>
            <Minus size={14} aria-hidden />
          </button>
          <input
            type="range"
            min={1}
            max={CYCLE_REVIEW_TOTAL_FRAMES}
            value={selection.start}
            onChange={(event) => onChange(clampCycleSelection({ ...selection, start: Number(event.target.value) }))}
          />
          <button type="button" onClick={() => stepStart(1)} disabled={selection.start >= selection.end - 1} aria-label={`${direction} 首帧加 1`}>
            <Plus size={14} aria-hidden />
          </button>
          <strong>{selection.start}</strong>
        </label>
        <label>
          <span>尾帧</span>
          <button type="button" onClick={() => stepEnd(-1)} disabled={selection.end <= selection.start + 1} aria-label={`${direction} 尾帧减 1`}>
            <Minus size={14} aria-hidden />
          </button>
          <input
            type="range"
            min={1}
            max={CYCLE_REVIEW_TOTAL_FRAMES}
            value={selection.end}
            onChange={(event) => onChange(clampCycleSelection({ ...selection, end: Number(event.target.value) }))}
          />
          <button type="button" onClick={() => stepEnd(1)} disabled={selection.end >= CYCLE_REVIEW_TOTAL_FRAMES} aria-label={`${direction} 尾帧加 1`}>
            <Plus size={14} aria-hidden />
          </button>
          <strong>{selection.end}</strong>
        </label>
      </div>
    </article>
  )
}

function CycleReviewPage() {
  const [selections, setSelections] = useState<Record<SpriteDirection, CycleSelection>>(CYCLE_REVIEW_DEFAULTS)
  const [activeDirection, setActiveDirection] = useState<SpriteDirection>('N')
  const [playing, setPlaying] = useState(true)
  const [copied, setCopied] = useState(false)

  const exportPayload = useMemo(() => ({
    kind: 'assistant-walk-cycle-selection',
    sourceFps: Number(CYCLE_REVIEW_SOURCE_FPS.toFixed(6)),
    totalSourceFrames: CYCLE_REVIEW_TOTAL_FRAMES,
    directions: Object.fromEntries(
      CYCLE_REVIEW_DIRECTIONS.map((direction) => [
        direction,
        {
          startFrame: selections[direction].start,
          endFrame: selections[direction].end,
        },
      ]),
    ),
  }), [selections])

  function updateSelection(direction: SpriteDirection, selection: CycleSelection) {
    setSelections((value) => ({ ...value, [direction]: selection }))
    setCopied(false)
  }

  async function copyConfig() {
    const text = JSON.stringify(exportPayload, null, 2)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  function resetSelections() {
    setSelections(CYCLE_REVIEW_DEFAULTS)
    setCopied(false)
  }

  return (
    <main className="cycle-review-page">
      <header className="cycle-review-toolbar">
        <div>
          <p className="game-kicker">Cycle Review</p>
          <h1>Walk 循环片段选择</h1>
        </div>
        <div className="cycle-toolbar-controls">
          <button type="button" className="cycle-play-mode-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? '暂停在首帧' : '循环播放'}>
            {playing ? <Pause size={17} aria-hidden /> : <Play size={17} aria-hidden />}
            {playing ? '暂停在首帧' : '循环播放'}
          </button>
          <button type="button" className="cycle-secondary-button" onClick={resetSelections}>重置</button>
          <button type="button" className="cycle-copy-button" onClick={() => void copyConfig()}>
            {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
            {copied ? '已复制' : '复制配置'}
          </button>
        </div>
      </header>
      <section className="cycle-review-grid" aria-label="8 方向循环片段选择">
        {CYCLE_REVIEW_DIRECTIONS.map((direction) => {
          return (
            <CycleDirectionCard
              key={direction}
              direction={direction}
              selection={selections[direction]}
              active={direction === activeDirection}
              playing={playing && direction === activeDirection}
              onSelect={() => setActiveDirection(direction)}
              onChange={(selection) => updateSelection(direction, selection)}
            />
          )
        })}
      </section>
      <section className="cycle-config-preview" aria-label="复制配置预览">
        <pre>{JSON.stringify(exportPayload, null, 2)}</pre>
      </section>
    </main>
  )
}

function PixiWalkReviewCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState('加载 Pixi walk 素材...')

  useEffect(() => {
    let cancelled = false
    let initialized = false
    const app = new PixiApplication()
    const destroyApp = () => {
      if (!initialized) return
      try {
        app.destroy(true)
      } catch {
        // Pixi's ResizePlugin can throw during React dev-mode remount cleanup.
      }
    }

    async function setup() {
      await app.init({
        width: 1120,
        height: 560,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      initialized = true
      if (cancelled) {
        destroyApp()
        return
      }

      app.canvas.className = 'pixi-review-canvas'
      hostRef.current?.appendChild(app.canvas)
      const metaUrl = `${ASSISTANT_SPRITE_BASE}/walk-8dir-approved-packed.json`
      const meta = await fetch(metaUrl).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${metaUrl}`)
        return response.json() as Promise<SpriteSheetMeta>
      })
      const sheetTexture = await PixiAssets.load<PixiTexture>(`${ASSISTANT_SPRITE_BASE}/${meta.image}`)
      if (cancelled) {
        destroyApp()
        return
      }

      const textures = new Map<string, PixiTexture>()
      for (const frame of meta.frames) {
        textures.set(
          `${frame.direction}:${frame.frame}`,
          new PixiTexture({
            source: sheetTexture.source,
            frame: new PixiRectangle(frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h),
          }),
        )
      }

      const layer = new PixiContainer()
      app.stage.addChild(layer)
      const sprites = CYCLE_REVIEW_DIRECTIONS.map((direction, index) => {
        const column = index % 4
        const row = Math.floor(index / 4)
        const firstFrame = meta.frames.find((item) => item.direction === direction)
        const texture = textures.get(`${direction}:0`) ?? sheetTexture
        const sprite = new PixiSprite(texture)
        const anchor = firstFrame?.anchor ?? meta.anchor
        sprite.anchor.set(anchor.x / meta.frameWidth, anchor.y / meta.frameHeight)
        sprite.scale.set(0.88)
        sprite.x = column * 280 + 140
        sprite.y = row * 260 + 220
        layer.addChild(sprite)
        return { direction, sprite }
      })

      const animate = () => {
        const elapsedSeconds = performance.now() / 1000
        for (const item of sprites) {
          const frameCount = meta.framesPerDirectionByDirection?.[item.direction] ?? meta.framesPerDirection
          const frame = Math.floor(elapsedSeconds * (meta.fps ?? CYCLE_REVIEW_SOURCE_FPS)) % frameCount
          const texture = textures.get(`${item.direction}:${frame}`)
          if (texture) item.sprite.texture = texture
        }
      }

      app.ticker.add(animate)
      setStatus(`${meta.framesPerDirection}f max · ${Number(meta.fps ?? CYCLE_REVIEW_SOURCE_FPS).toFixed(3)}fps · Pixi`)

      return () => {
        app.ticker.remove(animate)
      }
    }

    let cleanup: (() => void) | undefined
    void setup()
      .then((nextCleanup) => {
        cleanup = nextCleanup
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'Pixi walk 素材加载失败')
      })

    return () => {
      cancelled = true
      cleanup?.()
      destroyApp()
    }
  }, [])

  return (
    <section className="pixi-review-panel" aria-label="Pixi walk approved preview">
      <header>
        <div>
          <h2>Walk approved runtime</h2>
          <p>{status}</p>
        </div>
        <span>8 方向 · Pixi canvas</span>
      </header>
      <div className="pixi-review-stage" ref={hostRef} />
      <div className="pixi-review-directions" aria-hidden>
        {CYCLE_REVIEW_DIRECTIONS.map((direction) => (
          <span key={direction}>{direction}</span>
        ))}
      </div>
    </section>
  )
}

function spriteDirectionFromDelta(dx: number, dy: number): SpriteDirection {
  const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360
  if (angle < 22.5 || angle >= 337.5) return 'E'
  if (angle < 67.5) return 'SE'
  if (angle < 112.5) return 'S'
  if (angle < 157.5) return 'SW'
  if (angle < 202.5) return 'W'
  if (angle < 247.5) return 'NW'
  if (angle < 292.5) return 'N'
  return 'NE'
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function shortestNavigationPath(navigation: RoomSceneNavigation, fromId: string, toId: string) {
  const nodes = new Map(navigation.nodes.map((node) => [node.id, node]))
  if (!nodes.has(fromId) || !nodes.has(toId)) return []

  const neighbors = new Map<string, string[]>()
  for (const node of navigation.nodes) neighbors.set(node.id, [])
  for (const [from, to] of navigation.edges) {
    neighbors.get(from)?.push(to)
    neighbors.get(to)?.push(from)
  }

  const open = new Set([fromId])
  const cameFrom = new Map<string, string>()
  const gScore = new Map<string, number>([[fromId, 0]])
  const fScore = new Map<string, number>([[fromId, pointDistance(nodes.get(fromId)!, nodes.get(toId)!)]])

  while (open.size > 0) {
    let current = fromId
    let bestScore = Number.POSITIVE_INFINITY
    for (const id of open) {
      const score = fScore.get(id) ?? Number.POSITIVE_INFINITY
      if (score < bestScore) {
        current = id
        bestScore = score
      }
    }
    if (current === toId) {
      const path = [current]
      while (cameFrom.has(path[0])) path.unshift(cameFrom.get(path[0])!)
      return path.map((id) => nodes.get(id)!)
    }

    open.delete(current)
    for (const next of neighbors.get(current) ?? []) {
      const currentNode = nodes.get(current)
      const nextNode = nodes.get(next)
      if (!currentNode || !nextNode) continue
      const tentative = (gScore.get(current) ?? Number.POSITIVE_INFINITY) + pointDistance(currentNode, nextNode)
      if (tentative >= (gScore.get(next) ?? Number.POSITIVE_INFINITY)) continue
      cameFrom.set(next, current)
      gScore.set(next, tentative)
      fScore.set(next, tentative + pointDistance(nextNode, nodes.get(toId)!))
      open.add(next)
    }
  }

  return []
}

function navigationRouteForScene(scene: RoomSceneManifest) {
  const navigation = scene.navigation
  if (!navigation || navigation.route.length < 2) return scene.agentRoute

  const route: Point[] = []
  for (let index = 0; index < navigation.route.length - 1; index += 1) {
    const segment = shortestNavigationPath(navigation, navigation.route[index], navigation.route[index + 1])
    if (segment.length === 0) continue
    route.push(...(route.length > 0 ? segment.slice(1) : segment))
  }
  return route.length > 1 ? route : scene.agentRoute
}

async function loadRoomPropSheet(assetBase: string, manifestPath: string): Promise<LoadedRoomPropSheet> {
  const metaUrl = `${assetBase}/${manifestPath}`
  const meta = await fetch(metaUrl).then((response) => {
    if (!response.ok) throw new Error(`Failed to load ${metaUrl}`)
    return response.json() as Promise<RoomPropSpriteMeta>
  })
  const texture = await PixiAssets.load<PixiTexture>(`${assetBase}/${meta.image}`)
  const frames = meta.frames.map((frame) => (
    new PixiTexture({
      source: texture.source,
      frame: new PixiRectangle(frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h),
    })
  ))
  return { meta, texture, frames }
}

function addPixiSceneLabel(layer: PixiContainer, label: RoomSceneLabel) {
  const labelContainer = new PixiContainer()
  const text = new PixiText({
    text: label.text,
    style: {
      fill: 0xf5e9d4,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 16,
      fontWeight: '500',
    },
  })
  text.x = 14
  text.y = 7
  const width = Math.ceil(Math.max(88, text.width + 28))
  const bg = new PixiGraphics()
  bg.roundRect(0, 0, width, 36, 8).fill(0x181d26)
  bg.stroke({ color: 0xd9a441, width: 1, alpha: 0.72 })
  labelContainer.addChild(bg)
  labelContainer.addChild(text)
  labelContainer.x = label.x
  labelContainer.y = label.y
  labelContainer.zIndex = 520

  const connector = new PixiGraphics()
  connector.moveTo(label.x + width / 2, label.y + 36)
  connector.lineTo(label.targetX, label.targetY)
  connector.stroke({ color: 0xd9a441, width: 1, alpha: 0.6 })
  connector.zIndex = 519

  layer.addChild(connector)
  layer.addChild(labelContainer)
}

function PixiDesignedRoomSceneCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState('加载 Pixi 房间位图资产...')

  useEffect(() => {
    let cancelled = false
    let initialized = false
    const app = new PixiApplication()
    const destroyApp = () => {
      if (!initialized) return
      try {
        app.destroy(true)
      } catch {
        // Pixi's ResizePlugin can throw during React dev-mode remount cleanup.
      }
    }

    async function setup() {
      const scene = await fetch(`${ROOM_SCENE_BASE}/scene.json`).then((response) => {
        if (!response.ok) throw new Error('Failed to load room scene manifest')
        return response.json() as Promise<RoomSceneManifest>
      })
      const assetBase = scene.assetBase || ROOM_SCENE_BASE

      await app.init({
        width: scene.size.width,
        height: scene.size.height,
        background: '#0d1218',
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      initialized = true
      if (cancelled) {
        destroyApp()
        return
      }

      app.canvas.className = 'pixi-designed-room-canvas'
      hostRef.current?.appendChild(app.canvas)

      const sky = new PixiGraphics()
      sky.rect(0, 0, scene.size.width, scene.size.height).fill(0x0d1218)
      for (let index = 0; index < 54; index += 1) {
        const x = (index * 173) % scene.size.width
        const y = 42 + ((index * 97) % (scene.size.height - 92))
        const radius = index % 7 === 0 ? 1.6 : 0.9
        sky.circle(x, y, radius).fill(index % 5 === 0 ? 0xf4d35e : 0xa8d8c4)
      }
      sky.alpha = 0.42
      app.stage.addChild(sky)

      const sceneLayer = new PixiContainer()
      sceneLayer.sortableChildren = true
      app.stage.addChild(sceneLayer)

      const spriteSheets = new Map<string, LoadedRoomPropSheet>()
      await Promise.all(Object.entries(scene.assets).map(async ([key, asset]) => {
        if (asset.type === 'sprite') {
          spriteSheets.set(key, await loadRoomPropSheet(assetBase, asset.manifest))
        }
      }))
      if (cancelled) {
        destroyApp()
        return
      }

      type AnimatedSceneSprite = {
        sprite: PixiSprite
        sheet: LoadedRoomPropSheet
        phase: number
      }
      const animatedSprites: AnimatedSceneSprite[] = []

      for (const layer of scene.layers) {
        const asset = scene.assets[layer.asset]
        if (!asset) continue
        if (asset.type === 'image') {
          const texture = await PixiAssets.load<PixiTexture>(`${assetBase}/${asset.src}`)
          const sprite = new PixiSprite(texture)
          sprite.x = layer.x
          sprite.y = layer.y
          sprite.scale.set(layer.scale ?? 1)
          sprite.zIndex = layer.z
          sceneLayer.addChild(sprite)
        } else {
          const sheet = spriteSheets.get(layer.asset)
          if (!sheet) continue
          const sprite = new PixiSprite(sheet.frames[0])
          sprite.anchor.set(sheet.meta.anchor.x / sheet.meta.frameWidth, sheet.meta.anchor.y / sheet.meta.frameHeight)
          sprite.x = layer.x
          sprite.y = layer.y
          sprite.scale.set(layer.scale ?? 1)
          sprite.zIndex = layer.z
          sceneLayer.addChild(sprite)
          animatedSprites.push({ sprite, sheet, phase: animatedSprites.length * 0.19 })
        }
      }

      const padSheet = spriteSheets.get('pad')
      if (padSheet) {
        for (const pad of scene.pads) {
          const sprite = new PixiSprite(padSheet.frames[0])
          sprite.anchor.set(padSheet.meta.anchor.x / padSheet.meta.frameWidth, padSheet.meta.anchor.y / padSheet.meta.frameHeight)
          sprite.x = pad.x
          sprite.y = pad.y
          sprite.scale.set(pad.scale ?? 1)
          sprite.zIndex = pad.z
          sceneLayer.addChild(sprite)
          animatedSprites.push({ sprite, sheet: padSheet, phase: animatedSprites.length * 0.13 })
        }
      }

      for (const label of scene.labels) {
        addPixiSceneLabel(sceneLayer, label)
      }

      const walkMetaUrl = `${ASSISTANT_SPRITE_BASE}/walk-8dir-approved-packed.json`
      const walkMeta = await fetch(walkMetaUrl).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${walkMetaUrl}`)
        return response.json() as Promise<SpriteSheetMeta>
      })
      const walkTexture = await PixiAssets.load<PixiTexture>(`${ASSISTANT_SPRITE_BASE}/${walkMeta.image}`)
      const walkTextures = new Map<string, PixiTexture>()
      for (const frame of walkMeta.frames) {
        walkTextures.set(
          `${frame.direction}:${frame.frame}`,
          new PixiTexture({
            source: walkTexture.source,
            frame: new PixiRectangle(frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h),
          }),
        )
      }

      const sceneRoute = navigationRouteForScene(scene)
      const route = sceneRoute.length > 1 ? sceneRoute : [{ x: 624, y: 472 }, { x: 902, y: 548 }]
      let position = { ...route[0] }
      let targetIndex = 1
      let direction: SpriteDirection = 'SE'
      let lastFrameTime = performance.now()
      const firstFrame = walkMeta.frames.find((item) => item.direction === direction)
      const agent = new PixiSprite(walkTextures.get(`${direction}:0`) ?? walkTexture)
      agent.anchor.set(
        (firstFrame?.anchor.x ?? walkMeta.anchor.x) / walkMeta.frameWidth,
        (firstFrame?.anchor.y ?? walkMeta.anchor.y) / walkMeta.frameHeight,
      )
      agent.scale.set(ROOM_SCENE_AGENT_SCALE)
      agent.x = position.x
      agent.y = position.y + 8
      agent.zIndex = Math.round(position.y / 4)
      sceneLayer.addChild(agent)

      const animate = () => {
        const now = performance.now()
        const elapsedSeconds = now / 1000
        for (const item of animatedSprites) {
          const frame = Math.floor((elapsedSeconds + item.phase) * item.sheet.meta.fps) % item.sheet.frames.length
          item.sprite.texture = item.sheet.frames[frame]
        }

        const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000))
        lastFrameTime = now
        const target = route[targetIndex]
        const dx = target.x - position.x
        const dy = target.y - position.y
        const distance = Math.hypot(dx, dy)
        const step = AGENT_MOVE_SPEED * dt
        if (distance <= 1 || step >= distance) {
          position = { ...target }
          targetIndex = (targetIndex + 1) % route.length
        } else {
          position = {
            x: position.x + dx / distance * step,
            y: position.y + dy / distance * step,
          }
          direction = spriteDirectionFromDelta(dx, dy)
        }

        const frameCount = walkMeta.framesPerDirectionByDirection?.[direction] ?? walkMeta.framesPerDirection
        const frame = Math.floor(elapsedSeconds * (walkMeta.fps ?? CYCLE_REVIEW_SOURCE_FPS)) % frameCount
        const texture = walkTextures.get(`${direction}:${frame}`)
        if (texture) agent.texture = texture
        agent.x = position.x
        agent.y = position.y + 8
        agent.zIndex = Math.round(position.y / 4)
      }

      app.ticker.add(animate)
      setStatus(
        animatedSprites.length > 0
          ? `场景 ${scene.size.width}x${scene.size.height} · ${animatedSprites.length} 个位图动画实例 · approved walk`
          : `场景 ${scene.size.width}x${scene.size.height} · 完整场景位图 · approved walk`,
      )

      return () => {
        app.ticker.remove(animate)
      }
    }

    let cleanup: (() => void) | undefined
    void setup()
      .then((nextCleanup) => {
        cleanup = nextCleanup
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'Pixi 房间场景加载失败')
      })

    return () => {
      cancelled = true
      cleanup?.()
      destroyApp()
    }
  }, [])

  return (
    <section className="pixi-review-panel pixi-designed-room-panel" aria-label="Pixi designed room bitmap scene">
      <header>
        <div>
          <h2>Agent room bitmap scene</h2>
          <p>{status}</p>
        </div>
        <span>complete scene bitmap · Pixi</span>
      </header>
      <div className="pixi-designed-room-stage" ref={hostRef} />
    </section>
  )
}

function PixiRoomPathReviewCanvas() {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [status, setStatus] = useState('加载房间路径预览...')

  useEffect(() => {
    let cancelled = false
    let initialized = false
    const app = new PixiApplication()
    const destroyApp = () => {
      if (!initialized) return
      try {
        app.destroy(true)
      } catch {
        // Pixi's ResizePlugin can throw during React dev-mode remount cleanup.
      }
    }

    async function setup() {
      await app.init({
        width: ROOM_LAYOUT.width,
        height: ROOM_LAYOUT.height,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      })
      initialized = true
      if (cancelled) {
        destroyApp()
        return
      }

      app.canvas.className = 'pixi-room-review-canvas'
      hostRef.current?.appendChild(app.canvas)
      const metaUrl = `${ASSISTANT_SPRITE_BASE}/walk-8dir-approved-packed.json`
      const meta = await fetch(metaUrl).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${metaUrl}`)
        return response.json() as Promise<SpriteSheetMeta>
      })
      const sheetTexture = await PixiAssets.load<PixiTexture>(`${ASSISTANT_SPRITE_BASE}/${meta.image}`)
      if (cancelled) {
        destroyApp()
        return
      }

      const textures = new Map<string, PixiTexture>()
      for (const frame of meta.frames) {
        textures.set(
          `${frame.direction}:${frame.frame}`,
          new PixiTexture({
            source: sheetTexture.source,
            frame: new PixiRectangle(frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h),
          }),
        )
      }

      const route = [
        ROOM_LAYOUT.idlePoint,
        ...ROOM_LAYOUT.props.map((prop) => prop.standPoint),
        ROOM_LAYOUT.sleepPoint,
        ROOM_LAYOUT.idlePoint,
      ]
      let position = { ...route[0] }
      let targetIndex = 1
      let direction: SpriteDirection = 'SE'
      let lastFrameTime = performance.now()

      const firstFrame = meta.frames.find((item) => item.direction === direction)
      const sprite = new PixiSprite(textures.get(`${direction}:0`) ?? sheetTexture)
      const anchor = firstFrame?.anchor ?? meta.anchor
      sprite.anchor.set(anchor.x / meta.frameWidth, anchor.y / meta.frameHeight)
      sprite.scale.set(0.72)
      sprite.x = position.x
      sprite.y = position.y + 10
      app.stage.addChild(sprite)

      const animate = () => {
        const now = performance.now()
        const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000))
        lastFrameTime = now

        const target = route[targetIndex]
        const dx = target.x - position.x
        const dy = target.y - position.y
        const distance = Math.hypot(dx, dy)
        const step = AGENT_MOVE_SPEED * dt
        if (distance <= 1 || step >= distance) {
          position = { ...target }
          targetIndex = (targetIndex + 1) % route.length
        } else {
          position = {
            x: position.x + dx / distance * step,
            y: position.y + dy / distance * step,
          }
          direction = spriteDirectionFromDelta(dx, dy)
        }

        const frameCount = meta.framesPerDirectionByDirection?.[direction] ?? meta.framesPerDirection
        const frame = Math.floor((now / 1000) * (meta.fps ?? CYCLE_REVIEW_SOURCE_FPS)) % frameCount
        const texture = textures.get(`${direction}:${frame}`)
        if (texture) sprite.texture = texture
        sprite.x = position.x
        sprite.y = position.y + 10
      }

      app.ticker.add(animate)
      setStatus(`路径点 ${route.length - 1} 段 · ${AGENT_MOVE_SPEED}px/s · approved walk`)

      return () => {
        app.ticker.remove(animate)
      }
    }

    let cleanup: (() => void) | undefined
    void setup()
      .then((nextCleanup) => {
        cleanup = nextCleanup
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : '房间路径预览加载失败')
      })

    return () => {
      cancelled = true
      cleanup?.()
      destroyApp()
    }
  }, [])

  return (
    <section className="pixi-review-panel pixi-room-review-panel" aria-label="Pixi room path approved preview">
      <header>
        <div>
          <h2>Room path movement</h2>
          <p>{status}</p>
        </div>
        <span>实际房间坐标</span>
      </header>
      <div className="pixi-room-review-stage">
        <div className="pixi-room-review-wall">
          <div className="pixi-room-review-window" />
        </div>
        <div className="pixi-room-review-floor" />
        <div className="pixi-room-review-tools" aria-hidden>
          {ROOM_LAYOUT.props.map((prop) => (
            <ToolObject
              key={prop.id}
              scene={TOOL_SCENES[prop.toolKind]}
              style={{ left: `${prop.position.x}px`, top: `${prop.position.y}px`, zIndex: prop.z }}
            />
          ))}
        </div>
        <RoomSetDressing />
        <div ref={hostRef} className="pixi-room-review-canvas-host" />
      </div>
    </section>
  )
}

function PixiWalkReviewPage() {
  return (
    <main className="pixi-review-page">
      <header className="cycle-review-toolbar">
        <div>
          <p className="game-kicker">Pixi Review</p>
          <h1>房间 Pixi 场景预览</h1>
        </div>
        <span className="pixi-review-badge">complete scene bitmap + approved walk</span>
      </header>
      <PixiDesignedRoomSceneCanvas />
      <PixiWalkReviewCanvas />
    </main>
  )
}

export function App() {
  const [runtimeConfig, setRuntimeConfig] = useState<AppRuntimeConfig | null>(null)
  const showPreview = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('game-room-preview')
  const showAssetReview = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('asset-review')
  const showCycleReview = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('cycle-review')
  const showPixiReview = import.meta.env.DEV
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('pixi-review')

  useEffect(() => {
    let active = true
    void loadRuntimeConfig().then((config) => {
      if (!active) return
      applyDocumentBranding(resolveAppBranding(config))
      setRuntimeConfig(config)
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function handleConfigUpdate(event: Event) {
      const nextConfig = (event as CustomEvent<AppRuntimeConfig>).detail
      if (!nextConfig || typeof nextConfig !== 'object') return
      applyDocumentBranding(resolveAppBranding(nextConfig))
      setRuntimeConfig(nextConfig)
    }
    window.addEventListener('beeseed:app-config-updated', handleConfigUpdate)
    return () => window.removeEventListener('beeseed:app-config-updated', handleConfigUpdate)
  }, [])

  if (showCycleReview) return <CycleReviewPage />
  if (showPixiReview) return <PixiWalkReviewPage />
  if (showAssetReview) return <AssetReviewPage />
  if (showPreview) return <PreviewGameRoom />

  if (!runtimeConfig) {
    return <div className="game-loading">加载房间...</div>
  }

  return (
    <RuntimeErrorBoundary>
      <BeeSeedProvider config={{ workerUrl: '', appConfig: runtimeConfig }}>
        <AuthGuard fallback={<AuthScreen />}>
          <ChannelBootstrap />
          <GameRoomRuntime />
        </AuthGuard>
      </BeeSeedProvider>
    </RuntimeErrorBoundary>
  )
}
