export interface AgentSkillSummary {
  name: string
  display_name: string
  description: string
  version: string
  icon_url?: string
}

interface AgentSkillCatalogItem {
  name?: string
  id?: string
  display_name?: string
  displayName?: string
  description?: string
  version?: string
  icon_url?: string
}

const SKILL_CATALOG: Record<string, Omit<AgentSkillSummary, 'name'>> = {
  'ai-search-api': {
    display_name: 'AI 聚合搜索',
    description: '多平台聚合搜索工具（API 版）。通过 Brave Search、Exa.ai 和 ScrapeCreators 三个 API 实现跨平台信息聚合，支持网页、新闻、社交媒体、学术论文搜索。',
    version: '1.0.0',
  },
  'equity-7d-collection': {
    display_name: '7维度信息采集',
    description: '股票研究 7 维度系统性信息采集框架。覆盖公司基本面、行业、宏观、估值、情绪资金面、治理事件、替代数据，每条信息标注来源/时效/置信度/三标签。',
    version: '1.0.2',
  },
  'equity-cross-validation': {
    display_name: '6种交叉验证',
    description: '股票研究交叉验证框架。对 7 维度采集的信息执行三角验证、逻辑链条、预期差挖掘、背离识别、多空辩论、历史类比 6 种交叉解读方法，输出验证结论。',
    version: '1.0.2',
  },
  'equity-research-brief': {
    display_name: '研究简报生成',
    description: '将 7 维度采集 + 交叉验证结果整合为 5 层结构研究简报（事实层→信息层→逻辑层→估值层→信息溯源），标准化输出格式，确保每条结论可溯源。',
    version: '1.0.2',
  },
  'med-lit-review': {
    display_name: '医学文献阅读助手',
    description: '医学文献阅读与系统综述专家技能。覆盖PubMed检索策略构建、快速文献解读框架、质量评估工具（Cochrane ROB/NOS）、系统综述流程（PRISMA）、文献知识图谱梳理。帮助用户高效读懂文献、系统组织证据。',
    version: '1.0.1',
  },
  'med-paper-writer': {
    display_name: '医学论文写作助手',
    description: '医学 SCI 论文写作全流程专家技能。覆盖 IMRaD 各部分写作指导、结构化摘要、统计结果规范表述、图表设计规范、CONSORT/STROBE/PRISMA 合规检查、Cover Letter、期刊选择、审稿意见回复策略。帮助用户从「有数据」到「发表论文」。',
    version: '1.0.1',
  },
  'med-research-writer': {
    display_name: 'SCI 医学写作顾问',
    description: 'SCI 医学论文写作全流程工具。覆盖 IMRaD 结构写作、审稿人视角预演、审稿意见回复、期刊选择策略。基于 CONSORT/STROBE/PRISMA 等报告规范，帮助科研人员从「有数据」到「发表」。',
    version: '1.0.0',
  },
  'med-study-design': {
    display_name: '医学研究方案设计助手',
    description: '医学科研方案设计专家技能。覆盖研究类型选择、研究方案结构化输出、样本量计算逻辑、纳入排除标准制定、技术路线图设计、质控与偏倚控制。帮助用户将研究问题转化为可执行、方法学严谨的研究方案。',
    version: '1.0.1',
  },
  'med-topic-finder': {
    display_name: '医学科研选题助手',
    description: '医学科研选题与创新挖掘专家技能。覆盖热点分析、研究空白识别、PICO框架凝练、可行性评估、创新范式推荐。帮助用户找到有价值、可执行、有创新性的医学科研选题。',
    version: '1.0.2',
  },
  'media-generate': {
    display_name: 'AI 图片/视频/音频生成',
    description: '生成图片、视频和音乐。支持文生图、图生图、文生视频、图生视频、参考图生视频、视频编辑、文生音乐。结果自动发送到会话，无需等待。',
    version: '1.1.1',
  },
  'moxibustion-advisor': {
    display_name: '辨证施灸顾问',
    description: '辨证施灸决策支持工具。提供阴阳寒热辨证→取穴→灸法→灸量的完整决策流程，含禁忌表、常见病症灸法方案、穴位选取原则，附古籍依据。',
    version: '1.1.2',
  },
  'moxibustion-classics': {
    display_name: '艾灸古籍知识库',
    description: '艾灸与中医古籍核心知识库。提供从马王堆帛书到《针灸大成》的原文摘录、版本说明、历代医家论灸要点，供古籍考证与辨证施灸参考。',
    version: '1.1.2',
  },
  pdf: {
    display_name: 'PDF 处理助手',
    description: 'PDF 文件处理技能，支持读取、提取文本和表格、合并、拆分、旋转、水印、创建、表单填写、加解密、图片提取和扫描件 OCR。',
    version: '1.0.0',
  },
  pptx: {
    display_name: 'PPTX 演示文稿',
    description: '演示文稿处理技能，支持创建、读取、解析、编辑、更新、合并、拆分 PPTX 文件，并处理模板、版式、演讲者备注和评论。',
    version: '1.3.0',
  },
  'volcengine-search': {
    display_name: '火山引擎事实核查搜索',
    description: '火山引擎（豆包）Web Search API。支持网页搜索 + AI 摘要，适合新闻事实核查、数据验证、热点追踪。',
    version: '1.0.1',
  },
  xlsx: {
    display_name: 'Excel 表格助手',
    description: '电子表格处理技能，支持读取、编辑、修复、创建、转换 xlsx、xlsm、csv、tsv 文件，以及清洗和重构表格数据。',
    version: '1.0.0',
  },
  'yinyuan-skills': {
    display_name: '月老·姻缘测算',
    description: '姻缘测算技能，支持八字合婚、生肖配对、紫微夫妻宫、姻缘签诗、桃花运势、红线测算六大模式，娱乐为主理性参考。',
    version: '1.0.1',
  },
}

