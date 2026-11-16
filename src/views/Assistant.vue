<template>
  <div class="assistant-page">
    <!-- 顶栏 -->
    <div class="ai-header">
      <span class="nav-btn" @click="$router.back()">←</span>
      <div class="brand">
        <TurtleAvatar :size="30" :src="settings.avatar" />
        <span>小乌</span>
      </div>
      <span class="nav-btn" @click="showSettings = true">⚙</span>
    </div>

    <!-- 未填 Key：直接给配置引导，不让人先猜为什么发不出消息 -->
    <div v-if="!hasKey" class="onboard">
      <TurtleAvatar :size="96" :src="settings.avatar" />
      <div class="onboard-title">先接上 DeepSeek</div>
      <div class="onboard-text">
        小乌的脑子来自 DeepSeek，需要你自己填一个 API Key。
        在 platform.deepseek.com 注册后创建密钥，粘贴进来即可。
        密钥只存在这台手机的本地，不会进备份文件。
      </div>
      <div class="onboard-btn" @click="showSettings = true">去填写</div>
      <div class="onboard-note">填好后可以说「昨天吃面 28」，让小乌帮你记下来</div>
    </div>

    <!-- 对话区 -->
    <div v-else ref="chatBody" class="chat-body">
      <!-- 开场白 -->
      <div class="msg assistant">
        <TurtleAvatar :size="34" :src="settings.avatar" />
        <div class="bubble">
          <div class="bubble-text">我是小乌。想记账就直接说，比如「昨天吃面 28」；想看看钱花哪了也可以问我。</div>
          <div class="quick-row">
            <span
              v-for="p in QUICK_PROMPTS"
              :key="p.label"
              class="quick-chip"
              @click="fillPrompt(p.text)"
            >{{ p.label }}</span>
          </div>
        </div>
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- 用户 -->
        <div v-if="msg.role === 'user'" class="msg user">
          <div class="bubble user-bubble">
            <img v-if="msg.image" :src="msg.image" class="msg-image" alt="账单截图" />
            <!-- 恢复的历史记录不带图片本体，只留一个占位，避免 localStorage 被 base64 撑爆 -->
            <div v-else-if="msg.hasImage" class="msg-image-lost">📷 图片（历史记录不保存图片）</div>
            <div v-if="msg.text">{{ msg.text }}</div>
          </div>
        </div>

        <!-- 助手 -->
        <div v-else-if="msg.role === 'assistant'" class="msg assistant">
          <TurtleAvatar :size="34" :src="settings.avatar" />
          <!-- 气泡和确认卡分开排：卡片要占满整行宽度，
               塞进 78% 宽的窄气泡里标题会被压到只剩十几个像素 -->
          <div class="msg-content">
            <div class="bubble">
              <div class="bubble-text">{{ msg.text }}</div>

              <!-- 记账确认卡：模型只负责解析，落库前必须人点头 -->
              <div v-if="msg.records && msg.records.length" class="record-box">
                <div v-for="(r, i) in msg.records" :key="i" class="record-row">
                  <div class="record-head">
                    <span class="type-tag" :class="r.type">{{ typeLabel(r.type) }}</span>
                    <input
                      class="amount-input"
                      type="text"
                      inputmode="decimal"
                      :value="r.amount || ''"
                      placeholder="0.00"
                      @input="onAmountInput(r, $event)"
                    />
                    <span class="yuan">元</span>
                  </div>

                  <div class="record-fields">
                    <select v-if="r.type !== 'transfer'" v-model.number="r.category_id">
                      <option :value="null">选择分类</option>
                      <option v-for="c in categoriesOf(r.type)" :key="c.id" :value="Number(c.id)">
                        {{ c.icon }} {{ c.name }}
                      </option>
                    </select>

                    <select v-model.number="r.account_id">
                      <option :value="null">选择账户</option>
                      <option v-for="a in accounts" :key="a.id" :value="Number(a.id)">
                        {{ a.name }}
                      </option>
                    </select>
                  </div>

                  <!-- 转账必须指定转入账户，否则这笔钱等于凭空消失 -->
                  <div v-if="r.type === 'transfer'" class="record-fields">
                    <select v-model.number="r.to_account_id">
                      <option :value="null">转入账户</option>
                      <option v-for="a in accounts" :key="a.id" :value="Number(a.id)">
                        {{ a.name }}
                      </option>
                    </select>
                  </div>

                  <div class="record-foot">
                    <input class="date-input" type="date" v-model="r.date" />
                    <input class="note-input" type="text" v-model="r.note" placeholder="备注" />
                  </div>
                </div>

                <div v-if="msg.confirmed" class="confirmed-tip">✓ 已记入账本</div>
                <div v-else class="record-actions">
                  <span class="btn-ghost" @click="msg.records = []">不要了</span>
                  <span
                    class="btn-primary"
                    :class="{ disabled: !allReady(msg) }"
                    @click="confirmRecords(msg)"
                  >记入账本</span>
                </div>
              </div>
            </div>

            <!-- 配置类操作确认卡：一句里有多个操作时，每项一张独立的卡 -->
            <div v-if="msg.skillCards && msg.skillCards.length" class="skill-box">
              <!-- 汇总头：让人一眼知道一共几项、还剩几项没确认 -->
              <div class="skill-summary">
                <span>共 {{ msg.skillCards.length }} 项</span>
                <span v-if="pendingCount(msg) > 0" class="pending-tag">
                  待确认 {{ pendingCount(msg) }}
                </span>
                <span v-else class="all-done-tag">全部处理完</span>
              </div>

              <div
                v-for="(card, ci) in msg.skillCards"
                :key="ci"
                class="skill-card"
                :class="[`kind-${card.draft.kind}`, { done: card.done, open: !cardCollapsed(card) }]"
              >
                <!-- 标题行：点击折叠展开；每张卡左侧有色条，类型一眼可分 -->
                <div class="skill-head" :class="{ locked: card.done }" @click="toggleCard(card)">
                  <span class="skill-badge">{{ card.label }}</span>
                  <span class="skill-title">{{ cardTitle(card) }}</span>
                  <span v-if="card.done" class="skill-done">✓ 已保存</span>
                  <span v-else-if="msg.skillCards.length > 1" class="skill-index">
                    {{ ci + 1 }}/{{ msg.skillCards.length }}
                  </span>
                  <span v-if="!card.done" class="chevron">
                    {{ cardCollapsed(card) ? '›' : '⌄' }}
                  </span>
                </div>

                <!-- 已保存的卡不允许再编辑：展开就能再点保存，会重复建一条 -->
                <div v-if="card.done" class="skill-locked-tip">
                  已保存到{{ cardTargetPage(card) }}，要修改请去那里
                </div>

                <div v-if="!cardCollapsed(card)" class="skill-body">
                  <div class="skill-mode-line">
                    {{ modeLine(card) }}
                  </div>

                  <div v-for="f in card.fields" :key="f.key">
                    <div v-if="fieldVisible(f, card.draft)" class="skill-field">
                      <label class="skill-label">
                        {{ f.label }}<span v-if="f.unit" class="unit">（{{ f.unit }}）</span>
                        <span v-if="f.optional" class="opt">选填</span>
                      </label>

                      <select
                        v-if="f.type === 'select'"
                        v-model="card.draft[f.key]"
                        class="skill-select"
                      >
                        <option v-for="opt in f.options" :key="opt.value" :value="opt.value">
                          {{ opt.label }}
                        </option>
                      </select>

                      <input
                        v-else-if="f.type === 'number'"
                        class="skill-amount"
                        type="text"
                        inputmode="decimal"
                        :value="card.draft[f.key] || ''"
                        placeholder="0.00"
                        @input="onSkillNumber(card.draft, f.key, $event)"
                      />

                      <input
                        v-else-if="f.type === 'date'"
                        class="skill-input"
                        type="date"
                        v-model="card.draft[f.key]"
                      />

                      <div
                        v-else-if="f.type === 'switch'"
                        class="switch-row"
                        @click="card.draft[f.key] = card.draft[f.key] ? 0 : 1"
                      >
                        <span class="switch-desc">{{ f.desc || '' }}</span>
                        <div class="switch" :class="{ on: card.draft[f.key] }"><span></span></div>
                      </div>

                      <input v-else class="skill-input" type="text" v-model="card.draft[f.key]" />
                    </div>
                  </div>

                  <!-- 模型没在清单里匹配上的名字，原样提示出来，避免用户以为被识别成了别的分类 -->
                  <div v-if="unmatchedHint(card)" class="skill-hint warn">
                    {{ unmatchedHint(card) }}
                  </div>
                  <div
                    v-if="card.draft.kind === 'recurring' && card.draft.startsInPast"
                    class="skill-hint"
                  >
                    开始日期在今天或之前，保存后会立刻补生成一笔
                  </div>
                  <!-- 同名规则要明确说清是「复用」还是「新增」，否则用户会以为改的是原来那条 -->
                  <div
                    v-if="card.draft.kind === 'recurring' && card.draft.duplicate === 'name'"
                    class="skill-hint warn"
                  >
                    已有同名规则「{{ card.draft.name }}」。保存会新增一条，两条都会生成账单；
                    如果要改金额，请去周期记账页改原来那条
                  </div>
                  <div
                    v-else-if="card.draft.kind === 'recurring' && card.draft.duplicate === 'exact'"
                    class="skill-hint"
                  >
                    已存在完全相同的规则，保存会复用它，不会重复生成账单
                  </div>
                  <div
                    v-if="card.draft.mode === 'update' && card.draft.kind !== 'account'"
                    class="skill-hint"
                  >
                    会覆盖已有设置，起始日期保持不变
                  </div>
                  <!-- 投资账户没有「余额」：请求改成余额时转成改持仓，得让用户知道发生了什么 -->
                  <div
                    v-if="card.draft.kind === 'account' && card.draft.balance_requested"
                    class="skill-hint"
                  >
                    <template v-if="card.draft.shares_from_target">
                      投资账户的钱是「份额 × 行情价」，没有流水余额可校准。
                      已按当前价把「改成 {{ moneyText(card.draft.target_balance) }} 元」折算成持有份额
                      {{ card.draft.shares }}，保存前可以再手动调整
                    </template>
                    <template v-else>
                      投资账户的钱是「份额 × 行情价」，没有流水余额可校准。
                      这里请直接填新的持有份额（当前行情取不到，没敢替你折算）
                    </template>
                  </div>
                  <!-- 账户余额调整：把差额算给用户看，处理方式必须由他自己选 -->
                  <div v-if="isBalanceCard(card)" class="skill-hint">
                    当前 {{ moneyText(card.draft.current_balance) }}
                    → 改成 {{ moneyText(card.draft.target_balance) }}，
                    差额 {{ card.draft.delta >= 0 ? '+' : '-' }}{{ moneyText(Math.abs(card.draft.delta)) }}
                  </div>
                  <div
                    v-if="isBalanceCard(card) && !card.draft.balance_mode"
                    class="skill-hint warn"
                  >
                    这笔差额要记进流水，还是只校准余额？先选一个才能保存
                  </div>
                  <div
                    v-else-if="isBalanceCard(card) && card.draft.balance_mode === 'bill'"
                    class="skill-hint"
                  >
                    会生成一笔「账目调整」{{ card.draft.delta >= 0 ? '收入' : '支出' }}，
                    计入本月收支统计，也会算进预算
                  </div>
                  <div v-else-if="isBalanceCard(card)" class="skill-hint">
                    只把当前余额改成目标值，历史流水、收支统计和预算都不动
                  </div>
                  <!-- 赎回：把「份额 × 单价」的换算摊开，用户才知道到账金额是怎么来的 -->
                  <div v-if="isRedeemCard(card)" class="skill-hint">
                    <template v-if="redeemPlan(card.draft).shares > 0">
                      {{ card.draft.account_name }} 按单价 {{ card.draft.price }}
                      赎回 {{ redeemPlan(card.draft).shares }} {{ card.draft.unit }}，
                      预计到账 {{ moneyText(redeemPlan(card.draft).amount) }}；
                      剩余持仓 {{ redeemPlan(card.draft).remaining }} {{ card.draft.unit }}
                    </template>
                    <template v-else>还没算出赎回份额，先填赎回金额或单价</template>
                  </div>
                  <div
                    v-if="isRedeemCard(card) && card.draft.price_is_fallback"
                    class="skill-hint warn"
                  >
                    行情没取到，单价用的是成本价 {{ card.draft.price }}，保存前请按实际净值改一下
                  </div>
                  <div
                    v-if="isRedeemCard(card) && redeemRealized(card.draft) !== null"
                    class="skill-hint"
                  >
                    按成本价 {{ card.draft.cost_price }} 估算，这笔已实现
                    {{ redeemRealized(card.draft) >= 0 ? '盈' : '亏' }}
                    {{ moneyText(Math.abs(redeemRealized(card.draft))) }}；
                    赎回费与到账时间以平台实际为准
                  </div>
                  <div
                    v-if="isRedeemCard(card) && redeemPlan(card.draft).remaining <= 0"
                    class="skill-hint"
                  >
                    清仓后该账户份额归零，账面余额也会跟着归零，投资市值显示为 0
                  </div>

                  <!-- 删除账户是不可撤销的，警告必须写在卡片上 -->
                  <div
                    v-if="card.draft.kind === 'account' && card.draft.mode === 'delete'"
                    class="skill-hint warn"
                  >
                    删除后账户不可恢复。相关流水不会被删除，但会失去账户归属；
                    用到它的周期记账规则会自动停用。
                  </div>

                  <div class="skill-actions">
                    <span class="btn-ghost" @click.stop="msg.skillCards.splice(ci, 1)">不要了</span>
                    <span
                      class="btn-primary"
                      :class="{ disabled: !!validateDraft(card.draft) }"
                      @click.stop="confirmSkill(msg, card)"
                    >{{
                      card.draft.kind === 'account' && card.draft.mode === 'delete'
                        ? '确认删除'
                        : (isRedeemCard(card) ? '确认赎回' : '保存')
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- 多张时给一个一键入口，省得逐张点 -->
              <div v-if="msg.skillCards.length > 1 && pendingCount(msg) > 1" class="skill-bulk">
                <span class="btn-primary" @click="confirmAllSkills(msg)">
                  全部保存（{{ pendingCount(msg) }} 项）
                </span>
              </div>
            </div>

            <!-- 本次请求的用量与缓存命中：命中部分单价只有未命中的 1/50 -->
            <div v-if="msg.usage" class="usage-line">
              {{ msg.usage.requests > 1 ? `${msg.usage.requests} 次请求共` : '输入' }}
              {{ msg.usage.total }} tokens<template v-if="msg.usage.rate > 0"> · 缓存命中 {{ msg.usage.rate }}%</template>
            </div>
          </div>
        </div>

        <!-- 错误 -->
        <div v-else class="msg assistant">
          <TurtleAvatar :size="34" :src="settings.avatar" />
          <div class="bubble error-bubble">{{ msg.text }}</div>
        </div>
      </template>

      <!-- 等待中 -->
      <div v-if="sending" class="msg assistant">
        <TurtleAvatar :size="34" :src="settings.avatar" />
        <div class="bubble typing">
          <span></span><span></span><span></span>
        </div>
      </div>
    </div>

    <!-- 输入区 -->
    <!-- 待发送的图片 -->
    <div v-if="pendingImage" class="pending-image">
      <img :src="pendingImage" alt="待发送图片" />
      <span class="pending-tip">图片记账：会识别图中每一笔</span>
      <span class="pending-remove" @click="pendingImage = ''">×</span>
    </div>

    <div v-if="hasKey" class="composer">
      <span class="composer-cam" :class="{ busy: pickingImage }" @click="pickImage">📷</span>
      <textarea
        v-model="input"
        class="composer-input"
        rows="1"
        placeholder="说句话，比如「昨天吃面 28」"
        @keydown.enter.exact.prevent="send"
      ></textarea>
      <span
        class="send-btn"
        :class="{ disabled: sending || (!input.trim() && !pendingImage) }"
        @click="send"
      >
        {{ sending ? '…' : '发送' }}
      </span>
      <input
        ref="imageInput"
        type="file"
        accept="image/*"
        class="hidden-input bill-image-input"
        @change="onImagePick"
      />
    </div>

    <!-- 设置抽屉 -->
    <div v-if="showSettings" class="sheet-mask" @click.self="showSettings = false">
      <div class="sheet">
        <div class="sheet-head">
          <span>小乌设置</span>
          <span class="sheet-close" @click="showSettings = false">完成</span>
        </div>

        <div class="sheet-body">
          <!-- 头像 -->
          <div class="field">
            <label>形象</label>
            <div class="avatar-row">
              <TurtleAvatar :size="56" :src="settings.avatar" />
              <div class="avatar-actions">
                <span class="mini-btn" @click="avatarInput?.click()">上传自定义头像</span>
                <span v-if="settings.avatar" class="mini-btn ghost" @click="clearAvatar">恢复默认乌龟</span>
              </div>
            </div>
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              class="hidden-input"
              @change="onAvatarPick"
            />
          </div>

          <!-- Key -->
          <div class="field">
            <label>API Key</label>
            <input
              class="form-input"
              type="password"
              v-model="settings.apiKey"
              placeholder="sk-..."
              autocomplete="off"
            />
            <div class="hint">
              到 platform.deepseek.com 创建，只存本机，不进备份。
            </div>
          </div>

          <!-- 模型：只用一个基础模型，不做选择，只做说明 -->
          <div class="field">
            <label>模型</label>
            <div class="model-fixed">
              <span class="model-name">{{ AI_MODEL_LABEL }}</span>
              <span class="model-tag">固定</span>
            </div>
            <div class="hint">
              记账识别用 flash 模型并关闭思考模式：这类结构化短任务不需要思维链，关掉后响应更快、也不为思考过程付输出费。
            </div>
          </div>

          <!-- 高级 -->
          <div class="field">
            <label>接口地址（高级）</label>
            <input
              class="form-input"
              type="text"
              v-model="settings.baseUrl"
              placeholder="https://api.deepseek.com"
            />
            <div class="hint">用中转服务时才需要改，留空即用官方地址。</div>
          </div>

          <div v-if="testResult" class="test-result" :class="testOk ? 'ok' : 'bad'">
            {{ testResult }}
          </div>
        </div>

        <div class="sheet-foot">
          <span class="btn-ghost" @click="runTest">{{ testing ? '测试中…' : '测试连接' }}</span>
          <span class="btn-primary" @click="saveSettings">保存</span>
        </div>
      </div>
    </div>

    <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue'
import TurtleAvatar from '../components/TurtleAvatar.vue'
import {
  getAccounts, getCategories, getTags, getTransactions, getBudgets, createTransactionsBatch
} from '../db'
import { chatComplete, testConnection, AI_MODEL, AI_MODEL_LABEL, THINKING, DEFAULT_BASE_URL } from '../api/ai'
import {
  QUICK_PROMPTS, buildSystemPrompt, buildAnalysisPrompt, buildTimeContext,
  IMAGE_RECORD_HINT, extractJson, resolveRecords, buildAnalysisContext
} from '../utils/aiAssistant'
import { getHabits, formatHabits } from '../utils/userProfile'
import { valueAccounts } from '../utils/accountValuation'
import { fileToImagePayload } from '../utils/imageInput'
import { buildSkillRouterHint, parseSkillIntents, resolveSkillText, runSkill, applySkillDraft } from '../skills'
import { validateDraft, planRedeem } from '../skills/drafts'
import { buildQaPrompt } from '../skills/prompts'
import { computeSalary, DEFAULT_RATES } from '../utils/salary'

const STORAGE_KEY = 'bk_ai_settings'

const settings = reactive({
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  avatar: '',
  nickname: '小乌'
})

const accounts = ref([])
const categories = ref([])
const messages = ref([])
const input = ref('')
const sending = ref(false)
const showSettings = ref(false)
const avatarInput = ref(null)
// 图片记账
const imageInput = ref(null)
const pendingImage = ref('')
const pickingImage = ref(false)
const chatBody = ref(null)
const toastMsg = ref('')
const testing = ref(false)
const testResult = ref('')
const testOk = ref(false)

// 会话内的多轮上下文，只保留纯文本，离开页面即清
const history = []

let msgSeq = 0
let toastTimer = null

const hasKey = computed(() => !!settings.apiKey.trim())

function toast(text) {
  toastMsg.value = text
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastMsg.value = '' }, 2000)
}

