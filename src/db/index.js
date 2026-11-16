import { Capacitor } from '@capacitor/core'

// ========== 判断是否原生平台 ==========
const isNative = Capacitor.isNativePlatform()
const DB_NAME = 'bookkeeping'

// ========== 业务枚举 ==========
// 交易类型：支出 / 收入 / 转账（转账不计入收支统计，双边改账户余额）
export const TX = { EXPENSE: 'expense', INCOME: 'income', TRANSFER: 'transfer' }
// 账户类型：普通 / 信用 / 欠款 / 投资
// 欠款账户是没有额度、账单日这些概念的信用账户（借呗、房贷、欠朋友的钱），
// 余额同样用负数存储，参与总资产计算时直接就是负的
export const ACC = { CASH: 'cash', CREDIT: 'credit', DEBT: 'debt', INVESTMENT: 'investment' }
// 报销状态：不报销 / 待报销 / 已报销
export const REIMBURSE = { NONE: 'none', PENDING: 'pending', DONE: 'done' }
// 周期频率
export const FREQ = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }

// ========== SQLite 引擎 ==========
let useSQLite = false
let CapacitorSQLite = null

const BASE_DDL = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    icon TEXT DEFAULT '💰', balance REAL DEFAULT 0,
    type TEXT DEFAULT 'cash', market TEXT DEFAULT '',
    symbol TEXT DEFAULT '', shares REAL DEFAULT 0, cost_price REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    icon TEXT DEFAULT '📌', type TEXT NOT NULL DEFAULT 'expense',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL DEFAULT 'expense',
    amount REAL NOT NULL, category_id INTEGER, account_id INTEGER,
    note TEXT DEFAULT '', date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
  );
`

const EXTRA_DDL = `
  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS transaction_tags (
    transaction_id INTEGER NOT NULL, tag_id INTEGER NOT NULL,
    PRIMARY KEY (transaction_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS installments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    total_amount REAL DEFAULT 0, periods INTEGER DEFAULT 1,
    category_id INTEGER, account_id INTEGER,
    note TEXT DEFAULT '', start_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS recurring_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    type TEXT DEFAULT 'expense', amount REAL DEFAULT 0,
    category_id INTEGER, account_id INTEGER, to_account_id INTEGER,
    note TEXT DEFAULT '', merchant TEXT DEFAULT '',
    frequency TEXT DEFAULT 'monthly', start_date TEXT NOT NULL,
    end_date TEXT DEFAULT '', last_generated TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '',
    scope TEXT DEFAULT 'total', category_id INTEGER, category_ids TEXT DEFAULT '',
    amount REAL DEFAULT 0, period TEXT DEFAULT 'monthly',
    carry_over INTEGER DEFAULT 0, start_date TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`

// 老库补列定义：accounts 余额口径与信用账户信息
const ACCOUNT_COLUMNS = [
  ['type', "TEXT DEFAULT 'cash'"],
  ['market', "TEXT DEFAULT ''"],
  ['symbol', "TEXT DEFAULT ''"],
  ['shares', 'REAL DEFAULT 0'],
  ['cost_price', 'REAL DEFAULT 0'],
  ['initial_balance', 'REAL DEFAULT 0'],
  ['credit_limit', 'REAL DEFAULT 0'],
  ['bill_day', 'INTEGER DEFAULT 1'],
  ['repay_day', 'INTEGER DEFAULT 1'],
  // 货币基金计息：interest_code 为空表示该账户不计息
  ['interest_code', "TEXT DEFAULT ''"],
  ['interest_settled_date', "TEXT DEFAULT ''"],
  // 每日收益/盈亏自动入账开关
  ['auto_earn', 'INTEGER DEFAULT 0']
]

// 老库补列定义：交易扩展字段
const TRANSACTION_COLUMNS = [
  ['to_account_id', 'INTEGER'],
  ['merchant', "TEXT DEFAULT ''"],
  ['reimburse_status', "TEXT DEFAULT 'none'"],
  ['installment_id', 'INTEGER'],
  // 自动生成的收益账单标记：'' 手动 / 'interest' 货币基金 / 'fund_pnl' 基金盈亏
  ['auto_source', "TEXT DEFAULT ''"]
]

// 老库补列定义：预算可覆盖多个分类（逗号分隔的 id 集合）
const BUDGET_COLUMNS = [
  ['category_ids', "TEXT DEFAULT ''"]
]

async function tryInitSQLite() {
  try {
    const mod = await import('@capacitor-community/sqlite')
    CapacitorSQLite = mod.CapacitorSQLite
    await CapacitorSQLite.createConnection({
      database: DB_NAME, version: 1, encrypted: false, mode: 'no-encryption', readOnly: false
    })
    await CapacitorSQLite.open({ database: DB_NAME, readOnly: false })
    // 建表属于无占位符 DDL，走 execute
    await CapacitorSQLite.execute({ database: DB_NAME, statements: BASE_DDL })
    await CapacitorSQLite.execute({ database: DB_NAME, statements: EXTRA_DDL })
    await ensureColumns('accounts', ACCOUNT_COLUMNS)
    await ensureColumns('transactions', TRANSACTION_COLUMNS)
    await ensureColumns('budgets', BUDGET_COLUMNS)
    await migrateLegacyBalance()
    useSQLite = true
    console.log('[DB] SQLite 初始化成功')
  } catch (e) {
    console.warn('[DB] SQLite 初始化失败，降级到 localStorage:', e.message)
    useSQLite = false
  }
}

// execute() 不支持参数绑定，带占位符的写操作必须走 run()
async function runStatement(statement, values = []) {
  return CapacitorSQLite.run({ database: DB_NAME, statement, values })
}

async function queryRows(statement, values = []) {
  const r = await CapacitorSQLite.query({ database: DB_NAME, statement, values })
  return r.values || []
}

// 老版本数据库缺字段时自动补齐
async function ensureColumns(table, columns) {
  try {
    const rows = await queryRows(`PRAGMA table_info(${table})`)
    const existing = new Set(rows.map(v => v.name))
    for (const [name, definition] of columns) {
      if (!existing.has(name)) {
        await CapacitorSQLite.execute({ database: DB_NAME, statements: `ALTER TABLE ${table} ADD COLUMN ${name} ${definition}` })
      }
    }
  } catch (e) {
    console.warn(`[DB] ${table} 表结构升级失败:`, e.message)
  }
}

// 一次性迁移：把老版本手填的 balance 转成期初余额
// 此后余额一律由「期初 + 交易累计」实时计算，balance 列仅作历史遗留
async function migrateLegacyBalance() {
  try {
    const rows = await queryRows('PRAGMA user_version')
    const version = Number(rows[0]?.user_version) || 0
    if (version >= 2) return
    await runStatement('UPDATE accounts SET initial_balance = COALESCE(balance, 0) WHERE COALESCE(initial_balance, 0) = 0')
    await CapacitorSQLite.execute({ database: DB_NAME, statements: 'PRAGMA user_version = 2' })
    console.log('[DB] 余额口径已迁移为期初余额')
  } catch (e) {
    console.warn('[DB] 余额口径迁移失败:', e.message)
  }
}

// ========== localStorage 引擎 ==========
const LS_KEYS = {
  accounts: 'bk_accounts',
  categories: 'bk_categories',
  transactions: 'bk_transactions',
  tags: 'bk_tags',
  transactionTags: 'bk_transaction_tags',
  installments: 'bk_installments',
  recurring: 'bk_recurring_rules',
  budgets: 'bk_budgets'
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(LS_KEYS[key]) || '[]') } catch { return [] }
}
function lsSet(key, data) {
  localStorage.setItem(LS_KEYS[key], JSON.stringify(data))
}
function lsNextId(key) {
  const items = lsGet(key)
  return items.length ? Math.max(...items.map(i => Number(i.id) || 0)) + 1 : 1
}
function nowStr() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19)
}
function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ========== 初始化 Promise ==========
let _initDone = false
let _initPromise = null

export function initDB() {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    if (_initDone) return
    if (isNative) {
      await tryInitSQLite()
    }
    // 非原生或 SQLite 失败时使用 localStorage（已自动就绪）
    if (!useSQLite) {
      console.log('[DB] 使用 localStorage 存储数据')
    }
    await seedDefaultCategories()
    _initDone = true
  })()
  return _initPromise
}

// 首次使用时预置常用分类，避免用户直接记账看到空分类页
const DEFAULT_CATEGORIES = [
  { name: '餐饮', icon: '🍜', type: 'expense' },
  { name: '交通', icon: '🚗', type: 'expense' },
  { name: '购物', icon: '🛒', type: 'expense' },
  { name: '住房', icon: '🏠', type: 'expense' },
  { name: '通讯', icon: '📱', type: 'expense' },
  { name: '娱乐', icon: '🎮', type: 'expense' },
  { name: '医疗', icon: '💊', type: 'expense' },
  { name: '教育', icon: '📚', type: 'expense' },
  { name: '工资', icon: '💰', type: 'income' },
  { name: '奖金', icon: '🎯', type: 'income' },
  { name: '理财', icon: '📈', type: 'income' },
  { name: '其他', icon: '💵', type: 'income' }
]

async function seedDefaultCategories() {
  try {
    const existing = await getCategories()
    if (existing.length) return
    for (const category of DEFAULT_CATEGORIES) {
      await createCategory(category)
    }
  } catch (e) {
    console.warn('[DB] 预置分类失败:', e.message)
  }
}

export function isDBReady() { return _initDone }

// ========== 账户 ==========
function clampDay(v) {
  const n = Math.round(Number(v) || 1)
  return Math.min(31, Math.max(1, n))
}

function normalizeAccount(a) {
  // 白名单必须同步登记新类型：否则存进去的 debt 读出来会被兜底成 cash，
  // 欠款就变成正资产，净资产直接算反
  const type = [ACC.CASH, ACC.CREDIT, ACC.DEBT, ACC.INVESTMENT].includes(a.type) ? a.type : ACC.CASH
  return {
    ...a,
    type,
    market: a.market || '',
    symbol: a.symbol || '',
    shares: Number(a.shares) || 0,
    cost_price: Number(a.cost_price) || 0,
    // initial_balance 是新口径；老数据回落到 balance
    initial_balance: Number(a.initial_balance ?? a.balance) || 0,
    credit_limit: Number(a.credit_limit) || 0,
    bill_day: clampDay(a.bill_day),
    repay_day: clampDay(a.repay_day),
    interest_code: String(a.interest_code || '').trim(),
    interest_settled_date: a.interest_settled_date || '',
    auto_earn: Number(a.auto_earn) ? 1 : 0,
    balance: Number(a.balance) || 0,
    sort_order: Number(a.sort_order) || 0
  }
}

function accountPayload(data) {
  return {
    name: String(data.name || '').trim(),
    icon: data.icon || '💰',
    type: [ACC.CASH, ACC.CREDIT, ACC.INVESTMENT].includes(data.type) ? data.type : ACC.CASH,
    initial_balance: Number(data.initial_balance ?? data.balance) || 0,
    credit_limit: Number(data.credit_limit) || 0,
    bill_day: clampDay(data.bill_day),
    repay_day: clampDay(data.repay_day),
    market: data.market || '',
    symbol: data.symbol || '',
    shares: Number(data.shares) || 0,
    cost_price: Number(data.cost_price) || 0,
    // 货币基金代码：空字符串代表该账户不计息
    interest_code: String(data.interest_code || '').trim(),
    interest_settled_date: data.interest_settled_date || '',
    auto_earn: Number(data.auto_earn) ? 1 : 0,
    sort_order: Number(data.sort_order) || 0
  }
}

// 由交易流水反推每个账户的当前余额
// 只累计已发生（日期不晚于今天）的交易，分期预生成的未来账单不计入当前余额
function computeBalances(accounts, transactions) {
  const map = {}
  for (const a of accounts) map[a.id] = Number(a.initial_balance) || 0
  const today = todayStr()
  for (const t of transactions) {
    const date = String(t.date || '').split(' ')[0]
    if (date > today) continue
    const amount = Number(t.amount) || 0
    const from = t.account_id != null ? map[t.account_id] : undefined
    const to = t.to_account_id != null ? map[t.to_account_id] : undefined
    if (t.type === TX.INCOME) {
      if (from !== undefined) map[t.account_id] += amount
    } else if (t.type === TX.EXPENSE) {
      if (from !== undefined) map[t.account_id] -= amount
    } else if (t.type === TX.TRANSFER) {
      if (from !== undefined) map[t.account_id] -= amount
      if (to !== undefined) map[t.to_account_id] += amount
    }
  }
  return map
}

export async function getAccounts() {
  if (useSQLite) {
    const rows = await queryRows(`
      SELECT a.*,
        COALESCE(a.initial_balance, 0)
        + COALESCE((SELECT SUM(t.amount) FROM transactions t
            WHERE t.account_id = a.id AND t.type = 'income' AND t.date <= date('now','localtime')), 0)
        + COALESCE((SELECT SUM(t.amount) FROM transactions t
            WHERE t.to_account_id = a.id AND t.type = 'transfer' AND t.date <= date('now','localtime')), 0)
        - COALESCE((SELECT SUM(t.amount) FROM transactions t
            WHERE t.account_id = a.id AND t.type IN ('expense','transfer') AND t.date <= date('now','localtime')), 0)
        AS computed_balance
      FROM accounts a
      ORDER BY a.sort_order ASC, a.id ASC
    `)
    return rows.map(r => normalizeAccount({ ...r, balance: r.computed_balance }))
  }
  const accounts = lsGet('accounts').map(normalizeAccount)
  const balances = computeBalances(accounts, lsGet('transactions'))
  return accounts
    .map(a => ({ ...a, balance: balances[a.id] ?? a.initial_balance }))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
}

export async function createAccount(data) {
  const p = accountPayload(data)
  if (useSQLite) {
    await runStatement(
      `INSERT INTO accounts
        (name,icon,type,initial_balance,credit_limit,bill_day,repay_day,market,symbol,shares,cost_price,
         interest_code,interest_settled_date,auto_earn,sort_order,balance)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.name, p.icon, p.type, p.initial_balance, p.credit_limit, p.bill_day, p.repay_day,
        p.market, p.symbol, p.shares, p.cost_price, p.interest_code, p.interest_settled_date,
        p.auto_earn, p.sort_order, p.initial_balance]
    )
    return
  }
  const items = lsGet('accounts')
  items.push({ id: lsNextId('accounts'), ...p, balance: p.initial_balance, created_at: nowStr() })
  lsSet('accounts', items)
}

