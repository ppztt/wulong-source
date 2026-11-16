<template>
  <div class="import-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>导入账单</span>
      <span v-if="stage !== 'pick'" class="reset-btn" @click="reset">重选</span>
    </div>

    <!-- 第一步：选文件 -->
    <template v-if="stage === 'pick'">
      <div class="intro">
        <div class="intro-title">从其他 App 迁移</div>
        <div class="intro-text">
          在原来那个记账 App 里把流水导出成 CSV，选这个文件即可。会先解析预览，确认后才写入。
        </div>
      </div>

      <div class="pick-area">
        <div class="pick-btn" @click="pickFile">选择 CSV 文件</div>
        <div class="wechat-tip">
          文件在微信里时不用先存下来：点开文件 → 右上角「···」→ 用其他应用打开 → 选「乌龙记账」，会直接跳到这一步。
        </div>
        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept=".csv,text/csv,text/plain"
          @change="onFileChange"
        />
      </div>

      <div class="tips">
        <div class="tip">· 导入是追加，不会清空现有数据</div>
        <div class="tip">· 同名账户与分类会复用，不会重复创建</div>
        <div class="tip">· 完全相同的历史流水会自动跳过</div>
        <div class="tip">· 账户期初为 0，导入后需要校准一次真实余额</div>
      </div>
    </template>

    <!-- 第二步：预览确认 -->
    <template v-else-if="stage === 'preview'">
      <div class="card">
        <div class="card-head">
          <span>解析结果</span>
          <span class="src-tag">{{ sourceLabel }}</span>
        </div>
        <div class="stat-row">
          <div class="stat">
            <div class="stat-value">{{ stats.total }}</div>
            <div class="stat-label">总条数</div>
          </div>
          <div class="stat">
            <div class="stat-value success">{{ stats.incomeCount }}</div>
            <div class="stat-label">收入</div>
          </div>
          <div class="stat">
            <div class="stat-value danger">{{ stats.expenseCount }}</div>
            <div class="stat-label">支出</div>
          </div>
          <div class="stat">
            <div class="stat-value">{{ stats.transferCount }}</div>
            <div class="stat-label">转账</div>
          </div>
        </div>
        <div class="range-line">
          {{ stats.startDate || '--' }} 至 {{ stats.endDate || '--' }}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><span>金额汇总</span></div>
        <div class="sum-row"><span>收入合计</span><strong class="success">¥{{ fmt(stats.incomeSum) }}</strong></div>
        <div class="sum-row"><span>支出合计</span><strong class="danger">¥{{ fmt(stats.expenseSum) }}</strong></div>
        <div class="sum-row"><span>转账合计</span><strong>¥{{ fmt(stats.transferSum) }}</strong></div>
      </div>

      <div class="card">
        <div class="card-head">
          <span>账户</span>
          <span class="card-sub">{{ parsed.accounts.length }} 个 · 新建 {{ newAccountCount }} 个</span>
        </div>
        <div class="chip-wrap">
          <span v-for="name in parsed.accounts" :key="name" class="chip" :class="{ fresh: isNewAccount(name) }">
            {{ name }}
          </span>
        </div>
        <div class="card-foot">蓝色为账本里还没有的账户，导入时会自动创建</div>
      </div>

      <div class="card">
        <div class="card-head">
          <span>分类</span>
          <span class="card-sub">{{ parsed.categories.length }} 个 · 新建 {{ newCategoryCount }} 个</span>
        </div>
        <div class="chip-wrap">
          <span
            v-for="item in parsed.categories"
            :key="item.name + item.type"
            class="chip"
            :class="{ fresh: isNewCategory(item), merged: isAliased(item.name, item.type) }"
          >
            {{ item.name }}
            <template v-if="isAliased(item.name, item.type)">
              <span class="chip-arrow">→</span>{{ categoryAlias[item.type][item.name] }}
            </template>
          </span>
        </div>

        <!-- AI 归并：只在有新分类且配了 Key 时出现 -->
        <div v-if="canRunMapping || aiState !== 'idle'" class="merge-block">
          <template v-if="aiState === 'done'">
            <div class="merge-line">
              <span class="merge-ok">{{ aiMessage }}</span>
              <span class="merge-undo" @click="clearMapping">撤销</span>
            </div>
          </template>
          <template v-else-if="aiState === 'loading'">
            <div class="merge-line"><span class="merge-muted">AI 正在比对分类…</span></div>
          </template>
          <template v-else-if="aiState === 'error'">
            <div class="merge-line">
              <span class="merge-bad">{{ aiMessage }}</span>
              <span class="merge-undo" @click="clearMapping">忽略</span>
            </div>
          </template>
          <template v-else>
            <div class="merge-btn" @click="runAiMapping">
              让 AI 归并这 {{ pendingCategories.length }} 个新分类
            </div>
            <div class="merge-hint">
              把「餐饮美食」「伙食」这类叫法并到你已有的分类，避免导入后分类越堆越多
            </div>
          </template>
        </div>
        <div v-if="!hasAiKey && newCategoryCount > 0" class="merge-hint no-key">
          配好 API Key 后可以让 AI 自动归并同义分类
        </div>
      </div>

      <div v-if="dupCount > 0" class="notice">
        有 {{ dupCount }} 条与现有流水完全相同，将被跳过
      </div>

      <div v-if="skippedGroups.length" class="card">
        <div class="card-head">
          <span>无法导入</span>
          <span class="card-sub">{{ skippedTotal }} 条</span>
        </div>
        <div v-for="group in skippedGroups" :key="group.reason" class="sum-row">
          <span class="skip-reason">{{ group.reason }}</span>
          <strong>{{ group.count }} 条</strong>
        </div>
      </div>

      <div class="action-bar">
        <div class="primary-btn" :class="{ disabled: importing || willInsert === 0 }" @click="doImport">
          {{ importing ? importingText : `导入 ${willInsert} 条` }}
        </div>
      </div>
    </template>

    <!-- 第三步：导入结果 -->
    <template v-else>
      <div class="done-card">
        <div class="done-icon">✅</div>
        <div class="done-title">导入完成</div>
        <div class="done-sub">新增 {{ importResult.inserted }} 条流水</div>
      </div>

      <div class="card">
        <div class="sum-row"><span>新建账户</span><strong>{{ importResult.accountsCreated }} 个</strong></div>
        <div class="sum-row"><span>新建分类</span><strong>{{ importResult.categoriesCreated }} 个</strong></div>
        <div class="sum-row"><span>跳过重复</span><strong>{{ importResult.skippedDup }} 条</strong></div>
      </div>

      <div v-if="importResult.accountRows.length" class="card">
        <div class="card-head">
          <span>账户当前余额</span>
          <span class="card-sub">期初为 0，等于流水净额</span>
        </div>
        <div v-for="acc in importResult.accountRows" :key="acc.name" class="sum-row">
          <span class="acc-name">{{ acc.name }}</span>
          <strong :class="{ danger: acc.balance < 0 }">{{ acc.balance < 0 ? '-¥' : '¥' }}{{ fmt(Math.abs(acc.balance)) }}</strong>
        </div>
      </div>

      <div class="notice notice-warn">
        以上是流水净额，不是真实余额。请到「账户」页点账户 → 「调整账户金额」→ 选「直接校准」，填入实际余额即可，不会影响收支统计。
      </div>

      <div class="action-bar">
        <div class="primary-btn" @click="$router.replace('/accounts')">去校准余额</div>
      </div>
      <div class="action-bar">
        <div class="ghost-btn" @click="$router.replace('/')">稍后处理</div>
      </div>
    </template>

    <div v-if="errorMsg" class="error-toast">{{ errorMsg }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import {
  getAccounts, getCategories, getTransactions,
  createAccount, createCategory, createTransactionsBatch
} from '../db'
import { parseImportText, recordKeyOf, decodeBytes } from '../utils/importer'
import {
  buildCategoryMapPrompt, parseCategoryMap, aliasedName, extractJson
} from '../utils/aiAssistant'
import { chatComplete, AI_MODEL } from '../api/ai'
import { guessAccountIcon } from '../utils/icons'
import { pendingImportText } from '../utils/nativeFile'

const fileInput = ref(null)
const stage = ref('pick')
const importing = ref(false)
const importingText = ref('')
const errorMsg = ref('')

const parsed = ref(null)
const stats = ref(null)
const existingAccountNames = ref(new Set())
const existingCategoryKeys = ref(new Set())
const dupCount = ref(0)
const importResult = ref({ inserted: 0, skippedDup: 0, accountsCreated: 0, categoriesCreated: 0, accountRows: [] })

// AI 分类归并：把「餐饮美食」这类外部分类名并到已有的「餐饮」上
// 空对象表示不做归并，导入时按原名新建
const categoryAlias = ref({ expense: {}, income: {}, mapped: 0 })
const existingCategories = ref([])
const aiState = ref('idle') // idle | loading | done | error
const aiMessage = ref('')

const sourceLabel = computed(() => (parsed.value?.source === 'csv' ? 'CSV 流水' : '未知来源'))
const newAccountCount = computed(() =>
  parsed.value ? parsed.value.accounts.filter(name => !existingAccountNames.value.has(name)).length : 0
)

function isAliased(name, type) {
  return !!categoryAlias.value[type]?.[name]
}

// 还没被归并、且账本里确实没有的分类，才是真正要新建的
const pendingCategories = computed(() => {
  if (!parsed.value) return []
  return parsed.value.categories.filter(
    c => !existingCategoryKeys.value.has(c.name + '|' + c.type) && !isAliased(c.name, c.type)
  )
})
const newCategoryCount = computed(() => pendingCategories.value.length)

const willInsert = computed(() => (parsed.value ? parsed.value.records.length - dupCount.value : 0))

const skippedTotal = computed(() => parsed.value?.skipped.length || 0)
// 跳过原因归并，几百条时逐条列出没法看
const skippedGroups = computed(() => {
  const map = new Map()
  for (const item of parsed.value?.skipped || []) {
    map.set(item.reason, (map.get(item.reason) || 0) + 1)
  }
  return [...map.entries()].map(([reason, count]) => ({ reason, count }))
})

function fmt(n) {
  return (Number(n) || 0).toFixed(2)
}

function isNewAccount(name) {
  return !existingAccountNames.value.has(name)
}
function isNewCategory(item) {
  return !existingCategoryKeys.value.has(item.name + '|' + item.type)
}

function showError(message) {
  errorMsg.value = message
  setTimeout(() => { errorMsg.value = '' }, 4000)
}

// ========== AI 分类归并 ==========
// Key 复用「小乌 · AI 助手」里填的那个，不单独再要一份
function readAiSettings() {
  try {
    return JSON.parse(localStorage.getItem('bk_ai_settings') || '{}')
  } catch {
    return {}
  }
}
const aiSettings = ref(readAiSettings())
const hasAiKey = computed(() => !!String(aiSettings.value.apiKey || '').trim())
// 只有确实存在"待新建分类"且没归并过时才需要这个入口
const canRunMapping = computed(() =>
  hasAiKey.value && pendingCategories.value.length > 0 &&
  aiState.value !== 'loading' && aiState.value !== 'done'
)

async function runAiMapping() {
  if (aiState.value === 'loading') return
  const key = String(aiSettings.value.apiKey || '').trim()
  if (!key) {
    aiState.value = 'error'
    aiMessage.value = '还没填 API Key，先去「小乌 · AI 助手」里配一下'
    return
  }

  const incoming = pendingCategories.value
  if (!incoming.length) return

  aiState.value = 'loading'
  aiMessage.value = ''
  try {
    const res = await chatComplete({
      apiKey: key,
      model: AI_MODEL,
      baseUrl: aiSettings.value.baseUrl || undefined,
      jsonMode: true,
      maxTokens: 600,
      messages: [
        {
          role: 'system',
          content: buildCategoryMapPrompt({ existing: existingCategories.value, incoming })
        },
        { role: 'user', content: '给出归并结果' }
      ]
    })
    const map = parseCategoryMap(extractJson(res.content), {
      existing: existingCategories.value,
      incoming
    })
    categoryAlias.value = map
    aiState.value = 'done'
    aiMessage.value = map.mapped > 0
      ? `已归并 ${map.mapped} 个分类，导入时会记到对应分类上`
      : '没有能安全归并的分类，都会保留为新分类'
  } catch (e) {
    aiState.value = 'error'
    aiMessage.value = e.message || '归并失败，可以直接导入'
  }
}

function clearMapping() {
  categoryAlias.value = { expense: {}, income: {}, mapped: 0 }
  aiState.value = 'idle'
  aiMessage.value = ''
}

function pickFile() {
  fileInput.value?.click()
}

function reset() {
  stage.value = 'pick'
  parsed.value = null
  dupCount.value = 0
  if (fileInput.value) fileInput.value.value = ''
}

// 这类导出常见 UTF-16 LE 带 BOM，交给解码器按 BOM 判断
async function readFileText(file) {
  const buffer = await file.arrayBuffer()
  return decodeBytes(new Uint8Array(buffer))
}

async function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  await applyText(await readFileText(file))
}