// ========== 设置持久化 ==========
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    if (saved.apiKey) settings.apiKey = saved.apiKey
    // 不读取 saved.model：老版本可能存了 deepseek-reasoner，
    // 现在固定用基础模型，这里忽略旧值即可自然回落
    if (saved.baseUrl) settings.baseUrl = saved.baseUrl
    if (saved.avatar) settings.avatar = saved.avatar
    if (saved.nickname) settings.nickname = saved.nickname
  } catch {
    // 配置损坏就按未配置处理，不影响主流程
  }
}

function saveSettings() {
  settings.apiKey = settings.apiKey.trim()
  settings.baseUrl = (settings.baseUrl || DEFAULT_BASE_URL).trim()
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    avatar: settings.avatar,
    nickname: settings.nickname
  }))
  showSettings.value = false
  toast(settings.apiKey ? '已保存' : '已清空 Key')
}

// ========== 对话记录持久化 ==========
// 存的是一整条消息（含确认卡草稿），这样退出再进来还能继续确认
// 图片是 base64、单张几百 KB，存进去会把 localStorage 撑爆，只留一个标记位
const MSG_KEY = 'bk_ai_messages'
const MAX_STORED_MESSAGES = 40
let persistTimer = null

function persistMessages() {
  // 编辑卡片时会连续触发，攒一下再写
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const strip = list => list.slice(-MAX_STORED_MESSAGES).map(m => (
      m.image ? { ...m, image: '', hasImage: true } : m
    ))
    try {
      localStorage.setItem(MSG_KEY, JSON.stringify({
        messages: strip(messages.value),
        // 多轮上下文一起存，否则重启后模型记不住前几句
        history: history.slice(-10)
      }))
    } catch {
      // 容量不足时降级：只留最近几条，仍然存不下就放弃本次持久化，
      // 绝不让「存不下」导致聊天报错
      try {
        localStorage.setItem(MSG_KEY, JSON.stringify({
          messages: strip(messages.value).slice(-12),
          history: history.slice(-4)
        }))
      } catch {
        // 忽略
      }
    }
  }, 300)
}

function restoreMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(MSG_KEY) || '{}')
    if (Array.isArray(saved.messages) && saved.messages.length) {
      messages.value = saved.messages
      // id 要接着最大的往下排，否则新消息会和恢复的撞号
      msgSeq = messages.value.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0)
    }
    if (Array.isArray(saved.history)) {
      history.push(...saved.history.filter(h => (
        h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string'
      )))
    }
  } catch {
    // 记录损坏就当空白会话开始
  }
}

function clearMessages() {
  messages.value = []
  history.length = 0
  try {
    localStorage.removeItem(MSG_KEY)
  } catch {
    // 忽略
  }
  toast('已清空对话')
}

async function runTest() {
  const key = settings.apiKey.trim()
  if (!key) {
    testResult.value = '请先填写 API Key'
    testOk.value = false
    return
  }
  testing.value = true
  testResult.value = ''
  try {
    const reply = await testConnection({
      apiKey: key, model: AI_MODEL, baseUrl: settings.baseUrl
    })
    testOk.value = true
    testResult.value = `连接成功，模型回复：${reply || '（空）'}`
  } catch (e) {
    testOk.value = false
    testResult.value = e.message
  } finally {
    testing.value = false
  }
}

// ========== 头像 ==========
function clearAvatar() {
  settings.avatar = ''
}

