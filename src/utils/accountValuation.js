// 账户估值：把「账面余额」换算成用户实际看到的金额口径
//
// getAccounts() 给的 balance 是「期初余额 + 已发生流水」，只适合普通账户和信用账户。
// 投资账户（基金 / 黄金）的钱是「份额 × 行情价」，一分钱都不走流水：
// 直接拿 balance 去回答「我黄金账户现在有多少钱」，得到的是 0 或者当初转入的那一笔，
// 用户就会看到小乌报了一个莫名其妙的数字。
//
// 所以凡是需要把账户金额写进提示词的地方（问答、分析、账户确认卡），
// 都先过一遍 valueAccounts()，再统一用 describeAccountValue() 拼文本。

import {
  fetchGoldQuote, fetchFundQuote, fetchMoneyFundQuote, isValidFundCode,
  peekGoldCache, peekFundCache
} from '../api/market'

// 行情是网络请求，AI 对话不能为了一个报价卡住十几秒：
// 超时就退回本地上一次的缓存，再没有就按成本价估，绝不让整段回答失败
const QUOTE_TIMEOUT = 5000

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(n) {
  return Math.round(num(n) * 100) / 100
}

function money(n) {
  return num(n).toFixed(2)
}

// 份额、单价去掉无意义的尾零：5.2000 → 5.2
function trimNum(n) {
  const v = num(n)
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(4)))
}

function withTimeout(promise, ms) {
  return new Promise(resolve => {
    let settled = false
    let timer = null
    const done = value => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve(value)
    }
    timer = setTimeout(() => done(null), ms)
    promise.then(done).catch(() => done(null))
  })
}

async function loadGoldQuote() {
  const fresh = await withTimeout(fetchGoldQuote(), QUOTE_TIMEOUT)
  if (fresh) return fresh
  // 拿不到新报价时沿用上一次的金价，市值才不会突然变成成本价
  return peekGoldCache()
}

async function loadFundQuote(code) {
  const fresh = await withTimeout(fetchFundQuote(code), QUOTE_TIMEOUT)
  if (fresh) return fresh
  return peekFundCache(code)
}

// 货币基金（余额宝 / 零钱通）的七日年化：用于回答「利息多少」，
// 接口自己有 30 分钟缓存与 stale 兜底，失败时返回 null 不影响其余账户
async function loadMoneyQuote(code) {
  const quote = await withTimeout(fetchMoneyFundQuote(code), QUOTE_TIMEOUT)
  return quote || null
}

// 普通 / 信用账户：balance 就是用户看到的数
function annotatePlain(acc) {
  const value = round2(acc.balance)
  const annotated = { ...acc, display_value: value, display_label: '余额' }
  // 信用卡的「还剩多少能刷」= 额度 - 欠款 + 溢缴，模型自己减容易算反
  if (acc.type === 'credit') {
    const limit = num(acc.credit_limit)
    annotated.available_credit = limit > 0 ? round2(limit + num(acc.balance)) : null
  }
  return annotated
}

// 计息账户：余额宝 / 零钱通，把七日年化和今日预估收益挂上去
function annotateInterest(acc, quote) {
  if (!quote) return acc
  const millionIncome = num(quote.millionIncome)
  return {
    ...acc,
    interest: {
      name: String(quote.name || ''),
      sevenDayYield: Number.isFinite(Number(quote.sevenDayYield)) && quote.sevenDayYield !== null
        ? Number(quote.sevenDayYield)
        : null,
      millionIncome,
      // 今日预估收益 = 余额 / 10000 × 每万份收益
      todayGain: millionIncome > 0 ? round2((num(acc.display_value) / 10000) * millionIncome) : 0,
      stale: !!quote.stale
    }
  }
}

/**
 * 投资账户：市值 = 份额 × 单价（金价按克、基金按净值或盘中估值）
 * 没填份额时算不出市值，退回账面余额并标记出来，避免凭空报 0
 */
