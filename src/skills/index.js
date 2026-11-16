// skill 注册表与路由
//
// 设计要点：基础提示词只放一行分派清单，命中某个 skill 后才发第二个请求，
// 把这个 skill 的完整规则和当前数据一起加载进去。
// 好处是记账这条主路径的 prompt 不会被预算/周期的规则稀释。

import { budgetSkill } from './budget'
import { recurringSkill } from './recurring'
import { categorySkill } from './category'
import { tagSkill } from './tag'
import { accountSkill } from './account'
import { chatComplete } from '../api/ai'
import { extractJsonItems } from '../utils/aiAssistant'
import { validateDraft, parseSkillIds } from './drafts'

export const SKILLS = [budgetSkill, recurringSkill, categorySkill, tagSkill, accountSkill]

export function getSkill(id) {
  return SKILLS.find(s => s.id === id) || null
}

// 拼进基础提示词的极简分派清单，每个 skill 只占一行
export function buildSkillRouterHint() {
  return SKILLS.map(s => `- "skill:${s.id}" ${s.routerHint}`).join('\n')
}

// 把模型返回的 intent 解析成 skill id 列表
// 一句话里可能同时涉及周期和预算，所以返回数组而不是单值
export function parseSkillIntents(intent) {
  return parseSkillIds(intent, SKILLS.map(s => s.id))
}

/**
 * 取出某个 skill 应该处理的那一段原话
 *
 * 为什么需要切分：路由命中两个 skill 时，如果两个都拿到完整原话，
 * 模型会把「每月房租1500」同时解析成周期和预算，生成一堆重复卡片。
 * 实测一次「两个周期 + 一个预算」会冒出 6 张卡。
 *
 * segments 兼容两种形态：
 *   { "skill:recurring": "...", "skill:budget": "..." }
 *   [{ skill: "recurring", text: "..." }, ...]
 * 拿不到就回退整句，保证只有一个 skill 时行为不变。
 */
export function resolveSkillText(segments, skillId, fallbackText) {
  if (segments && typeof segments === 'object') {
    if (Array.isArray(segments)) {
      const hit = segments.find(s => s && (
        s.skill === skillId || s.intent === `skill:${skillId}` || s.id === skillId
      ))
      const text = String(hit?.text || '').trim()
      if (text) return text
    } else {
      const text = String(segments[`skill:${skillId}`] || segments[skillId] || '').trim()
      if (text) return text
    }
  }
  return fallbackText
}

// 同一 skill 内完全相同的草稿只留一份，防止模型把一件事写两遍
function dedupeDrafts(drafts) {
  const seen = new Set()
  const out = []
  for (const d of drafts) {
    const key = [d.kind, d.mode, d.name, d.amount, d.category_id, d.account_id, d.to_account_id].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

/**
 * 第二阶段：加载该 skill 的上下文，单独发一次请求，得到确认卡草稿
 * 只有第一阶段的 intent 命中 skill 时才会走到这里
 *
 * 返回的 drafts 是数组：用户一句话里可能建多个同类对象（比如两个周期），
 * 每一条都对应一张独立确认卡
 */
export async function runSkill(skillId, userText, { apiKey, model, baseUrl }) {
  const skill = getSkill(skillId)
  if (!skill) throw new Error('小乌还不会这个操作')

  const ctx = await skill.loadContext()
  const res = await chatComplete({
    apiKey,
    model,
    baseUrl,
    jsonMode: true,
    // 一句话可能要建好几个对象，输出比单个操作长，留足余量避免被截断
    maxTokens: 1200,
    temperature: 0.2,
    messages: [
      { role: 'system', content: skill.buildPrompt(ctx) },
      { role: 'user', content: userText }
    ]
  })

  const items = extractJsonItems(res.content)
  if (!items.length) {
    // 把模型原话带一小段出来：否则用户只知道「没听懂」，
    // 而真正的原因可能是被 max_tokens 截断或返回了非 JSON
    const snippet = String(res.content || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    throw new Error(snippet
      ? `${skill.label}没解析出来，换个说法试试（模型原话：${snippet}）`
      : `${skill.label}没有返回内容，可能触发了限流，稍后再试`)
  }

  const drafts = dedupeDrafts(
    items
      .map(item => skill.toDraft(item, ctx))
      // 多操作时模型偶尔会补一个空对象凑数，这种没有任何金额的直接丢掉
      .filter((draft, i) => {
        if (items.length === 1) return true
        const raw = items[i] || {}
        const hasAmount = Number(raw.amount) > 0
        // 账户操作可能只给一个账户名（"把微信删了"），没金额也没 name
        const hasName = String(raw.name || raw.account || '').trim()
        return hasAmount || hasName
      })
  )

  if (!drafts.length) throw new Error(`${skill.label}没解析出有效内容，换个说法试试`)

  // usage 一并返回：调用方要把路由阶段和本次调用的缓存命中加起来展示
  return { skill, drafts, ctx, usage: res.usage }
}

// 用户点确认后执行；执行前再校验一次，防止卡片上留下非法值
export async function applySkillDraft(draft) {
  const skill = getSkill(draft?.kind)
  if (!skill) throw new Error('无法识别的操作')

  const error = validateDraft(draft)
  if (error) throw new Error(error)

  await skill.apply(draft)
  return skill
}
