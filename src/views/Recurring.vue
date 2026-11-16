<template>
  <div class="recurring-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>周期记账</span>
    </div>

    <div class="page-tip">
      按设定周期自动生成账单，打开应用时补齐到期但未生成的记录
    </div>

    <div v-if="rules.length === 0" class="empty-state">
      <div class="emoji">🔁</div>
      <div class="text">还没有周期规则，点击右下角 + 添加</div>
    </div>

    <div v-for="rule in rules" :key="rule.id" class="list-item" @click="openEdit(rule)">
      <div class="icon" :style="{ background: iconBg(rule) }">{{ typeIcon(rule.type) }}</div>
      <div class="info">
        <div class="title">
          {{ rule.name }}
          <span class="freq-tag">{{ freqLabel(rule.frequency) }}</span>
          <span v-if="!rule.enabled" class="off-tag">已停用</span>
        </div>
        <div class="subtitle">
          {{ accountText(rule) }}
          · 上次生成 {{ rule.last_generated || '未生成' }}
        </div>
      </div>
      <div class="amount" :class="rule.type">
        {{ rule.type === 'expense' ? '-' : (rule.type === 'income' ? '+' : '') }}¥{{ fmt(rule.amount) }}
      </div>
    </div>

    <button class="fab" @click="openAdd">+</button>

    <!-- 编辑弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-title">{{ editingId ? '编辑周期规则' : '新建周期规则' }}</div>

        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">类型</label>
            <div class="segmented">
              <div class="seg" :class="{ active: form.type === 'expense' }" @click="switchType('expense')">支出</div>
              <div class="seg" :class="{ active: form.type === 'income' }" @click="switchType('income')">收入</div>
              <div class="seg" :class="{ active: form.type === 'transfer' }" @click="switchType('transfer')">转账</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">名称</label>
            <input class="form-input" v-model="form.name" placeholder="如：房租、工资、信用卡还款" />
          </div>

          <div class="form-group">
            <label class="form-label">金额</label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="form.amount"
              placeholder="0.00"
              @input="onDecimalInput('amount', $event)"
            />
          </div>

          <div v-if="form.type !== 'transfer'" class="form-group">
            <label class="form-label">分类</label>
            <div class="chip-row">
              <span
                v-for="cat in filteredCategories"
                :key="cat.id"
                class="chip"
                :class="{ 'chip-active': form.category_id === cat.id }"
                @click="form.category_id = cat.id"
              >{{ cat.icon }} {{ cat.name }}</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ form.type === 'transfer' ? '转出账户' : '账户' }}</label>
            <div class="chip-row">
              <span
                v-for="acc in accounts"
                :key="acc.id"
                class="chip"
                :class="{ 'chip-active': form.account_id === acc.id }"
                @click="form.account_id = acc.id"
              >{{ acc.icon }} {{ acc.name }}</span>
            </div>
          </div>

          <div v-if="form.type === 'transfer'" class="form-group">
            <label class="form-label">转入账户</label>
            <div class="chip-row">
              <span
                v-for="acc in toAccountOptions"
                :key="acc.id"
                class="chip"
                :class="{ 'chip-active': form.to_account_id === acc.id }"
                @click="form.to_account_id = acc.id"
              >{{ acc.icon }} {{ acc.name }}</span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">频率</label>
            <div class="segmented">
              <div
                v-for="opt in freqOptions"
                :key="opt.value"
                class="seg"
                :class="{ active: form.frequency === opt.value }"
                @click="form.frequency = opt.value"
              >{{ opt.label }}</div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">开始日期</label>
            <input class="form-input" type="date" v-model="form.start_date" />
          </div>

          <div class="form-group">
            <label class="form-label">结束日期（留空表示长期）</label>
            <input class="form-input" type="date" v-model="form.end_date" />
          </div>

          <div class="form-group">
            <label class="form-label">备注</label>
            <input class="form-input" v-model="form.note" placeholder="生成账单时的备注" />
          </div>

          <div class="form-group">
            <label class="form-label">商家</label>
            <input class="form-input" v-model="form.merchant" placeholder="可选" />
          </div>

          <div v-if="editingId" class="form-group">
            <div class="switch-row" @click="form.enabled = form.enabled ? 0 : 1">
              <div class="switch-info">
                <div class="switch-title">启用规则</div>
                <div class="switch-desc">停用后不再自动生成账单</div>
              </div>
              <div class="switch" :class="{ on: form.enabled }"><span></span></div>
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
        <div class="msg">删除周期规则「{{ pendingDelete.name }}」吗？<br/>已生成的账单不会被删除</div>
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
import {
  getRecurringRules, saveRecurringRule, deleteRecurringRule,
  getCategories, getAccounts, FREQ
} from '../db'

const rules = ref([])
const categories = ref([])
const accounts = ref([])
const showModal = ref(false)
const editingId = ref(null)
const pendingDelete = ref(null)
const toastMsg = ref('')

