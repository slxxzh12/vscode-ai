async function api(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export interface PipelineConfig { autoDev: boolean; autoMerge: boolean }

export function loadPipelineConfig(): Promise<PipelineConfig> {
  return api('GET', '/api/pipeline/config');
}

export function savePipelineConfig(input: Partial<PipelineConfig>): Promise<PipelineConfig> {
  return api('POST', '/api/pipeline/config', input);
}

export function retryPipelineUs(us: string): Promise<{ ok: boolean }> {
  return api('POST', '/api/pipeline/retry', { us });
}
