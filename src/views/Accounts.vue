<template>
  <div class="accounts-page">
    <div class="page-header">
      <span class="interest-btn" @click="$router.push('/interest')">💹</span>
      <span>账户管理</span>
      <span class="refresh-btn" :class="{ spinning: loading }" @click="refreshQuotes">⟳</span>
    </div>

    <!-- 资产概览 -->
    <div class="overview">
      <div class="overview-item">
        <div class="label">净资产</div>
        <div class="value">{{ netAssets < 0 ? '-¥' + fmt(Math.abs(netAssets)) : '¥' + fmt(netAssets) }}</div>
      </div>
      <div class="overview-item">
        <div class="label">总负债</div>
        <div class="value">{{ totalDebt > 0 ? '¥' + fmt(totalDebt) : '--' }}</div>
      </div>
      <div class="overview-item">
        <div class="label">投资市值</div>
        <div class="value">{{ investmentAccounts.length ? '¥' + fmt(totalMarketValue) : '--' }}</div>
      </div>
    </div>
    <div v-if="quoteTip || staleTip" class="quote-tip">{{ staleTip || quoteTip }}</div>

    <!-- 账户列表：按类型分区块，每个区块可折叠 -->
    <div v-if="accounts.length === 0" class="empty-state">
      <div class="emoji">💳</div>
      <div class="text">还没有账户，点击下方添加</div>
    </div>

    <template v-for="group in accountGroups" :key="group.type">
      <div class="group-header" @click="toggleGroup(group.type)">
        <span class="group-title">
          {{ group.label }}<span class="group-count">{{ group.items.length }}</span>
        </span>
        <span class="group-right">
          <span class="group-total">{{ groupTotalText(group) }}</span>
          <span class="group-arrow" :class="{ folded: collapsedGroups[group.type] }">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 8.6 1.4 4 2.8 2.6 6 5.8 9.2 2.6 10.6 4z" /></svg>
          </span>
        </span>
      </div>

      <div v-show="!collapsedGroups[group.type]">
        <div
          v-for="acc in group.items"
          :key="acc.id"
          class="list-item"
          :class="{ dragging: draggingId === acc.id }"
          :data-acc-id="acc.id"
          :data-group="group.type"
          @click="openEdit(acc)"
        >
          <div class="icon" :style="{ background: iconBgOf(acc) }">
            <AppIcon :icon="acc.icon" />
          </div>
          <div class="info">
            <div class="title">
              {{ acc.name }}
              <span v-if="acc.type === 'investment'" class="tag">{{ marketLabel(acc) }}</span>
            </div>
            <div class="subtitle">
              <template v-if="acc.type === 'investment'">
                <template v-if="quoteFor(acc)">
                  {{ quotePriceLabel(acc) }} {{ priceText(acc, quoteFor(acc).price) }}
                  <span :class="changeClass(quoteFor(acc).changePercent)">{{ percentText(quoteFor(acc).changePercent) }}</span>
                </template>
                <template v-else-if="quoteErrorFor(acc)">行情获取失败</template>
                <template v-else>行情获取中…</template>
                · 持仓 {{ trimNum(acc.shares) }}{{ acc.market === 'gold' ? '克' : '份' }}
              </template>
              <template v-else-if="isLiabilityType(acc.type)">
                {{ acc.type === 'credit' ? `信用账户 · 账单日 ${acc.bill_day} 号` : '欠款账户' }}
              </template>
              <template v-else>
                普通账户
                <template v-if="acc.interest_code">
                  · <template v-if="moneyQuoteOf(acc)">七日年化 {{ moneyYieldText(acc) }} · 今日 {{ gainText(todayGain(acc)) }}</template>
                  <template v-else-if="moneyErrors[acc.interest_code]">收益获取失败</template>
                  <template v-else>收益获取中…</template>
                </template>
              </template>
            </div>
          </div>
          <div class="amount">
            <div v-if="acc.type === 'investment'">¥{{ fmt(marketValueOf(acc)) }}</div>
            <div v-else-if="isLiabilityType(acc.type)">
              <div :class="{ debt: acc.balance < 0, overpay: acc.balance > 0 }">{{ creditBalanceText(acc) }}</div>
              <div v-if="acc.type === 'credit' && acc.credit_limit > 0" class="credit-avail">可用 ¥{{ fmt(availableCredit(acc)) }}</div>
            </div>
            <div v-else>
              ¥{{ fmt(acc.balance) }}
              <div v-if="acc.interest_code && todayGain(acc) !== null" class="profit gain">
                {{ gainText(todayGain(acc)) }}
              </div>
            </div>
            <div
              v-if="acc.type === 'investment' && Number(acc.cost_price) > 0"
              class="profit"
              :class="changeClass(profitOf(acc))"
            >{{ profitText(profitOf(acc)) }}</div>
          </div>
          <!-- 拖拽手柄：只在同类型区块内上下调顺序，点行其它位置仍是编辑 -->
          <div class="drag-handle" @pointerdown.stop.prevent="startDrag($event, acc)" @click.stop.prevent>
            <svg viewBox="0 0 10 16" aria-hidden="true">
              <circle cx="2.5" cy="3" r="1.3" /><circle cx="7.5" cy="3" r="1.3" />
              <circle cx="2.5" cy="8" r="1.3" /><circle cx="7.5" cy="8" r="1.3" />
              <circle cx="2.5" cy="13" r="1.3" /><circle cx="7.5" cy="13" r="1.3" />
            </svg>
          </div>
        </div>
      </div>
    </template>

    <button class="fab" @click="openAdd">+</button>

    <!-- 添加/编辑弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="closeModal">
      <div class="modal-content">
        <div class="modal-title">{{ editingId ? '编辑账户' : '新建账户' }}</div>

        <div class="modal-body">
        <div class="form-group">
          <label class="form-label">账户类型</label>
          <div class="segmented">
            <div class="seg" :class="{ active: form.type === 'cash' }" @click="form.type = 'cash'">普通</div>
            <div class="seg" :class="{ active: form.type === 'credit' }" @click="form.type = 'credit'">信用</div>
            <div class="seg" :class="{ active: form.type === 'debt' }" @click="form.type = 'debt'">欠款</div>
            <div class="seg" :class="{ active: form.type === 'investment' }" @click="form.type = 'investment'">投资</div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">名称</label>
          <input
            class="form-input"
            v-model="form.name"
            :placeholder="form.type === 'investment' ? '如：黄金积存、白酒基金' : form.type === 'debt' ? '如：借呗、房贷、借朋友的钱' : '如：现金、银行卡'"
          />
        </div>

        <div class="form-group">
          <label class="form-label">图标</label>
          <div v-for="group in iconGroups" :key="group.key" class="icon-group">
            <div class="picker-label">{{ group.label }}</div>
            <div class="icon-grid">
              <div
                v-for="item in group.items"
                :key="item.value"
                class="icon-cell"
                :class="{ selected: form.icon === item.value }"
                @click="form.icon = item.value"
              >
                <span class="cell-icon"><AppIcon :icon="item.value" /></span>
                <span class="cell-label">{{ item.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 投资账户 -->
        <template v-if="form.type === 'investment'">
          <!-- AI 识别持仓截图：一张截图填完代码 / 份额 / 成本价 -->
          <div class="form-group">
            <button class="ai-scan-btn" :disabled="scanning" @click="pickHoldingImage">
              {{ scanning ? '正在识别…' : '📷 AI 识别持仓截图' }}
            </button>
            <div class="field-hint">
              发一张基金或黄金 App 的持仓详情截图，自动识别产品名称、基金代码、持有份额与成本价；识别到已有账户时可一键用它修正持仓
            </div>
            <div v-if="scanTip" class="field-hint scan-tip">{{ scanTip }}</div>
            <!-- 命中了已有账户：直接改那条，避免同一只基金建出两个账户、市值翻倍 -->
            <div v-if="scanMatch" class="scan-match">
              <div class="scan-match-text">
                已有账户「{{ scanMatch.account.name }}」{{ scanMatch.label }}，用这次的识别结果修正它吗？
              </div>
              <div class="scan-match-actions">
                <button class="scan-match-btn ghost" @click="scanMatch = null">忽略</button>
                <button class="scan-match-btn primary" @click="applyScanToExisting">修正这个账户</button>
              </div>
            </div>
            <input
              ref="holdingInput"
              type="file"
              accept="image/*"
              class="hidden-input"
              @change="onHoldingImagePick"
            />
          </div>

          <div class="form-group">
            <label class="form-label">投资品种</label>
            <div class="segmented">
              <div class="seg" :class="{ active: form.market === 'gold' }" @click="form.market = 'gold'">🥇 黄金</div>
              <div class="seg" :class="{ active: form.market === 'fund' }" @click="form.market = 'fund'">📈 基金</div>
            </div>
          </div>

          <div v-if="form.market === 'fund'" class="form-group">
            <label class="form-label">基金代码</label>
            <div class="input-row">
              <input
                class="form-input"
                type="text"
                inputmode="numeric"
                maxlength="6"
                :value="form.symbol"
                placeholder="6 位数字，如 161725"
                @input="onSymbolInput"
              />
              <button
                class="btn btn-outline query-btn"
                :disabled="!isValidFundCode(form.symbol) || querying"
                @click="queryFund"
              >{{ querying ? '查询中' : '查询' }}</button>
            </div>
            <div v-if="formQuote" class="quote-hint">
              {{ formQuote.name }} · {{ formQuote.isEstimate ? '估值' : '净值' }} {{ fmt(formQuote.price) }}
              <span :class="changeClass(formQuote.changePercent)">{{ percentText(formQuote.changePercent) }}</span>
              <span class="quote-time">{{ formQuote.navDate }}</span>
            </div>
            <div v-else-if="quoteError" class="quote-hint error-text">{{ quoteError }}</div>
          </div>

          <div class="form-group">
            <label class="form-label">持有数量（{{ form.market === 'gold' ? '克' : '份' }}）</label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="form.shares"
              placeholder="0"
              @input="onDecimalInput('shares', $event, 4)"
            />
          </div>

          <div class="form-group">
            <label class="form-label">成本单价（元/{{ form.market === 'gold' ? '克' : '份' }}，选填）</label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="form.cost_price"
              placeholder="用于计算盈亏"
              @input="onDecimalInput('cost_price', $event, 4)"
            />
          </div>

          <div v-if="currentMarketPrice" class="form-group">
            <label class="form-label">当前行情</label>
            <div class="live-quote">
              ¥{{ currentPriceText }} / {{ form.market === 'gold' ? '克' : '份' }}
              <span v-if="currentMarketChange !== null" :class="changeClass(currentMarketChange)">
                {{ percentText(currentMarketChange) }}
              </span>
            </div>
          </div>

          <!-- 每日盈亏自动入账 -->
          <div class="form-group">
            <div class="switch-row" @click="form.auto_earn = form.auto_earn ? 0 : 1">
              <div class="switch-info">
                <div class="switch-title">每日盈亏自动记账</div>
                <div class="switch-desc">
                  按逐日净值变动生成一条收益或亏损记录
                </div>
              </div>
              <div class="switch" :class="{ on: form.auto_earn }"><span></span></div>
            </div>
            <div v-if="form.auto_earn" class="field-hint">
              需先填基金代码与持仓份额。打开 App 时自动补齐，重复运行不会重复记。
            </div>
          </div>
        </template>

        <!-- 普通 / 信用账户 -->
        <template v-else>
          <div class="form-group">
            <label class="form-label">{{ isLiabilityType(form.type) ? '当前欠款（为正数，表示已欠金额）' : '期初余额' }}</label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="form.initial_balance"
              placeholder="0.00"
              @input="onDecimalInput('initial_balance', $event, 2)"
            />
            <div class="field-hint">
              当前余额 = 期初 {{ isLiabilityType(form.type) ? '欠款' : '余额' }} + 记账累计，由流水自动计算
            </div>
            <div v-if="editingId" class="adjust-link" @click="openAdjustFromEdit">
              调整账户金额 →
            </div>
          </div>

          <!-- 货币基金计息：余额宝 / 零钱通 -->
          <div v-if="form.type === 'cash'" class="form-group">
            <label class="form-label">余额宝 / 零钱通（选填）</label>
            <div class="chip-row">
              <span
                class="chip"
                :class="{ 'chip-active': !form.interest_code }"
                @click="form.interest_code = ''"
              >不计息</span>
              <span
                v-for="preset in MONEY_FUND_PRESETS"
                :key="preset.code"
                class="chip"
                :class="{ 'chip-active': form.interest_code === preset.code }"
                @click="pickInterest(preset.code)"
              >{{ preset.short }}</span>
            </div>
            <input
              class="form-input interest-input"
              type="text"
              inputmode="numeric"
              maxlength="6"
              :value="form.interest_code"
              placeholder="或填写 6 位货币基金代码"
              @input="onInterestCodeInput"
            />
            <div v-if="form.interest_code" class="field-hint">
              <template v-if="moneyQuotes[form.interest_code]">
                {{ moneyQuotes[form.interest_code].name }} · 每万份收益
                ¥{{ Number(moneyQuotes[form.interest_code].millionIncome).toFixed(4) }}
                · 七日年化 {{ moneyYieldText(form) }}
              </template>
              <template v-else-if="moneyErrors[form.interest_code]">
                {{ moneyErrors[form.interest_code] }}
              </template>
              <template v-else>正在获取收益率…</template>
            </div>

            <!-- 只有选了货币基金，逐日收益才有数据来源 -->
            <div v-if="form.interest_code" class="switch-row auto-earn-row" @click="form.auto_earn = form.auto_earn ? 0 : 1">
              <div class="switch-info">
                <div class="switch-title">每日收益自动入账</div>
                <div class="switch-desc">
                  每天生成一条收入，直接出现在首页流水中，金额可以随时手动改
                </div>
              </div>
              <div class="switch" :class="{ on: form.auto_earn }"><span></span></div>
            </div>
          </div>

          <template v-if="form.type === 'credit'">
            <div class="form-group">
              <label class="form-label">信用额度</label>
              <input
                class="form-input"
                type="text"
                inputmode="decimal"
                :value="form.credit_limit"
                placeholder="如 50000"
                @input="onDecimalInput('credit_limit', $event, 2)"
              />
            </div>
            <div class="form-row">
              <div class="form-group half">
                <label class="form-label">账单日</label>
                <input
                  class="form-input"
                  type="text"
                  inputmode="numeric"
                  :value="form.bill_day"
                  placeholder="1-31"
                  @input="onDayInput('bill_day', $event)"
                />
              </div>
              <div class="form-group half">
                <label class="form-label">还款日</label>
                <input
                  class="form-input"
                  type="text"
                  inputmode="numeric"
                  :value="form.repay_day"
                  placeholder="1-31"
                  @input="onDayInput('repay_day', $event)"
                />
              </div>
            </div>
          </template>
        </template>

        </div>

        <div class="modal-actions">
          <button v-if="editingId" class="btn btn-danger" @click="confirmDel = true">删除</button>
          <button class="btn btn-primary" @click="save">{{ editingId ? '保存' : '添加' }}</button>
        </div>
      </div>
    </div>

    <!-- 调整余额 -->
    <div v-if="showAdjust && adjustAccount" class="modal-overlay" @click.self="closeAdjust">
      <div class="modal-content">
        <div class="modal-title">调整{{ isLiabilityType(adjustAccount.type) ? '欠款' : '余额' }}</div>

        <div class="modal-body">
          <div class="adjust-summary">
            <span class="adjust-acc"><AppIcon :icon="adjustAccount.icon" /> {{ adjustAccount.name }}</span>
            <span class="adjust-now">
              {{ adjustCurrentLabel }}
              <strong>¥{{ fmt(adjustCurrent) }}</strong>
            </span>
          </div>

          <div class="form-group">
            <label class="form-label">
              调整为{{ isLiabilityType(adjustAccount.type) ? '欠款' : '余额' }}
            </label>
            <input
              class="form-input"
              type="text"
              inputmode="decimal"
              :value="adjustTarget"
              placeholder="0.00"
              @input="onAdjustInput"
            />
            <div class="field-hint" :class="{ 'diff-up': adjustDiff > 0, 'diff-down': adjustDiff < 0 }">
              {{ adjustDiffText }}
            </div>
          </div>

          <div class="section-title">选择处理方式</div>

          <div class="mode-card" @click="doAdjust('offset')">
            <div class="mode-main">
              <div class="mode-title">直接校准</div>
              <div class="mode-desc">
                只改期初{{ isLiabilityType(adjustAccount.type) ? '欠款' : '余额' }}，不产生任何账单，收支统计、报表、预算全部不变
              </div>
            </div>
            <span class="mode-arrow">›</span>
          </div>

          <div class="mode-card" @click="doAdjust('bill')">
            <div class="mode-main">
              <div class="mode-title">记为账单（错漏修正）</div>
              <div class="mode-desc">
                生成一笔「账目调整」{{ adjustBillType === 'income' ? '收入' : '支出' }}，计入收支统计，可以在流水中查到并追溯
              </div>
            </div>
            <span class="mode-arrow">›</span>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn btn-outline" @click="closeAdjust">取消</button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="confirmDel" class="confirm-dialog" @click.self="confirmDel = false">
      <div class="confirm-box">
        <div class="msg">删除账户后，相关交易记录不会被删除；用到这个账户的周期记账规则会自动停用，需要你重新指定账户。确定继续吗？</div>
        <div class="actions">
          <button class="btn btn-outline" @click="confirmDel = false">取消</button>
          <button class="btn btn-danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { getAccounts, createAccount, updateAccount, deleteAccount, saveAccountOrder, createTransaction, getCategories, createCategory } from '../db'
import { fetchGoldQuote, fetchFundQuote, fetchMoneyFundQuote, isValidFundCode, MONEY_FUND_PRESETS } from '../api/market'
import { chatComplete, AI_MODEL, DEFAULT_BASE_URL } from '../api/ai'
import { buildHoldingScanPrompt, parseHoldingScan, extractJson } from '../utils/aiAssistant'
import { fileToImagePayload } from '../utils/imageInput'
import { dailyInterest, todayStr } from '../utils/finance'
import { ICON_GROUPS, getBrandIcon } from '../utils/icons'
import AppIcon from '../components/AppIcon.vue'

const accounts = ref([])
const showModal = ref(false)
const editingId = ref(null)
const confirmDel = ref(false)
const toastMsg = ref('')
// 余额校准
const showAdjust = ref(false)
const adjustAccount = ref(null)
const adjustTarget = ref('')
const adjusting = ref(false)

const loading = ref(false)
const goldQuote = ref(null)
const goldError = ref('')
const fundQuotes = reactive({})
const fundErrors = reactive({})

const querying = ref(false)
const formQuote = ref(null)
const quoteError = ref('')
// 持仓截图 AI 识别
const holdingInput = ref(null)
const scanning = ref(false)
const scanTip = ref('')
// 最近一次识别结果 + 命中的已有账户（命中时给「修正这个账户」入口）
const lastScan = ref(null)
const scanMatch = ref(null)
// 货币基金收益率缓存，key = 6 位基金代码
const moneyQuotes = reactive({})
const moneyErrors = reactive({})

const iconGroups = ICON_GROUPS

// 品牌图标自带品牌色底，外层容器不再叠加浅色背景
function iconBgOf(acc) {
  if (getBrandIcon(acc.icon)) return 'transparent'
  if (acc.type === 'investment') return 'var(--success-light)'
  // 欠款账户是负债，用红色底和普通账户区分开
  if (acc.type === 'debt') return 'var(--danger-light)'
  return 'var(--primary-light)'
}

const form = reactive({
  name: '',
  icon: '💰',
  type: 'cash',
  market: 'gold',
  symbol: '',
  shares: '',
  cost_price: '',
  initial_balance: '',
  credit_limit: '',
  bill_day: '1',
  repay_day: '1',
  interest_code: '',
  auto_earn: 0
})

const investmentAccounts = computed(() => accounts.value.filter(a => a.type === 'investment'))

// 账户按类型分区块展示，每个区块可单独折叠
// 欠款账户排在信用账户后面：两者都是负债，但欠款账户没有额度/账单日
const ACCOUNT_TYPE_ORDER = ['cash', 'credit', 'debt', 'investment']
const ACCOUNT_TYPE_LABELS = { cash: '普通账户', credit: '信用账户', debt: '欠款账户', investment: '投资账户' }
const collapsedGroups = reactive({})

const accountGroups = computed(() => ACCOUNT_TYPE_ORDER
  .map(type => ({
    type,
    label: ACCOUNT_TYPE_LABELS[type],
    items: accounts.value.filter(a => (a.type || 'cash') === type)
  }))
  .filter(group => group.items.length > 0))

function toggleGroup(type) {
  collapsedGroups[type] = !collapsedGroups[type]
}

// 信用账户与欠款账户都是负债口径：界面填欠款正数，数据里存负数
function isLiabilityType(type) {
  return type === 'credit' || type === 'debt'
}

// 区块小计：普通账户看余额、信用和欠款看欠款、投资看市值
function groupTotalText(group) {
  if (isLiabilityType(group.type)) {
    const debt = group.items.reduce((sum, a) => sum + Math.max(0, -(Number(a.balance) || 0)), 0)
    return debt > 0 ? `欠款 ¥${fmt(debt)}` : '无欠款'
  }
  if (group.type === 'investment') {
    return `市值 ¥${fmt(group.items.reduce((sum, a) => sum + marketValueOf(a), 0))}`
  }
  return `¥${fmt(group.items.reduce((sum, a) => sum + (Number(a.balance) || 0), 0))}`
}

// ========== 同类型内拖拽排序 ==========
// 只允许在同一个类型区块内上下换位：跨类型拖动会破坏「按类型分区块」的前提。
// 用 pointer 事件同时覆盖触摸与鼠标，手柄上加 touch-action:none 避免拖着拖着页面滚动。
const draggingId = ref(null)
let dragGroup = ''
let dragStartY = 0
let dragMoved = false
// 起手时的区块顺序快照：拖出去又拖回原位时据此判断「其实没变」，不白写一次库
let dragOrderBefore = ''
// 拖完浏览器还会补一个 click，不加拦截会把编辑弹窗弹出来
let suppressClickUntil = 0

// 某类型区块的当前顺序，形如 "1,2,3"
function groupOrderKey(type) {
  return accounts.value
    .filter(a => (a.type || 'cash') === type)
    .map(a => Number(a.id))
    .join(',')
}

function startDrag(event, acc) {
  draggingId.value = Number(acc.id)
  dragGroup = acc.type || 'cash'
  dragStartY = event.clientY
  dragMoved = false
  dragOrderBefore = groupOrderKey(dragGroup)
  window.addEventListener('pointermove', onDragMove, { passive: false })
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)
}

function onDragMove(event) {
  if (draggingId.value == null) return
  event.preventDefault()
  if (Math.abs(event.clientY - dragStartY) > 3) dragMoved = true

  const rows = [...document.querySelectorAll(`.list-item[data-group="${dragGroup}"]`)]
  if (rows.length < 2) return
  const others = rows.filter(el => Number(el.dataset.accId) !== draggingId.value)
  // 指针落到某行上半区就插到它前面，落到所有行下半区之后则排到末尾
  let targetIdx = others.length
  for (let i = 0; i < others.length; i++) {
    const rect = others[i].getBoundingClientRect()
    if (event.clientY < rect.top + rect.height / 2) {
      targetIdx = i
      break
    }
  }
  moveWithinGroup(dragGroup, draggingId.value, targetIdx)
}

// 把 id 挪到该区块的第 targetIdx 位，其它类型账户的位置完全不动
function moveWithinGroup(type, id, targetIdx) {
  const groupAccounts = accounts.value.filter(a => (a.type || 'cash') === type)
  const from = groupAccounts.findIndex(a => Number(a.id) === Number(id))
  if (from < 0) return
  const rest = groupAccounts.filter((_, index) => index !== from)
  const target = Math.max(0, Math.min(rest.length, targetIdx))
  if (target === from) return
  const nextGroup = [...rest.slice(0, target), groupAccounts[from], ...rest.slice(target)]

  const positions = []
  accounts.value.forEach((a, i) => {
    if ((a.type || 'cash') === type) positions.push(i)
  })
  const next = [...accounts.value]
  positions.forEach((pos, i) => { next[pos] = nextGroup[i] })
  accounts.value = next
}

async function endDrag() {
  window.removeEventListener('pointermove', onDragMove)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', endDrag)
  const moved = dragMoved
  const changed = !!dragGroup && groupOrderKey(dragGroup) !== dragOrderBefore
  draggingId.value = null
  dragGroup = ''
  dragMoved = false
  dragOrderBefore = ''
  if (!moved) return
  suppressClickUntil = Date.now() + 320
  // 拖出去又拖回原位：顺序没变就不用落库
  if (!changed) return
  try {
    await saveAccountOrder(accounts.value.map(a => Number(a.id)))
    showToast('顺序已保存')
  } catch (e) {
    showToast('保存顺序失败: ' + e.message)
  }
}

const totalMarketValue = computed(() =>
  investmentAccounts.value.reduce((sum, acc) => sum + marketValueOf(acc), 0)
)
const totalProfit = computed(() =>
  investmentAccounts.value.reduce((sum, acc) => sum + profitOf(acc), 0)
)
// 信用账户和欠款账户余额为负表示欠款，负债取正值
const totalDebt = computed(() =>
  accounts.value
    .filter(a => isLiabilityType(a.type))
    .reduce((sum, a) => sum + Math.max(0, -(Number(a.balance) || 0)), 0)
)
const netAssets = computed(() =>
  accounts.value.reduce((sum, acc) => sum + assetValue(acc), 0)
)

const quoteTip = computed(() => {
  const q = goldQuote.value
  if (!q) return ''
  const time = q.quoteTime || ''
  return `金价 ${fmt(q.price)} 元/克${time ? ' · ' + time : ''}`
})
const staleTip = computed(() => {
  const list = [goldQuote.value, ...Object.values(fundQuotes)]
  return list.some(q => q?.stale) ? '行情更新失败，已按上次获取的价格计算市值' : ''
})

const currentMarketPrice = computed(() => {
  if (form.market === 'gold') return goldQuote.value?.price ?? null
  return formQuote.value?.price ?? null
})
const currentPriceText = computed(() => {
  const price = currentMarketPrice.value
  if (price === null) return '--'
  return form.market === 'fund' ? Number(price).toFixed(4) : fmt(price)
})
const currentMarketChange = computed(() => {
  if (form.market === 'gold') return goldQuote.value?.changePercent ?? null
  return formQuote.value?.changePercent ?? null
})

// ========== 格式化 ==========
function fmt(n) {
  return (Number(n) || 0).toFixed(2)
}
function priceText(acc, price) {
  return acc.market === 'fund' ? (Number(price) || 0).toFixed(4) : fmt(price)
}
function trimNum(n) {
  const v = Number(n) || 0
  return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(4)))
}
function percentText(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '--'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}
function profitText(n) {
  const v = Number(n) || 0
  return `${v >= 0 ? '+' : '-'}¥${Math.abs(v).toFixed(2)}`
}
function changeClass(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return ''
  return Number(n) >= 0 ? 'up' : 'down'
}
function marketLabel(acc) {
  if (acc.market === 'gold') return '黄金'
  if (acc.market === 'fund') return '基金'
  return '投资'
}

