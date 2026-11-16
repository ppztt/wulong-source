<template>
  <div class="home-page">
    <!-- 月份选择 & 月度概览 -->
    <div class="summary-header">
      <span class="search-btn" @click="$router.push('/search')">🔍</span>
      <span class="ai-btn" @click="$router.push('/assistant')">🐢</span>
      <div class="month-selector" @click="showMonthPicker = true">
        <span class="arrow left">‹</span>
        <span class="month-text">{{ displayMonth }}</span>
        <span class="arrow right">›</span>
      </div>
      <div class="summary-cards">
        <div class="summary-item">
          <div class="label">支出</div>
          <div class="value expense">¥{{ totals.expense.toFixed(2) }}</div>
        </div>
        <div class="summary-item">
          <div class="label">收入</div>
          <div class="value income">¥{{ totals.income.toFixed(2) }}</div>
        </div>
        <div class="summary-item">
          <div class="label">结余</div>
          <div class="value" :class="totals.income - totals.expense >= 0 ? 'income' : 'expense'">
            ¥{{ (totals.income - totals.expense).toFixed(2) }}
          </div>
        </div>
      </div>

      <!-- 预算提示：只在同时存在总预算时出现 -->
      <div
        v-if="budgetTip"
        class="budget-tip"
        :class="budgetTipLevel"
        @click="$router.push('/budgets')"
      >
        <span>{{ budgetTipText }}</span>
        <span class="budget-pct">{{ budgetTip.percent.toFixed(0) }}% ›</span>
      </div>

      <!-- 待报销汇总：垫付的钱总要收回来，别沉在流水里 -->
      <div v-if="pendingReimburse.count" class="reimburse-bar" @click="$router.push('/search?reimburse=pending')">
        <span>待报销 {{ pendingReimburse.count }} 笔 · ¥{{ pendingReimburse.total.toFixed(2) }}</span>
        <span class="reimburse-more">去处理 ›</span>
      </div>
    </div>

    <!-- 交易列表 -->
    <div class="transaction-list">
      <div v-if="groupedTransactions.length === 0" class="empty-state">
        <div class="emoji">📝</div>
        <div class="text">暂无记录，点击右下角 + 开始记账</div>
      </div>

      <template v-for="group in groupedTransactions" :key="group.date">
        <div class="date-header">
          <span>{{ group.dateLabel }}</span>
          <span class="day-total">
            <template v-if="group.expense > 0">支出 ¥{{ group.expense.toFixed(2) }}</template>
            <template v-if="group.expense > 0 && group.income > 0"> · </template>
            <template v-if="group.income > 0">收入 ¥{{ group.income.toFixed(2) }}</template>
            <template v-if="group.expense === 0 && group.income === 0">仅转账</template>
          </span>
        </div>
        <SwipeRow
          v-for="item in group.items"
          :key="item.id"
          @copy="copyTransaction(item)"
          @delete="askDelete(item)"
        >
          <div class="list-item" @click="goEdit(item.id)">
            <div class="icon" :style="{ background: iconBg(item) }">
              {{ iconOf(item) }}
            </div>
            <div class="info">
              <div class="title">
                {{ titleOf(item) }}
                <span
                  v-if="item.type === 'expense' && item.reimburse_status !== 'none'"
                  class="reimburse-tag"
                  :class="item.reimburse_status"
                >{{ item.reimburse_status === 'pending' ? '待报销' : '已报销' }}</span>
                <span v-if="item.auto_source" class="auto-tag">自动</span>
              </div>
              <div class="subtitle">
                {{ subtitleOf(item) }}
                <template v-if="item.note"> · {{ item.note }}</template>
              </div>
              <div v-if="item.tags && item.tags.length" class="tag-row">
                <span v-for="tag in item.tags" :key="tag.id" class="mini-tag">{{ tag.name }}</span>
              </div>
            </div>
            <div class="amount" :class="item.type">
              {{ amountOf(item) }}
            </div>
          </div>
        </SwipeRow>
      </template>
    </div>

    <!-- FAB -->
    <button class="fab" @click="$router.push('/add')">+</button>

    <!-- 月份选择弹窗 -->
    <div v-if="showMonthPicker" class="modal-overlay" @click.self="showMonthPicker = false">
      <div class="modal-content" style="max-height: 50vh;">
        <div class="modal-title">选择月份</div>
        <div class="month-grid">
          <div
            v-for="m in monthOptions"
            :key="m"
            class="month-option"
            :class="{ selected: m === currentMonth }"
            @click="selectMonth(m)"
          >{{ formatMonthLabel(m) }}</div>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="pendingDelete" class="confirm-dialog" @click.self="pendingDelete = null">
      <div class="confirm-box">
        <div class="msg">
          删除这笔「{{ pendingDelete.category_name || (pendingDelete.type === 'transfer' ? '转账' : '未分类') }} ¥{{ (Number(pendingDelete.amount) || 0).toFixed(2) }}」吗？
        </div>
        <div class="actions">
          <button class="btn btn-outline" @click="pendingDelete = null">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  getTransactions, getMonthlyTotals, runRecurringRules, getBudgets,
  deleteTransaction, RECURRING_DIRTY_KEY
} from '../db'
import { budgetProgress } from '../utils/finance'
import { syncDailyEarnings } from '../utils/dailyEarnings'
import SwipeRow from '../components/SwipeRow.vue'

