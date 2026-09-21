import { LLM_PROVIDER_PRESETS, type LlmProviderPreset } from '@devflow/shared/llm-presets';
import { apiKeysOf, type OpencodeConfigJson } from './opencodeConfig';
import type { ProviderSelection } from './useLlm';

export interface ConfiguredProvider {
  id: string;
  name: string;
  baseURL: string;
  custom: boolean;
  hasKey: boolean;
  apiKey: string;
  keyOriginal?: string;
  models: string[];
  extraModels: string;
}

export function providersFromConfig(
  config: OpencodeConfigJson | null,
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): ConfiguredProvider[] {
  const prov = config?.provider || {};
  const presetMap = new Map(presets.map((p) => [p.id, p]));
  return Object.entries(prov).map(([id, p]) => {
    const preset = presetMap.get(id);
    const options = p?.options || {};
    const ids = Object.keys(p?.models || {});
    const presetIds = preset ? preset.models.map((m) => m.id) : [];
    const selected = preset ? ids.filter((m) => presetIds.includes(m)) : [];
    const extra = preset ? ids.filter((m) => !presetIds.includes(m)) : ids;
    const keyText = apiKeysOf(options).join(', ');
    return {
      id,
      name: (typeof p?.name === 'string' && p.name) || preset?.name || id,
      baseURL: (typeof options.baseURL === 'string' && options.baseURL) || preset?.baseURL || '',
      custom: !preset,
      hasKey: !!keyText,
      apiKey: keyText,
      keyOriginal: keyText,
      models: selected,
      extraModels: extra.join(', '),
    };
  });
}

export function addablePresets(
  list: ConfiguredProvider[],
  presets: LlmProviderPreset[] = LLM_PROVIDER_PRESETS,
): LlmProviderPreset[] {
  const ids = new Set(list.map((p) => p.id));
  return presets.filter((p) => !ids.has(p.id));
}

function splitIds(text: string): string[] {
  return text.split(',').map((t) => t.trim()).filter(Boolean);
}

export function buildProviders(list: ConfiguredProvider[]): ProviderSelection[] {
  const out: ProviderSelection[] = [];
  for (const s of list) {
    const models = [...new Set([...s.models.map((m) => m.trim()).filter(Boolean), ...splitIds(s.extraModels)])];
    const unchanged = s.apiKey === (s.keyOriginal ?? '');
    out.push({ id: s.id.trim(), name: s.name.trim(), baseURL: s.baseURL.trim(), apiKey: unchanged ? '' : s.apiKey.trim(), models });
  }
  return out;
}

export function modelOptions(list: ConfiguredProvider[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    if (!s.id.trim()) continue;
    for (const m of new Set([...s.models.map((x) => x.trim()).filter(Boolean), ...splitIds(s.extraModels)])) {
      out.push(`${s.id}/${m}`);
    }
  }
  return out;
}
