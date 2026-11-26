<script setup lang="ts">
// 黑洞品牌 logo：深色核心 + 蓝色吸积盘。每个实例用独立渐变 id，避免同页多次渲染冲突。
const uid = `void-glow-${Math.random().toString(36).slice(2, 9)}`;
</script>

<template>
  <svg class="void-logo" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <radialGradient :id="uid" cx="50%" cy="50%" r="50%">
        <stop offset="55%" stop-color="#0a0f18" />
        <stop offset="72%" stop-color="#3b9cff" stop-opacity=".85" />
        <stop offset="100%" stop-color="#3b9cff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <circle cx="32" cy="32" r="30" :fill="`url(#${uid})`" />
    <circle cx="32" cy="32" r="15" fill="#05070c" />
    <ellipse cx="32" cy="32" rx="27" ry="9" fill="none" stroke="#7ec8ff" stroke-width="2.5" opacity=".9" transform="rotate(-18 32 32)" />
    <ellipse cx="32" cy="32" rx="23" ry="7" fill="none" stroke="#3b9cff" stroke-width="1.5" opacity=".6" transform="rotate(-18 32 32)" />
  </svg>
</template>

<style scoped>
.void-logo { display: block; }
</style>