export async function updateAccount(data) {
  const p = accountPayload(data)
  const id = Number(data.id)
  if (useSQLite) {
    await runStatement(
      `UPDATE accounts SET name=?,icon=?,type=?,initial_balance=?,credit_limit=?,bill_day=?,repay_day=?,
        market=?,symbol=?,shares=?,cost_price=?,interest_code=?,interest_settled_date=?,auto_earn=?,sort_order=?
       WHERE id=?`,
      [p.name, p.icon, p.type, p.initial_balance, p.credit_limit, p.bill_day, p.repay_day,
        p.market, p.symbol, p.shares, p.cost_price, p.interest_code, p.interest_settled_date,
        p.auto_earn, p.sort_order, id]
    )
    return
  }
  const items = lsGet('accounts')
  const idx = items.findIndex(i => Number(i.id) === id)
  if (idx >= 0) Object.assign(items[idx], p)
  lsSet('accounts', items)
}

// 批量写入账户顺序：拖拽排序用，只改 sort_order，不动其它字段
export async function saveAccountOrder(orderedIds) {
  const ids = (Array.isArray(orderedIds) ? orderedIds : []).map(Number).filter(Boolean)
  if (!ids.length) return
  if (useSQLite) {
    for (let i = 0; i < ids.length; i++) {
      await runStatement('UPDATE accounts SET sort_order=? WHERE id=?', [i, ids[i]])
    }
    return
  }
  const order = new Map(ids.map((id, index) => [id, index]))
  lsSet('accounts', lsGet('accounts').map(a => {
    const idx = order.get(Number(a.id))
    return idx === undefined ? a : { ...a, sort_order: idx }
  }))
}

