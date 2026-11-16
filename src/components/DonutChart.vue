<template>
  <div class="donut" :style="{ width: size + 'px', height: size + 'px' }">
    <svg viewBox="0 0 40 40" :width="size" :height="size">
      <!-- 底环 -->
      <circle cx="20" cy="20" r="15.9155" fill="none" stroke="#EEF1F5" stroke-width="6" />
      <circle
        v-for="(seg, i) in segments"
        :key="seg.name + i"
        cx="20"
        cy="20"
        r="15.9155"
        fill="none"
        :stroke="seg.color"
        stroke-width="6"
        :stroke-dasharray="`${seg.pct} ${100 - seg.pct}`"
        :stroke-dashoffset="-seg.offset"
        transform="rotate(-90 20 20)"
        stroke-linecap="butt"
      />
    </svg>
    <div class="donut-center">
      <slot>
        <div class="center-label">{{ centerLabel }}</div>
        <div class="center-value">¥{{ centerValue }}</div>
      </slot>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  size: { type: Number, default: 130 },
  colorStart: { type: Number, default: 0 },
  centerLabel: { type: String, default: '合计' }
})

const PALETTE = [
  '#4A90D9', '#27AE60', '#F5A623', '#E74C3C', '#9B59B6',
  '#16A085', '#E67E22', '#34495E', '#1ABC9C', '#D35400'
]

// 只取前 8 项，其余合并为「其他」，避免环形图碎片过多
const merged = computed(() => {
  const list = props.data.slice(0, 8)
  const rest = props.data.slice(8)
  if (rest.length) {
    list.push({
      name: '其他',
      icon: '…',
      total: rest.reduce((sum, d) => sum + (Number(d.total) || 0), 0)
    })
  }
  return list
})

const total = computed(() =>
  merged.value.reduce((sum, d) => sum + (Number(d.total) || 0), 0)
)

const segments = computed(() => {
  let offset = 0
  return merged.value.map((d, i) => {
    const pct = total.value > 0 ? (Number(d.total) / total.value) * 100 : 0
    const seg = {
      name: d.name,
      pct,
      offset,
      color: PALETTE[(i + props.colorStart) % PALETTE.length]
    }
    offset += pct
    return seg
  })
})

const centerValue = computed(() => (Number(total.value) || 0).toFixed(2))
</script>

<style scoped>
.donut {
  position: relative;
  flex-shrink: 0;
}
.donut svg {
  display: block;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.center-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 2px;
}
.center-value {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}
</style>
