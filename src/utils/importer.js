// 外部账单导入的解析层
// 只做「文本 → 结构化数据」，不碰存储层，方便单独测试
// 支持的格式：Tab 分隔、中文表头的流水 CSV（列包含 类型/金额/分类/账户/付款/收款/日期）

// 支持的来源；新增来源时在这里登记并在 parseImportText 里分派
export const IMPORT_SOURCES = [
  { key: 'csv', label: 'CSV 流水', desc: '记账 App 导出的 CSV 文件' }
]

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '')
}

// 把文件字节解码成文本
// 这类导出常见 Excel「Unicode 文本」格式，即 UTF-16 LE 带 BOM（FF FE），
// 直接按 UTF-8 读会得到一片乱码，必须按 BOM 判断
export function decodeBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || [])
  if (bytes.length === 0) return ''

  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('\uFFFD')) return utf8

  // 解出替换字符说明不是 UTF-8，微信/QQ 转存的文件常见 GBK
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    if (!gbk.includes('\uFFFD')) return gbk
  } catch {
    // 少数环境不带 gbk 解码器
  }

  // 无 BOM 的 UTF-16：ASCII 高位为 0，样本里会密集出现 0x00
  const sample = bytes.subarray(0, Math.min(400, bytes.length))
  let nulls = 0
  for (const b of sample) if (b === 0) nulls++
  if (nulls > sample.length * 0.2) {
    return new TextDecoder('utf-16le').decode(bytes)
  }
  return utf8
}

// 按首行出现次数判断分隔符，这类导出用 Tab，部分工具用逗号
function detectDelimiter(text) {
  const firstLine = text.split('\n')[0] || ''
  const candidates = ['\t', ',', ';', '|']
  let best = '\t'
  let bestCount = 0
  for (const ch of candidates) {
    const count = firstLine.split(ch).length - 1
    if (count > bestCount) {
      bestCount = count
      best = ch
    }
  }
  return bestCount > 0 ? best : '\t'
}

// 通用分隔符解析：支持引号包裹、引号内换行、双双引号转义
export function parseDelimited(text, delimiter) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  const src = String(text || '')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