export async function deleteAccount(id) {
  const aid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM accounts WHERE id=?', [aid])
    // 关联交易的账户引用置空，避免余额计算出错
    await runStatement('UPDATE transactions SET account_id=NULL WHERE account_id=?', [aid])
    await runStatement('UPDATE transactions SET to_account_id=NULL WHERE to_account_id=?', [aid])
    // 周期规则引用了已删账户就必须停用：否则到日子仍会生成账单，
    // 而且生成出来的账单账户为空，等于凭空多出一笔没有出处的支出
    await runStatement(
      'UPDATE recurring_rules SET account_id=NULL, enabled=0 WHERE account_id=?', [aid])
    await runStatement(
      'UPDATE recurring_rules SET to_account_id=NULL, enabled=0 WHERE to_account_id=?', [aid])
    await runStatement('UPDATE installments SET account_id=NULL WHERE account_id=?', [aid])
    return
  }
  lsSet('accounts', lsGet('accounts').filter(i => Number(i.id) !== aid))
  lsSet('transactions', lsGet('transactions').map(t => ({
    ...t,
    account_id: Number(t.account_id) === aid ? null : t.account_id,
    to_account_id: Number(t.to_account_id) === aid ? null : t.to_account_id
  })))
  lsSet('recurring', lsGet('recurring').map(r => {
    const fromHit = Number(r.account_id) === aid
    const toHit = Number(r.to_account_id) === aid
    if (!fromHit && !toHit) return r
    return {
      ...r,
      account_id: fromHit ? null : r.account_id,
      to_account_id: toHit ? null : r.to_account_id,
      enabled: 0
    }
  }))
  lsSet('installments', lsGet('installments').map(i =>
    Number(i.account_id) === aid ? { ...i, account_id: null } : i))
}

// ========== 标签 ==========
export async function getTags() {
  if (useSQLite) {
    const rows = await queryRows('SELECT * FROM tags ORDER BY sort_order ASC, id ASC')
    return rows.map(r => ({ ...r, id: Number(r.id) }))
  }
  return lsGet('tags')
    .map(t => ({ ...t, id: Number(t.id) }))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.id - b.id)
}

export async function createTag(data) {
  const name = String(data.name || '').trim()
  if (!name) throw new Error('标签名称不能为空')
  const sortOrder = Number(data.sort_order) || 0
  if (useSQLite) {
    // 两个引擎行为必须一致：localStorage 分支会拦重复，
    // 原生端不拦的话，AI 重复建标签会在手机上多出一堆同名标签
    const dup = await queryRows('SELECT id FROM tags WHERE name=?', [name])
    if (dup.length) throw new Error('标签已存在')
    await runStatement('INSERT INTO tags (name,sort_order) VALUES(?,?)', [name, sortOrder])
    return
  }
  const items = lsGet('tags')
  if (items.some(t => t.name === name)) throw new Error('标签已存在')
  items.push({ id: lsNextId('tags'), name, sort_order: sortOrder, created_at: nowStr() })
  lsSet('tags', items)
}

export async function updateTag(data) {
  const id = Number(data.id)
  const name = String(data.name || '').trim()
  if (useSQLite) {
    await runStatement('UPDATE tags SET name=?,sort_order=? WHERE id=?', [name, Number(data.sort_order) || 0, id])
    return
  }
  const items = lsGet('tags')
  const idx = items.findIndex(i => Number(i.id) === id)
  if (idx >= 0) Object.assign(items[idx], { name, sort_order: Number(data.sort_order) || 0 })
  lsSet('tags', items)
}

export async function deleteTag(id) {
  const tid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM transaction_tags WHERE tag_id=?', [tid])
    await runStatement('DELETE FROM tags WHERE id=?', [tid])
    return
  }
  lsSet('tags', lsGet('tags').filter(i => Number(i.id) !== tid))
  lsSet('transactionTags', lsGet('transactionTags').filter(i => Number(i.tag_id) !== tid))
}

// ========== 分类 ==========
export async function getCategories(type) {
  if (useSQLite) {
    const rows = type
      ? await queryRows('SELECT * FROM categories WHERE type=? ORDER BY sort_order ASC, id ASC', [type])
      : await queryRows('SELECT * FROM categories ORDER BY type ASC, sort_order ASC, id ASC')
    return rows.map(r => ({ ...r, id: Number(r.id) }))
  }
  let items = lsGet('categories')
  if (type) items = items.filter(c => c.type === type)
  // 与 SQLite 分支保持一致：type → sort_order → id 三级排序。
  // 缺了 id 兜底时，sort_order 相同的分类顺序取决于原数组，
  // 会让拼给模型的提示词词表顺序漂移
  return items.sort((a, b) =>
    String(a.type || '').localeCompare(String(b.type || '')) ||
    (a.sort_order || 0) - (b.sort_order || 0) ||
    a.id - b.id
  )
}

export async function createCategory(data) {
  const name = String(data.name || '').trim()
  const type = data.type || 'expense'
  if (!name) throw new Error('分类名称不能为空')
  if (useSQLite) {
    // 分类名 + 类型唯一。AI 建分类、旧版页面都没有查重，
    // 重复建出来会让报表按同名分类裂成两行，且无法合并
    const dup = await queryRows('SELECT id FROM categories WHERE name=? AND type=?', [name, type])
    if (dup.length) throw new Error('分类已存在')
    await runStatement('INSERT INTO categories (name,icon,type,sort_order) VALUES(?,?,?,?)',
      [name, data.icon || '📌', type, Number(data.sort_order) || 0])
    return
  }
  const items = lsGet('categories')
  if (items.some(c => c.name === name && (c.type || 'expense') === type)) {
    throw new Error('分类已存在')
  }
  items.push({
    id: lsNextId('categories'), name, icon: data.icon || '📌',
    type, sort_order: Number(data.sort_order) || 0, created_at: nowStr()
  })
  lsSet('categories', items)
}

export async function updateCategory(data) {
  if (useSQLite) {
    await runStatement('UPDATE categories SET name=?,icon=?,type=?,sort_order=? WHERE id=?',
      [data.name, data.icon || '📌', data.type || 'expense', Number(data.sort_order) || 0, Number(data.id)])
    return
  }
  const items = lsGet('categories')
  const idx = items.findIndex(i => Number(i.id) === Number(data.id))
  if (idx >= 0) Object.assign(items[idx], {
    name: data.name, icon: data.icon || '📌', type: data.type || 'expense', sort_order: Number(data.sort_order) || 0
  })
  lsSet('categories', items)
}

export async function deleteCategory(id) {
  const cid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM categories WHERE id=?', [cid])
    await runStatement('UPDATE transactions SET category_id=NULL WHERE category_id=?', [cid])
    // 分类没了，把它从各条预算的分类集合里摘掉；集合空了才删整条预算。
    // 直接整条删会把用户设的额度一起清掉，多分类预算尤其不该被连带删除
    const budgetRows = await queryRows('SELECT id, scope, category_id, category_ids FROM budgets')
    for (const row of budgetRows) {
      const ids = categoryIdsOf({ category_ids: row.category_ids, category_id: row.category_id })
      if (!ids.includes(cid)) continue
      const rest = ids.filter(i => i !== cid)
      if (row.scope === BUDGET_SCOPE.CATEGORY && rest.length === 0) {
        await runStatement('DELETE FROM budgets WHERE id=?', [Number(row.id)])
        continue
      }
      await runStatement('UPDATE budgets SET category_id=?, category_ids=? WHERE id=?',
        [rest[0] ?? null, rest.join(','), Number(row.id)])
    }
    // 周期规则保留，只是变成未分类：金额和账户仍然有效，用户还能继续用
    await runStatement('UPDATE recurring_rules SET category_id=NULL WHERE category_id=?', [cid])
    return
  }
  lsSet('categories', lsGet('categories').filter(i => Number(i.id) !== cid))
  lsSet('transactions', lsGet('transactions').map(t =>
    Number(t.category_id) === cid ? { ...t, category_id: null } : t))
  lsSet('budgets', lsGet('budgets').reduce((acc, b) => {
    const ids = categoryIdsOf(b)
    if (!ids.includes(cid)) {
      acc.push(b)
      return acc
    }
    const rest = ids.filter(i => i !== cid)
    if (b.scope === BUDGET_SCOPE.CATEGORY && rest.length === 0) return acc
    acc.push({ ...b, category_id: rest[0] ?? null, category_ids: rest.join(',') })
    return acc
  }, []))
  lsSet('recurring', lsGet('recurring').map(r =>
    Number(r.category_id) === cid ? { ...r, category_id: null } : r))
}

// ========== 交易记录 ==========
function normalizeTx(t) {
  return {
    ...t,
    id: Number(t.id),
    type: [TX.EXPENSE, TX.INCOME, TX.TRANSFER].includes(t.type) ? t.type : TX.EXPENSE,
    amount: Number(t.amount) || 0,
    category_id: t.category_id == null || t.category_id === '' ? null : Number(t.category_id),
    account_id: t.account_id == null || t.account_id === '' ? null : Number(t.account_id),
    to_account_id: t.to_account_id == null || t.to_account_id === '' ? null : Number(t.to_account_id),
    installment_id: t.installment_id == null || t.installment_id === '' ? null : Number(t.installment_id),
    merchant: t.merchant || '',
    note: t.note || '',
    reimburse_status: [REIMBURSE.NONE, REIMBURSE.PENDING, REIMBURSE.DONE].includes(t.reimburse_status)
      ? t.reimburse_status : REIMBURSE.NONE,
    // 系统自动生成的收益账单，界面据此标注「自动」并做去重
    auto_source: t.auto_source || ''
  }
}

