// 返回导航：原生返回键 / 系统侧滑 + 边缘侧滑手势
//
// 背景：Capacitor 核心不处理 Android 返回键，未注册监听时按下返回会直接退出应用。
// 这里统一接管三种入口，行为保持一致的优先级：
//   1. 有弹窗 → 先关弹窗
//   2. 二级页 → 回上一页（无历史则回落到合理上级页）
//   3. 底部 Tab 根页面 → 退出应用
//
// 两条滑动路径并存，互不冲突：
//   - 系统手势导航：边缘侧滑由系统消费，走原生 backButton 事件
//   - 三键导航：触摸事件能到 WebView，由下面的边缘侧滑手势补上
// 页面内手势只认屏幕左右边缘起手，页面中间横划不接管，
// 主页面（Tab 根页）也不接管，左滑交给系统退出。

import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'

// 带返回按钮的二级页；Tab 根页面（/、/accounts、/statistics、/budgets、/settings）不参与
const SUB_PAGE_PREFIXES = [
  '/add', '/edit', '/search', '/tags', '/installments',
  '/recurring', '/interest', '/guide', '/import', '/assistant',
  '/categories', '/markets'
]

// 手势判定：横向位移阈值与主方向占比
// 只认「从屏幕左右边缘起手」的滑动：页面中间随便划一下不该把页面滑走。
// 这既贴合系统侧滑的直觉，也避免和列表、图表里的横向操作打架。
const EDGE_ZONE = 30
// 边缘滑动本来就短，阈值比整屏滑动放低一些
const MIN_DISTANCE = 48
const MIN_INTENT = 10
const DIRECTION_RATIO = 1.5
// 拖动跟手系数与最大位移，只做轻微反馈，不做整页跟手
const FOLLOW_RATIO = 0.28
const MAX_OFFSET = 56

export function isSubPage(path) {
  return SUB_PAGE_PREFIXES.some(p => path === p || path.startsWith(p + '/'))
}

/**
 * 起手点落在哪一侧边缘带：'left' / 'right' / ''
 * 抽成纯函数便于单测：宽屏（平板/横屏）下边缘带仍是固定物理宽度
 */
export function edgeSideOf(x, width) {
  if (!(width > 0)) return ''
  // 屏幕很窄时不要把中间带挤没，最多各占 1/4
  const zone = Math.min(EDGE_ZONE, width / 4)
  if (x <= zone) return 'left'
  if (x >= width - zone) return 'right'
  return ''
}

export function isEdgeStart(x, width) {
  return !!edgeSideOf(x, width)
}

// 同一次边缘侧滑在系统手势导航下可能被两边都捕获：
// WebView 收到触摸后又触发一次原生 backButton，结果连退两页。
// 两个方向各记一个时间戳做去重，互不影响「连按返回键」的正常连退。
const BACK_DEDUPE_MS = 700
let lastSwipeBackAt = 0
let lastNativeBackAt = 0

// 冷启动直达二级页时没有可回退的历史，按语义给一个上级页
function fallbackOf(path) {
  // 这些页都是从设置里进去的，回落设置比回首页更符合来路
  if (path.startsWith('/import') ||
    path.startsWith('/categories') ||
    path.startsWith('/markets') ||
    path.startsWith('/guide') ||
    path.startsWith('/tags') ||
    path.startsWith('/installments') ||
    path.startsWith('/recurring')) {
    return '/settings'
  }
  return '/'
}

// 取当前最上层弹窗。这些弹窗都用 @click.self 关闭，直接派发一次点击即可
function topOverlay() {
  const list = document.querySelectorAll('.modal-overlay, .confirm-dialog')
  return list.length ? list[list.length - 1] : null
}

function closeTopOverlay() {
  const el = topOverlay()
  if (!el) return false
  el.dispatchEvent(new MouseEvent('click', { bubbles: false }))
  return true
}

function hasHistory() {
  return !!(window.history.state && window.history.state.back)
}

/**
 * 返回上一页
 * @returns {boolean} 是否消费了这次返回；false 表示已经没有可返回的地方
 */
export function goBack(router, currentPath) {
  if (hasHistory()) {
    router.back()
    return true
  }
  if (!isSubPage(currentPath)) return false
  router.replace(fallbackOf(currentPath))
  return true
}

// ========== 页面内左右滑 ==========

// 起始点在这些元素里时忽略：输入框有光标拖动，横向滚动容器有自身手势
function blockedTarget(target) {
  if (!(target instanceof Element)) return true
  if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-swipe]')) return true
  let el = target
  while (el && el !== document.body) {
    const style = getComputedStyle(el)
    const overflowX = style.overflowX
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) {
      return true
    }
    el = el.parentElement
  }
  return false
}

