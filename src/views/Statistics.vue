<template>
  <div class="stats-page">
    <div class="page-header">报表</div>

    <!-- 区间切换 -->
    <div class="range-bar">
      <span
        v-for="preset in presets"
        :key="preset.key"
        class="range-chip"
        :class="{ active: activePreset === preset.key }"
        @click="selectPreset(preset)"
      >{{ preset.label }}</span>
      <span class="range-chip" :class="{ active: activePreset === 'custom' }" @click="activePreset = 'custom'">自定义</span>
    </div>

    <div v-if="activePreset === 'custom'" class="custom-range">
      <input class="form-input" type="date" v-model="customStart" />
      <span class="range-sep">至</span>
      <input class="form-input" type="date" v-model="customEnd" />
    </div>

    <div class="range-hint">{{ range.start }} ~ {{ range.end }}</div>

    <!-- 收支概览 -->
    <div class="summary">
      <div class="summary-item">
        <div class="label">支出</div>
        <div class="value expense">¥{{ fmt(totals.expense) }}</div>
        <div class="delta" :class="deltaClass(compare.expense.diff, true)">
          {{ compareText(compare.expense, true) }}
        </div>
      </div>
      <div class="summary-item">
        <div class="label">收入</div>
        <div class="value income">¥{{ fmt(totals.income) }}</div>
        <div class="delta" :class="deltaClass(compare.income.diff, false)">
          {{ compareText(compare.income, false) }}
        </div>
      </div>
      <div class="summary-item">
        <div class="label">结余</div>
        <div class="value" :class="totals.balance >= 0 ? 'income' : 'expense'">
          ¥{{ fmt(totals.balance) }}
        </div>
        <div class="delta muted">日均支出 ¥{{ fmt(dailyAverage) }}</div>
      </div>
    </div>

    <!-- 自动入账的盈亏会进收支统计，但预算里不算消费，这里点明，避免两边数字对不上 -->
    <div v-if="autoSummary" class="auto-note">
      含自动入账的基金盈亏：收入 ¥{{ fmt(autoSummary.income) }}、支出 ¥{{ fmt(autoSummary.expense) }}，这部分不计入预算
    </div>

    <!-- 异常波动：只在看本月时出现，其他区间没有「上月同期」可比 -->
    <div v-if="spikes.length" class="spike-card">
      <div class="spike-head">
        <span>比上月同期多花了</span>
        <span class="spike-sub">按分类</span>
      </div>
      <div v-for="row in spikes" :key="row.name" class="spike-row">
        <span class="spike-name">{{ row.name }}</span>
        <span class="spike-diff">+¥{{ fmt(row.diff) }}</span>
        <span class="spike-ratio">{{ spikeRatioText(row) }}</span>
      </div>
    </div>

    <!-- 支出趋势 -->
    <div class="card">
      <div class="card-title">
        <span>支出趋势</span>
        <span class="card-sub">{{ trendUnit }}<template v-if="trend.length > 9"> · 左右滑动</template></span>
      </div>
      <BarChart v-if="trend.length" :data="trend" :height="150" />
      <div v-else class="chart-empty">暂无数据</div>
    </div>

    <!-- 支出构成 -->
    <div class="card">
      <div class="card-title">
        <span>支出构成</span>
        <span class="card-sub">按分类</span>
      </div>
      <div v-if="categoryRows.length" class="donut-row">
        <DonutChart :data="categoryRows" :size="130" center-label="支出合计" />
        <div class="legend">
          <div v-for="(row, i) in categoryRows.slice(0, 6)" :key="row.id" class="legend-item">
            <span class="legend-dot" :style="{ background: colorOf(i) }"></span>
            <span class="legend-name">{{ row.icon }} {{ row.name }}</span>
            <span class="legend-pct">{{ percentOf(row.total) }}%</span>
          </div>
        </div>
      </div>
      <div v-else class="chart-empty">暂无支出</div>
    </div>

    <!-- 排行列表 -->
    <div class="card">
      <div class="card-title">
        <span>分类排行</span>
        <span class="card-sub">前 10 项</span>
      </div>
      <div v-if="categoryRows.length === 0" class="chart-empty">暂无数据</div>
      <div v-for="(row, i) in categoryRows.slice(0, 10)" :key="row.id" class="rank-row">
        <span class="rank-index">{{ i + 1 }}</span>
        <span class="rank-icon">{{ row.icon }}</span>
        <div class="rank-info">
          <div class="rank-top">
            <span class="rank-name">{{ row.name }}</span>
            <span class="rank-amount">¥{{ fmt(row.total) }}</span>
          </div>
          <div class="rank-track">
            <div class="rank-fill" :style="{ width: percentOf(row.total) + '%' }"></div>
          </div>
        </div>
        <span class="rank-pct">{{ percentOf(row.total) }}%</span>
      </div>
    </div>

    <!-- 账户排行 -->
    <div class="card">
      <div class="card-title">
        <span>账户支出</span>
        <span class="card-sub">按账户</span>
      </div>
      <div v-if="accountRows.length === 0" class="chart-empty">暂无数据</div>
      <div v-for="(row, i) in accountRows.slice(0, 10)" :key="row.id" class="rank-row">
        <span class="rank-index">{{ i + 1 }}</span>
        <span class="rank-icon">{{ row.icon }}</span>
        <div class="rank-info">
          <div class="rank-top">
            <span class="rank-name">{{ row.name }}</span>
            <span class="rank-amount">¥{{ fmt(row.total) }}</span>
          </div>
          <div class="rank-track">
            <div class="rank-fill account" :style="{ width: accountPercent(row.total) + '%' }"></div>
          </div>
        </div>
        <span class="rank-pct">{{ accountPercent(row.total) }}%</span>
      </div>
    </div>

    <!-- 标签排行 -->
    <div v-if="tagRows.length" class="card">
      <div class="card-title">
        <span>标签支出</span>
        <span class="card-sub">多标签账单会重复计入</span>
      </div>
      <div v-for="(row, i) in tagRows.slice(0, 10)" :key="row.id" class="rank-row">
        <span class="rank-index">{{ i + 1 }}</span>
        <span class="rank-icon">🏷️</span>
        <div class="rank-info">
          <div class="rank-top">
            <span class="rank-name">{{ row.name }}</span>
            <span class="rank-amount">¥{{ fmt(row.total) }}</span>
          </div>
          <div class="rank-track">
            <div class="rank-fill tag" :style="{ width: tagPercent(row.total) + '%' }"></div>
          </div>
        </div>
        <span class="rank-pct">{{ tagPercent(row.total) }}%</span>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import BarChart from '../components/BarChart.vue'
