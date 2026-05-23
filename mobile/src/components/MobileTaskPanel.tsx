import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PauseCircle,
  PlayCircle,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react'
import {
  Badge,
  Button,
  CreateScheduledTaskDialog,
  CreateTaskDialog,
  cn,
  useChannels,
  useTasks,
  type CalendarEvent,
  type ChannelMemberInfo,
  type Task,
  type TaskSchedule,
} from '@beeseed/beeseed-sdk'
import { TaskDetailSheet } from '../../../../../beeseed-sdk/src/components/tasks/TaskDetailSheet.js'
import type { TaskSchedulerMetrics } from '../../../../../beeseed-sdk/src/core/types.js'

interface Props {
  channelId: string | null
  members?: ChannelMemberInfo[]
  createTaskRequest?: number
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const STATUS_META = {
  pending: { label: '待出发', tone: 'pink', icon: Clock3 },
  in_progress: { label: '冒险中', tone: 'blue', icon: Zap },
  done: { label: '已完成', tone: 'green', icon: CheckCircle2 },
  failed: { label: '遇险', tone: 'red', icon: AlertTriangle },
  blocked: { label: '卡关', tone: 'amber', icon: ShieldCheck },
} as const

export function MobileTaskPanel({ channelId, members = [], createTaskRequest = 0 }: Props) {
  const { channels } = useChannels()
  const {
    projects,
    tasks,
    scheduledTasks,
    calendarEvents,
    metrics,
    loading,
    schedulesLoading,
    metricsLoading,
    getTask,
    createTask,
    createScheduledTask,
    updateScheduledTask,
    deleteScheduledTask,
    deleteTask,
    fetchScheduledTasks,
    fetchCalendar,
    fetchMetrics,
  } = useTasks(channelId)
  const [activeTab, setActiveTab] = useState<'tasks' | 'calendar' | 'schedules'>('tasks')
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(new Date()))
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()))
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const calendarRange = useMemo(() => getCalendarRange(calendarMonth), [calendarMonth])
  const currentChannel = channels.find((channel) => channel.id === channelId)
  const agentMembers = members.filter((member) => member.member_type === 'agent' && member.agent_id)
  const agentNames = new Map(agentMembers.map((agent) => [agent.agent_id, agent.display_name || agent.agent_id || 'Agent']))
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) || null : null
  const groupedByProject = projects.map((project) => ({
    project,
    tasks: tasks.filter((task) => task.project_id === project.id),
  })).filter((item) => item.tasks.length > 0)
  const orphanTasks = tasks.filter((task) => !task.project_id)
  const selectedEvents = calendarEvents.filter((event) => isSameLocalDay(new Date(event.start_at), selectedDate))
  const doneCount = tasks.filter((task) => task.status === 'done').length
  const clearRate = tasks.length > 0 ? Math.round((doneCount / tasks.length) * 100) : 0

  useEffect(() => {
    if (!channelId) return
    void fetchCalendar({
      from: calendarRange.gridStart.toISOString(),
      to: calendarRange.gridEnd.toISOString(),
    })
  }, [channelId, calendarRange.gridStart, calendarRange.gridEnd])

  const refreshCalendarRange = () => fetchCalendar({
    from: calendarRange.gridStart.toISOString(),
    to: calendarRange.gridEnd.toISOString(),
  })

  const handleCreateTask = async (data: Parameters<typeof createTask>[0]) => {
    setActiveTab('tasks')
    const created = await createTask(data)
    if (created?.due_at || created?.scheduled_start_at) {
      await refreshCalendarRange()
    }
    await fetchMetrics()
  }

  const handleCreateScheduledTask = async (data: Parameters<typeof createScheduledTask>[0]) => {
    const created = await createScheduledTask(data)
    if (!created) return
    setActiveTab('schedules')
    await fetchScheduledTasks()
    await refreshCalendarRange()
    await fetchMetrics()
  }

  const openTask = (task: Task) => setSelectedTaskId(task.id)
  const openEventTask = (event: CalendarEvent) => {
    if (!event.task_id) return
    if (!tasks.some((task) => task.id === event.task_id)) {
      void getTask(event.task_id)
    }
    setSelectedTaskId(event.task_id)
  }

  if (!channelId) {
    return (
      <div className="mobile-game-task-shell">
        <PanelEmpty text="选择一个队伍后查看委托" />
      </div>
    )
  }

  return (
    <div className="mobile-game-task-shell">
      <section className="mobile-game-task-hero">
        <div className="mobile-game-task-hero-copy">
          <span className="mobile-game-task-kicker">委托大厅</span>
          <h2>{currentChannel?.name || '当前队伍'}</h2>
          <p>{metricsLoading ? '正在刷新战报' : `完成率 ${clearRate}% · ${tasks.length} 个委托`}</p>
        </div>
        <TaskMascot />
        <div className="mobile-game-task-actions">
          <CreateTaskDialog agents={agentMembers} onSubmit={handleCreateTask} requestOpenKey={createTaskRequest} />
          <CreateScheduledTaskDialog agents={agentMembers} onSubmit={handleCreateScheduledTask} />
        </div>
      </section>

      <MetricDeck metrics={metrics} loading={metricsLoading} />

      <div className="mobile-game-task-tabs">
        <TabButton active={activeTab === 'tasks'} icon={<CheckCircle2 />} label="委托板" onClick={() => setActiveTab('tasks')} />
        <TabButton active={activeTab === 'calendar'} icon={<CalendarClock />} label="冒险日历" onClick={() => setActiveTab('calendar')} />
        <TabButton active={activeTab === 'schedules'} icon={<Repeat2 />} label="自动巡逻" onClick={() => setActiveTab('schedules')} />
      </div>

      <div className="mobile-game-task-content">
        {activeTab === 'tasks' && (
          <TaskBoard
            loading={loading}
            groupedByProject={groupedByProject}
            orphanTasks={orphanTasks}
            agentNames={agentNames}
            onOpen={openTask}
            onDelete={(task) => void deleteTask(task.id)}
          />
        )}
        {activeTab === 'calendar' && (
          <CalendarBoard
            month={calendarMonth}
            selectedDate={selectedDate}
            events={calendarEvents}
            selectedEvents={selectedEvents}
            onSelectDate={setSelectedDate}
            onPreviousMonth={() => setCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}
            onNextMonth={() => setCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}
            onOpenEvent={openEventTask}
          />
        )}
        {activeTab === 'schedules' && (
          <ScheduleBoard
            loading={schedulesLoading}
            schedules={scheduledTasks}
            agentNames={agentNames}
            onToggle={(schedule) => void updateScheduledTask(schedule.id, { enabled: !schedule.enabled }).then(() => fetchScheduledTasks()).then(() => refreshCalendarRange()).then(() => fetchMetrics())}
            onDelete={(schedule) => void deleteScheduledTask(schedule.id).then(() => refreshCalendarRange()).then(() => fetchMetrics())}
          />
        )}
      </div>

      <TaskDetailSheet
        channelId={channelId}
        task={selectedTask}
        members={members}
        channelName={currentChannel?.name || undefined}
        open={!!selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onTaskChanged={() => {
          void refreshCalendarRange()
          void fetchMetrics()
        }}
      />
    </div>
  )
}

