<template>
  <div class="search-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>搜索筛选</span>
      <span class="reset-btn" @click="resetFilters">重置</span>
    </div>

    <!-- 筛选条件 -->
    <div class="filter-panel">
      <div class="form-group">
        <label class="form-label">关键词</label>
        <input class="form-input" v-model="filters.keyword" placeholder="备注或商家" />
      </div>

      <div class="section-title">类型</div>
      <div class="chip-row">
        <span
          v-for="opt in typeOptions"
          :key="opt.value"
          class="chip"
          :class="{ 'chip-active': filters.type === opt.value }"
          @click="filters.type = opt.value"
        >{{ opt.label }}</span>
      </div>

      <div class="section-title">账户</div>
      <div class="chip-row">
        <span class="chip" :class="{ 'chip-active': !filters.accountId }" @click="filters.accountId = null">全部</span>
        <span
          v-for="acc in accounts"
          :key="acc.id"
          class="chip"
          :class="{ 'chip-active': filters.accountId === acc.id }"
          @click="filters.accountId = acc.id"
        >{{ acc.icon }} {{ acc.name }}</span>
      </div>

      <div class="section-title">分类</div>
      <div class="chip-row">
        <span class="chip" :class="{ 'chip-active': !filters.categoryId }" @click="filters.categoryId = null">全部</span>
        <span
          v-for="cat in categories"
          :key="cat.id"
          class="chip"
          :class="{ 'chip-active': filters.categoryId === cat.id }"
          @click="filters.categoryId = cat.id"
        >{{ cat.icon }} {{ cat.name }}</span>
      </div>

      <div class="section-title">标签</div>
      <div class="chip-row">
        <span class="chip" :class="{ 'chip-active': !filters.tagId }" @click="filters.tagId = null">全部</span>
        <span
          v-for="tag in tags"
          :key="tag.id"
          class="chip"
          :class="{ 'chip-active': filters.tagId === tag.id }"
          @click="filters.tagId = tag.id"
        >{{ tag.name }}</span>
        <span v-if="tags.length === 0" class="inline-tip">还没有标签</span>
      </div>

      <div class="section-title">报销状态</div>
      <div class="chip-row">
        <span
          v-for="opt in reimburseOptions"
          :key="opt.value"
          class="chip"
          :class="{ 'chip-active': filters.reimburseStatus === opt.value }"
          @click="filters.reimburseStatus = opt.value"
        >{{ opt.label }}</span>
      </div>

      <div class="section-title">日期范围</div>
      <div class="date-row">
        <input class="form-input" type="date" v-model="filters.startDate" />
        <span class="date-sep">至</span>
        <input class="form-input" type="date" v-model="filters.endDate" />
      </div>

      <div class="section-title">金额区间</div>
      <div class="date-row">
        <input
          class="form-input"
          type="text"
          inputmode="decimal"
          :value="filters.minAmount"
          placeholder="最低"
          @input="onAmountInput('minAmount', $event)"
        />
        <span class="date-sep">—</span>
        <input
          class="form-input"
          type="text"
          inputmode="decimal"
          :value="filters.maxAmount"
          placeholder="最高"
          @input="onAmountInput('maxAmount', $event)"
        />
      </div>
    </div>

    <!-- 结果汇总 -->
    <div class="result-bar">
      <span>共 {{ results.length }} 笔</span>
      <span class="result-totals">
        支出 ¥{{ totals.expense.toFixed(2) }} · 收入 ¥{{ totals.income.toFixed(2) }}
      </span>
    </div>

    <!-- 待报销批量处理：一次报销一批，不用逐笔进编辑页 -->
    <div v-if="filters.reimburseStatus === 'pending' && results.length" class="bulk-bar">
      <span>待报销合计 ¥{{ totals.expense.toFixed(2) }}</span>
      <span class="bulk-action" @click="pendingMark = true">全部标记已报销</span>
    </div>

    <!-- 结果列表 -->
    <div v-if="results.length === 0" class="empty-state">
      <div class="emoji">🔍</div>
      <div class="text">没有符合条件的记录</div>
    </div>

    <div
      v-for="item in results"
      :key="item.id"
      class="list-item"
      @click="$router.push(`/edit/${item.id}`)"
    >
      <div class="icon" :style="{ background: iconBg(item) }">{{ iconOf(item) }}</div>
      <div class="info">
        <div class="title">
          {{ titleOf(item) }}
          <span
            v-if="item.type === 'expense' && item.reimburse_status !== 'none'"
            class="reimburse-tag"
            :class="item.reimburse_status"
          >{{ item.reimburse_status === 'pending' ? '待报销' : '已报销' }}</span>
        </div>
        <div class="subtitle">
          {{ formatDate(item.date) }} · {{ subtitleOf(item) }}
          <template v-if="item.merchant"> · {{ item.merchant }}</template>
        </div>
        <div v-if="item.tags && item.tags.length" class="tag-row">
          <span v-for="tag in item.tags" :key="tag.id" class="mini-tag">{{ tag.name }}</span>
        </div>
      </div>
      <div class="amount" :class="item.type">{{ amountOf(item) }}</div>
    </div>

    <!-- 批量标记确认 -->
    <div v-if="pendingMark" class="confirm-dialog" @click.self="pendingMark = false">
      <div class="confirm-box">
        <div class="msg">
          把这 {{ pendingCount }} 笔待报销全部标记为「已报销」吗？<br/>合计 ¥{{ totals.expense.toFixed(2) }}，之后仍可逐笔改回。
        </div>
        <div class="actions">
          <button class="btn btn-outline" @click="pendingMark = false">取消</button>
          <button class="btn btn-primary" @click="doMarkDone">标记已报销</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { getTransactions, getAccounts, getCategories, getTags, markTransactionsReimbursed } from '../db'