// 解析并生成预览：文件选择器和「从其他应用打开」两条路都走这里
async function applyText(text) {
  try {
    const result = parseImportText(text)
    if (result.records.length === 0) {
      showError('文件里没有可导入的流水')
      return
    }

    const [accounts, categories, existing] = await Promise.all([
      getAccounts(), getCategories(), getTransactions()
    ])
    existingAccountNames.value = new Set(accounts.map(a => a.name))
    existingCategoryKeys.value = new Set(categories.map(c => c.name + '|' + c.type))
    // 归并要用到完整的本地分类清单（含图标），单独留一份
    existingCategories.value = categories
    // 每次换文件都重置上一次的归并结果，避免映射到不该映射的分类上
    categoryAlias.value = { expense: {}, income: {}, mapped: 0 }
    aiState.value = 'idle'
    aiMessage.value = ''
    aiSettings.value = readAiSettings()

    // 已有流水转成同样的 key，用于跳过重复导入
    const existingKeys = new Set(existing.map(t => recordKeyOf({
      date: t.date,
      type: t.type,
      amount: t.amount,
      accountName: t.account_name || '',
      toAccountName: t.to_account_name || '',
      note: t.note || ''
    })))
    dupCount.value = result.records.filter(r => existingKeys.has(recordKeyOf(r))).length

    parsed.value = result
    stats.value = result.stats
    stage.value = 'preview'
  } catch (e) {
    showError(e.message || '解析失败')
  }
}

