import { Capacitor } from '@capacitor/core'

/**
 * 行情服务：黄金实时价、基金净值/盘中估值
 * - 原生 App：使用 CapacitorHttp 发起请求，可绕过 WebView 跨域限制并自定义 Referer
 * - 浏览器：开发环境走 vite 代理，失败时回退到支持 CORS 的备用接口
 * 所有结果会缓存 5 分钟，离线或接口异常时仍可展示最近一次数据
 */

const isNative = Capacitor.isNativePlatform()
const isDev = import.meta.env.DEV

const OUNCE_TO_GRAM = 31.1034768
// 新鲜期：1 分钟内重复打开页面直接复用缓存，避免频繁请求；超过则重新查询一次
const CACHE_TTL = 60 * 1000
const GOLD_CACHE_KEY = 'bk_quote_gold'
const FUND_CACHE_PREFIX = 'bk_quote_fund_'
const WATCHLIST_KEY = 'bk_fund_watchlist'

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ========== 缓存 ==========
function readCache(key, ttl = CACHE_TTL) {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || 'null')
    if (!raw || !raw.data) return null
    if (Date.now() - raw.ts > ttl) return null
    return raw.data
  } catch {
    return null
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }))
  } catch {
    /* 存储空间不足时忽略缓存 */
  }
}

// 不限时效的上一次结果（请求失败时兜底，保证盈亏仍按上一次行情计算）
function readStaleCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')?.data || null
  } catch {
    return null
  }
}

export function peekGoldCache() {
  try {
    return JSON.parse(localStorage.getItem(GOLD_CACHE_KEY) || 'null')?.data || null
  } catch {
    return null
  }
}

// ========== 请求 ==========
async function httpGetText(url, { headers = {}, timeout = 10000 } = {}) {
  if (isNative) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeout,
      readTimeout: timeout,
      responseType: 'text'
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function httpGetJson(url, options) {
  const text = await httpGetText(url, options)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('行情数据解析失败')
  }
}

function decodeBase64(data, charset) {
  if (typeof data !== 'string') return JSON.stringify(data)
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder(charset).decode(bytes)
}

// 新浪接口为 GBK/GB18030 编码，fetch().text() 会强制按 UTF-8 解码导致中文乱码，
// 因此统一按二进制获取后再用指定字符集解码
async function httpGetTextWithCharset(url, charset, { headers = {}, timeout = 10000 } = {}) {
  if (isNative) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.get({
      url,
      headers,
      connectTimeout: timeout,
      readTimeout: timeout,
      responseType: 'arraybuffer'
    })
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`)
    return decodeBase64(res.data, charset)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new TextDecoder(charset).decode(await res.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function withRetry(task, retries = 2, delay = 700) {
  let lastError
  for (let i = 0; i <= retries; i++) {
    try {
      return await task()
    } catch (e) {
      lastError = e
      // 代码错误或确实无数据时重试无意义，直接抛出
      if (/未查询到|暂无净值/.test(e.message || '')) break
      if (i < retries) await sleep(delay * (i + 1))
    }
  }
  throw lastError
}

// ========== 黄金 ==========
function sinaUrl(path) {
  if (isNative) return `https://hq.sinajs.cn${path}`
  // 浏览器无法设置 Referer，开发环境依靠 vite 代理补上
  return isDev ? `/sina-api${path}` : `https://hq.sinajs.cn${path}`
}

