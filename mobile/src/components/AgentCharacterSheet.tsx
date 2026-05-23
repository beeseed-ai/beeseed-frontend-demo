import { useEffect, useMemo, useState } from 'react'
import { Brain, Hammer, HeartHandshake, Sparkles, Star, WandSparkles, X, Zap } from 'lucide-react'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  cn,
  useBeeSeedContext,
  type ChannelMemberInfo,
} from '@beeseed/beeseed-sdk'
import { resolveAgentSkillSummaries, type AgentSkillSummary } from '../agent-skill-catalog'

interface Props {
  open: boolean
  channelId: string | null
  member: ChannelMemberInfo | null
  onClose: () => void
}

interface AgentIdentityForm {
  name?: string
  personality?: string
  content?: string
}

interface AgentConfigForm {
  role?: string
  model_tier?: string
  skills?: unknown[]
  identity?: Partial<AgentIdentityForm>
  avatar_preset?: string
}

interface SkillCatalogItem {
  name?: string
  id?: string
  display_name?: string
  displayName?: string
  description?: string
  version?: string
}

const SLOT_COUNT = 5

export function AgentCharacterSheet({ open, channelId, member, onClose }: Props) {
  const { api } = useBeeSeedContext()
  const [identity, setIdentity] = useState<AgentIdentityForm | null>(null)
  const [config, setConfig] = useState<AgentConfigForm | null>(null)
  const [skills, setSkills] = useState<AgentSkillSummary[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !channelId || !member?.agent_id) return
    let cancelled = false
    setLoading(true)
    setIdentity(null)
    setConfig(null)
    setSkills([])

    async function load() {
      const agentId = member?.agent_id
      if (!agentId) return
      try {
        const [identityData, channelConfig, templateConfig, skillCatalog] = await Promise.all([
          api.get(`channels/${channelId}/agents/${agentId}/identity`).json<AgentIdentityForm>().catch(() => null),
          api.get(`channels/${channelId}/agents/${agentId}/config`).json<AgentConfigForm>().catch(() => null),
          api.get(`admin/agent-templates/${agentId}/config`).json<unknown>().catch(() => null),
          api.get('admin/skills').json<SkillCatalogItem[]>().catch(() => []),
        ])
        if (cancelled) return
        const resolvedIdentity = identityData ?? {
          name: member?.display_name || agentId,
          personality: '',
          content: '',
        }
        const channelSkills = resolveAgentSkillSummaries(channelConfig, skillCatalog)
        const templateSkills = resolveAgentSkillSummaries(templateConfig, skillCatalog)
        setIdentity(resolvedIdentity)
        setConfig(channelConfig)
        setSkills(mergeSkills(channelSkills, templateSkills).slice(0, SLOT_COUNT))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [api, channelId, member, open])

  const agentName = identity?.name || member?.display_name || member?.agent_id || 'Agent'
  const personality = identity?.personality || config?.identity?.personality || '稳健、可靠、随时待命'
  const role = config?.role || member?.agent_id || 'adventurer'
  const seed = stableHash(`${member?.agent_id || agentName}:${skills.map((skill) => skill.name).join('|')}`)
  const attributes = useMemo(() => buildAttributes(seed, skills.length, member?.is_coordinator), [member?.is_coordinator, seed, skills.length])
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) => skills[index] ?? null)

  if (!open || !member) return null

  return (
    <div className="mobile-game-agent-sheet-backdrop" role="dialog" aria-modal="true" aria-label="Agent 角色详情">
      <button type="button" className="mobile-game-agent-sheet-scrim" aria-label="关闭 Agent 详情" onClick={onClose} />
      <section className="mobile-game-agent-card">
        <div className="mobile-game-agent-card-head">
          <div className="min-w-0">
            <div className="mobile-game-agent-rank">SSR Agent</div>
            <h2>{agentName}</h2>
            <p>{role}</p>
          </div>
          <button type="button" className="mobile-game-agent-close" aria-label="关闭" onClick={onClose}>
            <X />
          </button>
        </div>

        {loading ? (
          <div className="mobile-game-agent-loading">角色资料读取中...</div>
        ) : (
          <>
            <div className="mobile-game-agent-stage">
              <div className="mobile-game-agent-slots" aria-label="技能装备槽">
                {slots.map((skill, index) => (
                  <EquipmentSlot key={skill?.name || `empty-${index}`} skill={skill} index={index} />
                ))}
              </div>
              <div className="mobile-game-agent-portrait-wrap">
                <AgentPortrait member={member} name={agentName} seed={seed} />
              </div>
            </div>

            <div className="mobile-game-agent-personality">
              <Sparkles />
              <span>{personality}</span>
            </div>

            <div className="mobile-game-agent-attrs">
              {attributes.map((attribute) => (
                <div key={attribute.label} className="mobile-game-agent-attr">
                  <div className="mobile-game-agent-attr-label">
                    <attribute.icon />
                    <span>{attribute.label}</span>
                    <strong>{attribute.value}</strong>
                  </div>
                  <div className="mobile-game-agent-attr-bar">
                    <i style={{ width: `${attribute.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function EquipmentSlot({ skill, index }: { skill: AgentSkillSummary | null; index: number }) {
  return (
    <div className={cn('mobile-game-agent-slot', !skill && 'is-empty')} title={skill?.description || '空装备槽'}>
      <div className={`mobile-game-skill-icon is-${skillTone(skill?.name || String(index))}`}>
        {skill && (
          <img
            src={skill.icon_url || `/skill-icons/${encodeURIComponent(skill.name)}.png`}
            alt=""
            onError={(event) => {
              event.currentTarget.hidden = true
            }}
          />
        )}
        {skill ? <SkillGlyph name={skill.name} /> : <Star />}
      </div>
      <div className="mobile-game-agent-slot-copy">
        <strong>{skill?.display_name || '空槽'}</strong>
        <span>{skill ? `Lv ${skill.version || '1.0'}` : '待装备技能'}</span>
      </div>
    </div>
  )
}

function AgentPortrait({ member, name, seed }: { member: ChannelMemberInfo; name: string; seed: number }) {
  const robe = ['#7c5cff', '#ff7eb3', '#25d366', '#ff9f1c'][seed % 4]
  const accent = ['#fff16a', '#7ee7ff', '#ffca3a', '#9cff6e'][seed % 4]

  return (
    <div className="mobile-game-agent-portrait">
      <svg viewBox="0 0 190 260" aria-hidden>
        <path d="M35 235c8-44 31-74 60-74s52 30 60 74H35Z" fill={robe} stroke="#5f3b93" strokeWidth="8" />
        <path d="M57 192c18 13 58 13 76 0l12 43H45l12-43Z" fill={accent} stroke="#5f3b93" strokeWidth="7" />
        <path d="M62 76c0-29 19-50 35-50s35 21 35 50v25c0 31-17 51-35 51s-35-20-35-51V76Z" fill="#fff7cf" stroke="#5f3b93" strokeWidth="8" />
        <path d="M58 79c8-35 29-51 53-42 21 8 31 25 29 51-24-3-48-13-62-31-6 8-12 15-20 22Z" fill="#ff8ab3" stroke="#5f3b93" strokeWidth="7" strokeLinejoin="round" />
        <circle cx="83" cy="103" r="5" fill="#5f3b93" />
        <circle cx="111" cy="103" r="5" fill="#5f3b93" />
        <path d="M85 125c8 6 17 6 25 0" fill="none" stroke="#5f3b93" strokeWidth="6" strokeLinecap="round" />
        <path d="M35 166 16 204M155 166l19 38" fill="none" stroke="#5f3b93" strokeWidth="9" strokeLinecap="round" />
        <path d="M73 26 61 9M121 28l15-16" fill="none" stroke="#5f3b93" strokeWidth="7" strokeLinecap="round" />
      </svg>
      <Avatar className="mobile-game-agent-portrait-avatar">
        {member.avatar_url ? <AvatarImage src={member.avatar_url} /> : null}
        <AvatarFallback>{name[0] || 'A'}</AvatarFallback>
      </Avatar>
    </div>
  )
}

function SkillGlyph({ name }: { name: string }) {
  const lower = name.toLowerCase()
  if (/search|采集|review|lit/.test(lower)) return <Brain />
  if (/image|media|video|audio|ppt|generate/.test(lower)) return <WandSparkles />
  if (/pdf|xlsx|excel|doc|paper|writer/.test(lower)) return <Hammer />
  if (/cross|validation|fact|check|research/.test(lower)) return <Zap />
  return <Sparkles />
}

function skillTone(name: string) {
  return ['pink', 'blue', 'green', 'amber', 'violet'][stableHash(name) % 5]
}

function mergeSkills(primary: AgentSkillSummary[], secondary: AgentSkillSummary[]) {
  const byName = new Map<string, AgentSkillSummary>()
  for (const skill of [...primary, ...secondary]) {
    if (!byName.has(skill.name)) byName.set(skill.name, skill)
  }
  return [...byName.values()]
}

function buildAttributes(seed: number, skillCount: number, coordinator?: boolean) {
  const base = 58 + Math.min(skillCount, SLOT_COUNT) * 5
  return [
    { label: '智略', value: clamp(base + (seed % 17)), icon: Brain },
    { label: '行动', value: clamp(base + ((seed >> 3) % 19)), icon: Zap },
    { label: '协作', value: clamp(base + (coordinator ? 18 : 4)), icon: HeartHandshake },
    { label: '创造', value: clamp(base + ((seed >> 5) % 21)), icon: WandSparkles },
  ]
}

function clamp(value: number) {
  return Math.max(12, Math.min(99, value))
}

function stableHash(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}
