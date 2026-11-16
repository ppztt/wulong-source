// skill 的纯逻辑层：把模型返回的 JSON 归一化成「确认卡草稿」
// 只做数据整形与校验，不 import 数据库、不 import 网络，方便单测

import { todayStr, parseDate, toDateStr } from '../utils/finance'
import { matchByName } from '../utils/aiAssistant'

const PERIODS = ['weekly', 'monthly', 'yearly']
const FREQS = ['daily', 'weekly', 'monthly', 'yearly']
const TYPES = ['expense', 'income', 'transfer']

export const PERIOD_LABEL = { weekly: '每周', monthly: '每月', yearly: '每年' }
export const FREQ_LABEL = { daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年' }
export const TYPE_LABEL = { expense: '支出', income: '收入', transfer: '转账' }

function num(v) {
  return Math.abs(Number(v) || 0)
}

function dateStr(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : ''
}

function addMonths(dateStrValue, delta) {
  const d = parseDate(dateStrValue)
  return toDateStr(new Date(d.getFullYear(), d.getMonth() + delta, d.getDate()))
}

// ================= 预算 =================

/**
 * 预算草稿
 * 同一 scope + 同一分类只能有一条预算，所以这里顺手判断是「修改」还是「新建」
 */
export function budgetDraft(parsed = {}, ctx = {}) {
  const scope = parsed.scope === 'category' ? 'category' : 'total'
  const categories = ctx.categories || []
  const budgets = ctx.budgets || []
  const today = ctx.today || todayStr()

  const category = scope === 'category' ? matchByName(categories, parsed.category) : null
  const amount = num(parsed.amount)
  const period = PERIODS.includes(parsed.period) ? parsed.period : 'monthly'

  const existing = budgets.find(b => {
    const bScope = b.scope === 'category' ? 'category' : 'total'
    if (bScope !== scope) return false
    if (scope === 'total') return true
    return category && Number(b.category_id) === Number(category.id)
  }) || null

  return {
    kind: 'budget',
    // 用户说"改成"但找不到对应预算时，按新建处理，卡片上会写清楚
    mode: existing ? 'update' : 'create',
    existingId: existing ? Number(existing.id) : null,
    scope,
    category_id: category ? Number(category.id) : null,
    category_name: category ? category.name : String(parsed.category || '').trim(),
    category_resolved: scope === 'total' || !!category,
    amount,
    period,
    carry_over: parsed.carryOver ? 1 : 0,
    // 修改时保留原起始日，否则结转的期数会从头重算
    start_date: existing?.start_date || today,
    enabled: 1,
    reply: String(parsed.reply || '').trim()
  }
}

export function budgetValidate(draft) {
  if (!(Number(draft.amount) > 0)) return '金额要大于 0'
  if (draft.scope === 'category' && !draft.category_id) return '请选择一个分类'
  return ''
}

export function budgetFields(draft, ctx = {}) {
  const cats = (ctx.categories || []).filter(c => c.type === 'expense')
  return [
    {
      key: 'scope',
      label: '范围',
      type: 'select',
      options: [
        { value: 'total', label: '总预算' },
        { value: 'category', label: '分类预算' }
      ]
    },
    {
      key: 'category_id',
      label: '分类',
      type: 'select',
      // 用数据描述显示条件而不是函数：确认卡会被序列化进 localStorage，
      // 函数存不下来，恢复后条件会失效
      showWhen: { key: 'scope', value: 'category' },
      options: cats.map(c => ({ value: Number(c.id), label: `${c.icon || ''} ${c.name}` }))
    },
    { key: 'amount', label: '金额', type: 'number', unit: '元' },
    {
      key: 'period',
      label: '周期',
      type: 'select',
      options: PERIODS.map(p => ({ value: p, label: PERIOD_LABEL[p] }))
    },
    { key: 'carry_over', label: '结余结转', type: 'switch', desc: '没花完的额度叠加到下期' }
  ]
}

// ================= 周期记账 =================

/**
 * 周期规则草稿
 * startDate 的语义要特别小心：它决定"保存后会不会立刻补一笔"
 * 这里按「本月该日」推导，并把是否已过标注出来，让用户在卡片上看得见
 */
export function recurringDraft(parsed = {}, ctx = {}) {
  const accounts = ctx.accounts || []
  const categories = ctx.categories || []
  const today = ctx.today || todayStr()

  const type = TYPES.includes(parsed.type) ? parsed.type : 'expense'
  const category = type === 'transfer' ? null : matchByName(categories.filter(c => c.type === type), parsed.category)
  const account = matchByName(accounts, parsed.account)
  const toAccount = type === 'transfer' ? matchByName(accounts, parsed.toAccount) : null

  let startDate = dateStr(parsed.startDate) || today
  // 模型给的日期早于今天时，说明它想补这一期，保留原样；晚于今天就按未来处理
  const frequency = FREQS.includes(parsed.frequency) ? parsed.frequency : 'monthly'
  const amount = num(parsed.amount)
  const name = String(parsed.name || '').trim() || '周期记账'

  // 和已有规则比对：完全一致的会被 saveRecurringRule 复用；
  // 只有同名但参数不同的，保存后确实会多出一条，必须提前告诉用户，
  // 否则「把房租改成 1800」会变成两条规则，每次到期各生成一笔
  const rules = ctx.rules || []
  const sameName = rules.filter(r => String(r.name || '').trim() === name)
  const exact = sameName.find(r =>
    r.type === type &&
    Number(r.amount) === amount &&
    r.frequency === frequency &&
    String(r.start_date || '') === startDate
  )
  const duplicate = exact ? 'exact' : (sameName.length ? 'name' : '')

  return {
    kind: 'recurring',
    mode: 'create',
    name,
    type,
    amount,
    category_id: category ? Number(category.id) : null,
    category_name: category ? category.name : String(parsed.category || '').trim(),
    account_id: account ? Number(account.id) : null,
    account_name: account ? account.name : String(parsed.account || '').trim(),
    to_account_id: toAccount ? Number(toAccount.id) : null,
    to_account_name: toAccount ? toAccount.name : '',
    note: String(parsed.note || '').trim(),
    merchant: String(parsed.merchant || '').trim(),
    frequency,
    start_date: startDate,
    end_date: dateStr(parsed.endDate),
    duplicate,
    enabled: 1,
    // 保存后能否马上看到账单：起始日不晚于今天就会立刻补一笔
    startsInPast: startDate <= today,
    reply: String(parsed.reply || '').trim()
  }
}

export function recurringValidate(draft) {
  if (!(Number(draft.amount) > 0)) return '金额要大于 0'
  if (!draft.start_date) return '请选择开始日期'
  if (draft.type === 'transfer') {
    if (!draft.account_id || !draft.to_account_id) return '转账需要转出和转入账户'
    if (Number(draft.account_id) === Number(draft.to_account_id)) return '转出和转入不能是同一个账户'
  } else if (!draft.account_id) {
    return '请选择账户'
  }
  return ''
}

export function recurringFields(draft, ctx = {}) {
  const cats = (ctx.categories || []).filter(c => c.type === draft.type)
  const accs = (ctx.accounts || []).map(a => ({ value: Number(a.id), label: a.name }))
  const base = [
    { key: 'name', label: '名称', type: 'text' },
    {
      key: 'type',
      label: '类型',
      type: 'select',
      options: TYPES.map(t => ({ value: t, label: TYPE_LABEL[t] }))
    },
    { key: 'amount', label: '金额', type: 'number', unit: '元' }
  ]

  if (draft.type !== 'transfer') {
    base.push({ key: 'category_id', label: '分类', type: 'select', options: cats.map(c => ({ value: Number(c.id), label: `${c.icon || ''} ${c.name}` })) })
  }
  base.push({ key: 'account_id', label: draft.type === 'transfer' ? '转出账户' : '账户', type: 'select', options: accs })
  if (draft.type === 'transfer') {
    base.push({ key: 'to_account_id', label: '转入账户', type: 'select', options: accs })
  }
  base.push(
    {
      key: 'frequency',
      label: '频率',
      type: 'select',
      options: FREQS.map(f => ({ value: f, label: FREQ_LABEL[f] }))
    },
    { key: 'start_date', label: '开始日期', type: 'date' },
    { key: 'end_date', label: '结束日期', type: 'date', optional: true }
  )
  return base
}

// ================= 分类 =================

const ICON_FALLBACK = ['🏷️', '📌', '💡', '🎁', '🐾', '🧾', '🎨', '🎵', '🌱', '☕']

export function categoryDraft(parsed = {}, ctx = {}) {
  const name = String(parsed.name || '').trim()
  const type = parsed.type === 'income' ? 'income' : 'expense'
  const existed = (ctx.categories || []).find(c => c.name === name && c.type === type)
  const icon = String(parsed.icon || '').trim() || ICON_FALLBACK[name.length % ICON_FALLBACK.length]

  return {
    kind: 'category',
    mode: 'create',
    name,
    type,
    icon,
    // 同名同类型已存在时不重复建
    duplicate: !!existed,
    existingId: existed ? Number(existed.id) : null,
    reply: String(parsed.reply || '').trim()
  }
}

export function categoryValidate(draft) {
  if (!draft.name) return '分类名称不能为空'
  if (draft.name.length > 12) return '分类名称别超过 12 个字'
  if (draft.duplicate) return '这个分类已经有了'
  return ''
}

export function categoryFields() {
  return [
    { key: 'name', label: '名称', type: 'text' },
    {
      key: 'type',
      label: '类型',
      type: 'select',
      options: [
        { value: 'expense', label: '支出' },
        { value: 'income', label: '收入' }
      ]
    },
    { key: 'icon', label: '图标', type: 'text', desc: '填一个 emoji 即可' }
  ]
}

// ================= 标签 =================

export function tagDraft(parsed = {}, ctx = {}) {
  const name = String(parsed.name || '').trim()
  const existed = (ctx.tags || []).find(t => t.name === name)
  return {
    kind: 'tag',
    mode: 'create',
    name,
    duplicate: !!existed,
    existingId: existed ? Number(existed.id) : null,
    reply: String(parsed.reply || '').trim()
  }
}

export function tagValidate(draft) {
  if (!draft.name) return '标签名称不能为空'
  if (draft.name.length > 10) return '标签别超过 10 个字'
  if (draft.duplicate) return '这个标签已经有了'
  return ''
}

export function tagFields() {
  return [{ key: 'name', label: '名称', type: 'text' }]
}

// ================= 账户 =================

export const ACCOUNT_TYPE_LABEL = { cash: '普通', credit: '信用', debt: '欠款', investment: '投资' }

const ACCOUNT_TYPES = ['cash', 'credit', 'debt', 'investment']
const ACCOUNT_MODES = ['create', 'update', 'balance', 'delete', 'redeem']
// 模型偶尔会把「赎回」说成卖出/转出，统一按 redeem 处理
const REDEEM_MODES = ['redeem', 'sell', 'transfer_out', 'transferOut', 'sellOut']

// 负债类账户（信用 / 欠款）余额为负表示欠款，界面上一律用「欠款正数」
export function isLiabilityType(type) {
  return type === 'credit' || type === 'debt'
}

function displayBalance(acc) {
  const value = Number(acc?.balance) || 0
  return isLiabilityType(acc?.type) ? -value : value
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

/**
 * 赎回换算：金额 ↔ 份额
 *
 * 基金按 0.01 份、黄金按 0.0001 克成交，份额精度必须跟着品种走，
 * 否则按净值折算出来的份额会带着 6 位小数，跟平台对不上。
 * 抽成纯函数是为了让确认卡上改金额时也能实时重算，不必等保存。
 */
export function planRedeem({ amount, price, held, all = false, digits = 2 } = {}) {
  const p = Number(price) > 0 ? Number(price) : 0
  const h = Math.max(Number(held) || 0, 0)
  const a = Math.abs(Number(amount) || 0)
  const step = 10 ** Math.max(Number(digits) || 0, 0)

  let shares = all ? h : (p > 0 ? a / p : 0)
  if (shares > h) shares = h
  shares = Math.round(shares * step) / step

  return {
    shares,
    remaining: Math.round(Math.max(h - shares, 0) * step) / step,
    amount: round2(shares * p)
  }
}

/**
 * 赎回草稿：把投资账户的持仓卖出一部分 / 全部，钱转到另一个账户
 *
 * 为什么必须以「份额」落地：投资账户的市值是 份额 × 行情价，
 * 只把金额从流水里挪走、份额不动的话，用户会看到投资市值一分没少，
 * 转入账户却凭空多了钱。所以金额和份额互为换算，卡片上让用户改金额，
 * 保存时再按库里真实持仓重算份额。
 */
function redeemDraft(parsed = {}, ctx = {}) {
  const accounts = ctx.accounts || []
  const acc = matchByName(accounts, String(parsed.account || parsed.name || '').trim()) || null
  const toHint = String(parsed.toAccount || parsed.to_account || '').trim()
  const to = matchByName(accounts, toHint) || null

  const held = acc ? Math.max(Number(acc.shares) || 0, 0) : 0
  // acc.price 是 valueAccounts 附上的当前行情；取不到时才退到成本价，并在卡片上标出来
  const quoted = acc ? Number(acc.price) > 0 && !acc.price_is_fallback : false
  const price = acc ? (Number(acc.price) || Number(acc.cost_price) || 0) : 0
  const marketValue = acc ? Number(acc.display_value) || 0 : 0
  const gold = acc?.market === 'gold'
  const digits = gold ? 4 : 2

  const amountIn = Math.abs(Number(parsed.amount) || 0)
  const sharesIn = Math.abs(Number(parsed.shares) || 0)
  // 「全部/清仓/都卖了」以及「金额已经不小于市值」都按清仓处理
  const wantsAll = parsed.all === true || Number(parsed.all) > 0 ||
    String(parsed.shares || '').toLowerCase() === 'all' ||
    (amountIn > 0 && marketValue > 0 && amountIn >= marketValue - 0.01)

  // 用户说的是份额时先折成金额：卡片上统一以金额为主口径，份额由它算出来
  let amount = amountIn
  if (!amount && sharesIn > 0 && price > 0) amount = round2(sharesIn * price)
  if (wantsAll) amount = round2(marketValue)

  const plan = planRedeem({ amount, price, held, all: wantsAll, digits })
  const cost = acc ? Number(acc.cost_price) || 0 : 0
  const realized = cost > 0 && price > 0 && plan.shares > 0
    ? round2((price - cost) * plan.shares)
    : null

  return {
    kind: 'account',
    mode: 'redeem',
    account_id: acc ? Number(acc.id) : null,
    account_name: acc ? acc.name : String(parsed.account || parsed.name || '').trim(),
    account_resolved: !!acc,
    to_account_id: to ? Number(to.id) : null,
    to_account_name: to ? to.name : toHint,
    to_account_resolved: !!to,
    // 卡片上改金额或单价后要实时重算，所以把持仓和品种一起带上
    held_shares: held,
    unit: gold ? '克' : '份',
    price,
    price_is_fallback: !!acc && !quoted,
    market_value: round2(marketValue),
    amount: plan.amount || amount,
    shares_out: plan.shares,
    remaining_shares: plan.remaining,
    redeem_all: plan.shares > 0 && plan.remaining <= 0 ? 1 : 0,
    cost_price: cost,
    realized_profit: realized,
    date: ctx.today || todayStr(),
    reply: String(parsed.reply || '').trim()
  }
}

/**
 * 账户草稿
 *
 * 四种模式共用一张卡：
 *   create  —— 新建账户
 *   update  —— 改名称/图标/类型/额度/账单日/持仓
 *   balance —— 调余额（差额按「直接校准」或「记为账目调整账单」落地）
 *   delete  —— 删除账户
 * 余额刻意不与 update 混在一起：改名称和改余额是两件事，
 * 合并会出现「我只是想改个名，结果期初被改掉」这种难查的问题
 */
export function accountDraft(parsed = {}, ctx = {}) {
  // 赎回单独成一条分支：它还要动另一个账户，和「改这个账户的资料」不是一回事
  if (REDEEM_MODES.includes(String(parsed.mode || '').trim())) return redeemDraft(parsed, ctx)

  const accounts = ctx.accounts || []
  const rawName = String(parsed.name || '').trim()
  const accountHint = String(parsed.account || rawName || '').trim()
  const matched = matchByName(accounts, accountHint)
  const acc = matched || null

  let mode = ACCOUNT_MODES.includes(parsed.mode) ? parsed.mode : ''
  if (!mode) mode = acc ? 'update' : 'create'
  // 说"新建"但名字撞上了已有账户：这是要改而不是要建，别生成重复账户
  if (mode === 'create' && acc) mode = 'update'

  const type = ACCOUNT_TYPES.includes(parsed.type) ? parsed.type : (acc?.type || 'cash')

  // 投资账户没有「余额」这个概念：钱是份额 × 行情价。
  // 拿「改成 X 元」去校准它的流水余额，市值一分钱都不会动，用户会以为操作没生效；
  // 所以这种请求一律转成改持仓，让用户去调份额 / 成本单价
  const balanceRequested = mode === 'balance'
  const isInvestmentTarget = acc ? acc.type === 'investment' : type === 'investment'
  if (mode === 'balance' && isInvestmentTarget) mode = 'update'
  const name = (mode === 'create' ? (rawName || accountHint) : rawName || acc?.name || '').trim()
  const icon = String(parsed.icon || '').trim() || acc?.icon || ICON_FALLBACK[name.length % ICON_FALLBACK.length]

  const targetRaw = parsed.balance ?? parsed.targetBalance ?? parsed.amount
  const hasTarget = targetRaw !== undefined && targetRaw !== null && String(targetRaw).trim() !== ''
  const targetBalance = hasTarget ? round2(Math.abs(Number(targetRaw) || 0)) : null
  const currentBalance = acc ? round2(displayBalance(acc)) : 0
  const delta = targetBalance === null ? 0 : round2(targetBalance - currentBalance)

  // 投资账户的「现在值 5000」按当前价折算成份额：市值是份额驱动的，
  // 只改流水余额市值一分钱都不会动。算不出价（没填份额、没行情）就保留原份额，让用户自己填
  let shares = Number(parsed.shares ?? acc?.shares ?? 0) || 0
  let sharesFromTarget = false
  if (balanceRequested && mode === 'update' && isInvestmentTarget && targetBalance !== null && targetBalance > 0) {
    const price = Number(acc?.price) > 0
      ? Number(acc.price)
      : (Number(acc?.shares) > 0 ? Number(acc.display_value) / Number(acc.shares) : 0)
    if (price > 0) {
      shares = Math.round((targetBalance / price) * 10000) / 10000
      sharesFromTarget = true
    }
  }

  // 投资品种决定行情怎么取：黄金按克看金价，基金按代码看净值。
  // 认错会让市值永远按成本价算，所以只在有明确说法时才改，其余沿用原账户设置
  const market = type !== 'investment'
    ? ''
    : (parsed.market === 'gold' || parsed.market === 'fund'
        ? parsed.market
        : (acc?.type === 'investment' && acc?.market ? acc.market : 'fund'))

  return {
    kind: 'account',
    mode,
    account_id: acc ? Number(acc.id) : null,
    account_name: acc ? acc.name : accountHint,
    account_resolved: !!acc,
    name,
    type,
    icon,
    // 期初余额只在新建时有意义；改余额一律走 balance 模式
    initial_balance: mode === 'create' ? round2(Math.abs(Number(parsed.balance ?? 0))) : 0,
    credit_limit: round2(Math.abs(Number(parsed.creditLimit ?? acc?.credit_limit ?? 0))),
    bill_day: String(parsed.billDay ?? acc?.bill_day ?? 1),
    repay_day: String(parsed.repayDay ?? acc?.repay_day ?? 1),
    symbol: String(parsed.symbol || acc?.symbol || '').trim(),
    market,
    shares,
    cost_price: Number(parsed.costPrice ?? acc?.cost_price ?? 0) || 0,
    target_balance: targetBalance,
    // 用户本来是想改余额，但因为投资账户没有余额口径而转成改持仓：卡片上要解释清楚
    balance_requested: balanceRequested && mode === 'update',
    // 份额是按目标市值折算出来的，卡片要说明是建议值，用户可以再改
    shares_from_target: sharesFromTarget,
    // 差额怎么处理必须由用户来定：AI 只负责算差额，
    // 要不要记进流水是会影响当月收支和预算的事，不能替用户默认
    balance_mode: parsed.balanceMode === 'bill' || parsed.balanceMode === 'offset'
      ? parsed.balanceMode
      : '',
    current_balance: currentBalance,
    delta,
    reply: String(parsed.reply || '').trim()
  }
}

export function accountValidate(draft) {
  if (!draft || !ACCOUNT_MODES.includes(draft.mode)) return '无法识别的账户操作'
  if (draft.mode === 'create') {
    if (!String(draft.name || '').trim()) return '账户名称不能为空'
    if (draft.name.length > 12) return '账户名称别超过 12 个字'
  } else if (!draft.account_id) {
    return '请选择要操作的账户'
  }

  if (draft.mode === 'delete') return ''

  if (draft.mode === 'redeem') {
    if (!draft.to_account_id) return '请选择这笔钱转入哪个账户'
    if (Number(draft.account_id) === Number(draft.to_account_id)) return '转出和转入不能是同一个账户'
    if (!(Number(draft.held_shares) > 0)) return '这个账户已经没有持仓可赎回'
    if (!(Number(draft.price) > 0)) return '拿不到单价，先在卡片上填当前净值/金价'
    const plan = planRedeem({
      amount: draft.amount,
      price: draft.price,
      held: draft.held_shares,
      all: Number(draft.redeem_all) > 0,
      digits: draft.unit === '克' ? 4 : 2
    })
    if (!(plan.shares > 0)) return '填一下赎回金额，或打开「全部赎回」'
    return ''
  }

  if (draft.mode === 'balance') {
    if (draft.target_balance === null || draft.target_balance === undefined) return '请填写调整后的余额'
    if (draft.balance_mode !== 'bill' && draft.balance_mode !== 'offset') {
      return '请先选择这笔差额怎么处理'
    }
    return ''
  }

  // update 只要求选到账户；create 还要看类型相关的必填项
  if (draft.type === 'investment') {
    if (!(Number(draft.shares) > 0)) return '投资账户要填持有份额'
    if (draft.symbol && !/^\d{6}$/.test(draft.symbol)) return '基金代码要填 6 位数字'
  }
  if (draft.type === 'credit' && !(Number(draft.credit_limit) > 0)) return '信用账户要填信用额度'
  return ''
}

export function accountFields(draft = {}, ctx = {}) {
  if (draft.mode === 'delete') return []

  // 赎回：可改的只有金额、单价和转入账户，份额由它们算出来，不单独给输入框
  if (draft.mode === 'redeem') {
    const others = (ctx.accounts || [])
      .filter(a => a && a.type !== 'investment' && Number(a.id) !== Number(draft.account_id))
      .map(a => ({ value: Number(a.id), label: a.name }))
    return [
      {
        key: 'amount',
        label: '赎回金额',
        type: 'number',
        unit: '元',
        // 清仓时金额就是全部市值，再让用户改反而会自相矛盾
        showWhen: { key: 'redeem_all', value: 0 }
      },
      { key: 'price', label: `单价（元/${draft.unit || '份'}）`, type: 'number' },
      { key: 'to_account_id', label: '转入账户', type: 'select', options: others },
      { key: 'redeem_all', label: '全部赎回', type: 'switch', desc: '把持仓一次性卖完' }
    ]
  }

  if (draft.mode === 'balance') {
    return [
      { key: 'target_balance', label: '改成', type: 'number', unit: '元' },
      {
        key: 'balance_mode',
        label: '这笔差额怎么处理',
        type: 'select',
        options: [
          { value: '', label: '请选择' },
          { value: 'bill', label: '记一笔调整，进流水（计入收支统计）' },
          { value: 'offset', label: '只校准余额，不进流水（收支不变）' }
        ]
      }
    ]
  }

  const fields = [
    { key: 'name', label: '账户名称', type: 'text' }
  ]
  // 类型只在新建时改：改类型会让历史流水的口径跟着变，风险太大
  if (draft.mode === 'create') {
    fields.push({
      key: 'type',
      label: '账户类型',
      type: 'select',
      options: ACCOUNT_TYPES.map(t => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))
    })
  }
  fields.push({ key: 'icon', label: '图标', type: 'text', desc: '填一个 emoji', optional: true })
  if (draft.mode === 'create') {
    fields.push({
      key: 'initial_balance',
      label: isLiabilityType(draft.type) ? '当前欠款' : '期初余额',
      type: 'number',
      unit: '元',
      optional: true
    })
    // 品种只在新建时选：它决定这个账户以后按金价还是按基金净值算市值
    fields.push({
      key: 'market',
      label: '投资品种',
      type: 'select',
      options: [
        { value: 'fund', label: '基金（按代码取净值）' },
        { value: 'gold', label: '黄金（按克取金价）' }
      ],
      showWhen: { key: 'type', value: 'investment' }
    })
  }
  fields.push(
    {
      key: 'credit_limit',
      label: '信用额度',
      type: 'number',
      unit: '元',
      showWhen: { key: 'type', value: 'credit' }
    },
    {
      key: 'bill_day',
      label: '账单日',
      type: 'text',
      desc: '1-31',
      optional: true,
      showWhen: { key: 'type', value: 'credit' }
    },
    {
      key: 'repay_day',
      label: '还款日',
      type: 'text',
      desc: '1-31',
      optional: true,
      showWhen: { key: 'type', value: 'credit' }
    },
    ...(draft.market === 'gold'
      // 黄金按克计价，没有基金代码，给它一个代码输入框只会让用户乱填
      ? []
      : [{
          key: 'symbol',
          label: '基金代码',
          type: 'text',
          optional: true,
          showWhen: { key: 'type', value: 'investment' }
        }]),
    {
      key: 'shares',
      label: draft.market === 'gold' ? '持有克数' : '持有份额',
      type: 'number',
      showWhen: { key: 'type', value: 'investment' }
    },
    {
      key: 'cost_price',
      label: '成本单价',
      type: 'number',
      unit: draft.market === 'gold' ? '元/克' : '元',
      optional: true,
      showWhen: { key: 'type', value: 'investment' }
    }
  )
  return fields
}

// 各 skill 的校验分派
export function validateDraft(draft) {
  switch (draft?.kind) {
    case 'budget': return budgetValidate(draft)
    case 'recurring': return recurringValidate(draft)
    case 'category': return categoryValidate(draft)
    case 'tag': return tagValidate(draft)
    case 'account': return accountValidate(draft)
    default: return '无法识别的操作'
  }
}

/**
 * 解析第一阶段的 intent，只认 "skill:xxx" 形式且 xxx 在已注册列表里
 * 抽成纯函数是为了脱离数据库/网络单测
 */
export function parseSkillId(intent, validIds = []) {
  const match = /^skill:([a-z]+)$/i.exec(String(intent || '').trim())
  if (!match) return null
  const id = match[1].toLowerCase()
  return validIds.includes(id) ? id : null
}

/**
 * intent 可能是单个字符串，也可能是数组
 * 用户一句话里同时要「建周期」和「建预算」时必须两个都认，否则只会执行一半
 */
export function parseSkillIds(intent, validIds = []) {
  const list = Array.isArray(intent) ? intent : [intent]
  const out = []
  for (const item of list) {
    const id = parseSkillId(item, validIds)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

// 补录起点推导用：把某个日期按周期往前推
export function previousDate(dateStrValue, frequency) {
  if (frequency === 'monthly') return addMonths(dateStrValue, -1)
  if (frequency === 'yearly') return addMonths(dateStrValue, -12)
  const d = parseDate(dateStrValue)
  const days = frequency === 'weekly' ? 7 : 1
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - days))
}