async function fetchGoldFromSina() {
  const text = await httpGetText(sinaUrl('/list=hf_GC,fx_susdcny'), {
    headers: { Referer: 'https://finance.sina.com.cn' },
    timeout: 8000
  })

  const gc = /hq_str_hf_GC="([^"]*)"/.exec(text)?.[1]
  if (!gc) throw new Error('新浪金价返回为空')
  const gcFields = gc.split(',')
  const usdPerOz = toNum(gcFields[0])
  const prevClose = toNum(gcFields[7])
  const date = gcFields[12] || ''
  const time = gcFields[6] || ''
  if (!usdPerOz) throw new Error('新浪金价无效')

  // 美元兑人民币：优先取最新价，回退买卖价中值
  let usdCny = null
  const fx = /hq_str_fx_susdcny="([^"]*)"/.exec(text)?.[1]
  if (fx) {
    const fxFields = fx.split(',')
    const bid = toNum(fxFields[1])
    const ask = toNum(fxFields[2])
    usdCny = toNum(fxFields[8]) || (bid && ask ? (bid + ask) / 2 : null) || bid
  }
  if (!usdCny) throw new Error('汇率获取失败')

  return {
    source: 'sina',
    price: (usdPerOz / OUNCE_TO_GRAM) * usdCny, // 人民币/克
    usdPerOz,
    usdCny,
    prevClose,
    changePercent: prevClose ? ((usdPerOz - prevClose) / prevClose) * 100 : null,
    quoteTime: [date, time].filter(Boolean).join(' '),
    updatedAt: Date.now()
  }
}

async function fetchGoldFromFallback() {
  const [gold, fx] = await Promise.all([
    httpGetJson('https://api.gold-api.com/price/XAU'),
    httpGetJson('https://open.er-api.com/v6/latest/USD')
  ])
  const usdPerOz = toNum(gold?.price)
  const usdCny = toNum(fx?.rates?.CNY)
  if (!usdPerOz || !usdCny) throw new Error('备用金价接口失败')

  return {
    source: 'gold-api',
    price: (usdPerOz / OUNCE_TO_GRAM) * usdCny,
    usdPerOz,
    usdCny,
    prevClose: null,
    changePercent: null,
    quoteTime: gold.updatedAt || '',
    updatedAt: Date.now()
  }
}

export async function fetchGoldQuote({ force = false } = {}) {
  if (!force) {
    const cached = readCache(GOLD_CACHE_KEY)
    if (cached) return { ...cached, cached: true }
  }

  try {
    let quote
    try {
      quote = await fetchGoldFromSina()
    } catch (e) {
      console.warn('[行情] 新浪金价失败，尝试备用源:', e.message)
      quote = await fetchGoldFromFallback()
    }
    writeCache(GOLD_CACHE_KEY, quote)
    return quote
  } catch (e) {
    // 全部数据源失败：沿用上一次报价，而不是让市值变成 0
    const stale = readStaleCache(GOLD_CACHE_KEY)
    if (stale) return { ...stale, stale: true, error: e.message }
    throw e
  }
}

// ========== 基金 ==========
function normalizeFundCode(code) {
  return String(code || '').trim()
}

function isValidFundCode(code) {
  return /^\d{6}$/.test(normalizeFundCode(code))
}

async function fetchFundFromEastmoney(code) {
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    `?pageIndex=1&pageSize=20&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${encodeURIComponent(code)}&_=${Date.now()}`

  const json = await httpGetJson(url, { timeout: 10000 })
  if (json?.Success === false) {
    throw new Error(json?.ErrMsg || '行情服务繁忙，请稍后重试')
  }
  const item = json?.Datas?.[0]
  if (!item) throw new Error('未查询到该基金，请检查代码')

  const nav = toNum(item.NAV)
  const estimate = toNum(item.GSZ)
  const navChange = toNum(item.NAVCHGRT)
  const estimateChange = toNum(item.GSZZL)
  const price = estimate ?? nav
  if (price === null) throw new Error('该基金暂无净值数据')

  return {
    code: item.FCODE || code,
    name: item.SHORTNAME || code,
    price,
    changePercent: estimateChange ?? navChange,
    nav,
    navChange,
    navDate: item.PDATE || '',
    isEstimate: estimate !== null,
    quoteTime: item.GZTIME || json?.Expansion?.GZTIME || item.PDATE || '',
    updatedAt: Date.now()
  }
}