function annotateInvestment(acc, goldQuote, fundMap) {
  const shares = num(acc.shares)
  const cost = num(acc.cost_price)
  const quote = acc.market === 'gold' ? goldQuote : (fundMap[String(acc.symbol || '')] || null)
  const quoted = num(quote?.price)
  const unitPrice = quoted || cost
  const hasPosition = shares > 0 && unitPrice > 0

  if (!hasPosition) {
    return {
      ...acc,
      display_value: round2(acc.balance),
      display_label: '账面余额',
      has_position: false,
      price: 0,
      price_label: '',
      price_is_fallback: false,
      profit: 0,
      profit_rate: null,
      cost_value: 0
    }
  }

  const value = shares * unitPrice
  // 用成本价估算时盈亏恒为 0，没有参考意义
  const profit = quoted && cost > 0 ? round2((quoted - cost) * shares) : 0
  const costValue = cost > 0 ? round2(cost * shares) : 0
  return {
    ...acc,
    display_value: round2(value),
    display_label: '市值',
    has_position: true,
    price: unitPrice,
    price_label: acc.market === 'gold' ? '现价' : (quote?.isEstimate ? '估值' : '净值'),
    // 行情没取到、退到成本价：提示词里要说清楚，别把成本当现价
    price_is_fallback: !quoted,
    quote_stale: !!quote?.stale,
    profit,
    // 收益率按成本金额算，问「赚了百分之几」时不用模型自己除
    profit_rate: costValue > 0 ? round2((profit / costValue) * 100) : null,
    cost_value: costValue
  }
}

/**
 * 给账户列表补上「当前金额」口径
 * 只对投资账户和计息账户发网络请求，其余账户直接返回；
 * 一个需要行情的账户都没有时不会产生任何请求
 */
export async function valueAccounts(accounts = []) {
  const list = Array.isArray(accounts) ? accounts : []
  const invest = list.filter(a => a && a.type === 'investment')
  const moneyCodes = [...new Set(
    list
      .filter(a => a && a.type === 'cash' && isValidFundCode(a.interest_code))
      .map(a => String(a.interest_code))
  )]
  if (!invest.length && !moneyCodes.length) return list.map(a => (a ? annotatePlain(a) : a))

  const fundCodes = [...new Set(
    invest
      .filter(a => a.market !== 'gold' && isValidFundCode(a.symbol))
      .map(a => String(a.symbol))
  )]
  const needsGold = invest.some(a => a.market === 'gold')

  const [gold, fundList, moneyList] = await Promise.all([
    needsGold ? loadGoldQuote() : Promise.resolve(null),
    Promise.all(fundCodes.map(code => loadFundQuote(code))),
    Promise.all(moneyCodes.map(code => loadMoneyQuote(code)))
  ])
  const fundMap = {}
  fundCodes.forEach((code, i) => {
    if (fundList[i]) fundMap[code] = fundList[i]
  })
  const moneyMap = {}
  moneyCodes.forEach((code, i) => {
    if (moneyList[i]) moneyMap[code] = moneyList[i]
  })

  return list.map(a => {
    if (!a) return a
    const base = a.type === 'investment' ? annotateInvestment(a, gold, fundMap) : annotatePlain(a)
    const moneyQuote = a.interest_code ? moneyMap[String(a.interest_code)] : null
    return moneyQuote ? annotateInterest(base, moneyQuote) : base
  })
}

/**
 * 把账户金额写成一句提示词
 * 投资账户一律报市值，并且把份额、单价、盈亏一起给出来，
 * 否则模型只拿到一个数，解释「为什么是这个数」时又回去用流水余额瞎推
 */