function txPayload(data) {
  const type = [TX.EXPENSE, TX.INCOME, TX.TRANSFER].includes(data.type) ? data.type : TX.EXPENSE
  const payload = {
    type,
    amount: Number(data.amount) || 0,
    category_id: type === TX.TRANSFER ? null : (data.category_id || null),
    account_id: data.account_id || null,
    to_account_id: type === TX.TRANSFER ? (data.to_account_id || null) : null,
    merchant: data.merchant || '',
    note: data.note || '',
    reimburse_status: type === TX.TRANSFER
      ? REIMBURSE.NONE
      : ([REIMBURSE.NONE, REIMBURSE.PENDING, REIMBURSE.DONE].includes(data.reimburse_status)
        ? data.reimburse_status : REIMBURSE.NONE),
    installment_id: data.installment_id || null,
    auto_source: String(data.auto_source || ''),
    date: data.date
  }
  if (!payload.date) throw new Error('缺少记账日期')
  if (payload.amount <= 0) throw new Error('金额必须大于 0')
  if (type === TX.TRANSFER) {
    if (!payload.account_id || !payload.to_account_id) throw new Error('请选择转出和转入账户')
    if (Number(payload.account_id) === Number(payload.to_account_id)) throw new Error('转出和转入账户不能相同')
  }
  return payload
}

function lsTagsFor(txIds) {
  const tags = lsGet('tags')
  const links = lsGet('transactionTags')
  const map = {}
  for (const link of links) {
    if (!txIds.has(Number(link.transaction_id))) continue
    const tag = tags.find(t => Number(t.id) === Number(link.tag_id))
    if (tag) (map[Number(link.transaction_id)] ||= []).push({ id: Number(tag.id), name: tag.name })
  }
  return map
}

function joinTransactions(transactions) {
  const cats = lsGet('categories')
  const accs = lsGet('accounts')
  const tagMap = lsTagsFor(new Set(transactions.map(t => Number(t.id))))
  return transactions.map(t => {
    const id = Number(t.id)
    const cat = cats.find(c => Number(c.id) === Number(t.category_id))
    const acc = accs.find(a => Number(a.id) === Number(t.account_id))
    const toAcc = accs.find(a => Number(a.id) === Number(t.to_account_id))
    return {
      ...normalizeTx(t),
      category_name: cat?.name,
      category_icon: cat?.icon,
      account_name: acc?.name,
      account_icon: acc?.icon,
      to_account_name: toAcc?.name,
      to_account_icon: toAcc?.icon,
      tags: tagMap[id] || []
    }
  })
}

const TX_SELECT = `SELECT t.*, c.name as category_name, c.icon as category_icon,
    a.name as account_name, a.icon as account_icon,
    b.name as to_account_name, b.icon as to_account_icon
  FROM transactions t
  LEFT JOIN categories c ON t.category_id = c.id
  LEFT JOIN accounts a ON t.account_id = a.id
  LEFT JOIN accounts b ON t.to_account_id = b.id`

// 给一批交易补上标签
async function attachTags(rows) {
  if (!rows.length) return rows.map(normalizeTx)
  const ids = rows.map(r => Number(r.id))
  const placeholders = ids.map(() => '?').join(',')
  const links = await queryRows(
    `SELECT tt.transaction_id, g.id, g.name FROM transaction_tags tt
      JOIN tags g ON tt.tag_id = g.id WHERE tt.transaction_id IN (${placeholders})`, ids)
  const map = {}
  for (const row of links) {
    (map[Number(row.transaction_id)] ||= []).push({ id: Number(row.id), name: row.name })
  }
  return rows.map(r => ({
    ...normalizeTx(r),
    account_name: r.account_name,
    account_icon: r.account_icon,
    category_name: r.category_name,
    category_icon: r.category_icon,
    to_account_name: r.to_account_name,
    to_account_icon: r.to_account_icon,
    tags: map[Number(r.id)] || []
  }))
}

// 统一的查询条件构建，SQLite 与 localStorage 共用同一套语义
function buildFilter(options = {}) {
  const conditions = []
  const values = []
  if (options.yearMonth) { conditions.push("strftime('%Y-%m',t.date)=?"); values.push(options.yearMonth) }
  if (options.type) { conditions.push('t.type=?'); values.push(options.type) }
  if (options.startDate) { conditions.push('t.date>=?'); values.push(options.startDate) }
  if (options.endDate) { conditions.push('t.date<=?'); values.push(options.endDate) }
  if (options.accountId) {
    conditions.push('(t.account_id=? OR t.to_account_id=?)')
    values.push(Number(options.accountId), Number(options.accountId))
  }
  if (options.categoryId) { conditions.push('t.category_id=?'); values.push(Number(options.categoryId)) }
  if (options.reimburseStatus) { conditions.push('t.reimburse_status=?'); values.push(options.reimburseStatus) }
  if (options.installmentId) { conditions.push('t.installment_id=?'); values.push(Number(options.installmentId)) }
  if (options.keyword) {
    conditions.push('(COALESCE(t.note,\'\') LIKE ? OR COALESCE(t.merchant,\'\') LIKE ?)')
    const kw = `%${options.keyword}%`
    values.push(kw, kw)
  }
  if (options.minAmount != null) { conditions.push('t.amount>=?'); values.push(Number(options.minAmount)) }
  if (options.maxAmount != null) { conditions.push('t.amount<=?'); values.push(Number(options.maxAmount)) }
  return { conditions, values }
}

function matchesFilter(t, options = {}) {
  if (options.yearMonth && (t.date || '').substring(0, 7) !== options.yearMonth) return false
  if (options.type && t.type !== options.type) return false
  if (options.startDate && (t.date || '') < options.startDate) return false
  if (options.endDate && (t.date || '') > options.endDate) return false
  if (options.accountId) {
    const aid = Number(options.accountId)
    if (Number(t.account_id) !== aid && Number(t.to_account_id) !== aid) return false
  }
  if (options.categoryId && Number(t.category_id) !== Number(options.categoryId)) return false
  if (options.reimburseStatus && t.reimburse_status !== options.reimburseStatus) return false
  if (options.installmentId && Number(t.installment_id) !== Number(options.installmentId)) return false
  if (options.keyword) {
    // 与 SQLite 分支保持一致：只匹配备注与商家，避免两种存储引擎行为不同
    const kw = String(options.keyword).toLowerCase()
    const hay = `${t.note || ''} ${t.merchant || ''}`.toLowerCase()
    if (!hay.includes(kw)) return false
  }
  if (options.minAmount != null && (Number(t.amount) || 0) < Number(options.minAmount)) return false
  if (options.maxAmount != null && (Number(t.amount) || 0) > Number(options.maxAmount)) return false
  return true
}

export async function getTransactions(options = {}) {
  if (useSQLite) {
    let sql = TX_SELECT
    const { conditions, values } = buildFilter(options)
    if (options.tagId) {
      conditions.push('EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)')
      values.push(Number(options.tagId))
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
    sql += ' ORDER BY t.date DESC, t.id DESC'
    if (options.limit) { sql += ' LIMIT ?'; values.push(Number(options.limit)) }
    if (options.offset) { sql += ' OFFSET ?'; values.push(Number(options.offset)) }
    return attachTags(await queryRows(sql, values))
  }
  let items = joinTransactions(lsGet('transactions'))
  items = items.filter(t => matchesFilter(t, options))
  if (options.tagId) {
    items = items.filter(t => (t.tags || []).some(g => Number(g.id) === Number(options.tagId)))
  }
  items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id - a.id)
  if (options.offset) items = items.slice(Number(options.offset))
  if (options.limit) items = items.slice(0, Number(options.limit))
  return items
}

export async function countTransactions(options = {}) {
  if (useSQLite) {
    let sql = 'SELECT COUNT(*) as total FROM transactions t'
    const { conditions, values } = buildFilter(options)
    if (options.tagId) {
      conditions.push('EXISTS (SELECT 1 FROM transaction_tags tt WHERE tt.transaction_id = t.id AND tt.tag_id = ?)')
      values.push(Number(options.tagId))
    }
    if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ')
    const rows = await queryRows(sql, values)
    return Number(rows[0]?.total) || 0
  }
  const items = (await getTransactions({ ...options, limit: 0 }))
  return items.length
}

