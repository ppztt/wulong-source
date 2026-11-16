// 财务区间与统计聚合工具
// 纯函数，不碰存储层：数据由调用方传入，预算页和报表页共用同一套口径

export function toDateStr(d) {
  const date = d instanceof Date ? d : new Date(d)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function parseDate(s) {
  const [y, m, d] = String(s || '').split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1)
}

export function todayStr() {
  return toDateStr(new Date())
}

// 交易日期可能带时间，统一只取日期部分
export function dateOf(t) {
  return String(t.date || '').split(' ')[0]
}

function startOfWeek(d) {
  const day = d.getDay() || 7 // 周日算第 7 天，保证周一为一周起点
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - (day - 1))
  return s
}

// 返回日期所在周期区间，period: weekly | monthly | yearly
export function periodRange(dateStr, period = 'monthly') {
  const d = parseDate(dateStr)
  if (period === 'weekly') {
    const start = startOfWeek(d)
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
    return { start: toDateStr(start), end: toDateStr(end) }
  }
  if (period === 'yearly') {
    return { start: `${d.getFullYear()}-01-01`, end: `${d.getFullYear()}-12-31` }
  }
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return { start: toDateStr(start), end: toDateStr(end) }
}

// 前后平移若干个周期
export function shiftPeriod(range, period = 'monthly', delta = 1) {
  const d = parseDate(range.start)
  if (period === 'weekly') d.setDate(d.getDate() + 7 * delta)
  else if (period === 'yearly') d.setFullYear(d.getFullYear() + delta)
  else d.setMonth(d.getMonth() + delta)
  return periodRange(toDateStr(d), period)
}

// ========== 预算 ==========
// 预算覆盖的分类集合：category_ids 为主，老数据回落到单个 category_id
export function budgetCategoryIds(budget) {
  const raw = Array.isArray(budget?.category_ids) && budget.category_ids.length
    ? budget.category_ids
    : (budget?.category_id != null && budget.category_id !== '' ? [budget.category_id] : [])
  return [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))]
}

// 预算进度：已用、可用（含结转）、剩余、使用百分比
export function budgetProgress(budget, transactions, today = todayStr()) {
  const current = periodRange(today, budget.period)
  const isCategory = budget.scope === 'category'
  // 一个分类预算可以覆盖多个分类，命中任意一个都算进额度
  const categoryIds = new Set(isCategory ? budgetCategoryIds(budget) : [])
  // 先按范围与分类筛出候选交易，避免每个周期都全量遍历
  const pool = transactions.filter(t =>
    t.type === 'expense' && (!isCategory || categoryIds.has(Number(t.category_id)))
  )
  const spentIn = (range) => pool.reduce((sum, t) => {
    const d = dateOf(t)
    if (d < range.start || d > range.end) return sum
    return sum + (Number(t.amount) || 0)
  }, 0)

  let carry = 0
  let carriedPeriods = 0
  if (budget.carry_over) {
    let cursor = periodRange(budget.start_date || today, budget.period)
    let guard = 0
    // 从预算起始周期一路滚到当前周期的上一个周期，累加每期结余
    while (cursor.end < current.start && guard++ < 240) {
      carry += budget.amount - spentIn(cursor)
      cursor = shiftPeriod(cursor, budget.period, 1)
      carriedPeriods++
    }
  }

  const used = spentIn(current)
  const available = budget.amount + carry
  const remaining = available - used
  const percent = available > 0
    ? Math.round((used / available) * 1000) / 10
    : (used > 0 ? 100 : 0)

  return { range: current, used, available, remaining, percent, carry, carriedPeriods }
}

export function budgetStatus(percent) {
  if (percent >= 100) return 'over'
  if (percent >= 80) return 'warn'
  return 'ok'
}

// ========== 报表 ==========
export function rangeTotals(transactions, range) {
  let expense = 0
  let income = 0
  for (const t of transactions) {
    const d = dateOf(t)
    if (d < range.start || d > range.end) continue
    const amount = Number(t.amount) || 0
    if (t.type === 'expense') expense += amount
    else if (t.type === 'income') income += amount
  }
  return { expense, income, balance: income - expense }
}

/**
 * 上月同日：把日号搬上月，超出上月天数时钳到月末
 * 用于「本月至今 vs 上月同期」的公平对比
 */
export function prevMonthSameDay(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const lastDay = new Date(y, m - 1, 0).getDate()
  return toDateStr(new Date(y, m - 2, Math.min(d || 1, lastDay)))
}