// 新浪基金：最新净值(f_) + 盘中估值(fu_)，GBK 编码
async function fetchFundFromSina(code) {
  const text = await httpGetTextWithCharset(
    sinaUrl(`/list=f_${code},fu_${code}`),
    'gb18030',
    { headers: { Referer: 'https://finance.sina.com.cn' }, timeout: 7000 }
  )

  const fLine = new RegExp(`hq_str_f_${code}="([^"]*)"`).exec(text)?.[1] || ''
  const fuLine = new RegExp(`hq_str_fu_${code}="([^"]*)"`).exec(text)?.[1] || ''
  if (!fLine && !fuLine) throw new Error('未查询到该基金，请检查代码')

  const f = fLine ? fLine.split(',') : []
  const fu = fuLine ? fuLine.split(',') : []

  const nav = toNum(f[1])
  const prevNav = toNum(f[3])
  const navDate = f[4] || ''
  const estimate = toNum(fu[2])
  const estimateChange = toNum(fu[6])
  const estimateTime = fu[1] || ''
  const estimateDate = fu[7] || ''
  const price = estimate ?? nav
  if (price === null) throw new Error('该基金暂无净值数据')

  return {
    code,
    name: sanitizeSinaName(f[0] || fu[0], code),
    price,
    changePercent: estimateChange ?? (nav !== null && prevNav ? ((nav - prevNav) / prevNav) * 100 : null),
    nav,
    navChange: nav !== null && prevNav ? ((nav - prevNav) / prevNav) * 100 : null,
    navDate,
    isEstimate: estimate !== null,
    quoteTime: estimate ? [estimateDate, estimateTime].filter(Boolean).join(' ') : navDate,
    updatedAt: Date.now()
  }
}

// 原生端按 UTF-8 解码 GBK 响应时中文名会变成替换符，此时用代码代替
function sanitizeSinaName(name, code) {
  const s = String(name || '').trim()
  if (!s || s.includes('\uFFFD')) return `基金 ${code}`
  return s
}

// 备用源：蛋卷基金（无 CORS 头，仅原生 App 可用），提供最新公布净值
async function fetchFundFromDanjuan(code) {
  if (!isNative) throw new Error('备用行情源不可用')
  const json = await httpGetJson(`https://danjuanfunds.com/djapi/fund/${encodeURIComponent(code)}`, {
    timeout: 10000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' }
  })
  const fund = json?.data
  const derived = fund?.fund_derived
  const nav = toNum(derived?.unit_nav)
  if (!fund || nav === null) throw new Error('未查询到该基金，请检查代码')

  return {
    code: fund.fd_code || code,
    name: fund.fd_name || code,
    price: nav,
    changePercent: toNum(derived.nav_grtd),
    nav,
    navChange: toNum(derived.nav_grtd),
    navDate: derived.end_date || '',
    isEstimate: false,
    quoteTime: derived.end_date || '',
    updatedAt: Date.now()
  }
}

export async function fetchFundQuote(code, { force = false } = {}) {
  const fundCode = normalizeFundCode(code)
  if (!isValidFundCode(fundCode)) throw new Error('基金代码需为 6 位数字')

  const key = FUND_CACHE_PREFIX + fundCode
  if (!force) {
    const cached = readCache(key)
    if (cached) return { ...cached, cached: true }
  }

  let quote = null
  let lastError = null
  const sources = isNative
    ? [
        () => withRetry(() => fetchFundFromEastmoney(fundCode), 1),
        () => fetchFundFromDanjuan(fundCode),
        () => fetchFundFromSina(fundCode)
      ]
    : isDev
      ? [
          () => fetchFundFromSina(fundCode),
          () => withRetry(() => fetchFundFromEastmoney(fundCode), 1)
        ]
      : [() => withRetry(() => fetchFundFromEastmoney(fundCode), 1)]

  for (const source of sources) {
    try {
      quote = await source()
      break
    } catch (e) {
      lastError = e
      console.warn('[行情] 基金数据源失败:', e.message)
      // 代码错误或确实无数据时，换数据源也没意义
      if (/未查询到|暂无净值/.test(e.message || '')) break
    }
  }
  if (!quote) {
    // 全部数据源失败：沿用上一次净值，避免盈亏因断网而清零
    const stale = readStaleCache(key)
    if (stale) return { ...stale, stale: true, error: lastError?.message || '' }
    throw lastError || new Error('基金行情获取失败')
  }

  writeCache(key, quote)
  return quote
}

