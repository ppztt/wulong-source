<template>
  <div class="budgets-page">
    <div class="page-header">预算</div>

    <div v-if="loading" class="empty-state">
      <div class="text">加载中…</div>
    </div>

    <template v-else>
      <!-- 历史数据里可能残留重复预算（总预算多条，或同一分类两条），只显示第一条 -->
      <div v-if="duplicateBudgets.length" class="dup-warn">
        <span class="dup-text">
          检测到 {{ duplicateBudgets.length }} 条重复预算，页面每个范围只显示其中一条
        </span>
        <span class="dup-action" @click="cleanupDuplicates">
          清理多余的（保留当前显示的那些）
        </span>
      </div>

      <!-- 总预算：点卡片即可修改 -->
      <div
        v-if="totalBudget"
        class="overview-card clickable"
        :class="statusOf(totalProgress.percent)"
        @click="openEdit(totalBudgetItem.budget)"
      >
        <div class="overview-top">
          <div>
            <div class="overview-label">
              {{ periodLabel(totalBudget.period) }}总预算
              <span v-if="totalBudget.carry_over" class="carry-tag">结转</span>
            </div>
            <div class="overview-amount">¥{{ fmt(totalProgress.used) }}</div>
            <div class="overview-sub">
              可用 ¥{{ fmt(totalProgress.available) }}
              <template v-if="totalProgress.carry !== 0">
                （含结转 {{ totalProgress.carry >= 0 ? '+' : '-' }}¥{{ fmt(Math.abs(totalProgress.carry)) }}）
              </template>
            </div>
          </div>
          <div class="overview-ring">
            <svg viewBox="0 0 40 40" width="72" height="72">
              <circle cx="20" cy="20" r="15.9155" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="4" />
              <circle
                cx="20" cy="20" r="15.9155" fill="none" stroke="#fff" stroke-width="4"
                :stroke-dasharray="`${Math.min(totalProgress.percent, 100)} ${100 - Math.min(totalProgress.percent, 100)}`"
                :stroke-dashoffset="0" transform="rotate(-90 20 20)"
              />
            </svg>
            <span class="ring-text">{{ totalProgress.percent.toFixed(0) }}%</span>
          </div>
        </div>
        <div class="overview-foot">
          <span>{{ progressRangeText(totalProgress) }}</span>
          <span :class="['remain', statusOf(totalProgress.percent)]">
            {{ totalProgress.remaining >= 0
              ? `剩余 ¥${fmt(totalProgress.remaining)}`
              : `超支 ¥${fmt(-totalProgress.remaining)}` }}
          </span>
        </div>
      </div>

      <div v-else class="intro-card">
        <div class="intro-emoji">🎯</div>
        <div class="intro-title">还没有预算</div>
        <div class="intro-text">
          设定一个目标金额，记录消费时会自动计算进度，超支或临近上限会变色提醒
        </div>
      </div>

      <!-- 分类预算 -->
      <div v-if="categoryBudgets.length" class="section-header">
        <span>分类预算</span>
        <span class="section-count">{{ categoryBudgets.length }} 项</span>
      </div>

      <div
        v-for="item in categoryBudgets"
        :key="item.budget.id"
        class="budget-card"
        @click="openEdit(item.budget)"
      >
        <div class="card-head">
          <span class="card-icon">{{ item.budget.category_icon || '📌' }}</span>
          <div class="card-info">
            <div class="card-title">
              {{ budgetTitle(item.budget) }}
              <span v-if="item.budget.carry_over" class="carry-tag light">结转</span>
            </div>
            <div class="card-sub">{{ budgetSub(item.budget) }}</div>
          </div>
          <div class="card-amount">
            <div class="spent">¥{{ fmt(item.progress.used) }}</div>
            <div class="budget">/ ¥{{ fmt(item.progress.available) }}</div>
          </div>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :class="statusOf(item.progress.percent)"
            :style="{ width: Math.min(item.progress.percent, 100) + '%' }"
          ></div>
        </div>
        <div class="card-foot">
          <span class="percent" :class="statusOf(item.progress.percent)">
            {{ item.progress.percent.toFixed(0) }}%
          </span>
          <span :class="['remain', statusOf(item.progress.percent)]">
            {{ item.progress.remaining >= 0
              ? `剩余 ¥${fmt(item.progress.remaining)}`
              : `超支 ¥${fmt(-item.progress.remaining)}` }}
          </span>
        </div>
      </div>

      <div v-if="categoryBudgets.length === 0 && totalBudget" class="empty-tip">
        还没有分类预算，可以给餐饮、交通这类大头单独设一个额度
      </div>
    </template>

    <button class="fab" @click="openAdd">+</button>

    <!-- 新增/编辑弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-title">{{ editingId ? '编辑预算' : '新建预算' }}</div>

        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">预算范围</label>
            <div class="segmented">
              <div class="seg" :class="{ active: form.scope === 'total' }" @click="form.scope = 'total'">总预算</div>
              <div class="seg" :class="{ active: form.scope === 'category' }" @click="form.scope = 'category'">分类预算</div>
            </div>
          </div>

          <div v-if="form.scope === 'category'" class="form-group">
            <label class="form-label">
              分类（可多选）
              <span v-if="form.category_ids.length" class="picked-count">已选 {{ form.category_ids.length }} 个</span>
            </label>
            <div class="chip-row">
              <span
                v-for="cat in expenseCategories"
                :key="cat.id"
                class="chip"
                :class="{ 'chip-active': form.category_ids.includes(cat.id) }"
                @click="toggleCategory(cat.id)"
              >{{ cat.icon }} {{ cat.name }}</span>
            </div>
            <div class="field-hint">多个分类共用一个额度，花在这几个分类上的钱一起算进度</div>
          </div>

          <div class="form-group">
            <label class="form-label">预算金额</label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="form.amount"
              placeholder="0.00"
              @input="onAmountInput"
            />
          </div>

          <div class="form-group">
            <label class="form-label">周期</label>
            <div class="segmented">
              <div class="seg" :class="{ active: form.period === 'weekly' }" @click="form.period = 'weekly'">每周</div>
              <div class="seg" :class="{ active: form.period === 'monthly' }" @click="form.period = 'monthly'">每月</div>
              <div class="seg" :class="{ active: form.period === 'yearly' }" @click="form.period = 'yearly'">每年</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">名称（选填）</label>
            <input class="form-input" v-model="form.name" placeholder="留空自动使用分类名" />
          </div>

          <div class="form-group">
            <div class="switch-row" @click="form.carry_over = form.carry_over ? 0 : 1">
              <div class="switch-info">
                <div class="switch-title">结余结转</div>
                <div class="switch-desc">本周期没花完的额度自动叠加到下个周期</div>
              </div>
              <div class="switch" :class="{ on: form.carry_over }"><span></span></div>
            </div>
          </div>
        </div>

        <div class="modal-actions">
          <button v-if="editingId" class="btn btn-danger" @click="askDelete">删除</button>
          <button class="btn btn-primary" @click="save">保存</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="pendingDelete" class="confirm-dialog" @click.self="pendingDelete = null">
      <div class="confirm-box">
        <div class="msg">删除这个预算吗？<br/>历史账单不会受影响</div>
        <div class="actions">
          <button class="btn btn-outline" @click="pendingDelete = null">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { getBudgets, saveBudget, deleteBudget, getTransactions, getCategories } from '../db'
