<template>
  <div class="settings-page">
    <div class="page-header">设置</div>

    <!-- 帮助 -->
    <div class="section">
      <div class="section-header">帮助</div>

      <div class="setting-item" @click="$router.push('/guide')">
        <span class="setting-icon">📖</span>
        <div class="setting-info">
          <div class="setting-title">操作指南</div>
          <div class="setting-desc">账户余额怎么算、转账怎么记、收益怎么入账等说明</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>
    </div>

    <!-- 数据管理 -->
    <div class="section">
      <div class="section-header">数据管理</div>

      <div class="setting-item" @click="doExport">
        <span class="setting-icon">📤</span>
        <div class="setting-info">
          <div class="setting-title">导出账单</div>
          <div class="setting-desc">将所有数据导出为 JSON 文件，可用于备份或迁移到新手机</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="triggerImport">
        <span class="setting-icon">📥</span>
        <div class="setting-info">
          <div class="setting-title">恢复备份</div>
          <div class="setting-desc">从 JSON 备份文件恢复数据（将覆盖当前数据）</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/import')">
        <span class="setting-icon">🔀</span>
        <div class="setting-info">
          <div class="setting-title">从其他 App 导入</div>
          <div class="setting-desc">从其他记账 App 导出的 CSV 导入流水，追加到现有数据</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <input
        ref="fileInput"
        type="file"
        accept=".json"
        style="display:none"
        @change="handleImport"
      />
    </div>

    <!-- 扩展功能 -->
    <div class="section">
      <div class="section-header">扩展功能</div>

      <div class="setting-item" @click="$router.push('/assistant')">
        <span class="setting-icon">🐢</span>
        <div class="setting-info">
          <div class="setting-title">小乌 · AI 助手</div>
          <div class="setting-desc">用一句话记账，也能问账单问题</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/categories')">
        <span class="setting-icon">📂</span>
        <div class="setting-info">
          <div class="setting-title">分类管理</div>
          <div class="setting-desc">维护支出与收入分类及图标</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/markets')">
        <span class="setting-icon">📈</span>
        <div class="setting-info">
          <div class="setting-title">行情</div>
          <div class="setting-desc">查看金价与基金净值、涨跌幅</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/search')">
        <span class="setting-icon">🔍</span>
        <div class="setting-info">
          <div class="setting-title">搜索筛选</div>
          <div class="setting-desc">按类型、账户、分类、标签、日期和金额组合查询</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/tags')">
        <span class="setting-icon">🏷️</span>
        <div class="setting-info">
          <div class="setting-title">标签管理</div>
          <div class="setting-desc">给账单打多个标签，与分类互相独立</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/installments')">
        <span class="setting-icon">📅</span>
        <div class="setting-info">
          <div class="setting-title">分期记录</div>
          <div class="setting-desc">查看分期进度与已生成期数</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/recurring')">
        <span class="setting-icon">🔁</span>
        <div class="setting-info">
          <div class="setting-title">周期记账</div>
          <div class="setting-desc">房租、工资、还款等固定账单自动生成</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>

      <div class="setting-item" @click="$router.push('/salary')">
        <span class="setting-icon">🧮</span>
        <div class="setting-info">
          <div class="setting-title">工资计算器</div>
          <div class="setting-desc">税前算到手（扣五险一金与个税），算完直接记一笔收入</div>
        </div>
        <span class="arrow-icon">›</span>
      </div>
    </div>

    <!-- 数据统计 -->
    <div class="section">
      <div class="section-header">数据统计</div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">{{ stats.accounts }}</div>
          <div class="stat-label">账户数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.categories }}</div>
          <div class="stat-label">分类数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.transactions }}</div>
          <div class="stat-label">记录数</div>
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-value">{{ stats.tags }}</div>
          <div class="stat-label">标签数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.installments }}</div>
          <div class="stat-label">分期数</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">{{ stats.recurring }}</div>
          <div class="stat-label">周期规则</div>
        </div>
      </div>
    </div>

    <!-- 关于 -->
    <div class="section">
      <div class="section-header">关于</div>
      <div class="about-info">
        <div class="app-name">🍵 乌龙记账</div>
        <div class="app-version">版本 1.20.0</div>
        <div class="app-desc">
          一款简洁的本地记账应用<br/>
          支持转账、信用卡、标签、报销、分期、周期记账、预算、报表、余额宝收益与 AI 助手<br/>
          数据完全存储在您的手机本地<br/>
          通过导出/导入功能实现数据迁移
        </div>
      </div>
    </div>

    <!-- 导入确认 -->
    <div v-if="showImportConfirm" class="confirm-dialog" @click.self="showImportConfirm = false">
      <div class="confirm-box">
        <div class="msg">导入将覆盖当前所有数据（账户、分类、账单记录），此操作不可撤销。确定继续吗？</div>
        <div class="actions">
          <button class="btn btn-outline" @click="showImportConfirm = false">取消</button>
          <button class="btn btn-danger" @click="doImport">确认导入</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { getAccounts, getCategories, getTransactions, exportAllData, importAllData, getTags, getInstallments, getRecurringRules } from '../db'