// ========== 账户与行情计算 ==========
function quoteFor(acc) {
  if (acc.type !== 'investment') return null
  if (acc.market === 'gold') return goldQuote.value
  if (acc.market === 'fund') return fundQuotes[acc.symbol] || null
  return null
}
function quoteErrorFor(acc) {
  if (acc.type !== 'investment') return ''
  if (acc.market === 'gold') return goldError.value
  return fundErrors[acc.symbol] || ''
}
function quotePriceLabel(acc) {
  const q = quoteFor(acc)
  if (!q) return ''
  if (acc.market === 'gold') return '现价'
  return q.isEstimate ? '估值' : '净值'
}
function assetValue(acc) {
  if (acc.type === 'investment') return marketValueOf(acc)
  return Number(acc.balance) || 0
}
// 可用额度 = 信用额度 - 欠款 + 溢缴款
function availableCredit(acc) {
  const limit = Number(acc.credit_limit) || 0
  const value = Number(acc.balance) || 0
  const debt = Math.max(0, -value)
  const overpay = Math.max(0, value)
  return limit - debt + overpay
}
// 信用账户/欠款账户 balance 为负是欠款，为正说明多还了钱（溢缴款）
function creditBalanceText(acc) {
  const value = Number(acc.balance) || 0
  if (value < 0) return `欠款 ¥${fmt(-value)}`
  if (value > 0) return acc.type === 'credit' ? `溢缴 ¥${fmt(value)}` : `多还 ¥${fmt(value)}`
  return '¥0.00'
}