const router = useRouter()
const transactions = ref([])
const totals = ref({ expense: 0, income: 0 })
const currentMonth = ref(getCurrentMonth())
const showMonthPicker = ref(false)
const toastMsg = ref('')
const budgetTip = ref(null)
const pendingDelete = ref(null)
// 待报销汇总：跨月统计，和当前看的是哪个月无关
const pendingReimburse = ref({ count: 0, total: 0 })

// 预算用掉八成开始提醒、超支变红：只给同一个提示条换配色，不额外占纵向空间
const budgetTipLevel = computed(() => {
  const p = budgetTip.value?.percent
  if (p === undefined || p === null) return ''
  if (p > 100) return 'over'
  if (p >= 80) return 'warn'
  return ''
})

const budgetTipText = computed(() => {
  const tip = budgetTip.value
  if (!tip) return ''
  const remain = Math.abs(tip.remaining).toFixed(2)
  if (tip.percent > 100) return `本期预算已超支 ¥${remain}`
  if (tip.percent >= 80) return `本期预算快用完了，还剩 ¥${remain}`
  return `本期预算剩余 ¥${remain}`
})

function getCurrentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const displayMonth = computed(() => formatMonthLabel(currentMonth.value))

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-')
  return `${y}年${parseInt(m)}月`
}

// 生成近12个月选项
const monthOptions = computed(() => {
  const opts = []
  const d = new Date()
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    opts.push(`${y}-${m}`)
    d.setMonth(d.getMonth() - 1)
  }
  return opts
})

function selectMonth(m) {
  currentMonth.value = m
  showMonthPicker.value = false
}

// 按月日分组
const groupedTransactions = computed(() => {
  const groups = {}
  for (const t of transactions.value) {
    const date = t.date?.split(' ')[0] || t.date
    if (!groups[date]) {
      groups[date] = { date, dateLabel: formatDateLabel(date), items: [], expense: 0, income: 0 }
    }
    groups[date].items.push(t)
    // 转账只是账户间挪钱，不计入当日收支小计
    if (t.type === 'expense') groups[date].expense += Number(t.amount) || 0
    else if (t.type === 'income') groups[date].income += Number(t.amount) || 0
  }
  return Object.values(groups).sort((a, b) => b.date.localeCompare(a.date))
})

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

function formatDateLabel(dateStr) {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (dateStr === today) return '今天'
  if (dateStr === yesterday) return '昨天'
  const [, m, d] = dateStr.split('-')
  return `${parseInt(m)}月${parseInt(d)}日`
}