function MetricDeck({ metrics, loading }: { metrics: TaskSchedulerMetrics | null; loading: boolean }) {
  const items = [
    { key: 'open', label: '宝箱', value: metrics?.open ?? 0, tone: 'pink', icon: Sparkles },
    { key: 'ready', label: '待派发', value: metrics?.ready ?? 0, tone: 'amber', icon: Clock3 },
    { key: 'dispatched', label: '出战', value: metrics?.dispatched ?? 0, tone: 'blue', icon: Zap },
    { key: 'verify', label: '验收', value: metrics?.awaiting_verify ?? 0, tone: 'green', icon: ShieldCheck },
  ]
  return (
    <div className="mobile-game-task-metrics">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.key} className={`mobile-game-task-metric is-${item.tone}`}>
            <Icon />
            <span>{item.label}</span>
            <strong>{loading ? '...' : item.value}</strong>
          </div>
        )
      })}
    </div>
  )
}

function TabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" className={cn('mobile-game-task-tab', active && 'is-active')} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function TaskBoard({
  loading,
  groupedByProject,
  orphanTasks,
  agentNames,
  onOpen,
  onDelete,
}: {
  loading: boolean
  groupedByProject: Array<{ project: { id: string; title: string; done_count?: number; task_count?: number }; tasks: Task[] }>
  orphanTasks: Task[]
  agentNames: Map<string | undefined, string>
  onOpen: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  if (loading) return <PanelEmpty text="委托板刷新中..." />
  if (groupedByProject.length === 0 && orphanTasks.length === 0) return <PanelEmpty text="还没有委托，点右上角新建一个吧" />
  return (
    <div className="mobile-game-task-list">
      {groupedByProject.map(({ project, tasks }) => (
        <section key={project.id} className="mobile-game-task-project">
          <div className="mobile-game-task-project-title">
            <span>{project.title}</span>
            <em>{project.done_count ?? 0}/{project.task_count ?? tasks.length}</em>
          </div>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} assignedLabel={task.assigned_agent_id ? agentNames.get(task.assigned_agent_id) : undefined} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </section>
      ))}
      {orphanTasks.length > 0 && (
        <section className="mobile-game-task-project">
          <div className="mobile-game-task-project-title">
            <span>散落委托</span>
            <em>{orphanTasks.length}</em>
          </div>
          {orphanTasks.map((task) => (
            <TaskCard key={task.id} task={task} assignedLabel={task.assigned_agent_id ? agentNames.get(task.assigned_agent_id) : undefined} onOpen={onOpen} onDelete={onDelete} />
          ))}
        </section>
      )}
    </div>
  )
}

