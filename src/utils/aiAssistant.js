// AI 助手的业务语义层：提示词构造、模型返回解析、分析上下文组装
// 纯函数，不碰网络也不碰存储，方便单独测试

import {
  todayStr, dateOf, periodRange, shiftPeriod, prevMonthSameDay,
  rangeTotals, groupByDimension, compareTotals
} from './finance'
import { describeAccountValue, describePortfolio } from './accountValuation'

// 首页/对话页展示的快捷问句
export const QUICK_PROMPTS = [
  { label: '记一笔', text: '昨天中午吃面 28，现金付的' },
  { label: '本月花哪了', text: '这个月钱都花在哪了' },
  { label: '我手上有多少钱', text: '我总共有多少钱，包括投资账户' },
  { label: '改余额', text: '把余额宝余额改成 8000' },
  { label: '问知识', text: '信用卡账单日和还款日有什么区别' }
]

function money(n) {
  return (Number(n) || 0).toFixed(2)
}

function weekdayText(dateStr) {
  const names = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return names[new Date(y, (m || 1) - 1, d || 1).getDay()]
}

function shiftDate(dateStr, delta) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, (d || 1) + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// ========== 提示词 ==========

/**
 * 构造记账解析用的 system prompt
 *
 * 两条关键设计：
 * 1. 让模型输出「名称」而不是 id。模型编造数字 id 的概率远高于编造名称，
 *    而名称可以在前端按真实词表做一次匹配校验，对不上还能让用户手动补选。
 * 2. 这段文本里绝不能出现今天的日期。DeepSeek 的上下文缓存按 token 前缀匹配，
 *    日期一旦写进 system，跨天甚至换了时刻就会让后面两千多 token 全部 miss。
 *    日期基准改由 buildTimeContext 拼在 user 消息里（那是本来就每次唯一的部分）。
 *
 * 内容按「变化频率」从低到高排列：静态规则 → 词表 → 习惯画像。
 * 这样即便是习惯画像变了，前面的规则和词表仍能命中缓存。
 */