export function peekFundCache(code) {
  try {
    return JSON.parse(localStorage.getItem(FUND_CACHE_PREFIX + normalizeFundCode(code)) || 'null')?.data || null
  } catch {
    return null
  }
}

// ========== 基金自选 ==========
export function getWatchlist() {
  try {
    const list = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list))
}

// ========== 货币基金（余额宝 / 零钱通） ==========
// 货币基金净值恒为 1，东财接口把 NAV 字段复用为「每万份收益」，ACCNAV 复用为「七日年化收益率(%)」
// 识别标志：NAVCHGRT 恒为 "--"、GSZ 恒为 null
const MONEY_CACHE_PREFIX = 'bk_quote_money_'
const MONEY_HISTORY_PREFIX = 'bk_money_hist_'
// 万份收益每天只更新一次，缓存 30 分钟足够
const MONEY_CACHE_TTL = 30 * 60 * 1000
const MONEY_HISTORY_TTL = 6 * 60 * 60 * 1000

// 余额宝固定对接天弘余额宝货币；零钱通是多只货币基金的容器，需用户自己选
export const MONEY_FUND_PRESETS = [
  { code: '000198', name: '余额宝 · 天弘余额宝货币', short: '余额宝' },
  { code: '000359', name: '零钱通 · 易方达易理财A', short: '零钱通·易方达' },
  { code: '000719', name: '零钱通 · 南方现金通E', short: '零钱通·南方' },
  { code: '000618', name: '零钱通 · 嘉实薪金宝A', short: '零钱通·嘉实' },
  { code: '000848', name: '零钱通 · 工银现金快线', short: '零钱通·工银' },
  { code: '000397', name: '零钱通 · 汇添富全额宝', short: '零钱通·汇添富' }
]

function parseMoneyFields(item) {
  const millionIncome = toNum(item.NAV)
  const sevenDayYield = toNum(item.ACCNAV)
  // 普通基金的 GSZ/NAVCHGRT 会有值，货币基金两者都为空
  const looksLikeMoneyFund = item.NAVCHGRT === '--' || item.NAVCHGRT === null
  return { millionIncome, sevenDayYield, looksLikeMoneyFund }
}

// 主数据源：东财移动端接口（响应带 CORS 头，三种环境都可用）
async function fetchMoneyQuoteFromEastmoney(fundCode) {
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo' +
    `?pageIndex=1&pageSize=20&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&Fcodes=${encodeURIComponent(fundCode)}&_=${Date.now()}`

  const json = await withRetry(() => httpGetJson(url, { timeout: 10000 }), 1)
  if (json?.Success === false) throw new Error(json?.ErrMsg || '行情服务繁忙，请稍后重试')
  const item = json?.Datas?.[0]
  if (!item) throw new Error('未查询到该基金，请检查代码')

  const { millionIncome, sevenDayYield, looksLikeMoneyFund } = parseMoneyFields(item)
  if (!looksLikeMoneyFund) throw new Error('该基金不是货币基金，暂无万份收益')
  if (millionIncome === null) throw new Error('该基金暂无万份收益数据')

  return {
    code: item.FCODE || fundCode,
    name: item.SHORTNAME || fundCode,
    millionIncome,
    sevenDayYield,
    navDate: item.PDATE || '',
    updatedAt: Date.now()
  }
}

