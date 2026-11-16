<template>
  <div class="add-page">
    <!-- 顶部栏 -->
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>{{ isEdit ? '编辑记录' : '记一笔' }}</span>
      <span v-if="isEdit" class="delete-btn" @click="confirmDelete = true">删除</span>
    </div>

    <!-- 可滚动内容区 -->
    <div class="scroll-body">

    <!-- 自动生成的收益记录：允许改金额，改完后不会再被自动覆盖 -->
    <div v-if="isEdit && autoSource" class="auto-earn-tip">
      这条收益由「每日收益自动入账」生成。金额与实际到账不一致时直接改，改完后不会再被自动覆盖。
    </div>

    <!-- 类型切换 -->
    <div class="type-toggle">
      <div class="item" :class="{ 'active-expense': form.type === 'expense' }" @click="switchType('expense')">支出</div>
      <div class="item" :class="{ 'active-income': form.type === 'income' }" @click="switchType('income')">收入</div>
      <div class="item" :class="{ 'active-transfer': form.type === 'transfer' }" @click="switchType('transfer')">转账</div>
    </div>

    <!-- 金额显示：键盘收起时点一下就能重新展开 -->
    <div class="amount-display" :class="{ invalid: errors.amount }" @click="keypadCollapsed = false">
      <span class="currency">¥</span>
      <span class="value">{{ amountText || '0' }}</span>
      <div v-if="showCalcPreview" class="calc-preview">= {{ draftTotalText }}</div>
      <div v-if="form.type === 'expense' && installmentEnabled" class="installment-hint">
        分期总额，共 {{ form.periods }} 期
      </div>
      <div v-if="errors.amount" class="amount-error">{{ errors.amount }}</div>
    </div>

    <!-- 分类选择（转账不需要分类） -->
    <template v-if="form.type !== 'transfer'">
      <div class="section-title">
        <span>选择分类<span class="required">*</span></span>
        <span
          v-if="sortedCategories.length > COMMON_CATEGORY_COUNT"
          class="fold-btn"
          :class="{ folded: showAllCategories }"
          @click="showAllCategories = !showAllCategories"
        ><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg></span>
      </div>
      <div class="category-grid">
        <div
          v-for="cat in visibleCategories"
          :key="cat.id"
          class="category-item"
          :class="{ selected: form.category_id === cat.id }"
          @click="selectCategory(cat.id)"
        >
          <span class="cat-icon">{{ cat.icon }}</span>
          <span class="cat-name">{{ cat.name }}</span>
        </div>
      </div>
      <div v-if="errors.category" class="field-error">{{ errors.category }}</div>
    </template>

    <!-- 账户选择：默认只摆最常用的几个，展开后按账户类型分区块、每块可单独收起 -->
    <div class="section-title">
      <span>{{ form.type === 'transfer' ? '转出账户' : '选择账户' }}<span class="required">*</span></span>
      <span
        v-if="accounts.length > COMMON_ACCOUNT_COUNT"
        class="fold-btn"
        :class="{ folded: showAllAccounts }"
        @click="showAllAccounts = !showAllAccounts"
      ><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg></span>
    </div>
    <div v-if="!showAllAccounts" class="account-list">
      <div
        v-for="acc in visibleAccounts"
        :key="acc.id"
        class="account-chip"
        :class="{ selected: form.account_id === acc.id }"
        @click="selectFromAccount(acc.id)"
      >
        <AppIcon :icon="acc.icon" /> {{ acc.name }}
      </div>
    </div>
    <template v-else>
      <div v-for="group in accountGroups" :key="group.type" class="account-group">
        <div class="group-header" @click="toggleGroup(accountCollapsed, group.type)">
          <span class="group-title">
            {{ group.label }}<span class="group-count">{{ group.items.length }}</span>
          </span>
          <span class="group-arrow" :class="{ folded: accountCollapsed[group.type] }">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg>
          </span>
        </div>
        <div v-show="!accountCollapsed[group.type]" class="account-list">
          <div
            v-for="acc in group.items"
            :key="acc.id"
            class="account-chip"
            :class="{ selected: form.account_id === acc.id }"
            @click="selectFromAccount(acc.id)"
          >
            <AppIcon :icon="acc.icon" /> {{ acc.name }}
          </div>
        </div>
      </div>
    </template>
    <div v-if="accounts.length === 0" class="inline-tip">还没有账户，先到「账户」页添加</div>
    <div v-if="errors.account && form.type !== 'transfer'" class="field-error">{{ errors.account }}</div>

    <template v-if="form.type === 'transfer'">
      <div class="section-title">
        <span>转入账户<span class="required">*</span></span>
        <span
          v-if="toAccountOptions.length > COMMON_ACCOUNT_COUNT"
          class="fold-btn"
          :class="{ folded: showAllToAccounts }"
          @click="showAllToAccounts = !showAllToAccounts"
        ><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg></span>
      </div>
      <div v-if="!showAllToAccounts" class="account-list">
        <div
          v-for="acc in visibleToAccounts"
          :key="acc.id"
          class="account-chip"
          :class="{ selected: form.to_account_id === acc.id }"
          @click="selectToAccount(acc.id)"
        >
          <AppIcon :icon="acc.icon" /> {{ acc.name }}
        </div>
      </div>
      <template v-else>
        <div v-for="group in toAccountGroups" :key="group.type" class="account-group">
          <div class="group-header" @click="toggleGroup(toAccountCollapsed, group.type)">
            <span class="group-title">
              {{ group.label }}<span class="group-count">{{ group.items.length }}</span>
            </span>
            <span class="group-arrow" :class="{ folded: toAccountCollapsed[group.type] }">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg>
            </span>
          </div>
          <div v-show="!toAccountCollapsed[group.type]" class="account-list">
            <div
              v-for="acc in group.items"
              :key="acc.id"
              class="account-chip"
              :class="{ selected: form.to_account_id === acc.id }"
              @click="selectToAccount(acc.id)"
            >
              <AppIcon :icon="acc.icon" /> {{ acc.name }}
            </div>
          </div>
        </div>
      </template>
      <div v-if="toAccountOptions.length === 0" class="inline-tip">至少需要两个账户才能转账</div>
      <div v-if="errors.account" class="field-error">{{ errors.account }}</div>
    </template>

    <!-- 标签 -->
    <div class="section-title">
      标签
      <span class="section-action" @click="showTagInput = !showTagInput">
        {{ showTagInput ? '收起' : '+ 新建' }}
      </span>
    </div>
    <div v-if="showTagInput" class="tag-create-row">
      <input
        class="form-input tag-input"
        v-model="newTagName"
        placeholder="输入新标签名称"
        @keyup.enter="addTag"
      />
      <button class="btn btn-outline tag-add-btn" @click="addTag">添加</button>
    </div>
    <div class="tag-chips">
      <span
        v-for="tag in tags"
        :key="tag.id"
        class="chip"
        :class="{ 'chip-active': form.tag_ids.includes(tag.id) }"
        @click="toggleTag(tag.id)"
      >{{ tag.name }}</span>
      <span v-if="tags.length === 0 && !showTagInput" class="inline-tip">还没有标签，点右侧新建</span>
    </div>

    <!-- 报销（仅支出） -->
    <template v-if="form.type === 'expense'">
      <div class="section-title">报销</div>
      <div class="segmented">
        <div class="seg" :class="{ active: form.reimburse_status === 'none' }" @click="form.reimburse_status = 'none'">不报销</div>
        <div class="seg" :class="{ active: form.reimburse_status === 'pending' }" @click="form.reimburse_status = 'pending'">待报销</div>
        <div class="seg" :class="{ active: form.reimburse_status === 'done' }" @click="form.reimburse_status = 'done'">已报销</div>
      </div>

      <!-- 分期（仅新建时可选） -->
      <template v-if="!isEdit">
        <div class="section-title">分期记账</div>
        <div class="switch-row" @click="toggleInstallment">
          <div class="switch-info">
            <div class="switch-title">拆分为多期</div>
            <div class="switch-desc">按总额自动生成每期账单，可逐笔修改</div>
          </div>
          <div class="switch" :class="{ on: installmentEnabled }"><span></span></div>
        </div>
        <div v-if="installmentEnabled" class="installment-config">
          <label class="form-label">期数</label>
          <input
            class="form-input"
            type="text"
            inputmode="numeric"
            :value="form.periods"
            placeholder="2"
            @input="onPeriodsInput"
          />
          <div class="inline-tip">每期约 ¥{{ perPeriodAmount }}，首期日期为下方所选日期</div>
        </div>
      </template>
      <div v-else-if="form.installment_id" class="inline-tip">该记录属于一个分期计划</div>
    </template>

    <!-- 商家 -->
    <div class="form-group">
      <label class="form-label">商家 / 店铺</label>
      <input class="form-input" v-model="form.merchant" placeholder="如：全家便利店（可选）" />
    </div>

    <!-- 备注和日期 -->
    <div class="form-group">
      <label class="form-label">备注</label>
      <input class="form-input" v-model="form.note" placeholder="添加备注（可选）" />
    </div>
    <div class="form-group">
      <label class="form-label">日期</label>
      <input class="form-input" type="date" v-model="form.date" />
    </div>
    </div>

    <!-- 底部固定键盘 -->
    <div class="keypad-area">
    <!-- 键盘收起条：挑分类、挑账户时把纵向空间让出来，保存按钮始终可见 -->
    <div v-if="!savedMode" class="keypad-toggle" @click="keypadCollapsed = !keypadCollapsed">
      <span class="keypad-toggle-icon" :class="{ folded: keypadCollapsed }">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg>
      </span>
    </div>
    <!-- 数字键盘 -->
    <div v-show="!keypadCollapsed && !savedMode" class="numpad">
      <div class="numpad-row">
        <button v-for="n in ['1','2','3']" :key="n" class="num-key" @click="inputNum(n)">{{ n }}</button>
      </div>
      <div class="numpad-row">
        <button v-for="n in ['4','5','6']" :key="n" class="num-key" @click="inputNum(n)">{{ n }}</button>
      </div>
      <div class="numpad-row">
        <button v-for="n in ['7','8','9']" :key="n" class="num-key" @click="inputNum(n)">{{ n }}</button>
      </div>
      <div class="numpad-row">
        <button class="num-key" @click="inputNum('.')">.</button>
        <button class="num-key" @click="inputNum('0')">0</button>
        <button class="num-key op-key" @click="inputOp('+')">+</button>
        <button class="num-key op-key" @click="inputOp('-')">−</button>
        <button class="num-key backspace" @click="backspace">⌫</button>
      </div>
    </div>

    <!-- 保存后：先让用户选「再记一笔」还是收工，键盘收起也就不会手一抖重复入账 -->
    <div v-if="savedMode" class="saved-panel">
      <div class="saved-hint">{{ savedTip }}</div>
      <div class="saved-actions">
        <button class="btn btn-outline" @click="finishSave">完成</button>
        <button v-if="!isEdit" class="btn btn-primary" @click="saveAnother">再记一笔</button>
      </div>
    </div>

    <!-- 保存按钮 -->
    <button v-else class="btn btn-primary save-btn" @click="save">
      {{ isEdit ? '保存修改' : '保存' }}
    </button>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDelete" class="confirm-dialog" @click.self="confirmDelete = false">
      <div class="confirm-box">
        <div class="msg">确定删除这条记录吗？</div>
        <div class="actions">
          <button class="btn btn-outline" @click="confirmDelete = false">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 预算提醒 -->
    <div v-if="budgetWarn" class="confirm-dialog" @click.self="budgetWarn = null">
      <div class="confirm-box">
        <div class="msg">
          <div class="warn-title">这笔记完，预算就要紧了</div>
          <div v-for="line in budgetWarn.lines" :key="line" class="warn-line">{{ line }}</div>
        </div>
        <div class="actions">
          <button class="btn btn-outline" @click="budgetWarn = null">再想想</button>
          <button class="btn btn-primary" @click="confirmSave">仍然保存</button>
        </div>
      </div>
    </div>

    <!-- Toast -->
    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  getCategories, getAccounts, getTags, createTag, getUsageStats, getBudgets, getTransactions,
  createTransaction, updateTransaction, deleteTransaction, getTransactionById,
  createInstallment, TX
} from '../db'
import { budgetProgress, budgetCategoryIds } from '../utils/finance'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const props = defineProps({ id: [String, Number] })