// 周期记账：进入应用扫一次即可，但规则刚被新建/修改时要立刻再扫一次，
// 否则在对话或周期页建完规则回首页看不到账单，要等重启
let recurringChecked = false

async function loadData() {
  try {
    const dirty = localStorage.getItem(RECURRING_DIRTY_KEY) === '1'
    if (!recurringChecked || dirty) {
      recurringChecked = true
      const created = await runRecurringRules()
      // 成功跑完才清标记：中途异常时保留，下次进入还能补
      if (dirty) localStorage.removeItem(RECURRING_DIRTY_KEY)
      if (created > 0) showToast(`已自动生成 ${created} 笔周期账单`)
    }
    const [trans, tot] = await Promise.all([
      getTransactions({ yearMonth: currentMonth.value }),
      getMonthlyTotals(currentMonth.value)
    ])
    transactions.value = trans
    totals.value = tot
  } catch (e) {
    showToast('加载失败: ' + e.message)
  }
}

function goEdit(id) {
  router.push(`/edit/${id}`)
}

// 右滑复制：带上原记录跳到记一笔，日期换成今天，金额留给用户改
function copyTransaction(item) {
  router.push({
    path: '/add',
    state: {
      copy: {
        type: item.type,
        amount: Number(item.amount) || 0,
        category_id: item.category_id ?? null,
        account_id: item.account_id ?? null,
        to_account_id: item.to_account_id ?? null,
        merchant: item.merchant || '',
        note: item.note || '',
        reimburse_status: item.reimburse_status || 'none',
        tag_ids: (item.tags || []).map(t => Number(t.id))
      }
    }
  })
}

function askDelete(item) {
  pendingDelete.value = item
}

