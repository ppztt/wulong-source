<template>
  <div id="app-root">
    <!-- 启动画面 -->
    <div v-if="!dbReady" class="splash-screen">
      <div class="splash-icon">🍵</div>
      <div class="splash-title">乌龙记账</div>
      <div class="splash-loading">正在初始化...</div>
    </div>
    <template v-else>
      <div class="page-container" :class="{ 'with-tab': showTabBar }">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </div>
      <TabBar v-if="showTabBar" />
    </template>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TabBar from './components/TabBar.vue'
import { initDB } from './db'
import { pendingImportText, takePendingFile } from './utils/nativeFile'
import { installSwipeBack, installNativeBack } from './utils/backNavigation'

const route = useRoute()
const router = useRouter()
const showTabBar = ref(true)
const dbReady = ref(false)
// 手势与原生返回的清理函数
let disposeSwipe = null
let disposeNative = null

const hideTabBarRoutes = ['/add', '/edit', '/search', '/tags', '/installments', '/recurring', '/salary', '/interest', '/guide', '/import', '/assistant', '/categories', '/markets']
watch(() => route.path, (path) => {
  showTabBar.value = !hideTabBarRoutes.some(r => path.startsWith(r))
}, { immediate: true })

// 外部应用「用乌龙记账打开」文件时，原生侧先落盘再通知；这里读出来交给导入页
async function consumeIncomingFile() {
  const text = await takePendingFile()
  if (!text) return
  pendingImportText.value = text
  if (route.path !== '/import') router.push('/import')
}

onMounted(async () => {
  try {
    await initDB()
  } catch (e) {
    console.error('数据库初始化异常:', e)
  }
  dbReady.value = true

  // 冷启动时 onCreate 已经落盘，但通知可能早于页面就绪，这里主动查一次
  await consumeIncomingFile()

  window.addEventListener('wulong-native-file', consumeIncomingFile)
  // 应用从后台回到前台再兜一次，避免 onNewIntent 的通知丢失
  document.addEventListener('visibilitychange', onVisible)

  // 页面内左右滑返回（三键导航用户）与原生返回键/系统侧滑（手势导航用户）分开接管
  disposeSwipe = installSwipeBack({
    router,
    getPath: () => route.path,
    getRoot: () => document.querySelector('.page-container')
  })
  try {
    disposeNative = await installNativeBack({
      router,
      getPath: () => route.path
    })
  } catch (e) {
    console.warn('原生返回监听注册失败:', e)
  }
})

function onVisible() {
  if (document.visibilityState === 'visible') consumeIncomingFile()
}

onUnmounted(() => {
  window.removeEventListener('wulong-native-file', consumeIncomingFile)
  document.removeEventListener('visibilitychange', onVisible)
  if (disposeSwipe) disposeSwipe()
  if (disposeNative) disposeNative()
})
</script>

<style>
#app-root {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.page-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.page-container.with-tab {
  /* TabBar 高度 + 悬浮按钮高度及其间距（留 12px 余量），避免最后一条记录被 FAB 遮住 */
  padding-bottom: calc(var(--tab-height) + 88px + env(safe-area-inset-bottom, 0px));
}
/* 滑动返回：拖动时跟手不带动画，松手后回弹过渡 */
.page-container.swipe-back-drag {
  transition: none;
  will-change: transform;
}
.page-container.swipe-back-snap {
  transition: transform 0.22s cubic-bezier(0.22, 0.8, 0.3, 1);
}
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
.splash-screen {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  /* 与原生启动页、桌面图标同色，避免启动瞬间跳色 */
  background: linear-gradient(150deg, #1FE0AE 0%, #00C48E 55%, #00A87A 100%);
  color: #fff;
}
.splash-icon {
  font-size: 64px;
  margin-bottom: 16px;
  animation: splashPulse 1.8s ease-in-out infinite;
}
@keyframes splashPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.06); opacity: 0.92; }
}
.splash-title {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 12px;
  letter-spacing: 1px;
}
.splash-loading {
  font-size: 14px;
  opacity: 0.85;
}
</style>
