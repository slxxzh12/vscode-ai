export const LLM_PROVIDER_PRESETS = Object.freeze([
  Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    models: Object.freeze([
      Object.freeze({ id: 'deepseek-v4-pro', vision: false }),
      Object.freeze({ id: 'deepseek-v4-flash', vision: false }),
      Object.freeze({ id: 'deepseek-v4-flash-vision-exp', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'glm',
    name: 'GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: Object.freeze([
      Object.freeze({ id: 'glm-4.6', vision: false }),
      Object.freeze({ id: 'glm-4.5-air', vision: false }),
      Object.freeze({ id: 'glm-4v-plus', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'qwen',
    name: 'Qwen',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: Object.freeze([
      Object.freeze({ id: 'qwen3-max', vision: false }),
      Object.freeze({ id: 'qwen3-coder-plus', vision: false }),
      Object.freeze({ id: 'qwen-vl-max', vision: true }),
    ]),
  }),
  Object.freeze({
    id: 'minimax',
    name: 'MiniMax',
    baseURL: 'https://api.minimax.chat/v1',
    models: Object.freeze([
      Object.freeze({ id: 'MiniMax-M2', vision: false }),
      Object.freeze({ id: 'MiniMax-Text-01', vision: false }),
      Object.freeze({ id: 'MiniMax-VL-01', vision: true }),
    ]),
  }),
]);

export function presetById(id) {
  return LLM_PROVIDER_PRESETS.find((p) => p.id === id) || null;
}

const VISION_RE = /vision|(^|[-_/])vl([-_/.]|$)|4v|omni/i;

export function isVisionModel(providerId, modelId) {
  const preset = presetById(providerId);
  const hit = preset && preset.models.find((m) => m.id === modelId);
  if (hit) return !!hit.vision;
  return typeof modelId === 'string' && VISION_RE.test(modelId);
}