const isEdit = computed(() => !!props.id)
const categories = ref([])
const accounts = ref([])
const tags = ref([])
const amountStr = ref('')
const confirmDelete = ref(false)
const toastMsg = ref('')
const showTagInput = ref(false)
const newTagName = ref('')
const installmentEnabled = ref(false)
// 编辑的是自动生成的收益账单时置位，用于顶部提示
const autoSource = ref('')

// 分类 / 账户：默认只摆最常用的几个，点「全部」才铺开
const COMMON_CATEGORY_COUNT = 8
const COMMON_ACCOUNT_COUNT = 6
const ACCOUNT_TYPE_ORDER = ['cash', 'credit', 'debt', 'investment']
const ACCOUNT_TYPE_LABELS = { cash: '普通账户', credit: '信用账户', debt: '欠款账户', investment: '投资账户' }

// 历史使用次数，key 是分类/账户 id
const usage = reactive({ categories: {}, accounts: {} })
const showAllCategories = ref(false)
const showAllAccounts = ref(false)
const showAllToAccounts = ref(false)
// 展开态下每个账户类型区块各自的折叠状态
const accountCollapsed = reactive({})
const toAccountCollapsed = reactive({})
// 数字键盘折叠状态：挑分类和账户时把纵向空间让出来
const keypadCollapsed = ref(false)
// 必填校验的字段级提示
const errors = reactive({ amount: '', category: '', account: '' })

