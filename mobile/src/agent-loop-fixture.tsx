import {
  Avatar,
  AvatarFallback,
  type AgentLoopState,
  type ChatMessage,
} from '@beeseed/beeseed-sdk'
import { RuntimeAgentRunTranscript } from './runtime-agent-run-transcript'

const startedAt = Date.parse('2026-05-19T12:00:00+08:00')

const finalMessage: ChatMessage = {
  role: 'assistant',
  content: 'AgentLoop 已经按事件时间线完成展示：过程记录和最终回答在同一条 Agent 轨迹里。',
  timestamp: startedAt + 12_400,
  msgId: 9001,
  senderId: 'agent-dev-fixture',
  senderType: 'agent',
  agentRunId: 'run-dev-fixture',
}

const fixtureLoop: AgentLoopState = {
  runId: 'run-dev-fixture',
  agentId: 'agent-dev-fixture',
  channelId: 'channel-dev-fixture',
  status: 'completed',
  currentTurn: 2,
  startedAt,
  completedAt: startedAt + 12_400,
  finalContent: finalMessage.content,
  todos: [
    {
      id: 'todo-1',
      title: '检查 AgentLoop 展示入口',
      status: 'completed',
      seq: 1,
      evidence: '标准模板已接入 AgentRunTranscript',
      completed_at: '2026-05-19T12:00:03+08:00',
    },
    {
      id: 'todo-2',
      title: '验证工具调用和结果按事件顺序出现',
      status: 'completed',
      seq: 2,
      evidence: 'tool_call 与 tool_result 使用 tool_call_id 关联',
      completed_at: '2026-05-19T12:00:10+08:00',
    },
  ],
  turns: [
    {
      turnNumber: 1,
      toolCalls: [
        {
          id: 'tool-1',
          toolCallId: 'call-search',
          seq: 5,
          name: 'code_search',
          args: { query: 'AgentRunTranscript AgentLoop events' },
          status: 'success',
          output: '找到 MessageList、StreamRenderer、AgentRunTranscript 三个展示入口。',
          startedAt: startedAt + 4_100,
          completedAt: startedAt + 5_800,
        },
      ],
      skillUses: [
        {
          id: 'skill-1',
          seq: 4,
          name: 'equity-cross-validation',
          displayName: '6种交叉验证',
          status: 'injected',
          reason: '用户显式选择了该技能',
          startedAt: startedAt + 3_200,
        },
      ],
      content: '我会先检查时间线组件，然后验证历史恢复路径是否仍然一致。',
      progress: '已完成展示入口检查，继续验证工具结果归位。',
      status: 'completed',
      startedAt,
      completedAt: startedAt + 6_200,
    },
    {
      turnNumber: 2,
      toolCalls: [
        {
          id: 'tool-2',
          toolCallId: 'call-build',
          seq: 8,
          name: 'shell_command',
          args: { cmd: 'npm run build' },
          status: 'success',
          output: 'vite build completed. Large chunk warning is non-blocking.',
          startedAt: startedAt + 8_100,
          completedAt: startedAt + 10_900,
        },
      ],
      skillUses: [],
      content: '我已经确认实时事件和历史恢复都会进入同一条轨迹。',
      progress: '构建通过，准备输出最终结果。',
      status: 'completed',
      startedAt: startedAt + 6_300,
      completedAt: startedAt + 12_400,
    },
  ],
  events: [
    {
      id: 'event-1',
      seq: 1,
      type: 'progress',
      turnNumber: 1,
      timestamp: startedAt + 200,
      summary: '我先确认 AgentLoop 前端展示结构。',
    },
    {
      id: 'event-2',
      seq: 2,
      type: 'assistant_content',
      turnNumber: 1,
      timestamp: startedAt + 1_100,
      content: '我会先检查时间线组件，然后验证历史恢复路径是否仍然一致。',
    },
    {
      id: 'event-3',
      seq: 3,
      type: 'progress',
      turnNumber: 1,
      timestamp: startedAt + 2_400,
      summary: '检测到用户选择了技能，先启用后再继续执行。',
    },
    {
      id: 'event-4',
      seq: 4,
      type: 'skill_use',
      turnNumber: 1,
      timestamp: startedAt + 3_200,
      skill: {
        id: 'skill-1',
        seq: 4,
        name: 'equity-cross-validation',
        displayName: '6种交叉验证',
        status: 'injected',
        reason: '用户显式选择了该技能',
        startedAt: startedAt + 3_200,
      },
    },
    {
      id: 'event-5',
      seq: 5,
      type: 'tool_call',
      turnNumber: 1,
      timestamp: startedAt + 4_100,
      tool: {
        id: 'tool-1',
        toolCallId: 'call-search',
        seq: 5,
        name: 'code_search',
        args: { query: 'AgentRunTranscript AgentLoop events' },
        status: 'calling',
        startedAt: startedAt + 4_100,
      },
    },
    {
      id: 'event-6',
      seq: 6,
      type: 'tool_result',
      turnNumber: 1,
      timestamp: startedAt + 5_800,
      tool: {
        id: 'tool-1',
        toolCallId: 'call-search',
        seq: 5,
        name: 'code_search',
        args: { query: 'AgentRunTranscript AgentLoop events' },
        status: 'success',
        output: '找到 MessageList、StreamRenderer、AgentRunTranscript 三个展示入口。',
        startedAt: startedAt + 4_100,
        completedAt: startedAt + 5_800,
      },
    },
    {
      id: 'event-7',
      seq: 7,
      type: 'assistant_content',
      turnNumber: 2,
      timestamp: startedAt + 7_200,
      content: '我已经确认实时事件和历史恢复都会进入同一条轨迹。',
    },
    {
      id: 'event-8',
      seq: 8,
      type: 'tool_call',
      turnNumber: 2,
      timestamp: startedAt + 8_100,
      tool: {
        id: 'tool-2',
        toolCallId: 'call-build',
        seq: 8,
        name: 'shell_command',
        args: { cmd: 'npm run build' },
        status: 'calling',
        startedAt: startedAt + 8_100,
      },
    },
    {
      id: 'event-9',
      seq: 9,
      type: 'tool_result',
      turnNumber: 2,
      timestamp: startedAt + 10_900,
      tool: {
        id: 'tool-2',
        toolCallId: 'call-build',
        seq: 8,
        name: 'shell_command',
        args: { cmd: 'npm run build' },
        status: 'success',
        output: 'vite build completed. Large chunk warning is non-blocking.',
        startedAt: startedAt + 8_100,
        completedAt: startedAt + 10_900,
      },
    },
    {
      id: 'event-10',
      seq: 10,
      type: 'progress',
      turnNumber: 2,
      timestamp: startedAt + 11_500,
      summary: '构建通过，准备输出最终结果。',
    },
  ],
}