/**
 * 找出本月相比上月同期涨得最多的分类
 *
 * 必须用「同期」而不是整月对比：今天是 11 号，拿 11 天的数据去比上个月 30 天，
 * 每个分类都会显示下降，一条异常都报不出来。
 *
 * @param {object} options
 *   minAmount 绝对差额门槛，低于这个数不算异常（几块钱的波动没有参考价值）
 *   minRatio  相对增幅门槛，防止大额分类的小幅波动刷屏
 *   limit     最多返回几条
 * @returns {Array<{name, amount, before, diff, ratio}>} ratio 为空表示上期没有这个分类
 */
export function findCategorySpikes(transactions = [], options = {}) {
  const today = options.today || todayStr()
  const minAmount = options.minAmount == null ? 50 : options.minAmount
  const minRatio = options.minRatio == null ? 0.3 : options.minRatio
  const limit = options.limit || 3

  const monthRange = periodRange(today, 'monthly')
  const prevRange = shiftPeriod(monthRange, 'monthly', -1)
  // 截到今天 + 上月同期，两边窗口长度一致
  const curEnd = today
  const prevEnd = prevMonthSameDay(today)

  const sumByCategory = (start, end) => {
    const map = new Map()
    for (const t of transactions) {
      if (t.type !== 'expense') continue
      // 自动生成的盈亏账单不是消费行为，算进来会污染对比
      if (t.auto_source) continue
      const d = dateOf(t)
      if (d < start || d > end) continue
      const key = t.category_name || '未分类'
      map.set(key, (map.get(key) || 0) + (Number(t.amount) || 0))
    }
    return map
  }

  const cur = sumByCategory(monthRange.start, curEnd)
  const prev = sumByCategory(prevRange.start, prevEnd)

  const rows = []
  for (const [name, amount] of cur) {
    const before = prev.get(name) || 0
    const diff = amount - before
    if (diff < minAmount) continue
    // 上期没有这个分类说明是新出现的支出，没有基数可比，直接算异常
    const ratio = before > 0 ? diff / before : null
    if (ratio !== null && ratio < minRatio) continue
    rows.push({ name, amount, before, diff, ratio })
  }

  // 按多花的绝对金额排序：多花 300 比多花 60 更值得提醒
  rows.sort((a, b) => b.diff - a.diff)
  return rows.slice(0, limit)
}

function eachDay(range) {
  const days = []
  let cursor = parseDate(range.start)
  const end = parseDate(range.end)
  let guard = 0
  while (cursor <= end && guard++ < 400) {
    days.push(toDateStr(cursor))
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)
  }
  return days
}

function eachMonth(range) {
  const months = []
  const start = parseDate(range.start)
  const end = parseDate(range.end)
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  let guard = 0
  while (cursor <= end && guard++ < 60) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }
  return months
}

// 趋势序列：跨度超过 62 天自动按月，否则按天；缺失的桶补 0
export function trendSeries(transactions, range, granularity) {
  const auto = granularity || (dayCount(range) > 62 ? 'month' : 'day')
  const buckets = new Map()
  const labels = []

  if (auto === 'month') {
    for (const m of eachMonth(range)) { buckets.set(m, 0); labels.push(m) }
    for (const t of transactions) {
      if (t.type !== 'expense') continue
      const key = dateOf(t).substring(0, 7)
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + (Number(t.amount) || 0))
    }
    return labels.map(key => ({
      key,
      label: `${Number(key.substring(5, 7))}月`,
      value: buckets.get(key)
    }))
  }

  for (const d of eachDay(range)) { buckets.set(d, 0); labels.push(d) }
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const key = dateOf(t)
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + (Number(t.amount) || 0))
  }
  return labels.map(key => ({
    key,
    label: `${Number(key.substring(5, 7))}/${Number(key.substring(8, 10))}`,
    value: buckets.get(key)
  }))
}

export function dayCount(range) {
  const start = parseDate(range.start)
  const end = parseDate(range.end)
  return Math.round((end - start) / 86400000) + 1
}

// 维度聚合：category | account | tag，返回按金额降序的数组
export function groupByDimension(transactions, range, dimension = 'category', type = 'expense') {
  const map = new Map()
  const push = (key, name, icon, amount) => {
    if (!key) return
    const item = map.get(key) || { id: key, name, icon, total: 0 }
    item.total += amount
    map.set(key, item)
  }

  for (const t of transactions) {
    if (t.type !== type) continue
    const d = dateOf(t)
    if (d < range.start || d > range.end) continue
    const amount = Number(t.amount) || 0

    if (dimension === 'tag') {
      // 一笔账单的金额会完整计入它的每个标签，因此标签合计可能大于实际支出
      for (const tag of (t.tags || [])) {
        push(`tag-${tag.id}`, tag.name, '🏷️', amount)
      }
    } else if (dimension === 'account') {
      const id = t.account_id == null ? 'none' : Number(t.account_id)
      push(`acc-${id}`, t.account_name || '未指定账户', t.account_icon || '💳', amount)
    } else {
      const id = t.category_id == null ? 'none' : Number(t.category_id)
      push(`cat-${id}`, t.category_name || '未分类', t.category_icon || '📌', amount)
    }
  }

  return [...map.values()].sort((a, b) => b.total - a.total)
}

