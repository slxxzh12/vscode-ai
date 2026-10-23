export function formatNgaEvents(text: string): string {
  const out: string[] = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let evt: any;
    try { evt = JSON.parse(line); } catch { out.push(raw); continue; }
    if (evt.type === 'text' && evt.part && typeof evt.part.text === 'string') {
      out.push(evt.part.text);
    } else if (evt.type === 'tool_use') {
      out.push(`> ${evt.part?.title || evt.part?.tool || 'tool'}`);
    } else if (evt.type === 'step_start') {
      out.push('— step start —');
    } else if (evt.type === 'step_finish') {
      out.push('— step finish —');
    } else if (evt.type === 'error') {
      out.push(`ERROR: ${evt.error?.data?.message || evt.error?.name || 'error'}`);
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}
