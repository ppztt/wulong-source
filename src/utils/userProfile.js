// 用户记账习惯画像
//
// 两个目的：
//   1. 把「他习惯怎么说、习惯用哪个账户」喂给模型，提高识别准确率
//   2. 让 system prompt 的内容当天固定下来，从而稳定命中 DeepSeek 的上下文缓存
//
// 之所以按天冻结：缓存是前缀匹配，画像若在每次记账后重算，
// system prompt 就会逐条变化，当天所有请求都无法命中缓存。

import { getTransactions, getAccounts } from '../db'
import { todayStr } from './finance'

const STORAGE_KEY = 'bk_ai_habits'

// 同一个说法至少出现这么多次，才敢当成习惯
const MIN_PATTERN_HITS = 3
// 且要占该说法的绝大多数用法；比例低说明它对应多个账户，学不准
const MIN_PATTERN_RATIO = 0.7
// 参与学习的最短 / 最长说法，太短容易撞车，太长没有复用价值
const MIN_KEY_LEN = 2
const MAX_KEY_LEN = 8
// 提示词里最多收录多少条说法映射，避免尾部无限膨胀
const MAX_PATTERNS = 12
const TOP_ACCOUNTS = 4
const TOP_CATEGORIES = 6

/**
 * 从交易里抽一个「说法」作为学习用的 key
 * 优先用商家，其次用备注第一段；纯数字、过长过短的一律不学
 */
export function patternKeyOf(t) {
  const raw = String(t?.merchant || t?.note || '').trim()
  if (!raw) return ''
  const first = raw.split(/[\s,，、;；/|]+/)[0].trim()
  if (first.length < MIN_KEY_LEN || first.length > MAX_KEY_LEN) return ''
  // 去掉纯金额、纯标点这类没有语义的串
  if (!/[\u4e00-\u9fa5a-zA-Z]/.test(first)) return ''
  return first
}

/**
 * 纯统计：不给存储、不发网络，便于单测
 * @returns {{
 *   total: number,
 *   accounts: Array<{id:number,name:string,count:number}>,
 *   categories: Array<{id:number,name:string,count:number}>,
 *   patterns: Array<{key:string,accountId:number,accountName:string,count:number,total:number}>
 * }}
 */
export function computeHabits(transactions = [], accounts = []) {
  const accById = new Map(accounts.map(a => [Number(a.id), a]))
  const accCount = new Map()
  const catCount = new Map()
  // key -> Map(accountId -> 次数)
  const patternMap = new Map()
  let total = 0

  for (const t of transactions) {
    // 自动生成的收益账单每天一条，会把计息账户刷成最常用，必须排除
    if (t?.auto_source) continue
    total++

    const accId = t?.account_id == null ? null : Number(t.account_id)
    const acc = accId == null ? null : accById.get(accId)
    if (acc) accCount.set(accId, (accCount.get(accId) || 0) + 1)

    const catId = t?.category_id == null ? null : Number(t.category_id)
    if (catId && t?.category_name) {
      const cur = catCount.get(catId) || { id: catId, name: t.category_name, count: 0 }
      cur.count++
      catCount.set(catId, cur)
    }

    // 说法映射只学「有明确账户」的支出，转账牵涉两个账户，容易学歪
    if (!acc || t?.type === 'transfer') continue
    const key = patternKeyOf(t)
    if (!key) continue
    const inner = patternMap.get(key) || new Map()
    inner.set(accId, (inner.get(accId) || 0) + 1)
    patternMap.set(key, inner)
  }

  // 排序必须完全确定：次数降序、同次数按 id 升序
  // 否则同样的数据每次生成顺序不同，system prompt 就会抖动，缓存全废
  const rankByCount = (a, b) => (b.count - a.count) || (a.id - b.id)

  const accList = [...accCount.entries()]
    .map(([id, count]) => ({ id, name: accById.get(id).name, count }))
    .sort(rankByCount)
    .slice(0, TOP_ACCOUNTS)

  const catList = [...catCount.values()]
    .sort(rankByCount)
    .slice(0, TOP_CATEGORIES)

  const patterns = []
  for (const [key, inner] of patternMap) {
    const sorted = [...inner.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
    const sum = sorted.reduce((s, [, c]) => s + c, 0)
    const [topId, topCount] = sorted[0]
    if (topCount < MIN_PATTERN_HITS) continue
    if (topCount / sum < MIN_PATTERN_RATIO) continue
    const acc = accById.get(topId)
    if (!acc) continue
    patterns.push({ key, accountId: topId, accountName: acc.name, count: topCount, total: sum })
  }
  patterns.sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key))

  return {
    total,
    accounts: accList,
    categories: catList,
    patterns: patterns.slice(0, MAX_PATTERNS)
  }
}

/**
 * 把画像渲染成提示词片段
 * 空画像返回空字符串，调用方可以直接拼进提示词而不必判断
 */
export function formatHabits(habits) {
  if (!habits || !habits.accounts.length) return ''

  const lines = []
  const names = habits.accounts.map(a => `${a.name}(${a.count}笔)`)
  lines.push(`- 常用账户：${names.join(' > ')}`)

  const top = habits.accounts[0]
  if (top) lines.push(`- 默认账户：${top.name}（用户没提到账户时优先考虑它）`)

  if (habits.categories.length) {
    const cats = habits.categories.map(c => `${c.name}(${c.count})`)
    lines.push(`- 常用分类：${cats.join('、')}`)
  }

  if (habits.patterns.length) {
    // 只列说法本身，不写次数：说法映射的次数分布很零散，
    // 写进去收益不大，反而让每天重算后的文本更容易抖
    const map = habits.patterns.map(p => `${p.key}→${p.accountName}`)
    lines.push(`- 用户惯用说法：${map.join('、')}`)
    lines.push('  这些说法在历史记录里几乎固定对应同一个账户，遇到时可直接采用')
  }

  return lines.join('\n')
}

// ========== 带缓存的读取 ==========

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  } catch {
    return null
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 存储满或不可用时静默跳过：画像只是优化项，不影响主流程
  }
}

/**
 * 取当天的画像
 * 缓存里若已有今天的版本就直接用，保证同一天内 system prompt 恒定
 * @param {boolean} force 主动要求重算（用户新记了账、想立刻生效时用）
 */
export async function getHabits({ force = false } = {}) {
  const today = todayStr()
  const cached = readCache()
  if (!force && cached && cached.date === today && cached.habits) {
    return cached.habits
  }

  const [transactions, accounts] = await Promise.all([getTransactions(), getAccounts()])
  const habits = computeHabits(transactions, accounts)
  writeCache({ date: today, habits })
  return habits
}

/**
 * 直接把画像拼成提示词可用的文本，读缓存同样按天
 */
export async function loadHabitPrompt({ force = false } = {}) {
  const habits = await getHabits({ force })
  return formatHabits(habits)
}

export function clearHabitCache() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