// ========== 余额校准 ==========
// 信用/欠款账户 balance 为负表示欠款，界面上统一显示成欠款正数
const adjustCurrent = computed(() => {
  const acc = adjustAccount.value
  if (!acc) return 0
  const value = Number(acc.balance) || 0
  return isLiabilityType(acc.type) ? -value : value
})
const adjustCurrentLabel = computed(() => {
  const acc = adjustAccount.value
  if (!acc || !isLiabilityType(acc.type)) return '账面余额'
  if ((Number(acc.balance) || 0) <= 0) return '账面欠款'
  return acc.type === 'credit' ? '账面溢缴' : '账面多还'
})
const adjustDiff = computed(() => {
  const acc = adjustAccount.value
  if (!acc) return 0
  const target = Number(adjustTarget.value) || 0
  return target - adjustCurrent.value
})
const adjustDiffText = computed(() => {
  const diff = adjustDiff.value
  if (Math.abs(diff) < 0.005) return '金额与账面一致，无需调整'
  return `与账面差额 ${diff > 0 ? '+' : '-'}¥${Math.abs(diff).toFixed(2)}`
})

// 账单方向要按转换后的余额差判断：负债账户的界面值方向与余额方向相反
const adjustBillType = computed(() => {
  const acc = adjustAccount.value
  if (!acc) return 'expense'
  const target = Number(adjustTarget.value) || 0
  const targetBalance = isLiabilityType(acc.type) ? -target : target
  const diff = targetBalance - (Number(acc.balance) || 0)
  return diff > 0 ? 'income' : 'expense'
})