function TaskCard({ task, assignedLabel, onOpen, onDelete }: { task: Task; assignedLabel?: string; onOpen: (task: Task) => void; onDelete: (task: Task) => void }) {
  const meta = STATUS_META[task.status] || STATUS_META.pending
  const Icon = meta.icon
  const awaitingVerification = task.verification_status === 'pending' || task.scheduler_state === 'awaiting_verify'
  const assigned = assignedLabel || task.assigned_name || task.assigned_agent_id
  return (
    <article className={`mobile-game-task-card is-${meta.tone}`}>
      <button type="button" className="mobile-game-task-card-main" onClick={() => onOpen(task)}>
        <span className="mobile-game-task-gem"><Icon /></span>
        <span className="mobile-game-task-card-copy">
          <strong>{task.title}</strong>
          <span>
            {assigned ? `@${assigned}` : '未指派'}
            {task.due_at ? ` · ${formatShortDate(task.due_at)}` : ''}
          </span>
        </span>
      </button>
      <div className="mobile-game-task-card-badges">
        <Badge>{meta.label}</Badge>
        {task.scheduler_state === 'pending_deps' && <Badge variant="outline">等依赖</Badge>}
        {awaitingVerification && <Badge variant="warning">待验收</Badge>}
        {task.failure_code && <Badge variant="destructive">{task.failure_code}</Badge>}
        {task.depends_on_task_ids && task.depends_on_task_ids.length > 0 && <Badge variant="outline">连锁 {task.depends_on_task_ids.length}</Badge>}
      </div>
      <button type="button" className="mobile-game-task-delete" title="删除" onClick={() => onDelete(task)}>
        <Trash2 />
      </button>
    </article>
  )
}