export function buildSystemPrompt({ accounts = [], categories = [], tags = [], skillHints = '', habits = '' }) {
  const expenseCats = categories.filter(c => c.type === 'expense').map(c => c.name)
  const incomeCats = categories.filter(c => c.type === 'income').map(c => c.name)
  const accountNames = accounts.map(a => {
    const suffix = a.type === 'credit' ? '（信用）' : a.type === 'debt' ? '（欠款）' : a.type === 'investment' ? '（投资）' : ''
    return `${a.name}${suffix}`
  })

  return [
    '你是「乌龙记账」App 里的记账助手，名字叫小乌，形象是一只乌龟。语气简洁友好，不说废话。',
    '',
    '你的任务是判断用户想做什么，并且只输出一个 JSON 对象。不要输出 markdown 代码块标记，不要输出任何 JSON 以外的文字。',
    '',
    'JSON 结构：',
    '{"intent":"record","records":[],"reply":"一句话回应，不超过30字"}',
    '',
    '=== intent 的取值 ===',
    '',
    '1) "record"：用户在描述一笔或多笔收支、转账，需要记账。',
    '   records 每一项的字段：',
    '   {',
    '     "type": "expense" | "income" | "transfer",',
    '     "amount": 数字，正数，不要带货币符号,',
    '     "category": "分类名称",',
    '     "account": "账户名称",',
    '     "toAccount": "转入账户名称，仅 transfer 需要，其余留空",',
    '     "date": "YYYY-MM-DD",',
    '     "merchant": "商家名称，没提到就空字符串",',
    '     "note": "简短备注"',
    '   }',
    '   要求：',
    '   - category 必须是【分类清单】里完全一致的名字；给不出就填 ""，不要瞎猜',
    '   - account / toAccount 必须是【账户清单】里完全一致的名字；给不出就填 ""',
    '   - 用户没说日期就用今天；说"昨天""上周五"要按用户消息开头【时间基准】给出的日期算准',
    '   - 一句话里包含多笔就输出多个元素，比如"午饭30打车20"',
    '   - transfer 指账户之间挪钱（如"从银行卡转500到余额宝"），不是收支',
    '   - 只是给账户报了个余额（"余额宝现在 8000"）不是记账，不要走这里',
    '',
    '2) "analysis"：用户在问**自己账本里的数字**——花了多少、哪类花得多、和上月比、要省钱建议。',
    '   records 填 []，reply 写一句简短承接语，比如"我看一下"。',
    '',
    '3) "qa"：其余一切跟记账、钱、这个 App 沾边的问题，都走这里。',
    '   包括概念解释（"免息期怎么算"）、方法建议（"预算该怎么定"）、',
    '   计算求助（"15000 到手多少""房贷月供怎么算"）、功能与操作（"怎么改余额""工资在哪算"）、',
    '   查询类问题（"我黄金账户现在多少钱""我有多少净资产""信用卡还能刷多少"）、',
    '   以及"你能做什么"。records 填 []，reply 留空字符串。',
    '   宁可归到这里，也不要因为"看着像闲聊"就丢给 chat——用户问的是钱的事就该认真答。',
    '',
    '4) "chat"：只有明确与记账和钱无关的寒暄、情绪、闲聊才填这里（"在吗""好累"）。',
    '   records 填 []，reply 直接回答，不超过 30 字。',
    // 配置类操作按需分派：清单由调用方传入，命中后再单独加载对应 skill
    ...(skillHints ? [
      '',
      '5) 配置与账户操作：用户想设置 App 里的东西（预算、周期记账、分类、标签），',
      '   或者要新建账户、改账户资料、改账户余额、删除账户——而不是记一笔账。',
      '   这类你不需要解析字段，把 intent 填成下面列出的值，records 留空，reply 写一句承接语即可。',
      '',
      '可用的配置操作：',
      skillHints,
      '',
      '   一句话里同时涉及多种操作时，intent 用数组把命中的全部列出，**并且必须用 segments 把原话切成对应片段**：',
      '   {"intent":["skill:recurring","skill:budget"],',
      '    "segments":{"skill:recurring":"每月15号房租1500，吃喝600，都从中信银行扣",',
      '                "skill:budget":"再加个生活费预算1000"},',
      '    "records":[],"reply":"好的"}',
      '',
      '   切分规则（非常重要，切错了会生成重复或缺失的卡片）：',
      '   - 每个 skill 只会看到自己那一段，所以片段必须**互不重叠**，一句话不能同时放进两个片段',
      '   - 片段要包含该操作需要的全部信息：金额、名称、账户、时间都留在它所属的那一段里',
      '   - 按时重复的收支（房租、工资、停车费）归 skill:recurring；提到"预算/额度/上限"的那句归 skill:budget',
      '   - 提到"新建账户 / 余额改成 / 改名 / 删掉账户"的那句归 skill:account',
      '   - 只命中一个 skill 时，segments 可以省略或只给那一个 key',
      '   - 不要为了补全信息而把别的话抄进某一段',
      '',
      '   只要涉及配置，一律走这里，不要当成 record 或 chat 处理。',
      '   哪怕配置请求里带了金额（"每月房租1500"）也不要走 record —— 那是在描述规则，不是记一笔已发生的账。',
      '   "把某账户余额改成 8000"同理：那是校准余额，不是在记 8000 的收入。'
    ] : []),
    '',
    '=== 记账常识（用这些规则提高识别率） ===',
    '',
    '金额口语：',
    '- "三十"=30，"一百二"=120，"两块五"=2.5，"三块五毛"=3.5，"半百"=50',
    '- "1千"=1000，"1万"=10000；"十几块"这种模糊说法取常见的 15',
    '- 说"一共/总共/合计"取总额；说"人均/一个人/AA"是单人价，要乘以人数',
    '',
    '时间：',
    '- "刚刚/刚才"=今天，"昨天"=今天减一天，"前天"=减两天，"大前天"=减三天',
    '- "上周三"指上一个自然周的周三，不是七天前',
    '- "月初"=本月 1 号，"月底"=本月最后一天；完全没说时间就用今天',
    '',
    '分类归位：',
    '- 早饭/午饭/晚饭/外卖/奶茶/咖啡/下馆子/零食 → 餐饮',
    '- 地铁/公交/打车/滴滴/高铁/机票/加油/停车 → 交通',
    '- 超市/网购/淘宝/京东/拼多多/日用品/衣服/鞋 → 购物',
    '- 房租/水电/燃气/物业/宽带 → 住房',
    '- 话费/流量/手机费 → 通讯',
    '- 电影/游戏/演出/健身/KTV → 娱乐',
    '- 挂号/买药/体检/看牙 → 医疗',
    '- 学费/买书/培训/网课 → 教育',
    '',
    '账户识别：',
    '- "刷卡/信用卡/透支" → 名称或类型为信用卡的账户',
    '- "支付宝/花呗" → 名称含支付宝或余额宝的账户',
    '- "微信/零钱" → 名称含微信的账户',
    '- "建行/招行/工行/农行"等 → 名称含对应银行简称的账户',
    '- "现金/付现" → 名称含现金的账户',
    '',
    '容易判错的：',
    '- "还信用卡 2000" 是 transfer（钱从卡里还到信用卡），不是支出',
    '- "从微信提现到银行卡" 是 transfer，两边都是自己的账户',
    '- 工资、红包、报销到账、退款退货 → 都是 income',
    '- "垫付/借给同事" 仍然是 expense（钱确实出去了）',
    '- "分期付款买了 6000 的手机" 是一笔记 6000 的支出，不要拆成多笔',
    '- 拿不准的字段一律留空，让用户自己补，不要编一个看起来合理的值',
    '',
    '【分类清单】',
    `支出：${expenseCats.join('、') || '（暂无）'}`,
    `收入：${incomeCats.join('、') || '（暂无）'}`,
    '',
    '【账户清单】',
    accountNames.join('、') || '（暂无）',
    '',
    tags.length ? `【标签清单】\n${tags.map(t => t.name).join('、')}` : '',
    '',
    // 习惯画像放在最后：它是整段提示词里唯一每天都会变的部分，
    // 摆尾部才能让它前面的规则和词表继续命中缓存
    habits ? `【用户习惯】\n${habits}` : '',
    '',
    '记住：任何时候都只输出 JSON 对象。'
  ].filter(line => line !== null && line !== undefined).join('\n')
}

