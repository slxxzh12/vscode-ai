<script setup lang="ts">
// 全屏拖拽提示：由 App.vue 在 dragging 时挂载。
</script>

<template>
  <div class="ldrop">
    <div class="ldrop-box">
      <div class="ldrop-ic">⬇</div>
      <div class="ldrop-txt">{{ $t('local.drop_hint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.ldrop { position: fixed; inset: 0; z-index: 200; background: rgba(0, 0, 0, .45); display: flex; align-items: center; justify-content: center; pointer-events: none; }
.ldrop-box { border: 2px dashed var(--ac); border-radius: 12px; padding: 28px 44px; background: var(--bg1); color: var(--tx1); display: flex; flex-direction: column; align-items: center; gap: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, .4); }
.ldrop-ic { font-size: 30px; color: var(--ac2); }
.ldrop-txt { font-size: 14px; }
</style>