function CalendarBoard({
  month,
  selectedDate,
  events,
  selectedEvents,
  onSelectDate,
  onPreviousMonth,
  onNextMonth,
  onOpenEvent,
}: {
  month: Date
  selectedDate: Date
  events: CalendarEvent[]
  selectedEvents: CalendarEvent[]
  onSelectDate: (date: Date) => void
  onPreviousMonth: () => void
  onNextMonth: () => void
  onOpenEvent: (event: CalendarEvent) => void
}) {
  const range = getCalendarRange(month)
  return (
    <div className="mobile-game-task-calendar">
      <div className="mobile-game-task-calendar-head">
        <Button size="icon-sm" variant="ghost" title="上个月" onClick={onPreviousMonth}><ChevronLeft /></Button>
        <strong>{month.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}</strong>
        <Button size="icon-sm" variant="ghost" title="下个月" onClick={onNextMonth}><ChevronRight /></Button>
      </div>
      <div className="mobile-game-task-calendar-grid">
        {WEEKDAYS.map((day) => <div key={day} className="mobile-game-task-weekday">{day}</div>)}
        {range.days.map((date) => {
          const dayEvents = events.filter((event) => isSameLocalDay(new Date(event.start_at), date))
          const inMonth = date.getMonth() === month.getMonth()
          const selected = isSameLocalDay(date, selectedDate)
          return (
            <button key={date.toISOString()} type="button" className={cn('mobile-game-task-day', !inMonth && 'is-muted', selected && 'is-selected')} onClick={() => onSelectDate(date)}>
              <span>{date.getDate()}</span>
              {dayEvents.length > 0 && <i>{Math.min(dayEvents.length, 9)}</i>}
            </button>
          )
        })}
      </div>
      <div className="mobile-game-task-event-list">
        <div className="mobile-game-task-project-title">
          <span>{formatDayTitle(selectedDate)}</span>
          <em>{selectedEvents.length}</em>
        </div>
        {selectedEvents.length === 0 ? <PanelEmpty text="这天没有冒险安排" compact /> : selectedEvents.map((event) => (
          <button key={event.id} type="button" className="mobile-game-task-event" onClick={() => onOpenEvent(event)}>
            <CalendarClock />
            <span>
              <strong>{event.title}</strong>
              <em>{formatDateTime(event.start_at)}{event.is_recurring ? ' · 重复' : ''}</em>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ScheduleBoard({
  loading,
  schedules,
  agentNames,
  onToggle,
  onDelete,
}: {
  loading: boolean
  schedules: TaskSchedule[]
  agentNames: Map<string | undefined, string>
  onToggle: (schedule: TaskSchedule) => void
  onDelete: (schedule: TaskSchedule) => void
}) {
  if (loading) return <PanelEmpty text="巡逻队整理中..." />
  if (schedules.length === 0) return <PanelEmpty text="还没有自动巡逻任务" />
  return (
    <div className="mobile-game-task-list">
      {schedules.map((schedule) => (
        <article key={schedule.id} className="mobile-game-schedule-card">
          <span className="mobile-game-schedule-icon"><Repeat2 /></span>
          <div className="mobile-game-schedule-copy">
            <strong>{schedule.template_title || schedule.recurrence_rule || formatDateTime(schedule.run_at)}</strong>
            <span>
              {schedule.kind === 'recurring' ? '重复巡逻' : '单次巡逻'}
              {schedule.next_fire_at ? ` · ${formatDateTime(schedule.next_fire_at)}` : ''}
              {schedule.assigned_agent_id ? ` · @${agentNames.get(schedule.assigned_agent_id) || schedule.assigned_agent_id}` : ''}
            </span>
          </div>
          <button type="button" className="mobile-game-task-mini-action" title={schedule.enabled ? '停用' : '启用'} onClick={() => onToggle(schedule)}>
            {schedule.enabled ? <PauseCircle /> : <PlayCircle />}
          </button>
          <button type="button" className="mobile-game-task-mini-action" title="删除" onClick={() => onDelete(schedule)}>
            <Trash2 />
          </button>
        </article>
      ))}
    </div>
  )
}

function PanelEmpty({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div className={cn('mobile-game-task-panel-empty', compact && 'is-compact')}>
      <TaskMascot />
      <strong>{text}</strong>
    </div>
  )
}

function TaskMascot() {
  return (
    <svg viewBox="0 0 88 78" className="mobile-game-task-mascot" aria-hidden>
      <path d="M18 41c0-20 12-32 27-32s27 12 27 32c0 17-11 29-27 29S18 58 18 41Z" fill="#fff16a" stroke="#5f3b93" strokeWidth="5" />
      <path d="M25 20 14 9l-2 18M62 20 75 8l1 20" fill="#ff8ab3" stroke="#5f3b93" strokeWidth="5" strokeLinejoin="round" />
      <circle cx="35" cy="39" r="4" fill="#5f3b93" />
      <circle cx="53" cy="39" r="4" fill="#5f3b93" />
      <path d="M36 52c5 4 12 4 17 0" fill="none" stroke="#5f3b93" strokeWidth="4" strokeLinecap="round" />
      <path d="M66 52h13M9 52h13" stroke="#5f3b93" strokeWidth="5" strokeLinecap="round" />
    </svg>
  )
}

function getCalendarRange(month: Date) {
  const first = startOfMonth(month)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
  const gridStart = startOfDay(new Date(first))
  gridStart.setDate(first.getDate() - ((first.getDay() + 6) % 7))
  const gridEnd = startOfDay(new Date(last))
  gridEnd.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7)))
  const days: Date[] = []
  for (const cursor = new Date(gridStart); cursor < gridEnd; cursor.setDate(cursor.getDate() + 1)) {
    days.push(new Date(cursor))
  }
  return { gridStart, gridEnd, days }
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1)
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function formatShortDate(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

function formatDayTitle(value: Date) {
  return value.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
}

function formatDateTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
