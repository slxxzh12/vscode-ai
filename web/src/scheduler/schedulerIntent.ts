import { ref } from 'vue';

export interface SchedulerPromptIntent {
  prompt: string;
  run: boolean;
}

export const pendingSchedulerPrompt = ref<SchedulerPromptIntent | null>(null);

export function requestSchedulerPrompt(prompt: string, run = false) {
  pendingSchedulerPrompt.value = { prompt, run };
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
  return { prompt, run: auto === '1' || auto === 'true' || auto === 'yes' };
}

export const SCHEDULER_PROMPT_PARAMS = ['aiPrompt', 'prompt', 'run', 'autorun'];