function openAdjustFromEdit() {
  const acc = accounts.value.find(a => Number(a.id) === Number(editingId.value))
  if (!acc) return
  closeModal()
  openAdjust(acc)
}

function openAdjust(acc) {
  adjustAccount.value = acc
  const current = isLiabilityType(acc.type)
    ? -(Number(acc.balance) || 0)
    : (Number(acc.balance) || 0)
  adjustTarget.value = Math.abs(current) < 0.005 ? '' : trimNum(current)
  showAdjust.value = true
}

function closeAdjust() {
  showAdjust.value = false
  adjustAccount.value = null
  adjustTarget.value = ''
}

function onAdjustInput(event) {
  let cleaned = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  if (dot >= 0) {
    cleaned = `${cleaned.slice(0, dot)}.${cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 2)}`
  }
  if (event.target.value !== cleaned) event.target.value = cleaned
  adjustTarget.value = cleaned
}

// 「账目调整」分类按收支方向各建一个，方便在报表里单独看到校准痕迹
async function ensureAdjustCategory(type) {
  const categories = await getCategories(type)
  const found = categories.find(c => c.name === '账目调整')
  if (found) return found.id
  await createCategory({ name: '账目调整', icon: '⚖️', type })
  const refreshed = await getCategories(type)
  return refreshed.find(c => c.name === '账目调整')?.id || null
}