import { budgetProgress, budgetStatus, todayStr, fmtMoney } from '../utils/finance'

const budgets = ref([])
const transactions = ref([])
const categories = ref([])
const loading = ref(true)
const showModal = ref(false)
const editingId = ref(null)
const pendingDelete = ref(null)
const toastMsg = ref('')

const form = reactive({
  scope: 'total',
  category_ids: [],
  amount: '',
  period: 'monthly',
  name: '',
  carry_over: 0,
  start_date: todayStr()
})

const expenseCategories = computed(() => categories.value.filter(c => c.type === 'expense'))

// 每项预算连同进度一起算好，模板直接用
const computedBudgets = computed(() =>
  budgets.value.map(budget => ({
    budget,
    progress: budgetProgress(budget, transactions.value)
  }))
)

const totalBudgetItem = computed(() => computedBudgets.value.find(i => i.budget.scope === 'total'))
const totalBudget = computed(() => totalBudgetItem.value?.budget || null)
const totalProgress = computed(() => totalBudgetItem.value?.progress || {
  used: 0, available: 0, remaining: 0, percent: 0, carry: 0, range: { start: '', end: '' }
})
const categoryBudgets = computed(() => computedBudgets.value.filter(i => i.budget.scope === 'category'))
// 总预算理论上只有一条。早期版本里可以重复新建，导致页面只显示第一条、
// 用户改的却是其余那条，看起来就是「改了不生效」，这里把多余的识别出来
const totalBudgets = computed(() => budgets.value.filter(b => b.scope === 'total'))
const extraTotals = computed(() => totalBudgets.value.slice(1))

