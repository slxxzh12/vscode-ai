export interface LlmPresetModel { id: string; vision: boolean }
export interface LlmProviderPreset {
  id: string;
  name: string;
  baseURL: string;
  models: LlmPresetModel[];
}
export declare const LLM_PROVIDER_PRESETS: LlmProviderPreset[];
export declare function presetById(id: string): LlmProviderPreset | null;
export declare function isVisionModel(providerId: string, modelId: string): boolean;