import DonutChart from '../components/DonutChart.vue'
import { getTransactions } from '../db'
import {
  presetRanges, rangeTotals, trendSeries, groupByDimension, compareTotals,
  dayCount, shiftPeriod, todayStr, parseDate, toDateStr, dateOf,
  fmtMoney, fmtPercent, findCategorySpikes
} from '../utils/finance'

const transactions = ref([])
const toastMsg = ref('')
const presets = presetRanges()
const activePreset = ref('thisMonth')
const customStart = ref(shiftPeriod({ start: todayStr(), end: todayStr() }, 'monthly', 0).start)
const customEnd = ref(todayStr())

const range = computed(() => {
  if (activePreset.value === 'custom') {
    return { start: customStart.value || todayStr(), end: customEnd.value || todayStr() }
  }
  return presets.find(p => p.key === activePreset.value)?.range || presets[0].range
})

// 环比区间：与当前区间等长、紧邻的前一段
const previousRange = computed(() => {
  const days = dayCount(range.value)
  const start = parseDate(range.value.start)
  const prevEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1)
  const prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate() - (days - 1))
  return { start: toDateStr(prevStart), end: toDateStr(prevEnd) }
})

const totals = computed(() => rangeTotals(transactions.value, range.value))
const previousTotals = computed(() => rangeTotals(transactions.value, previousRange.value))
const compare = computed(() => compareTotals(totals.value, previousTotals.value))

const trend = computed(() => trendSeries(transactions.value, range.value))
const trendUnit = computed(() => (trend.value.length > 62 ? '按月' : '按天'))

const categoryRows = computed(() => groupByDimension(transactions.value, range.value, 'category', 'expense'))
const accountRows = computed(() => groupByDimension(transactions.value, range.value, 'account', 'expense'))
const tagRows = computed(() => groupByDimension(transactions.value, range.value, 'tag', 'expense'))

const dailyAverage = computed(() => {
  const days = dayCount(range.value)
  return days > 0 ? totals.value.expense / days : 0
})

// 区间内自动生成的盈亏：报表算进去、预算不算，两处口径不同，明确标出来
const autoSummary = computed(() => {
  const { start, end } = range.value
  let income = 0
  let expense = 0
  for (const t of transactions.value) {
    if (!t.auto_source) continue
    const d = dateOf(t)
    if (d < start || d > end) continue
    if (t.type === 'income') income += Number(t.amount) || 0
    else if (t.type === 'expense') expense += Number(t.amount) || 0
  }
  if (!income && !expense) return null
  return { income, expense }
})

// 异常波动只在「本月」视图给：这是唯一有明确"上月同期"参照的区间
const spikes = computed(() =>
  activePreset.value === 'thisMonth' ? findCategorySpikes(transactions.value, { limit: 3 }) : []
)

// 上期没有这个分类时没有基数，说"翻倍"没有意义，直接标新增
function spikeRatioText(row) {
  if (row.ratio === null) return '上期没有'
  return `+${Math.round(row.ratio * 100)}%`
}