export function installSwipeBack({ router, getPath, getRoot }) {
  let tracking = false
  let decided = false
  let active = false
  let startX = 0
  let startY = 0
  let dx = 0
  let dy = 0
  let root = null
  // 起手边缘：左边缘只能往右滑，右边缘只能往左滑，反方向不触发
  let startSide = ''
  // 滑动结束后浏览器仍可能补一个 click，不加拦截会顺带打开列表项
  let suppressClickUntil = 0

  function suppressClick(event) {
    if (Date.now() > suppressClickUntil) return
    suppressClickUntil = 0
    event.stopPropagation()
    event.preventDefault()
  }

  function reset(animated) {
    if (root) {
      root.classList.remove('swipe-back-drag')
      if (animated) {
        root.classList.add('swipe-back-snap')
        root.style.transform = ''
        setTimeout(() => root.classList.remove('swipe-back-snap'), 220)
      } else {
        root.classList.remove('swipe-back-snap')
        root.style.transform = ''
      }
    }
    tracking = false
    decided = false
    active = false
    dx = 0
    dy = 0
    startSide = ''
  }

  function onStart(event) {
    if (event.touches.length !== 1) {
      reset(false)
      return
    }
    const touch = event.touches[0]
    const path = getPath()
    // Tab 根页面不接管：主页面左滑交给系统退出，这里是三键导航用户按返回键的场景
    if (!isSubPage(path)) return
    // 只有边缘起手才算侧滑返回；页面中间的横向滑动留给列表和图表自己处理
    const width = window.innerWidth || document.documentElement.clientWidth || 0
    startSide = edgeSideOf(touch.clientX, width)
    if (!startSide) return
    // 弹窗打开时不接管，避免隔着弹窗把页面滑走
    if (topOverlay()) return
    if (blockedTarget(event.target)) return

    tracking = true
    decided = false
    active = false
    startX = touch.clientX
    startY = touch.clientY
    dx = 0
    dy = 0
    root = getRoot()
  }

  function onMove(event) {
    if (!tracking || event.touches.length !== 1) return
    const touch = event.touches[0]
    dx = touch.clientX - startX
    dy = touch.clientY - startY

    if (!decided) {
      if (Math.abs(dx) < MIN_INTENT && Math.abs(dy) < MIN_INTENT) return
      // 纵向意图明显就放弃，交还给页面滚动
      if (Math.abs(dy) >= Math.abs(dx)) {
        reset(false)
        return
      }
      decided = true
      active = true
      if (root) root.classList.add('swipe-back-drag')
    }
    if (!active || !root) return

    const offset = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, dx * FOLLOW_RATIO))
    root.style.transform = `translateX(${offset}px)`
  }

  function finish() {
    if (!tracking) return
    // 方向必须和起手边缘一致：左边缘向右滑、右边缘向左滑，反向拖拽不算返回
    const directionOk = !!startSide && (startSide === 'left' ? dx > 0 : dx < 0)
    const passed = decided &&
      directionOk &&
      Math.abs(dx) >= MIN_DISTANCE &&
      Math.abs(dx) > Math.abs(dy) * DIRECTION_RATIO
    const path = getPath()
    reset(true)
    if (!passed) return
    // 原生侧刚处理过这次侧滑，这里不要再退一次
    if (Date.now() - lastNativeBackAt < BACK_DEDUPE_MS) return
    suppressClickUntil = Date.now() + 400
    // 左右滑都按「返回上一页」处理，和用户预期一致
    if (goBack(router, path)) lastSwipeBackAt = Date.now()
  }

  function onCancel() {
    reset(false)
  }

  document.addEventListener('touchstart', onStart, { passive: true })
  document.addEventListener('touchmove', onMove, { passive: true })
  document.addEventListener('touchend', finish, { passive: true })
  document.addEventListener('touchcancel', onCancel, { passive: true })
  document.addEventListener('click', suppressClick, true)

  return () => {
    document.removeEventListener('touchstart', onStart)
    document.removeEventListener('touchmove', onMove)
    document.removeEventListener('touchend', finish)
    document.removeEventListener('touchcancel', onCancel)
    document.removeEventListener('click', suppressClick, true)
  }
}

// ========== 原生返回键 / 系统侧滑 ==========
export async function installNativeBack({ router, getPath }) {
  if (!Capacitor.isNativePlatform()) return () => {}

  const handle = await NativeApp.addListener('backButton', () => {
    // 页面内手势刚退过一页，说明系统这次的侧滑已被 WebView 处理，不要再退
    if (Date.now() - lastSwipeBackAt < BACK_DEDUPE_MS) return
    lastNativeBackAt = Date.now()

    // 弹窗优先：此时返回应该是「关掉这个框」而不是离开页面
    if (closeTopOverlay()) return

    const path = getPath()
    if (isSubPage(path)) {
      goBack(router, path)
      return
    }
    // Tab 根页面再按返回就是退出，符合 Android 习惯
    NativeApp.exitApp()
  })

  return () => {
    handle.remove()
  }
}
