<template>
  <div class="markets-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>行情</span>
      <span class="refresh-btn" :class="{ spinning: refreshing }" @click="refreshAll(true)">⟳</span>
    </div>

    <!-- 黄金 -->
    <div class="gold-card">
      <div class="gold-head">
        <span class="gold-title">🥇 黄金</span>
        <span class="gold-time">{{ gold?.quoteTime || (goldError ? '获取失败' : '加载中…') }}</span>
      </div>
      <template v-if="gold">
        <div class="gold-price">
          ¥{{ fmt(gold.price) }}<span class="unit">/克</span>
        </div>
        <div class="gold-change">
          <span class="chg" :class="changeClass(gold.changePercent)">
            {{ percentText(gold.changePercent) }}
          </span>
          <span class="gold-sub">
            ${{ fmt(gold.usdPerOz) }}/盎司 · 汇率 {{ (Number(gold.usdCny) || 0).toFixed(4) }}
          </span>
        </div>
      </template>
      <div v-else-if="goldError" class="gold-error">{{ goldError }}</div>
      <div v-else class="gold-error">加载中…</div>
    </div>

    <!-- 基金自选 -->
    <div class="section-title">基金自选</div>
    <div class="add-bar">
      <input
        class="form-input"
        type="text"
        inputmode="numeric"
        maxlength="6"
        :value="inputCode"
        placeholder="输入 6 位基金代码，如 161725"
        @input="onCodeInput"
        @keyup.enter="addFund"
      />
      <button class="btn btn-primary add-btn" :disabled="adding" @click="addFund">
        {{ adding ? '添加中' : '添加' }}
      </button>
    </div>

    <div v-if="watchlist.length === 0" class="empty-state">
      <div class="emoji">📈</div>
      <div class="text">添加基金后可查看最新净值与涨跌幅</div>
    </div>

    <div v-for="item in watchlist" :key="item.code" class="fund-item">
      <div class="fund-info">
        <div class="fund-name">{{ quotes[item.code]?.name || item.name }}</div>
        <div class="fund-meta">
          {{ item.code }}
          <template v-if="quotes[item.code]">
            · {{ quotes[item.code].isEstimate ? '估值' : '净值' }}
            {{ quotes[item.code].quoteTime || quotes[item.code].navDate }}
          </template>
          <template v-else-if="errors[item.code]"> · {{ errors[item.code] }}</template>
          <template v-else> · 加载中…</template>
        </div>
      </div>
      <div class="fund-right">
        <div class="fund-price">{{ quotes[item.code] ? fundPrice(quotes[item.code].price) : '--' }}</div>
        <div class="fund-chg" :class="changeClass(quotes[item.code]?.changePercent)">
          {{ quotes[item.code] ? percentText(quotes[item.code].changePercent) : '--' }}
        </div>
      </div>
      <span class="remove-btn" @click="removeFund(item.code)">×</span>
    </div>

    <div class="footnote">
      {{ staleTip || '金价数据来自新浪财经，基金数据来自天天基金，仅供参考，不构成投资建议' }}
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import {
  fetchGoldQuote,
  fetchFundQuote,
  getWatchlist,
  saveWatchlist,
  isValidFundCode
} from '../api/market'

const gold = ref(null)
const goldError = ref('')
const refreshing = ref(false)

const watchlist = ref([])
const quotes = reactive({})
const errors = reactive({})

const inputCode = ref('')
const adding = ref(false)
const toastMsg = ref('')

const staleTip = computed(() => {
  const list = [gold.value, ...Object.values(quotes)]
  return list.some(q => q?.stale) ? '网络不佳，部分数据为上次获取的行情，请点右上角刷新重试' : ''
})