function uniqueSkillNames(names: string[]) {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)))
}

function cleanSkillName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function collectSkillValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (Array.isArray(item.required)) return item.required
    if (Array.isArray(item.skills)) return item.skills
  }
  return []
}

function skillSummaryFromValue(value: unknown): AgentSkillSummary | null {
  if (typeof value === 'string') {
    const name = cleanSkillName(value)
    return name ? { name, display_name: name, description: '', version: '' } : null
  }
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const name = cleanSkillName(item.name ?? item.id)
  if (!name) return null
  return {
    name,
    display_name: cleanSkillName(item.display_name ?? item.displayName) || name,
    description: cleanSkillName(item.description),
    version: cleanSkillName(item.version),
    icon_url: cleanSkillName(item.icon_url ?? item.iconUrl),
  }
}

function collectAgentSkillValues(config: unknown): unknown[] {
  if (Array.isArray(config)) return config
  if (!config || typeof config !== 'object') return []
  const objectConfig = config as Record<string, unknown>
  const values: unknown[] = []
  values.push(...collectSkillValues(objectConfig.skills))

  const capabilities = objectConfig.capabilities
  if (capabilities && typeof capabilities === 'object') {
    values.push(...collectSkillValues((capabilities as Record<string, unknown>).skills))
  }
  return values
}

export function readAgentSkillNames(config: unknown): string[] {
  return uniqueSkillNames(collectAgentSkillValues(config).flatMap((value) => {
    const summary = skillSummaryFromValue(value)
    return summary ? [summary.name] : []
  }))
}

export function readAgentSkillSummaries(config: unknown): AgentSkillSummary[] {
  const byName = new Map<string, AgentSkillSummary>()
  for (const value of collectAgentSkillValues(config)) {
    const summary = skillSummaryFromValue(value)
    if (!summary || byName.has(summary.name)) continue
    byName.set(summary.name, summary)
  }
  return [...byName.values()]
}

function catalogMetadata(catalog: AgentSkillCatalogItem[] | undefined, name: string) {
  const item = catalog?.find((entry) => entry.name === name || entry.id === name)
  const fallback = SKILL_CATALOG[name]
  return {
    display_name: item?.display_name || item?.displayName || fallback?.display_name || name,
    description: item?.description || fallback?.description || '暂无技能描述',
    version: item?.version || fallback?.version || '未标注',
    icon_url: item?.icon_url || `/skill-icons/${encodeURIComponent(name)}.png`,
  }
}

export function resolveAgentSkillSummaries(config: unknown, catalog?: AgentSkillCatalogItem[]): AgentSkillSummary[] {
  return readAgentSkillSummaries(config).map((entry) => {
    const metadata = catalogMetadata(catalog, entry.name)
    return {
      name: entry.name,
      display_name: entry.display_name && entry.display_name !== entry.name ? entry.display_name : metadata.display_name,
      description: entry.description || metadata.description,
      version: entry.version || metadata.version,
      icon_url: entry.icon_url || metadata.icon_url,
    }
  })
}

export function listKnownSkillSummaries(): AgentSkillSummary[] {
  return Object.entries(SKILL_CATALOG).map(([name, metadata]) => ({
    name,
    display_name: metadata.display_name,
    description: metadata.description,
    version: metadata.version,
    icon_url: `/skill-icons/${encodeURIComponent(name)}.png`,
  }))
}