/**
 * 时间基准：拼在最后一条 user 消息的最前面
 * 单独抽出来是因为它必须待在 system 之外——写进 system 会让缓存前缀每天断裂
 */
export function buildTimeContext(dateStr = todayStr()) {
  const today = dateStr
  return `【时间基准】今天 ${today}（${weekdayText(today)}），昨天 ${shiftDate(today, -1)}，前天 ${shiftDate(today, -2)}。`
}

/**
 * 图片记账时附在 user 消息里的指引
 *
 * 放 user 而不是 system 的原因：system 必须逐字节稳定才能命中缓存，
 * 把这段塞进 system 会让所有文本记账也背上它，还让两种场景的提示词分叉。
 * 放 user 侧则完全不影响缓存前缀。
 */
export const IMAGE_RECORD_HINT = [
  '【用户发来了一张图片，通常是账单截图、支付记录或消费小票】',
  '请把图中能看到的每一笔消费都提取出来，每笔生成一个 record。要求：',
  '- 金额取实际支付/收入的金额；有优惠券、立减、满减的，取最终实付的那个数',
  '- 日期取图中显示的交易时间，只要到日；图中没有日期就用今天',
  '- 商家填商户名称，备注放商品名或用途',
  '- 分类按消费内容判断，必须用【分类清单】里完全一致的名字',
  '- 图中看不清、拿不准的字段一律留空，不要编造任何图中没有的记录',
  '- 这是账单向导而不是普通对话，intent 必须是 record，不要输出 chat 或 analysis'
].join('\n')

/**
 * 投资账户持仓识别的 system prompt
 *
 * 与记账图片识别是两套语义：那边每一笔都是钱进钱出，这边一张截图只是一份「账户档案」，
 * 认错了会直接把份额、成本价写进账户，市值和盈亏全跟着错，所以字段要少、口径要死。
 */
