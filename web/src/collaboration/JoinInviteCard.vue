<script setup lang="ts">
import { ref, watch } from 'vue';
import type { CollabApi } from './useCollab';
import type { CollabInvitePreview, CollabGroup } from './types';
import { t } from '../i18n';

const props = defineProps<{ collab: CollabApi; token: string }>();
const emit = defineEmits<{ (e: 'joined', group: CollabGroup | undefined): void; (e: 'cancel'): void }>();

const preview = ref<CollabInvitePreview | null>(null);
const loading = ref(false);
const joining = ref(false);
const error = ref('');

async function load(token: string) {
  error.value = ''; preview.value = null; loading.value = true;
  try {
    const r = await props.collab.previewInvite(token);
    if (r.code !== 'ok') error.value = r.code === 'expired' ? t('collab.join.expired') : t('collab.join.invalid');
    else preview.value = r;
  } catch (e) { error.value = String((e as Error).message || e); }
  finally { loading.value = false; }
}
watch(() => props.token, (tok) => { if (tok) load(tok); }, { immediate: true });

function joinErrorText(code: string): string {
  switch (code) {
    case 'expired': return t('collab.join.expired');
    case 'invite-revoked': return t('collab.join.revoked');
    case 'no-group': return t('collab.join.no_group');
    case 'bad-token': return t('collab.join.bad_token');
    default: return t('collab.join.unreachable');
  }
}
async function join() {
  joining.value = true; error.value = '';
  try {
    const r = await props.collab.joinByInvite(props.token);
    if (r.code === 'joined' || r.code === 'already-member') emit('joined', r.group);
    else error.value = joinErrorText(r.code);
  } catch (e) { error.value = String((e as Error).message || e); }
  finally { joining.value = false; }
}
function fmt(ts?: number) { return ts ? new Date(ts).toLocaleString() : ''; }
</script>

<template>
  <div class="jcard">
    <div class="jtitle">{{ $t('collab.join.title') }}</div>
    <div v-if="loading" class="jsub">{{ $t('collab.join.loading') }}</div>
    <template v-else-if="preview">
      <div class="jgroup">{{ preview.groupName }}</div>
      <div class="jsub">{{ $t('collab.join.inviter') }} {{ preview.inviter?.username }} · {{ preview.inviter?.host }}:{{ preview.inviter?.port }}</div>
      <div class="jsub">{{ $t('collab.join.expires') }} {{ fmt(preview.expiresAt) }}</div>
      <div v-if="preview.alreadyMember" class="jok">{{ $t('collab.join.already') }}</div>
      <div v-if="error" class="jerr">{{ error }}</div>
      <div class="jbtns">
        <button :disabled="joining" @click="join">{{ joining ? $t('common.processing') : (preview.alreadyMember ? $t('collab.join.open') : $t('common.join')) }}</button>
        <button class="ghost" @click="emit('cancel')">{{ $t('common.cancel') }}</button>
      </div>
    </template>
    <template v-else>
      <div class="jerr">{{ error || $t('collab.join.unreadable') }}</div>
      <div class="jbtns"><button class="ghost" @click="emit('cancel')">{{ $t('common.close') }}</button></div>
    </template>
  </div>
</template>

<style scoped>
.jcard { width: 360px; max-width: 92vw; background: var(--bg1); border: 1px solid var(--bd); border-radius: 10px; padding: 20px; box-shadow: 0 12px 40px rgba(0,0,0,.4); }
.jtitle { font-size: 12px; text-transform: uppercase; color: var(--tx6); letter-spacing: .5px; }
.jgroup { font-size: 20px; font-weight: 700; color: var(--tx1); margin: 10px 0 6px; }
.jsub { font-size: 12px; color: var(--tx2); margin: 3px 0; }
.jok { font-size: 12px; color: var(--ac2); margin-top: 6px; }
.jerr { font-size: 12px; color: var(--err); margin-top: 8px; }
.jbtns { display: flex; gap: 8px; margin-top: 16px; }
.jbtns button { flex: 1; background: var(--ac); color: var(--onac); border: none; border-radius: 6px; padding: 8px; cursor: pointer; }
.jbtns button.ghost { flex: none; background: none; border: 1px solid var(--bd); color: var(--tx2); }
.jbtns button:disabled { opacity: .6; cursor: default; }
</style>