// 从微信等外部应用「用乌龙记账打开」进来的文件，直接进预览
onMounted(async () => {
  if (!pendingImportText.value) return
  const text = pendingImportText.value
  pendingImportText.value = ''
  await applyText(text)
})

async function doImport() {
  if (importing.value || !parsed.value || willInsert.value === 0) return
  importing.value = true
  try {
    importingText.value = '准备账户…'
    let accountMap = new Map((await getAccounts()).map(a => [a.name, Number(a.id)]))
    let accountsCreated = 0
    for (const name of parsed.value.accounts) {
      if (accountMap.has(name)) continue
      await createAccount({
        name,
        icon: guessAccountIcon(name),
        type: 'cash',
        // 期初留空，余额完全由流水推导；真实余额由用户校准
        initial_balance: 0
      })
      accountsCreated++
    }
    if (accountsCreated > 0) {
      accountMap = new Map((await getAccounts()).map(a => [a.name, Number(a.id)]))
    }

    importingText.value = '准备分类…'
    let categoryMap = new Map((await getCategories()).map(c => [c.name + '|' + c.type, Number(c.id)]))
    let categoriesCreated = 0
    for (const item of parsed.value.categories) {
      const key = item.name + '|' + item.type
      if (categoryMap.has(key)) continue
      // 已被 AI 归并到某个已有分类，不再新建，否则会多出一堆同义分类
      if (isAliased(item.name, item.type)) continue
      await createCategory({ name: item.name, type: item.type, icon: '📌' })
      categoriesCreated++
    }
    if (categoriesCreated > 0) {
      categoryMap = new Map((await getCategories()).map(c => [c.name + '|' + c.type, Number(c.id)]))
    }

    importingText.value = '写入流水…'
    const existing = await getTransactions()
    const existingKeys = new Set(existing.map(t => recordKeyOf({
      date: t.date,
      type: t.type,
      amount: t.amount,
      accountName: t.account_name || '',
      toAccountName: t.to_account_name || '',
      note: t.note || ''
    })))

    const payload = []
    let skippedDup = 0
    for (const record of parsed.value.records) {
      if (existingKeys.has(recordKeyOf(record))) {
        skippedDup++
        continue
      }
      payload.push({
        type: record.type,
        amount: record.amount,
        category_id: record.categoryName
          ? categoryMap.get(
              aliasedName(categoryAlias.value, record.categoryName, record.categoryType) +
              '|' + record.categoryType
            ) || null
          : null,
        account_id: accountMap.get(record.accountName) || null,
        to_account_id: record.toAccountName ? accountMap.get(record.toAccountName) || null : null,
        merchant: record.merchant,
        note: record.note,
        date: record.date
      })
    }

    const inserted = await createTransactionsBatch(payload)

    importingText.value = '统计余额…'
    const touched = new Set(parsed.value.accounts)
    const accountRows = (await getAccounts())
      .filter(a => touched.has(a.name))
      .map(a => ({ name: a.name, balance: Number(a.balance) || 0 }))
      .sort((a, b) => b.balance - a.balance)

    importResult.value = { inserted, skippedDup, accountsCreated, categoriesCreated, accountRows }
    stage.value = 'done'
  } catch (e) {
    showError('导入失败：' + (e.message || e))
  } finally {
    importing.value = false
    importingText.value = ''
  }
}
</script>