// 金额算式：expr 是已经确认的前缀（末尾一定是 + 或 -），amountStr 是正在输入的那段数字
const expr = ref('')
// 保存成功后进入「收工态」：键盘收起、按钮换成「再记一笔 / 完成」，避免重复入账
const savedMode = ref(false)
const savedTip = ref('')
const saving = ref(false)
// 预算跨阈值提醒
const budgetWarn = ref(null)

const form = reactive({
  type: 'expense',
  amount: 0,
  category_id: null,
  account_id: null,
  to_account_id: null,
  merchant: '',
  note: '',
  date: new Date().toISOString().split('T')[0],
  reimburse_status: 'none',
  tag_ids: [],
  installment_id: null,
  periods: 2
})

const filteredCategories = computed(() =>
  categories.value.filter(c => c.type === form.type)
)

// ========== 常用排序（用得多 → 用户设定顺序 → id）==========
function sortByUsage(list, counts) {
  return [...list].sort((a, b) =>
    (Number(counts[b.id]) || 0) - (Number(counts[a.id]) || 0) ||
    (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
    Number(a.id) - Number(b.id)
  )
}

// 折叠态下若当前选中项没挤进常用，也要补上去：
// 否则编辑老记录时用户看不到自己选的是哪个分类/账户
function topWithSelected(sorted, limit, selectedId) {
  const top = sorted.slice(0, limit)
  if (selectedId == null) return top
  const selected = sorted.find(item => Number(item.id) === Number(selectedId))
  if (selected && !top.some(item => Number(item.id) === Number(selected.id))) top.push(selected)
  return top
}

const sortedCategories = computed(() => sortByUsage(filteredCategories.value, usage.categories))
const visibleCategories = computed(() => showAllCategories.value
  ? sortedCategories.value
  : topWithSelected(sortedCategories.value, COMMON_CATEGORY_COUNT, form.category_id))

const sortedAccounts = computed(() => sortByUsage(accounts.value, usage.accounts))
const visibleAccounts = computed(() => showAllAccounts.value
  ? sortedAccounts.value
  : topWithSelected(sortedAccounts.value, COMMON_ACCOUNT_COUNT, form.account_id))

// 转入账户要排除已选中的转出账户，避免自己转给自己
const toAccountOptions = computed(() =>
  sortedAccounts.value.filter(a => Number(a.id) !== Number(form.account_id))
)
const visibleToAccounts = computed(() => showAllToAccounts.value
  ? toAccountOptions.value
  : topWithSelected(toAccountOptions.value, COMMON_ACCOUNT_COUNT, form.to_account_id))

// 展开态按账户类型分区块，同类型的摆在一起
function groupAccounts(list) {
  return ACCOUNT_TYPE_ORDER
    .map(type => ({
      type,
      label: ACCOUNT_TYPE_LABELS[type],
      items: list.filter(a => (a.type || 'cash') === type)
    }))
    .filter(group => group.items.length > 0)
}
const accountGroups = computed(() => groupAccounts(sortedAccounts.value))
const toAccountGroups = computed(() => groupAccounts(toAccountOptions.value))

function toggleGroup(map, type) {
  map[type] = !map[type]
}

const perPeriodAmount = computed(() => {
  const periods = Math.max(2, Number(form.periods) || 2)
  return ((Number(form.amount) || 0) / periods).toFixed(2)
})

// ========== 金额算式（12+8 这种凑单直接算） ==========
const amountText = computed(() => `${expr.value}${amountStr.value}`)
const draftTotal = computed(() => evaluateExpression(amountText.value))
// 只有出现运算符时才显示实时结果，单纯输数字不额外占一行
const showCalcPreview = computed(() => /[+\-]/.test(expr.value) && !!amountStr.value)
const draftTotalText = computed(() => (draftTotal.value || 0).toFixed(2))

// 从左到右依次加减，不支持乘除与括号：记账场景只要凑单相加、优惠扣减
function evaluateExpression(text) {
  const src = String(text || '').replace(/\s/g, '')
  if (!src) return 0
  const tokens = src.match(/\d*\.?\d+|[+\-]/g) || []
  let total = 0
  let sign = 1
  let hasNumber = false
  for (const token of tokens) {
    if (token === '+' || token === '-') {
      sign = token === '-' ? -1 : 1
      continue
    }
    total += sign * (parseFloat(token) || 0)
    hasNumber = true
  }
  return hasNumber ? Math.round(total * 100) / 100 : 0
}

// 输入一变就把结果同步到 form.amount，保存和分期计算都只认这一个值
watch([expr, amountStr], () => {
  form.amount = draftTotal.value
})

const MAX_INT_DIGITS = 8
const MAX_DEC_DIGITS = 2

function switchType(type) {
  if (form.type === type) return
  form.type = type
  // 切换类型后分类词表整体换了，旧的选中项和报错都不再成立
  errors.category = ''
  errors.account = ''
  if (type === TX.TRANSFER) {
    form.category_id = null
    form.reimburse_status = 'none'
    installmentEnabled.value = false
  } else {
    form.to_account_id = null
    // 原来选中的分类属于旧类型（支出分类留在收入单上），留着会被当成合法值存进去
    const picked = categories.value.find(c => Number(c.id) === Number(form.category_id))
    if (picked && picked.type !== type) form.category_id = null
  }
}

function selectCategory(id) {
  form.category_id = id
  errors.category = ''
}

// 转出账户变化时，若与原转入账户冲突则清空转入
function selectFromAccount(id) {
  form.account_id = id
  if (Number(form.to_account_id) === Number(id)) form.to_account_id = null
  errors.account = ''
}

function selectToAccount(id) {
  form.to_account_id = id
  errors.account = ''
}

function inputNum(n) {
  let s = amountStr.value
  if (n === '.') {
    if (s.includes('.')) return
    if (!s) s = '0'
    s += '.'
  } else {
    // 避免出现 01 / 00 这类前导零
    s = s === '0' ? n : s + n
  }
  const [intPart, decPart = ''] = s.split('.')
  // 超限时给出明确提示，避免看起来像"点了没反应"
  if (intPart.length > MAX_INT_DIGITS) {
    showToast(`金额最多 ${MAX_INT_DIGITS} 位整数`)
    return
  }
  if (decPart.length > MAX_DEC_DIGITS) {
    showToast(`最多 ${MAX_DEC_DIGITS} 位小数`)
    return
  }
  amountStr.value = s
  if (draftTotal.value > 0) errors.amount = ''
}

// 运算符：把当前这段数字确认进前缀，后面接着输下一段
function inputOp(op) {
  if (!amountStr.value) {
    if (!expr.value) return
    // 连按运算符说明要改主意，替换掉最后一个
    expr.value = expr.value.slice(0, -1) + op
    return
  }
  expr.value = `${expr.value}${amountStr.value}${op}`
  amountStr.value = ''
  errors.amount = ''
}

function backspace() {
  if (amountStr.value) {
    amountStr.value = amountStr.value.slice(0, -1)
    return
  }
  if (!expr.value) return
  // 退到上一段：去掉末尾运算符，再把上一段数字放回输入区，
  // 保证 expr 末尾永远是运算符，接着输数字不会拼成 "128"
  const rest = expr.value.slice(0, -1)
  const tail = rest.match(/(\d*\.?\d+)$/)
  if (tail) {
    amountStr.value = tail[1]
    expr.value = rest.slice(0, rest.length - tail[1].length)
  } else {
    expr.value = rest
  }
}

function onPeriodsInput(event) {
  const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 3)
  if (event.target.value !== cleaned) event.target.value = cleaned
  form.periods = Number(cleaned) || 0
}