const route = useRoute()
const accounts = ref([])
const categories = ref([])
const tags = ref([])
const results = ref([])
const toastMsg = ref('')
const pendingMark = ref(false)
const pendingCount = computed(() => results.value.filter(t => t.reimburse_status === 'pending').length)

const filters = reactive({
  keyword: '',
  type: '',
  accountId: null,
  categoryId: null,
  tagId: null,
  reimburseStatus: '',
  startDate: '',
  endDate: '',
  minAmount: '',
  maxAmount: ''
})

const typeOptions = [
  { value: '', label: '全部' },
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' }
]

const reimburseOptions = [
  { value: '', label: '全部' },
  { value: 'pending', label: '待报销' },
  { value: 'done', label: '已报销' }
]

const totals = computed(() => {
  let expense = 0
  let income = 0
  for (const t of results.value) {
    if (t.type === 'expense') expense += Number(t.amount) || 0
    else if (t.type === 'income') income += Number(t.amount) || 0
  }
  return { expense, income }
})

function onAmountInput(field, event) {
  let cleaned = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot >= 0) cleaned = `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
  if (event.target.value !== cleaned) event.target.value = cleaned
  filters[field] = cleaned
}

function buildQuery() {
  const query = {}
  if (filters.keyword.trim()) query.keyword = filters.keyword.trim()
  if (filters.type) query.type = filters.type
  if (filters.accountId) query.accountId = filters.accountId
  if (filters.categoryId) query.categoryId = filters.categoryId
  if (filters.tagId) query.tagId = filters.tagId
  if (filters.reimburseStatus) query.reimburseStatus = filters.reimburseStatus
  if (filters.startDate) query.startDate = filters.startDate
  if (filters.endDate) query.endDate = filters.endDate
  if (filters.minAmount) query.minAmount = Number(filters.minAmount)
  if (filters.maxAmount) query.maxAmount = Number(filters.maxAmount)
  return query
}

async function runSearch() {
  try {
    results.value = await getTransactions(buildQuery())
  } catch (e) {
    showToast('查询失败: ' + e.message)
  }
}

function resetFilters() {
  filters.keyword = ''
  filters.type = ''
  filters.accountId = null
  filters.categoryId = null
  filters.tagId = null
  filters.reimburseStatus = ''
  filters.startDate = ''
  filters.endDate = ''
  filters.minAmount = ''
  filters.maxAmount = ''
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

// 首页「待报销」条带过来的预设筛选：?reimburse=pending
function applyRoutePreset() {
  const preset = route.query.reimburse
  if (preset === 'pending' || preset === 'done') filters.reimburseStatus = preset
}

async function doMarkDone() {
  const ids = results.value.filter(t => t.reimburse_status === 'pending').map(t => Number(t.id))
  pendingMark.value = false
  if (!ids.length) return
  try {
    await markTransactionsReimbursed(ids)
    await runSearch()
    showToast(`已标记 ${ids.length} 笔为已报销`)
  } catch (e) {
    showToast('标记失败: ' + e.message)
  }
}

// 条件变化即重查，关键字输入做 200ms 防抖
let searchTimer = null
watch(filters, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 200)
}, { deep: true })
onUnmounted(() => clearTimeout(searchTimer))

// ========== 流水展示 ==========
function iconOf(item) {
  if (item.type === 'transfer') return '↔️'
  return item.category_icon || '📌'
}
function iconBg(item) {
  if (item.type === 'transfer') return 'var(--primary-light)'
  return item.type === 'expense' ? 'var(--danger-light)' : 'var(--success-light)'
}
function titleOf(item) {
  if (item.type === 'transfer') return '转账'
  return item.category_name || '未分类'
}
function subtitleOf(item) {
  if (item.type === 'transfer') {
    return `${item.account_name || '未知账户'} → ${item.to_account_name || '未知账户'}`
  }
  return item.account_name || ''
}
function amountOf(item) {
  const value = `¥${(Number(item.amount) || 0).toFixed(2)}`
  if (item.type === 'expense') return `-${value}`
  if (item.type === 'income') return `+${value}`
  return value
}
function formatDate(date) {
  return String(date || '').split(' ')[0]
}

onMounted(async () => {
  try {
    applyRoutePreset()
    const [accs, cats, tgs] = await Promise.all([getAccounts(), getCategories(), getTags()])
    accounts.value = accs
    categories.value = cats
    tags.value = tgs
    await runSearch()
  } catch (e) {
    showToast('加载失败: ' + e.message)
  }
})
</script>

<style scoped>
.search-page {
  min-height: 100%;
  padding-bottom: 24px;
}
/* 顶栏保持吸顶，返回/重置在滚动过程中始终可达 */
.page-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: sticky;
  top: 0;
  z-index: 20;
}
.back-btn, .reset-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  padding: 4px 8px;
}
.back-btn { left: 12px; }
.reset-btn { right: 12px; }

.filter-panel {
  background: var(--card);
  padding-bottom: 8px;
}
.filter-panel .form-group {
  padding: 12px 16px 0;
  margin-bottom: 0;
}
.section-title {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 12px 16px 4px;
  font-weight: 500;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 16px 8px;
}
.chip {
  padding: 6px 12px;
  border-radius: 16px;
  background: var(--bg);
  font-size: 13px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.chip-active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}
.inline-tip {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 6px 0;
}
.date-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px 8px;
}
.date-row .form-input {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  font-size: 14px;
}
.date-sep {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.result-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px;
  background: var(--bg);
  font-size: 13px;
  color: var(--text-secondary);
}
.result-totals {
  font-size: 12px;
}
/* 待报销批量标记条 */
.bulk-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 16px;
  background: var(--warning-light);
  color: #A15C00;
  font-size: 12px;
}
.bulk-action {
  flex-shrink: 0;
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}

.reimburse-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}
.reimburse-tag.pending { background: #FFF4E0; color: #C77C00; }
.reimburse-tag.done { background: var(--success-light); color: var(--success); }
.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.mini-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-secondary);
}
</style>
