<template>
  <div class="salary-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>工资计算器</span>
    </div>

    <div class="page-tip">
      按现行累计预扣预缴法估算：税前 − 五险一金个人部分 − 个税 = 到手。
      五险一金比例、缴费基数上下限各地不同，最终以工资条为准。
    </div>

    <!-- 税前与月份 -->
    <div class="card">
      <div class="card-title">税前工资</div>
      <div class="form-group">
        <label class="form-label">税前月薪（元）</label>
        <input
          class="form-input"
          type="text"
          inputmode="decimal"
          :value="grossStr"
          placeholder="如 15000"
          @input="onGrossInput"
        />
      </div>
      <div class="form-group last">
        <label class="form-label">这是今年第几个月</label>
        <div class="month-row">
          <select class="form-input" :value="monthIndex" @change="onMonthChange">
            <option v-for="m in 12" :key="m" :value="m">{{ m }} 月</option>
          </select>
          <span class="month-hint">个税按累计口径，月份会影响本月扣多少</span>
        </div>
      </div>
    </div>

    <!-- 五险一金 -->
    <div class="card">
      <div class="card-title">五险一金（个人缴纳）</div>
      <div class="form-group">
        <label class="form-label">缴费基数</label>
        <input
          class="form-input"
          type="text"
          inputmode="decimal"
          :value="baseStr"
          placeholder="留空 = 按税前工资"
          @input="onBaseInput"
        />
      </div>
      <div class="rate-list">
        <div v-for="key in SOCIAL_KEYS" :key="key" class="rate-row">
          <span class="rate-label">{{ SOCIAL_LABEL[key] }}</span>
          <span class="rate-input-wrap">
            <input
              class="rate-input"
              type="text"
              inputmode="decimal"
              :value="rateStr[key]"
              @input="onRateInput(key, $event)"
            />
            <span class="rate-unit">%</span>
          </span>
          <span class="rate-value">¥{{ money(result.social[key]) }}</span>
        </div>
      </div>
      <div class="sum-row">
        <span>个人合计</span>
        <strong>¥{{ money(result.socialTotal) }}</strong>
      </div>
    </div>

    <!-- 专项附加扣除 -->
    <div class="card">
      <div class="card-title">专项附加扣除</div>
      <div class="chip-wrap">
        <span
          v-for="item in SPECIAL_PRESETS"
          :key="item.key"
          class="chip"
          :class="{ active: !!specials[item.key] }"
          @click="toggleSpecial(item)"
        >{{ item.label }}</span>
      </div>
      <div v-if="!activeSpecials.length" class="field-hint">
        没有就留空。点上面的标签会按标准额度带出来
      </div>
      <div v-for="item in activeSpecials" :key="item.key" class="special-row">
        <span class="special-label">{{ item.label }}</span>
        <span class="special-input-wrap">
          <input
            class="special-input"
            type="text"
            inputmode="decimal"
            :value="specialStr[item.key]"
            @input="onSpecialInput(item.key, $event)"
          />
          <span class="rate-unit">元/月</span>
        </span>
      </div>
      <div v-if="activeSpecials.length" class="sum-row">
        <span>扣除合计</span>
        <strong>¥{{ money(result.specialTotal) }}</strong>
      </div>
    </div>

    <!-- 结果 -->
    <div class="card result-card">
      <div class="net-line">
        <span class="net-label">到手</span>
        <span class="net-value">¥{{ money(result.net) }}</span>
      </div>
      <div class="result-grid">
        <div class="result-item">
          <div class="r-label">税前</div>
          <div class="r-value">¥{{ money(result.gross) }}</div>
        </div>
        <div class="result-item">
          <div class="r-label">五险一金</div>
          <div class="r-value minus">-¥{{ money(result.socialTotal) }}</div>
        </div>
        <div class="result-item">
          <div class="r-label">个税</div>
          <div class="r-value minus">-¥{{ money(result.monthlyTax) }}</div>
        </div>
      </div>
      <div class="calc-note">
        累计应纳税所得额 ¥{{ money(result.cumulative.taxable) }}
        · 适用税率 {{ (result.rate * 100).toFixed(0) }}%
        · 累计应缴 ¥{{ money(result.cumulative.tax) }}
        <template v-if="result.month > 1">
          − 前 {{ result.month - 1 }} 个月已预缴 ¥{{ money(result.priorTax) }}
        </template>
        = 本月个税 ¥{{ money(result.monthlyTax) }}
      </div>
    </div>

    <!-- 入账 -->
    <div class="card">
      <div class="card-title">记入账本</div>
      <div class="form-group">
        <label class="form-label">入账账户</label>
        <select class="form-input" :value="accountId" @change="accountId = Number($event.target.value)">
          <option :value="null">选择账户</option>
          <option v-for="acc in accounts" :key="acc.id" :value="Number(acc.id)">{{ acc.name }}</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">发薪日期</label>
        <input class="form-input" type="date" v-model="payDate" />
      </div>
      <div class="form-group last">
        <label class="form-label">备注</label>
        <input class="form-input" type="text" v-model="note" placeholder="如：11 月工资" />
      </div>
      <button
        class="btn btn-primary record-btn"
        :class="{ disabled: !canRecord || recording }"
        @click="record"
      >{{ recording ? '记录中…' : `记一笔到手 ¥${money(result.net)}` }}</button>
      <div class="field-hint">
        按到手金额记收入，和银行卡实际到账一致；同一笔不要重复记
      </div>
    </div>

    <div class="page-foot">
      年终奖、调薪、补发、股权激励不在计算范围内；累计已预缴按「每月工资不变」推算。
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { getAccounts, getCategories, createCategory, createTransaction } from '../db'
import { todayStr } from '../utils/finance'
import {
  DEFAULT_RATES, SOCIAL_LABEL, SPECIAL_PRESETS, computeSalary, hasResult
} from '../utils/salary'