async function doAdjust(mode) {
  const acc = adjustAccount.value
  if (!acc || adjusting.value) return
  const target = Number(adjustTarget.value)
  if (!adjustTarget.value || !Number.isFinite(target)) {
    showToast('请输入调整后的金额')
    return
  }

  // 信用/欠款账户界面填的是欠款正数，换算成 balance 要取负
  const targetBalance = isLiabilityType(acc.type) ? -target : target
  const diff = targetBalance - (Number(acc.balance) || 0)
  if (Math.abs(diff) < 0.005) {
    showToast('金额没有变化')
    return
  }

  adjusting.value = true
  try {
    if (mode === 'offset') {
      // 直接校准：把差额并进期初余额，不产生流水，统计口径完全不动
      await updateAccount({
        ...acc,
        initial_balance: (Number(acc.initial_balance) || 0) + diff
      })
      showToast('已校准，未计入账单')
    } else {
      const type = diff > 0 ? 'income' : 'expense'
      const categoryId = await ensureAdjustCategory(type)
      await createTransaction({
        type,
        amount: Math.round(Math.abs(diff) * 100) / 100,
        category_id: categoryId,
        account_id: acc.id,
        note: '余额校准',
        date: todayStr()
      })
      showToast('已生成账目调整账单')
    }
    closeAdjust()
    await loadData()
    await loadQuotes()
  } catch (e) {
    showToast('调整失败: ' + e.message)
  } finally {
    adjusting.value = false
  }
}

// ========== 货币基金计息 ==========
function moneyQuoteOf(acc) {
  if (!acc.interest_code) return null
  return moneyQuotes[acc.interest_code] || null
}
// 今日预估收益 = 当前余额 / 10000 × 当日每万份收益
function todayGain(acc) {
  const quote = moneyQuoteOf(acc)
  if (!quote) return null
  return dailyInterest(acc.balance, quote.millionIncome)
}
function moneyYieldText(acc) {
  const quote = moneyQuoteOf(acc)
  if (!quote || quote.sevenDayYield === null || quote.sevenDayYield === undefined) return '--'
  return Number(quote.sevenDayYield).toFixed(3) + '%'
}
function gainText(value) {
  if (value === null || value === undefined) return ''
  const v = Number(value) || 0
  if (v > 0 && v < 0.01) return '+<0.01'
  return (v >= 0 ? '+' : '-') + Math.abs(v).toFixed(2)
}
function onInterestCodeInput(event) {
  const prev = form.interest_code
  const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 6)
  if (event.target.value !== cleaned) event.target.value = cleaned
  form.interest_code = cleaned
  // 代码刚填满 6 位就默认打开每日入账，省得用户再去找开关
  if (prev.length < 6 && cleaned.length === 6) form.auto_earn = 1
  if (cleaned.length === 6 && !moneyQuotes[cleaned]) loadMoneyQuote(cleaned)
}
// 选中预置的余额宝 / 零钱通：默认就打开每日自动入账，不需要用户再找一个开关
function pickInterest(code) {
  form.interest_code = code
  form.auto_earn = 1
  if (!moneyQuotes[code]) loadMoneyQuote(code)
}
function marketValueOf(acc) {
  const shares = Number(acc.shares) || 0
  const quote = quoteFor(acc)
  const price = quote?.price || Number(acc.cost_price) || 0
  return shares * price
}
function profitOf(acc) {
  const cost = Number(acc.cost_price) || 0
  const shares = Number(acc.shares) || 0
  if (!cost || !shares) return 0
  const quote = quoteFor(acc)
  const price = quote?.price || cost
  return (price - cost) * shares
}