export function buildHoldingScanPrompt() {
  return [
    '你是「乌龙记账」的持仓识别助手，用户会发来基金 App 或黄金积存 App 的持仓/资产详情截图。',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字：',
    '{"name":"产品名称","market":"fund","symbol":"020741","shares":2520.52,"cost_price":1.1902,"amount":3003.70}',
    '',
    '字段规则：',
    '- name：产品全称，例如「华泰保兴安悦债券C」',
    '- symbol：6 位数字基金代码。通常出现在产品名下方的小字里，或标注为「基金代码」；只取数字，看不到就填 ""',
    '- market：债券/股票/混合/指数/QDII/货币等基金填 "fund"；黄金积存、积存金、按克计价的填 "gold"',
    '- shares：取「持有份额」；黄金类取持有克数',
    '- cost_price：取「持仓成本价」；黄金类取每克成本单价',
    '- amount：取「持有金额 / 持仓金额 / 资产金额」，仅作参考，没有就填 0',
    '',
    '注意：',
    '- 这是账户档案信息，不是一笔消费，不要把任何金额当成记账金额',
    '- 数字只取值本身，去掉千分位逗号、货币符号和百分号',
    '- 认不出来的字段一律留空字符串或 0，绝对不要编造'
  ].join('\n')
}

/**
 * 校验模型返回的持仓信息。任何一项对不上就丢弃该项，绝不把可疑数字写进账户
 * @returns {null | { name: string, market: 'fund'|'gold', symbol: string, shares: number, cost_price: number, amount: number }}
 */
export function parseHoldingScan(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null

  const num = (v) => {
    const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''))
    return Number.isFinite(n) ? n : 0
  }

  const name = String(raw.name || '').trim()
  const digits = String(raw.symbol ?? raw.code ?? '').replace(/\D/g, '').slice(0, 6)
  const symbol = digits.length === 6 ? digits : ''
  const shares = num(raw.shares)
  const costPrice = num(raw.cost_price ?? raw.costPrice)
  const amount = num(raw.amount)
  // 黄金没有基金代码，截图也可能把代码裁掉，所以代码不是必需项
  const market = raw.market === 'gold' ? 'gold' : 'fund'

  // 三个业务字段全空就是没认出来，直接当失败处理，避免给表单填一堆 0
  if (!name && !shares && !amount) return null

  return { name, market, symbol, shares, cost_price: costPrice, amount }
}

// 分析类问题的 system prompt（第二段调用，允许输出自然语言）
export function buildAnalysisPrompt({ accounts = [] }) {
  return [
    '你是「乌龙记账」App 里的记账助手小乌，正在帮用户分析他自己的账本。',
    '下面会给你一份本地统计摘要，数据全部来自用户自己的记账数据，请严格基于这些数字回答，不要编造条目。',
    '',
    '回答要求：',
    '- 用中文口语，像一个靠谱的朋友，不要念报表',
    '- 先给结论，再给 2~3 条具体原因，最后给最多 2 条可执行建议',
    '- 提到金额时保留两位小数，带上"元"',
    '- 全文控制在 200 字以内，不要用 markdown 标题和表格，可以用短横线列表',
    '- 如果数据显示没什么异常，就直说，不要硬找问题',
    '- 摘要里的【资产总览】【账户金额】是账户金额的唯一口径：投资账户是「份额 × 行情价」的市值，',
    '  不要用流水余额去推算，也不要自己把账户重新加总',
    '',
    `用户目前有 ${accounts.length} 个账户。`
  ].join('\n')
}

// ========== 返回解析 ==========

// 模型偶尔会套一层 ```json 或者前后多说一句，这里做宽松提取
export function extractJson(text) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : raw
  try {
    return JSON.parse(candidate)
  } catch {
    // 退一步：截取第一个 { 到最后一个 } 之间的内容
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}

// ========== 容错解析：把模型返回拆成「操作数组」 ==========

// 模型可能把列表包在这些字段里，按可能性从高到低
const LIST_KEYS = ['items', 'list', 'rules', 'budgets', 'records', 'data', 'result']

function tryParseJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * 扫描文本里所有顶层 JSON 值（对象或数组），返回原始字符串
 * 必须跳过字符串内部的括号，否则备注里带个 "{" 就会把配平算错
 */
function scanJsonValues(text) {
  const out = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}' || ch === ']') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  return out
}