// ========== 使用频次 ==========
// 记账页要按「用得多」排序分类与账户。次数直接由流水现算，
// 不另存计数列：删改历史记录后排序会跟着变，不会长期漂移出一个假排名。
export async function getUsageStats() {
  const categories = {}
  const accounts = {}

  const add = (map, id, count) => {
    if (id == null || id === '') return
    const key = Number(id)
    if (!Number.isFinite(key)) return
    map[key] = (map[key] || 0) + (Number(count) || 0)
  }

  if (useSQLite) {
    const catRows = await queryRows(
      'SELECT category_id as id, COUNT(*) as cnt FROM transactions WHERE category_id IS NOT NULL GROUP BY category_id')
    for (const row of catRows) add(categories, row.id, row.cnt)
    // 转账的转入账户也算一次使用，否则被当做收款方的账户永远排不到前面
    const accRows = await queryRows(`
      SELECT account_id as id, COUNT(*) as cnt FROM transactions WHERE account_id IS NOT NULL GROUP BY account_id
      UNION ALL
      SELECT to_account_id as id, COUNT(*) as cnt FROM transactions WHERE to_account_id IS NOT NULL GROUP BY to_account_id
    `)
    for (const row of accRows) add(accounts, row.id, row.cnt)
    return { categories, accounts }
  }

  for (const t of lsGet('transactions')) {
    add(categories, t.category_id, 1)
    add(accounts, t.account_id, 1)
    add(accounts, t.to_account_id, 1)
  }
  return { categories, accounts }
}

export async function getTransactionById(id) {
  const tid = Number(id)
  if (useSQLite) {
    const rows = await queryRows(`${TX_SELECT} WHERE t.id=?`, [tid])
    const list = await attachTags(rows)
    return list[0] || null
  }
  const t = lsGet('transactions').find(i => Number(i.id) === tid)
  if (!t) return null
  return joinTransactions([t])[0]
}

async function saveTagsFor(txId, tagIds) {
  const ids = Array.isArray(tagIds) ? tagIds.map(Number).filter(Boolean) : []
  if (useSQLite) {
    await runStatement('DELETE FROM transaction_tags WHERE transaction_id=?', [txId])
    for (const tagId of ids) {
      await runStatement('INSERT INTO transaction_tags (transaction_id, tag_id) VALUES(?,?)', [txId, tagId])
    }
    return
  }
  const links = lsGet('transactionTags').filter(l => Number(l.transaction_id) !== txId)
  for (const tagId of ids) links.push({ transaction_id: txId, tag_id: tagId })
  lsSet('transactionTags', links)
}

export async function createTransaction(data) {
  const p = txPayload(data)
  if (useSQLite) {
    const res = await runStatement(
      `INSERT INTO transactions
        (type,amount,category_id,account_id,to_account_id,merchant,note,reimburse_status,installment_id,auto_source,date)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [p.type, p.amount, p.category_id, p.account_id, p.to_account_id, p.merchant,
        p.note, p.reimburse_status, p.installment_id, p.auto_source, p.date]
    )
    let newId = Number(res?.changes?.lastId) || 0
    if (!newId) {
      const rows = await queryRows('SELECT last_insert_rowid() as id')
      newId = Number(rows[0]?.id) || 0
    }
    await saveTagsFor(newId, data.tag_ids)
    return newId
  }
  const items = lsGet('transactions')
  const newId = lsNextId('transactions')
  items.push({ id: newId, ...p, created_at: nowStr() })
  lsSet('transactions', items)
  await saveTagsFor(newId, data.tag_ids)
  return newId
}

// 批量写入：导入外部账单时用，避免逐条 await 造成 O(n²)
// SQLite 走 executeSet 单事务；localStorage 只读写一次
export async function createTransactionsBatch(list) {
  if (!Array.isArray(list) || list.length === 0) return 0
  const rows = list.map(item => txPayload(item))

  if (useSQLite) {
    const set = rows.map(p => ({
      statement: `INSERT INTO transactions
        (type,amount,category_id,account_id,to_account_id,merchant,note,reimburse_status,installment_id,auto_source,date)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      values: [p.type, p.amount, p.category_id, p.account_id, p.to_account_id,
        p.merchant, p.note, p.reimburse_status, p.installment_id, p.auto_source, p.date]
    }))
    await CapacitorSQLite.executeSet({ database: DB_NAME, set, transaction: true })
    return rows.length
  }

  const items = lsGet('transactions')
  let nextId = items.length ? Math.max(...items.map(i => Number(i.id) || 0)) + 1 : 1
  for (const p of rows) {
    items.push({ id: nextId++, ...p, created_at: nowStr() })
  }
  lsSet('transactions', items)
  return rows.length
}

export async function updateTransaction(data) {
  const id = Number(data.id)
  // 编辑表单里没有 auto_source 字段，未显式传入时沿用原值，
  // 否则把一笔自动收益改成手动，下次同步会重复补记一天
  let autoSource = data.auto_source
  if (autoSource === undefined) {
    const prev = await getTransactionById(id)
    autoSource = prev?.auto_source || ''
  }
  const p = txPayload({ ...data, auto_source: autoSource })
  if (useSQLite) {
    await runStatement(
      `UPDATE transactions SET type=?,amount=?,category_id=?,account_id=?,to_account_id=?,
        merchant=?,note=?,reimburse_status=?,installment_id=?,auto_source=?,date=? WHERE id=?`,
      [p.type, p.amount, p.category_id, p.account_id, p.to_account_id, p.merchant,
        p.note, p.reimburse_status, p.installment_id, p.auto_source, p.date, id]
    )
    await saveTagsFor(id, data.tag_ids)
    return
  }
  const items = lsGet('transactions')
  const idx = items.findIndex(i => Number(i.id) === id)
  if (idx >= 0) Object.assign(items[idx], p)
  lsSet('transactions', items)
  await saveTagsFor(id, data.tag_ids)
}

export async function deleteTransaction(id) {
  const tid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM transaction_tags WHERE transaction_id=?', [tid])
    await runStatement('DELETE FROM transactions WHERE id=?', [tid])
    return
  }
  lsSet('transactions', lsGet('transactions').filter(i => Number(i.id) !== tid))
  lsSet('transactionTags', lsGet('transactionTags').filter(l => Number(l.transaction_id) !== tid))
}

// 批量把「待报销」标记为「已报销」：报销到账后一次性处理一批，不用逐笔进编辑页
export async function markTransactionsReimbursed(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter(Boolean)
  if (!list.length) return 0
  if (useSQLite) {
    for (const id of list) {
      await runStatement("UPDATE transactions SET reimburse_status='done' WHERE id=? AND reimburse_status='pending'", [id])
    }
    return list.length
  }
  const set = new Set(list)
  lsSet('transactions', lsGet('transactions').map(t =>
    set.has(Number(t.id)) && t.reimburse_status === REIMBURSE.PENDING
      ? { ...t, reimburse_status: REIMBURSE.DONE }
      : t))
  return list.length
}

// 批量删除（分期整组、周期清理时使用）
export async function deleteTransactionsByInstallment(installmentId) {
  const iid = Number(installmentId)
  if (useSQLite) {
    const rows = await queryRows('SELECT id FROM transactions WHERE installment_id=?', [iid])
    for (const r of rows) {
      await runStatement('DELETE FROM transaction_tags WHERE transaction_id=?', [Number(r.id)])
    }
    await runStatement('DELETE FROM transactions WHERE installment_id=?', [iid])
    return
  }
  const targets = new Set(lsGet('transactions')
    .filter(t => Number(t.installment_id) === iid)
    .map(t => Number(t.id)))
  lsSet('transactions', lsGet('transactions').filter(t => Number(t.installment_id) !== iid))
  lsSet('transactionTags', lsGet('transactionTags').filter(l => !targets.has(Number(l.transaction_id))))
}

// ========== 统计（转账一律不参与收支） ==========
export async function getMonthlyTotals(yearMonth) {
  if (useSQLite) {
    const rows = await queryRows(`
      SELECT
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense,
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income
      FROM transactions WHERE strftime('%Y-%m',date)=?
    `, [yearMonth])
    return { expense: Number(rows[0]?.expense) || 0, income: Number(rows[0]?.income) || 0 }
  }
  const items = lsGet('transactions').filter(t => (t.date || '').substring(0, 7) === yearMonth)
  return {
    expense: items.filter(t => t.type === TX.EXPENSE).reduce((s, t) => s + (Number(t.amount) || 0), 0),
    income: items.filter(t => t.type === TX.INCOME).reduce((s, t) => s + (Number(t.amount) || 0), 0)
  }
}

