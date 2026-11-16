<template>
  <div class="swipe-row" @click.capture="onClickCapture">
    <!-- 右滑露出：复制 -->
    <div class="swipe-actions left">
      <button class="swipe-act copy" @click.stop="$emit('copy')">复制</button>
    </div>
    <!-- 左滑露出：删除 -->
    <div class="swipe-actions right">
      <button class="swipe-act delete" @click.stop="$emit('delete')">删除</button>
    </div>
    <div
      ref="row"
      class="swipe-content"
      :style="contentStyle"
      @touchstart.passive="onStart"
      @touchmove.passive="onMove"
      @touchend="onEnd"
      @touchcancel="onCancel"
    >
      <slot />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'

// 列表行滑动手势：右滑露「复制」、左滑露「删除」
//
// 两个必须避开的坑：
//   1. 屏幕左右边缘 32px 是侧滑返回的起手区（backNavigation.js），这里不接管，
//      否则在二级列表里一滑就退页；
//   2. 滑动结束后浏览器会补发一次 click，不拦的话会顺带把列表项点开。
//      用捕获阶段 stopPropagation 拦在行内容自己的 @click 之前。

const ACTION_WIDTH = 82
const EDGE_SAFE = 32
const INTENT = 8
const OPEN_THRESHOLD = 40
const CLICK_GUARD_MS = 260

defineEmits(['copy', 'delete'])

const row = ref(null)
const offset = ref(0)
const dragging = ref(false)
// 当前停靠方向：'' 收起 / 'left' 露出左动作 / 'right' 露出右动作
const openSide = ref('')

let startX = 0
let startY = 0
let baseOffset = 0
let tracking = false
let decided = false
let guardUntil = 0

const contentStyle = computed(() => ({
  transform: `translateX(${offset.value}px)`,
  transition: dragging.value ? 'none' : 'transform 0.22s ease'
}))

function snapTo(side) {
  openSide.value = side
  offset.value = side === 'left' ? ACTION_WIDTH : side === 'right' ? -ACTION_WIDTH : 0
}

function close() {
  snapTo('')
}

function onStart(event) {
  if (event.touches.length !== 1) return
  const touch = event.touches[0]
  const width = window.innerWidth || document.documentElement.clientWidth || 0
  // 边缘起手留给侧滑返回
  if (touch.clientX <= EDGE_SAFE || touch.clientX >= width - EDGE_SAFE) return

  // 通知其它行收起（自己保持当前停靠位置，可以从打开状态继续拖）
  document.dispatchEvent(new CustomEvent('bk-swipe-row-open', { detail: row.value }))

  startX = touch.clientX
  startY = touch.clientY
  baseOffset = openSide.value === 'left' ? ACTION_WIDTH : openSide.value === 'right' ? -ACTION_WIDTH : 0
  tracking = true
  decided = false
}

function onMove(event) {
  if (!tracking || event.touches.length !== 1) return
  const touch = event.touches[0]
  const dx = touch.clientX - startX
  const dy = touch.clientY - startY

  if (!decided) {
    if (Math.abs(dx) < INTENT && Math.abs(dy) < INTENT) return
    // 纵向意图明显就交还给页面滚动
    if (Math.abs(dy) >= Math.abs(dx)) {
      tracking = false
      return
    }
    decided = true
    dragging.value = true
  }

  let next = baseOffset + dx
  // 超过动作区宽度后加阻尼，避免整行被拖飞
  if (next > ACTION_WIDTH) next = ACTION_WIDTH + (next - ACTION_WIDTH) * 0.25
  if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.25
  offset.value = next
}

function onEnd() {
  if (!tracking) return
  tracking = false
  dragging.value = false
  if (!decided) return
  decided = false
  guardUntil = Date.now() + CLICK_GUARD_MS

  if (offset.value >= OPEN_THRESHOLD) snapTo('left')
  else if (offset.value <= -OPEN_THRESHOLD) snapTo('right')
  else close()
}

function onCancel() {
  if (!tracking) return
  tracking = false
  decided = false
  dragging.value = false
  snapTo(openSide.value)
}

function onClickCapture(event) {
  // 动作按钮自己要走原逻辑，别在捕获阶段把点击吞掉
  if (event.target.closest?.('.swipe-act')) return
  if (Date.now() < guardUntil) {
    event.stopPropagation()
    event.preventDefault()
    guardUntil = 0
    return
  }
  if (openSide.value) {
    // 行是打开状态时，第一次点击只用来收起
    event.stopPropagation()
    event.preventDefault()
    close()
  }
}

function onOtherOpen(event) {
  if (event.detail === row.value) return
  if (openSide.value) close()
}

onMounted(() => document.addEventListener('bk-swipe-row-open', onOtherOpen))
onUnmounted(() => document.removeEventListener('bk-swipe-row-open', onOtherOpen))
</script>

<style scoped>
.swipe-row {
  position: relative;
  overflow: hidden;
  background: var(--card);
}
.swipe-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
}
.swipe-actions.left { left: 0; }
.swipe-actions.right { right: 0; }
.swipe-act {
  width: 82px;
  height: 100%;
  border: none;
  font-size: 14px;
  color: #fff;
  cursor: pointer;
  touch-action: manipulation;
}
.swipe-act.copy { background: var(--primary); }
.swipe-act.delete { background: var(--danger); }
/* 内容层盖在动作层上，滑动时以白色背景遮住背后按钮 */
.swipe-content {
  position: relative;
  background: var(--card);
  will-change: transform;
}
</style>
