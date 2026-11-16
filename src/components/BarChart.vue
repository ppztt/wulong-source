<template>
  <div class="bar-chart-wrap">
    <div class="bar-chart-scroll">
      <svg :width="svgWidth" :height="height" class="bar-chart">
        <!-- 基线 -->
        <line :x1="0" :y1="baseY" :x2="svgWidth" :y2="baseY" stroke="var(--border)" stroke-width="1" />

        <g v-for="(item, i) in data" :key="item.key || i">
          <rect
            :x="i * slot + (slot - barWidth) / 2"
            :y="barY(item.value)"
            :width="barWidth"
            :height="barHeight(item.value)"
            rx="3"
            :fill="color"
            :opacity="item.value > 0 ? 1 : 0.18"
          />
          <text
            v-if="showValue(i)"
            :x="i * slot + slot / 2"
            :y="barY(item.value) - 4"
            text-anchor="middle"
            class="value-label"
          >{{ shortValue(item.value) }}</text>
          <text
            v-if="showLabel(i)"
            :x="i * slot + slot / 2"
            :y="height - 4"
            text-anchor="middle"
            class="axis-label"
          >{{ item.label }}</text>
        </g>
      </svg>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  data: { type: Array, default: () => [] },
  height: { type: Number, default: 140 },
  color: { type: String, default: 'var(--primary)' }
})

const slot = 28
const barWidth = 14
const labelArea = 18
const topPad = 16

const svgWidth = computed(() => Math.max(props.data.length * slot, 240))

const maxValue = computed(() =>
  props.data.reduce((max, d) => Math.max(max, Number(d.value) || 0), 0)
)

const baseY = computed(() => props.height - labelArea)
const plotHeight = computed(() => baseY.value - topPad)

function barHeight(value) {
  const v = Number(value) || 0
  if (!maxValue.value || v <= 0) return 0
  return Math.max(1, (v / maxValue.value) * plotHeight.value)
}
function barY(value) {
  return baseY.value - barHeight(value)
}

// 柱子多时隔几个显示一个标签，避免文字重叠
const labelStep = computed(() => Math.ceil(props.data.length / 7))

function showLabel(index) {
  if (props.data.length <= 8) return true
  return index % labelStep.value === 0
}
// 柱子不多时直接在柱顶标数值
function showValue(index) {
  if (props.data.length > 10) return false
  const item = props.data[index]
  return item && Number(item.value) > 0
}
function shortValue(value) {
  const v = Number(value) || 0
  if (v >= 10000) return `${(v / 10000).toFixed(1)}w`
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`
  return String(Math.round(v))
}
</script>

<style scoped>
.bar-chart-wrap {
  width: 100%;
}
.bar-chart-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
.bar-chart {
  display: block;
  min-width: 100%;
}
.axis-label {
  font-size: 9px;
  fill: var(--text-secondary);
}
.value-label {
  font-size: 9px;
  fill: var(--text-secondary);
}
</style>
