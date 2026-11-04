<script setup lang="ts">
import { MINI_TOOLS, type ToolId } from '../tools/catalog';

const emit = defineEmits<{ (e: 'new-agent'): void; (e: 'add-directory'): void; (e: 'open-tool', id: ToolId): void }>();
</script>

<template>
  <div class="welcome">
    <div class="whero">
      <div class="wtitle">{{ $t('welcome.title') }}</div>
      <div class="wsub">{{ $t('welcome.subtitle') }}</div>
      <div class="wactions">
        <button class="wprimary" @click="emit('new-agent')">
          <span class="wplus">＋</span>
          <span class="wtext">
            <span class="wmain">{{ $t('welcome.new_agent') }}</span>
            <span class="whint">{{ $t('welcome.new_agent_hint') }}</span>
          </span>
        </button>
        <button class="wprimary wsecondary" @click="emit('add-directory')">
          <span class="wplus">＋</span>
          <span class="wtext">
            <span class="wmain">{{ $t('welcome.add_folder') }}</span>
            <span class="whint">{{ $t('welcome.add_folder_hint') }}</span>
          </span>
        </button>
      </div>
    </div>

    <div class="wtools">
      <div class="wthead">{{ $t('welcome.tools_title') }}</div>
      <div class="wthint">{{ $t('welcome.tools_hint') }}</div>
      <div class="wgrid">
        <button v-for="x in MINI_TOOLS" :key="x.id" class="tcard" :title="$t(x.labelKey)" @click="emit('open-tool', x.id)">
          <span class="ticon">{{ x.icon }}</span>
          <span class="tname">{{ $t(x.labelKey) }}</span>
          <span class="tdesc">{{ $t(x.descKey) }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome { position: absolute; inset: 0; z-index: 4; background: var(--bg3); color: var(--tx); overflow: auto; display: flex; flex-direction: column; align-items: center; padding: 40px 24px; box-sizing: border-box; gap: 28px; }
.whero { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; max-width: 640px; }
.wtitle { color: var(--tx1); font-size: 24px; font-weight: 700; }
.wsub { color: var(--tx3); font-size: 13px; line-height: 1.6; }
.wactions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 8px; }
.wprimary { display: flex; align-items: center; gap: 14px; background: var(--ac); color: var(--onac); border: none; border-radius: 12px; padding: 14px 26px; cursor: pointer; }
.wprimary:hover { filter: brightness(1.08); }
.wsecondary { background: var(--bg2); color: var(--tx1); border: 1px solid var(--bd); }
.wsecondary:hover { border-color: var(--ac2); color: var(--ac2); filter: none; }
.wplus { font-size: 28px; line-height: 1; }
.wtext { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.wmain { font-size: 17px; font-weight: 700; }
.whint { font-size: 12px; opacity: .85; }
.wtools { width: 100%; max-width: 760px; }
.wthead { color: var(--tx1); font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.wthint { color: var(--tx4); font-size: 12px; margin-bottom: 12px; }
.wgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.tcard { display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--bg2); border: 1px solid var(--bd); color: var(--tx2); border-radius: 14px; padding: 18px 12px; cursor: pointer; text-align: center; }
.tcard:hover { border-color: var(--ac2); color: var(--ac2); }
.ticon { font-size: 30px; line-height: 1; }
.tname { font-size: 14px; font-weight: 600; }
.tdesc { color: var(--tx4); font-size: 11px; line-height: 1.4; }
</style>
