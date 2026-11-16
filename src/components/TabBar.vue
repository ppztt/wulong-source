<template>
  <nav class="tab-bar">
    <router-link
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      class="tab-item"
      :class="{ active: isActive(tab.path) }"
    >
      <span class="tab-icon">{{ tab.icon }}</span>
      <span class="tab-label">{{ tab.label }}</span>
    </router-link>
  </nav>
</template>

<script setup>
import { useRoute } from 'vue-router'

const route = useRoute()

const tabs = [
  { path: '/', icon: '🏠', label: '首页' },
  { path: '/accounts', icon: '💳', label: '账户' },
  { path: '/statistics', icon: '📊', label: '报表' },
  { path: '/budgets', icon: '🎯', label: '预算' },
  { path: '/settings', icon: '⚙️', label: '设置' }
]

function isActive(path) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<style scoped>
.tab-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: auto;
  min-height: var(--tab-height);
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(10px);
  display: flex;
  border-top: 1px solid var(--border);
  box-shadow: 0 -2px 14px rgba(16, 24, 40, 0.05);
  z-index: 90;
  padding-bottom: env(safe-area-inset-bottom, 0);
}
.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-decoration: none;
  color: var(--text-tertiary);
  transition: color 0.2s;
  gap: 3px;
}
.tab-item.active {
  color: var(--primary);
}
.tab-icon {
  font-size: 22px;
  line-height: 1;
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.tab-item.active .tab-icon {
  transform: translateY(-2px) scale(1.1);
}
.tab-label {
  font-size: 10px;
  font-weight: 500;
  transition: font-weight 0.2s;
}
.tab-item.active .tab-label {
  font-weight: 700;
}
</style>