const runningLoopStartedAt = startedAt + 20_000

const runningLoop: AgentLoopState = {
  runId: 'run-dev-running',
  agentId: 'agent-dev-fixture',
  channelId: 'channel-dev-fixture',
  status: 'running',
  currentTurn: 2,
  startedAt: runningLoopStartedAt,
  turns: [
    {
      turnNumber: 1,
      toolCalls: [
        {
          id: 'tool-running-1',
          toolCallId: 'call-weather',
          seq: 4,
          name: 'weather_lookup',
          args: { city: '上海' },
          status: 'success',
          output: '已获取上海今日天气摘要。',
          startedAt: runningLoopStartedAt + 2_500,
          completedAt: runningLoopStartedAt + 3_800,
        },
      ],
      skillUses: [],
      content: '我会先查询天气，再整理成简短结论。',
      progress: '天气数据已返回，继续整理结果。',
      status: 'completed',
      startedAt: runningLoopStartedAt,
      completedAt: runningLoopStartedAt + 4_100,
    },
    {
      turnNumber: 2,
      toolCalls: [
        {
          id: 'tool-running-2',
          toolCallId: 'call-forecast',
          seq: 8,
          name: 'weather_forecast',
          args: { city: '上海', days: 3 },
          status: 'calling',
          startedAt: runningLoopStartedAt + 6_200,
        },
      ],
      skillUses: [],
      progress: '正在查询未来三天天气预报。',
      status: 'active',
      startedAt: runningLoopStartedAt + 5_900,
    },
  ],
  events: [
    {
      id: 'event-running-1',
      seq: 1,
      type: 'progress',
      turnNumber: 1,
      timestamp: runningLoopStartedAt + 200,
      summary: '我先查询当前天气，再继续看未来趋势。',
    },
    {
      id: 'event-running-2',
      seq: 4,
      type: 'tool_result',
      turnNumber: 1,
      timestamp: runningLoopStartedAt + 3_800,
      tool: {
        id: 'tool-running-1',
        toolCallId: 'call-weather',
        seq: 4,
        name: 'weather_lookup',
        args: { city: '上海' },
        status: 'success',
        output: '已获取上海今日天气摘要。',
        startedAt: runningLoopStartedAt + 2_500,
        completedAt: runningLoopStartedAt + 3_800,
      },
    },
    {
      id: 'event-running-3',
      seq: 8,
      type: 'tool_call',
      turnNumber: 2,
      timestamp: runningLoopStartedAt + 6_200,
      tool: {
        id: 'tool-running-2',
        toolCallId: 'call-forecast',
        seq: 8,
        name: 'weather_forecast',
        args: { city: '上海', days: 3 },
        status: 'calling',
        startedAt: runningLoopStartedAt + 6_200,
      },
    },
  ],
}

