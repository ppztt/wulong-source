// 工资税前 → 税后计算（中国大陆，居民个人工资薪金）
//
// 口径说明：
//   1. 用累计预扣预缴法：累计应纳税所得额 = 累计收入 - 累计减除费用(5000/月)
//      - 累计专项扣除(五险一金个人部分) - 累计专项附加扣除
//   2. 本月个税 = 累计应纳税额 - 之前月份累计已预缴
//   3. 之前月份按「每月工资与扣除都不变」推算，这是最常见的情况；
//      年终奖、调薪、补发等不在模型内，结果仅供参考
//
// 纯函数，不碰存储也不碰网络，方便单测

export const MONTHLY_EXEMPTION = 5000

// 个人所得税预扣率表一（居民个人工资薪金所得）
export const TAX_BRACKETS = [
  { limit: 36000, rate: 0.03, quick: 0 },
  { limit: 144000, rate: 0.1, quick: 2520 },
  { limit: 300000, rate: 0.2, quick: 16920 },
  { limit: 420000, rate: 0.25, quick: 31920 },
  { limit: 660000, rate: 0.3, quick: 52920 },
  { limit: 960000, rate: 0.35, quick: 85920 },
  { limit: Infinity, rate: 0.45, quick: 181920 }
]

// 个人缴纳比例默认值（各地略有差异，界面上可改）
export const DEFAULT_RATES = {
  pension: 8,        // 养老
  medical: 2,        // 医疗
  unemployment: 0.5, // 失业
  housing: 7         // 住房公积金
}

export const SOCIAL_LABEL = {
  pension: '养老',
  medical: '医疗',
  unemployment: '失业',
  housing: '公积金'
}

// 专项附加扣除的标准额度（元/月）
export const SPECIAL_PRESETS = [
  { key: 'child', label: '子女教育', amount: 2000, hint: '每个子女' },
  { key: 'infant', label: '婴幼儿照护', amount: 2000, hint: '3 岁以下' },
  { key: 'education', label: '继续教育', amount: 400, hint: '学历教育' },
  { key: 'housingLoan', label: '房贷利息', amount: 1000, hint: '首套房' },
  { key: 'rent', label: '住房租金', amount: 1500, hint: '按城市档次' },
  { key: 'elderly', label: '赡养老人', amount: 3000, hint: '独生子女' }
]

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function bracketOf(taxable) {
  const value = Math.max(0, Number(taxable) || 0)
  return TAX_BRACKETS.find(b => value <= b.limit) || TAX_BRACKETS[TAX_BRACKETS.length - 1]
}

// 累计应纳税额
export function taxOfTaxable(taxable) {
  const value = Math.max(0, Number(taxable) || 0)
  if (!value) return 0
  const b = bracketOf(value)
  return Math.max(0, round2(value * b.rate - b.quick))
}

// 五险一金个人部分
export function socialOf({ base, rates = DEFAULT_RATES }) {
  const amount = Math.max(0, Number(base) || 0)
  const detail = {}
  let total = 0
  for (const key of Object.keys(DEFAULT_RATES)) {
    const pct = Number(rates?.[key]) || 0
    const value = round2(amount * pct / 100)
    detail[key] = value
    total += value
  }
  return { detail, total: round2(total) }
}

export function specialTotal(specials = {}) {
  let total = 0
  for (const item of SPECIAL_PRESETS) {
    total += Math.max(0, Number(specials?.[item.key]) || 0)
  }
  return round2(total)
}

/**
 * 计算某个月的工资明细
 * @param {number} gross   税前月薪
 * @param {number} monthIndex 本月是今年第几个月（1-12）
 * @param {number|null} base 五险一金缴费基数，留空按税前工资
 * @param {object} rates   个人缴纳比例（百分数）
 * @param {object} specials 专项附加扣除金额
 * @param {number|null} priorTaxPaid 之前月份已预缴个税合计，留空则按等额工资推算
 */
export function computeSalary({
  gross = 0, monthIndex = 1, base = null, rates = DEFAULT_RATES,
  specials = {}, priorTaxPaid = null
} = {}) {
  const income = Math.max(0, Number(gross) || 0)
  const month = Math.min(12, Math.max(1, Math.round(Number(monthIndex) || 1)))
  const socialBase = base !== null && base !== undefined && String(base) !== '' && Number(base) >= 0
    ? Math.max(0, Number(base))
    : income

  const social = socialOf({ base: socialBase, rates })
  const special = specialTotal(specials)
  // 每月固定扣除：减除费用 + 五险一金个人部分 + 专项附加扣除
  const monthlyDeduction = MONTHLY_EXEMPTION + social.total + special

  const cumulative = {
    months: month,
    income: round2(income * month),
    deduction: round2(monthlyDeduction * month),
    taxable: 0,
    tax: 0
  }
  cumulative.taxable = Math.max(0, round2(cumulative.income - cumulative.deduction))
  cumulative.tax = taxOfTaxable(cumulative.taxable)

  // 之前月份累计已预缴：有手填值就用手填，否则按同样口径推算
  let priorTax
  if (priorTaxPaid !== null && priorTaxPaid !== undefined && String(priorTaxPaid) !== '') {
    priorTax = Math.max(0, Number(priorTaxPaid) || 0)
  } else {
    const prevTaxable = Math.max(0, round2(income * (month - 1) - monthlyDeduction * (month - 1)))
    priorTax = taxOfTaxable(prevTaxable)
  }

  const monthlyTax = Math.max(0, round2(cumulative.tax - priorTax))
  const net = round2(income - social.total - monthlyTax)
  const bracket = bracketOf(cumulative.taxable)

  return {
    gross: round2(income),
    month,
    socialBase: round2(socialBase),
    social: social.detail,
    socialTotal: social.total,
    specialTotal: special,
    monthlyDeduction: round2(monthlyDeduction),
    taxableThisMonth: Math.max(0, round2(income - monthlyDeduction)),
    monthlyTax,
    priorTax: round2(priorTax),
    rate: bracket.rate,
    // 当月个税占税前比例，界面上用来说明"为什么这个月扣得多"
    taxRate: income > 0 ? round2(monthlyTax / income * 100) : 0,
    net,
    cumulative
  }
}

// 结果为空（还没填工资）时不展示明细
export function hasResult(result) {
  return !!result && Number(result.gross) > 0
}