export function describeAccountValue(acc = {}) {
  if (acc.type === 'credit' || acc.type === 'debt') {
    const value = num(acc.balance)
    const limit = num(acc.credit_limit)
    const avail = acc.available_credit
    const availText = limit > 0 && avail !== null && avail !== undefined ? `，可用额度 ${money(avail)}` : ''
    // 欠款账户没有溢缴的概念，多还了就是多还，别说成信用卡那种「溢缴」
    const overLabel = acc.type === 'credit' ? '溢缴' : '多还'
    if (value < 0) return `欠款 ${money(-value)}${availText}`
    if (value > 0) return `${overLabel} ${money(value)}${availText}`
    return `无欠款${availText}`
  }
  if (acc.type !== 'investment') {
    const base = `余额 ${money(acc.display_value ?? acc.balance)}`
    const it = acc.interest
    if (!it) return base
    const parts = [base]
    if (it.name) parts.push(it.name)
    if (it.sevenDayYield !== null && it.sevenDayYield !== undefined) parts.push(`七日年化 ${num(it.sevenDayYield).toFixed(3)}%`)
    if (num(it.todayGain) > 0) parts.push(`今日约 +${money(it.todayGain)}`)
    if (it.stale) parts.push('收益率未更新，沿用上次数据')
    return parts.join('，')
  }
  if (!acc.has_position) {
    return `账面余额 ${money(acc.display_value ?? acc.balance)}（没填持有份额，算不出市值）`
  }

  const parts = [`市值 ${money(acc.display_value)}`]
  parts.push(`份额 ${trimNum(acc.shares)}`)
  if (acc.price_label && num(acc.price) > 0) {
    parts.push(`${acc.price_label} ${trimNum(acc.price)}${acc.market === 'gold' ? ' 元/克' : ''}`)
  }
  if (num(acc.cost_value) > 0) parts.push(`成本 ${money(acc.cost_value)}`)
  if (Math.abs(num(acc.profit)) >= 0.005) {
    const rate = acc.profit_rate === null || acc.profit_rate === undefined
      ? ''
      : `（${acc.profit_rate > 0 ? '+' : ''}${num(acc.profit_rate).toFixed(2)}%）`
    parts.push(`浮${acc.profit > 0 ? '盈' : '亏'} ${money(Math.abs(acc.profit))}${rate}`)
  }
  if (acc.price_is_fallback) parts.push('行情没取到，暂时按成本价估算')
  else if (acc.quote_stale) parts.push('行情未更新，沿用上次价格')
  return parts.join('，')
}

/**
 * 资产汇总：总资产 = 现金类 + 投资市值 + 信用溢缴，总负债 = 信用欠款，净资产 = 两者之差
 *
 * 用户问「我有多少钱」时模型自己按账户列表加总很容易把投资市值漏掉或把欠款加反，
 * 这里直接算好给它一个权威数字
 */
export function summarizeAccounts(accounts = []) {
  let cash = 0
  let invest = 0
  let investCost = 0
  let creditDebt = 0
  let creditOverpay = 0

  for (const a of accounts) {
    if (!a) continue
    if (a.type === 'investment') {
      invest += num(a.display_value)
      investCost += num(a.cost_value)
    } else if (a.type === 'credit' || a.type === 'debt') {
      // 信用账户和欠款账户都是负债：负数进负债，正数（多还的钱）算资产
      const v = num(a.balance)
      if (v < 0) creditDebt += -v
      else creditOverpay += v
    } else {
      cash += num(a.display_value ?? a.balance)
    }
  }

  const assets = cash + invest + creditOverpay
  const liabilities = creditDebt
  return {
    cash: round2(cash),
    investValue: round2(invest),
    investCost: round2(investCost),
    investProfit: round2(invest - investCost),
    creditDebt: round2(creditDebt),
    creditOverpay: round2(creditOverpay),
    assets: round2(assets),
    liabilities: round2(liabilities),
    net: round2(assets - liabilities)
  }
}

/**
 * 把资产汇总写成一行提示词
 * 只列存在的部分：没有投资账户就不提投资，没有欠款就不提负债，避免模型以为「有 0 元的东西」
 */
export function describePortfolio(accounts = []) {
  const list = Array.isArray(accounts) ? accounts : []
  if (!list.length) return ''

  const s = summarizeAccounts(list)
  const hasInvest = list.some(a => a && a.type === 'investment' && a.has_position)
  const hasCreditDebt = s.creditDebt > 0

  if (hasInvest) {
    const profitText = s.investCost > 0
      ? `，其中成本 ${money(s.investCost)}，浮${s.investProfit >= 0 ? '盈' : '亏'} ${money(Math.abs(s.investProfit))}`
      : ''
    return [
      `总资产 ${money(s.assets)} 元`,
      `（现金等 ${money(s.cash + s.creditOverpay)} + 投资市值 ${money(s.investValue)}${profitText}）`,
      hasCreditDebt ? `，总负债 ${money(s.liabilities)} 元（信用卡/欠款账户）` : '',
      `，净资产 ${money(s.net)} 元`
    ].join('')
  }

  return [
    `总资产 ${money(s.assets)} 元`,
    hasCreditDebt ? `，总负债 ${money(s.liabilities)} 元（信用卡/欠款账户）` : '',
    `，净资产 ${money(s.net)} 元`
  ].join('')
}