// 与上一周期对比，percent 为 null 表示上期为 0 无法计算
export function compareTotals(current, previous) {
  const delta = (cur, prev) => {
    const diff = cur - prev
    return {
      diff,
      percent: prev > 0 ? Math.round((diff / prev) * 1000) / 10 : null
    }
  }
  return {
    expense: delta(current.expense, previous.expense),
    income: delta(current.income, previous.income)
  }
}

// 预算周期对应的上期区间，用于"环比"
export function previousRange(range, period) {
  return shiftPeriod(range, period, -1)
}

// 报表预设区间
export function presetRanges(today = todayStr()) {
  const month = periodRange(today, 'monthly')
  const year = periodRange(today, 'yearly')
  return [
    { key: 'thisMonth', label: '本月', range: month },
    { key: 'lastMonth', label: '上月', range: shiftPeriod(month, 'monthly', -1) },
    { key: 'thisYear', label: '本年', range: year },
    { key: 'last30', label: '近30天', range: { start: toDateStr(new Date(Date.now() - 29 * 86400000)), end: today } }
  ]
}

export function fmtMoney(n) {
  return (Number(n) || 0).toFixed(2)
}

export function fmtPercent(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

// ========== 货币基金收益（余额宝 / 零钱通） ==========
// 货币基金净值恒为 1，1 份 = 1 元，所以 日收益 = 余额 / 10000 × 每万份收益
export function dailyInterest(balance, millionIncome) {
  const b = Number(balance) || 0
  const income = Number(millionIncome) || 0
  if (b <= 0) return 0
  return (b / 10000) * income
}

// 七日年化口径的日估算，用于和万份收益互相印证
export function dailyInterestByYield(balance, sevenDayYield) {
  const b = Number(balance) || 0
  const y = Number(sevenDayYield) || 0
  if (b <= 0) return 0
  return (b * y) / 100 / 365
}

export function nextDayStr(dateStr) {
  const d = parseDate(dateStr)
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
}

// 按逐日万份收益 + 账本流水反推的每日余额，精算区间收益
// account: 账户对象（需 id 与 initial_balance）
// transactions: 全量交易，用于还原每天的真实余额
// history: [{ date, millionIncome }]，来自 fetchMoneyFundHistory
export function accrueInterest({ account, transactions, history, startDate, endDate }) {
  const accId = Number(account.id)
  const incomeMap = new Map()
  for (const item of history || []) {
    if (item?.date) incomeMap.set(item.date, item.millionIncome)
  }

  // 先把每天的资金净变动汇总出来：支出扣、收入加、转账双边
  const deltaMap = new Map()
  for (const t of transactions || []) {
    const d = dateOf(t)
    if (!d) continue
    const amount = Number(t.amount) || 0
    let delta = 0
    if (t.type === 'income' && Number(t.account_id) === accId) delta += amount
    else if (t.type === 'expense' && Number(t.account_id) === accId) delta -= amount
    else if (t.type === 'transfer') {
      if (Number(t.account_id) === accId) delta -= amount
      if (Number(t.to_account_id) === accId) delta += amount
    }
    if (delta) deltaMap.set(d, (deltaMap.get(d) || 0) + delta)
  }

  // 区间开始前的余额
  let balance = Number(account.initial_balance) || 0
  for (const [d, delta] of deltaMap) {
    if (d < startDate) balance += delta
  }
  const startBalance = balance

  let total = 0
  let days = 0
  const rows = []
  let cursor = startDate
  let guard = 0
  while (cursor <= endDate && guard++ < 400) {
    const millionIncome = incomeMap.get(cursor)
    // 没有当天万份收益数据（如未来日期）或余额为 0 时当天不产生收益
    if (millionIncome !== undefined && millionIncome !== null && balance > 0) {
      const gain = dailyInterest(balance, millionIncome)
      total += gain
      days++
      rows.push({ date: cursor, balance, millionIncome, gain })
    }
    balance += deltaMap.get(cursor) || 0
    cursor = nextDayStr(cursor)
  }

  return { total, days, rows, startBalance, endBalance: balance }
}