<style scoped>
.import-page {
  padding-bottom: 32px;
}
.reset-btn {
  position: absolute;
  right: 16px;
  font-size: 13px;
  color: var(--primary);
  cursor: pointer;
}

/* 选择文件 */
.intro {
  margin: 12px 16px;
  padding: 16px;
  background: var(--card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.intro-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 6px;
}
.intro-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.pick-area {
  margin: 20px 16px;
}
.pick-btn {
  padding: 14px;
  text-align: center;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-primary);
}
.file-input {
  display: none;
}
.wechat-tip {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--bg);
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.tips {
  margin: 16px;
  padding: 0 4px;
}
.tip {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.9;
}

/* 预览卡片 */
.card {
  margin: 12px 16px;
  padding: 14px;
  background: var(--card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.card-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary);
}
.card-foot {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.src-tag {
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--primary-light);
  color: var(--primary);
}
.stat-row {
  display: flex;
  gap: 8px;
}
.stat {
  flex: 1;
  min-width: 0;
  text-align: center;
  padding: 10px 4px;
  background: var(--bg);
  border-radius: 10px;
}
.stat-value {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.stat-value.success { color: var(--success); }
.stat-value.danger { color: var(--danger); }
.stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.range-line {
  margin-top: 10px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}
.sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  font-size: 13px;
  color: var(--text-secondary);
}
.sum-row strong {
  color: var(--text);
  font-size: 14px;
}
.sum-row strong.success { color: var(--success); }
.sum-row strong.danger { color: var(--danger); }
.skip-reason {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  font-size: 12px;
  padding: 4px 9px;
  border-radius: 8px;
  background: var(--bg);
  color: var(--text-secondary);
}
.chip.fresh {
  background: var(--primary-light);
  color: var(--primary);
}
/* 已被 AI 归并的分类：用绿色区分「不会新建」 */
.chip.merged {
  background: var(--success-light);
  color: var(--success);
}
.chip-arrow {
  margin: 0 2px;
  opacity: 0.7;
}