// ========== 行情加载 ==========
async function loadGoldQuote(force = false) {
  try {
    goldQuote.value = await fetchGoldQuote({ force })
    goldError.value = ''
  } catch (e) {
    goldError.value = e.message
  }
}
async function loadFundQuote(code, force = false) {
  try {
    const quote = await fetchFundQuote(code, { force })
    fundQuotes[code] = quote
    fundErrors[code] = ''
    return quote
  } catch (e) {
    fundErrors[code] = e.message
    return null
  }
}
async function loadMoneyQuote(code, force = false) {
  try {
    moneyQuotes[code] = await fetchMoneyFundQuote(code, { force })
    moneyErrors[code] = ''
  } catch (e) {
    moneyErrors[code] = e.message
  }
}
async function loadQuotes(force = false) {
  const codes = [...new Set(
    investmentAccounts.value
      .filter(a => a.market === 'fund' && isValidFundCode(a.symbol))
      .map(a => a.symbol)
  )]
  // 计息账户对应的货币基金也要一起刷新
  const moneyCodes = [...new Set(
    accounts.value
      .map(a => a.interest_code)
      .filter(code => isValidFundCode(code))
  )]
  await Promise.all([
    loadGoldQuote(force),
    ...codes.map(code => loadFundQuote(code, force)),
    ...moneyCodes.map(code => loadMoneyQuote(code, force))
  ])
}
async function refreshQuotes() {
  if (loading.value) return
  loading.value = true
  try {
    await loadQuotes(true)
    showToast('行情已更新')
  } finally {
    loading.value = false
  }
}

// ========== 数字输入（避免 type=number 吞掉小数点） ==========
function sanitizeDecimal(value, maxDecimals) {
  let s = String(value ?? '').replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  if (dot >= 0) {
    const intPart = s.slice(0, dot).slice(0, 9)
    const decPart = s.slice(dot + 1).replace(/\./g, '').slice(0, maxDecimals)
    s = `${intPart}.${decPart}`
  } else {
    s = s.slice(0, 9)
  }
  return s
}
function onDecimalInput(field, event, maxDecimals = 2) {
  const cleaned = sanitizeDecimal(event.target.value, maxDecimals)
  if (event.target.value !== cleaned) event.target.value = cleaned
  form[field] = cleaned
}
function onSymbolInput(event) {
  const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 6)
  if (event.target.value !== cleaned) event.target.value = cleaned
  form.symbol = cleaned
  formQuote.value = null
  quoteError.value = ''
}
// 账单日/还款日：只允许 1-31
function onDayInput(field, event) {
  let cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 2)
  if (cleaned && Number(cleaned) > 31) cleaned = '31'
  if (cleaned === '0') cleaned = '1'
  if (event.target.value !== cleaned) event.target.value = cleaned
  form[field] = cleaned
}

async function queryFund() {
  if (!isValidFundCode(form.symbol)) {
    quoteError.value = '基金代码需为 6 位数字'
    return
  }
  querying.value = true
  quoteError.value = ''
  try {
    formQuote.value = await loadFundQuote(form.symbol)
    if (!formQuote.value) quoteError.value = fundErrors[form.symbol] || '未查询到该基金'
    else if (!form.name.trim()) form.name = formQuote.value.name
  } finally {
    querying.value = false
  }
}

// ========== AI 识别持仓截图 ==========
// 复用「小乌」助手里存好的 Key 与接口地址，不另设一套配置
function aiConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('bk_ai_settings') || '{}')
    return {
      apiKey: String(saved.apiKey || '').trim(),
      baseUrl: String(saved.baseUrl || DEFAULT_BASE_URL).trim()
    }
  } catch {
    return { apiKey: '', baseUrl: DEFAULT_BASE_URL }
  }
}

function pickHoldingImage() {
  if (scanning.value) return
  if (!aiConfig().apiKey) {
    showToast('请先在「小乌」助手里填写 API Key')
    return
  }
  holdingInput.value?.click()
}