export async function getCategoryTotals(yearMonth, type = TX.EXPENSE) {
  if (useSQLite) {
    return queryRows(`
      SELECT c.name, c.icon, SUM(t.amount) as total
      FROM transactions t LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.type=? AND strftime('%Y-%m',t.date)=?
      GROUP BY t.category_id ORDER BY total DESC
    `, [type, yearMonth])
  }
  const cats = lsGet('categories')
  const items = lsGet('transactions')
    .filter(t => (t.date || '').substring(0, 7) === yearMonth && t.type === type)
  const map = {}
  for (const t of items) {
    if (!map[t.category_id]) {
      const c = cats.find(c => Number(c.id) === Number(t.category_id))
      map[t.category_id] = { name: c?.name || '未分类', icon: c?.icon || '📌', total: 0 }
    }
    map[t.category_id].total += Number(t.amount) || 0
  }
  return Object.values(map).sort((a, b) => b.total - a.total)
}

// 净资产 = 普通账户余额 + 信用卡余额（负数即欠款）+ 投资市值由调用方补齐
export async function getAssetSummary() {
  const accounts = await getAccounts()
  return accounts.reduce((sum, a) => sum + (a.type === ACC.INVESTMENT ? 0 : Number(a.balance) || 0), 0)
}

// ========== 分期 ==========
function addMonths(dateStr, months) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const base = new Date(y, (m || 1) - 1 + months, 1)
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
  base.setDate(Math.min(d || 1, lastDay))
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

export async function getInstallments() {
  const rows = useSQLite
    ? await queryRows(`
        SELECT i.*, c.name as category_name, c.icon as category_icon, a.name as account_name,
          (SELECT COUNT(*) FROM transactions t WHERE t.installment_id = i.id) as generated,
          (SELECT COUNT(*) FROM transactions t WHERE t.installment_id = i.id AND t.date <= date('now','localtime')) as paid
        FROM installments i
        LEFT JOIN categories c ON i.category_id = c.id
        LEFT JOIN accounts a ON i.account_id = a.id
        ORDER BY i.start_date DESC, i.id DESC
      `)
    : (() => {
      const txs = lsGet('transactions')
      const cats = lsGet('categories')
      const accs = lsGet('accounts')
      const today = todayStr()
      return lsGet('installments').map(i => {
        const mine = txs.filter(t => Number(t.installment_id) === Number(i.id))
        const cat = cats.find(c => Number(c.id) === Number(i.category_id))
        const acc = accs.find(a => Number(a.id) === Number(i.account_id))
        return {
          ...i,
          category_name: cat?.name, category_icon: cat?.icon, account_name: acc?.name,
          generated: mine.length,
          paid: mine.filter(t => (t.date || '') <= today).length
        }
      }).sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')))
    })()
  return rows.map(r => ({
    ...r,
    id: Number(r.id),
    periods: Number(r.periods) || 1,
    total_amount: Number(r.total_amount) || 0,
    generated: Number(r.generated) || 0,
    paid: Number(r.paid) || 0
  }))
}

// 分期创建时预生成全部期数的交易，后续可逐笔编辑
export async function createInstallment(data) {
  const periods = Math.max(1, Math.min(120, Math.round(Number(data.periods) || 1)))
  const total = Number(data.total_amount) || 0
  if (total <= 0) throw new Error('分期总额必须大于 0')
  const startDate = data.start_date || todayStr()
  const perAmount = Math.round((total / periods) * 100) / 100

  let installmentId
  if (useSQLite) {
    await runStatement(
      'INSERT INTO installments (name,total_amount,periods,category_id,account_id,note,start_date) VALUES(?,?,?,?,?,?,?)',
      [data.name || '分期', total, periods, data.category_id || null, data.account_id || null, data.note || '', startDate]
    )
    const rows = await queryRows('SELECT last_insert_rowid() as id')
    installmentId = Number(rows[0]?.id) || 0
  } else {
    const items = lsGet('installments')
    installmentId = lsNextId('installments')
    items.push({
      id: installmentId, name: data.name || '分期', total_amount: total, periods,
      category_id: data.category_id || null, account_id: data.account_id || null,
      note: data.note || '', start_date: startDate, created_at: nowStr()
    })
    lsSet('installments', items)
  }

  for (let i = 0; i < periods; i++) {
    // 末期用总额减去前面各期，避免除不尽时的分币误差
    const amount = i === periods - 1
      ? Math.round((total - perAmount * (periods - 1)) * 100) / 100
      : perAmount
    await createTransaction({
      type: TX.EXPENSE,
      amount,
      category_id: data.category_id || null,
      account_id: data.account_id || null,
      note: data.note ? `${data.note}（第 ${i + 1}/${periods} 期）` : `第 ${i + 1}/${periods} 期`,
      date: addMonths(startDate, i),
      installment_id: installmentId
    })
  }
  return installmentId
}

export async function deleteInstallment(id) {
  const iid = Number(id)
  await deleteTransactionsByInstallment(iid)
  if (useSQLite) {
    await runStatement('DELETE FROM installments WHERE id=?', [iid])
    return
  }
  lsSet('installments', lsGet('installments').filter(i => Number(i.id) !== iid))
}

// ========== 周期记账 ==========
export async function getRecurringRules() {
  const rows = useSQLite
    ? await queryRows(`
        SELECT r.*, c.name as category_name, c.icon as category_icon,
          a.name as account_name, b.name as to_account_name
        FROM recurring_rules r
        LEFT JOIN categories c ON r.category_id = c.id
        LEFT JOIN accounts a ON r.account_id = a.id
        LEFT JOIN accounts b ON r.to_account_id = b.id
        ORDER BY r.id DESC
      `)
    : (() => {
      const cats = lsGet('categories')
      const accs = lsGet('accounts')
      return lsGet('recurring').map(r => {
        const cat = cats.find(c => Number(c.id) === Number(r.category_id))
        const acc = accs.find(a => Number(a.id) === Number(r.account_id))
        const toAcc = accs.find(a => Number(a.id) === Number(r.to_account_id))
        return {
          ...r,
          category_name: cat?.name, category_icon: cat?.icon,
          account_name: acc?.name, to_account_name: toAcc?.name
        }
      }).sort((a, b) => Number(b.id) - Number(a.id))
    })()
  return rows.map(r => ({
    ...r,
    id: Number(r.id),
    amount: Number(r.amount) || 0,
    enabled: Number(r.enabled) === 0 ? 0 : 1
  }))
}

// 规则变更后置一个脏标记，首页据此立刻补齐到期账单。
// 只靠「本次启动已扫过」的标记会漏掉：在设置页或对话里新建规则后回首页，
// 当天不会生成，用户会以为规则没生效
export const RECURRING_DIRTY_KEY = 'bk_recurring_dirty'

function markRecurringDirty() {
  try {
    localStorage.setItem(RECURRING_DIRTY_KEY, '1')
  } catch {
    // 存储不可用时忽略，下次启动仍会扫描
  }
}

