// 每日收益 / 盈亏自动入账
//
// 两类账户：
//   - 货币基金账户（普通账户 + interest_code）：按「万份收益 × 当日余额」逐日算
//   - 投资账户（shares > 0）：按「份额 × 当日净值变动」逐日算
//
// 三条原则：
//   1. 幂等：以「账户 + 日期 + auto_source」判重，重复跑不会多记
//   2. 增量：首次只补最近一周，之后只补缺口，避免一开开关砸出几十条记录
//   3. 不阻塞：失败静默丢弃单账户错误，不影响其他账户与主流程

import {
  getAccounts, getTransactions, getCategories, createCategory, createTransaction, updateAccount
} from '../db'
import { fetchMoneyFundHistory, fetchFundNavHistory, isValidFundCode } from '../api/market'
import { accrueInterest, dateOf, todayStr, nextDayStr, parseDate, toDateStr } from './finance'
import { computeFundPnlRows, pickInterestRows } from './earningsMath'

// 回溯窗口：接口单页上限 60 条，45 天留足缓冲
const LOOKBACK_DAYS = 45
// 首次开启时只补这么久，避免出现几十条历史收益
const FIRST_RUN_DAYS = 7
// 自动同步一天只跑一次
const SYNC_KEY = 'bk_earn_sync_date'
// 「配好货币基金就自动入账」的一次性迁移标记
const AUTO_EARN_MIGRATED_KEY = 'bk_auto_earn_migrated'

export const AUTO_SOURCE = { INTEREST: 'interest', FUND_PNL: 'fund_pnl' }

export const AUTO_SOURCE_LABEL = {
  [AUTO_SOURCE.INTEREST]: '货币基金收益',
  [AUTO_SOURCE.FUND_PNL]: '基金盈亏'
}

function addDays(dateStr, delta) {
  const d = parseDate(dateStr)
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + delta))
}

// 哪些账户需要自动入账
export function earnAccounts(accounts) {
  return (accounts || []).filter(a => {
    if (!Number(a.auto_earn)) return false
    if (a.type === 'investment') {
      return !!a.symbol && Number(a.shares) > 0
    }
    return !!a.interest_code && isValidFundCode(a.interest_code)
  })
}

// 一次性迁移：老版本要先在账户编辑里手动打开开关才会自动入账，
// 现在改成「选了余额宝/零钱通就每天自动记一条」，这里把已经配好货币基金
// 的老账户补上开关。只跑一次：之后用户自己关掉的不会被重新打开
async function migrateAutoEarn(accounts) {
  try {
    if (localStorage.getItem(AUTO_EARN_MIGRATED_KEY) === '1') return accounts
  } catch {
    return accounts
  }

  const next = []
  let allOk = true
  for (const acc of accounts) {
    const needSwitch = acc.type === 'cash' && !Number(acc.auto_earn) &&
      !!acc.interest_code && isValidFundCode(acc.interest_code)
    if (!needSwitch) {
      next.push(acc)
      continue
    }
    const patched = { ...acc, auto_earn: 1 }
    try {
      await updateAccount(patched)
      next.push(patched)
    } catch {
      // 落库失败就保持原样，并且不写标记，下次启动还能再补一次
      allOk = false
      next.push(acc)
    }
  }

  if (!allOk) return next

  try {
    localStorage.setItem(AUTO_EARN_MIGRATED_KEY, '1')
  } catch {
    // 存储不可用时忽略，最多每次启动多跑一次幂等迁移
  }
  return next
}

async function ensureCategory(name, type, icon) {
  const cats = await getCategories()
  const hit = cats.find(c => c.name === name && c.type === type)
  if (hit) return Number(hit.id)
  await createCategory({ name, type, icon })
  const next = await getCategories()
  return Number(next.find(c => c.name === name && c.type === type)?.id) || null
}

// 该账户最早一条自动账单的日期
// 用它当补录起点，而不是每次按「今天减 N 天」重算：
// 否则第一次只补 7 天，第二次就把 45 天历史一起倒出来了
async function earliestAutoDate(accountId) {
  const list = await getTransactions({ accountId })
  let earliest = ''
  for (const t of list) {
    if (!t.auto_source) continue
    const d = dateOf(t)
    if (d && (!earliest || d < earliest)) earliest = d
  }
  return earliest
}

// 已记过的日期集合，判重靠它
async function settledDates(accountId, source, startDate, endDate) {
  const list = await getTransactions({ accountId, startDate, endDate })
  return new Set(
    list.filter(t => t.auto_source === source).map(t => dateOf(t))
  )
}

// 补录起点：已有自动记录就从最早那条起算，否则回退一周
// 账户上一次手动入账的截止日也要作为下界：手动入账的记录不带 auto_source，
// 只靠日期判重根本查不到，不管住就会把同一段收益再记一遍
function resolveWindowStart({ earliest, settledThrough, today }) {
  let start = earliest || addDays(today, -FIRST_RUN_DAYS)
  if (settledThrough) {
    const manualNext = nextDayStr(settledThrough)
    if (manualNext > start) start = manualNext
  }
  return start
}