const inferredFinalMessage: ChatMessage = {
  ...finalMessage,
  content: '即使历史恢复缺少 loop.completedAt，也会用最终消息时间推算出本次耗时。',
  timestamp: startedAt + 33_700,
  msgId: 9002,
  agentRunId: 'run-dev-inferred-duration',
}

const inferredDurationLoop: AgentLoopState = {
  runId: 'run-dev-inferred-duration',
  agentId: 'agent-dev-fixture',
  channelId: 'channel-dev-fixture',
  status: 'completed',
  currentTurn: 1,
  startedAt: startedAt + 25_000,
  finalContent: inferredFinalMessage.content,
  turns: [
    {
      turnNumber: 1,
      toolCalls: [],
      skillUses: [],
      content: inferredFinalMessage.content,
      progress: '最终回复已生成。',
      status: 'completed',
      startedAt: startedAt + 25_000,
    },
  ],
  events: [
    {
      id: 'event-inferred-1',
      seq: 1,
      type: 'progress',
      turnNumber: 1,
      timestamp: startedAt + 25_300,
      summary: '开始恢复历史执行记录。',
    },
  ],
}

export function AgentLoopFixturePage() {
  return (
    <div className="min-h-screen bg-[#f8fafc] px-4 py-8 text-[#181d26]" data-agent-loop-fixture="true">
      <main className="mx-auto max-w-3xl">
        <div className="mb-6">
          <div className="text-xs font-medium uppercase tracking-normal text-[#777169]">AgentLoop fixture</div>
          <h1 className="mt-2 text-2xl font-medium leading-tight tracking-normal text-[#181d26]">事件级 Agent 轨迹</h1>
        </div>

        <section className="rounded-md border border-[#dddddd] bg-white px-4 py-4 shadow-sm">
          <div className="flex gap-2.5">
            <Avatar className="mt-0.5 size-9 shrink-0">
              <AvatarFallback className="text-xs">AI</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-[#777169]">AI 助手</div>
              <RuntimeAgentRunTranscript loop={fixtureLoop} finalMessage={finalMessage} />
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-md border border-[#dddddd] bg-white px-4 py-4 shadow-sm">
          <div className="flex gap-2.5">
            <Avatar className="mt-0.5 size-9 shrink-0">
              <AvatarFallback className="text-xs">AI</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-[#777169]">运行中默认折叠</div>
              <RuntimeAgentRunTranscript loop={runningLoop} />
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-md border border-[#dddddd] bg-white px-4 py-4 shadow-sm">
          <div className="flex gap-2.5">
            <Avatar className="mt-0.5 size-9 shrink-0">
              <AvatarFallback className="text-xs">AI</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-[#777169]">完成耗时回退</div>
              <RuntimeAgentRunTranscript loop={inferredDurationLoop} finalMessage={inferredFinalMessage} />
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