// 把一个 JSON 值规整成「对象数组」：数组直接用，带列表字段的对象取列表，普通对象包一层
function normalizeToItems(value) {
  if (Array.isArray(value)) {
    return value.filter(v => v && typeof v === 'object' && !Array.isArray(v))
  }
  if (value && typeof value === 'object') {
    const key = LIST_KEYS.find(k => Array.isArray(value[k]))
    if (key) {
      return value[key].filter(v => v && typeof v === 'object' && !Array.isArray(v))
    }
    return [value]
  }
  return []
}

/**
 * 容错解析成操作数组，专供配置类 skill 使用
 *
 * 为什么不用 extractJson：它只返回「第一个值」，而这里必须拿到全部操作。
 * 实测模型面对「建两个周期」时会输出三种形态，都必须能接住：
 *   1. 数组：[{...},{...}]
 *   2. 包一层：{"items":[{...},{...}]}
 *   3. 裸拼接：{...}\n{...}   ← 这种 JSON.parse 必然失败，只能靠括号配平逐个切
 */
export function extractJsonItems(text) {
  const raw = String(text || '').trim()
  if (!raw) return []

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1].trim() : raw

  // 整体合法就直接用，这是最常见也最省事的情况
  const whole = tryParseJson(body)
  if (whole !== null) {
    const items = normalizeToItems(whole)
    if (items.length) return items
  }

  // 退一步：括号配平切出每个顶层值
  // 拼接多个对象时整段解析会失败，但每一段单独都是合法的
  const values = []
  for (const chunk of scanJsonValues(body)) {
    const parsed = tryParseJson(chunk)
    if (parsed !== null) values.push(parsed)
  }

  // 优先认「带列表字段的对象」：{"items":[...]} 里的数组就是完整操作集，
  // 其余零散值多半是模型顺手写的说明对象，不要混进来
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const key = LIST_KEYS.find(k => Array.isArray(value[k]))
    if (!key) continue
    const items = value[key].filter(v => v && typeof v === 'object' && !Array.isArray(v))
    if (items.length) return items
  }

  // 其次才是多个裸对象拼接：全部收集，每一项都是一次操作
  const collected = []
  for (const value of values) collected.push(...normalizeToItems(value))
  return collected
}

// 名称模糊匹配：先精确，再忽略空白，最后做双向包含
export function matchByName(list, name) {
  const target = String(name || '').trim()
  if (!target) return null

  const exact = list.find(item => String(item.name).trim() === target)
  if (exact) return exact

  const loose = list.find(item => String(item.name).replace(/\s/g, '') === target.replace(/\s/g, ''))
  if (loose) return loose

  const contained = list.find(item => {
    const n = String(item.name)
    return n.includes(target) || target.includes(n)
  })
  return contained || null
}

const VALID_TYPES = ['expense', 'income', 'transfer']

// 口语说法 → 账户
// generic 标记的是「泛化描述」：只说"刷卡"时不该在多家信用卡里瞎猜
const ACCOUNT_ALIAS_RULES = [
  // 具体渠道与银行：文本里出现就能唯一定位
  { pattern: /支付宝|花呗/, words: ['支付宝', '余额宝', '花呗'] },
  { pattern: /微信|零钱/, words: ['微信', '零钱'] },
  { pattern: /云闪付/, words: ['云闪付'] },
  { pattern: /建行|建设银行/, words: ['建行', '建设'] },
  { pattern: /工行|工商银行/, words: ['工行', '工商'] },
  { pattern: /招行|招商银行/, words: ['招行', '招商'] },
  { pattern: /农行|农业银行/, words: ['农行', '农业'] },
  { pattern: /中行|中国银行/, words: ['中行', '中国银行'] },
  { pattern: /交行|交通银行/, words: ['交行', '交通'] },
  { pattern: /邮储|邮政储蓄/, words: ['邮储', '邮政'] },
  { pattern: /中信/, words: ['中信'] },
  { pattern: /民生/, words: ['民生'] },
  { pattern: /浦发/, words: ['浦发'] },
  { pattern: /兴业/, words: ['兴业'] },
  // 泛化描述：只在账户名正好是这个词、或同类账户唯一时才用
  { pattern: /信用卡|刷卡|透支|贷记/, type: 'credit', generic: true, words: ['信用卡', '贷记卡'] },
  // 纯欠款：借呗、白条、私人借款、房贷车贷都属于「有余额没额度」的欠款账户
  { pattern: /借呗|白条|借款|欠款|欠朋友|房贷|车贷|贷款/, type: 'debt', generic: true, words: ['借呗', '白条', '借款', '欠款', '贷款'] },
  { pattern: /现金|付现|现钞/, type: 'cash', generic: true, words: ['现金'] }
]