// 压缩到 256px 再转 base64：localStorage 只有 5MB，原图直接存会撑爆
function compressImage(file, max) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)
    image.onload = () => {
      const scale = Math.min(1, max / Math.max(image.width, image.height))
      const w = Math.round(image.width * scale)
      const h = Math.round(image.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      // 透明 PNG 转 JPEG 会变黑底，先铺白
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(image, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取这张图片'))
    }
    image.src = url
  })
}

async function onAvatarPick(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    settings.avatar = await compressImage(file, 256)
  } catch (e) {
    toast(e.message)
  } finally {
    event.target.value = ''
  }
}

// ========== 对话 ==========
function fillPrompt(text) {
  input.value = text
}

function scrollToBottom() {
  nextTick(() => {
    const el = chatBody.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function pushMessage(msg) {
  const item = { id: ++msgSeq, ...msg }
  messages.value.push(item)
  scrollToBottom()
  return item
}

/**
 * 把 usage 压成一行可展示的信息
 * DeepSeek 缓存命中部分只要 0.1 元/百万 token，未命中是 2 元，差 20 倍，
 * 所以命中率值得直接亮出来，让用户知道自己省了多少
 */
function summarizeUsage(usage) {
  if (!usage) return null
  const hit = Number(usage.prompt_cache_hit_tokens) || 0
  const miss = Number(usage.prompt_cache_miss_tokens) || 0
  const total = hit + miss || Number(usage.prompt_tokens) || 0
  if (!total) return null
  return { total, hit, rate: Math.round((hit / total) * 100), requests: 1 }
}

// 配置类操作和分析类会发两次请求，命中率要按两次合并算才对
function mergeUsage(a, b) {
  if (!a) return b || null
  if (!b) return a
  const total = a.total + b.total
  const hit = a.hit + b.hit
  return {
    total,
    hit,
    rate: total ? Math.round((hit / total) * 100) : 0,
    requests: (a.requests || 1) + (b.requests || 1)
  }
}

function typeLabel(type) {
  if (type === 'income') return '收入'
  if (type === 'transfer') return '转账'
  return '支出'
}

function categoriesOf(type) {
  return categories.value.filter(c => c.type === type)
}

// 金额输入：只允许数字与一个小数点，最多两位小数（避开 type=number 吞小数点的问题）
function onAmountInput(record, event) {
  let v = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = v.indexOf('.')
  if (dot >= 0) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2)
    const [int, dec] = v.split('.')
    v = (int || '0') + '.' + dec
  }
  if (v.length > 12) v = v.slice(0, 12)
  event.target.value = v
  record.amount = Number(v) || 0
}

function recordReady(r) {
  if (!(Number(r.amount) > 0)) return false
  if (!r.account_id) return false
  if (r.type === 'transfer') {
    return !!r.to_account_id && Number(r.to_account_id) !== Number(r.account_id)
  }
  return !!r.category_id
}

function allReady(msg) {
  return (msg.records || []).length > 0 && msg.records.every(recordReady)
}

async function loadDictionaries() {
  const [a, c, t] = await Promise.all([getAccounts(), getCategories(), getTags()])
  accounts.value = a
  categories.value = c
  return { accounts: a, categories: c, tags: t }
}

// 工资计算器里存过的配置：取出来直接算好，省得模型再问一遍用户工资多少
function salaryContextText() {
  try {
    const p = JSON.parse(localStorage.getItem('bk_salary_profile') || '{}')
    const gross = Number(p.gross) || 0
    if (!gross) return ''
    const r = computeSalary({
      gross,
      monthIndex: new Date().getMonth() + 1,
      base: p.base === '' || p.base === undefined || p.base === null ? null : Number(p.base),
      rates: p.rates || DEFAULT_RATES,
      specials: p.specials || {}
    })
    return `税前 ${r.gross} 元，五险一金个人 ${r.socialTotal} 元，第 ${r.month} 月个税 ${r.monthlyTax} 元，到手 ${r.net} 元`
  } catch {
    return ''
  }
}

// ========== 图片记账 ==========
function pickImage() {
  if (pickingImage.value || sending.value) return
  imageInput.value?.click()
}

async function onImagePick(event) {
  const file = event.target.files?.[0]
  // 清空 value，否则连续选同一张图不会触发 change
  event.target.value = ''
  if (!file) return
  pickingImage.value = true
  try {
    const payload = await fileToImagePayload(file)
    pendingImage.value = payload.dataUrl
  } catch (e) {
    toast(e.message || '图片处理失败')
  } finally {
    pickingImage.value = false
  }
}

async function send() {
  const text = input.value.trim()
  const image = pendingImage.value
  // 只有图片、没有文字也要能发出去
  if ((!text && !image) || sending.value) return
  if (!hasKey.value) {
    showSettings.value = true
    return
  }

  pushMessage({ role: 'user', text, image })
  // 历史里只留文字：图片回传会白白放大后续每一轮的 token
  history.push({ role: 'user', content: text || '（发了一张账单截图）' })
  input.value = ''
  pendingImage.value = ''
  sending.value = true

  try {
    const dict = await loadDictionaries()
    // 习惯画像按天缓存：同一天内多次对话用的是同一份文本，
    // system prompt 才能逐字节一致，从而命中 DeepSeek 的前缀缓存
    const habits = await getHabits()
    const systemPrompt = buildSystemPrompt({
      ...dict,
      skillHints: buildSkillRouterHint(),
      habits: formatHabits(habits)
    })

    // 图片放在 user 消息的 content 数组里，system 一个字节都不动，
    // 这样图片记账和文本记账共用同一段缓存前缀
    const userContent = image
      ? [
          {
            type: 'text',
            text: `${buildTimeContext()}\n${IMAGE_RECORD_HINT}${text ? `\n\n用户附言：${text}` : ''}`
          },
          { type: 'image_url', image_url: { url: image } }
        ]
      : `${buildTimeContext()}\n${text}`

    const res = await chatComplete({
      apiKey: settings.apiKey.trim(),
      model: AI_MODEL,
      baseUrl: settings.baseUrl,
      jsonMode: true,
      // 图片识别比纯文本更需要输出额度：一张截图可能有十几笔
      maxTokens: image ? 2000 : 900,
      messages: [
        { role: 'system', content: systemPrompt },
        // 中间几轮历史用原文：它们不含时间基准，跨天也不会变化，
        // 于是缓存能一路命中到倒数第二条
        ...history.slice(-5, -1),
        // 时间基准只拼在最后一条：它是每次都唯一的部分，放在尾部损失最小
        { role: 'user', content: userContent }
      ]
    })

    const parsed = extractJson(res.content)
    if (!parsed) {
      throw new Error('小乌没听懂，换个说法试试')
    }

    const usageInfo = summarizeUsage(res.usage)
    const intent = parsed.intent
    // 模型偶尔把单个 intent 也包成数组，这里拍平一次，
    // 否则 ["qa"] 会一路掉到最后的 chat 兜底，只回一句「在的」就完了
    const flatIntent = Array.isArray(intent)
      ? (intent.find(i => ['record', 'analysis', 'qa', 'chat'].includes(i)) || 'chat')
      : intent

    // 配置类操作：一句话可能同时涉及周期和预算，逐个 skill 加载，各出一张确认卡
    const skillIds = parseSkillIntents(intent)
    if (skillIds.length) {
      const cards = []
      const failures = []
      let usage = usageInfo

      for (const id of skillIds) {
        try {
          // 每个 skill 只处理路由切给它的那一段：
          // 都拿完整原话的话，「每月房租1500」会被同时解析成周期和预算
          const segment = resolveSkillText(parsed.segments, id, text)
          const { skill, drafts, ctx, usage: skillUsage } = await runSkill(id, segment, {
            apiKey: settings.apiKey.trim(),
            model: AI_MODEL,
            baseUrl: settings.baseUrl
          })
          for (const draft of drafts) {
            cards.push({ draft, fields: skill.fields(draft, ctx), label: skill.label, done: false })
          }
          usage = mergeUsage(usage, summarizeUsage(skillUsage))
        } catch (e) {
          // 一个 skill 失败不该连累另一个：
          // 周期解析出来了、预算没懂，也要先把周期那几张卡给到用户
          failures.push(e.message)
        }
      }

      if (!cards.length) {
        throw new Error(failures.join('；') || '没解析出可执行的操作')
      }

      const replyText = cards.length === 1
        ? (cards[0].draft.reply || `准备好一个${cards[0].label}设置，确认一下`)
        : `准备好 ${cards.length} 项设置，逐条确认一下`
      pushMessage({ role: 'assistant', text: replyText, skillCards: cards, usage })
      if (failures.length) pushMessage({ role: 'error', text: failures.join('；') })
      return
    }

    if (flatIntent === 'record') {
      const records = resolveRecords(parsed.records, { ...dict, text, habits })
      if (!records.length) {
        pushMessage({
          role: 'assistant',
          text: parsed.reply || (image
            ? '这张图里没看出能记的消费，换张清晰点的试试'
            : '没认出金额，再说一次？'),
          usage: usageInfo
        })
        return
      }
      // 只有一个账户时直接替用户选上，少一步操作
      if (dict.accounts.length === 1) {
        for (const r of records) {
          if (!r.account_id) {
            r.account_id = Number(dict.accounts[0].id)
          }
        }
      }
      const replyText = parsed.reply || `识别到 ${records.length} 笔，确认一下`
      pushMessage({ role: 'assistant', text: replyText, records, confirmed: false, usage: usageInfo })
      history.push({ role: 'assistant', content: replyText })
      return
    }

    if (flatIntent === 'analysis') {
      // 分析类问题：把本地聚合摘要交给模型，原始流水不出手机
      // 账户金额要先补市值：投资账户的流水余额不是用户看到的钱数，直接上传会报出假数字
      const [trans, budgets, valuedAccounts] = await Promise.all([
        getTransactions(), getBudgets(), valueAccounts(dict.accounts)
      ])
      const context = buildAnalysisContext({
        transactions: trans, accounts: valuedAccounts, budgets
      })
      const res2 = await chatComplete({
        apiKey: settings.apiKey.trim(),
        model: AI_MODEL,
        baseUrl: settings.baseUrl,
        // 分析类需要一点推理能力，开最低档思考；记账解析不开，省下整段思维链的输出费
        thinking: THINKING.LOW,
        // 思考会占用输出额度，比记账留更宽的余量
        maxTokens: 2000,
        messages: [
          { role: 'system', content: buildAnalysisPrompt(dict) },
          { role: 'user', content: `${context}\n\n我的问题：${text}` }
        ]
      })
      const answer = res2.content.trim()
      pushMessage({
        role: 'assistant',
        text: answer,
        usage: mergeUsage(usageInfo, summarizeUsage(res2.usage))
      })
      history.push({ role: 'assistant', content: answer })
      return
    }

    if (flatIntent === 'qa') {
      // 问答也带上下文：只给聚合摘要与工资配置，不给原始流水。
      // 这样「我这个月还能花多少」「我到手多少」都能直接答，也不泄露明细
      const [trans, budgets, valuedAccounts] = await Promise.all([
        getTransactions(), getBudgets(), valueAccounts(dict.accounts)
      ])
      const ledgerText = buildAnalysisContext({
        transactions: trans, accounts: valuedAccounts, budgets
      })
      const res2 = await chatComplete({
        apiKey: settings.apiKey.trim(),
        model: AI_MODEL,
        baseUrl: settings.baseUrl,
        maxTokens: 1500,
        messages: [
          {
            role: 'system',
            content: buildQaPrompt({ ...dict, ledgerText, salaryText: salaryContextText() })
          },
          { role: 'user', content: `${buildTimeContext()}\n${text}` }
        ]
      })
      const answer = res2.content.trim() || '这个我还没想明白，换个问法？'
      pushMessage({
        role: 'assistant',
        text: answer,
        usage: mergeUsage(usageInfo, summarizeUsage(res2.usage))
      })
      history.push({ role: 'assistant', content: answer })
      return
    }

    const reply = parsed.reply || '在的，有事说事'
    pushMessage({ role: 'assistant', text: reply, usage: usageInfo })
    history.push({ role: 'assistant', content: reply })
  } catch (e) {
    pushMessage({ role: 'error', text: e.message || '请求失败' })
  } finally {
    sending.value = false
    scrollToBottom()
  }
}

async function confirmRecords(msg) {
  if (!allReady(msg)) {
    toast('还有记录没选完')
    return
  }
  try {
    // 一次写入：逐条写的话中途失败会留下「前几笔已入库、消息仍显示未确认」的状态，
    // 用户再点一次就整组重复记账
    const count = await createTransactionsBatch(msg.records.map(r => ({
      type: r.type,
      amount: Number(r.amount) || 0,
      category_id: r.type === 'transfer' ? null : r.category_id,
      account_id: r.account_id,
      to_account_id: r.type === 'transfer' ? r.to_account_id : null,
      merchant: r.merchant || '',
      note: r.note || '',
      date: r.date
    })))
    msg.confirmed = true
    toast(`已记 ${count} 笔`)
  } catch (e) {
    toast('记账失败：' + e.message)
  }
}

// ========== 配置类操作 ==========
// 金额字段统一走这里清洗，避开 type=number 吞小数点的问题
function onSkillNumber(draft, key, event) {
  let v = String(event.target.value || '').replace(/[^\d.]/g, '')
  const dot = v.indexOf('.')
  if (dot >= 0) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  }
  if (v.length > 12) v = v.slice(0, 12)
  event.target.value = v
  draft[key] = Number(v) || 0
}