function fmt(n) {
  return (Number(n) || 0).toFixed(2)
}
function fundPrice(n) {
  return (Number(n) || 0).toFixed(4)
}
function percentText(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function changeClass(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return ''
  return Number(n) >= 0 ? 'up' : 'down'
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function loadGold(force = false) {
  try {
    gold.value = await fetchGoldQuote({ force })
    goldError.value = ''
  } catch (e) {
    goldError.value = e.message || '金价获取失败'
  }
}

async function loadFund(code, force = false) {
  try {
    const quote = await fetchFundQuote(code, { force })
    quotes[code] = quote
    errors[code] = ''
    return quote
  } catch (e) {
    errors[code] = e.message || '获取失败'
    return null
  }
}

async function refreshAll(force = false) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([
      loadGold(force),
      ...watchlist.value.map(item => loadFund(item.code, force))
    ])
  } finally {
    refreshing.value = false
  }
}

function onCodeInput(event) {
  const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 6)
  if (event.target.value !== cleaned) event.target.value = cleaned
  inputCode.value = cleaned
}

async function addFund() {
  const code = inputCode.value.trim()
  if (!isValidFundCode(code)) {
    showToast('请输入 6 位基金代码')
    return
  }
  if (watchlist.value.some(item => item.code === code)) {
    showToast('该基金已在自选中')
    return
  }

  adding.value = true
  try {
    const quote = await loadFund(code)
    if (!quote) {
      showToast(errors[code] || '未查询到该基金')
      return
    }
    watchlist.value.unshift({ code, name: quote.name })
    saveWatchlist(watchlist.value)
    inputCode.value = ''
    showToast('已添加自选')
  } finally {
    adding.value = false
  }
}

function removeFund(code) {
  watchlist.value = watchlist.value.filter(item => item.code !== code)
  saveWatchlist(watchlist.value)
  delete quotes[code]
  delete errors[code]
  showToast('已移除')
}

onMounted(() => {
  watchlist.value = getWatchlist()
  // 每次打开页面查询一次，不做定时实时刷新
  refreshAll()
})
</script>

<style scoped>
.markets-page {
  min-height: 100%;
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
.refresh-btn {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}
.refresh-btn.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: translateY(-50%) rotate(360deg); }
}

.gold-card {
  margin: 12px 16px;
  padding: 18px 18px 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, #F8D07B 0%, #E9A93F 100%);
  color: #4A2F00;
  box-shadow: 0 4px 14px rgba(233, 169, 63, 0.3);
}
.gold-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
}
.gold-title {
  font-size: 15px;
  font-weight: 600;
}
.gold-time {
  opacity: 0.7;
  font-size: 12px;
}
.gold-price {
  font-size: 34px;
  font-weight: 700;
  margin: 10px 0 6px;
  letter-spacing: 0.5px;
}
.gold-price .unit {
  font-size: 14px;
  font-weight: 500;
  margin-left: 4px;
  opacity: 0.7;
}
.gold-change {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.gold-change .chg {
  font-size: 15px;
  font-weight: 600;
}
.gold-sub {
  font-size: 12px;
  opacity: 0.75;
}
.gold-error {
  padding: 14px 0 6px;
  font-size: 13px;
  opacity: 0.8;
}

.section-title {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
  padding: 8px 16px 4px;
}

.add-bar {
  display: flex;
  gap: 8px;
  padding: 8px 16px 4px;
}
.add-bar .form-input {
  flex: 1;
}
.add-btn {
  flex-shrink: 0;
  padding: 0 18px;
}
.add-btn:disabled {
  opacity: 0.6;
}

.fund-item {
  display: flex;
  align-items: center;
  padding: 14px 16px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
}
.fund-info {
  flex: 1;
  min-width: 0;
}
.fund-name {
  font-size: 15px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fund-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
}
.fund-right {
  text-align: right;
  margin-left: 10px;
}
.fund-price {
  font-size: 15px;
  font-weight: 600;
}
.fund-chg {
  font-size: 12px;
  font-weight: 500;
  margin-top: 2px;
}
.remove-btn {
  margin-left: 10px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--bg);
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
}

.up { color: var(--danger); }
.down { color: var(--success); }
.gold-card .up { color: #C0392B; }
.gold-card .down { color: #1E7B4D; }

.footnote {
  padding: 20px 24px 24px;
  font-size: 11px;
  color: #B0B7BE;
  text-align: center;
  line-height: 1.6;
}
</style>