/**
 * 从整句文本里推断账户
 * 五轮，越往后越保守：
 *   1. 账户名本体出现在句子里（用户明说了，最可信）
 *   2. 历史学到的说法映射，比如他一直说"奶茶"就是微信付的
 *   3. 具体渠道/银行词 → 账户名里带这个词
 *   4. 泛化词（刷卡/现金）→ 账户名正好等于该词
 *   5. 同类账户唯一时才按类型猜
 *
 * 习惯映射排在银行规则之前：规则只认"建行/支付宝"这类通用词，
 * 而习惯能覆盖"奶茶""加油"这种与渠道无关、只看个人用法的说法。
 */
export function inferAccountFromText(text, accounts = [], habits = null) {
  const src = String(text || '')
  if (!src || !accounts.length) return null

  // 第一轮：账户名本体或其去掉后缀的形式
  let best = null
  let bestLen = 0
  for (const acc of accounts) {
    const name = String(acc.name || '').trim()
    if (!name) continue
    const candidates = [name, name.replace(/(卡|账户|钱包|零钱)$/, '')]
    for (const word of candidates) {
      if (word && word.length >= 2 && src.includes(word) && word.length > bestLen) {
        best = acc
        bestLen = word.length
      }
    }
  }
  if (best) return best

  // 第二轮：用户历史上固定这么说的词
  // 取最长命中，避免"奶茶"和"奶茶店"这类包含关系选错
  const patterns = habits?.patterns || []
  let patternHit = null
  let patternLen = 0
  for (const p of patterns) {
    const key = String(p?.key || '')
    if (key.length < 2 || !src.includes(key)) continue
    if (key.length <= patternLen) continue
    const acc = accounts.find(a => Number(a.id) === Number(p.accountId))
    if (!acc) continue
    patternHit = acc
    patternLen = key.length
  }
  if (patternHit) return patternHit

  // 第三轮：具体渠道词，比如"中信刷卡"里的"中信"
  for (const rule of ACCOUNT_ALIAS_RULES) {
    if (rule.generic || !rule.pattern.test(src)) continue
    const hit = accounts.find(a => rule.words.some(w => String(a.name).includes(w)))
    if (hit) return hit
  }

  // 第四轮：泛化词，只认名字正好是它的账户（"信用卡"账户）
  for (const rule of ACCOUNT_ALIAS_RULES) {
    if (!rule.generic || !rule.pattern.test(src)) continue
    const exact = accounts.find(a => rule.words.includes(String(a.name).trim()))
    if (exact) return exact
  }

  // 第五轮：同类账户唯一时才敢猜，多家信用卡时宁可不猜
  for (const rule of ACCOUNT_ALIAS_RULES) {
    if (!rule.generic || !rule.pattern.test(src)) continue
    const sameType = accounts.filter(a => a.type === rule.type)
    if (sameType.length === 1) return sameType[0]
  }

  return null
}

/**
 * 把模型给的名称落到真实的 id 上，并做一次合法性兜底
 * 返回的每一项都带 resolved 标记：分类/账户没匹配上时为 null，界面让用户手动补
 * text 是用户原话，模型没给账户时用它再兜一次；habits 提供历史学到的说法映射
 */
