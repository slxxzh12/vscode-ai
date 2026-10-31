import { ref } from 'vue';

export interface SchedulerPromptIntent {
  prompt: string;
  run: boolean;
  hideInput: boolean;
}

export const pendingSchedulerPrompt = ref<SchedulerPromptIntent | null>(null);

export function requestSchedulerPrompt(prompt: string, run = false, hideInput = false) {
  pendingSchedulerPrompt.value = { prompt, run, hideInput };
}

export function clearSchedulerPrompt() {
  pendingSchedulerPrompt.value = null;
}

export function decodePromptBase64(raw: string): string {
  let b64 = raw.replace(/ /g, '+').trim().replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function parseSchedulerPromptFromSearch(search: string): SchedulerPromptIntent | null {
  const sp = new URLSearchParams(search);
  const raw = sp.get('aiPrompt') ?? sp.get('prompt');
  if (!raw) return null;
  let prompt = '';
  try { prompt = decodePromptBase64(raw); } catch { return null; }
  if (!prompt.trim()) return null;
  const auto = (sp.get('run') ?? sp.get('autorun') ?? '').toLowerCase();
  const hide = (sp.get('hideInput') ?? sp.get('hide') ?? '').toLowerCase();
  return {
    prompt,
    run: auto === '1' || auto === 'true' || auto === 'yes',
    hideInput: hide === '1' || hide === 'true' || hide === 'yes',
  };
}

export const SCHEDULER_PROMPT_PARAMS = ['aiPrompt', 'prompt', 'run', 'autorun', 'hideInput', 'hide'];

export interface SchedulerEditIntent {
  taskId: string;
  promptId: string;
  promptHash: string;
  prompt: string;
}

export const pendingSchedulerEdit = ref<SchedulerEditIntent | null>(null);

export function requestSchedulerEdit(intent: SchedulerEditIntent) {
  pendingSchedulerEdit.value = intent;
}

export function clearSchedulerEdit() {
  pendingSchedulerEdit.value = null;
}

export function parseSchedulerEditFromSearch(search: string): SchedulerEditIntent | null {
  const sp = new URLSearchParams(search);
  const taskId = (sp.get('editTask') || '').trim();
  if (!taskId) return null;
  let prompt = '';
  const raw = sp.get('prompt');
  if (raw) {
    try { prompt = decodePromptBase64(raw); } catch { prompt = ''; }
  }
  let promptId = (sp.get('promptId') || '').trim();
  let promptHash = (sp.get('promptHash') || '').trim();
  // 三个参数只取一个：原文 > 提示词 ID > 提示词 Hash
  if (prompt.trim()) { promptId = ''; promptHash = ''; }
  else if (promptId) promptHash = '';
  return { taskId, promptId, promptHash, prompt };
}

export const SCHEDULER_EDIT_PARAMS = ['editTask', 'promptId', 'promptHash', 'prompt'];
