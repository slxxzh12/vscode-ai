<script setup lang="ts">
import { onMounted } from 'vue';
onMounted(() => { document.title = '网页版 opencode'; });
</script>
<template>
  <div class="app-shell placeholder">
    <h1>网页版 opencode — scaffold ok</h1>
  </div>
</template>
<style scoped>
.placeholder { display: grid; place-items: center; height: 100vh; color: #ccc; }
</style>