/**
 * 卡片折叠规则
 * 已保存的卡固定折叠、且不允许再展开：能展开就意味着能再点保存，
 * 而 recurring / category 这些都是「新建」语义，会重复写入一条
 */
function cardCollapsed(card) {
  if (card.done) return true
  return card.expanded === false
}

function toggleCard(card) {
  if (card.done) return
  card.expanded = cardCollapsed(card)
}

// 已保存的卡告诉用户去哪儿改，不然会以为改不了
function cardTargetPage(card) {
  const kind = card.draft?.kind
  if (kind === 'recurring') return '周期记账页'
  if (kind === 'budget') return '预算页'
  if (kind === 'category') return '分类管理'
  if (kind === 'tag') return '标签管理'
  if (kind === 'account') return '账户页'
  return '对应页面'
}

// 卡片首行那句「新建 / 修改」，账户的四种模式语义差别大，必须分别说清
function modeLine(card) {
  const d = card.draft || {}
  if (d.kind === 'account') {
    if (d.mode === 'balance') return '调整当前余额'
    if (d.mode === 'delete') return '删除账户'
    if (d.mode === 'redeem') return '赎回投资账户'
    if (d.mode === 'update') return '修改账户资料'
    return '新建账户'
  }
  return d.mode === 'update' ? '修改已有设置' : '新建'
}