// 同一组分类只生效第一条预算，剩下的识别出来一起清理。
// 不清理的话两张卡各算各的进度，看起来像「同一批分类花了两份钱」
const duplicateBudgets = computed(() => {
  const extras = [...extraTotals.value]
  const seen = new Set()
  for (const b of budgets.value) {
    if (b.scope !== 'category') continue
    const key = [...(b.category_ids || [])].map(Number).sort((x, y) => x - y).join(',')
    if (!key) continue
    if (seen.has(key)) extras.push(b)
    else seen.add(key)
  }
  return extras
})

// 保留页面正在显示的那条（排序靠前），删掉看不见的那些
async function cleanupDuplicates() {
  const extras = [...duplicateBudgets.value]
  for (const b of extras) {
    await deleteBudget(b.id)
  }
  await loadData()
  showToast(`已清理 ${extras.length} 条重复预算`)
}

function fmt(n) { return fmtMoney(n) }

function periodLabel(period) {
  if (period === 'weekly') return '每周'
  if (period === 'yearly') return '每年'
  return '每月'
}
function statusOf(percent) { return budgetStatus(percent) }
function progressRangeText(progress) {
  if (!progress.range?.start) return ''
  return `${progress.range.start} ~ ${progress.range.end}`
}
// 卡片标题优先用用户起的名字，没起就列出覆盖的分类
function budgetTitle(budget) {
  if (budget.name) return budget.name
  const names = budget.category_names || (budget.category_name ? [budget.category_name] : [])
  return names.join('、') || '未分类'
}
// 起了名字时把分类名下沉到副标题，避免看不出这条预算管哪几个分类
function budgetSub(budget) {
  const base = periodLabel(budget.period)
  const names = budget.category_names || []
  if (budget.name && names.length) return `${base} · ${names.join('、')}`
  if (!budget.name && names.length > 1) return `${base} · ${names.length} 个分类共用`
  return base
}

function toggleCategory(id) {
  const idx = form.category_ids.indexOf(id)
  if (idx >= 0) form.category_ids.splice(idx, 1)
  else form.category_ids.push(id)
}