// 金额可能带千分位、货币符号或空格
function toAmount(raw) {
  const cleaned = String(raw || '').replace(/[,\s¥$￥]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function normalizeDate(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  // 统一成 YYYY-MM-DD[ HH:mm]，去掉秒与毫秒，兼容 / 分隔与 T 分隔
  const m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (!m) return ''
  const [, y, mo, d, hh, mm] = m
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return hh ? `${date} ${String(hh).padStart(2, '0')}:${mm}` : date
}

const MINTBOOK_TYPE_MAP = { 收入: 'income', 支出: 'expense', 转账: 'transfer' }

function cellOf(cells, index) {
  if (index < 0) return ''
  return String(cells[index] ?? '').trim()
}

// 表头名可能在版本间微调，用前缀匹配兜住
function findColumn(header, ...names) {
  for (const name of names) {
    const exact = header.findIndex(h => h === name)
    if (exact >= 0) return exact
  }
  for (const name of names) {
    const partial = header.findIndex(h => h.startsWith(name))
    if (partial >= 0) return partial
  }
  return -1
}

export function detectImportSource(text) {
  const head = stripBom(text).slice(0, 4000)
  if (head.includes('类型') && head.includes('账户') && head.includes('付款') && head.includes('收款')) {
    return 'csv'
  }
  return null
}

export function parseTabularCsv(text) {
  const clean = stripBom(text)
  const delimiter = detectDelimiter(clean)
  const rows = parseDelimited(clean, delimiter)
  if (!rows.length) throw new Error('文件内容为空')

  const header = rows[0].map(h => String(h || '').trim())
  const col = {
    type: findColumn(header, '类型'),
    amount: findColumn(header, '金额'),
    category: findColumn(header, '分类'),
    account: findColumn(header, '账户'),
    from: findColumn(header, '付款'),
    to: findColumn(header, '收款'),
    merchant: findColumn(header, '商家'),
    date: findColumn(header, '日期'),
    note: findColumn(header, '备注')
  }
  if (col.type < 0 || col.amount < 0 || col.date < 0) {
    throw new Error('表头不匹配，无法识别这份 CSV 的表头')
  }

  const records = []
  const skipped = []
  const accountNames = new Set()
  const categoryKeys = new Map()

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    if (!cells || cells.every(c => !String(c || '').trim())) continue

    const line = r + 1
    const rawType = cellOf(cells, col.type)
    const type = MINTBOOK_TYPE_MAP[rawType]
    if (!type) {
      skipped.push({ line, reason: rawType ? `未知类型「${rawType}」` : '类型为空' })
      continue
    }

    const rawAmount = toAmount(cellOf(cells, col.amount))
    // 0 元记录没有统计意义，还会把月度笔数撑大
    if (rawAmount === null || rawAmount === 0) {
      skipped.push({ line, reason: '金额为 0 或无法识别' })
      continue
    }
    const amount = Math.abs(rawAmount)

    const date = normalizeDate(cellOf(cells, col.date))
    if (!date) {
      skipped.push({ line, reason: '日期无法识别' })
      continue
    }

    const accountName = cellOf(cells, col.account)
    const fromName = cellOf(cells, col.from)
    const toName = cellOf(cells, col.to)

    let account = accountName
    let toAccount = ''
    if (type === 'transfer') {
      // 转账的转出/转入记在「付款」「收款」两列，账户列为空
      account = fromName
      toAccount = toName
      if (!account || !toAccount) {
        skipped.push({ line, reason: '转账缺少付款或收款账户' })
        continue
      }
    } else if (!account) {
      skipped.push({ line, reason: '缺少账户' })
      continue
    }

    // 转账的分类列放的是「账户互转 / 存钱 / 还款」这类动作名，当备注用
    const category = type === 'transfer' ? '' : cellOf(cells, col.category)
    const noteCell = cellOf(cells, col.note)
    const action = type === 'transfer' ? cellOf(cells, col.category) : ''
    const note = noteCell || action

    if (account) accountNames.add(account)
    if (toAccount) accountNames.add(toAccount)
    if (category) {
      const key = `${category}|${type}`
      if (!categoryKeys.has(key)) categoryKeys.set(key, { name: category, type })
    }

    records.push({
      type,
      amount: Number(amount.toFixed(2)),
      accountName: account,
      toAccountName: toAccount,
      categoryName: category,
      categoryType: type,
      merchant: cellOf(cells, col.merchant),
      note,
      date
    })
  }

  const expense = records.filter(r => r.type === 'expense')
  const income = records.filter(r => r.type === 'income')
  const transfer = records.filter(r => r.type === 'transfer')
  const dates = records.map(r => r.date.split(' ')[0]).sort()

  return {
    source: 'csv',
    records,
    skipped,
    accounts: [...accountNames],
    categories: [...categoryKeys.values()],
    stats: {
      total: records.length,
      expenseCount: expense.length,
      incomeCount: income.length,
      transferCount: transfer.length,
      expenseSum: expense.reduce((s, r) => s + r.amount, 0),
      incomeSum: income.reduce((s, r) => s + r.amount, 0),
      transferSum: transfer.reduce((s, r) => s + r.amount, 0),
      startDate: dates[0] || '',
      endDate: dates[dates.length - 1] || '',
      skippedCount: skipped.length
    }
  }
}

export function parseImportText(text) {
  const source = detectImportSource(text)
  if (source === 'csv') return parseTabularCsv(text)
  throw new Error('无法识别文件格式，请确认导出的是 CSV 流水文件')
}

// 去重键：同一笔流水重复导入时用它比对已有记录
export function recordKeyOf(record) {
  return [record.date, record.type, Number(record.amount || 0).toFixed(2),
    record.accountName || '', record.toAccountName || '', record.note || ''].join('|')
}