export function resolveRecords(records, { accounts = [], categories = [], text = '', habits = null } = {}) {
  if (!Array.isArray(records)) return []

  // 整句推断只做一次，多笔记录共用同一个兜底账户
  const inferredAccount = inferAccountFromText(text, accounts, habits)

  return records.map(item => {
    const type = VALID_TYPES.includes(item?.type) ? item.type : 'expense'
    const amount = Math.abs(Number(item?.amount) || 0)

    // 转账不涉及分类；收支按类型去对应词表里找，避免收入账记到支出分类上
    const categoryPool = categories.filter(c => c.type === type)
    const category = type === 'transfer' ? null : matchByName(categoryPool, item?.category)
    const matchedAccount = matchByName(accounts, item?.account)
    const account = matchedAccount || (type === 'transfer' && item?.toAccount ? null : inferredAccount)
    const toAccount = type === 'transfer'
      ? (matchByName(accounts, item?.toAccount) || inferredAccount)
      : null

    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || ''))
      ? String(item.date)
      : todayStr()

    return {
      type,
      amount,
      date,
      merchant: String(item?.merchant || '').trim(),
      note: String(item?.note || '').trim(),
      category_id: category ? Number(category.id) : null,
      category_name: category ? category.name : '',
      category_icon: category ? category.icon : '📌',
      account_id: account ? Number(account.id) : null,
      account_name: account ? account.name : '',
      account_icon: account ? account.icon : '💳',
      to_account_id: toAccount ? Number(toAccount.id) : null,
      to_account_name: toAccount ? toAccount.name : '',
      // 金额为 0 或转账缺少目标账户时不能直接入库
      valid: amount > 0 && (type !== 'transfer' || (!!toAccount && Number(toAccount.id) !== Number(account?.id)))
    }
  })
}

// ========== 分析上下文 ==========

/**
 * 把本地交易聚合成一段紧凑文本喂给模型
 * 只上传统计结果，不上传原始流水，减少泄露面也省 token
 */
export function buildAnalysisContext({ transactions = [], accounts = [], budgets = [] }) {
  const today = todayStr()
  const monthRange = periodRange(today, 'monthly')
  // 统计口径必须截到今天：写整月范围会让模型以为数据已齐，说出「还有多少天」这类错话
  const range = { start: monthRange.start, end: today }
  // 环比也要同期比同期，拿半个月去比上月整月没有横向意义
  const prev = {
    start: shiftPeriod(monthRange, 'monthly', -1).start,
    end: prevMonthSameDay(today)
  }

  const cur = rangeTotals(transactions, range)
  const last = rangeTotals(transactions, prev)
  const cmp = compareTotals(cur, last)

  const pct = (n) => (n === null ? '无法计算' : `${n > 0 ? '+' : ''}${n}%`)
  const ratio = (n) => (cur.expense > 0 ? `(${Math.round((n / cur.expense) * 100)}%)` : '')

  const byCat = groupByDimension(transactions, range, 'category', 'expense').slice(0, 8)
  const byAcc = groupByDimension(transactions, range, 'account', 'expense').slice(0, 5)

  // 本周期最大的一笔支出，帮模型定位"哪一下花多了"
  let biggest = null
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const d = dateOf(t)
    if (d < range.start || d > range.end) continue
    const amount = Number(t.amount) || 0
    if (!biggest || amount > biggest.amount) biggest = { amount, date: d, t }
  }

  const lines = []
  lines.push(`【统计区间】${range.start} ~ ${range.end}（本月累计至今，不是整月数据）`)
  lines.push(`【收支】支出 ${money(cur.expense)} 元，收入 ${money(cur.income)} 元，结余 ${money(cur.balance)} 元`)
  lines.push(`【对比上月同期（${prev.start} ~ ${prev.end}）】支出 ${pct(cmp.expense.percent)}，收入 ${pct(cmp.income.percent)}`)
  lines.push(
    `【本月支出分类】${byCat.length
      ? byCat.map(c => `${c.name} ${money(c.total)}${ratio(c.total)}`).join('、')
      : '暂无支出'}`
  )
  if (byAcc.length) {
    lines.push(`【本月支出账户】${byAcc.map(a => `${a.name} ${money(a.total)}`).join('、')}`)
  }
  if (biggest) {
    const merchant = biggest.t.merchant ? `（${biggest.t.merchant}）` : ''
    lines.push(`【最大单笔】${biggest.date.slice(5)} ${biggest.t.category_name || '未分类'} ${money(biggest.amount)} 元${merchant}`)
  }

  if (accounts.length) {
    // 汇总放在明细前面：模型回答「我有多少钱」时优先用这个权威数字，
    // 而不是自己把账户列表加一遍（漏掉投资市值或把欠款加反）
    const portfolio = describePortfolio(accounts)
    if (portfolio) lines.push(`【资产总览】${portfolio}`)
    // 投资账户的钱是「份额 × 行情价」，不能拿流水余额当余额报给用户，
    // 口径统一交给 describeAccountValue（调用方已用 valueAccounts 补过市值）
    const accText = accounts.map(a => `${a.name} ${describeAccountValue(a)}`)
    lines.push(`【账户金额】${accText.join('、')}`)
  }

  for (const b of budgets) {
    if (!b.enabled) continue
    const label = b.scope === 'total' ? '总预算' : `${b.category_name || '分类'}预算`
    lines.push(`【${label}】${money(b.amount)} 元 / ${b.period === 'weekly' ? '每周' : b.period === 'yearly' ? '每年' : '每月'}`)
  }

  return lines.join('\n')
}

