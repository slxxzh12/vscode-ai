<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';

const props = defineProps<{ text: string }>();
const host = ref<HTMLDivElement | null>(null);
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let observer: ResizeObserver | null = null;
let last = '';

function renderText() {
  if (!term) return;
  const next = String(props.text || '');
  if (!next) {
    term.clear();
    last = '';
    return;
  }
  if (next.startsWith(last)) {
    const suffix = next.slice(last.length);
    if (suffix) term.write(suffix);
  } else {
    term.clear();
    term.write(next);
  }
  last = next;
  term.scrollToBottom();
}

function fitNow() {
  try { fit?.fit(); } catch { /* ignore */ }
}

onMounted(() => {
  if (!host.value) return;
  term = new Terminal({
    cursorBlink: false,
    disableStdin: true,
    fontSize: 12,
    fontFamily: 'Consolas, "Courier New", monospace',
    theme: {
      background: '#0b0b0b',
      foreground: '#d4d4d4',
      cursor: '#0b0b0b',
      selectionBackground: '#264f78',
    },
  });
  fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host.value);
  fitNow();
  observer = new ResizeObserver(() => requestAnimationFrame(fitNow));
  observer.observe(host.value);
  renderText();
});

watch(() => props.text, renderText);

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  term?.dispose();
  term = null;
});
</script>

<template>
  <div class="process-terminal">
    <div ref="host" class="host" />
  </div>
</template>

<style scoped>
.process-terminal { flex: 1 1 0; min-height: 0; background: #0b0b0b; overflow: hidden; padding: 6px 8px; box-sizing: border-box; }
.host { width: 100%; height: 100%; }
</style>