async function onHoldingImagePick(event) {
  const file = event.target.files?.[0]
  // 清空 value，否则连续选同一张图不会再触发 change
  event.target.value = ''
  if (!file) return
  const { apiKey, baseUrl } = aiConfig()
  if (!apiKey) {
    showToast('请先在「小乌」助手里填写 API Key')
    return
  }

  scanning.value = true
  scanTip.value = '正在识别截图…'
  try {
    const { dataUrl } = await fileToImagePayload(file)
    const res = await chatComplete({
      apiKey,
      baseUrl,
      model: AI_MODEL,
      jsonMode: true,
      temperature: 0,
      maxTokens: 400,
      timeout: 60000,
      messages: [
        { role: 'system', content: buildHoldingScanPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: '识别这张持仓截图：产品名称、基金代码、持有份额、持仓成本价。' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ]
    })
    const parsed = parseHoldingScan(extractJson(res.content))
    if (!parsed) {
      scanTip.value = '没识别出持仓信息，换一张更清晰的截图试试'
      return
    }
    applyHoldingScan(parsed)
  } catch (e) {
    scanTip.value = '识别失败：' + e.message
  } finally {
    scanning.value = false
  }
}

function applyHoldingScan(data) {
  lastScan.value = data
  fillFormFromScan(data)

  const summary = scanSummaryText(data)
  // 同一只基金/黄金往往早就建过账户：识别完顺手匹配，让用户一键改成最新持仓，
  // 否则很容易再建一个账户，市值被算成两份
  const hit = findHoldingMatch(data)
  const isEditingHit = hit && Number(hit.account.id) === Number(editingId.value)
  if (hit && !isEditingHit) {
    scanMatch.value = hit
    scanTip.value = `${summary}。已存在账户「${hit.account.name}」${hit.label}`
  } else {
    scanMatch.value = null
    scanTip.value = isEditingHit
      ? `${summary}，「${hit.account.name}」的持仓已按截图更新，核对后点保存`
      : `${summary}，核对后再保存`
  }
  // 代码可用就顺手拉一次净值：能看到名字对得上，才说明代码没认错
  if (data.market === 'fund' && isValidFundCode(form.symbol)) queryFund()
}

// 只把识别出的档案字段填进表单，不碰账户名/图标这类用户自己定的东西
function fillFormFromScan(data, { keepName = false } = {}) {
  form.market = data.market
  if (!keepName && data.name) form.name = data.name
  // 黄金没有基金代码，切到黄金时要把原来那只基金的代码清掉
  if (data.market === 'fund') {
    if (data.symbol) form.symbol = data.symbol
  } else {
    form.symbol = ''
  }
  if (data.shares > 0) form.shares = trimNum(data.shares)
  if (data.cost_price > 0) form.cost_price = trimNum(data.cost_price)
  formQuote.value = null
  quoteError.value = ''
}

function scanSummaryText(data) {
  const filled = []
  if (data.name) filled.push(`「${data.name}」`)
  if (data.symbol) filled.push(`代码 ${data.symbol}`)
  if (data.shares > 0) filled.push(`份额 ${trimNum(data.shares)}`)
  if (data.cost_price > 0) filled.push(`成本价 ${trimNum(data.cost_price)}`)
  const amount = data.amount > 0 ? `，市值约 ¥${fmt(data.amount)}` : ''
  if (!filled.length) return '没识别出可用字段，换一张更清晰的截图试试'
  return `已识别 ${filled.join(' · ')}${amount}`
}

// 同名/同基金代码比对：先认代码（最准），没有再按产品名宽松比对
function findHoldingMatch(data) {
  const pool = accounts.value.filter(a => a.type === 'investment')
  if (data.market === 'fund' && data.symbol) {
    const byCode = pool.find(a => a.market !== 'gold' && String(a.symbol || '') === data.symbol)
    if (byCode) return { account: byCode, label: `（基金代码 ${data.symbol}）` }
  }
  const name = normalizeProductName(data.name)
  if (!name) return null
  const byName = pool.find(a => {
    if ((a.market || 'gold') !== data.market) return false
    const own = normalizeProductName(a.name)
    if (!own) return false
    if (own === name) return true
    // 短名包含关系误判率高（"白酒基金" 能命中一堆），只在足够长时才认
    return own.length >= 4 && name.length >= 4 && (own.includes(name) || name.includes(own))
  })
  return byName ? { account: byName, label: '（产品名称相同）' } : null
}

function normalizeProductName(value) {
  return String(value || '').replace(/\s/g, '').toUpperCase()
}

// 用识别结果修正已存在的账户：账户名与图标保持用户自己设的那份
function applyScanToExisting() {
  const hit = scanMatch.value
  const data = lastScan.value
  if (!hit || !data) return
  scanMatch.value = null
  openEdit(hit.account)
  fillFormFromScan(data, { keepName: true })
  scanTip.value = `已把识别结果填入「${hit.account.name}」，核对后点保存`
  if (data.market === 'fund' && isValidFundCode(form.symbol)) queryFund()
}

// ========== 弹窗 ==========
function resetForm() {
  form.name = ''
  form.icon = '💰'
  form.type = 'cash'
  form.market = 'gold'
  form.symbol = ''
  form.shares = ''
  form.cost_price = ''
  form.initial_balance = ''
  form.credit_limit = ''
  form.bill_day = '1'
  form.repay_day = '1'
  form.interest_code = ''
  // 新建投资账户默认不自动记盈亏；普通账户一旦选了货币基金就会被打开
  form.auto_earn = 0
  formQuote.value = null
  quoteError.value = ''
  scanTip.value = ''
  scanMatch.value = null
  lastScan.value = null
  editingId.value = null
}
function openAdd() {
  resetForm()
  showModal.value = true
  if (!goldQuote.value) loadGoldQuote()
}
function openEdit(acc) {
  // 刚拖拽完浏览器会补发 click，这里挡一下，别顺手弹出编辑框
  if (Date.now() < suppressClickUntil) return
  editingId.value = acc.id
  form.name = acc.name
  form.icon = acc.icon || '💰'
  form.type = acc.type || 'cash'
  form.market = acc.market || 'gold'
  form.symbol = acc.symbol || ''
  form.shares = acc.shares ? trimNum(acc.shares) : ''
  form.cost_price = acc.cost_price ? trimNum(acc.cost_price) : ''
  // 信用/欠款账户对用户展示欠款正数，存储层统一用负数；
  // 回填时必须取绝对值，否则再保存一次会「负负得正」把欠款变成资产
  form.initial_balance = acc.initial_balance
    ? trimNum(isLiabilityType(acc.type) ? Math.abs(acc.initial_balance) : acc.initial_balance)
    : ''
  form.credit_limit = acc.credit_limit ? trimNum(acc.credit_limit) : ''
  form.bill_day = String(acc.bill_day || 1)
  form.repay_day = String(acc.repay_day || 1)
  form.interest_code = acc.interest_code || ''
  form.auto_earn = Number(acc.auto_earn) ? 1 : 0
  // 打开编辑时若收益率还没缓存，顺手拉一次
  if (form.interest_code && !moneyQuotes[form.interest_code]) loadMoneyQuote(form.interest_code)
  formQuote.value = acc.type === 'investment' && acc.market === 'fund'
    ? fundQuotes[acc.symbol] || null
    : null
  quoteError.value = ''
  scanTip.value = ''
  scanMatch.value = null
  showModal.value = true
}
function closeModal() {
  showModal.value = false
  resetForm()
}

function showToast(msg) {
  toastMsg.value = msg
  setTimeout(() => { toastMsg.value = '' }, 2000)
}

async function loadData() {
  accounts.value = await getAccounts()
}

async function save() {
  if (!form.name.trim()) {
    showToast('请输入账户名称')
    return
  }
  if (form.type === 'investment') {
    if (form.market === 'fund' && !isValidFundCode(form.symbol)) {
      showToast('请输入 6 位基金代码')
      return
    }
    if (!(Number(form.shares) > 0)) {
      showToast('请输入持有数量')
      return
    }
  }

  const wasEditing = !!editingId.value
  const rawInitial = Number(form.initial_balance) || 0
  const payload = {
    name: form.name.trim(),
    icon: form.icon,
    type: form.type,
    market: form.type === 'investment' ? form.market : '',
    symbol: form.type === 'investment' && form.market === 'fund' ? form.symbol : '',
    shares: form.type === 'investment' ? Number(form.shares) || 0 : 0,
    cost_price: form.type === 'investment' ? Number(form.cost_price) || 0 : 0,
    // 信用/欠款账户：界面填欠款正数，存入时转为负数
    initial_balance: form.type === 'investment'
      ? 0
      : (isLiabilityType(form.type) ? -rawInitial : rawInitial),
    // 额度只有信用卡有，欠款账户没有额度概念
    credit_limit: form.type === 'credit' ? Number(form.credit_limit) || 0 : 0,
    bill_day: Number(form.bill_day) || 1,
    repay_day: Number(form.repay_day) || 1,
    // 计息只对普通账户开放，投资账户走净值、信用账户是负债
    interest_code: form.type === 'cash' ? form.interest_code : '',
    // 投资账户看净值、计息账户看万份收益，两者之外没有自动入账的数据源
    auto_earn: form.auto_earn && (form.type === 'investment' || (form.type === 'cash' && form.interest_code))
      ? 1 : 0
  }

  try {
    if (editingId.value) await updateAccount({ ...payload, id: editingId.value })
    else await createAccount(payload)
    closeModal()
    await loadData()
    await loadQuotes()
    showToast(wasEditing ? '修改成功' : '添加成功')
  } catch (e) {
    showToast('操作失败: ' + e.message)
  }
}

async function doDelete() {
  try {
    await deleteAccount(editingId.value)
    confirmDel.value = false
    closeModal()
    await loadData()
    showToast('已删除')
  } catch (e) {
    showToast('删除失败: ' + e.message)
  }
}

watch(() => form.market, (market) => {
  formQuote.value = null
  quoteError.value = ''
  if (showModal.value && market === 'gold' && !goldQuote.value) loadGoldQuote()
})

onMounted(async () => {
  await loadData()
  await loadQuotes()
})
</script>

<style scoped>
.accounts-page {
  min-height: 100%;
  position: relative;
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
.interest-btn {
  position: absolute;
  left: 14px;
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

.overview {
  display: flex;
  gap: 8px;
  padding: 14px 16px;
  background: var(--card);
}
.overview-item {
  flex: 1;
  text-align: center;
  background: linear-gradient(180deg, #F9FBFF 0%, #F2F6FD 100%);
  border: 1px solid #EDF2FB;
  border-radius: 12px;
  padding: 11px 6px;
}
.overview-item .label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.overview-item .value {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: -0.3px;
}
.quote-tip {
  padding: 0 16px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--card);
}

.list-item .info .title {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* 账户按类型分区块：标题行可点击折叠，右侧显示该区块小计 */
.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px 6px;
  background: var(--bg);
  font-size: 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.group-title {
  font-weight: 500;
}
.group-count {
  margin-left: 4px;
}
.group-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.group-total {
  font-size: 11px;
  color: var(--text-tertiary);
}
.group-arrow {
  display: flex;
  transition: transform 0.2s;
}
.group-arrow svg {
  display: block;
  width: 12px;
  height: 12px;
  fill: currentColor;
}
.group-arrow.folded {
  transform: rotate(-90deg);
}

/* 拖拽排序：手柄 + 拖动中的高亮 */
.drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  align-self: stretch;
  margin-left: 2px;
  color: var(--text-tertiary);
  cursor: grab;
  /* 触摸拖动时不要把页面一起滚走 */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.drag-handle svg {
  display: block;
  width: 10px;
  height: 16px;
  fill: currentColor;
}
.drag-handle:active {
  cursor: grabbing;
}
.list-item.dragging {
  background: var(--primary-light);
  box-shadow: 0 6px 16px rgba(74, 124, 247, 0.18);
  border-radius: 12px;
  position: relative;
  z-index: 4;
}
.list-item.dragging .drag-handle {
  color: var(--primary);
}
.tag {
  font-size: 10px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--success-light);
  color: var(--success);
}
.amount {
  text-align: right;
}
.amount .profit {
  font-size: 12px;
  font-weight: 500;
  margin-top: 2px;
}
.amount .debt {
  color: var(--danger);
}
.amount .overpay {
  color: var(--success);
}
/* 可用额度放在金额下方，避免副标题被截断 */
.amount .credit-avail {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-secondary);
  margin-top: 3px;
}
.amount .gain {
  color: var(--success);
}

/* 标签选择 chips */
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  padding: 6px 12px;
  border-radius: 16px;
  background: var(--bg);
  font-size: 12px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.chip-active {
  border-color: var(--primary);
  background: var(--primary-light);
  color: var(--primary);
}
.interest-input {
  margin-top: 8px;
  padding: 9px 12px;
  font-size: 14px;
}
.up { color: var(--danger); }
.down { color: var(--success); }

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
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s;
}
.segmented .seg.active {
  background: var(--primary);
  color: #fff;
}

.input-row {
  display: flex;
  gap: 8px;
}
.query-btn {
  flex-shrink: 0;
  padding: 0 16px;
}
.query-btn:disabled {
  opacity: 0.5;
}
.quote-hint {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}
.quote-hint .quote-time {
  margin-left: 6px;
  color: #aaa;
}
.error-text {
  color: var(--danger);
}
.live-quote {
  font-size: 15px;
  font-weight: 600;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--bg);
}
.live-quote span {
  font-size: 13px;
  margin-left: 6px;
}

