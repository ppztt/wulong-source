<template>
  <!-- 有自定义头像时直接用图片，否则渲染手绘乌龟 -->
  <span v-if="src" class="turtle-img" :style="boxStyle">
    <img :src="src" alt="头像" />
  </span>
  <svg
    v-else
    class="turtle-svg"
    :width="size"
    :height="size"
    viewBox="0 0 120 120"
    role="img"
    aria-label="小乌"
  >
    <!-- 浅色圆底：顶栏和聊天页是青绿底，深绿龟壳直接放上去会融成一片 -->
    <circle cx="60" cy="64" r="56" fill="#EAF9F3" />

    <!-- 后爪 -->
    <ellipse cx="33" cy="104" rx="9.5" ry="7" fill="#079E75" />
    <ellipse cx="87" cy="104" rx="9.5" ry="7" fill="#079E75" />

    <!-- 尾巴 -->
    <path d="M60 103 l-5 9 h10 z" fill="#079E75" stroke-linejoin="round" />

    <!-- 龟壳：穹顶 + 平底，比正椭圆更像龟背 -->
    <path d="M16 98 A44 36 0 0 1 104 98 Z" fill="#079E75" />
    <!-- 壳底厚度 -->
    <ellipse cx="60" cy="98" rx="44" ry="7" fill="#06775A" />

    <!-- 壳纹：中心六边形 + 放射线 -->
    <g stroke="#FFFFFF" stroke-opacity="0.5" stroke-width="2.2" stroke-linecap="round">
      <path d="M60 76 l11 4 v9 l-11 4 l-11 -4 v-9 z" fill="none" stroke-linejoin="round" stroke-width="2.6" />
      <path d="M60 76 V64" />
      <path d="M71 80 L85 74" />
      <path d="M71 89 L86 93" />
      <path d="M49 80 L35 74" />
      <path d="M49 89 L34 93" />
    </g>
    <!-- 壳面高光 -->
    <path d="M32 82 q10 -14 26 -16" stroke="#FFFFFF" stroke-opacity="0.26" stroke-width="3.5" fill="none" stroke-linecap="round" />

    <!-- 脖子：连接头和壳，没有它就像戴了顶帽子 -->
    <path d="M50 55 h20 v14 h-20 z" fill="#3EE0B0" />

    <!-- 头 -->
    <ellipse cx="60" cy="42" rx="19" ry="15" fill="#3EE0B0" />

    <!-- 腮红 -->
    <ellipse cx="45" cy="47" rx="3.6" ry="2.4" fill="#00A87A" opacity="0.34" />
    <ellipse cx="75" cy="47" rx="3.6" ry="2.4" fill="#00A87A" opacity="0.34" />

    <!-- 眼睛 -->
    <ellipse cx="52" cy="40" rx="3.8" ry="4.6" fill="#0B3B32" />
    <ellipse cx="68" cy="40" rx="3.8" ry="4.6" fill="#0B3B32" />
    <circle cx="53.2" cy="38.3" r="1.3" fill="#FFFFFF" />
    <circle cx="69.2" cy="38.3" r="1.3" fill="#FFFFFF" />

    <!-- 嘴 -->
    <path
      d="M55 48.5 q5 3.6 10 0"
      stroke="#0B3B32"
      stroke-width="2.1"
      fill="none"
      stroke-linecap="round"
    />

    <!-- 前爪：从壳底两侧伸出 -->
    <ellipse cx="26" cy="97" rx="10" ry="6.5" fill="#3EE0B0" transform="rotate(-12 26 97)" />
    <ellipse cx="94" cy="97" rx="10" ry="6.5" fill="#3EE0B0" transform="rotate(12 94 97)" />
  </svg>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // 边长（像素）
  size: { type: Number, default: 64 },
  // 自定义头像，dataURL；为空则显示内置乌龟
  src: { type: String, default: '' }
})

const boxStyle = computed(() => ({
  width: props.size + 'px',
  height: props.size + 'px'
}))
</script>

<style scoped>
.turtle-svg {
  display: block;
  flex-shrink: 0;
}
.turtle-img {
  display: inline-block;
  border-radius: 50%;
  overflow: hidden;
  background: #E8F7F2;
  flex-shrink: 0;
}
.turtle-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
</style>
