// 每日收益的纯计算层
// 不 import 数据库、不 import 网络，只有数学：方便单测，也方便在别处复用

// 低于一分钱不入账，否则会堆出一堆 0.00 的噪音记录
export const MIN_AMOUNT = 0.01

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 基金逐日盈亏：份额 ×（当日净值 - 前一日净值）
 * @param {Array} navList   [{ date, nav }]，按日期正序
 * @param {number} shares   持仓份额
 * @param {string} windowStart 早于此日期的跳过
 * @param {Set} settled     已记过的日期集合
 */
export function computeFundPnlRows({ navList = [], shares = 0, windowStart = '', settled = new Set() }) {
  const rows = []
  const count = Number(shares) || 0
  if (count <= 0) return rows

  for (let i = 1; i < navList.length; i++) {
    const cur = navList[i]
    const prev = navList[i - 1]
    if (!cur?.date || !prev?.date) continue
    // 停牌或数据缺失时净值为 0 / null，跳过而不是算成暴跌
    if (!cur.nav || !prev.nav) continue
    if (windowStart && cur.date < windowStart) continue
    if (settled.has(cur.date)) continue

    const pnl = count * (cur.nav - prev.nav)
    const amount = round2(Math.abs(pnl))
    if (amount < MIN_AMOUNT) continue

    rows.push({
      date: cur.date,
      pnl,
      amount,
      isGain: pnl >= 0,
      type: pnl >= 0 ? 'income' : 'expense',
      nav: cur.nav,
      prevNav: prev.nav
    })
  }
  return rows
}

/**
 * 货币基金逐日收益的落地过滤
 * accrueInterest 已算好每天的 gain，这里只做「过旧/已记/不足一分」的剔除
 */
export function pickInterestRows({ rows = [], windowStart = '', settled = new Set() }) {
  const picked = []
  for (const row of rows) {
    if (!row?.date) continue
    if (windowStart && row.date < windowStart) continue
    if (settled.has(row.date)) continue
    const amount = round2(row.gain)
    if (amount < MIN_AMOUNT) continue
    picked.push({
      date: row.date,
      amount,
      isGain: true,
      type: 'income',
      balance: row.balance,
      millionIncome: row.millionIncome
    })
  }
  return picked
}

// 汇总一组待入账记录，用于界面提示「补了几天、合计多少」
export function summarizeRows(rows = []) {
  let gain = 0
  let loss = 0
  for (const row of rows) {
    if (row.isGain) gain += row.amount
    else loss += row.amount
  }
  return {
    days: rows.length,
    gain: round2(gain),
    loss: round2(loss),
    net: round2(gain - loss)
  }
}