function fmt(n) { return fmtMoney(n) }

function percentOf(value) {
  const total = totals.value.expense
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}
function accountPercent(value) {
  const total = accountRows.value.reduce((sum, r) => sum + r.total, 0)
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}
function tagPercent(value) {
  const total = tagRows.value.reduce((sum, r) => sum + r.total, 0)
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}

const PALETTE = [
  '#4A90D9', '#27AE60', '#F5A623', '#E74C3C', '#9B59B6',
  '#16A085', '#E67E22', '#34495E', '#1ABC9C', '#D35400'
]
function colorOf(index) { return PALETTE[index % PALETTE.length] }

function selectPreset(preset) {
  activePreset.value = preset.key
}

// 支出涨了是坏消息用红色，收入涨了是好消息用绿色
function deltaClass(diff, inverse) {
  if (!diff) return 'muted'
  const positive = diff > 0
  return (positive !== inverse) ? 'up-bad' : 'down-good'
}
function compareText(item, inverse) {
  if (item.percent === null) {
    return item.diff === 0 ? '较上期持平' : '上期无数据'
  }
  return `较上期 ${fmtPercent(item.percent)}`
}

onMounted(async () => {
  try {
    transactions.value = await getTransactions()
  } catch (e) {
    toastMsg.value = '加载失败: ' + e.message
    setTimeout(() => { toastMsg.value = '' }, 2000)
  }
})
</script>

<style scoped>
.stats-page {
  min-height: 100%;
  padding-bottom: 16px;
}

/* 区间切换：窄屏自动折行，避免最后一个胶囊被裁掉一半 */
.range-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px 8px;
}
.range-chip {
  flex-shrink: 0;
  padding: 6px 14px;
  border-radius: 16px;
  background: var(--card);
  font-size: 13px;
  color: var(--text-secondary);
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.range-chip.active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 500;
}
.custom-range {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 8px;
}
.custom-range .form-input {
  flex: 1;
  min-width: 0;
  padding: 9px 10px;
  font-size: 13px;
}
.range-sep {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
.range-hint {
  padding: 0 16px 10px;
  font-size: 11px;
  color: var(--text-secondary);
}

/* 概览 */
.summary {
  display: flex;
  gap: 8px;
  padding: 0 16px 4px;
}

/* 自动入账口径说明：弱化的注释行，不抢统计卡的注意力 */
.auto-note {
  margin: 8px 16px 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

/* 异常波动卡片：用警示色边框区分于普通统计卡 */
.spike-card {
  margin: 10px 16px;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--warning-light);
  border: 1px solid #FBE0B0;
}
.spike-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: #A15C00;
  margin-bottom: 8px;
}
.spike-sub {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.7;
}
.spike-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  color: #8A4F00;
}
.spike-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.spike-diff {
  font-weight: 700;
  flex-shrink: 0;
}
.spike-ratio {
  flex-shrink: 0;
  min-width: 52px;
  text-align: right;
  font-size: 11px;
  opacity: 0.75;
}
.summary-item {
  flex: 1;
  min-width: 0;
  background: var(--card);
  border-radius: 14px;
  padding: 13px 8px;
  text-align: center;
  box-shadow: var(--shadow-sm);
}
.summary-item .label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.summary-item .value {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.summary-item .value.expense { color: var(--danger); }
.summary-item .value.income { color: var(--success); }
.summary-item .delta {
  font-size: 10px;
  margin-top: 4px;
}
.delta.up-bad { color: var(--danger); }
.delta.down-good { color: var(--success); }
.delta.muted { color: var(--text-secondary); }

/* 卡片 */
.card {
  background: var(--card);
  border-radius: var(--radius-md);
  margin: 12px 16px;
  padding: 14px;
  box-shadow: var(--shadow-sm);
}
.card-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 12px;
}
.card-sub {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
}
.chart-empty {
  text-align: center;
  padding: 24px 0;
  font-size: 12px;
  color: var(--text-secondary);
}

/* 环形图与图例 */
.donut-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.legend {
  flex: 1;
  min-width: 0;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-bottom: 6px;
}
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.legend-pct {
  color: var(--text-secondary);
  flex-shrink: 0;
}

/* 排行 */
.rank-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}
.rank-index {
  width: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
  text-align: center;
}
.rank-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.rank-info {
  flex: 1;
  min-width: 0;
}
.rank-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.rank-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-amount {
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}
.rank-track {
  height: 4px;
  border-radius: 2px;
  background: var(--bg);
  overflow: hidden;
  margin-top: 5px;
}
.rank-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--primary);
}
.rank-fill.account { background: #27AE60; }
.rank-fill.tag { background: #F5A623; }
.rank-pct {
  width: 44px;
  text-align: right;
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 0;
}
</style>