// 改余额的卡片有三段提示（差额 / 待选择 / 已选结果），统一在这里判类型
function isBalanceCard(card) {
  const d = card?.draft
  return !!d && d.kind === 'account' && d.mode === 'balance'
}

function isRedeemCard(card) {
  const d = card?.draft
  return !!d && d.kind === 'account' && d.mode === 'redeem'
}

// 赎回卡上改金额或单价要立刻看到换算结果，所以现算，不用草稿里那份定格的值
function redeemPlan(draft) {
  return planRedeem({
    amount: draft?.amount,
    price: draft?.price,
    held: draft?.held_shares,
    all: Number(draft?.redeem_all) > 0,
    digits: draft?.unit === '克' ? 4 : 2
  })
}

// 已实现盈亏同样跟着金额走：只改金额时不能还显示按原份额算的旧数
function redeemRealized(draft) {
  const plan = redeemPlan(draft)
  const cost = Number(draft?.cost_price) || 0
  const price = Number(draft?.price) || 0
  if (!(cost > 0) || !(price > 0) || !(plan.shares > 0)) return null
  return Math.round((price - cost) * plan.shares * 100) / 100
}

// 字段显示条件：兼容旧的函数写法和新的数据写法
// 数据写法才能随确认卡一起持久化，函数在 JSON 序列化时会被丢掉
function fieldVisible(field, draft) {
  if (typeof field.when === 'function') return field.when(draft)
  if (field.showWhen) {
    return String(draft?.[field.showWhen.key]) === String(field.showWhen.value)
  }
  return true
}

// 标题行的一句话摘要：折叠后靠它认出这是哪一项
// 整数金额不补小数位，省下来的几个字符正好够标题多显示两个字
function moneyText(n) {
  const v = Number(n) || 0
  return Number.isInteger(v) ? `¥${v}` : `¥${v.toFixed(2)}`
}

function cardTitle(card) {
  const d = card.draft
  if (!d) return ''
  if (d.kind === 'recurring') {
    const money = Number(d.amount) > 0 ? ` ${moneyText(d.amount)}` : ''
    return `${d.name || '周期记账'}${money}`
  }
  if (d.kind === 'budget') {
    const scope = d.scope === 'category' ? (d.category_name || '分类预算') : '总预算'
    const money = Number(d.amount) > 0 ? ` ${moneyText(d.amount)}` : ''
    return `${scope}${money}`
  }
  if (d.kind === 'account') {
    const who = d.account_name || d.name || '账户'
    if (d.mode === 'balance') {
      return Number(d.target_balance) >= 0 && d.target_balance !== null
        ? `${who} → ${moneyText(d.target_balance)}`
        : who
    }
    if (d.mode === 'delete') return `删除 ${who}`
    // 赎回的标题直接报「从哪个账户到哪个账户、多少钱」，折叠后一眼能认出来
    if (d.mode === 'redeem') {
      const plan = redeemPlan(d)
      const money = plan.amount > 0 ? ` ${moneyText(plan.amount)}` : ''
      return `${who} → ${d.to_account_name || '转入账户'}${money}`
    }
    if (d.mode === 'update') return d.name && d.name !== d.account_name ? `${who} → ${d.name}` : who
    return d.name || '新账户'
  }
  return d.name || card.label
}

// 还有几张没确认
function pendingCount(msg) {
  return (msg.skillCards || []).filter(c => !c.done).length
}