export async function saveRecurringRule(data) {
  const payload = [
    data.name || '周期记账',
    [TX.EXPENSE, TX.INCOME, TX.TRANSFER].includes(data.type) ? data.type : TX.EXPENSE,
    Number(data.amount) || 0,
    data.category_id || null,
    data.account_id || null,
    data.to_account_id || null,
    data.note || '',
    data.merchant || '',
    Object.values(FREQ).includes(data.frequency) ? data.frequency : FREQ.MONTHLY,
    data.start_date || todayStr(),
    data.end_date || '',
    Number(data.enabled) === 0 ? 0 : 1
  ]

  let existingId = Number(data.id) || 0
  if (!existingId) {
    // 完全相同的规则（名称/类型/金额/频率/起始日一致）视为重复提交，
    // 落到已有那条而不是新建。否则同一件事说两次就会有两套规则，
    // 每次到期各生成一份账单，账目凭空翻倍
    const dup = (await getRecurringRules()).find(r =>
      String(r.name || '') === String(payload[0] || '') &&
      r.type === payload[1] &&
      Number(r.amount) === payload[2] &&
      r.frequency === payload[8] &&
      String(r.start_date || '') === String(payload[9] || '')
    )
    if (dup) existingId = Number(dup.id)
  }

  if (useSQLite) {
    if (existingId) {
      await runStatement(
        `UPDATE recurring_rules SET name=?,type=?,amount=?,category_id=?,account_id=?,to_account_id=?,
          note=?,merchant=?,frequency=?,start_date=?,end_date=?,enabled=? WHERE id=?`,
        [...payload, existingId]
      )
      markRecurringDirty()
      return existingId
    }
    await runStatement(
      `INSERT INTO recurring_rules
        (name,type,amount,category_id,account_id,to_account_id,note,merchant,frequency,start_date,end_date,enabled)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, payload)
    const rows = await queryRows('SELECT last_insert_rowid() as id')
    markRecurringDirty()
    return Number(rows[0]?.id) || 0
  }
  const items = lsGet('recurring')
  if (existingId) {
    const idx = items.findIndex(i => Number(i.id) === existingId)
    if (idx >= 0) Object.assign(items[idx], {
      name: payload[0], type: payload[1], amount: payload[2], category_id: payload[3],
      account_id: payload[4], to_account_id: payload[5], note: payload[6], merchant: payload[7],
      frequency: payload[8], start_date: payload[9], end_date: payload[10], enabled: payload[11]
    })
    lsSet('recurring', items)
    markRecurringDirty()
    return existingId
  }
  const id = lsNextId('recurring')
  items.push({
    id, name: payload[0], type: payload[1], amount: payload[2], category_id: payload[3],
    account_id: payload[4], to_account_id: payload[5], note: payload[6], merchant: payload[7],
    frequency: payload[8], start_date: payload[9], end_date: payload[10], enabled: payload[11],
    last_generated: '', created_at: nowStr()
  })
  lsSet('recurring', items)
  markRecurringDirty()
  return id
}

export async function deleteRecurringRule(id) {
  const rid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM recurring_rules WHERE id=?', [rid])
    return
  }
  lsSet('recurring', lsGet('recurring').filter(i => Number(i.id) !== rid))
}

function nextDate(dateStr, frequency) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  if (frequency === FREQ.DAILY) dt.setDate(dt.getDate() + 1)
  else if (frequency === FREQ.WEEKLY) dt.setDate(dt.getDate() + 7)
  else if (frequency === FREQ.YEARLY) dt.setFullYear(dt.getFullYear() + 1)
  else dt.setMonth(dt.getMonth() + 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

async function markRuleGenerated(rule, dateStr) {
  if (useSQLite) {
    await runStatement('UPDATE recurring_rules SET last_generated=? WHERE id=?', [dateStr, Number(rule.id)])
    return
  }
  const items = lsGet('recurring')
  const idx = items.findIndex(i => Number(i.id) === Number(rule.id))
  if (idx >= 0) items[idx].last_generated = dateStr
  lsSet('recurring', items)
}

// 补齐到期未生成的周期交易，App 启动与进入首页时调用
export async function runRecurringRules() {
  const rules = (await getRecurringRules()).filter(r => r.enabled)
  const today = todayStr()
  let created = 0
  for (const rule of rules) {
    try {
      if (!rule.start_date) continue
      // 用局部变量推进日期：markRuleGenerated 只落库，不会回写内存里的 rule 对象
      let generated = rule.last_generated || ''
      let cursor = generated || rule.start_date
      let guard = 0
      while (guard++ < 400) {
        const next = generated ? nextDate(cursor, rule.frequency) : cursor
        if (next > today) break
        if (rule.end_date && next > rule.end_date) break
        await createTransaction({
          type: rule.type,
          amount: rule.amount,
          category_id: rule.category_id,
          account_id: rule.account_id,
          to_account_id: rule.to_account_id,
          note: rule.note || rule.name,
          merchant: rule.merchant || '',
          date: next
        })
        created++
        generated = next
        cursor = next
        await markRuleGenerated(rule, next)
      }
    } catch (e) {
      console.warn(`[DB] 周期记账 ${rule.name} 生成失败:`, e.message)
    }
  }
  return created
}

// ========== 预算 ==========
export const BUDGET_SCOPE = { TOTAL: 'total', CATEGORY: 'category' }
export const BUDGET_PERIOD = { WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }

// 分类 id 列表：库里存逗号分隔文本，界面用数组
function parseIdList(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(Number).filter(n => Number.isFinite(n) && n > 0))]
  }
  return [...new Set(
    String(raw ?? '')
      .split(',')
      .map(s => Number(String(s).trim()))
      .filter(n => Number.isFinite(n) && n > 0)
  )]
}

// 一个预算可以覆盖多个分类，集合相同就算同一条（顺序无关）
function categoryIdsOf(data) {
  const own = Array.isArray(data.category_ids) || typeof data.category_ids === 'string'
  return parseIdList(own ? data.category_ids : data.category_id)
}

function categorySignature(ids) {
  return [...ids].sort((a, b) => a - b).join(',')
}

function normalizeBudget(b) {
  // category_ids 是主口径；老数据只有 category_id，回落到单元素集合。
  // category_id 继续保留为集合第一个元素，兼容提示词与旧页面
  const ids = categoryIdsOf({ category_ids: b.category_ids, category_id: b.category_id })
  return {
    ...b,
    id: Number(b.id),
    name: b.name || '',
    scope: b.scope === BUDGET_SCOPE.CATEGORY ? BUDGET_SCOPE.CATEGORY : BUDGET_SCOPE.TOTAL,
    category_ids: ids,
    category_id: ids[0] ?? null,
    amount: Number(b.amount) || 0,
    period: Object.values(BUDGET_PERIOD).includes(b.period) ? b.period : BUDGET_PERIOD.MONTHLY,
    carry_over: Number(b.carry_over) ? 1 : 0,
    start_date: b.start_date || '',
    enabled: Number(b.enabled) === 0 ? 0 : 1
  }
}

export async function getBudgets() {
  const rows = useSQLite
    ? await queryRows(`
        SELECT b.*, c.name as category_name, c.icon as category_icon
        FROM budgets b LEFT JOIN categories c ON b.category_id = c.id
        ORDER BY b.scope ASC, b.id ASC
      `)
    : lsGet('budgets')
      .map(b => ({ ...b }))
      .sort((a, b) => String(a.scope).localeCompare(String(b.scope)) || Number(a.id) - Number(b.id))

  const list = rows.map(normalizeBudget)
  // 分类名要按集合补全：卡片和提示词都靠它显示「餐饮、交通」
  const cats = await getCategories()
  const byId = new Map(cats.map(c => [Number(c.id), c]))
  return list.map(b => {
    const hit = (b.scope === BUDGET_SCOPE.CATEGORY ? b.category_ids : [])
      .map(id => byId.get(Number(id)))
      .filter(Boolean)
    return {
      ...b,
      category_names: hit.map(c => c.name),
      category_name: hit.length ? hit.map(c => c.name).join('、') : (b.category_name || ''),
      category_icon: hit[0]?.icon || b.category_icon || '📌'
    }
  })
}

export async function saveBudget(data) {
  let targetId = Number(data.id) || 0
  const scope = data.scope === BUDGET_SCOPE.CATEGORY ? BUDGET_SCOPE.CATEGORY : BUDGET_SCOPE.TOTAL
  const categoryIds = scope === BUDGET_SCOPE.CATEGORY ? categoryIdsOf(data) : []
  let reused = null

  // 总预算只允许存在一条；分类预算同一个分类集合也只允许一条。
  // 没有显式 id 但库里已有对应预算时，落到已存在那条上，而不是再插一条：
  // 页面只展示第一条，新建出来的第二条用户看不见，改的也永远是它，
  // 表现就是「在预算页改了金额，却一直显示旧值」。
  // 分类预算重复时更糟：同一个分类会出现两张卡，各算各的进度。
  if (!targetId) {
    const list = await getBudgets()
    const existing = scope === BUDGET_SCOPE.TOTAL
      ? list.find(b => b.scope === BUDGET_SCOPE.TOTAL)
      : (categoryIds.length
        ? list.find(b => b.scope === BUDGET_SCOPE.CATEGORY &&
          categorySignature(b.category_ids) === categorySignature(categoryIds))
        : null)
    if (existing) {
      targetId = Number(existing.id)
      reused = existing
    }
  }

  const payload = [
    // 重复创建时沿用原有配置：起始日决定结转从哪一期开始累加，
    // 周期和结转开关被表单默认值覆盖的话，用户开了几个月的结转会直接作废。
    // 只有金额和范围是用户这次明确填的，其余一律保留原值。
    reused ? (reused.name || '') : String(data.name || '').trim(),
    scope,
    // category_id 存集合第一个，category_ids 存完整集合
    categoryIds[0] ?? null,
    Number(data.amount) || 0,
    reused
      ? (Object.values(BUDGET_PERIOD).includes(reused.period) ? reused.period : BUDGET_PERIOD.MONTHLY)
      : (Object.values(BUDGET_PERIOD).includes(data.period) ? data.period : BUDGET_PERIOD.MONTHLY),
    reused ? (Number(reused.carry_over) ? 1 : 0) : (Number(data.carry_over) ? 1 : 0),
    reused ? (reused.start_date || todayStr()) : (data.start_date || todayStr()),
    Number(data.enabled) === 0 ? 0 : 1,
    categoryIds.join(',')
  ]
  if (useSQLite) {
    if (targetId) {
      await runStatement(
        `UPDATE budgets SET name=?,scope=?,category_id=?,amount=?,period=?,carry_over=?,start_date=?,enabled=?,category_ids=?
         WHERE id=?`,
        [...payload, targetId]
      )
      return targetId
    }
    await runStatement(
      `INSERT INTO budgets (name,scope,category_id,amount,period,carry_over,start_date,enabled,category_ids)
       VALUES(?,?,?,?,?,?,?,?,?)`, payload)
    const rows = await queryRows('SELECT last_insert_rowid() as id')
    return Number(rows[0]?.id) || 0
  }
  const items = lsGet('budgets')
  if (targetId) {
    const idx = items.findIndex(i => Number(i.id) === targetId)
    if (idx >= 0) {
      Object.assign(items[idx], {
        name: payload[0], scope: payload[1], category_id: payload[2], amount: payload[3],
        period: payload[4], carry_over: payload[5], start_date: payload[6], enabled: payload[7],
        category_ids: payload[8]
      })
      lsSet('budgets', items)
      return targetId
    }
    // 指定的 id 已经不存在了，退回新建
  }
  const id = lsNextId('budgets')
  items.push({
    id, name: payload[0], scope: payload[1], category_id: payload[2], amount: payload[3],
    period: payload[4], carry_over: payload[5], start_date: payload[6], enabled: payload[7],
    category_ids: payload[8],
    created_at: nowStr()
  })
  lsSet('budgets', items)
  return id
}

export async function deleteBudget(id) {
  const bid = Number(id)
  if (useSQLite) {
    await runStatement('DELETE FROM budgets WHERE id=?', [bid])
    return
  }
  lsSet('budgets', lsGet('budgets').filter(i => Number(i.id) !== bid))
}

// ========== 导出 / 导入 ==========
const EXPORT_VERSION = 3

export async function exportAllData() {
  const base = {
    version: EXPORT_VERSION,
    exportDate: new Date().toISOString(),
    accounts: await getAccounts(),
    categories: await getCategories(),
    transactions: await getTransactions(),
    tags: await getTags(),
    installments: await getInstallments(),
    recurringRules: await getRecurringRules(),
    budgets: await getBudgets()
  }
  return base
}

function stripJoined(t) {
  return {
    id: Number(t.id),
    type: t.type || TX.EXPENSE,
    amount: Number(t.amount) || 0,
    category_id: t.category_id || null,
    account_id: t.account_id || null,
    to_account_id: t.to_account_id || null,
    merchant: t.merchant || '',
    note: t.note || '',
    reimburse_status: t.reimburse_status || REIMBURSE.NONE,
    installment_id: t.installment_id || null,
    auto_source: t.auto_source || '',
    date: t.date,
    created_at: t.created_at || null
  }
}

export async function importAllData(data) {
  if (!data?.version) throw new Error('无效的备份文件')
  const accounts = data.accounts || []
  const categories = data.categories || []
  const transactions = data.transactions || []
  const tags = data.tags || []
  const installments = data.installments || []
  const recurringRules = data.recurringRules || []
  const budgets = data.budgets || []

  if (useSQLite) {
    // 清表属于无占位符 DDL
    await CapacitorSQLite.execute({
      database: DB_NAME,
      statements: 'DELETE FROM transaction_tags; DELETE FROM transactions; DELETE FROM categories; DELETE FROM accounts; DELETE FROM tags; DELETE FROM installments; DELETE FROM recurring_rules; DELETE FROM budgets;'
    })
    for (const a of accounts) {
      const p = accountPayload(a)
      await runStatement(
        `INSERT INTO accounts
          (id,name,icon,type,initial_balance,credit_limit,bill_day,repay_day,market,symbol,shares,cost_price,
           interest_code,interest_settled_date,auto_earn,sort_order,balance,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [Number(a.id), p.name, p.icon, p.type, p.initial_balance, p.credit_limit, p.bill_day, p.repay_day,
          p.market, p.symbol, p.shares, p.cost_price, p.interest_code, p.interest_settled_date,
          p.auto_earn, p.sort_order, p.initial_balance, a.created_at || null]
      )
    }
    for (const c of categories) {
      await runStatement('INSERT INTO categories (id,name,icon,type,sort_order,created_at) VALUES(?,?,?,?,?,?)',
        [Number(c.id), c.name, c.icon || '📌', c.type || 'expense', c.sort_order || 0, c.created_at || null])
    }
    for (const g of tags) {
      await runStatement('INSERT INTO tags (id,name,sort_order,created_at) VALUES(?,?,?,?)',
        [Number(g.id), g.name, g.sort_order || 0, g.created_at || null])
    }
    for (const i of installments) {
      await runStatement(
        'INSERT INTO installments (id,name,total_amount,periods,category_id,account_id,note,start_date,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [Number(i.id), i.name, i.total_amount || 0, i.periods || 1, i.category_id || null,
          i.account_id || null, i.note || '', i.start_date, i.created_at || null])
    }
    for (const r of recurringRules) {
      await runStatement(
        `INSERT INTO recurring_rules
          (id,name,type,amount,category_id,account_id,to_account_id,note,merchant,frequency,start_date,end_date,last_generated,enabled,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [Number(r.id), r.name, r.type || TX.EXPENSE, r.amount || 0, r.category_id || null,
          r.account_id || null, r.to_account_id || null, r.note || '', r.merchant || '',
          r.frequency || FREQ.MONTHLY, r.start_date, r.end_date || '', r.last_generated || '',
          Number(r.enabled) === 0 ? 0 : 1, r.created_at || null])
    }
    for (const b of budgets) {
      // 旧备份只有 category_id，导出后统一补成 category_ids 集合
      await runStatement(
        `INSERT INTO budgets (id,name,scope,category_id,amount,period,carry_over,start_date,enabled,category_ids,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [Number(b.id), b.name || '', b.scope || BUDGET_SCOPE.TOTAL, b.category_id || null,
          b.amount || 0, b.period || BUDGET_PERIOD.MONTHLY, Number(b.carry_over) ? 1 : 0,
          b.start_date || '', Number(b.enabled) === 0 ? 0 : 1,
          categoryIdsOf(b).join(','), b.created_at || null])
    }
    for (const t of transactions) {
      const p = stripJoined(t)
      await runStatement(
        `INSERT INTO transactions
          (id,type,amount,category_id,account_id,to_account_id,merchant,note,reimburse_status,installment_id,auto_source,date,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.id, p.type, p.amount, p.category_id, p.account_id, p.to_account_id, p.merchant,
          p.note, p.reimburse_status, p.installment_id, p.auto_source, p.date, p.created_at]
      )
      for (const g of (t.tags || [])) {
        await runStatement('INSERT OR IGNORE INTO transaction_tags (transaction_id,tag_id) VALUES(?,?)',
          [p.id, Number(g.id)])
      }
    }
    return
  }

  lsSet('accounts', accounts.map(a => {
    const p = accountPayload(a)
    return { id: Number(a.id), ...p, balance: p.initial_balance, created_at: a.created_at || null }
  }))
  lsSet('categories', categories.map(c => ({ ...c, id: Number(c.id) })))
  lsSet('tags', tags.map(g => ({ ...g, id: Number(g.id) })))
  lsSet('installments', installments.map(i => ({ ...i, id: Number(i.id) })))
  lsSet('recurring', recurringRules.map(r => ({ ...r, id: Number(r.id) })))
  lsSet('budgets', budgets.map(b => ({ ...b, id: Number(b.id) })))
  lsSet('transactions', transactions.map(t => stripJoined(t)))
  const links = []
  for (const t of transactions) {
    for (const g of (t.tags || [])) {
      links.push({ transaction_id: Number(t.id), tag_id: Number(g.id) })
    }
  }
  lsSet('transactionTags', links)
}