/* 字段说明与并排表单 */
.field-hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
  line-height: 1.5;
}

/* 自动入账开关 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}
.auto-earn-row {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--divider);
}
.switch-info {
  flex: 1;
  min-width: 0;
}
.switch-title {
  font-size: 14px;
  font-weight: 500;
}
.switch-desc {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
  line-height: 1.5;
}
.switch {
  width: 46px;
  height: 26px;
  border-radius: 13px;
  background: #D8DDE3;
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
.switch.on {
  background: var(--primary);
}
.switch.on span {
  transform: translateX(20px);
}
.field-hint.diff-up { color: var(--success); }
.field-hint.diff-down { color: var(--danger); }

/* 余额校准 */
.adjust-link {
  margin-top: 8px;
  font-size: 12px;
  color: var(--primary);
  cursor: pointer;
  padding: 2px 0;
}
.adjust-summary {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 0 16px 12px;
  font-size: 13px;
  color: var(--text-secondary);
}
.adjust-acc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.adjust-now {
  flex-shrink: 0;
}
.adjust-now strong {
  color: var(--text);
  font-size: 15px;
  margin-left: 4px;
}
.section-title {
  font-size: 13px;
  color: var(--text-secondary);
  padding: 4px 16px 8px;
  font-weight: 500;
}
.mode-card {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 10px;
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.mode-card:active {
  background: var(--bg);
}
.mode-main {
  flex: 1;
  min-width: 0;
}
.mode-title {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 3px;
}
.mode-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}
.mode-arrow {
  font-size: 18px;
  color: #ccc;
  flex-shrink: 0;
}
.form-row {
  display: flex;
  gap: 8px;
}
.form-group.half {
  flex: 1;
  min-width: 0;
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
.modal-actions .btn {
  flex: 1;
}
/* 弹窗中部独立滚动，操作按钮始终固定在底部 */
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
  /* 桌面端滚动条占 15px 会把内容压偏，两侧对称预留保证网格居中 */
  scrollbar-gutter: stable both-edges;
  scrollbar-width: thin;
}

/* 图标选择器：图标 + 文字描述，窄屏 4 列、宽屏 5 列 */
.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(48px, 1fr));
  gap: 8px;
}
.picker-label {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 12px 0 6px;
}
.icon-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding: 6px 2px 5px;
  border-radius: 10px;
  background: var(--bg);
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
}
.icon-cell.selected {
  border-color: var(--primary);
  background: var(--primary-light);
}
/* 固定高度让 emoji 与品牌 logo 两种尺寸在同一行基线对齐 */
.cell-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  font-size: 20px;
}
.cell-label {
  max-width: 100%;
  font-size: 10px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.icon-cell.selected .cell-label {
  color: var(--primary);
  font-weight: 500;
}

/* AI 识别持仓截图 */
.ai-scan-btn {
  width: 100%;
  padding: 11px 12px;
  border: 1px dashed var(--primary);
  border-radius: var(--radius-md);
  background: var(--primary-light);
  color: var(--primary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
  touch-action: manipulation;
}
.ai-scan-btn:active {
  opacity: 0.75;
}
.ai-scan-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.scan-tip {
  color: var(--primary);
}
/* 命中已有账户时的修正引导 */
.scan-match {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--warning-light);
  border: 1px solid #FBE0B0;
}
.scan-match-text {
  font-size: 12px;
  line-height: 1.6;
  color: #A15C00;
}
.scan-match-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.scan-match-btn {
  flex: 1;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid transparent;
  cursor: pointer;
  touch-action: manipulation;
}
.scan-match-btn.ghost {
  background: var(--card);
  border-color: #EBCB96;
  color: #A15C00;
}
.scan-match-btn.primary {
  background: var(--primary);
  color: #fff;
}
.hidden-input {
  display: none;
}
</style>