// 一键保存：逐张校验，能存的存掉，存不了的留着自己补
async function confirmAllSkills(msg) {
  const cards = (msg.skillCards || []).filter(c => !c.done)
  let saved = 0
  const blocked = []
  for (const card of cards) {
    const error = validateDraft(card.draft)
    if (error) {
      blocked.push(error)
      continue
    }
    try {
      await applySkillDraft(card.draft)
      card.done = true
      card.expanded = false
      saved++
    } catch (e) {
      blocked.push(e.message)
    }
  }
  if (saved && !blocked.length) toast(`已保存 ${saved} 项`)
  else if (saved) toast(`已保存 ${saved} 项，${blocked.length} 项还需要补全`)
  else toast(blocked[0] || '没有可保存的项')
  // 账户可能被新建/改名/删除，后续记账要用最新账户清单
  if (saved) loadDictionaries().catch(() => {})
}

async function confirmSkill(msg, card) {
  const draft = card.draft
  const error = validateDraft(draft)
  if (error) {
    toast(error)
    return
  }
  try {
    const skill = await applySkillDraft(draft)
    card.done = true
    // 存完就收起来，把屏幕让给下一张
    card.expanded = false
    toast(`已保存：${skill.label}`)
    // 账户类操作会改变账户清单，刷新一下后续记账/问答才用得上
    if (draft.kind === 'account') loadDictionaries().catch(() => {})
  } catch (e) {
    toast('保存失败：' + e.message)
  }
}

/**
 * 模型给的名字在本地清单里找不到时的提示
 * 不说清楚的话，用户会以为「吃喝玩乐」被认成了某个分类，实际上它是空的
 */
function unmatchedHint(card) {
  const d = card.draft
  if (!d) return ''
  const hints = []
  if (d.kind === 'recurring') {
    if (d.type !== 'transfer' && d.category_name && !d.category_id) {
      hints.push(`分类「${d.category_name}」不在你的分类里，请选一个`)
    }
    if (d.account_name && !d.account_id) {
      hints.push(`账户「${d.account_name}」没匹配上，请选一个`)
    }
    if (d.type === 'transfer' && d.to_account_name && !d.to_account_id) {
      hints.push(`转入账户「${d.to_account_name}」没匹配上`)
    }
  }
  if (d.kind === 'budget' && d.scope === 'category' && d.category_name && !d.category_id) {
    hints.push(`分类「${d.category_name}」不在你的分类里，请选一个`)
  }
  if (d.kind === 'account' && d.mode !== 'create' && !d.account_id) {
    hints.push(`账户「${d.account_name || '未指定'}」没匹配上，请确认是哪个账户`)
  }
  if (d.kind === 'account' && d.mode === 'redeem' && d.to_account_name && !d.to_account_id) {
    hints.push(`转入账户「${d.to_account_name}」没匹配上，请选一个`)
  }
  return hints.join('；')
}

onMounted(() => {
  loadSettings()
  restoreMessages()
  loadDictionaries().catch(() => {})
  nextTick(scrollToBottom)
})

// 消息里含确认卡草稿，用户在卡上改金额也要跟着存，所以用 deep
watch(messages, persistMessages, { deep: true })
</script>

<style scoped>
.assistant-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* 顶栏 */
.ai-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(135deg, #00C48E 0%, #00A87A 100%);
  color: #fff;
}
.nav-btn {
  width: 34px;
  font-size: 18px;
  cursor: pointer;
  text-align: center;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}

/* 未配置 Key */
.onboard {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 28px;
  text-align: center;
}
.onboard-title {
  margin-top: 18px;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
}
.onboard-text {
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-secondary);
}
.onboard-btn {
  margin-top: 20px;
  padding: 11px 34px;
  border-radius: 22px;
  background: linear-gradient(135deg, #00C48E, #00A87A);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 16px rgba(0, 196, 142, 0.3);
}
.onboard-note {
  margin-top: 14px;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* 对话区 */
.chat-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 14px 12px 8px;
}
.msg {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  align-items: flex-start;
}
.msg.user {
  justify-content: flex-end;
}
.msg.assistant {
  align-items: flex-start;
}
/* 助手消息右半部分：气泡和确认卡各自决定宽度 */
.msg-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
/* 气泡按内容收缩，最长不超过整行 */
.msg-content > .bubble {
  max-width: 100%;
}
/* 卡片区必须撑满整行：挤在气泡里时标题只剩十几个像素，
   三张卡都显示成「房租 ¥1...」，等于没有区分 */
.msg-content > .skill-box,
.msg-content > .usage-line {
  width: 100%;
}
.bubble {
  max-width: 78%;
  min-width: 0;
  padding: 10px 13px;
  border-radius: 4px 14px 14px 14px;
  background: var(--card);
  box-shadow: var(--shadow-sm);
  font-size: 14px;
  line-height: 1.65;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
}
.user-bubble {
  border-radius: 14px 4px 14px 14px;
  background: linear-gradient(135deg, #00C48E, #00A87A);
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 196, 142, 0.24);
}
.error-bubble {
  background: var(--danger-light);
  color: var(--danger);
  font-size: 13px;
}
.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.quick-chip {
  padding: 5px 11px;
  border-radius: 14px;
  background: #E8F7F2;
  color: #00805C;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

/* 记账确认卡 */
.record-box {
  margin-top: 10px;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
.record-row {
  padding: 9px 0;
}
.record-row + .record-row {
  border-top: 1px solid var(--divider);
}
.record-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.type-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--danger-light);
  color: var(--danger);
}
.type-tag.income {
  background: var(--success-light);
  color: var(--success);
}
.type-tag.transfer {
  background: var(--primary-light);
  color: var(--primary);
}
.amount-input {
  flex: 1;
  min-width: 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  padding: 2px 0;
  outline: none;
  font-variant-numeric: tabular-nums;
}
.yuan {
  font-size: 12px;
  color: var(--text-secondary);
}
.record-fields {
  display: flex;
  gap: 6px;
  margin-top: 7px;
}
.record-fields select {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #FBFCFE;
  font-size: 13px;
  color: var(--text);
  outline: none;
}
.record-foot {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.date-input,
.note-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #FBFCFE;
  font-size: 13px;
  color: var(--text);
  outline: none;
}
.date-input {
  flex: 0 0 128px;
}
.record-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.confirmed-tip {
  margin-top: 10px;
  text-align: right;
  font-size: 12px;
  color: var(--success);
}

/* 用量与缓存命中：弱化到接近注释，不抢对话内容的注意力 */
.usage-line {
  /* 与卡片区的间距由 .msg-content 的 gap 控制 */
  margin-top: 0;
  font-size: 10px;
  color: var(--text-tertiary);
  text-align: right;
}

/* 配置类操作确认卡 */
.skill-box {
  /* 与上方气泡的间距由 .msg-content 的 gap 统一控制 */
  margin-top: 0;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}
/* 汇总头：一共几项、还剩几项 */
.skill-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.pending-tag {
  padding: 1px 7px;
  border-radius: 9px;
  background: #FFF4E0;
  color: #A15C00;
  font-weight: 600;
}
.all-done-tag {
  padding: 1px 7px;
  border-radius: 9px;
  background: var(--success-light);
  color: var(--success);
  font-weight: 600;
}

/* 每张卡是独立白底卡片，左侧一道类型色条，卡片之间留 10px 空档 */
.skill-card {
  background: #fff;
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: 12px;
  margin-bottom: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.05);
}
.skill-card:last-child {
  margin-bottom: 0;
}
/* 类型色条：扫一眼就知道这张是周期、预算还是分类 */
.skill-card.kind-recurring { border-left-color: #00C48E; }
.skill-card.kind-budget { border-left-color: #4A7CF7; }
.skill-card.kind-category { border-left-color: #F59E0B; }
.skill-card.kind-tag { border-left-color: #8B5CF6; }
/* 已保存的整体降权，视觉上退到背景里 */
.skill-card.done {
  background: #FAFBFC;
  box-shadow: none;
}
.skill-card.done .skill-badge,
.skill-card.done .skill-title {
  opacity: 0.7;
}

.skill-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
/* 已保存的卡不再响应点击，光标也回到默认 */
.skill-head.locked {
  cursor: default;
}
/* 已保存卡的收尾说明，弱化处理，只起指路作用 */
.skill-locked-tip {
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.skill-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--primary-light);
  color: var(--primary-dark);
}
.skill-card.kind-recurring .skill-badge { background: #E8F7F2; color: #00805C; }
.skill-card.kind-category .skill-badge { background: #FFF4E0; color: #A15C00; }
.skill-card.kind-tag .skill-badge { background: #F3EDFF; color: #6D3BD1; }

/* 摘要：折叠后全靠它认出这是哪一项 */
.skill-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skill-done {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--success);
}
/* 第几张 / 共几张 */
.skill-index {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--text-tertiary);
}
.chevron {
  flex-shrink: 0;
  width: 12px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

.skill-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--divider);
}
.skill-mode-line {
  padding: 8px 0 2px;
  font-size: 11px;
  color: var(--text-tertiary);
}
.skill-bulk {
  margin-top: 10px;
  display: flex;
  justify-content: center;
}
.skill-hint.warn {
  color: #A15C00;
  background: var(--warning-light);
  padding: 6px 8px;
  border-radius: 6px;
}
.skill-field {
  margin-bottom: 9px;
}
.skill-label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.skill-label .opt {
  margin-left: 4px;
  color: var(--text-tertiary);
}
.skill-input,
.skill-select {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #FBFCFE;
  font-size: 13px;
  color: var(--text);
  outline: none;
  font-family: inherit;
}
.skill-amount {
  width: 100%;
  padding: 4px 0;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  outline: none;
  font-variant-numeric: tabular-nums;
}
.skill-hint {
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.6;
  color: #C77C00;
}
.skill-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

/* 简易开关，仅本页用 */
.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
}
.switch-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}
.switch {
  width: 42px;
  height: 24px;
  border-radius: 12px;
  background: #D8DDE3;
  padding: 3px;
  transition: background 0.2s;
  flex-shrink: 0;
}
.switch span {
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.2s;
}
.switch.on {
  background: #00C48E;
}
.switch.on span {
  transform: translateX(18px);
}
.btn-primary,
.btn-ghost {
  padding: 7px 15px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.btn-primary {
  background: #00C48E;
  color: #fff;
}
.btn-ghost {
  background: var(--bg);
  color: var(--text-secondary);
}
.btn-primary.disabled {
  opacity: 0.42;
}

/* 等待动画 */
.typing {
  display: flex;
  gap: 4px;
  padding: 13px;
}
.typing span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #A9B3C1;
  animation: blink 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: 0.18s; }
.typing span:nth-child(3) { animation-delay: 0.36s; }
@keyframes blink {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}

/* 输入区 */
.composer {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));
  background: var(--card);
  border-top: 1px solid var(--border);
}