const PROFILE_KEY = 'bk_salary_profile'
const SOCIAL_KEYS = Object.keys(DEFAULT_RATES)

const accounts = ref([])
const grossStr = ref('')
const baseStr = ref('')
const rateStr = reactive(Object.fromEntries(SOCIAL_KEYS.map(k => [k, String(DEFAULT_RATES[k])])))
const monthIndex = ref(new Date().getMonth() + 1)
const specials = reactive({})
const specialStr = reactive({})
const accountId = ref(null)
const payDate = ref(todayStr())
const note = ref('')
const recording = ref(false)
const toastMsg = ref('')

function money(n) {
  return (Number(n) || 0).toFixed(2)
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2200)
}

// 只留数字与一个小数点，最多 2 位小数（type=number 会吞掉 "12." 这种中间态）
function sanitize(value, maxDec = 2) {
  let v = String(value || '').replace(/[^\d.]/g, '')
  const dot = v.indexOf('.')
  if (dot >= 0) {
    v = v.slice(0, dot) + '.' + v.slice(dot + 1).replace(/\./g, '').slice(0, maxDec)
  }
  return v
}

function onGrossInput(event) {
  const v = sanitize(event.target.value)
  event.target.value = v
  grossStr.value = v
}
function onBaseInput(event) {
  const v = sanitize(event.target.value)
  event.target.value = v
  baseStr.value = v
}
function onRateInput(key, event) {
  const v = sanitize(event.target.value)
  event.target.value = v
  rateStr[key] = v
}
function onSpecialInput(key, event) {
  const v = sanitize(event.target.value)
  event.target.value = v
  specialStr[key] = v
  specials[key] = v === '' ? 0 : Number(v)
}
function onMonthChange(event) {
  monthIndex.value = Number(event.target.value)
}

function toggleSpecial(item) {
  if (specials[item.key]) {
    specials[item.key] = 0
    specialStr[item.key] = ''
    return
  }
  specials[item.key] = item.amount
  specialStr[item.key] = String(item.amount)
}

const activeSpecials = computed(() => SPECIAL_PRESETS.filter(p => specials[p.key]))

const rates = computed(() => {
  const out = {}
  for (const key of SOCIAL_KEYS) out[key] = Number(rateStr[key]) || 0
  return out
})

const result = computed(() => computeSalary({
  gross: grossStr.value,
  monthIndex: monthIndex.value,
  base: baseStr.value === '' ? null : Number(baseStr.value),
  rates: rates.value,
  specials
}))

const canRecord = computed(() =>
  hasResult(result.value) && !!accountId.value && !!payDate.value && result.value.net > 0
)

// ========== 配置持久化 ==========
function loadProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}')
    if (saved.gross !== undefined) grossStr.value = String(saved.gross || '')
    if (saved.base !== undefined) baseStr.value = String(saved.base || '')
    if (saved.rates) {
      for (const key of SOCIAL_KEYS) {
        if (saved.rates[key] !== undefined) rateStr[key] = String(saved.rates[key])
      }
    }
    if (saved.specials && typeof saved.specials === 'object') {
      for (const key of Object.keys(saved.specials)) {
        const value = Number(saved.specials[key]) || 0
        specials[key] = value
        specialStr[key] = value ? String(value) : ''
      }
    }
    if (saved.accountId) accountId.value = Number(saved.accountId)
    if (saved.note) note.value = saved.note
  } catch {
    // 配置损坏就按空白开始，不影响计算
  }
}

