import { LLM_PROVIDER_PRESETS, type LlmProviderPreset } from '@devflow/shared/llm-presets';
import { apiKeysOf, type OpencodeConfigJson } from './opencodeConfig';

export interface ProviderState {
  id: string;
  name: string;
  baseURL: string;
  hasKey: boolean;
  apiKey: string;
  selected: string[];
  manual: string;
}

export function stateFromConfig(
  config: OpencodeConfigJson | null,
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): ProviderState[] {
  const prov = config?.provider || {};
  return presets.map((p) => {
    const existing = prov[p.id];
    const hasKey = apiKeysOf(existing?.options).length > 0;
    const ids = Object.keys(existing?.models || {});
    const presetIds = p.models.map((m) => m.id);
    const selected = presetIds.filter((m) => ids.includes(m));
    const manual = ids.filter((m) => !presetIds.includes(m)).join(', ');
    return { id: p.id, name: p.name, baseURL: p.baseURL, hasKey, apiKey: '', selected, manual };
  });
}

export function buildSelections(states: ProviderState[]): { id: string; apiKey: string; models: string[] }[] {
  const out: { id: string; apiKey: string; models: string[] }[] = [];
  for (const s of states) {
    const manualIds = s.manual.split(',').map((t) => t.trim()).filter(Boolean);
    const models = [...new Set([...s.selected.map((m) => m.trim()).filter(Boolean), ...manualIds])];
    if (!s.apiKey.trim() && !s.hasKey && !models.length) continue;
    out.push({ id: s.id, apiKey: s.apiKey.trim(), models });
  }
  return out;
}

export function modelOptions(states: ProviderState[]): string[] {
  const out: string[] = [];
  for (const s of states) {
    const manualIds = s.manual.split(',').map((t) => t.trim()).filter(Boolean);
    for (const m of new Set([...s.selected.map((x) => x.trim()).filter(Boolean), ...manualIds])) {
      out.push(`${s.id}/${m}`);
    }
  }
  return out;
}