/* 相机入口：和发送按钮一左一右夹住输入框 */
.composer-cam {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  border-radius: 50%;
  background: var(--bg);
  cursor: pointer;
  transition: opacity 0.2s;
}
.composer-cam.busy {
  opacity: 0.4;
}

/* 待发送的图片预览条 */
.pending-image {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 12px 8px;
  padding: 7px;
  border-radius: 12px;
  background: #F3F8F6;
  border: 1px solid #DCEFE7;
}
.pending-image img {
  width: 44px;
  height: 44px;
  object-fit: cover;
  border-radius: 8px;
  flex-shrink: 0;
}
.pending-tip {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.pending-remove {
  flex-shrink: 0;
  padding: 0 6px;
  font-size: 18px;
  line-height: 1;
  color: var(--text-tertiary);
  cursor: pointer;
}

/* 对话流里的图片缩略图 */
.msg-image {
  display: block;
  max-width: 100%;
  max-height: 220px;
  border-radius: 10px;
  margin-bottom: 6px;
}
/* 恢复的历史消息没有图片本体，用占位条代替 */
.msg-image-lost {
  display: inline-block;
  margin-bottom: 6px;
  padding: 7px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.22);
  font-size: 12px;
  opacity: 0.9;
}
.composer-input {
  flex: 1;
  min-width: 0;
  max-height: 96px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 18px;
  background: #FBFCFE;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text);
  resize: none;
  outline: none;
  font-family: inherit;
}
.composer-input:focus {
  border-color: #00C48E;
  background: var(--card);
}
.send-btn {
  flex-shrink: 0;
  padding: 9px 16px;
  border-radius: 18px;
  background: #00C48E;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.send-btn.disabled {
  opacity: 0.4;
}

/* 设置抽屉 */
.sheet-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.42);
  display: flex;
  align-items: flex-end;
  z-index: 200;
}
.sheet {
  width: 100%;
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border-radius: 18px 18px 0 0;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.sheet-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 16px 12px;
  font-size: 15px;
  font-weight: 600;
  border-bottom: 1px solid var(--divider);
}
.sheet-close {
  font-size: 14px;
  font-weight: 500;
  color: #00A87A;
  cursor: pointer;
}
.sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
.field {
  margin-bottom: 18px;
}
.field label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 7px;
}
.hint {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.hidden-input {
  display: none;
}
.avatar-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.avatar-actions {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.mini-btn {
  padding: 7px 13px;
  border-radius: 9px;
  background: #E8F7F2;
  color: #00805C;
  font-size: 12px;
  cursor: pointer;
  text-align: center;
}
.mini-btn.ghost {
  background: var(--bg);
  color: var(--text-secondary);
}
/* 模型固定展示：不可点选，只用来说明当前用的哪一档 */
.model-fixed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid #00C48E;
  background: #F0FBF7;
}
.model-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.model-tag {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 5px;
  background: #DDF6EC;
  color: #00805C;
}
.test-result {
  padding: 10px 12px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.6;
}
.test-result.ok {
  background: var(--success-light);
  color: var(--success);
}
.test-result.bad {
  background: var(--danger-light);
  color: var(--danger);
}
.sheet-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid var(--divider);
}

/* 轻提示 */
/* 必须显式 top: auto：全局 .toast 设了 top: 50%，这里只改 bottom 的话
   top 与 bottom 会同时生效，块会被拉伸成半屏高的黑框 */
.toast {
  position: fixed;
  top: auto;
  left: 50%;
  bottom: 96px;
  transform: translateX(-50%);
  padding: 9px 18px;
  border-radius: 18px;
  background: rgba(16, 24, 40, 0.86);
  color: #fff;
  font-size: 13px;
  z-index: 300;
  max-width: 78vw;
  text-align: center;
  line-height: 1.5;
}
</style>