/* AI 分类归并 */
.merge-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--divider);
}
.merge-btn {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 16px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.merge-btn:active {
  opacity: 0.75;
}
.merge-hint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.merge-hint.no-key {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--divider);
}
.merge-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}
.merge-ok { color: var(--success); }
.merge-bad { color: var(--danger); }
.merge-muted { color: var(--text-secondary); }
.merge-undo {
  flex-shrink: 0;
  color: var(--primary);
  cursor: pointer;
  text-decoration: underline;
}
.notice {
  margin: 12px 16px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--primary-light);
  color: var(--primary);
  font-size: 12px;
  line-height: 1.6;
}
.notice-warn {
  background: var(--warning-light);
  color: #A15C00;
}

/* 结果页 */
.done-card {
  margin: 20px 16px 0;
  padding: 24px 16px;
  text-align: center;
  background: var(--card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.done-icon {
  font-size: 40px;
  margin-bottom: 8px;
}
.done-title {
  font-size: 18px;
  font-weight: 700;
}
.done-sub {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}
.acc-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

/* 底部按钮 */
.action-bar {
  padding: 8px 16px;
}
.primary-btn {
  padding: 13px;
  text-align: center;
  border-radius: var(--radius-md);
  background: var(--primary);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: var(--shadow-primary);
}
.primary-btn.disabled {
  opacity: 0.5;
  box-shadow: none;
  cursor: default;
}
.ghost-btn {
  padding: 13px;
  text-align: center;
  border-radius: var(--radius-md);
  background: var(--card);
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
}
.error-toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  max-width: 80%;
  padding: 9px 16px;
  border-radius: 10px;
  background: rgba(31, 42, 55, 0.92);
  color: #fff;
  font-size: 13px;
  z-index: 200;
}
</style>