function onAmountInput(event) {
  let cleaned = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot >= 0) cleaned = `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
  if (event.target.value !== cleaned) event.target.value = cleaned
  form.amount = cleaned
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

function resetForm() {
  form.scope = 'total'
  form.category_ids = []
  form.amount = ''
  form.period = 'monthly'
  form.name = ''
  form.carry_over = 0
  form.start_date = todayStr()
  editingId.value = null
}

function openAdd() {
  resetForm()
  // 已有总预算时默认建分类预算，避免重复创建总预算
  if (totalBudget.value) form.scope = 'category'
  showModal.value = true
}

function openEdit(budget) {
  editingId.value = budget.id
  form.scope = budget.scope
  // 老数据没有 category_ids，用单个 category_id 兜一下
  form.category_ids = [...(budget.category_ids?.length ? budget.category_ids : (budget.category_id ? [budget.category_id] : []))]
  form.amount = budget.amount ? String(budget.amount) : ''
  form.period = budget.period
  form.name = budget.name || ''
  form.carry_over = budget.carry_over
  form.start_date = budget.start_date || todayStr()
  showModal.value = true
}

function closeModal() {
  showModal.value = false
  resetForm()
}

async function loadData() {
  loading.value = true
  try {
    const [b, t, c] = await Promise.all([getBudgets(), getTransactions(), getCategories()])
    budgets.value = b
    // 自动生成的盈亏账单不是消费行为，计入预算会让基金亏损直接顶爆额度
    transactions.value = t.filter(item => !item.auto_source)
    categories.value = c
  } catch (e) {
    showToast('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

async function save() {
  const amount = Number(form.amount) || 0
  if (amount <= 0) return showToast('请输入预算金额')
  if (form.scope === 'category' && form.category_ids.length === 0) return showToast('请至少选择一个分类')
  try {
    await saveBudget({
      id: editingId.value || undefined,
      name: form.name,
      scope: form.scope,
      category_ids: form.scope === 'category' ? [...form.category_ids] : [],
      category_id: form.scope === 'category' ? form.category_ids[0] ?? null : null,
      amount,
      period: form.period,
      carry_over: form.carry_over,
      start_date: form.start_date
    })
    closeModal()
    await loadData()
    showToast('已保存')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

function askDelete() {
  pendingDelete.value = { id: editingId.value }
}

async function doDelete() {
  try {
    await deleteBudget(pendingDelete.value.id)
    pendingDelete.value = null
    closeModal()
    await loadData()
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

onMounted(loadData)
</script>

<style scoped>
.budgets-page {
  min-height: 100%;
  position: relative;
  padding-bottom: 8px;
}

/* 总预算卡片 */
.overview-card {
  margin: 12px 16px;
  border-radius: 14px;
  padding: 16px;
  background: linear-gradient(135deg, #4A90D9, #5FA8E8);
  color: #fff;
}
/* 总预算卡可点击进编辑，给一点按压反馈 */
.overview-card.clickable {
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.overview-card.clickable:active {
  transform: scale(0.99);
  box-shadow: 0 4px 14px rgba(74, 144, 217, 0.3);
}

/* 重复总预算提示：历史脏数据，给一键清理 */
.dup-warn {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 16px 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warning-light);
  border: 1px solid #FBE0B0;
  font-size: 12px;
  color: #A15C00;
}
.dup-action {
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.overview-card.warn {
  background: linear-gradient(135deg, #E0932F, #F0AC4C);
}
.overview-card.over {
  background: linear-gradient(135deg, #D0453A, #E5675C);
}
.overview-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.overview-label {
  font-size: 12px;
  opacity: 0.9;
}
.overview-amount {
  font-size: 26px;
  font-weight: 700;
  margin: 4px 0 2px;
}
.overview-sub {
  font-size: 12px;
  opacity: 0.9;
}
.overview-ring {
  position: relative;
  flex-shrink: 0;
}
.ring-text {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
}
.overview-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 12px;
  opacity: 0.95;
}
.overview-foot .remain {
  font-weight: 600;
}

.carry-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.28);
  margin-left: 6px;
  vertical-align: middle;
}
.carry-tag.light {
  background: var(--primary-light);
  color: var(--primary);
}

/* 空状态引导 */
.intro-card {
  margin: 16px;
  padding: 28px 20px;
  background: var(--card);
  border-radius: 14px;
  text-align: center;
}
.intro-emoji {
  font-size: 40px;
  margin-bottom: 10px;
}
.intro-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.intro-text {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 6px;
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}
.section-count {
  font-size: 12px;
}
.empty-tip {
  padding: 4px 16px 16px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}

/* 分类预算卡片 */
.budget-card {
  margin: 8px 16px;
  padding: 14px;
  background: var(--card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.card-icon {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}
.card-info {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 14px;
  font-weight: 500;
}
.card-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-amount {
  text-align: right;
  flex-shrink: 0;
}
.card-amount .spent {
  font-size: 15px;
  font-weight: 600;
}
.card-amount .budget {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.progress-track {
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  overflow: hidden;
  margin: 12px 0 8px;
}
.progress-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--primary);
  transition: width 0.3s;
}
.progress-fill.warn { background: #F5A623; }
.progress-fill.over { background: var(--danger); }

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-secondary);
}
.card-foot .percent {
  font-weight: 600;
}
.card-foot .percent.ok { color: var(--primary); }
.card-foot .percent.warn { color: #F5A623; }
.card-foot .percent.over { color: var(--danger); }
.card-foot .remain.warn { color: #F5A623; }
.card-foot .remain.over { color: var(--danger); }

/* 弹窗与分段控件 */
.segmented {
  display: flex;
  background: var(--bg);
  border-radius: 10px;
  padding: 3px;
}
.segmented .seg {
  flex: 1;
  text-align: center;
  padding: 9px 4px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.segmented .seg.active {
  background: var(--primary);
  color: #fff;
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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
/* 多选计数：让用户一眼看出这条预算管了几个分类 */
.picked-count {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 400;
  color: var(--primary);
}
.field-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.switch-info { flex: 1; }
.switch-title { font-size: 14px; font-weight: 500; }
.switch-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.switch {
  width: 46px;
  height: 26px;
  border-radius: 13px;
  background: #d8dde3;
  padding: 3px;
  transition: background 0.2s;
  flex-shrink: 0;
}
.switch span {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch.on { background: var(--primary); }
.switch.on span { transform: translateX(20px); }

.modal-content {
  display: flex;
  flex-direction: column;
  max-height: 86vh;
  overflow: hidden;
}
.modal-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.modal-actions {
  flex-shrink: 0;
  display: flex;
  gap: 12px;
  padding: 12px 0 calc(4px + env(safe-area-inset-bottom, 0px));
  margin-top: 8px;
  border-top: 1px solid var(--border);
  background: var(--card);
}
.modal-actions .btn { flex: 1; }
</style>
