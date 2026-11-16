<template>
  <div class="interest-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>余额宝 / 零钱通收益</span>
    </div>

    <div class="page-tip">
      按每日每万份收益 × 当日账户余额逐日累加，余额取自账本流水，非实际到账金额。
      开启自动入账的账户每天已自动生成一条收入记入首页流水，这里只做核对与明细查看。
    </div>

    <div v-if="loading" class="empty-state">
      <div class="text">加载中…</div>
    </div>

    <div v-else-if="items.length === 0" class="empty-state">
      <div class="emoji">💹</div>
      <div class="text">
        还没有开启计息的账户<br/>
        去「账户」里编辑一个普通账户，选择余额宝或零钱通对应的货币基金
      </div>
    </div>

    <div v-for="item in items" :key="item.account.id" class="acc-card">
      <div class="card-head">
        <span class="acc-icon"><AppIcon :icon="item.account.icon" /></span>
        <div class="acc-info">
          <div class="acc-title">{{ item.account.name }}</div>
          <div class="acc-sub">
            <template v-if="item.quote">
              {{ item.quote.name }} · 七日年化 {{ item.quote.sevenDayYieldText }}
            </template>
            <template v-else-if="item.error">收益获取失败：{{ item.error }}</template>
            <template v-else>收益获取中…</template>
          </div>
        </div>
        <div class="acc-amount">
          <div class="balance">¥{{ fmt(item.account.balance) }}</div>
          <div class="today" :class="{ zero: !item.todayGain }">
            今日 {{ item.todayGain > 0 ? '+' + fmtGain(item.todayGain) : '--' }}
          </div>
        </div>
      </div>

      <div class="metrics-label">累计收益（含已入账部分）</div>
      <div class="metrics">
        <div class="metric">
          <div class="m-label">本月</div>
          <div class="m-value">¥{{ fmtGain(item.monthTotal) }}</div>
        </div>
        <div class="metric">
          <div class="m-label">近 7 天</div>
          <div class="m-value">¥{{ fmtGain(item.weekTotal) }}</div>
        </div>
        <div class="metric">
          <div class="m-label">近 30 天</div>
          <div class="m-value">¥{{ fmtGain(item.month30Total) }}</div>
        </div>
      </div>

      <div class="settle-row">
        <!-- 开了自动入账的账户每天已经记过，这里不能再手动补一笔 -->
        <template v-if="item.account.auto_earn">
          <div class="settle-info">
            <div class="settle-label">已开启自动入账</div>
            <div class="settle-value auto-on">每天自动记入首页流水</div>
          </div>
          <button class="btn btn-primary settle-btn" disabled>自动记账中</button>
        </template>

        <template v-else>
          <div class="settle-info">
            <div class="settle-label">待入账 {{ item.pendingRangeText }}</div>
            <div class="settle-value">¥{{ fmtGain(item.pendingTotal) }}</div>
          </div>
          <button
            class="btn btn-primary settle-btn"
            :disabled="item.settling || item.pendingTotal < 0.01"
            @click="settle(item)"
          >{{ item.settling ? '处理中' : '记入账本' }}</button>
        </template>
      </div>

      <div class="expand-row" @click="toggle(item.account.id)">
        <span>{{ expandedId === item.account.id ? '收起明细' : '查看逐日明细' }}</span>
        <span class="chevron">{{ expandedId === item.account.id ? '⌃' : '⌄' }}</span>
      </div>

      <div v-if="expandedId === item.account.id" class="daily-list">
        <div v-if="item.monthRows.length === 0" class="daily-empty">
          本月还没有可计算的收益日
        </div>
        <div v-for="row in item.monthRows.slice().reverse()" :key="row.date" class="daily-row">
          <span class="d-date">{{ row.date.slice(5) }}</span>
          <span class="d-balance">余额 {{ fmt(row.balance) }}</span>
          <span class="d-income">万份 {{ Number(row.millionIncome).toFixed(4) }}</span>
          <span class="d-gain">+{{ fmtGain(row.gain) }}</span>
        </div>
        <div v-if="item.monthRows.length" class="daily-foot">
          本月共 {{ item.monthRows.length }} 天计息，合计 ¥{{ fmtGain(item.monthTotal) }}
        </div>
      </div>
    </div>

    <div v-if="!loading && items.length" class="disclaimer">
      说明：份额确认 T+1、日复利等因素未计入，估算与实际到账可能有 1%~2% 的差异。
      入账后可到「首页」核对，如需修正直接编辑那笔收入即可。
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { getAccounts, getTransactions, getCategories, createCategory, createTransaction, updateAccount } from '../db'
import { fetchMoneyFundQuote, fetchMoneyFundHistory } from '../api/market'
import AppIcon from '../components/AppIcon.vue'
import {
  todayStr, periodRange, parseDate, toDateStr, nextDayStr,
  accrueInterest, dailyInterest, fmtMoney
} from '../utils/finance'

