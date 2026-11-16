<template>
  <span
    v-if="brand"
    class="biz-icon"
    :style="{ background: brand.color, color: brand.fg || '#fff' }"
  >
    <!-- 有官方图形的直接渲染 logo，没有的（国内银行）用行名简称字标 -->
    <svg v-if="brand.path" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path :d="brand.path" />
    </svg>
    <span v-else class="biz-text">{{ brand.text }}</span>
  </span>
  <template v-else>{{ fallbackText }}</template>
</template>

<script setup>
import { computed } from 'vue'
import { getBrandIcon } from '../utils/icons'

const props = defineProps({
  icon: { type: String, default: '' }
})

const brand = computed(() => getBrandIcon(props.icon))

// 未知的 biz: 前缀不要原样显示，退化成默认钱包图标
const fallbackText = computed(() => {
  const icon = props.icon || ''
  if (icon.startsWith('biz:')) return '💰'
  return icon
})
</script>

<style scoped>
.biz-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5em;
  height: 1.5em;
  border-radius: 0.4em;
  vertical-align: -0.34em;
  flex-shrink: 0;
  box-shadow: 0 1px 3px rgba(16, 24, 40, 0.16);
}
.biz-icon svg {
  width: 62%;
  height: 62%;
  display: block;
}
/* 银行等无官方图形的品牌，用单字标代替 */
.biz-text {
  font-size: 0.74em;
  font-weight: 700;
  line-height: 1;
}
</style>