const fileInput = ref(null)
const showImportConfirm = ref(false)
const pendingImportData = ref(null)
const toastMsg = ref('')

const stats = reactive({ accounts: 0, categories: 0, transactions: 0, tags: 0, installments: 0, recurring: 0 })

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function loadStats() {
  const [a, c, t, g, i, r] = await Promise.all([
    getAccounts(), getCategories(), getTransactions(),
    getTags(), getInstallments(), getRecurringRules()
  ])
  stats.accounts = a.length
  stats.categories = c.length
  stats.transactions = t.length
  stats.tags = g.length
  stats.installments = i.length
  stats.recurring = r.length
}

// ========== 导出 ==========
async function doExport() {
  try {
    const data = await exportAllData()
    const json = JSON.stringify(data, null, 2)
    const date = new Date().toISOString().split('T')[0]
    const filename = `乌龙记账备份_${date}.json`

    if (Capacitor.isNativePlatform()) {
      // writeFile 的 data 默认按 base64 解码，必须显式声明 UTF-8，
      // 否则直接传 JSON 字符串会报 "supplied data is not valid base64 content"
      // 写缓存目录而不是公共 Documents：Android 10+ 写公共目录需要额外权限
      const uri = await Filesystem.writeFile({
        path: filename,
        data: json,
        directory: Directory.Cache,
        encoding: Encoding.UTF8
      })
      await Share.share({
        title: '导出乌龙记账数据',
        text: '乌龙记账备份文件',
        url: uri.uri,
        dialogTitle: '分享备份文件'
      })
      showToast('导出成功')
    } else {
      // 浏览器：下载文件
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      showToast('导出成功')
    }
  } catch (e) {
    const message = e?.message || String(e)
    // 用户在分享面板点了取消，不算失败
    if (/cancel/i.test(message)) {
      showToast('已取消分享')
      return
    }
    showToast('导出失败: ' + message)
  }
}

// ========== 导入 ==========
function triggerImport() {
  fileInput.value?.click()
}

async function handleImport(e) {
  const file = e.target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data.version || !data.accounts || !data.categories || !data.transactions) {
      showToast('无效的备份文件格式')
      return
    }
    pendingImportData.value = data
    showImportConfirm.value = true
  } catch (err) {
    showToast('文件解析失败: ' + err.message)
  }

  // 重置 input
  if (fileInput.value) fileInput.value.value = ''
}

async function doImport() {
  try {
    await importAllData(pendingImportData.value)
    showImportConfirm.value = false
    pendingImportData.value = null
    await loadStats()
    showToast('导入成功')
  } catch (e) {
    showToast('导入失败: ' + e.message)
  }
}

onMounted(loadStats)
</script>

<style scoped>
.settings-page {
  min-height: 100%;
}
.section {
  margin: 12px 16px;
  background: var(--card);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.section-header {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 14px 16px 6px;
  font-weight: 600;
  letter-spacing: 0.3px;
}
.setting-item {
  display: flex;
  align-items: center;
  padding: 13px 16px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.setting-item + .setting-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 64px;
  right: 16px;
  height: 1px;
  background: var(--divider);
}
.setting-item:active { background: #F7F9FC; }
.setting-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--primary-light);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  margin-right: 12px;
  flex-shrink: 0;
}
.setting-info {
  flex: 1;
}
.setting-title {
  font-size: 15px;
  font-weight: 500;
}
.setting-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.arrow-icon {
  font-size: 20px;
  color: #ccc;
  margin-left: 8px;
}

.stats-grid {
  display: flex;
  padding: 8px 16px 14px;
  gap: 10px;
}
.stat-item {
  flex: 1;
  text-align: center;
  background: linear-gradient(180deg, #F9FBFF 0%, #F2F6FD 100%);
  border: 1px solid #EDF2FB;
  border-radius: 12px;
  padding: 13px 8px;
}
.stat-value {
  font-size: 22px;
  font-weight: 700;
  color: var(--primary);
  letter-spacing: -0.5px;
}
.stat-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.about-info {
  padding: 12px 16px 20px;
  text-align: center;
}
.app-name {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 4px;
}
.app-version {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.app-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.8;
}
</style>