const items = ref([])
const loading = ref(true)
const expandedId = ref(null)
const toastMsg = ref('')

function fmt(n) { return fmtMoney(n) }
function fmtGain(n) {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return '<0.01'
  return v.toFixed(2)
}
function shiftDays(dateStr, days) {
  const d = parseDate(dateStr)
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days))
}
function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2200)
}
function toggle(id) {
  expandedId.value = expandedId.value === id ? null : id
}

async function loadData() {
  loading.value = true
  try {
    const [accounts, transactions] = await Promise.all([getAccounts(), getTransactions()])
    const interestAccounts = accounts.filter(a => a.interest_code && a.type === 'cash')
    const today = todayStr()
    const monthRange = { start: periodRange(today, 'monthly').start, end: today }
    const weekRange = { start: shiftDays(today, -6), end: today }
    const month30Range = { start: shiftDays(today, -29), end: today }

    const result = []
    for (const account of interestAccounts) {
      let quote = null
      let history = []
      let error = ''
      try {
        quote = await fetchMoneyFundQuote(account.interest_code)
        history = await fetchMoneyFundHistory(account.interest_code, { days: 40 })
      } catch (e) {
        error = e.message
      }

      const base = { account, transactions, history }
      const month = accrueInterest({ ...base, startDate: monthRange.start, endDate: monthRange.end })
      const week = accrueInterest({ ...base, startDate: weekRange.start, endDate: weekRange.end })
      const month30 = accrueInterest({ ...base, startDate: month30Range.start, endDate: month30Range.end })

      // 待入账区间：上次入账日的次日 → 今天；从未入账则从本月初算起
      const settled = account.interest_settled_date || ''
      const pendingStart = settled ? nextDayStr(settled) : monthRange.start
      const pending = pendingStart <= today
        ? accrueInterest({ ...base, startDate: pendingStart, endDate: today })
        : { total: 0, rows: [] }
      // 区间右端取最后一天真实有收益数据的日期，今日万份收益通常次日才公布
      const lastPendingRow = pending.rows[pending.rows.length - 1]
      const pendingRangeText = lastPendingRow
        ? `${pending.rows[0].date.slice(5)} ~ ${lastPendingRow.date.slice(5)}`
        : (settled === today ? '今天已入账' : '今日收益待公布')

      result.push({
        account,
        quote: quote ? {
          ...quote,
          sevenDayYieldText: quote.sevenDayYield === null || quote.sevenDayYield === undefined
            ? '--'
            : Number(quote.sevenDayYield).toFixed(3) + '%'
        } : null,
        error,
        todayGain: quote ? dailyInterest(account.balance, quote.millionIncome) : 0,
        monthTotal: month.total,
        monthRows: month.rows,
        weekTotal: week.total,
        month30Total: month30.total,
        pendingTotal: pending.total,
        pendingRows: pending.rows,
        pendingRangeText,
        settling: false
      })
    }
    items.value = result
  } catch (e) {
    showToast('加载失败: ' + e.message)
  } finally {
    loading.value = false
  }
}

