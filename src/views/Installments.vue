<template>
  <div class="installments-page">
    <div class="page-header">
      <span class="back-btn" @click="$router.back()">← 返回</span>
      <span>分期记录</span>
    </div>

    <div v-if="list.length === 0" class="empty-state">
      <div class="emoji">📅</div>
      <div class="text">
        还没有分期，在记账页开启「分期记账」后保存即可生成
      </div>
    </div>

    <div v-for="item in list" :key="item.id" class="installment-card">
      <div class="card-head">
        <span class="head-icon">{{ item.category_icon || '📅' }}</span>
        <div class="head-info">
          <div class="head-title">{{ item.name }}</div>
          <div class="head-sub">
            {{ item.account_name || '未指定账户' }}
            · 开始于 {{ formatDate(item.start_date) }}
          </div>
        </div>
        <div class="head-amount">
          <div class="amount-value">¥{{ fmt(item.total_amount) }}</div>
          <div class="amount-sub">共 {{ item.periods }} 期</div>
        </div>
      </div>

      <div class="progress-row">
        <div class="progress">
          <span :style="{ width: progressPct(item) + '%' }"></span>
        </div>
        <span class="progress-text">{{ item.paid }}/{{ item.periods }} 已到期</span>
      </div>

      <div class="card-foot">
        <span class="per-period">每期约 ¥{{ fmt(perPeriod(item)) }}</span>
        <span class="del-link" @click="askDelete(item)">删除整组</span>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="pendingDelete" class="confirm-dialog" @click.self="pendingDelete = null">
      <div class="confirm-box">
        <div class="msg">
          删除「{{ pendingDelete.name }}」会同时删除该分期已生成的 {{ pendingDelete.generated }} 笔账单，此操作不可撤销。
        </div>
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
import { ref, onMounted } from 'vue'
import { getInstallments, deleteInstallment } from '../db'

const list = ref([])
const pendingDelete = ref(null)
const toastMsg = ref('')

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

function fmt(n) {
  return (Number(n) || 0).toFixed(2)
}
function perPeriod(item) {
  return item.periods ? (Number(item.total_amount) || 0) / item.periods : 0
}
function progressPct(item) {
  const total = Number(item.periods) || 1
  const paid = Math.min(total, Number(item.paid) || 0)
  return Math.round((paid / total) * 100)
}
function formatDate(date) {
  return String(date || '').split(' ')[0]
}

async function loadData() {
  try {
    list.value = await getInstallments()
  } catch (e) {
    showToast('加载失败: ' + e.message)
  }
}

function askDelete(item) {
  pendingDelete.value = item
}

async function doDelete() {
  try {
    await deleteInstallment(pendingDelete.value.id)
    pendingDelete.value = null
    await loadData()
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

onMounted(loadData)
</script>

<style scoped>
.installments-page {
  min-height: 100%;
  padding-bottom: 24px;
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

.installment-card {
  background: var(--card);
  margin: 12px 16px;
  border-radius: var(--radius-md);
  padding: 14px;
  box-shadow: var(--shadow-sm);
}
.card-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.head-icon {
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
.head-info {
  flex: 1;
  min-width: 0;
}
.head-title {
  font-size: 15px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.head-sub {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.head-amount {
  text-align: right;
  flex-shrink: 0;
}
.amount-value {
  font-size: 15px;
  font-weight: 600;
}
.amount-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.progress {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  overflow: hidden;
}
.progress span {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: 3px;
  transition: width 0.3s;
}
.progress-text {
  font-size: 12px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}
.per-period {
  font-size: 12px;
  color: var(--text-secondary);
}
.del-link {
  font-size: 13px;
  color: var(--danger);
  cursor: pointer;
  padding: 4px 6px;
}
</style>