const freqOptions = [
  { value: FREQ.DAILY, label: '每日' },
  { value: FREQ.WEEKLY, label: '每周' },
  { value: FREQ.MONTHLY, label: '每月' },
  { value: FREQ.YEARLY, label: '每年' }
]

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const form = reactive({
  name: '',
  type: 'expense',
  amount: '',
  category_id: null,
  account_id: null,
  to_account_id: null,
  frequency: FREQ.MONTHLY,
  start_date: todayStr(),
  end_date: '',
  note: '',
  merchant: '',
  enabled: 1
})

const filteredCategories = computed(() =>
  categories.value.filter(c => c.type === form.type)
)
const toAccountOptions = computed(() =>
  accounts.value.filter(a => a.id !== form.account_id)
)

function fmt(n) {
  return (Number(n) || 0).toFixed(2)
}
function freqLabel(freq) {
  return freqOptions.find(o => o.value === freq)?.label || '每月'
}
function typeIcon(type) {
  if (type === 'income') return '➕'
  if (type === 'transfer') return '↔️'
  return '➖'
}
function iconBg(type) {
  if (type === 'income') return 'var(--success-light)'
  if (type === 'transfer') return 'var(--primary-light)'
  return 'var(--danger-light)'
}
function accountText(rule) {
  if (rule.type === 'transfer') {
    return `${rule.account_name || '未知'} → ${rule.to_account_name || '未知'}`
  }
  return rule.account_name || '未指定账户'
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

function onDecimalInput(field, event) {
  let cleaned = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot >= 0) cleaned = `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
  if (event.target.value !== cleaned) event.target.value = cleaned
  form[field] = cleaned
}

function switchType(type) {
  if (form.type === type) return
  form.type = type
  form.category_id = null
  if (type !== 'transfer') form.to_account_id = null
}

function resetForm() {
  form.name = ''
  form.type = 'expense'
  form.amount = ''
  form.category_id = null
  form.account_id = null
  form.to_account_id = null
  form.frequency = FREQ.MONTHLY
  form.start_date = todayStr()
  form.end_date = ''
  form.note = ''
  form.merchant = ''
  form.enabled = 1
  editingId.value = null
}

function openAdd() {
  resetForm()
  showModal.value = true
}
function openEdit(rule) {
  editingId.value = rule.id
  form.name = rule.name
  form.type = rule.type
  form.amount = rule.amount ? String(rule.amount) : ''
  form.category_id = rule.category_id
  form.account_id = rule.account_id
  form.to_account_id = rule.to_account_id
  form.frequency = rule.frequency || FREQ.MONTHLY
  form.start_date = rule.start_date || todayStr()
  form.end_date = rule.end_date || ''
  form.note = rule.note || ''
  form.merchant = rule.merchant || ''
  form.enabled = rule.enabled
  showModal.value = true
}
function closeModal() {
  showModal.value = false
  resetForm()
}

async function loadData() {
  const [r, c, a] = await Promise.all([getRecurringRules(), getCategories(), getAccounts()])
  rules.value = r
  categories.value = c
  accounts.value = a
}

async function save() {
  if (!form.name.trim()) return showToast('请输入名称')
  if (!(Number(form.amount) > 0)) return showToast('请输入金额')
  if (form.type === 'transfer') {
    if (!form.account_id || !form.to_account_id) return showToast('请选择转出和转入账户')
    if (form.account_id === form.to_account_id) return showToast('转出和转入账户不能相同')
  } else if (!form.account_id) {
    // 没有账户的规则一旦到期，会生成一笔无出处的账单，净资产和账户余额都对不上
    return showToast('请选择账户')
  }
  try {
    await saveRecurringRule({
      ...form,
      amount: Number(form.amount) || 0,
      id: editingId.value || undefined
    })
    closeModal()
    await loadData()
    showToast('已保存')
  } catch (e) {
    showToast('保存失败: ' + e.message)
  }
}

function askDelete() {
  pendingDelete.value = { id: editingId.value, name: form.name }
}

async function doDelete() {
  try {
    await deleteRecurringRule(pendingDelete.value.id)
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
.recurring-page {
  min-height: 100%;
  position: relative;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.back-btn {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  font-weight: 400;
  cursor: pointer;
  padding: 4px 8px;
}
.page-tip {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 10px 16px;
  background: var(--card);
  line-height: 1.5;
}

.freq-tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--primary-light);
  color: var(--primary);
  margin-left: 6px;
  vertical-align: middle;
}
.off-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--bg);
  color: var(--text-secondary);
  margin-left: 4px;
  vertical-align: middle;
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

.segmented {
  display: flex;
  background: var(--bg);
  border-radius: 10px;
  padding: 3px;
}
.segmented .seg {
  flex: 1;
  text-align: center;
  padding: 9px 2px;
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

/* 弹窗中部独立滚动，按钮常驻底部 */
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