// 找到或创建「投资收益」收入分类
// 与自动入账用同一个分类名，否则手动一笔、自动一笔会各占一个分类，报表里分成两行
async function ensureInterestCategory() {
  const categories = await getCategories('income')
  const found = categories.find(c => c.name === '投资收益') ||
    categories.find(c => c.name === '理财收益')
  if (found) return found.id
  await createCategory({ name: '投资收益', icon: '📈', type: 'income' })
  const refreshed = await getCategories('income')
  return refreshed.find(c => c.name === '投资收益')?.id || null
}

async function settle(item) {
  const amount = Math.round((Number(item.pendingTotal) || 0) * 100) / 100
  if (amount < 0.01) {
    showToast('暂无可入账收益')
    return
  }
  const lastDate = item.pendingRows.length
    ? item.pendingRows[item.pendingRows.length - 1].date
    : todayStr()

  item.settling = true
  try {
    const categoryId = await ensureInterestCategory()
    await createTransaction({
      type: 'income',
      amount,
      category_id: categoryId,
      account_id: item.account.id,
      note: `${item.quote?.name || '货币基金'}收益 ${item.pendingRangeText}`,
      date: todayStr()
    })
    // 记录入账截止日，避免下次重复计算同一段收益
    await updateAccount({
      ...item.account,
      interest_settled_date: lastDate
    })
    showToast(`已记入 ${amount.toFixed(2)} 元收益`)
    await loadData()
  } catch (e) {
    showToast('入账失败: ' + e.message)
  } finally {
    item.settling = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.interest-page {
  min-height: 100%;
  padding-bottom: 20px;
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

.acc-card {
  margin: 12px 16px;
  background: var(--card);
  border-radius: var(--radius-lg);
  padding: 14px;
  box-shadow: var(--shadow-sm);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.acc-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.acc-info {
  flex: 1;
  min-width: 0;
}
.acc-title {
  font-size: 15px;
  font-weight: 500;
}
.acc-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.acc-amount {
  text-align: right;
  flex-shrink: 0;
}
.acc-amount .balance {
  font-size: 15px;
  font-weight: 600;
}
.acc-amount .today {
  font-size: 11px;
  color: var(--success);
  margin-top: 2px;
}
.acc-amount .today.zero {
  color: var(--text-secondary);
}

.metrics-label {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-secondary);
}
.metrics {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.metric {
  flex: 1;
  text-align: center;
  background: var(--bg);
  border-radius: 10px;
  padding: 9px 4px;
}
.m-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.m-value {
  font-size: 14px;
  font-weight: 600;
  color: var(--success);
}

.settle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border);
}
.settle-label {
  font-size: 11px;
  color: var(--text-secondary);
}
.settle-value {
  font-size: 17px;
  font-weight: 700;
  color: var(--text);
  margin-top: 2px;
}
/* 自动入账状态用弱化的存在感，避免和待入账金额抢视线 */
.settle-value.auto-on {
  font-size: 13px;
  font-weight: 500;
  color: var(--success);
}
.settle-btn {
  flex-shrink: 0;
  padding: 9px 16px;
  font-size: 13px;
}
.settle-btn:disabled {
  opacity: 0.45;
}

.expand-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
}
.chevron {
  font-size: 12px;
}

.daily-list {
  margin-top: 6px;
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
.daily-empty {
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  padding: 10px 0;
}
.daily-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  font-size: 11px;
  color: var(--text-secondary);
  border-bottom: 1px solid #F5F6FA;
}
.d-date {
  width: 42px;
  flex-shrink: 0;
  color: var(--text);
}
.d-balance {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.d-income {
  flex-shrink: 0;
}
.d-gain {
  width: 52px;
  text-align: right;
  flex-shrink: 0;
  color: var(--success);
  font-weight: 500;
}
.daily-foot {
  padding-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  text-align: right;
}

.disclaimer {
  margin: 4px 16px 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--text-secondary);
}
</style>