// 备用数据源：天天基金历史净值接口，对货币基金 DWJZ=每万份收益、LJJZ=七日年化
// 该域名校验 Referer，原生端可自行携带，开发态走 vite 代理，生产 Web 受 CORS 限制不可用
const F10_PAGE_SIZE = 20
// 主源被风控后短期内直接走备用源，避免每次打开页面都先等一次失败
const MONEY_PRIMARY_COOLDOWN = 10 * 60 * 1000
let moneyPrimaryDownUntil = 0

function primaryCoolingDown() {
  return Date.now() < moneyPrimaryDownUntil
}
function markPrimaryDown() {
  moneyPrimaryDownUntil = Date.now() + MONEY_PRIMARY_COOLDOWN
}

async function fetchMoneyFromF10(fundCode, size = 1) {
  const headers = isNative
    ? {
        Referer: 'https://fundf10.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
      }
    : {}
  // 该接口单页最多返回 20 条，要更长区间需要翻页拼接
  const pages = Math.max(1, Math.ceil(size / F10_PAGE_SIZE))
  const collected = []

  for (let pageIndex = 1; pageIndex <= pages; pageIndex++) {
    const path =
      `/f10/lsjz?fundCode=${encodeURIComponent(fundCode)}` +
      `&pageIndex=${pageIndex}&pageSize=${F10_PAGE_SIZE}&_=${Date.now()}`
    const url = isNative ? `https://api.fund.eastmoney.com${path}` : `/fund-api${path}`
    const json = await httpGetJson(url, { timeout: 10000, headers })
    const datas = json?.Data?.LSJZList || []
    if (!datas.length) break
    collected.push(...datas)
    if (datas.length < F10_PAGE_SIZE) break
  }

  if (!collected.length) throw new Error('未查询到该货币基金')

  // 接口按日期倒序返回，拼接后仍是倒序
  return collected
    .map(d => ({
      date: d.FSRQ,
      millionIncome: toNum(d.DWJZ),
      sevenDayYield: toNum(d.LJJZ)
    }))
    .filter(d => d.date && d.millionIncome !== null)
}

async function fetchMoneyQuoteFromF10(fundCode) {
  const list = await fetchMoneyFromF10(fundCode, 1)
  const latest = list[0]
  if (!latest) throw new Error('该基金暂无万份收益数据')
  return {
    code: fundCode,
    // 备用源不返回基金简称，用代码占位
    name: `货币基金 ${fundCode}`,
    millionIncome: latest.millionIncome,
    sevenDayYield: latest.sevenDayYield,
    navDate: latest.date,
    updatedAt: Date.now()
  }
}

export async function fetchMoneyFundQuote(code, { force = false } = {}) {
  const fundCode = normalizeFundCode(code)
  if (!isValidFundCode(fundCode)) throw new Error('基金代码需为 6 位数字')

  const key = MONEY_CACHE_PREFIX + fundCode
  if (!force) {
    const cached = readCache(key, MONEY_CACHE_TTL)
    if (cached) return { ...cached, cached: true }
  }

  const canFallback = isNative || isDev
  const primaryEntry = { run: () => fetchMoneyQuoteFromEastmoney(fundCode), primary: true }
  const fallbackEntry = { run: () => fetchMoneyQuoteFromF10(fundCode), primary: false }
  // 主源刚被风控时优先走备用源，避免每次开页面都先等一次失败
  const chain = []
  if (canFallback && primaryCoolingDown()) chain.push(fallbackEntry, primaryEntry)
  else {
    chain.push(primaryEntry)
    if (canFallback) chain.push(fallbackEntry)
  }

  let quote = null
  let lastError = null
  for (const entry of chain) {
    try {
      quote = await entry.run()
      if (entry.primary) moneyPrimaryDownUntil = 0
      break
    } catch (e) {
      lastError = e
      // 代码填错或不是货币基金属于业务判断，换源也没意义，也不该记为风控
      const isBusinessError = /不是货币基金|未查询到/.test(e.message || '')
      if (!isBusinessError && entry.primary) markPrimaryDown()
      console.warn(`[行情] 货币基金${entry.primary ? '主' : '备用'}数据源失败:`, e.message)
      if (isBusinessError) break
    }
  }

  if (!quote) {
    // 接口不可用时沿用上一次的收益率，避免收益显示成 0
    const stale = readStaleCache(key)
    if (stale) return { ...stale, stale: true, error: lastError?.message || '' }
    throw lastError || new Error('货币基金收益获取失败')
  }

  writeCache(key, quote)
  return quote
}