async function syncInterest(acc, ctx) {
  const today = todayStr()
  const history = await fetchMoneyFundHistory(acc.interest_code, { days: LOOKBACK_DAYS })
  if (!history.length) return 0

  const windowStart = resolveWindowStart({
    earliest: await earliestAutoDate(acc.id),
    settledThrough: acc.interest_settled_date || '',
    today
  })
  const startDate = history[0].date > windowStart ? history[0].date : windowStart

  // 余额由「期初 + 流水」反推，含此前已自动入账的收益
  const { rows } = accrueInterest({
    account: acc,
    transactions: ctx.allTx,
    history,
    startDate,
    endDate: today
  })

  const done = await settledDates(acc.id, AUTO_SOURCE.INTEREST, startDate, today)
  const picked = pickInterestRows({ rows, windowStart: startDate, settled: done })
  if (!picked.length) return 0

  const categoryId = await ctx.ensureIncome()
  let lastDate = ''
  for (const row of picked) {
    await createTransaction({
      type: 'income',
      amount: row.amount,
      category_id: categoryId,
      account_id: acc.id,
      date: row.date,
      note: `每日收益`,
      auto_source: AUTO_SOURCE.INTEREST
    })
    lastDate = row.date
  }

  // 把自动入账推进到最后一笔：收益页据此算「待入账」，
  // 关掉自动入账后也不会把已经自动记过的日子再当成待入账
  if (lastDate) {
    try {
      await updateAccount({ ...acc, interest_settled_date: lastDate })
    } catch {
      // 落库失败不影响已生成的账单，下次按记录日期仍能判重
    }
  }
  return picked.length
}

async function syncFundPnl(acc, ctx) {
  const shares = Number(acc.shares) || 0
  if (shares <= 0) return 0

  const navList = await fetchFundNavHistory(acc.symbol, { days: LOOKBACK_DAYS })
  if (navList.length < 2) return 0

  const today = todayStr()
  const windowStart = resolveWindowStart({
    earliest: await earliestAutoDate(acc.id),
    settledThrough: '',
    today
  })

  const done = await settledDates(acc.id, AUTO_SOURCE.FUND_PNL, navList[0].date, today)
  const rows = computeFundPnlRows({ navList, shares, windowStart, settled: done })
  if (!rows.length) return 0

  let created = 0
  for (const row of rows) {
    // 分类按需创建：只有真的要落账时才建，
    // 否则只是开了自动入账、当天又没行情，也会平白多出两个分类
    const categoryId = row.isGain ? await ctx.ensureIncome() : await ctx.ensureLoss()
    await createTransaction({
      type: row.type,
      amount: row.amount,
      category_id: categoryId,
      account_id: acc.id,
      date: row.date,
      note: `${acc.name} ${row.isGain ? '上涨' : '下跌'} ${row.amount.toFixed(2)}`,
      auto_source: AUTO_SOURCE.FUND_PNL
    })
    created++
  }
  return created
}

/**
 * 补齐所有开启自动入账的账户
 * @param {boolean} force 忽略「今天已同步」的标记，用户手动触发时用
 */
export async function syncDailyEarnings({ force = false } = {}) {
  const today = todayStr()
  const accounts = await migrateAutoEarn(await getAccounts())
  const targets = earnAccounts(accounts)
  if (!targets.length) {
    // 不写同步标记：用户可能刚打开 App 还没建账户，写了会导致当天新建的账户不同步
    return { skipped: false, created: 0, accounts: 0, errors: [] }
  }

  // 标记里带上账户组成：当天中途新开一个计息账户，签名变了就会补跑一次。
  // 只记日期的话，新账户要等到第二天才会同步
  const sig = targets.map(a => Number(a.id)).sort((a, b) => a - b).join(',')
  let state = {}
  try {
    state = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}')
  } catch {
    state = {}
  }
  if (!force && state.date === today && state.sig === sig) {
    return { skipped: true, created: 0, accounts: 0, errors: [] }
  }

  const allTx = await getTransactions()
  // 分类按需创建并缓存：没生成任何账单就不该往分类表里塞两条
  let incomeId = null
  let lossId = null
  const ctx = {
    allTx,
    ensureIncome: async () => {
      if (incomeId === null) incomeId = await ensureCategory('投资收益', 'income', '📈')
      return incomeId
    },
    ensureLoss: async () => {
      if (lossId === null) lossId = await ensureCategory('投资亏损', 'expense', '📉')
      return lossId
    }
  }

  let created = 0
  const errors = []
  for (const acc of targets) {
    try {
      created += acc.type === 'investment'
        ? await syncFundPnl(acc, ctx)
        : await syncInterest(acc, ctx)
    } catch (e) {
      errors.push(`${acc.name}：${e.message}`)
    }
  }

  // 即使有失败也记下：漏掉的那天会在下次同步时按「已入账截止日」往前补，
  // 不写的话每次进首页都会把所有失败账户重试一遍
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ date: today, sig }))
  } catch {
    // 存储满时忽略，下次仍会尝试
  }
  return { skipped: false, created, accounts: targets.length, errors }
}

// 账户页展示用：下次自动同步会补哪些账户
export function describeEarnAccount(acc) {
  if (acc.type === 'investment') {
    return acc.symbol ? `基金 ${acc.symbol} · ${acc.shares} 份` : '未设置基金代码'
  }
  return acc.interest_code ? `货币基金 ${acc.interest_code}` : '未选择货币基金'
}