function saveProfile() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({
      gross: grossStr.value,
      base: baseStr.value,
      rates: rates.value,
      specials: { ...specials },
      accountId: accountId.value,
      note: note.value
    }))
  } catch {
    // 存储满时忽略
  }
}

// ========== 入账 ==========
async function ensureSalaryCategory() {
  const categories = await getCategories('income')
  const found = categories.find(c => c.name === '工资')
  if (found) return found.id
  await createCategory({ name: '工资', icon: '💰', type: 'income' })
  const refreshed = await getCategories('income')
  return refreshed.find(c => c.name === '工资')?.id || null
}

async function record() {
  if (recording.value) return
  if (!canRecord.value) {
    showToast(!hasResult(result.value) ? '先填税前月薪' : '请选择入账账户')
    return
  }
  recording.value = true
  try {
    const categoryId = await ensureSalaryCategory()
    await createTransaction({
      type: 'income',
      amount: result.value.net,
      category_id: categoryId,
      account_id: accountId.value,
      date: payDate.value,
      note: note.value.trim() || `${result.value.month} 月工资`
    })
    showToast(`已记入 ${money(result.value.net)} 元工资`)
  } catch (e) {
    showToast('入账失败: ' + e.message)
  } finally {
    recording.value = false
  }
}

watch([grossStr, baseStr, rateStr, specials, accountId, note], saveProfile, { deep: true })

onMounted(async () => {
  loadProfile()
  try {
    accounts.value = await getAccounts()
    if (!accountId.value && accounts.value.length === 1) {
      accountId.value = Number(accounts.value[0].id)
    }
  } catch (e) {
    showToast('账户加载失败: ' + e.message)
  }
})
</script>

<style scoped>
.salary-page {
  min-height: 100%;
  padding-bottom: calc(20px + env(safe-area-inset-bottom, 0px));
}
.page-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
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
  padding: 10px 16px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--card);
}

.card {
  margin: 12px 16px;
  padding: 14px;
  background: var(--card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.card .form-group {
  margin-bottom: 12px;
}
.card .form-group.last {
  margin-bottom: 0;
}
.month-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.month-row select {
  width: 110px;
  flex-shrink: 0;
}
.month-hint {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* 五险一金比例行 */
.rate-list {
  margin-top: 4px;
}
.rate-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid #F5F6FA;
}
.rate-label {
  width: 48px;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--text);
}
.rate-input-wrap {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 76px;
  flex-shrink: 0;
}
.rate-input {
  width: 100%;
  min-width: 0;
  text-align: right;
  padding: 4px 6px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}
.rate-unit {
  font-size: 11px;
  color: var(--text-secondary);
}
.rate-value {
  flex: 1;
  text-align: right;
  font-size: 13px;
  color: var(--text-secondary);
}
.sum-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
.sum-row strong {
  font-size: 14px;
  color: var(--text);
}

/* 专项附加扣除 */
.chip-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--bg);
  border: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.chip.active {
  background: var(--primary-light);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}
.special-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
}
.special-label {
  font-size: 13px;
}
.special-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}
.special-input {
  width: 88px;
  text-align: right;
  padding: 5px 8px;
  font-size: 13px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
}

/* 结果卡 */
.result-card {
  background: linear-gradient(140deg, #4A7CF7 0%, #6B9BFF 60%, #7FB0FF 100%);
  box-shadow: 0 8px 20px rgba(74, 124, 247, 0.22);
  color: #fff;
}
.net-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.net-label {
  font-size: 12px;
  opacity: 0.85;
}
.net-value {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.result-grid {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.result-item {
  flex: 1;
  min-width: 0;
  text-align: center;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  padding: 8px 2px;
}
.r-label {
  font-size: 11px;
  opacity: 0.85;
}
.r-value {
  margin-top: 3px;
  /* 320 宽下三个数字各占约 80px，字号必须能从 11px 起缩，否则会被省略号截掉 */
  font-size: clamp(11px, 3.4vw, 14px);
  font-weight: 600;
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.r-value.minus {
  color: #FFD9D9;
}
.calc-note {
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.9;
}

.record-btn {
  width: 100%;
  margin-top: 4px;
}
.record-btn.disabled {
  opacity: 0.45;
}
.page-foot {
  padding: 4px 16px 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-secondary);
}
</style>