async function fetchMoneyHistoryFromEastmoney(fundCode, size) {
  const url =
    'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList' +
    `?pageIndex=1&pageSize=${size}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=1&FCODE=${encodeURIComponent(fundCode)}&_=${Date.now()}`

  const json = await withRetry(() => httpGetJson(url, { timeout: 10000 }), 1)
  if (json?.Success === false) throw new Error(json?.ErrMsg || '历史收益获取失败')
  const datas = json?.Datas || []
  if (!datas.length) throw new Error('该基金暂无历史收益数据')

  // 接口按日期倒序返回，这里转成正序方便逐日累加
  return datas
    .map(d => ({
      date: d.FSRQ,
      millionIncome: toNum(d.DWJZ),
      sevenDayYield: toNum(d.LJJZ)
    }))
    .filter(d => d.date && d.millionIncome !== null)
    .reverse()
}

// 逐日万份收益，用于按真实行情精算区间收益
export async function fetchMoneyFundHistory(code, { days = 40, force = false } = {}) {
  const fundCode = normalizeFundCode(code)
  if (!isValidFundCode(fundCode)) throw new Error('基金代码需为 6 位数字')

  const key = MONEY_HISTORY_PREFIX + fundCode + '_' + days
  if (!force) {
    const cached = readCache(key, MONEY_HISTORY_TTL)
    if (cached) return cached
  }

  const size = Math.min(days, 60)
  const canFallback = isNative || isDev
  const primaryEntry = { run: () => fetchMoneyHistoryFromEastmoney(fundCode, size), primary: true }
  const fallbackEntry = {
    run: async () => (await fetchMoneyFromF10(fundCode, size)).reverse(),
    primary: false
  }
  const chain = []
  if (canFallback && primaryCoolingDown()) chain.push(fallbackEntry, primaryEntry)
  else {
    chain.push(primaryEntry)
    if (canFallback) chain.push(fallbackEntry)
  }

  let list = null
  let lastError = null
  for (const entry of chain) {
    try {
      list = await entry.run()
      if (entry.primary) moneyPrimaryDownUntil = 0
      break
    } catch (e) {
      lastError = e
      if (entry.primary) markPrimaryDown()
      console.warn(`[行情] 货币基金历史${entry.primary ? '主' : '备用'}数据源失败:`, e.message)
    }
  }

  if (!list) {
    const stale = readStaleCache(key)
    if (stale) return stale
    throw lastError || new Error('历史收益获取失败')
  }

  writeCache(key, list)
  return list
}

/**
 * 普通基金的逐日单位净值
 * 与货币基金共用同一个历史接口：DWJZ 对货币基金是「每万份收益」，对普通基金就是「单位净值」。
 * 因此直接复用上方的缓存与降级链，只把字段名改回净值语义。
 */
export async function fetchFundNavHistory(code, { days = 45, force = false } = {}) {
  const list = await fetchMoneyFundHistory(code, { days, force })
  return list
    .filter(item => item && item.date && item.millionIncome !== null && item.millionIncome !== undefined)
    .map(item => ({ date: item.date, nav: Number(item.millionIncome) }))
}

export { isValidFundCode }