// ========== 导入时的分类归并 ==========

/**
 * 构造「把外部分类归并到本地分类」的提示词
 *
 * 场景：从别的 App 导入流水后，源数据里的「餐饮美食」「伙食」会在本账本里各建一个新分类，
 * 和已有的「餐饮」并列，报表就散了。这里让模型判断哪些能归并。
 *
 * 归并比新建危险：归错了等于把钱记到错误的类别里，而且事后很难发现。
 * 所以提示词里反复强调保守，判断不了就留空。
 */
export function buildCategoryMapPrompt({ existing = [], incoming = [] } = {}) {
  const side = (type, label) => {
    const names = existing.filter(c => c.type === type).map(c => c.name)
    return `${label}：${names.join('、') || '（暂无）'}`
  }
  const inSide = (type, label) => {
    const names = incoming.filter(c => c.type === type).map(c => c.name)
    return `${label}：${names.join('、') || '（无）'}`
  }

  return [
    '你是「乌龙记账」的分类归并助手。',
    '用户正在从其他记账 App 导入历史流水，源数据里的分类名在本账本中不存在，需要判断哪些能归并到已有分类。',
    '',
    '【已有分类】',
    side('expense', '支出'),
    side('income', '收入'),
    '',
    '【需要判断的分类】',
    inSide('expense', '支出'),
    inSide('income', '收入'),
    '',
    '只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字：',
    '{"expense":{"餐饮美食":"餐饮"},"income":{"薪资":"工资"}}',
    '',
    '规则：',
    '- 值必须是【已有分类】里完全一致的名字',
    '- 归并不到就填 ""，表示保留为新分类',
    '- 宁可保守：含义不完全一致就不要归。例如「房租」与「物业费」、「话费」与「宽带」不能合并',
    '- 只输出【需要判断的分类】里出现过的键，不要自己新增键'
  ].join('\n')
}

/**
 * 解析模型给的归并结果，逐条校验
 * 只接受「目标分类确实存在于本地」的映射，模型编出来的名字一律丢弃
 * @returns {{ expense: Object<string,string>, income: Object<string,string>, mapped: number }}
 */
export function parseCategoryMap(raw, { existing = [], incoming = [] } = {}) {
  const valid = new Set(existing.map(c => `${c.type}|${c.name}`))
  const allowed = new Set(incoming.map(c => `${c.type}|${c.name}`))
  const result = { expense: {}, income: {}, mapped: 0 }

  for (const type of ['expense', 'income']) {
    const group = raw?.[type]
    if (!group || typeof group !== 'object') continue
    for (const [from, to] of Object.entries(group)) {
      const source = String(from || '').trim()
      const target = String(to || '').trim()
      if (!source || !target) continue
      // 只处理确实待归并的源分类，避免模型顺手改了别的东西
      if (!allowed.has(`${type}|${source}`)) continue
      // 目标必须真实存在，否则宁可新建也不要记到不存在的分类上
      if (!valid.has(`${type}|${target}`)) continue
      if (source === target) continue
      result[type][source] = target
      result.mapped++
    }
  }
  return result
}

/**
 * 取某个分类被归并后的最终名字，没有映射就返回原名
 */
export function aliasedName(map, name, type) {
  const group = map?.[type]
  if (!group || !name) return name
  return group[name] || name
}

// 从模型返回里取出可展示的回复文本
export function normalizeReply(text, fallback = '') {
  const s = String(text || '').trim()
  return s || fallback
}