async function doDelete() {
  const target = pendingDelete.value
  if (!target) return
  pendingDelete.value = null
  try {
    await deleteTransaction(target.id)
    await Promise.all([loadData(), loadBudgetTip(), loadReimburseTip()])
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

// 总预算进度提示，与月份选择无关，始终看当前周期
async function loadBudgetTip() {
  try {
    const budgets = await getBudgets()
    const total = budgets.find(b => b.scope === 'total' && b.enabled)
    if (!total) {
      budgetTip.value = null
      return
    }
    // 不做日期预筛：预算可能在本周期中途创建，本周期更早的支出同样要计入
    // 自动生成的盈亏账单不算消费，排除在外
    const trans = (await getTransactions({ type: 'expense' })).filter(t => !t.auto_source)
    const progress = budgetProgress(total, trans)
    budgetTip.value = { remaining: progress.remaining, percent: progress.percent }
  } catch (e) {
    budgetTip.value = null
  }
}

// 待报销：跨月汇总，点进去直接在搜索页筛出待报销那批
async function loadReimburseTip() {
  try {
    const list = await getTransactions({ type: 'expense', reimburseStatus: 'pending' })
    pendingReimburse.value = {
      count: list.length,
      total: list.reduce((sum, t) => sum + (Number(t.amount) || 0), 0)
    }
  } catch (e) {
    pendingReimburse.value = { count: 0, total: 0 }
  }
}

// 每日收益同步：要联网且可能慢，放到后台跑，有新增再回头刷新列表
let syncingEarnings = false

async function syncEarnings() {
  if (syncingEarnings) return
  syncingEarnings = true
  try {
    const res = await syncDailyEarnings()
    if (res.created > 0) {
      await loadData()
      await loadBudgetTip()
      showToast(`已自动记录 ${res.created} 笔收益`)
    }
    if (res.errors?.length) {
      console.warn('[收益] 部分账户同步失败:', res.errors.join('；'))
    }
  } catch (e) {
    // 联网失败不影响记账主流程，静默降级
    console.warn('[收益] 同步失败:', e.message)
  } finally {
    syncingEarnings = false
  }
}

onMounted(async () => {
  await loadData()
  await Promise.all([loadBudgetTip(), loadReimburseTip()])
  syncEarnings()
})
watch(currentMonth, loadData)

// 页面重新激活时刷新
const stopAfterEach = router.afterEach((to) => {
  if (to.path === '/') {
    loadData()
    loadBudgetTip()
    loadReimburseTip()
    // 跨天回到首页时补一次收益；内部按日期判重，同日直接跳过
    syncEarnings()
  }
})
onUnmounted(() => stopAfterEach())
</script>

<style scoped>
.summary-header {
  background: linear-gradient(140deg, #4A7CF7 0%, #6B9BFF 55%, #7FB0FF 100%);
  padding: 18px 16px 24px;
  color: #fff;
  position: relative;
  border-radius: 0 0 24px 24px;
  box-shadow: 0 8px 22px rgba(74, 124, 247, 0.22);
}
.search-btn {
  position: absolute;
  right: 14px;
  top: 12px;
  font-size: 16px;
  padding: 4px 6px;
  cursor: pointer;
  opacity: 0.9;
}
/* AI 助手入口，贴在搜索按钮左侧，不额外占纵向空间 */
.ai-btn {
  position: absolute;
  right: 46px;
  top: 12px;
  font-size: 16px;
  padding: 4px 6px;
  cursor: pointer;
  opacity: 0.9;
}
.month-selector {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-bottom: 16px;
  cursor: pointer;
}
.month-text {
  font-size: 17px;
  font-weight: 600;
}
.arrow {
  font-size: 24px;
  opacity: 0.7;
  line-height: 1;
}
.summary-cards {
  display: flex;
  gap: 8px;
}
.summary-item {
  flex: 1;
  /* 不设 min-width:0 时卡片会被内容撑破容器 */
  min-width: 0;
  text-align: center;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  padding: 11px 6px;
}
.summary-item .label {
  font-size: 12px;
  opacity: 0.85;
  margin-bottom: 5px;
}
.summary-item .value {
  /* 窄屏自动缩字号，超大金额再截断兜底 */
  font-size: clamp(14px, 4vw, 17px);
  font-weight: 700;
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.summary-item .value.expense { color: #FFB3B3; }
.summary-item .value.income { color: #B3FFD1; }

/* 预算提示条 */
.budget-tip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 12px;
  cursor: pointer;
}
.budget-pct {
  flex-shrink: 0;
  font-weight: 600;
  opacity: 0.9;
}
/* 用掉八成：换成琥珀色，提醒但还不至于报警 */
.budget-tip.warn {
  background: rgba(255, 196, 61, 0.26);
  border: 1px solid rgba(255, 214, 102, 0.5);
}
/* 已超支：换成红色，和超支金额形成一致的警示语义 */
.budget-tip.over {
  background: rgba(255, 92, 92, 0.3);
  border: 1px solid rgba(255, 148, 148, 0.55);
}
/* 待报销汇总条：与预算提示同一条视觉语言 */
.reimburse-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding: 9px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.16);
  font-size: 12px;
  cursor: pointer;
}
.reimburse-more {
  flex-shrink: 0;
  font-weight: 600;
  opacity: 0.9;
}

.date-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 5;
}
.day-total {
  font-size: 12px;
}

/* 报销状态与标签 */
.reimburse-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
}
.reimburse-tag.pending {
  background: #FFF4E0;
  color: #C77C00;
}
.reimburse-tag.done {
  background: var(--success-light);
  color: var(--success);
}
/* 系统自动生成的收益账单 */
.auto-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  margin-left: 6px;
  vertical-align: middle;
  background: var(--primary-light);
  color: var(--primary);
}
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

.month-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.month-option {
  text-align: center;
  padding: 12px 8px;
  border-radius: 10px;
  background: var(--bg);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}
.month-option.selected {
  background: var(--primary);
  color: #fff;
}
</style>
