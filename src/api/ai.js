import { Capacitor } from '@capacitor/core'

/**
 * AI 助手网络层：对接 DeepSeek 开放平台（OpenAI 兼容协议）
 * - 原生 App：走 CapacitorHttp，不受 WebView 跨域限制
 * - 开发环境浏览器：官方地址经 vite 代理转发，避开 CORS
 * 这里只负责「发请求 + 取文本」，业务语义全部放在 utils/aiAssistant.js
 */

const isNative = Capacitor.isNativePlatform()
const isDev = import.meta.env.DEV

const OFFICIAL_BASE = 'https://api.deepseek.com'

// 当前在售模型：deepseek-flash（V4.1-Flash，支持图像理解）与 deepseek-v4-pro（V4-Pro）。
// 旧的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用，不能再写。
// 记账解析、配置生成都是结构化短任务，用 flash 足够，pro 的价格是它的 4~5 倍。
export const AI_MODEL = 'deepseek-flash'
export const AI_MODEL_LABEL = 'DeepSeek V4.1 Flash'
export const DEFAULT_MODEL = AI_MODEL

// 思考模式控制
// 官方默认「开启思考 + effort=high」，即每次回答前先输出一大段思维链。
// 思维链按输出价计费（空闲 4 元、高峰 8 元/百万），对记账这种短任务纯属浪费，
// 所以默认关掉；只有需要推理的分析类问题才开，且用最低档。
export const THINKING = {
  OFF: 'off',
  LOW: 'low',
  HIGH: 'high'
}
export const DEFAULT_BASE_URL = OFFICIAL_BASE

function resolveUrl(baseUrl) {
  const base = String(baseUrl || OFFICIAL_BASE).trim().replace(/\/+$/, '')
  // 只有官方地址在开发态才走代理；用户自填的中转地址原样直连
  if (!isNative && isDev && base === OFFICIAL_BASE) return '/ds-api/chat/completions'
  return `${base}/chat/completions`
}

// 把 HTTP 状态映射成用户能看懂的中文原因
function mapError(status, payload) {
  let detail = ''
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload
    detail = obj?.error?.message || ''
  } catch {
    // 响应不是 JSON（比如网关返回的 HTML 错误页），忽略
  }

  if (status === 401) return new Error('API Key 无效，请检查是否填错或被删除')
  if (status === 402) return new Error('DeepSeek 账户余额不足，请前往开放平台充值')
  if (status === 429) return new Error('请求太频繁，等几秒再试')
  if (status === 400) return new Error(detail || '请求参数有误，请检查模型名称与接口地址')
  if (status === 404) return new Error('接口地址不存在，请检查自定义地址是否填错')
  if (status >= 500) return new Error('DeepSeek 服务暂时不可用，请稍后重试')
  return new Error(detail || `请求失败（HTTP ${status}）`)
}

async function postJson(url, body, apiKey, timeout) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  }

  if (isNative) {
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.post({
      url,
      headers,
      data: body,
      connectTimeout: 15000,
      readTimeout: timeout
    })
    if (res.status < 200 || res.status >= 300) throw mapError(res.status, res.data)
    return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) throw mapError(res.status, text)
    try {
      return JSON.parse(text)
    } catch {
      throw new Error('返回内容不是合法 JSON，请检查接口地址')
    }
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试')
    // 浏览器直连被跨域拦截时，fetch 只会抛 TypeError，看不出真实原因
    if (e instanceof TypeError && !isNative) {
      throw new Error('网络请求被拦截，请确认接口地址支持跨域')
    }
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 发起一次对话补全
 * @param {Array} messages  [{ role: 'system'|'user'|'assistant', content: string }]
 * @param {boolean} jsonMode 要求模型严格返回 JSON 对象
 * @param {string} thinking 思考模式：THINKING.OFF（默认，不开思维链）/ LOW / HIGH
 */
export async function chatComplete({
  messages,
  apiKey,
  model = DEFAULT_MODEL,
  baseUrl = DEFAULT_BASE_URL,
  jsonMode = false,
  thinking = THINKING.OFF,
  temperature = 0.3,
  maxTokens = 900,
  timeout = 90000
}) {
  if (!apiKey) throw new Error('还没有填写 API Key，请先在设置里填写')

  const reasoning = !!thinking && thinking !== THINKING.OFF
  const body = {
    model,
    messages,
    stream: false,
    max_tokens: maxTokens,
    // 必须显式声明：服务端默认开启思考模式，不写就等于每次都在按输出价烧思维链
    thinking: { type: reasoning ? 'enabled' : 'disabled' }
  }
  if (reasoning) {
    body.reasoning_effort = thinking
  } else {
    // 思考模式下 temperature 不生效（传了不报错但被忽略），只有关闭时才值得带上
    body.temperature = temperature
  }
  // json_object 模式要求提示词里出现 json 字样，system prompt 已包含
  if (jsonMode) body.response_format = { type: 'json_object' }

  const data = await postJson(resolveUrl(baseUrl), body, apiKey, timeout)
  const message = data?.choices?.[0]?.message
  const content = message?.content
  if (!content) {
    // 开了思考但 content 为空，通常是 max_tokens 被思维链吃光了
    if (reasoning && message?.reasoning_content) {
      throw new Error('模型只输出了思考过程没给出结论，可以把思考强度调低或提高输出上限')
    }
    throw new Error('模型没有返回内容，可能触发了限流')
  }

  return {
    content,
    usage: data?.usage || null,
    model: data?.model || model
  }
}

// 设置页「测试连接」用：一次极短的往返，验证 Key 与网络是否可用
export async function testConnection({ apiKey, model, baseUrl }) {
  const { content } = await chatComplete({
    apiKey,
    model,
    baseUrl,
    temperature: 0,
    maxTokens: 20,
    timeout: 25000,
    messages: [{ role: 'user', content: '只回复两个字：收到' }]
  })
  return content.trim()
}

// 根据用量粗略估算这次对话花了多少钱（单位：元）
// 按 deepseek-flash 的高峰时段价（空闲时段一律半价，这里取高值以免低估）：
//   输入缓存命中 0.04、输入未命中 2、输出 8，单位均为元/百万 token
export function estimateCost(usage) {
  if (!usage) return 0
  const hit = Number(usage.prompt_cache_hit_tokens) || 0
  const promptTotal = Number(usage.prompt_tokens) || 0
  const miss = Number(usage.prompt_cache_miss_tokens) || Math.max(0, promptTotal - hit)
  const output = Number(usage.completion_tokens) || 0
  return (hit * 0.04 + miss * 2 + output * 8) / 1e6
}