function toggleInstallment() {
  installmentEnabled.value = !installmentEnabled.value
  if (installmentEnabled.value && Number(form.periods) < 2) form.periods = 2
}

function toggleTag(id) {
  const idx = form.tag_ids.indexOf(id)
  if (idx >= 0) form.tag_ids.splice(idx, 1)
  else form.tag_ids.push(id)
}

async function addTag() {
  const name = newTagName.value.trim()
  if (!name) return
  if (tags.value.some(t => t.name === name)) {
    showToast('标签已存在')
    return
  }
  try {
    await createTag({ name })
    tags.value = await getTags()
    const created = tags.value.find(t => t.name === name)
    if (created) form.tag_ids.push(created.id)
    newTagName.value = ''
    showTagInput.value = false
  } catch (e) {
    showToast('新建标签失败: ' + e.message)
  }
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

// 必填校验：金额、分类、账户三项缺一不可，转账则要求两个账户
// 报错同时落到字段上，用户能直接看到是哪一块没填
function validate() {
  errors.amount = ''
  errors.category = ''
  errors.account = ''

  if (!draftTotal.value || draftTotal.value <= 0) {
    errors.amount = expr.value ? '算式算出来不是正数，检查下减号' : '请先输入金额'
    return errors.amount
  }
  if (form.type !== TX.TRANSFER) {
    const picked = categories.value.find(c => Number(c.id) === Number(form.category_id))
    if (!picked) {
      errors.category = '请选择一个分类'
      return errors.category
    }
    if (picked.type !== form.type) {
      errors.category = '所选分类与收支类型不匹配，请重新选择'
      return errors.category
    }
  }
  if (!form.account_id) {
    errors.account = form.type === TX.TRANSFER ? '请选择转出账户' : '请选择账户'
    // 折叠态下按钮可能藏在「全部」里，顺手展开，避免提示了还找不到
    showAllAccounts.value = true
    return errors.account
  }
  if (!form.date) return '请选择日期'
  if (form.type === TX.TRANSFER) {
    if (!form.to_account_id) {
      errors.account = '请选择转入账户'
      showAllToAccounts.value = true
      return errors.account
    }
    if (Number(form.account_id) === Number(form.to_account_id)) {
      errors.account = '转出和转入账户不能相同'
      return errors.account
    }
  }
  if (installmentEnabled.value && Number(form.periods) < 2) return '分期期数至少为 2'
  return ''
}

async function save() {
  if (saving.value) return
  const error = validate()
  if (error) {
    showToast(error)
    return
  }
  // 只在新建支出时预检预算：编辑改的是已有那笔，按全额再算一遍会误报
  if (!isEdit.value && form.type === TX.EXPENSE) {
    const warn = await detectBudgetWarn()
    if (warn) {
      budgetWarn.value = warn
      return
    }
  }
  await persist()
}

async function confirmSave() {
  budgetWarn.value = null
  await persist()
}

// 预算预检：只有「本次跨过 80% / 100% 阈值」才提醒，
// 已经超支的情况下每笔都弹会变成噪音
async function detectBudgetWarn() {
  const amount = Number(draftTotal.value) || 0
  if (amount <= 0) return null
  try {
    const [budgets, trans] = await Promise.all([
      getBudgets(),
      getTransactions({ type: TX.EXPENSE })
    ])
    const expenses = trans.filter(t => !t.auto_source)
    const lines = []
    for (const b of budgets) {
      if (!b.enabled) continue
      if (b.scope !== 'total' && !budgetCategoryIds(b).includes(Number(form.category_id))) continue
      const progress = budgetProgress(b, expenses)
      const range = progress.range || {}
      // 只对落在当前预算周期的这笔预警：补记上个月的账不该弹本期预算
      if (!range.start || form.date < range.start || form.date > range.end) continue
      const available = Number(progress.available) || 0
      const before = Number(progress.percent) || 0
      const used = progress.used + amount
      const after = available > 0 ? (used / available) * 100 : 100
      const over = available > 0 ? used > available : used > 0
      const crossedOver = over && before <= 100
      const crossedWarn = !over && after >= 80 && before < 80
      if (!crossedOver && !crossedWarn) continue
      const label = b.scope === 'total'
        ? '总预算'
        : `${b.name || b.category_name || '分类'}预算`
      const tail = over ? `，超支 ¥${(used - available).toFixed(2)}` : ''
      lines.push(`${label}：本次后已用 ¥${used.toFixed(2)} / ¥${available.toFixed(2)}（${after.toFixed(0)}%）${tail}`)
    }
    return lines.length ? { lines } : null
  } catch {
    // 预算查不到不该挡住记账主流程
    return null
  }
}

async function persist() {
  if (saving.value) return
  saving.value = true
  form.amount = draftTotal.value
  const payload = {
    ...form,
    // 转账不记分类和报销
    category_id: form.type === TX.TRANSFER ? null : form.category_id,
    reimburse_status: form.type === TX.TRANSFER ? 'none' : form.reimburse_status
  }
  try {
    if (isEdit.value) {
      await updateTransaction({ ...payload, id: props.id })
      savedTip.value = '修改已保存'
    } else if (installmentEnabled.value && form.type === TX.EXPENSE) {
      await createInstallment({
        name: form.note || categoryName() || '分期',
        total_amount: form.amount,
        periods: form.periods,
        category_id: form.category_id,
        account_id: form.account_id,
        note: form.note,
        start_date: form.date
      })
      savedTip.value = `已生成 ${form.periods} 期账单`
      refreshUsage()
    } else {
      await createTransaction(payload)
      const label = form.type === TX.TRANSFER
        ? '转账'
        : (categoryName() || (form.type === TX.INCOME ? '收入' : '支出'))
      savedTip.value = `已保存 ${label} ¥${(Number(form.amount) || 0).toFixed(2)}`
      // 刚记的这笔会影响「常用」排序，回列表前顺手刷新
      refreshUsage()
    }
    savedMode.value = true
  } catch (e) {
    showToast('保存失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

// 收工：回到上一页（编辑保存后也是这条路径）
function finishSave() {
  router.back()
}

// 再记一笔：只清金额与备注，保留分类/账户/日期，连续记多笔时少点几次返回
function saveAnother() {
  savedMode.value = false
  savedTip.value = ''
  expr.value = ''
  amountStr.value = ''
  form.amount = 0
  form.merchant = ''
  form.note = ''
  form.tag_ids = []
  form.reimburse_status = 'none'
  form.installment_id = null
  installmentEnabled.value = false
  form.periods = 2
  autoSource.value = ''
  errors.amount = ''
  errors.category = ''
  errors.account = ''
  keypadCollapsed.value = false
  document.querySelector('.scroll-body')?.scrollTo?.({ top: 0, behavior: 'smooth' })
}

function categoryName() {
  const cat = categories.value.find(c => c.id === form.category_id)
  return cat?.name || ''
}

async function doDelete() {
  try {
    await deleteTransaction(props.id)
    showToast('已删除')
    confirmDelete.value = false
    setTimeout(() => router.back(), 500)
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

// 刚记完一笔后重新拉频次：「常用」排序要立刻反映这次记账
async function refreshUsage() {
  try {
    const stats = await getUsageStats()
    usage.categories = stats?.categories || {}
    usage.accounts = stats?.accounts || {}
  } catch {
    // 拿不到频次就保持原排序，不影响继续记账
  }
}

onMounted(async () => {
  try {
    const [cats, accs, tgs, stats] = await Promise.all([
      getCategories(), getAccounts(), getTags(), getUsageStats()
    ])
    categories.value = cats
    accounts.value = accs
    tags.value = tgs
    // 拿不到频次也不影响记账，排序自然回落到用户设定顺序
    usage.categories = stats?.categories || {}
    usage.accounts = stats?.accounts || {}
  } catch (e) {
    showToast('加载数据失败: ' + e.message)
  }

  if (isEdit.value) {
    try {
      const t = await getTransactionById(props.id)
      if (t) {
        form.type = t.type
        form.amount = t.amount
        amountStr.value = String(t.amount)
        form.category_id = t.category_id
        form.account_id = t.account_id
        form.to_account_id = t.to_account_id
        form.merchant = t.merchant || ''
        form.note = t.note
        form.date = t.date?.split(' ')[0] || t.date
        form.reimburse_status = t.reimburse_status || 'none'
        form.installment_id = t.installment_id || null
        autoSource.value = t.auto_source || ''
        form.tag_ids = (t.tags || []).map(g => g.id)
      }
    } catch (e) {
      showToast('加载记录失败: ' + e.message)
    }
    return
  }

  // 首页右滑「复制」带过来的一笔：只预填，不直接落库
  const copied = window.history.state?.copy
  if (copied) {
    applyCopy(copied)
    try {
      // 用完清掉，避免刷新页面又填一遍
      window.history.replaceState({ ...window.history.state, copy: null }, '')
    } catch {
      // 个别环境不支持替换历史状态，忽略即可
    }
  }
})

function applyCopy(data) {
  form.type = [TX.EXPENSE, TX.INCOME, TX.TRANSFER].includes(data.type) ? data.type : TX.EXPENSE
  form.amount = Number(data.amount) || 0
  amountStr.value = data.amount ? String(data.amount) : ''
  expr.value = ''
  form.category_id = data.category_id ?? null
  form.account_id = data.account_id ?? null
  form.to_account_id = data.to_account_id ?? null
  form.merchant = data.merchant || ''
  form.note = data.note || ''
  form.reimburse_status = data.reimburse_status || 'none'
  form.tag_ids = Array.isArray(data.tag_ids) ? data.tag_ids.map(Number) : []
  // 复制出来的是今天这一笔，日期不带过来
  form.date = new Date().toISOString().split('T')[0]
  showToast('已复制上一笔，改完点保存')
}
</script>

<style scoped>
.add-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}
/* 中间内容独立滚动，数字键盘与保存按钮始终固定在底部 */
.scroll-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
/* 自动收益提示：低对比度的说明条，不干扰金额输入 */
.auto-earn-tip {
  margin: 10px 16px 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--primary-light);
  color: var(--primary);
  font-size: 11px;
  line-height: 1.6;
}
.amount-display {
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
  padding: 12px 16px;
}
.amount-display .value {
  font-size: 32px;
}
/* 小屏下压缩分类网格与键盘高度，把纵向空间让给可滚动内容区 */
.category-grid {
  padding: 8px 16px;
}
.category-item {
  padding: 8px 4px;
}
.category-item .cat-icon {
  font-size: 22px;
  margin-bottom: 2px;
}
.installment-hint {
  font-size: 12px;
  color: var(--primary);
  font-weight: 500;
}
.keypad-area {
  flex-shrink: 0;
  background: var(--card);
  padding-bottom: env(safe-area-inset-bottom, 0);
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 14px 16px;
}
.back-btn, .delete-btn {
  position: absolute;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
}
.back-btn { left: 12px; }
.delete-btn { right: 12px; color: #FFB3B3; }

.section-title {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 12px 16px 4px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.section-action {
  color: var(--primary);
  font-size: 13px;
  cursor: pointer;
  padding: 2px 4px;
}
.inline-tip {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 4px 16px 8px;
}
/* 必填标记与字段级报错 */
.required {
  color: var(--danger);
  margin-left: 2px;
}
.field-error {
  padding: 0 16px 8px;
  font-size: 12px;
  color: var(--danger);
}
.amount-error {
  width: 100%;
  text-align: center;
  font-size: 12px;
  color: var(--danger);
}
/* 算式实时结果：只在出现运算符时占一行 */
.calc-preview {
  width: 100%;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
}
/* 预算提醒弹窗正文 */
.warn-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.warn-line {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
}
.amount-display.invalid .value {
  color: var(--danger);
}

/* 展开态：账户按类型分区块，每块可单独收起 */
.account-group {
  margin-bottom: 2px;
}
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px 2px;
  font-size: 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
}
.group-count {
  margin-left: 4px;
}
.group-arrow {
  font-size: 13px;
  transition: transform 0.2s;
}
.group-arrow.folded {
  transform: rotate(-90deg);
}

/* 展开/收起只留实心箭头：⌄ 展开、⌃ 收起 */
/* 热区靠 padding 放大到约 30px 高，再用负 margin 抵掉，标题行高度不受影响 */
.fold-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
  padding: 8px 12px;
  margin: -8px -4px -8px 0;
  cursor: pointer;
  transition: transform 0.2s;
  user-select: none;
  -webkit-user-select: none;
}
.fold-btn svg,
.keypad-toggle-icon svg,
.group-arrow svg {
  display: block;
  width: 12px;
  height: 12px;
  fill: currentColor;
}
.fold-btn.folded {
  transform: rotate(180deg);
}

/* 键盘收起条 */
.keypad-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 16px 4px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  touch-action: manipulation;
}
.keypad-toggle-icon {
  transition: transform 0.2s;
}
.keypad-toggle-icon.folded {
  transform: rotate(180deg);
}

.account-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
}
.account-chip {
  padding: 8px 14px;
  border-radius: 20px;
  background: var(--card);
  font-size: 13px;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}
.account-chip.selected {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}

/* 标签 */
.tag-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 4px 16px 8px;
}
.chip {
  padding: 6px 12px;
  border-radius: 16px;
  background: var(--card);
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
.tag-create-row {
  display: flex;
  gap: 8px;
  padding: 4px 16px 8px;
}
.tag-input { flex: 1; padding: 9px 12px; }
.tag-add-btn { flex-shrink: 0; padding: 0 16px; }

/* 分段控件 */
.segmented {
  display: flex;
  background: var(--bg);
  border-radius: 10px;
  padding: 3px;
  margin: 0 16px;
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

/* 开关行 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
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

.installment-config {
  padding: 0 16px 8px;
}
.installment-config .form-input {
  margin-bottom: 4px;
}

.numpad {
  padding: 8px 16px;
  background: var(--card);
}
.numpad-row {
  display: flex;
  gap: 6px;
  margin-bottom: 5px;
}
.num-key {
  flex: 1;
  padding: 11px;
  border: none;
  border-radius: 10px;
  background: var(--bg);
  font-size: 19px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.1s;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.num-key:active { background: #ddd; }
.num-key.backspace { background: var(--danger-light); color: var(--danger); }
/* 运算符键：与数字区分开，一眼能看出这是加减 */
.num-key.op-key {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}

/* 保存成功后的收工态 */
.saved-panel {
  padding: 12px 16px 14px;
}
.saved-hint {
  font-size: 13px;
  color: var(--text-secondary);
  text-align: center;
  margin-bottom: 10px;
}
.saved-actions {
  display: flex;
  gap: 12px;
}
.saved-actions .btn {
  flex: 1;
}

.save-btn {
  display: flex;
  width: calc(100% - 32px);
  margin: 4px 16px 12px;
}
</style>
